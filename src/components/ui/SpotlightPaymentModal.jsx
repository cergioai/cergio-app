// Stripe PaymentSheet for an accepted spotlight request. Parallel to
// PaymentSheet (which is for bookings) — same Elements machinery, different
// callbacks. On success the stripe-webhook flips spotlight_requests.paid_at
// and writes an earnings row; we also do an optimistic UI flip via
// onSuccess() so the user sees "Paid ✓" instantly without waiting on the
// webhook round-trip.
import { useEffect, useMemo, useState } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { getStripe } from '../../lib/stripe';
import { createSpotlightPaymentIntent } from '../../lib/api';
import { fmtDollars } from '../../lib/fees';

function PayForm({ onSuccess, onCancel, amountCents, connectorName }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);

    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (stripeError) {
      setError(stripeError.message || 'Payment failed.');
      setBusy(false);
      return;
    }

    if (paymentIntent && paymentIntent.status === 'succeeded') {
      // Optimistic — the webhook will canonically flip paid_at.
      onSuccess();
      return;
    }

    setError(`Unexpected payment state: ${paymentIntent?.status ?? 'unknown'}`);
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PaymentElement options={{ layout: 'tabs' }} />

      {error && (
        <p className="text-[13px] text-danger font-bold leading-relaxed">{error}</p>
      )}

      <button
        type="submit"
        disabled={!stripe || busy}
        className={`w-full rounded-[24px] py-4 text-[15px] font-extrabold transition-all
          ${stripe && !busy
            ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
            : 'bg-bg5 text-b3 cursor-not-allowed'}`}
      >
        {busy ? 'Processing…' : `Pay ${fmtDollars(amountCents)}`}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="w-full text-[13px] font-extrabold text-b3 py-2 disabled:opacity-50"
      >
        Cancel
      </button>
    </form>
  );
}

export function SpotlightPaymentModal({ spotlightRequestId, connectorName, onClose, onSuccess }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [amountCents,  setAmountCents]  = useState(null);
  const [feeCents,     setFeeCents]     = useState(null);
  const [bootErr,      setBootErr]      = useState(null);

  const stripePromise = useMemo(() => getStripe(), []);

  // On mount, ask the edge function for a PaymentIntent client_secret.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await createSpotlightPaymentIntent(spotlightRequestId);
      if (cancelled) return;
      if (error) {
        setBootErr(error.message || 'Could not start payment');
        return;
      }
      setClientSecret(data?.client_secret || null);
      setAmountCents(data?.amount_cents || null);
      setFeeCents(data?.platform_fee_cents || null);
    })();
    return () => { cancelled = true; };
  }, [spotlightRequestId]);

  return (
    <div className="fixed inset-0 z-[10002] bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 pb-7" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-4" />
        <h2 className="text-[20px] font-extrabold text-black leading-tight mb-1">
          Pay {connectorName || 'Connector'}
        </h2>
        {amountCents && (
          <p className="text-[12px] text-b3 mb-4 leading-relaxed">
            <strong className="text-black">{fmtDollars(amountCents)}</strong> total ·{' '}
            includes <strong className="text-black">{fmtDollars(feeCents || 0)}</strong> Cergio fee.
            Funds release to {connectorName || 'the Connector'} once the spotlight is posted.
          </p>
        )}

        {bootErr && (
          <p className="text-[13px] text-danger font-bold mb-3">{bootErr}</p>
        )}
        {!bootErr && !clientSecret && (
          <p className="text-[13px] text-b3 mb-3">Loading payment…</p>
        )}
        {clientSecret && (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
            <PayForm
              onSuccess={onSuccess}
              onCancel={onClose}
              amountCents={amountCents}
              connectorName={connectorName}
            />
          </Elements>
        )}
      </div>
    </div>
  );
}
