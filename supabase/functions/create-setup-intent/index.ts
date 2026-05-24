// Supabase Edge Function — Stripe SetupIntent for CC identity verification.
//
// Why a SetupIntent (not PaymentIntent)? We aren't charging — we're just
// verifying the user has a working card on file. SetupIntent attaches a
// payment method to a Customer for future use; same anti-fraud signal as
// a charge (CVV + 3DS check) without the cost.
//
// Flow:
//   1. Signed-in user POSTs (no body).
//   2. We get-or-create the Stripe Customer (writes stripe_customer_id to profiles).
//   3. Create SetupIntent on that Customer with automatic_payment_methods.
//   4. Return { client_secret, customer_id } for the frontend.
//   5. Frontend uses Stripe Elements SetupElement → stripe.confirmSetup().
//   6. On success, frontend optimistically flips cc_verified_at via API
//      helper. (Future: setup_intent.succeeded webhook can be the canonical
//      flip — for now optimistic is fine since there's no money at stake.)
//
// Required Supabase secrets (already in place from booking flow):
//   STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';

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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const supaUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);

    const userId = userData.user.id;
    const email  = userData.user.email || undefined;

    // ── Get or create Stripe Customer ───────────────────────────────────────
    const supaAdmin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await supaAdmin
      .from('profiles')
      .select('stripe_customer_id, display_name')
      .eq('id', userId)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name:     profile?.display_name || undefined,
        metadata: { cergio_user_id: userId },
      });
      customerId = customer.id;
      await supaAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
    }

    // ── Create the SetupIntent ──────────────────────────────────────────────
    const si = await stripe.setupIntents.create({
      customer:                   customerId,
      automatic_payment_methods:  { enabled: true },
      usage:                      'off_session',
      metadata:                   { cergio_user_id: userId, purpose: 'identity_verification' },
    });

    return json({
      client_secret: si.client_secret,
      customer_id:   customerId,
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
