// Supabase Edge Function — Claude-powered chat parser.
//
// Turns a free-text user turn into structured Cergio intent:
//   - parsed fields (what / when / where / budget / details)
//   - whether the user's ask fits one of our categories
//   - the next bot question + quick replies
//   - a "switch to structured form" signal after repeated failures
//
// Model: claude-haiku-4-5 — Anthropic's cheapest tier. A typical turn
// uses ~700 input + 150 output tokens, which on Haiku pricing comes out
// to fractions of a cent. The $5 sign-up credit covers thousands of turns.
//
// Front-end calls this once per user turn. Holds an ANTHROPIC_API_KEY
// secret (never shipped to the browser).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = `You are CERGIO, a friendly AI booking assistant for a local-services marketplace.

Your single job: read the user's latest message and the current intake state, then emit STRICT JSON describing what you understood and what to ask next.

Required fields you collect from the user across the conversation:
1. what    — the service they need (free text, but you should map to one of our categories)
2. when    — when they want it (a specific date/time OR an open range like "any evening")
3. where   — an address or area
4. budget  — maximum price (optional — never block on this)
5. details — anything else helpful (optional)

Categories we support (loose match — synonyms ok; if a user asks for something close to one of these, map it):
Cleaning, Housekeeping, Deep Clean, Handyman, TV Mounting, Furniture Assembly,
IKEA Assembly, Repair, Installation, Plumbing, Electrical, HVAC,
Nail Art, Beauty, Hair, Makeup, Massage, Barber, Spray Tan,
Personal Training, Yoga, Pilates, Coaching, Wellness Coaching,
Catering, Cooking, Private Chef, Bartending, Wedding Bundle,
Wedding Planning, Event Coordination, Party Planning, DJ, Photography, Videography,
Tutoring, Music Lessons, Piano Lessons, Guitar Lessons, Language Tutoring,
Gardening, Lawn Care, Landscaping, Painting, Moving,
Pet Care, Cat Sitting, Dog Walking, Dog Boarding, Pet Boarding, Pet Grooming,
Childcare, Babysitting, Nanny,
Personal Assistant, Concierge, Errand Running,
Driver, Chauffeur, Airport Pickup.

If the request is in the neighborhood of any of these (e.g. "I need someone to watch
my cat", "drive me to JFK", "pick up groceries for my mom"), set fits=true and pick
the closest category. Only set fits=false for things clearly outside our scope
(legal advice, medical care, financial advice, prescription drugs, weapons).

Hard rules:
- Output ONLY valid JSON. No markdown, no commentary, no leading/trailing text.
- Update parsed fields based on the user's latest message + prior state. Carry prior values forward; only overwrite when the user gives new info.
- "fits" = does what they want plausibly map to one of our categories? true/false.
- "is_flexible_time": null until WHEN is captured, then null if you can't tell, true if user said anything like "flexible / any / open / whenever", false if they gave a fixed time.
- WHEN accepts ANY temporal hint: specific dates ("Jan 15"), months ("January", "next March"), date ranges ("start Nov for a Jan wedding"), relative ("tomorrow", "next week"), open-ended ("any evening", "this winter", "before Christmas"). Whatever the user gives is acceptable as a captured value — don't keep asking for clarification once they've named a time.
- WHERE accepts addresses with or without standard street suffixes. "5701 Collins Ave Miami", "1145 Broadway", "my apartment in Brooklyn", "Williamsburg neighborhood" are all valid where-values.
- "next_step": one of "what" | "when" | "flexible_check" | "budget" | "where" | "details" | "done". Skip "flexible_check" if you already have is_flexible_time. Skip "budget" / "details" if the user clearly waved them off ("no max", "skip"). End at "done" when what + when + where are captured.
- "bot_reply": short, warm, 1–2 sentences max. Acknowledge what was just captured with ✓ checks, then ask the next thing. Mirror Cergio's voice: friendly, brief, no sales-y filler.
- "quick_replies": 0–4 short chips the user can tap as canned answers for the next step. Always include "Skip →" when the next step is optional.
- "switch_to_form": set true if the user has tried twice to provide a step and the answer is still nonsense or off-topic. Otherwise false.
- If the request doesn't fit (fits=false), bot_reply should politely say so and offer to refine or switch to the form.

JSON schema (every field required):
{
  "parsed": { "what": string|null, "when": string|null, "where": string|null, "budget": string|null, "details": string|null },
  "fits": boolean,
  "is_flexible_time": boolean|null,
  "next_step": "what"|"when"|"flexible_check"|"budget"|"where"|"details"|"done",
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
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const body = await req.json().catch(() => ({} as any));
    const userMessage   = String(body?.user_message ?? '').slice(0, 1000);
    const state         = body?.state ?? {};
    const attempts      = body?.attempts ?? {};
    const isRepeatUser  = !!body?.is_repeat_user;
    const defaultAddress = body?.default_address ?? null;

    if (!userMessage.trim()) {
      return json({ error: 'user_message required' }, 400);
    }

    // The user "turn" we hand to Claude — compact, structured, single message.
    const userTurn = JSON.stringify({
      user_message: userMessage,
      state,
      attempts,
      is_repeat_user: isRepeatUser,
      default_address: defaultAddress,
    });

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userTurn }],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      return json({ error: `anthropic ${anthropicResp.status}: ${errText.slice(0, 500)}` }, 502);
    }

    const anthropicJson = await anthropicResp.json();
    // Anthropic returns { content: [{ type:'text', text: '...' }, ...] }
    const text = (anthropicJson?.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();

    // Strip any accidental markdown fences (Haiku rarely adds them with our
    // system prompt, but be defensive).
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return json({
        error: 'claude_returned_invalid_json',
        raw:   text.slice(0, 500),
      }, 502);
    }

    // Defensive defaults so the frontend never has to null-check every field.
    const result = {
      parsed: {
        what:    parsed?.parsed?.what    ?? state?.what    ?? null,
        when:    parsed?.parsed?.when    ?? state?.when    ?? null,
        where:   parsed?.parsed?.where   ?? state?.where   ?? null,
        budget:  parsed?.parsed?.budget  ?? state?.budget  ?? null,
        details: parsed?.parsed?.details ?? state?.details ?? null,
      },
      fits:              parsed?.fits             !== false,
      is_flexible_time:  parsed?.is_flexible_time ?? null,
      next_step:         parsed?.next_step        ?? 'what',
      bot_reply:         parsed?.bot_reply        ?? 'Got it.',
      quick_replies:     Array.isArray(parsed?.quick_replies) ? parsed.quick_replies.slice(0, 4) : [],
      switch_to_form:    !!parsed?.switch_to_form,
      _usage:            anthropicJson?.usage ?? null,
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
