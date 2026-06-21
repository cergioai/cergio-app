// Supabase Edge Function — create a Stripe PaymentIntent for a booking.
//
// Flow:
//   1. Caller (signed-in consumer) POSTs { bookingId }.
//   2. We verify the caller is the consumer on that booking.
//   3. We load the provider's stripe_account_id (must exist).
//   4. We create a PaymentIntent for booking.total_cents with:
//        - application_fee_amount = 10% (Cergio's cut)
//        - transfer_data.destination = provider's Connect account
//        - automatic_payment_methods enabled (handles cards + 3DS + wallets)
//        - metadata = { booking_id, consumer_id, provider_id }
//   5. Return { client_secret, payment_intent_id } for the frontend to confirm.
//
// Free Rainmaker bookings ($0 total) should NOT call this function — the
// frontend short-circuits and marks the booking confirmed directly.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';

const PLATFORM_FEE_BPS = 1000; // 10.00% — 1000 basis points

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
    const bookingId = body?.bookingId;
    if (!bookingId || typeof bookingId !== 'string') {
      return json({ error: 'bookingId required' }, 400);
    }

    // ── Load booking (service-role so RLS doesn't block us) ─────────────────
    const supaAdmin = createClient(supabaseUrl, serviceKey);
    const { data: booking, error: bookingErr } = await supaAdmin
      .from('bookings')
      .select('id, consumer_id, provider_id, total_cents, status, is_free_for_rainmaker')
      .eq('id', bookingId)
      .single();
    if (bookingErr || !booking) {
      return json({ error: 'Booking not found' }, 404);
    }

    // ── Authorization: only the consumer on this booking can pay for it ─────
    if (booking.consumer_id !== callerId) {
      return json({ error: 'You are not the consumer on this booking' }, 403);
    }

    // ── Guards: don't accept paid intents for free or already-paid bookings ─
    if (booking.is_free_for_rainmaker || (booking.total_cents ?? 0) === 0) {
      return json({ error: 'Free bookings should not create a PaymentIntent' }, 400);
    }
    if (booking.status !== 'pending') {
      return json({ error: `Booking already ${booking.status}` }, 409);
    }

    // ── Provider must have a Connect account on file ────────────────────────
    const { data: stripeAcct, error: stripeAcctErr } = await supaAdmin
      .from('stripe_accounts')
      .select('stripe_account_id, charges_enabled, payouts_enabled')
      .eq('profile_id', booking.provider_id)
      .maybeSingle();
    if (stripeAcctErr || !stripeAcct?.stripe_account_id) {
      return json({ error: 'Provider has not set up payouts yet' }, 422);
    }

    // ── Create the PaymentIntent ────────────────────────────────────────────
    const totalCents     = booking.total_cents;
    const platformFeeCents = Math.floor(totalCents * (PLATFORM_FEE_BPS / 10000));

    // SPEC-47g: HOLD_RELEASE_ENABLED gates the money model.
    //  • OFF (default): DESTINATION charge — provider paid instantly (legacy).
    //  • ON: SEPARATE charge — funds held on the PLATFORM under a transfer_group;
    //    the release-funds worker transfers the provider's share 3h after the
    //    job is marked complete (with the consumer-confirm guard). No
    //    transfer_data / application_fee here; the platform simply keeps the fee
    //    by transferring only the provider share at release time.
    const holdRelease =
      (Deno.env.get('HOLD_RELEASE_ENABLED') || '').toLowerCase() === 'true';
    const transferGroup = `booking_${booking.id}`;

    const pi = await stripe.paymentIntents.create({
      amount:   totalCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      ...(holdRelease
        ? { transfer_group: transferGroup }
        : {
            application_fee_amount: platformFeeCents,
            transfer_data: { destination: stripeAcct.stripe_account_id },
          }),
      metadata: {
        booking_id:  booking.id,
        consumer_id: booking.consumer_id,
        provider_id: booking.provider_id,
        hold_release: holdRelease ? 'true' : 'false',
        platform_fee_cents: String(platformFeeCents),
      },
    });

    // In held mode, stamp the transfer_group on the booking up front so the
    // release worker can find it (and so we never mistake an instant-mode
    // booking for a held one).
    if (holdRelease) {
      await supaAdmin
        .from('bookings')
        .update({ transfer_group: transferGroup })
        .eq('id', booking.id);
    }

    // ── Record the intent so we can correlate webhook events later ──────────
    // Upsert into payments — the webhook handler will flip status when
    // payment_intent.succeeded fires.
    await supaAdmin
      .from('payments')
      .upsert({
        booking_id:         booking.id,
        stripe_intent_id:   pi.id,
        amount_cents:       totalCents,
        platform_fee_cents: platformFeeCents,
        currency:           'USD',
        status:             pi.status,
      }, { onConflict: 'stripe_intent_id' });

    return json({
      client_secret:    pi.client_secret,
      payment_intent_id: pi.id,
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
