// Ranking helper for the Results / SRP page.
//
// Per Tarik (2026-06-02): "the rank priority is
//   1 — highest match of friend recos + free (if free is requested)
//   2 — if no free is requested, rank based on highest friend recos +
//       within budget, then Connector recos + within budget
//   Prioritize friend connections OVER budget for Cergio's pick — i.e.
//     show friend-recommended service Out of Budget, AHEAD of a service
//     that has NO friend connections.
//   BUT: if a service has ≥1 friend reco + within budget, it ranks
//     HIGHER than a service with more friend recos but over budget."
//
// So the tier hierarchy reads (highest first):
//
//   T1   friend_recos >= 1   AND  within_budget
//   T2   friend_recos >= 1   AND  NOT within_budget
//   T3   connector_recos >= 1 AND within_budget
//   T4   connector_recos >= 1 AND NOT within_budget
//   T5   no recos              AND within_budget
//   T6   everything else
//
// Within a tier, sort by reco count DESC, then rating DESC, then price ASC
// (cheapest first — useful tiebreaker once recos + budget are equal).
//
// When `wantFree=true` (user toggled "Free for Connectors"):
//   • Free services come BEFORE paid ones, full stop.
//   • Within free, the same T1..T6 tiering applies (with "within budget"
//     trivially true for free services since price = 0).
//   • Paid options follow as a fallback band so the page is never empty,
//     but they sit below all free ones regardless of recos.
//
// The first item after ranking becomes the "Cergio's Pick" (the photo-
// overlay green badge). Pure function — no React, no Supabase, no side
// effects. Easy to unit-test.

/**
 * @typedef {Object} RankInput
 * @property {number} [budgetCents]       Total budget in cents (paid path).
 *                                        null/undefined → budget check skipped
 *                                        (everything counts as "within budget").
 * @property {boolean} [wantFree]         True if user toggled Free for Connectors.
 * @property {Object} [opts]              Reserved for future weight tuning.
 *
 * Each service row must expose:
 *   priceCents     — number, cents (use 0 for free)
 *   friendCount    — number of friend-bucket recommenders
 *   connectorCount — number of Connector-bucket recommenders
 *   rating         — optional 0..5 average rating (default 0)
 *   distance_miles — optional, used as final tiebreaker (nearer wins)
 */

const TIER_T1 = 1;
const TIER_T2 = 2;
const TIER_T3 = 3;
const TIER_T4 = 4;
const TIER_T5 = 5;
const TIER_T6 = 6;

export function classifyTier(s, { budgetCents, wantFree } = {}) {
  const price          = Number.isFinite(s?.priceCents)  ? s.priceCents  : 0;
  const friendCount    = Number(s?.friendCount    || 0);
  const connectorCount = Number(s?.connectorCount || 0);
  const isFree         = price === 0;
  const withinBudget   = budgetCents == null || price <= budgetCents;

  // wantFree: free comes first. Paid services get demoted to a "below
  // everything else" band so the page renders free-first.
  if (wantFree && !isFree) {
    // Bottom band — keep relative order via reco count.
    if (friendCount    > 0) return TIER_T6 + 1;
    if (connectorCount > 0) return TIER_T6 + 2;
    return TIER_T6 + 3;
  }

  if (friendCount    > 0 &&  withinBudget) return TIER_T1;
  if (friendCount    > 0 && !withinBudget) return TIER_T2;
  if (connectorCount > 0 &&  withinBudget) return TIER_T3;
  if (connectorCount > 0 && !withinBudget) return TIER_T4;
  if (withinBudget)                         return TIER_T5;
  return TIER_T6;
}

/** Stable comparator for two services already in the same tier. */
function compareWithinTier(a, b) {
  const fc = Number(b.friendCount    || 0) - Number(a.friendCount    || 0);
  if (fc !== 0) return fc;
  const cc = Number(b.connectorCount || 0) - Number(a.connectorCount || 0);
  if (cc !== 0) return cc;
  const rt = Number(b.rating || 0) - Number(a.rating || 0);
  if (rt !== 0) return rt;
  // Cheapest first, useful when budgets are tight + recos tied.
  const pr = Number(a.priceCents || 0) - Number(b.priceCents || 0);
  if (pr !== 0) return pr;
  // Closest distance breaks any remaining ties.
  return Number(a.distance_miles || 9e9) - Number(b.distance_miles || 9e9);
}

/**
 * Rank a list of provider rows per Tarik's spec.
 * Returns a NEW array (does not mutate input). The first element of the
 * returned array is the "Cergio's Pick" — the caller is expected to set
 * the `pick` flag on the first row only.
 */
export function rankResults(services, { budgetCents = null, wantFree = false } = {}) {
  if (!Array.isArray(services)) return [];
  // Decorate each row with its tier so the sort is deterministic.
  const decorated = services.map(s => ({
    s,
    tier: classifyTier(s, { budgetCents, wantFree }),
  }));
  decorated.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return compareWithinTier(a.s, b.s);
  });
  return decorated.map(d => d.s);
}

/** Stamp the `pick` flag on the first item only. Mutates in-place to
 *  match the existing ResultsScreen convention. */
export function applyPickFlag(ranked) {
  ranked.forEach((p, i) => { p.pick = i === 0; });
  return ranked;
}
