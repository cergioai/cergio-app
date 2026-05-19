// Singleton loader for Stripe.js. Cached so we only ever pull the script
// from Stripe's CDN once per app load.
import { loadStripe } from '@stripe/stripe-js';

const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

let stripePromise = null;

export function getStripe() {
  if (!key) {
    // eslint-disable-next-line no-console
    console.warn('[stripe] VITE_STRIPE_PUBLISHABLE_KEY is missing — payments are disabled.');
    return Promise.resolve(null);
  }
  if (!stripePromise) {
    stripePromise = loadStripe(key);
  }
  return stripePromise;
}

export const stripeReady = !!key;
