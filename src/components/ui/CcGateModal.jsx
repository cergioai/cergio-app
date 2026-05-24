// Identity-verification modal — collects a card via Stripe SetupIntent
// (no charge) to confirm the user is a real human before they can upload
// photos. Kept in its own component so HomeScreen + any future screen
// that wants the identity gate can drop it in.
//
// Flow:
//   1. Mount → ask edge function for SetupIntent client_secret.
//   2. Stripe Elements <SetupElement> renders, user enters card.
//   3. stripe.confirmSetup() → optimistic flip cc_verified_at → onVerified().
//   4. Real source of truth is the setup_intent.succeeded webhook (TODO),
//      but optimistic is fine here since no money is at stake.
import { useEffect, useMemo, useState } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { getStripe } from '../../lib/stripe';
import { createSetupIntent, markCcVerified } from '../../lib/api';

function SaveForm({ onVerified, onCancel }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);

    const { error: stripeError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (stripeError) {
      setError(stripeError.message || 'Could not verify card.');
      setBusy(false);
      return;
    }

    if (setupIntent && (setupIntent.status === 'succeeded' || setupIntent.status === 'processing')) {
      // Optimistic flip — webhook will canonically confirm.
      await markCcVerified();
      onVerified?.();
      return;
    }

    setError(`Unexpected setup state: ${setupIntent?.status ?? 'unknown'}`);
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
        {busy ? 'Verifying…' : 'Verify with card'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="w-full text-[13px] font-extrabold text-b3 py-2 disabled:opacity-50"
      >
        Maybe later
      </button>
    </form>
  );
}

export function CcGateModal({ onClose, onVerified }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [bootErr,      setBootErr]      = useState(null);
  const stripePromise = useMemo(() => getStripe(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await createSetupIntent();
      if (cancelled) return;
      if (error) {
        setBootErr(error.message || 'Could not start verification');
        return;
      }
      setClientSecret(data?.client_secret || null);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="fixed inset-0 z-[10003] bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-[390px] bg-white rounded-t-[24px] p-6 pb-7" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-5" />
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-gl mx-auto mb-4">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
               stroke="#3D8B00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="13" rx="2" />
            <path d="M2 11h20" />
            <path d="M6 16h4" />
          </svg>
        </div>
        <h2 className="text-[20px] font-extrabold text-black text-center leading-tight mb-2">
          Verify your identity to add photos
        </h2>
        <p className="text-[13px] text-b3 text-center leading-relaxed mb-5">
          We do a quick card check to keep fakes, spam, and inappropriate
          content off Cergio. <strong className="text-black">You won't be charged.</strong>{' '}
          We save the card on file for future bookings if you want — you can remove it anytime.
        </p>

        {bootErr && (
          <p className="text-[13px] text-danger font-bold mb-3">{bootErr}</p>
        )}
        {!bootErr && !clientSecret && (
          <p className="text-[13px] text-b3 mb-3">Loading…</p>
        )}
        {clientSecret && (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
            <SaveForm onVerified={onVerified} onCancel={onClose} />
          </Elements>
        )}
      </div>
    </div>
  );
}
