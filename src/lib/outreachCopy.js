// Founding outreach copy — the SINGLE client-side source for the /ops Campaign
// Composer's pre-filled templates. These mirror, verbatim, the copy the
// outreach-send edge function (SPEC-65/66/67/70) actually sends:
//   • Email subject/body   ← renderEmail / renderInfluencerEmail
//   • WhatsApp text         ← the ?wa=1 wa.me generator
// Kept in sync by hand because the edge fn runs on Deno and can't be imported
// into the Vite bundle. If you change the founding copy in outreach-send/index.ts,
// change it here too (and vice-versa). Increment 2 will POST the composed copy
// back through the gated sender rather than re-deriving it.
//
// Merge fields (resolved against a REAL sampled recipient in the composer):
//   {name}          business name / creator display name
//   {city}          lead city
//   {service_type}  service_type (services) or niche/category (creators)
//   {ig_handle}     creator IG handle (creators only)

// ── CREATORS (leads_influencers) ─────────────────────────────────────────────
// Source: renderInfluencerEmail() + the ?wa=1 creator message in outreach-send.
export const CREATOR_TEMPLATE = {
  subject: 'Founding creator — {city} (only 5)',
  body: [
    'Hi @{ig_handle},',
    '',
    "I'm Tarik, founder of Cergio — we turn friend recommendations into income.",
    '',
    'Your followers book trusted local pros through you, and you earn a referral fee on every booking — your income grows as your network grows.',
    '',
    "I'm hand-picking just 5 founding creators to launch {city}. You'd get free services from our top local providers, earnings on every booking your network drives, and founding-member status with first access as we open new cities.",
    '',
    '— Tarik, Cergio',
  ].join('\n'),
  // wa.me creator message (verbatim from ?wa=1). {optin} is appended by the
  // sender at send-time — not composed here.
  whatsapp: 'Hi @{ig_handle} — Tarik, founder of Cergio. Your followers book trusted local pros through you, and you earn on every booking — your income grows as your network grows. Hand-picking 5 founding creators in {city}: free services + founding status. Want the first spot?',
};

// ── SERVICES (leads_services) ────────────────────────────────────────────────
// Source: renderEmail() + the ?wa=1 / SMS business message in outreach-send.
export const SERVICE_TEMPLATE = {
  subject: 'Founding {service_type} — {city} (free creator spotlights)',
  body: [
    'Hi {name},',
    '',
    "I'm Tarik, founder of Cergio. We connect local creators with great providers.",
    '',
    'A vetted local creator will spotlight your {service_type} to their followers — new clients, zero ad spend — in exchange for one service.',
    '',
    "I'm selecting 25 founding {service_type}s in {city}. Founding members get free creator spotlights, priority (we drive the most bookings to our most-recommended founders), and a referral fee when you send clients to other, non-competing services.",
    '',
    '— Tarik, Cergio',
  ].join('\n'),
  whatsapp: 'Hi {name} — Tarik, founder of Cergio. Vetted local creators will spotlight your {service_type} to their followers, free — new clients, no ad spend. Picking 25 founding providers in {city}; founders get the most referrals. One service to one creator. Want a spot?',
};

export function outreachTemplateFor(audience) {
  return audience === 'services' ? SERVICE_TEMPLATE : CREATOR_TEMPLATE;
}

/** Resolve {merge} fields against a sampled recipient. Unfilled fields fall back
 *  to a readable placeholder so the preview never renders a raw "{token}". */
export function renderMergeFields(text, recipient = {}) {
  const fallback = {
    name:         recipient.name || 'there',
    city:         recipient.city || 'your city',
    service_type: recipient.service_type || 'service',
    ig_handle:    recipient.ig_handle || 'there',
  };
  return String(text || '').replace(/\{(name|city|service_type|ig_handle)\}/g, (_, k) => fallback[k]);
}
