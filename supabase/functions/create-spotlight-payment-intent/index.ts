// Supabase Edge Function — Stripe PaymentIntent for a spotlight request.
//
// Mirror of create-payment-intent but for the spotlight marketplace.
// Flow:
//   1. Caller (provider on a spotlight_request) POSTs { spotlightRequestId }.
//   2. We verify the caller IS the provider on that request.
//   3. Request must be status='accepted' AND paid_at IS NULL.
//   4. Connector must have a Stripe Connect account on file.
//   5. PaymentIntent at the agreed price (offered_price_cents || official_price_cents):
//        - application_fee_amount = 10% (Cergio's cut)
//        - transfer_data.destination = Connector's Connect account
//        - metadata = { spotlight_request_id, provider_id, connector_id, type: 'spotlight' }
//   6. We write payment_intent_id + platform_fee_cents back on the row so
//      the existing stripe-webhook (extended to detect type='spotlight')
//      can flip paid_at on payment_intent.succeeded.
//   7. Return { client_secret, payment_intent_id, amount_cents, platform_fee_cents }.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';

const PLATFORM_FEE_BPS = 1000; // 10.00% in basis points

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecret) throw new Error('STRIPE_SECRET_KEY not set');
    const stripe = new Stripe(stripeSecret, { apiVersion: '2024-06-20' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // ── Auth: identify the caller ───────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const supaUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);
    const callerId = userData.user.id;

    // ── Parse body ───────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({} as any));
    const requestId = body?.spotlightRequestId;
    if (!requestId || typeof requestId !== 'string') {
      return json({ error: 'spotlightRequestId required' }, 400);
    }

    // ── Load the spotlight request (service-role bypasses RLS) ──────────────
    const supaAdmin = createClient(supabaseUrl, serviceKey);
    const { data: sr, error: srErr } = await supaAdmin
      .from('spotlight_requests')
      .select('id, provider_id, connector_id, platform, official_price_cents, offered_price_cents, status, paid_at')
      .eq('id', requestId)
      .single();
    if (srErr || !sr) return json({ error: 'Spotlight request not found' }, 404);

    if (sr.provider_id !== callerId) {
      return json({ error: 'You are not the provider on this request' }, 403);
    }
    if (sr.status !== 'accepted') {
      return json({ error: `Request must be accepted to pay (current: ${sr.status})` }, 409);
    }
    if (sr.paid_at) {
      return json({ error: 'Already paid' }, 409);
    }

    // ── Resolve amount: counter price if set, else official ─────────────────
    const amountCents = sr.offered_price_cents ?? sr.official_price_cents;
    if (!amountCents || amountCents <= 0) {
      return json({ error: 'Invalid amount on request' }, 422);
    }
    const platformFeeCents = Math.floor(amountCents * (PLATFORM_FEE_BPS / 10000));

    // ── Connector must have a Connect account ───────────────────────────────
    const { data: stripeAcct, error: stripeAcctErr } = await supaAdmin
      .from('stripe_accounts')
      .select('stripe_account_id, charges_enabled, payouts_enabled')
      .eq('profile_id', sr.connector_id)
      .maybeSingle();
    if (stripeAcctErr || !stripeAcct?.stripe_account_id) {
      return json({ error: 'Connector has not set up payouts yet' }, 422);
    }

    // ── Create the PaymentIntent ────────────────────────────────────────────
    const pi = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      application_fee_amount: platformFeeCents,
      transfer_data: { destination: stripeAcct.stripe_account_id },
      metadata: {
        spotlight_request_id: sr.id,
        provider_id:          sr.provider_id,
        connector_id:         sr.connector_id,
        platform:             sr.platform,
        type:                 'spotlight',
      },
    });

    // ── Snapshot PI id + fee on the row so webhook can find us ──────────────
    await supaAdmin
      .from('spotlight_requests')
      .update({
        payment_intent_id:  pi.id,
        platform_fee_cents: platformFeeCents,
      })
      .eq('id', sr.id);

    return json({
      client_secret:      pi.client_secret,
      payment_intent_id:  pi.id,
      amount_cents:       amountCents,
      platform_fee_cents: platformFeeCents,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
