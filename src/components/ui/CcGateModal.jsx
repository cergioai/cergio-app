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
      // Stripe codes that mean "card rejected" vs. "try again" vs. "bad input".
      const code = stripeError.code || '';
      const isDeclined = /card_declined|insufficient_funds|do_not_honor|lost_card|stolen_card/i.test(code);
      const hint = isDeclined
        ? 'Your card was declined. Try a different card or tap "Maybe later" to skip for now.'
        : (stripeError.message || 'Could not verify card. Please try again.');
      setError(hint);
      setBusy(false);
      return;
    }

    if (setupIntent && (setupIntent.status === 'succeeded' || setupIntent.status === 'processing')) {
      // Optimistic flip — webhook will canonically confirm.
      await markCcVerified();
      onVerified?.();
      return;
    }

    // requires_action or other non-terminal states — Stripe may need 3DS.
    if (setupIntent?.status === 'requires_action') {
      setError('Your bank requires extra verification. Please complete it in the window that appeared, then try again.');
    } else {
      setError(`Unexpected setup state: ${setupIntent?.status ?? 'unknown'}. Try again or tap "Maybe later".`);
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PaymentElement options={{ layout: 'tabs' }} />

      {error && (
        <p className="text-body-sm text-danger font-extrabold leading-relaxed">{error}</p>
      )}

      <button
        type="submit"
        disabled={!stripe || busy}
        className={`w-full rounded-[24px] py-4 text-[15px] font-extrabold transition-all
          ${stripe && !busy
            ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
            : 'bg-bg5 text-b3 cursor-not-allowed'}`}
      >
        {busy ? 'Verifying…' : error ? 'Try again' : 'Verify with card'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="w-full text-body-sm font-extrabold text-b3 py-2 disabled:opacity-50"
      >
        Maybe later
      </button>
    </form>
  );
}

// CERGIO-GUARD (2026-06-05 v2): reason-aware identity gate. Tarik —
// "gate the user and services request with a Credit Card addition
// after submission, to verify identity (your card won't be charged.
// We need to verify your identity before connecting you with our
// services and or connectors) to avoid bad content spam etc."
//
// reason values:
//   'request'  — surfaced after submitting a user service request
//   'listing'  — surfaced after submitting a service listing
//   'photos'   — legacy: photo upload on Home (kept for backwards compat)
const REASON_COPY = {
  request: {
    title: 'Quick identity check',
    body:  "We need to verify your identity before connecting you with our services and Connectors. It helps us keep spam and bad content off Cergio.",
  },
  listing: {
    title: 'Quick identity check',
    body:  "We need to verify your identity before publishing your listing and connecting you with users. It helps us keep spam and bad content off Cergio.",
  },
  photos: {
    title: 'Verify your identity to add photos',
    body:  "A quick card check keeps fakes, spam, and inappropriate content off Cergio.",
  },
  post: {
    title: 'Verify your identity to post',
    body:  "Before your spotlight goes live we need to confirm you're a real person. It keeps spam and fake posts off Cergio.",
  },
};

export function CcGateModal({ onClose, onVerified, reason = 'photos' }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [bootErr,      setBootErr]      = useState(null);
  const stripePromise = useMemo(() => getStripe(), []);
  const copy = REASON_COPY[reason] || REASON_COPY.photos;

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
          {copy.title}
        </h2>
        <p className="text-body-sm text-b3 text-center leading-relaxed mb-2">
          <strong className="text-black">Your card won&apos;t be charged.</strong>{' '}
          {copy.body}
        </p>
        <p className="text-[11.5px] text-b3 text-center leading-snug mb-5">
          The card stays on file for future bookings if you want — remove it
          anytime in Profile.
        </p>

        {bootErr && (
          <p className="text-body-sm text-danger font-extrabold mb-3">{bootErr}</p>
        )}
        {!bootErr && !clientSecret && (
          <p className="text-body-sm text-b3 mb-3">Loading…</p>
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
