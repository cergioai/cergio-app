// Supabase Edge Function — provider onboarding for Stripe Connect.
// Creates an Express account if one doesn't exist, then returns a hosted
// onboarding link the frontend can open in a new tab.
//
// Deploy:
//   supabase functions deploy stripe-connect-onboard
// Required secrets (set via `supabase secrets set`):
//   STRIPE_SECRET_KEY            sk_test_… or sk_live_…
//   SUPABASE_URL                 (auto-populated for deployed functions)
//   SUPABASE_ANON_KEY            (auto-populated)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-populated)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';

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

    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
    const anonKey      = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Auth as the calling user so we know who they are.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401);
    }
    const supaUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: 'Not signed in' }, 401);
    }
    const user   = userData.user;
    const userId = user.id;
    const email  = user.email ?? undefined;

    // Service-role client to read/write the stripe_accounts table (bypasses RLS).
    const supaAdmin = createClient(supabaseUrl, serviceKey);

    // Reuse existing Connect account if we already created one.
    const { data: existing } = await supaAdmin
      .from('stripe_accounts')
      .select('stripe_account_id')
      .eq('profile_id', userId)
      .maybeSingle();

    let accountId: string;
    if (existing?.stripe_account_id) {
      accountId = existing.stripe_account_id;
    } else {
      const account = await stripe.accounts.create({
        type:  'express',
        email,
        capabilities: {
          transfers:     { requested: true },
          card_payments: { requested: true },
        },
        business_type: 'individual',
        metadata: { cergio_profile_id: userId },
      });
      accountId = account.id;

      await supaAdmin.from('stripe_accounts').insert({
        profile_id:        userId,
        stripe_account_id: accountId,
        account_kind:      'express',
      });
    }

    // Build the redirect URLs back to the app.
    const body  = await req.json().catch(() => ({} as any));
    const origin = req.headers.get('origin') || 'http://localhost:5173';
    const returnUrl  = body?.return_url  || `${origin}/profile?stripe=done`;
    const refreshUrl = body?.refresh_url || `${origin}/profile?stripe=refresh`;

    const link = await stripe.accountLinks.create({
      account:      accountId,
      refresh_url:  refreshUrl,
      return_url:   returnUrl,
      type:         'account_onboarding',
    });

    return json({ url: link.url, account_id: accountId });
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
