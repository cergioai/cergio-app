// Supabase Edge Function — Cergio chat parser.
//
// Resolution order on every turn:
//   1. Local ontology engine (resolver.ts) — 9-step pipeline against the
//      taxonomy v3 master file (3,002 terms × 932 offerings × 26 bundles
//      × fuzzy rules). ~95% of queries land here, paying $0 in API spend.
//   2. Claude Haiku 4.5 fallback ONLY when local confidence < 0.60. The
//      Claude call still gets the resolver's top candidates as context so
//      it has a head start.
//
// When/where/budget/flexible are always parsed locally (cheap regex). Claude
// is only ever asked about the SERVICE (what) and only when the ontology
// can't make a confident match.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  resolveQuery,
  parseExtras,
  composeBotReply,
  defaultQuickReplies,
  detectUrgency,
  ENGINE_META,
  type ResolverResult,
} from './resolver.ts';

const MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const CONFIDENCE_THRESHOLD = 0.60;

const SYSTEM_PROMPT = `You are CERGIO, a booking assistant for a local-services marketplace.

A local ontology engine has already tried to match the user's request. You are
being called BECAUSE that engine had low confidence (< 0.60). Your job is to
identify the right service, ask the minimum clarifying question, and return
strict JSON.

You will receive in the user message:
- user_message
- state (already-captured fields: what / when / where / budget / details)
- candidate_offerings (up to 3 offering IDs the local engine half-matched)
- candidate_offering_names (their human names — use these to disambiguate)

Behavior:
- If the candidates clearly disambiguate the user's intent, pick the best one
  and put its name in parsed.what. Set fits=true.
- If they don't, ask ONE concise clarifying question. Set fits=true.
- Only set fits=false if the request is clearly outside our scope
  (legal advice, medical care, prescription drugs, weapons).
- Mandatory fields are what + when + where. Budget + details are optional.
- The local engine has already filled in any when/where/budget it found —
  carry those forward unchanged unless the user gave new info.
- "next_step" must be one of: "what" | "when" | "where" | "budget" | "details" | "done".
  Use "done" when what + when + where are all present.

Output ONLY this JSON (no markdown, no prose):
{
  "parsed": { "what": string|null, "when": string|null, "where": string|null, "budget": string|null, "details": string|null },
  "fits": boolean,
  "is_flexible_time": boolean|null,
  "next_step": "what"|"when"|"where"|"budget"|"details"|"done",
  "bot_reply": string,
  "quick_replies": string[],
  "switch_to_form": boolean
}`;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({} as any));
    const userMessage    = String(body?.user_message ?? '').slice(0, 1000);
    const state          = body?.state ?? {};
    const attempts       = body?.attempts ?? {};
    const isRepeatUser   = !!body?.is_repeat_user;
    const defaultAddress = body?.default_address ?? null;

    if (!userMessage.trim()) {
      return json({ error: 'user_message required' }, 400);
    }

    // ── Step 1: local resolver ─────────────────────────────────────────────
    const local: ResolverResult = resolveQuery(userMessage);
    const extras = parseExtras(userMessage, state);

    // ── "my home" shortcut for signed-in users with a saved default ───────
    let whereResolved = extras.where ?? state.where ?? null;
    if (!whereResolved && defaultAddress &&
        /\b(?:home|my place|default|usual|same as last time|home address)\b/i.test(userMessage)) {
      whereResolved = defaultAddress;
    }

    // ── Awaiting-field fallback — THE SPINE MUST NOT LOOP (Tarik 2026-06-25).
    // Addresses/areas are free-form ("6700 collins avenue", "miami beach",
    // "near brickell") and won't always hit a street regex. If the bot was
    // clearly awaiting WHERE (service already captured) or WHEN, accept the
    // user's reply as that field rather than re-asking forever. Guarded: only
    // when this message did NOT resolve to a NEW service (a course-change),
    // so "actually I need a plumber" still switches instead of becoming a city.
    const switchingService = local.confidence >= CONFIDENCE_THRESHOLD && !!local.offering_id;
    let whenResolved = extras.when ?? state.when ?? null;
    const reply = userMessage.trim();
    if (!switchingService && reply) {
      if (state.what && whenResolved && !whereResolved && reply.length <= 140) {
        whereResolved = reply;                 // answering "where?"
      } else if (state.what && !whenResolved && reply.length <= 80) {
        whenResolved = reply;                  // answering "when?"
      }
    }

    // Merge what comes from the resolver with what the user already had.
    // Bundles don't carry an offering_id but DO have an offering_name —
    // use that too so the user sees "Wedding Bundle ✓" instead of falling
    // back through to the Claude path.
    const haveLocalWhat =
      local.confidence >= CONFIDENCE_THRESHOLD &&
      !!local.offering_name;
    const merged = {
      what:    (haveLocalWhat ? local.offering_name : null) ?? state.what ?? null,
      when:    whenResolved,
      where:   whereResolved,
      budget:  extras.budget ?? state.budget ?? null,
      details: state.details ?? null,
    };
    const urgency = detectUrgency(userMessage);

    // Decide next step from what's missing.
    const missing =
      !merged.what  ? 'what'  :
      !merged.when  ? 'when'  :
      !merged.where ? 'where' :
      'done';

    // ── High-confidence local path → SKIP CLAUDE ENTIRELY ──────────────────
    if (local.confidence >= CONFIDENCE_THRESHOLD || merged.what) {
      const result = {
        parsed:           merged,
        fits:             true,
        is_flexible_time: extras.flexible,
        next_step:        missing,
        bot_reply:        composeBotReply(merged, missing, local),
        quick_replies:    defaultQuickReplies(missing),
        switch_to_form:   false,
        urgency,
        _resolver: {
          method:        local.method,
          confidence:    local.confidence,
          offering_id:   local.offering_id,
          provider_type: local.provider_type,
          bundle:        local.bundle ?? null,
          matched_term:  local.matched_term,
        },
      };
      return json(result);
    }

    // ── Low confidence → Claude with the resolver's candidates as context ─
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      // No Claude wired up — return whatever the resolver got, with a
      // gentle ask. Better than 500.
      return json({
        parsed:           merged,
        fits:             true,
        is_flexible_time: extras.flexible,
        next_step:        missing,
        bot_reply:        composeBotReply(merged, missing, local),
        quick_replies:    defaultQuickReplies(missing),
        switch_to_form:   false,
        _resolver:        { method: 'no_claude_fallback', confidence: local.confidence },
      });
    }

    // Build Claude input. Pass candidate offering names — these are way
    // more useful than just IDs to ground Claude's response.
    const candidateNames = (local.candidates ?? [])
      .map(id => (id && TAXONOMY_OFFERINGS_NAMES[id]) || null)
      .filter(Boolean);

    const userTurn = JSON.stringify({
      user_message:             userMessage,
      state:                    merged,
      attempts,
      is_repeat_user:           isRepeatUser,
      default_address:          defaultAddress,
      candidate_offerings:      local.candidates ?? [],
      candidate_offering_names: candidateNames,
    });

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:       MODEL,
        max_tokens:  400,
        temperature: 0.2,
        system:      SYSTEM_PROMPT,
        messages:    [{ role: 'user', content: userTurn }],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      // Soft fallback — return the resolver's best-effort if Claude can't
      // help. This keeps the chat moving even on Anthropic outages or
      // missing-credit errors.
      return json({
        parsed:           merged,
        fits:             true,
        is_flexible_time: extras.flexible,
        next_step:        missing,
        bot_reply:        composeBotReply(merged, missing, local),
        quick_replies:    defaultQuickReplies(missing),
        switch_to_form:   false,
        _resolver:        { method: 'claude_failed', confidence: local.confidence, anthropic_error: errText.slice(0, 200) },
      });
    }

    const anthropicJson = await anthropicResp.json();
    const text = (anthropicJson?.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();

    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(cleaned);
    } catch {
      // Claude returned junk — fall back to resolver result.
      return json({
        parsed:           merged,
        fits:             true,
        is_flexible_time: extras.flexible,
        next_step:        missing,
        bot_reply:        composeBotReply(merged, missing, local),
        quick_replies:    defaultQuickReplies(missing),
        switch_to_form:   false,
        _resolver:        { method: 'claude_invalid_json', confidence: local.confidence },
      });
    }

    const result = {
      parsed: {
        what:    parsedJson?.parsed?.what    ?? merged.what,
        when:    parsedJson?.parsed?.when    ?? merged.when,
        where:   parsedJson?.parsed?.where   ?? merged.where,
        budget:  parsedJson?.parsed?.budget  ?? merged.budget,
        details: parsedJson?.parsed?.details ?? merged.details,
      },
      fits:             parsedJson?.fits             !== false,
      is_flexible_time: parsedJson?.is_flexible_time ?? extras.flexible,
      next_step:        parsedJson?.next_step        ?? missing,
      bot_reply:        parsedJson?.bot_reply        ?? composeBotReply(merged, missing, local),
      quick_replies:    Array.isArray(parsedJson?.quick_replies) ? parsedJson.quick_replies.slice(0, 4) : defaultQuickReplies(missing),
      switch_to_form:   !!parsedJson?.switch_to_form,
      _resolver:        { method: 'claude', confidence: local.confidence, top_candidates: local.candidates },
      _usage:           anthropicJson?.usage ?? null,
    };
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// Small offering-id → name lookup, populated once at module init. Reads
// from the embedded TS taxonomy module (same one resolver.ts uses).
import { TAXONOMY as _TAX_FOR_NAMES } from './taxonomy.ts';
const TAXONOMY_OFFERINGS_NAMES: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(_TAX_FOR_NAMES.offering_master ?? {})) {
    out[k] = (v as any).name ?? '';
  }
  return out;
})();

// Log engine meta once on cold start so we can see it in supabase logs.
// eslint-disable-next-line no-console
console.log('[chat-parse] engine ready', ENGINE_META);
