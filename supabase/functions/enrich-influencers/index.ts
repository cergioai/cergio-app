// Supabase Edge Function — SPEC-68 influencer contact enrichment (safe layer).
//
// Raises email/phone coverage on leads_influencers WITHOUT touching Instagram.
// For creators we have no email for, it reads their bio text and fetches their
// own link-in-bio / website (external_url) — third-party public sites, NOT
// Meta's property, so this is low ToS risk and OK to run from Cergio infra.
// (The higher-yield IG contact-button harvest stays in the separate clean-room
// crawler per CRAWLER_BRIEF_IG_contacts.md — never here.)
//
// Fills only NULL fields, never overwrites; skips do_not_contact + suppressed.
// AUTH: service-role bearer only (cron / "Enrich Influencers.command").

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const BATCH = 40;

serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const started = Date.now();
  let dbRef: any = null;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return json({ error: 'Unauthorized' }, 401);
    const db = createClient(supabaseUrl, serviceKey);
    dbRef = db;

    // Creators missing an email but with a link to mine (or a bio to parse).
    const { data: rows, error } = await db
      .from('leads_influencers')
      .select('id, ig_handle, bio, external_url, email, phone')
      .neq('outreach_status', 'do_not_contact')
      .is('email', null)
      .limit(BATCH);
    if (error) throw error;

    let enriched = 0; const results: Array<Record<string, unknown>> = [];
    for (const r of rows ?? []) {
      let email: string | null = null, phone: string | null = null;

      // 1) Parse the bio first (free).
      if (r.bio) { email = firstEmail(r.bio); phone = phone || firstPhone(r.bio); }

      // 2) Fetch their link/site if still missing an email.
      if (!email && r.external_url) {
        const page = await fetchText(r.external_url);
        if (page) {
          email = firstEmail(page);
          phone = phone || firstPhone(page);
          // linktree-style: follow one website link if no email yet
          if (!email) {
            const sub = (page.match(/https?:\/\/[^\s"'<>]+/g) || [])
              .find(u => !/instagram|tiktok|facebook|twitter|x\.com|youtube|linktr\.ee|beacons|cdn|\.(png|jpg|css|js)/i.test(u));
            if (sub) { const p2 = await fetchText(sub); if (p2) { email = firstEmail(p2); phone = phone || firstPhone(p2); } }
          }
        }
      }

      if (!email && !phone) { results.push({ ig: r.ig_handle, found: false }); continue; }

      // Suppression check before persisting a contact we'd reach out to.
      if (email) {
        const { data: s } = await db.from('outreach_suppressions').select('id').eq('channel', 'email').ilike('address', email).maybeSingle();
        if (s) email = null;
      }
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (email && !r.email) patch.email = email;
      if (phone && !r.phone) patch.phone = phone;
      if (Object.keys(patch).length > 1) {
        patch.outreach_notes = `enriched ${new Date().toISOString().slice(0,10)} (${email ? 'email' : ''}${email && phone ? '+' : ''}${phone ? 'phone' : ''})`;
        await db.from('leads_influencers').update(patch).eq('id', r.id);
        enriched++; results.push({ ig: r.ig_handle, email: !!patch.email, phone: !!patch.phone });
      }
    }
    // BACKBONE: unified agent_runs ledger. raw_found = candidates checked,
    // rows_written = rows actually enriched. 'empty' when checked but 0 enriched
    // (a real state — no new contacts found — not a failure).
    await logAgentRun(db, 'enrich-influencers', {
      started, raw_found: (rows ?? []).length, rows_written: enriched,
      status: enriched === 0 ? 'empty' : 'ok', error: null,
      meta: { checked: (rows ?? []).length },
    });
    return json({ checked: (rows ?? []).length, enriched, results });
  } catch (e) {
    await logAgentRun(dbRef, 'enrich-influencers', {
      started, raw_found: null, rows_written: 0,
      status: 'error', error: e instanceof Error ? e.message : String(e),
    });
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// BACKBONE helper — write ONE agent_runs row per invocation. NEVER throws.
async function logAgentRun(
  db: any,
  agent: string,
  o: { started: number; raw_found?: number | null; rows_written?: number | null;
       status?: string; error?: string | null; meta?: unknown },
): Promise<void> {
  if (!db) return;
  try {
    await db.from('agent_runs').insert({
      agent,
      started_at: new Date(o.started).toISOString(),
      finished_at: new Date().toISOString(),
      raw_found: o.raw_found ?? null,
      rows_written: o.rows_written ?? null,
      status: o.status ?? 'ok',
      error: o.error ? String(o.error).slice(0, 1000) : null,
      meta: o.meta ?? null,
    });
  } catch (_e) { /* best-effort */ }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'CergioBot/1.0 (+https://cergio.ai)' } });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.text()).slice(0, 200000);
  } catch { return null; }
}

function firstEmail(s: string): string | null {
  const m = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  for (const e of m) {
    const x = e.toLowerCase();
    if (/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/.test(x)) continue;
    if (/(sentry|wixpress|example\.com|godaddy|squarespace|cloudflare)/.test(x)) continue;
    return x;
  }
  return null;
}

function firstPhone(s: string): string | null {
  const m = s.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+1\d{10}/g) || [];
  for (const p of m) {
    const digits = p.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  }
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
