// Supabase Edge Function — Stripe webhook receiver.
//
// Configured in Stripe Dashboard → Developers → Webhooks → Add endpoint:
//   URL:     https://<project-ref>.functions.supabase.co/stripe-webhook
//   Events:  payment_intent.succeeded
//            payment_intent.payment_failed
//            account.updated
//
// Stripe POSTs each event here with a signature header. We verify the
// signature using STRIPE_WEBHOOK_SECRET (whsec_…) and act on three event
// types:
//
//   payment_intent.succeeded
//     → flip bookings.status to 'confirmed' (safety net for clients that
//        closed the tab mid-payment)
//     → flip payments.status to 'succeeded'
//     → insert an earnings ledger row for the provider's share
//
//   payment_intent.payment_failed
//     → flip bookings.status to 'cancelled'
//     → flip payments.status to 'failed'
//
//   account.updated  (Connect account onboarding progress changes)
//     → sync charges_enabled / payouts_enabled / onboarding_complete onto
//        our stripe_accounts mirror table

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';

serve(async (req: Request) => {
  // No CORS needed — Stripe calls server-to-server.
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecret) throw new Error('STRIPE_SECRET_KEY not set');

    // Stripe Connect: payment_intent.* events come through the "Your account"
    // destination, account.updated for connected accounts comes through the
    // "Connected accounts" destination. Each destination has its own signing
    // secret. We try both — whichever matches wins.
    const secretPlatform = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    const secretConnect  = Deno.env.get('STRIPE_WEBHOOK_SECRET_CONNECT');
    if (!secretPlatform && !secretConnect) {
      throw new Error('No webhook secret configured (set STRIPE_WEBHOOK_SECRET and/or STRIPE_WEBHOOK_SECRET_CONNECT)');
    }

    const stripe = new Stripe(stripeSecret, { apiVersion: '2024-06-20' });

    // ── Verify the Stripe signature ─────────────────────────────────────────
    // Must use the RAW body bytes, not a parsed object. Try each configured
    // secret; the first that verifies wins.
    const sig     = req.headers.get('stripe-signature') ?? '';
    const rawBody = await req.text();

    const trySecrets = [secretPlatform, secretConnect].filter(Boolean) as string[];
    let event: Stripe.Event | null = null;
    let lastError: unknown = null;
    for (const secret of trySecrets) {
      try {
        event = await stripe.webhooks.constructEventAsync(rawBody, sig, secret);
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!event) {
      const msg = lastError instanceof Error ? lastError.message : String(lastError);
      return new Response(`Signature verification failed: ${msg}`, { status: 400 });
    }

    // ── Service-role Supabase client (writes bypass RLS) ────────────────────
    const supaAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Handle the event ────────────────────────────────────────────────────
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const bookingId = pi.metadata?.booking_id;
        const providerId = pi.metadata?.provider_id;
        if (!bookingId) break; // not one of ours

        // Flip booking → confirmed (idempotent).
        await supaAdmin
          .from('bookings')
          .update({ status: 'confirmed' })
          .eq('id', bookingId)
          .neq('status', 'cancelled');

        // Flip payment → succeeded.
        await supaAdmin
          .from('payments')
          .update({ status: 'succeeded' })
          .eq('stripe_intent_id', pi.id);

        // Record the provider's earnings (after our platform fee, before
        // Stripe's processing fee — Stripe deducts that from the destination
        // automatically). Insert ledger row idempotently: stripe intent id
        // doubles as the natural source_id.
        const appFeeCents = (pi.application_fee_amount ?? 0);
        const providerShare = (pi.amount ?? 0) - appFeeCents;
        if (providerId && providerShare > 0) {
          const { data: existing } = await supaAdmin
            .from('earnings')
            .select('id')
            .eq('source_id', bookingId)
            .eq('kind', 'booking')
            .eq('profile_id', providerId)
            .maybeSingle();
          if (!existing) {
            await supaAdmin.from('earnings').insert({
              profile_id:   providerId,
              kind:         'booking',
              source_id:    bookingId,
              amount_cents: providerShare,
              currency:     pi.currency?.toUpperCase() || 'USD',
              status:       'cleared',
              meta:         { stripe_intent_id: pi.id, app_fee_cents: appFeeCents },
            });
          }
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const bookingId = pi.metadata?.booking_id;
        if (!bookingId) break;

        await supaAdmin
          .from('bookings')
          .update({ status: 'cancelled' })
          .eq('id', bookingId)
          .eq('status', 'pending');

        await supaAdmin
          .from('payments')
          .update({ status: 'failed' })
          .eq('stripe_intent_id', pi.id);
        break;
      }

      case 'account.updated': {
        const acct = event.data.object as Stripe.Account;
        await supaAdmin
          .from('stripe_accounts')
          .update({
            charges_enabled:     !!acct.charges_enabled,
            payouts_enabled:     !!acct.payouts_enabled,
            onboarding_complete: !!(acct.details_submitted),
          })
          .eq('stripe_account_id', acct.id);
        break;
      }

      // Other events fall through silently; Stripe wants us to 200 them.
      default:
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status:  200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`Webhook handler error: ${msg}`, { status: 500 });
  }
});
