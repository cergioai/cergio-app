// Tells screens whether the signed-in user is allowed to list services or
// accept paid bookings. "Ready" = they have a Stripe Connect account on file
// AND Stripe says both charges_enabled and payouts_enabled are true.
//
// charges_enabled / payouts_enabled flip server-side via the
// account.updated webhook (Phase B.2), so a freshly-onboarded provider may
// see ready=false for a moment after returning from Stripe — call refresh()
// to re-poll. We also expose `hasAccount` so screens can distinguish "never
// started" from "started but Stripe is still verifying".
import { useCallback, useEffect, useState } from 'react';
import { getMyStripeAccount } from '../lib/api';

const INITIAL = { loading: true, ready: false, hasAccount: false, account: null };

export function useProviderReady(auth) {
  const [state, setState] = useState(INITIAL);

  const refresh = useCallback(async () => {
    if (!auth?.isSignedIn) {
      setState({ loading: false, ready: false, hasAccount: false, account: null });
      return;
    }
    setState(s => ({ ...s, loading: true }));
    const { data } = await getMyStripeAccount();
    setState({
      loading:    false,
      ready:      !!(data?.payouts_enabled && data?.charges_enabled),
      hasAccount: !!data?.stripe_account_id,
      account:    data || null,
    });
  }, [auth?.isSignedIn]);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...state, refresh };
}
