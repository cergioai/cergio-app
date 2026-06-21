// Supabase Edge Function — SPEC-47g release worker.
//
// Releases HELD booking funds to providers. A booking is eligible when:
//   • it was charged in held mode        (transfer_group IS NOT NULL)
//   • it hasn't been released            (released_at IS NULL, stripe_transfer_id IS NULL)
//   • the customer's charge is on file   (stripe_charge_id IS NOT NULL)
//   • the release window has elapsed      (release_due_at IS NOT NULL AND <= now)
//   • it isn't cancelled/refunded/disputed
//
// release_due_at is set by the app:
//   • markBookingComplete → completed_at + 3h, IF completed_at >= scheduled_at
//   • if completed before the scheduled start → release_requires_confirm=true and
//     NO release_due_at until the consumer confirms (confirmJobDone sets it).
//
// For each eligible booking we create a Stripe Transfer of the provider's share
// (total − 10% platform fee) to their connected account, sourced from the
// original charge, then stamp stripe_transfer_id + released_at and book the
// provider's earnings. Idempotent: the stripe_transfer_id guard + a Stripe
// idempotency key prevent any double payout.
//
// AUTH: caller must present the service-role key as a Bearer token (the cron
// job or the "Release Due Funds" launcher). Never exposed to the browser.
//
// Required secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';

const PLATFORM_FEE_BPS = 1000; // 10.00%
const BATCH = 100;

serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }
  try {
    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
    const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!stripeSecret) throw new Error('STRIPE_SECRET_KEY not set');

    // ── Auth: service-role bearer only ────────────────────────────────────────
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token || token !== serviceKey) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const stripe = new Stripe(stripeSecret, { apiVersion: '2024-06-20' });
    const db = createClient(supabaseUrl, serviceKey);

    // ── Find eligible bookings ────────────────────────────────────────────────
    const nowIso = new Date().toISOString();
    const { data: due, error: dueErr } = await db
      .from('bookings')
      .select('id, provider_id, total_cents, stripe_charge_id, transfer_group, status')
      .not('transfer_group', 'is', null)
      .is('stripe_transfer_id', null)
      .is('released_at', null)
      .not('stripe_charge_id', 'is', null)
      .not('release_due_at', 'is', null)
      .lte('release_due_at', nowIso)
      .not('status', 'in', '(cancelled,refunded,disputed)')
      .limit(BATCH);
    if (dueErr) throw dueErr;

    const results: Array<Record<string, unknown>> = [];
    for (const b of due ?? []) {
      try {
        const total = b.total_cents ?? 0;
        const fee = Math.floor(total * (PLATFORM_FEE_BPS / 10000));
        const providerShare = total - fee;
        if (providerShare <= 0) {
          await db.from('bookings').update({ release_error: 'non-positive share' }).eq('id', b.id);
          results.push({ id: b.id, skipped: 'non-positive share' });
          continue;
        }

        // Provider's connected account.
        const { data: acct } = await db
          .from('stripe_accounts')
          .select('stripe_account_id, payouts_enabled')
          .eq('profile_id', b.provider_id)
          .maybeSingle();
        if (!acct?.stripe_account_id) {
          await db.from('bookings').update({ release_error: 'provider has no connect account' }).eq('id', b.id);
          results.push({ id: b.id, skipped: 'no connect account' });
          continue;
        }

        // Create the transfer (idempotent on booking id so retries are safe).
        const transfer = await stripe.transfers.create(
          {
            amount: providerShare,
            currency: 'usd',
            destination: acct.stripe_account_id,
            transfer_group: b.transfer_group as string,
            source_transaction: b.stripe_charge_id as string,
            metadata: { booking_id: b.id, kind: 'booking_release' },
          },
          { idempotencyKey: `release_${b.id}` },
        );

        // Stamp the booking + book earnings (guarded against double-insert).
        await db
          .from('bookings')
          .update({
            stripe_transfer_id: transfer.id,
            released_at: new Date().toISOString(),
            release_error: null,
          })
          .eq('id', b.id)
          .is('stripe_transfer_id', null); // belt-and-suspenders idempotency

        const { data: existing } = await db
          .from('earnings')
          .select('id')
          .eq('source_id', b.id)
          .eq('kind', 'booking')
          .eq('profile_id', b.provider_id)
          .maybeSingle();
        if (!existing) {
          await db.from('earnings').insert({
            profile_id: b.provider_id,
            kind: 'booking',
            source_id: b.id,
            amount_cents: providerShare,
            currency: 'USD',
            status: 'cleared',
            meta: { stripe_transfer_id: transfer.id, app_fee_cents: fee, released: true },
          });
        }

        results.push({ id: b.id, transferred_cents: providerShare, transfer: transfer.id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.from('bookings').update({ release_error: msg.slice(0, 500) }).eq('id', b.id);
        results.push({ id: b.id, error: msg });
      }
    }

    return json({ checked: (due ?? []).length, released: results.filter(r => r.transfer).length, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
