// Central fee model. Matches the booking flow's 10% flat platform fee:
// provider pays a price → Cergio keeps PLATFORM_FEE_RATE → seller receives
// the rest. For spotlights the "seller" is the Connector and the buyer is
// the service provider. For bookings the seller is the service provider and
// the buyer is the consumer. Same math, different parties.
//
// When the fee rate changes, all NEW transactions use the new rate. Already
// accepted bookings/spotlights stay on the rate they were priced at — the
// snapshot lives on the row (booking total_cents, etc.).
export const PLATFORM_FEE_RATE = 0.10;

/** Cergio's cut of a price (in cents). Always rounded UP so we never under-collect. */
export function platformFeeCents(priceCents) {
  if (!Number.isFinite(+priceCents) || +priceCents <= 0) return 0;
  return Math.ceil(+priceCents * PLATFORM_FEE_RATE);
}

/** Seller (Connector / provider) earnings — what hits their payout. */
export function sellerEarningsCents(priceCents) {
  if (!Number.isFinite(+priceCents) || +priceCents <= 0) return 0;
  return +priceCents - platformFeeCents(priceCents);
}

/** Pretty-print a price in cents as "$X" or "$X.YZ". */
export function fmtDollars(cents) {
  if (cents == null) return null;
  const n = cents / 100;
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}
