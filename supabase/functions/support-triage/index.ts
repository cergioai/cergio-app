// Supabase Edge Function — support-triage.
//
// The AI support ladder for the in-app Help widget. On a new ticket:
//   1. HAIKU (claude-haiku-4-5-20251001) reads the ticket + a concise product/FAQ
//      context and either (a) resolves with a helpful reply, or (b) says it
//      cannot and why.
//   2. If Haiku can't resolve confidently → escalate to OPUS (claude-opus-4-8)
//      with more context. If Opus resolves → ai_resolved (ai_stage='opus').
//   3. If Opus also can't — or the issue needs a human/account/refund/bug/data
//      action — the ticket goes to status='human', ai_reason is set, and the
//      FOUNDER is notified (Resend email) + it surfaces on the dashboard via
//      cergio_support_summary().
//
// ── HARD SAFETY RULE — THE AI IS REPLY-ONLY ─────────────────────────────────
// This function NEVER takes an account / money / data action on a user's behalf.
// Its ONLY writes are: (a) UPDATE the ticket's OWN ai_* / status columns, and
// (b) INSERT a support_messages row (sender='ai'). There is no code path here
// that touches auth, payments, payouts, refunds, another user's data, or any
// destructive op — those categories are DETECTED and force status='human'.
// The guard below (mustEscalateToHuman) is the structural enforcement: a model
// that "resolves" a refund/delete/account request is OVERRIDDEN to human.
//
// AUTH: callable by the app (anon key or a user JWT) OR by the service role.
// It re-reads the ticket with the service role, so it never trusts client input
// beyond the ticket id.
//
// Required secrets (env only — NEVER in source):
//   ANTHROPIC_API_KEY                              — Haiku + Opus
//   RESEND_API_KEY                                 — founder handoff email
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY       — auto-populated
// Optional:
//   ADMIN_EMAILS (comma-sep, default t@cergio.ai,info@cergio.ai) — handoff recipients
//   APP_URL                                        — deep link base for the email

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const HAIKU = 'claude-haiku-4-5-20251001'; // fast triage
const OPUS  = 'claude-opus-4-8';           // deep escalation

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FROM_EMAIL       = 'Cergio Support <notify@cergio.ai>'; // verified domain
const APP_URL_FALLBACK = 'https://cergio-app-cergio-s-projects.vercel.app';
const DEFAULT_ADMINS   = ['t@cergio.ai', 'info@cergio.ai'];

// ── REPLY_ONLY allowlist — the ONLY things this function is permitted to do. ──
// Kept as data so the intent is auditable (and greppable by qa.mjs). If a future
// edit tries to add a side-effect, it does not belong to this set and must not
// ship. The AI's output is ALWAYS treated as text; it can never name an action
// that this function will perform.
const AI_REPLY_ONLY = true;
const ALLOWED_EFFECTS = Object.freeze([
  'update_own_ticket_status',   // set this ticket's status + ai_* columns
  'insert_support_message',     // append an ai reply to this ticket's thread
  'notify_founder_email',       // email the founder on human-handoff
]);

// Any ticket whose ASK falls in these categories can NEVER be "resolved" by the
// AI alone — it must go to a human, no matter how confident the model is. This
// is the structural reply-only guard: the AI answers questions, humans take
// actions on accounts / money / data.
const HUMAN_ONLY_PATTERNS: RegExp[] = [
  /\brefund|charge(d)?|chargeback|reimburse|money back|payout|payment|billing|invoice|receipt\b/i,
  /\bcancel (my|the) (booking|order|subscription|payment)\b/i,
  /\bdelete (my|the) (account|data|profile)|close my account|deactivate\b/i,
  /\breset (my )?password|can'?t log ?in|locked out|2fa|verify my identity\b/i,
  /\bchange (my )?(email|password|phone|payout|bank)\b/i,
  /\baccess (someone|another|other) (user|account)|on behalf of\b/i,
  /\bhack|fraud|scam|stolen|dispute|legal|lawyer|gdpr|ccpa|subpoena\b/i,
  /\bbug|error|broken|crash|not working|can'?t (book|list|upload|see|find)\b/i,
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// Concise product / FAQ context — the known flows + common issues, distilled
// from the frozen spec. Gives the model enough to answer real how-do-I questions
// without inventing features.
const PRODUCT_CONTEXT = `
CERGIO — what it is: a services marketplace where friends recommend independent &
mobile providers, creators (Connectors) drive bookings, and everyone earns
referral fees. Free-first, Miami-first for the founding cohort.

KEY FLOWS (answer how-to questions from these):
• Find a service: Home → type what you need in the chat → we match nearby providers →
  tap a provider → confirm the day/time → request sent. You're notified when a provider responds.
• Free (barter) bookings: a $0 booking is a swap — after the job you post an Instagram
  spotlight and the provider accepts it to complete the barter. You must finish one
  barter (post + provider-accept) before booking another free service.
• List your service: Profile → list a service → describe it, add offerings & photos → publish.
• Connectors/creators: creators with a following can be recommended and earn on bookings
  they drive. Referral earnings accumulate (capped) and pay on BOOKINGS, not signups.
• Requests vs bookings: a connector request lives in your Inbox; a direct booking shows in
  Inbox → Upcoming. Providers accept a time; paid bookings are charged only AFTER the
  provider confirms the time.
• Notifications: you get email (and SMS if a phone is on file) when someone requests a
  service near you, a provider responds, or a barter step happens.
• Cash out earnings: Earnings screen → request a cash-out (emails support).

COMMON ISSUES you CAN answer:
• "How do I book / list / invite / recommend?" — walk them through the flow above.
• "What is a barter / free swap?" — explain the post-and-accept loop.
• "Where do I see my requests?" — Activity (their open requests) / Inbox (Upcoming).
• "How do referral earnings work?" — accumulate, capped, pay on bookings.

You CANNOT (these ALWAYS need a human): refunds/charges/billing, canceling a paid
booking, deleting/changing an account, password/login/identity, accessing another
user's data, disputes/fraud/legal, or a confirmed product BUG. For these, say you're
connecting them with the team — do NOT attempt the action.
`;

const SYSTEM = (tier: 'haiku' | 'opus') => `You are Cergio's AI support agent (${tier} tier). You help users of the Cergio services marketplace.

${PRODUCT_CONTEXT}

YOUR HARD LIMITS — you are REPLY-ONLY:
• You may ONLY write a helpful text reply. You CANNOT and MUST NOT take any action
  on the user's account, money, bookings, or data. You have no tools.
• If the request needs an account/money/refund/booking-cancel/password/data/legal
  action, OR describes a confirmed bug, you MUST set needs_human=true and can_resolve=false,
  write a warm holding reply telling them you're connecting them with the team, and set
  a one-line reason. NEVER pretend you performed such an action.
• Only set can_resolve=true for genuine how-to / informational questions you can fully
  answer from the context above with high confidence. If unsure, escalate (can_resolve=false).

Respond ONLY with JSON, no prose:
{"can_resolve": boolean, "reply": "the message to send the user (always present, warm, concise)", "needs_human": boolean, "reason": "one line: why a human is needed, else empty"}`;

// Call Anthropic once, parse the JSON verdict. Returns null on transport / parse
// failure so the caller can escalate rather than crash.
async function askClaude(model: string, tier: 'haiku' | 'opus', apiKey: string, ticket: any):
  Promise<{ can_resolve: boolean; reply: string; needs_human: boolean; reason: string } | null> {
  const userMsg =
    `Ticket subject: ${ticket.subject || '(none)'}\n` +
    `Ticket body:\n${ticket.body || '(empty)'}\n` +
    (ticket.screenshot_url ? `\n(User also attached a screenshot: ${ticket.screenshot_url})\n` : '') +
    `\nTriage this ticket and return the JSON verdict now.`;
  let resp: Response;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 700, system: SYSTEM(tier),
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
  } catch (_e) { return null; }
  if (!resp.ok) return null;
  const aj = await resp.json().catch(() => null);
  const text = (aj?.content ?? []).map((c: any) => c?.text ?? '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch { return null; }
  return {
    can_resolve: parsed.can_resolve === true,
    reply:       String(parsed.reply ?? '').slice(0, 4000),
    needs_human: parsed.needs_human === true,
    reason:      String(parsed.reason ?? '').slice(0, 500),
  };
}

// ── THE STRUCTURAL SAFETY GUARD ───────────────────────────────────────────────
// Independent of the model: even if the model says can_resolve=true, if the
// ticket ASKS for an account/money/data/bug action, the AI is NOT allowed to
// "resolve" it — that is a human's job. Returns the reason it must go to a human,
// or null if the AI may answer.
function mustEscalateToHuman(ticket: any, verdict: { needs_human: boolean; reason: string } | null): string | null {
  if (verdict?.needs_human) return verdict.reason || 'The model flagged this as needing a human.';
  const hay = `${ticket.subject || ''}\n${ticket.body || ''}`;
  for (const re of HUMAN_ONLY_PATTERNS) {
    if (re.test(hay)) {
      return 'This involves an account, payment, data, or bug action — the AI is reply-only, so a teammate must handle it.';
    }
  }
  return null;
}

async function notifyFounder(db: any, ticket: any, appBase: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const admins = (Deno.env.get('ADMIN_EMAILS') || DEFAULT_ADMINS.join(','))
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!resendKey || admins.length === 0) return { email: 'skipped (RESEND_API_KEY / ADMIN_EMAILS unset)' };
  const link = `${appBase}/support-inbox`;
  const html = `<!doctype html><html><body style="margin:0;background:#F8F8F8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:12px;font-weight:800;letter-spacing:2px;color:#4AA901;text-transform:uppercase;">Cergio Support</p>
      <h2 style="font-size:20px;margin:6px 0 14px;">A support ticket needs a human</h2>
      <div style="background:#fff;border:1px solid #E5E5E5;border-radius:14px;padding:16px 20px;font-size:14px;color:#3A3A3A;">
        <p style="margin:0 0 8px;"><strong>From:</strong> ${escapeHtml(ticket.email || '(no email)')}</p>
        <p style="margin:0 0 8px;"><strong>Subject:</strong> ${escapeHtml(ticket.subject || '(none)')}</p>
        <p style="margin:0 0 8px;white-space:pre-wrap;"><strong>Message:</strong> ${escapeHtml((ticket.body || '').slice(0, 800))}</p>
        <p style="margin:0;"><strong>Why AI escalated:</strong> ${escapeHtml(ticket.ai_reason || 'needs a human')}</p>
      </div>
      <div style="text-align:center;margin:22px 0;">
        <a href="${link}" style="display:inline-block;background:#4AA901;color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:13px 30px;border-radius:24px;">Open the support inbox →</a>
      </div>
    </div></body></html>`;
  const text = `A Cergio support ticket needs a human.\nFrom: ${ticket.email || '(no email)'}\nSubject: ${ticket.subject || '(none)'}\nMessage: ${(ticket.body || '').slice(0, 800)}\nWhy AI escalated: ${ticket.ai_reason || 'needs a human'}\n\nOpen the inbox: ${link}`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: admins, subject: `Support needs a human — ${ticket.subject || 'ticket'}`, html, text }),
    });
    return { email: r.ok ? 'sent' : `error ${r.status}` };
  } catch (e) {
    return { email: `error ${e instanceof Error ? e.message : String(e)}` };
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const started = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = createClient(supabaseUrl, serviceKey);

    const body     = await req.json().catch(() => ({} as any));
    const ticketId = body?.ticketId;
    const appBase  = (typeof body?.app_url === 'string' && body.app_url) || Deno.env.get('APP_URL') || APP_URL_FALLBACK;
    if (!ticketId) return json({ error: 'ticketId required' }, 400);

    // Re-read the ticket with the service role — never trust client-supplied content.
    const { data: ticket, error: tErr } = await db
      .from('support_tickets').select('*').eq('id', ticketId).single();
    if (tErr || !ticket) return json({ error: 'ticket not found', detail: tErr?.message }, 404);

    // Ensure the opening user message is on the thread (idempotent — the client
    // can't insert it for logged-out users under RLS, so we do it here with the
    // service role, exactly once). This is one of the two allowed effects.
    try {
      const { count } = await db
        .from('support_messages')
        .select('id', { count: 'exact', head: true })
        .eq('ticket_id', ticket.id)
        .eq('sender', 'user');
      if (!count) {
        await db.from('support_messages').insert({
          ticket_id: ticket.id, sender: 'user', body: String(ticket.body || ticket.subject || '').slice(0, 8000),
        });
      }
    } catch (_e) { /* thread mirror is best-effort; never block triage */ }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      // No AI available → straight to a human, honestly.
      await routeToHuman(db, ticket, 'AI is not configured (ANTHROPIC_API_KEY unset).', appBase);
      return json({ ok: true, stage: 'human', reason: 'ANTHROPIC_API_KEY unset', ms: Date.now() - started });
    }

    // ── STAGE 1: HAIKU ────────────────────────────────────────────────────────
    const haiku = await askClaude(HAIKU, 'haiku', apiKey, ticket);
    const humanReason1 = mustEscalateToHuman(ticket, haiku);
    if (haiku && haiku.can_resolve && !humanReason1) {
      await resolveWithAi(db, ticket, 'haiku', haiku.reply);
      return json({ ok: true, stage: 'haiku', resolved: true, reply: haiku.reply, ms: Date.now() - started });
    }

    // ── STAGE 2: OPUS (escalation) ────────────────────────────────────────────
    // Mark the interim state so the dashboard can see it escalated.
    await db.from('support_tickets').update({ status: 'escalated', ai_stage: 'opus', updated_at: new Date().toISOString() }).eq('id', ticket.id);
    const opus = await askClaude(OPUS, 'opus', apiKey, ticket);
    const humanReason2 = mustEscalateToHuman(ticket, opus);
    if (opus && opus.can_resolve && !humanReason2) {
      await resolveWithAi(db, ticket, 'opus', opus.reply);
      return json({ ok: true, stage: 'opus', resolved: true, reply: opus.reply, ms: Date.now() - started });
    }

    // ── STAGE 3: HUMAN ────────────────────────────────────────────────────────
    const reason = humanReason2 || humanReason1 || opus?.reason || haiku?.reason
      || 'Neither AI tier could resolve this confidently.';
    // A courteous holding reply for the user (prefer the model's, else a default).
    const holding = (opus?.reply || haiku?.reply || '').trim()
      || "Thanks for reaching out — I've passed this to the Cergio team and someone will get back to you shortly.";
    const notify = await routeToHuman(db, ticket, reason, appBase, holding);
    return json({ ok: true, stage: 'human', resolved: false, reason, reply: holding, notify, ms: Date.now() - started });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }, 500);
  }
});

// The ONLY writes this function performs — both scoped to THIS ticket. (Effect
// allowlist above: update_own_ticket_status + insert_support_message.)
async function resolveWithAi(db: any, ticket: any, stage: 'haiku' | 'opus', reply: string) {
  const now = new Date().toISOString();
  await db.from('support_tickets').update({
    status: 'ai_resolved', ai_stage: stage, ai_reply: reply, handled_by: 'ai',
    resolved_at: now, updated_at: now,
  }).eq('id', ticket.id);
  await db.from('support_messages').insert({ ticket_id: ticket.id, sender: 'ai', body: reply });
}

// Route to a human: set status, record the reason + a holding reply, notify the
// founder. NO account/money/data action is taken — this is the reply-only path.
async function routeToHuman(db: any, ticket: any, reason: string, appBase: string, holding?: string) {
  const now = new Date().toISOString();
  await db.from('support_tickets').update({
    status: 'human', ai_stage: 'human', ai_reason: reason, updated_at: now,
  }).eq('id', ticket.id);
  if (holding) {
    await db.from('support_messages').insert({ ticket_id: ticket.id, sender: 'ai', body: holding });
    await db.from('support_tickets').update({ ai_reply: holding }).eq('id', ticket.id);
  }
  // Merge the reason back onto the ticket object so the email includes it.
  return await notifyFounder(db, { ...ticket, ai_reason: reason }, appBase);
}

// Exported markers so the intent is unmissable in review (and in qa greps):
// this function is AI_REPLY_ONLY and its side-effects are limited to ALLOWED_EFFECTS.
export { AI_REPLY_ONLY, ALLOWED_EFFECTS, HUMAN_ONLY_PATTERNS, mustEscalateToHuman };
