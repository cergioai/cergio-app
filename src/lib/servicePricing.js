// src/lib/servicePricing.js — redesign handoff PR 4 (PATCHES.md §3).
//
// The viewer decides what a price says. A Local Creator sees free; everyone
// else sees the price — and can still submit a free request, which the
// provider accepts or declines on their profile.
//
// THE DISCOUNT IS SERVICE-WIDE: read `services.discount_pct` once and apply
// it to every offering — never store or compute a per-offering rate. The DB
// constraint (0 < pct <= 100) and the column comment both say so
// (20260805122000_service_pricing_flags.sql).

export function money(cents) {
  return `$${Math.round((cents ?? 0) / 100)}`;
}

export function priceForViewer(service, offering, viewerIsConnector) {
  if (service?.free_for_connectors && viewerIsConnector) {
    return { free: true, label: 'Free for Local Creators' };
  }
  const cents = offering?.price_cents ?? 0;
  const pct = Number(service?.discount_pct) || 0;
  if (pct > 0) {
    const now = Math.round(cents * (100 - pct) / 100);
    return {
      free: false,
      label: money(now),
      wasLabel: money(cents),          // struck through beside it
      pill: `${pct}% off`,
    };
  }
  return { free: false, label: money(cents) };
}
