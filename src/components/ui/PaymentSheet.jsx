// Stripe payment modal — opens after consumer taps Book on a paid service.
// Receives a PaymentIntent client_secret from the create-payment-intent edge
// function, renders Stripe's PaymentElement (cards + wallets + 3DS handled
// automatically), and on success flips the booking row to 'confirmed'.
//
// Phase B.1: client-side confirmation. The webhook in Phase B.2 will
// reconcile any bookings where the user closed the tab mid-payment.
import { useEffect, useMemo, useState } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { getStripe } from '../../lib/stripe';
import { updateBookingStatus } from '../../lib/api';

// Inner form — must live inside <Elements> so it can use Stripe hooks.
function PayForm({ bookingId, onSuccess, onCancel, totalCents, providerName }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);

    // Confirm without redirecting. If 3DS or another auth method needs a
    // redirect, Stripe will tell us via `error.type === 'redirect_required'`
    // and we'd need to fall back to `return_url`. For card-only test runs
    // this `if_required` path keeps everything inline.
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
      // Client-side optimistic confirmation. Webhook (Phase B.2) is the
      // authoritative source — this flip just gives instant UX feedback.
      await updateBookingStatus(bookingId, 'confirmed');
      onSuccess();
      return;
    }

    setError(`Unexpected payment state: ${paymentIntent?.status ?? 'unknown'}`);
    setBusy(false);
  };

  const totalLabel = `$${(totalCents / 100).toFixed(2)}`;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PaymentElement options={{ layout: 'tabs' }} />

      {error && (
        <p className="text-body-sm text-danger font-extrabold leading-relaxed">{error}</p>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || busy}
        className={`w-full rounded-[24px] py-4 text-[15px] font-extrabold transition-all
          ${busy
            ? 'bg-bg5 text-b3 cursor-not-allowed'
            : 'bg-g text-white hover:opacity-90 active:scale-[.97]'}`}
      >
        {busy ? 'Processing…' : `Pay ${totalLabel} to ${providerName}`}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="text-center text-body font-extrabold text-b3 disabled:opacity-50"
      >
        Cancel
      </button>
    </form>
  );
}

export function PaymentSheet({ clientSecret, bookingId, totalCents, providerName, onSuccess, onClose }) {
  // loadStripe is cached at module level so this only fetches once per app load.
  const stripePromise = useMemo(() => getStripe(), []);
  const [stripeLoaded, setStripeLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    stripePromise.then(s => { if (!cancelled) setStripeLoaded(!!s); });
    return () => { cancelled = true; };
  }, [stripePromise]);

  if (!clientSecret) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/40 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 pb-8 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-4" />
        <h2 className="text-[20px] font-extrabold text-black mb-1">Confirm your booking</h2>
        <p className="text-body-sm text-b3 mb-5">
          {providerName} · ${(totalCents / 100).toFixed(2)} total
        </p>

        {!stripeLoaded ? (
          <p className="text-body-sm text-b3 text-center py-6">Loading payment form…</p>
        ) : (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: { theme: 'stripe', variables: { colorPrimary: '#4AA901' } },
            }}
          >
            <PayForm
              bookingId={bookingId}
              totalCents={totalCents}
              providerName={providerName}
              onSuccess={onSuccess}
              onCancel={onClose}
            />
          </Elements>
        )}
      </div>
    </div>
  );
}
