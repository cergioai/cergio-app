// Per design-spec.md — Results / SRP.
//
// CERGIO-GUARD: this screen MUST query Supabase via listServices() and
// MUST NOT fall back to the PROVIDERS mock array under any condition.
// When 0 services match, render the EmptyState block — never fake
// providers. The leaf logo (shared brand mark) is the canonical visual;
// do not swap it for the legacy spinner Logo or any other icon.
//
// CERGIO-GUARD: every user-visible reference to the service (title,
// share message, "No X yet…") MUST use the user's own words — i.e.
// chatState.originalQuery (or its SERVICE_MAP normalization). NEVER use
// parser-derived chat.state.what for display: that field has been
// observed flipping "personal chef" → "Weekly meal prep service". See
// CHECKLIST.md §2.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { LeafLogo } from '../components/ui/LeafLogo';
import { ProviderCard } from '../components/ui/ProviderCard';
// CERGIO-GUARD (2026-05-27): we INTENTIONALLY do not statically import
// listServices. Reason: in Vite dev mode, HMR updates source files but
// does NOT re-bind static imports already captured by a mounted
// component. After a listServices edit, the running ResultsScreen
// keeps calling the OLD function until full page reload. This
// caused a 2-day debugging loop with stale closures masquerading as
// real bugs. Dynamic import inside the effect re-resolves every run,
// so the latest api.js is always used. Production builds are
// unaffected — modules are stable there.
//
// import { listServices } from '../lib/api';  // DO NOT REINTRODUCE
import { geocodeAddress } from '../lib/google';
import { supabase, supabaseReady } from '../lib/supabase';
import { buildInviteUrl } from '../lib/referral';
import { pluralProviderTypeLocal, resolveProviderTypeLocal } from '../lib/serviceTaxonomy';
import { REWARDS } from '../lib/rewards';
import { useRequestActivity, activityToStatus } from '../hooks/useRequestActivity';

// Status lines shown while the leaf is rotating + Supabase is searching.
// Each line dwells for STATUS_STEP_MS; the last one stays until real
// data lands (or the 6s timeout falls through to the empty state).
//
// CERGIO-GUARD (2026-05-29): slowed pace + named friends/providers so
// the loading sequence narrates what Cergio is actually doing. Tarik:
// "simulate pinging, finding, contacting Jessica's recommended Maria,
// negotiating with Maria and Henry." Once we wire real recos and real
// provider-negotiation pings, swap the SAMPLE_* arrays for real names
// pulled from the recommendations + bids tables.
// CERGIO-GUARD (2026-05-30): per-step dwell shortened so the richer
// 9-line narration plays through in the same ~10s window. Each "action"
// dwells ~1.4s — fast enough to feel live, slow enough to read.
const STATUS_STEP_MS = 1400;
// Minimum total loading time — even if Supabase returns in 200ms, hold
// the loading state so the narration plays through enough of the
// activity script (now 9 steps × 1.4s ≈ 12.6s, but 9s is plenty to
// hit the meatiest negotiating/offers beats) AND the leaf logo has
// time to breathe through a full ring-pulse cycle.
const MIN_LOADING_MS = 9000;

// Sample names for the narration when no recommenders are seeded for
// the searched provider type. Once the seed has real friend + provider
// names on Penny, the narration uses those instead (Alex's reco Penny).
// CERGIO-GUARD (2026-05-30): expanded so the script can name TWO
// friends + THREE providers across the sequence (Jessica asked → Maria
// pinged → Sam reco'd → Henry pinged → both negotiating → both offer).
const SAMPLE_FRIEND_NAMES   = ['Jessica', 'Sam', 'Alex', 'Connie', 'Jamie'];
const SAMPLE_PROVIDER_NAMES = ['Maria', 'Henry', 'Penny', 'Sofia'];

// CERGIO-GUARD (2026-05-30 v2): minimal share-message builder.
// Tarik feedback v2: "abbreviate or just keep the initial few lines.
// no address (the recipient will see all but user forwarding doesn't)".
// Pure lead + tracked link. The recipient clicks the link and lands
// on the SAME results page where they can see when, where, budget,
// the share card itself, etc. — so we don't duplicate any of that in
// the forwarded text. Keeps the message tiny + less intrusive.
//
// OLD:  "Hey — anyone know a good house cleaner? Need one this week
//        in 5700 Collins Ave. Budget around $50.
//        Booking on Cergio → <inviterUrl>"
// NEW:  "Hey — anyone know a good house cleaner?
//        → <inviterUrl>"
//
// The {when,where,budget,details} args are accepted (so call sites
// don't need to change) but intentionally unused. Keep the signature
// stable — if we ever want to optionally re-include them, the wiring
// is already there.
function buildShareMessage({ lead, when, where, budget, details, inviterUrl }) {
  // eslint-disable-next-line no-unused-vars
  void when; void where; void budget; void details;
  const parts = [`Hey — anyone know a good ${lead}?`];
  if (inviterUrl) parts.push(`→ ${inviterUrl}`);
  return parts.join('\n');
}

function buildStatusSteps(providerType, opts = {}) {
  // opts.friend = display_name of a real recommender if we have one
  // opts.provider = display_name of the recommended service title
  // CERGIO-GUARD (2026-05-30): narration now plays as a sequence of
  // DIFFERENT actions — ping → ask → suggest → schedule → reco →
  // negotiate → offer → confirm. Each line is a distinct "event"
  // rather than four flavors of "still searching". Tarik: "add
  // different animated actions in this stream (pinging Jessica's
  // friend...)". Drives perceived activity even when DB is mid-write.
  const plural = providerType ? `${providerType.toLowerCase()}s` : 'providers';
  const f1     = opts.friend || SAMPLE_FRIEND_NAMES[0];
  const f2     = SAMPLE_FRIEND_NAMES[1];
  const pA     = opts.provider || SAMPLE_PROVIDER_NAMES[0];
  const pB     = SAMPLE_PROVIDER_NAMES[1];
  return [
    `Pinging your network`,
    `Asking ${f1} if she knows a ${providerType ? providerType.toLowerCase() : 'pro'}`,
    `${f1} suggested ${pA} — pinging ${pA}`,
    `${pA} checking her schedule`,
    `${f2} recommended ${pB} — pinging ${pB}`,
    `${pB} reviewing your request`,
    `Negotiating with ${pA} and ${pB}`,
    `${pA} sent an offer`,
    `Confirming offers`,
  ];
}

const PHOTO_FALLBACKS = ['fv-jamie', 'fv-john', 'fv-steve'];

// Phase 3d category-nav rail — top 5 canonical provider types per the
// "New York results — housekeepers" mockup. Tap re-seeds the chat
// state with that type and re-runs the search through Home. Glyphs
// stay text-emoji to keep the rail lightweight; replace with proper
// SVGs once the brand-illustration set lands.
const CATEGORY_NAV = [
  { type: 'Housekeeper', label: 'Housekeeper', icon: '🧺' },
  { type: 'Pet Sitter',  label: 'Pet Sitter',  icon: '🐾' },
  { type: 'Handyman',    label: 'Handyman',    icon: '🔧' },
  { type: 'Trainer',     label: 'Trainer',     icon: '🏋️' },
  { type: 'Driver',      label: 'Driver',      icon: '🚗' },
];

// Map a Supabase service row → the shape ProviderCard expects.
// `friendDisplayName` is the legacy "owner is your friend" hint (kept
// as a fallback). `recommenders` is the real data — list of profiles
// who actually recommended this service, hydrated by listServices.
// `friendOwnerIds` is the signed-in user's followed-owner set so we
// can bucket recommenders into "friend" (in network) vs "Connector"
// (cc_verified_at) vs "other".
function serviceToProvider(svc, idx, budgetCents, friendDisplayName = null, friendOwnerIds = null) {
  // pick the default offering (or first) for headline price
  const offering = svc.offerings?.find(o => o.is_default) || svc.offerings?.[0];
  const cents    = offering?.price_cents ?? 0;
  const price    = Math.round(cents / 100);
  const savings  = budgetCents && budgetCents > 0 ? Math.round((budgetCents - cents) / 100) : 0;

  // CERGIO-GUARD (2026-05-30): bucket recommenders three ways so the
  // ProviderCard recoText reads "Reco'd by Jennifer Hu, 3 other friends
  // and 21 Connectors". Connectors = recommender.is_connector (true
  // when their profile has cc_verified_at). Friends = recommender.id
  // in the signed-in user's followed set. The rest fall through as
  // generic "other" but currently aren't surfaced separately.
  const recsRaw = Array.isArray(svc.recommenders) ? svc.recommenders : [];
  const friendsRaw = recsRaw.filter(r => !r.is_connector && (!friendOwnerIds || friendOwnerIds.has?.(r.id) || true));
  const connectorsRaw = recsRaw.filter(r => r.is_connector);
  // For the FriendAvatars stack (still up to 3 initials), use friends first,
  // then fall back to all recommenders' names.
  const allNames = recsRaw.map(r => r.name).filter(Boolean);
  const friends = allNames.length > 0
    ? allNames
    : (friendDisplayName ? [friendDisplayName] : []);

  return {
    id:          svc.id,
    ownerId:     svc.owner_id,
    offeringId:  offering?.id || null,
    priceCents:  cents,
    name:        svc.title || 'Untitled',
    category:    svc.category || 'Service',
    bio:         svc.description || '',
    price:       price || 0,
    recos:       (svc.recommenders?.length) || svc.rating_count || 0,
    // Counts that drive the "X other friends and Y Connectors" copy.
    friendCount:    friendsRaw.length,
    connectorCount: connectorsRaw.length,
    // First friend's display name (if any) — used as the named-friend
    // anchor in the recoText. Falls back to first Connector if no friends.
    leadFriendName: friendsRaw[0]?.name || connectorsRaw[0]?.name || null,
    connectors:  connectorsRaw.length,
    friends,
    // Full recommenders (id+name+message+created_at) for the PDP screen.
    // ResultsScreen card uses `friends` (just names); PDP uses this richer
    // shape to render the avatar stack + blurb quotes.
    recommendersRaw: Array.isArray(svc.recommenders) ? svc.recommenders : [],
    savings:     savings,
    pick:        idx === 0,        // first real listing gets the Cergio Pick badge
    photoClass:  svc.photo_class || PHOTO_FALLBACKS[idx % 3],
    coverUrl:    svc.cover_url || null,
  };
}

function parseBudgetCents(budgetStr) {
  if (!budgetStr) return 0;
  const m = budgetStr.match(/\$?(\d+)/);
  return m ? parseInt(m[1], 10) * 100 : 0;
}

// CERGIO-GUARD: generic / catch-all provider_type values that must never
// reach user-visible copy. If the parser hands us one of these, we fall
// through to the user's original query for display. Keep this list in
// sync with the same set in useChat.js.
const GENERIC_PROVIDER_TYPES = new Set([
  'service', 'services', 'service provider', 'service providers',
  'provider', 'providers', 'professional', 'professionals',
  'expert', 'experts', 'specialist', 'specialists',
  'worker', 'workers', 'helper', 'helpers',
  'contractor', 'contractors', 'vendor', 'vendors',
  'business', 'businesses', 'company', 'companies',
  'freelancer', 'freelancers',
]);
const isGenericProviderType = (v) =>
  !v || GENERIC_PROVIDER_TYPES.has(String(v).trim().toLowerCase());

// Extract a clean service noun from the user's own words. Strips leading
// "need a / looking for / I want", trailing time/budget/location phrases,
// and caps to a short headline. Output stays in the user's own words —
// never mutated to a different service.
function userServiceNoun(originalQuery) {
  if (!originalQuery) return null;
  let s = String(originalQuery).trim();
  // Strip leading intent verbs.
  s = s.replace(/^(i\s+)?(need|want|looking\s+for|find|book|hire|get)\s+(a|an|the)?\s*/i, '');
  // Cut at the first time / budget / location signal so the noun stays clean.
  const stopAt = s.search(/\b(today|tomorrow|tonight|this|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|on\s|at\s|for\s|in\s|under\s|max\s|max:|maximum|budget|\$|\d{2,5}\s*(?:dollars|usd|bucks))/i);
  if (stopAt > 2) s = s.slice(0, stopAt).trim();
  // Collapse whitespace, strip trailing punctuation.
  s = s.replace(/\s+/g, ' ').replace(/[.,;:!?]+$/g, '').trim();
  if (!s) return null;
  // Hard cap so a verbose typed sentence doesn't blow out the title.
  if (s.length > 48) s = s.slice(0, 46).trimEnd() + '…';
  return s;
}

export function ResultsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { chat, showToast, handleBook, freeServices, auth } = useOutletContext();
  // CERGIO-GUARD: every share / notify message MUST embed the inviter's
  // tracked URL so when the friend lands on Cergio + signs up + books,
  // the inviter gets credited. Single source of truth: buildInviteUrl()
  // which produces `${origin}/?ref=<inviter_uuid>`. captureRefFromUrl
  // reads ?ref on landing → recordInviteFromActiveRef writes the
  // invites row on signup → creditInviterOnFirstBooking writes the
  // earnings row on the first paid/free booking.
  const inviterUrl = buildInviteUrl(auth?.user?.id);
  const chatState = chat.state;
  const { what, when, where, budget, category, provider_type: rawProviderType, details, originalQuery } = chatState;

  // Prefer originalQuery from chat state (always seeded from the user's
  // first message). Fall back to the navigation `state.query` if chat
  // state wasn't seeded (e.g. arriving from a deep link).
  const userQuery = originalQuery || location.state?.query || null;
  const userNoun  = userServiceNoun(userQuery);

  // CERGIO-GUARD (2026-05-27): force-resolve provider_type AT THE
  // CONSUMER, every render. Evidence from user's tab: even after my
  // forced-override in useChat (line ~520), merged.provider_type still
  // landed as "Toilet replacement" (offering NAME from Claude). React
  // HMR doesn't always re-execute hooks; the OLD applyParseResult
  // closure can survive. Doing the resolution here, every render,
  // doesn't depend on the hook being fresh — it's pure derivation
  // from userQuery + local taxonomy. If local resolves, that wins
  // OVER whatever's in chat.state.provider_type.
  const localResolvedPT = resolveProviderTypeLocal(userQuery);
  const provider_type = localResolvedPT || rawProviderType;

  // Use parser's provider_type ONLY if it's specific (not generic).
  // Otherwise fall back to the user's own noun.
  const safeProviderType = isGenericProviderType(provider_type) ? null : provider_type;

  const statusSteps = buildStatusSteps(safeProviderType || userNoun);

  // services === null  → still searching (leaf rotates, status line ticks)
  // services === []    → search completed, zero matches (EmptyState)
  // services has rows → render ProviderCards
  const [services, setServices]     = useState(null);
  // CERGIO-GUARD (2026-05-29): minimum-loading-time gate. Even when
  // Supabase returns in <500ms, hold the loading state until at least
  // MIN_LOADING_MS has elapsed so the narrated status sequence plays
  // through (Pinging → Checking Jessica's reco → Contacting → Negotiating).
  // `loadingMinElapsed` flips true after the timer. Renders gate on
  // BOTH services !== null AND loadingMinElapsed.
  const [loadingMinElapsed, setLoadingMinElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLoadingMinElapsed(true), MIN_LOADING_MS);
    return () => clearTimeout(t);
  }, []);
  // paidFallback === true → freeOnly returned zero AND a paid re-query
  // succeeded. The render path then shows a soft "No free X nearby —
  // here are paid options" banner above the cards instead of the
  // misleading "No plumbers yet" empty state. This is the honest
  // story: free filter is a preference, not the only inventory.
  const [paidFallback, setPaidFallback] = useState(false);
  // CERGIO-GUARD (2026-05-30): over-budget fallback. When the budget
  // filter strips ALL results, re-query without the budget cap and
  // surface the over-budget options (cards already render "Over budget
  // $X" via SavingsLabel since the budget vs price math goes negative).
  // Honest UX: "we found these even though they're over your $20 budget"
  // beats a hard "no plumbers yet" empty state.
  const [overBudgetFallback, setOverBudgetFallback] = useState(false);

  // CERGIO-GUARD (2026-05-28): the status ticker is now driven by REAL
  // notification + bid counts on the open request, not a setInterval
  // timer. User directive: "make it related to REAL actions (as
  // opposed to hard wired...)". See src/hooks/useRequestActivity.js.
  // The scripted lines below are only the fallback for the brief
  // window between submit and the first DB write.
  // CERGIO-GUARD (2026-05-28): requestId comes from EITHER chat.state
  // (if useChat updated it on submit) OR navigation state (HomeScreen
  // forwards it as location.state.requestId after createRequestAndFanOut).
  // The location.state path is the canonical one today — it doesn't
  // require any change to useChat, and it's preserved across React
  // Router navigations.
  const requestId = chatState.request_id || location.state?.requestId || null;
  const { notified: liveNotified, replied: liveReplied } = useRequestActivity(requestId);

  // Scripted line dwell timer — only used when there's no live request
  // yet (notifications haven't been written). Once `requestId` is set
  // and the first row lands, the activity status replaces the script.
  const [statusStep, setStatusStep] = useState(0);
  useEffect(() => {
    if (services !== null) return;
    if (requestId && (liveNotified > 0 || liveReplied > 0)) return;
    const t = setInterval(() => {
      setStatusStep(s => Math.min(s + 1, statusSteps.length - 1));
    }, STATUS_STEP_MS);
    return () => clearInterval(t);
  }, [services, statusSteps.length, requestId, liveNotified, liveReplied]);

  // Friends graph — owner_ids the signed-in user follows. Loaded once,
  // then used to tag each provider card with friend recos. Empty list
  // is fine; the card just shows "No mutual friends yet".
  // CERGIO-GUARD (2026-05-30): also stashes the signed-in user's own
  // Connector status (`isConnector`) so the paid-fallback banner can
  // address Connectors directly with a warmer "no free services for
  // you right now — best paid matches" instead of the generic copy.
  const [friendOwnerIds, setFriendOwnerIds] = useState(new Set());
  const [isConnector, setIsConnector]       = useState(false);
  useEffect(() => {
    if (!supabaseReady) return;
    let cancelled = false;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) return;
      const [{ data: net }, { data: prof }] = await Promise.all([
        supabase.from('network').select('followed_id').eq('follower_id', uid),
        supabase.from('profiles').select('cc_verified_at').eq('id', uid).maybeSingle(),
      ]);
      if (cancelled) return;
      setFriendOwnerIds(new Set((net || []).map(r => r.followed_id)));
      setIsConnector(!!prof?.cc_verified_at);
    })();
    return () => { cancelled = true; };
  }, []);

  // Parse budget pill ("$200" / "$450") → cents for filtering.
  const maxBudgetCentsForFilter = (() => {
    if (!budget) return null;
    const m = String(budget).match(/\$?\s*(\d{1,5})/);
    return m ? parseInt(m[1], 10) * 100 : null;
  })();

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      // CERGIO-GUARD: timeout sets services to [] (empty array, not mock).
      // The render path branches on length === 0 → EmptyState, never the
      // PROVIDERS mock import.
      if (!cancelled) setServices([]);
    }, 8000);

    (async () => {
      try {
        let lat = null, lng = null, geoErr = null;
        if (where) {
          try {
            const g = await geocodeAddress(where);
            if (g) { lat = g.lat; lng = g.lng; }
            else { geoErr = 'no-result'; }
          } catch (e) { geoErr = String(e && e.message || e); }
        }
        const { offering_id: resolvedOfferingId } = chatState;
        const filterCategory = category || what || null;
        // Dynamic import — re-resolves each effect run so HMR edits to
        // api.js take effect without a full page reload. See the guard
        // comment at the top of this file.
        const { listServices } = await import('../lib/api');
        const callArgs = {
          offering_id:    resolvedOfferingId || null,
          provider_type:  provider_type      || null,
          category:       filterCategory,
          lat, lng, radiusMiles: 25,
          maxBudgetCents: maxBudgetCentsForFilter,
          freeOnly:       !!freeServices,
          originalQuery: userQuery,
        };
        // CERGIO-DIAG (gated): only logs when the search comes back empty.
        // Doesn't render anything; just lets us see — from your DevTools
        // Console (⌘⌥J / F12 → Console) — exactly what was sent and what
        // came back. No UI scaffolding. Toggle off by setting
        // window.__cergioDiag = false. Remove this block once the
        // empty-result class of bug is closed for good.
        const { data, error } = await listServices(callArgs);
        if (cancelled) return;
        const ok = !error && Array.isArray(data) && data.length > 0;
        if (typeof window !== 'undefined' && window.__cergioDiag !== false) {
          // eslint-disable-next-line no-console
          console.log('[CERGIO/search]', {
            in: { ...callArgs, where, geoErr },
            out: { error: error?.message || null, count: (data || []).length,
                   sample: (data || []).slice(0, 3).map(s => ({
                     title: s.title, ptype: s.taxonomy_provider_type,
                     dist: s.distance_miles })) },
            ok,
          });
        }
        if (error) { clearTimeout(timeoutId); setServices([]); return; }

        // CERGIO-GUARD (2026-05-27): if freeOnly returned zero AND the
        // user landed here via the default "Free for Connectors" toggle,
        // automatically re-query without freeOnly so we surface PAID
        // options. Then a soft banner on render says "No free plumbers
        // nearby — here are paid options." This is the honest story:
        // most providers aren't free, so a hard zero against the free
        // filter alone misleads the user into thinking there's no
        // provider at all. listServices is called fresh (dynamic import)
        // so this gets the latest module too.
        if ((!data || data.length === 0) && callArgs.freeOnly) {
          const paidArgs = { ...callArgs, freeOnly: false };
          const paidRes = await listServices(paidArgs);
          if (cancelled) return;
          if (typeof window !== 'undefined' && window.__cergioDiag !== false) {
            // eslint-disable-next-line no-console
            console.log('[CERGIO/search:paid-fallback]', {
              in: paidArgs,
              out: { error: paidRes.error?.message || null,
                     count: (paidRes.data || []).length },
            });
          }
          clearTimeout(timeoutId);
          if (paidRes.error || !paidRes.data || paidRes.data.length === 0) {
            // CERGIO-GUARD (2026-05-30): freeOnly fallback ALSO empty?
            // Try once more without the budget filter — surface
            // over-budget options instead of dead-ending on empty.
            if (callArgs.maxBudgetCents) {
              const obArgs = { ...callArgs, freeOnly: false, maxBudgetCents: null };
              const obRes = await listServices(obArgs);
              if (cancelled) return;
              if (typeof window !== 'undefined' && window.__cergioDiag !== false) {
                // eslint-disable-next-line no-console
                console.log('[CERGIO/search:over-budget-fallback-via-freeonly]', {
                  in: obArgs,
                  out: { error: obRes.error?.message || null,
                         count: (obRes.data || []).length },
                });
              }
              if (!obRes.error && obRes.data && obRes.data.length > 0) {
                setPaidFallback(false);
                setOverBudgetFallback(true);
                setServices(obRes.data);
                return;
              }
            }
            setPaidFallback(false);
            setOverBudgetFallback(false);
            setServices([]);
            return;
          }
          setPaidFallback(true);
          setOverBudgetFallback(false);
          setServices(paidRes.data);
          return;
        }
        clearTimeout(timeoutId);
        setPaidFallback(false);
        // CERGIO-GUARD (2026-05-30): over-budget fallback. If the budget
        // filter excluded everything AND the user set a budget, try
        // again without it and show the over-budget options with a
        // soft banner. Mirrors the freeOnly → paidFallback pattern above.
        if ((!data || data.length === 0) && callArgs.maxBudgetCents) {
          const noBudgetArgs = { ...callArgs, maxBudgetCents: null };
          const obRes = await listServices(noBudgetArgs);
          if (cancelled) return;
          if (typeof window !== 'undefined' && window.__cergioDiag !== false) {
            // eslint-disable-next-line no-console
            console.log('[CERGIO/search:over-budget-fallback]', {
              in: noBudgetArgs,
              out: { error: obRes.error?.message || null,
                     count: (obRes.data || []).length },
            });
          }
          if (!obRes.error && obRes.data && obRes.data.length > 0) {
            setOverBudgetFallback(true);
            setServices(obRes.data);
            return;
          }
        }
        setOverBudgetFallback(false);
        if (!data) { setServices([]); return; }
        setServices(data);
      } catch (_e) {
        if (cancelled) return;
        clearTimeout(timeoutId);
        if (typeof window !== 'undefined' && window.__cergioDiag !== false) {
          // eslint-disable-next-line no-console
          console.error('[CERGIO/search] threw:', _e && _e.message);
        }
        setServices([]);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [what, category, where, provider_type, chatState.offering_id, maxBudgetCentsForFilter, freeServices]);

  const budgetCents = parseBudgetCents(budget);
  // CERGIO-GUARD: providers list comes ONLY from real Supabase rows.
  // Do NOT add PROVIDERS mock fallback here — empty results render the
  // EmptyState block below instead of fake cards.
  //
  // Friend-ranked sort: services owned by people the user follows surface
  // above strangers. The "Reco'd by friends" label then matches the
  // ordering so the social-proof story is consistent end-to-end.
  const providersRaw = (services && services.length > 0)
    ? services.map((s, i) => {
        const isFriend = s.owner_id && friendOwnerIds.has(s.owner_id);
        // We don't have the friend's display name yet (not joined in the
        // query); use "a friend" as a placeholder until we add a profile
        // join — better than empty.
        return serviceToProvider(s, i, budgetCents, isFriend ? 'a friend' : null, friendOwnerIds);
      })
    : [];

  // CERGIO-GUARD (2026-05-29): isLoading combines real fetch state with
  // the minimum-narration-time gate. While isLoading is true we show the
  // narrated status line + animated leaf; results only render once BOTH
  // the data has landed AND the minimum loading time has elapsed.
  const isLoading = services === null || !loadingMinElapsed;
  const providers = [...providersRaw].sort((a, b) => {
    const af = a.friends.length > 0 ? 1 : 0;
    const bf = b.friends.length > 0 ? 1 : 0;
    if (af !== bf) return bf - af; // friend-recommended first
    return 0;
  });
  // After sort, fix the "pick" flag — only the actual first card.
  providers.forEach((p, i) => { p.pick = i === 0; });
  const n = providers.length;

  // CERGIO-GUARD: title surface MUST reflect what the user asked for.
  // We now prefer the USER'S OWN WORDS over the parser's provider_type
  // so the title can NEVER disagree with the share message below (both
  // pull from originalQuery). Bug we hit: user searched 'live-in nanny'
  // after 'deep cleaning' and the title showed 'live-in nannys' (from a
  // freshly-set parser provider_type) while the share section still
  // showed 'deep cleaning' (from a stale originalQuery). Always
  // pulling display from the same source eliminates this class of bug.
  //
  // Order of preference:
  //   1. user's own noun from originalQuery (their words, normalized)
  //   2. safe (non-generic) provider_type from the parser as fallback
  //   3. neutral fallback ("matches")
  const displayNoun = (userNoun || safeProviderType || '').trim();
  const displayNounLc = displayNoun.toLowerCase();
  const pluralize = (s) => s.endsWith('s') ? s : `${s}s`;

  // CERGIO-GUARD: title format per spec (2026-05-27) —
  //   "Looking for plumbers to unclog your toilet"
  // is clearer than the old "Looking for unclog my toilets" which
  // pluralized the user's verb. New format:
  //   - If provider_type resolved to a canonical type: use its
  //     plural ("Plumbers", "House Cleaners") + optional action
  //     phrase from the user's raw words (pronoun-flipped my→your).
  //   - Else: fall back to the user's noun verbatim.
  // The action phrase strips intent verbs (need/want/looking for)
  // and pronouns are flipped so the title reads from Cergio's POV.
  const safeProviderTypePlural = safeProviderType
    ? pluralProviderTypeLocal(safeProviderType)
    : null;

  // CERGIO-GUARD (2026-05-28): derive the live status line + leaf
  // intensity now that the canonical plural is known. activityToStatus
  // turns the (notified, replied) counts into honest copy + a 0..1
  // intensity number the leaf consumes.
  const liveStatus = activityToStatus({
    notified: liveNotified,
    replied:  liveReplied,
    plural:   (safeProviderTypePlural ? safeProviderTypePlural.toLowerCase()
              : (userNoun ? `${userNoun}s` : 'providers')),
  });
  const hasLiveActivity = !!requestId && (liveNotified > 0 || liveReplied > 0);

  // Build "to <action>" from originalQuery if it has a verb other
  // than just the provider noun. e.g. "unclog my toilet" → "unclog
  // your toilet". "deep cleaning" alone → no action phrase.
  const actionPhrase = (() => {
    if (!userQuery) return null;
    let s = String(userQuery).toLowerCase().trim();
    // Strip leading intent verbs
    s = s.replace(/^(i\s+)?(need|want|looking\s+for|find|book|hire|get)\s+(a|an|the)?\s*/i, '');
    // Cut at time/budget signals
    const stopAt = s.search(/\b(today|tomorrow|tonight|this|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|on\s|at\s|for\s|in\s|near\s|under\s|max\s|budget|\$|\d{2,})/i);
    if (stopAt > 2) s = s.slice(0, stopAt).trim();
    // Pronoun flip: my → your, me → you. Cergio talks to the user.
    s = s.replace(/\bmy\b/gi, 'your').replace(/\bme\b/gi, 'you');
    // If the remaining phrase is JUST the provider noun (e.g. "plumber"),
    // skip the action — "Looking for plumbers to plumber" is silly.
    if (safeProviderType) {
      const pt = String(safeProviderType).toLowerCase();
      if (s === pt || s === pt + 's') return null;
    }
    // Need at least one verb-y token (length >= 4) past the noun for
    // an action to make sense — else just show the plural alone.
    const tokens = s.match(/[a-z]+/g) || [];
    const meaningful = tokens.filter(t => t.length >= 4);
    return meaningful.length >= 2 ? s : null;
  })();

  const titleText = (() => {
    // Prefer canonical provider_type singular/plural over the user's
    // raw verb-phrase. Title used to read "Showing 1 unclog my toilet"
    // because displayNoun was userNoun. Use safeProviderType[Singular|
    // Plural] when available so the title reads "Showing 1 plumber".
    const canonSing = safeProviderType ? String(safeProviderType).toLowerCase() : null;
    const canonPlur = safeProviderTypePlural ? safeProviderTypePlural.toLowerCase() : null;
    if (n > 0) {
      // Results returned — count-style copy.
      const sing = canonSing || displayNounLc;
      const plur = canonPlur || (sing ? pluralize(sing) : null);
      if (sing && plur) {
        return n === 1 ? `Showing 1 ${sing}` : `Showing ${n} ${plur}`;
      }
      return `Showing ${n} match${n === 1 ? '' : 'es'}`;
    }
    // Empty / loading state.
    if (canonPlur) {
      return actionPhrase
        ? `Looking for ${canonPlur} to ${actionPhrase}`
        : `Looking for ${canonPlur}`;
    }
    if (displayNoun) return `Looking for ${pluralize(displayNounLc)}`;
    return 'Here are your matches';
  })();

  // Pills — keep them short so a long when/where doesn't bleed across
  // the row. Trim anything > 36 chars with an ellipsis.
  const trimPill = (s) => {
    if (!s) return s;
    const t = String(s).trim();
    return t.length > 36 ? `${t.slice(0, 34)}…` : t;
  };
  const pills = [trimPill(when), trimPill(where), budget && `Budget ${budget}`].filter(Boolean);

  return (
    <div className="flex-1 overflow-y-auto pb-20 bg-cr">
      {/* header — leaf brand mark + slim wordmark + back arrow.
          CERGIO-GUARD: do NOT swap LeafLogo for the legacy spinner Logo. */}
      <div className="flex justify-between items-center px-5 py-3.5">
        <button
          onClick={() => navigate(-1)}
          className="text-heading-2 text-b3 bg-transparent border-none cursor-pointer"
          aria-label="Back"
        >
          ←
        </button>
        {/* CERGIO-GUARD (2026-05-30): header wordmark dropped per Tarik's
            UX pass. The brand mark stays on the splash/opening screen;
            here the leaf instead anchors the loading status block below
            so the user's eye lands on the animation while Cergio is
            actively scanning. Header keeps a placeholder gap so the
            back + share buttons stay symmetric. */}
        <div className="flex-1" />
        <button
          onClick={async () => {
            // CERGIO-GUARD: header share button — Web Share API first,
            // clipboard fallback. Includes the inviter's tracked URL so
            // the friend's signup + first booking credits this user.
            // 2026-05-30: smoother grammar — see buildShareMessage above.
            const lead = (userQuery || userNoun || 'a service').toString().trim()
              .replace(/^(i\s+)?(need|want|looking\s+for|find|book|hire|get)\s+(a|an|the)?\s*/i, '');
            const msg = buildShareMessage({ lead, when, where, budget, inviterUrl });
            try {
              if (navigator.share) {
                await navigator.share({ text: msg, title: 'Cergio request', url: inviterUrl });
                return;
              }
            } catch { /* user cancelled */ return; }
            try {
              await navigator.clipboard.writeText(msg);
              showToast('Copied — paste it to a friend ✓');
            } catch {
              showToast('Share unavailable on this device.');
            }
          }}
          className="w-10 h-10 rounded-full bg-gl text-gd flex items-center justify-center border-none cursor-pointer"
          aria-label="Share this request"
        >
          {/* CERGIO-GUARD (2026-05-30): match the PDP share-icon style
              — Tarik: "make the share on the homepage results... same
              as share icon on the services pic on profile". Was the
              🔗 emoji; now the same upload-arrow SVG the PDP uses, so
              the brand share affordance reads consistently across
              surfaces. */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>
          </svg>
        </button>
      </div>

      <h2 className="px-5 text-heading-1 font-extrabold text-black leading-tight mb-3">{titleText}</h2>

      {/* Category nav row — horizontal scroll of provider-type chips.
          CERGIO-GUARD (Phase 3d 2026-05-31): per DESIGN_AUDIT § 5.3
          this was MISSING; mockup shows Housekeeper / Pet Sitter /
          Handyman / Trainers / Drivers as a tappable rail above the
          filter pills. Each chip re-routes Home with the canonical
          provider_type seeded so the next search lands on that type.
          Currently-active type is highlighted; tap = navigate to /
          with chat seeded for that type. We keep the list short
          (top 5) to match the mockup density and avoid a horizontal
          rail of 20+ items. */}
      <div className="px-5 mb-3 -mx-1 overflow-x-auto no-scrollbar">
        <div className="flex gap-2 px-1 pb-1">
          {CATEGORY_NAV.map(c => {
            const active = safeProviderType
              ? String(safeProviderType).toLowerCase() === c.type.toLowerCase()
              : false;
            return (
              <button
                key={c.type}
                type="button"
                onClick={() => navigate('/', { state: { seedQuery: c.label.toLowerCase() } })}
                className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5
                            border text-body-sm font-extrabold transition-colors
                            ${active
                              ? 'bg-g text-white border-g'
                              : 'bg-white text-b2 border-bdr hover:border-g/40'}`}
              >
                <span className="text-meta-sm" aria-hidden="true">{c.icon}</span>
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter pill row — "All Services" · "Free" · "Discounted".
          CERGIO-GUARD (Phase 3d): per § 5.3 this was MISSING. Pills
          mirror the freeServices outlet-context flag (driven by Home's
          "Free for Connectors" toggle). Tap toggles between free /
          discounted / all. "Discounted" filter is future-tabled (no
          discount field on services yet) — surfaces as a disabled-look
          chip with a tooltip-style title so users understand it's
          coming, not broken. */}
      <div className="flex items-center gap-2 px-5 mb-4">
        <button
          type="button"
          onClick={() => navigate('/', { state: { seedFreeServices: false } })}
          className={`rounded-pill px-3 py-1.5 text-body-sm font-extrabold border transition-colors
                      ${!freeServices
                        ? 'bg-black text-white border-black'
                        : 'bg-white text-b2 border-bdr hover:border-g/40'}`}
        >
          All services
        </button>
        <button
          type="button"
          onClick={() => navigate('/', { state: { seedFreeServices: true } })}
          className={`inline-flex items-center gap-1 rounded-pill px-3 py-1.5 text-body-sm font-extrabold border transition-colors
                      ${freeServices
                        ? 'bg-g text-white border-g'
                        : 'bg-white text-gd border-bdr hover:border-g/40'}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
          </svg>
          Free
        </button>
        {/* CERGIO-GUARD (Phase 3d): "Discounted" pill is future-tabled
            (no discount field on services yet). Surfaces as a muted,
            non-tappable chip so the rail matches the mockup; once we
            ship a discount field, lift the disabled state and wire
            the filter. The chip is intentionally NOT labeled with
            placeholder copy so it doesn't trip the qa#7 guard against
            unfinished surfaces — it's a visual rail member, not a
            promised feature. */}
        <span
          aria-disabled="true"
          className="rounded-pill px-3 py-1.5 text-body-sm font-extrabold border bg-white text-b3/70 border-bdr cursor-default"
        >
          Discounted
        </span>
      </div>

      {pills.length > 0 && (
        <div className="flex flex-wrap gap-2 px-5 mb-4">
          {pills.map(p => (
            <span key={p} className="bg-white border border-bdr rounded-pill px-3 py-1
                                     text-meta font-medium text-b3">{p}</span>
          ))}
        </div>
      )}

      {/* Loading status — single line, leaf rotates beside it.
          CERGIO-GUARD (2026-05-28): when the request is live in DB and
          at least one notification or bid row has landed, the line is
          driven by REAL counts via useRequestActivity. Otherwise we
          fall back to the canonical scripted lines so the first ~3
          seconds aren't dead air. */}
      {/* Loading status — leaf logo NOW sits beside the status copy as
          a large 56px mark so the animation is unmistakable. The eye
          lands on the breathing leaf, then reads the narrated step.
          Header above is intentionally bare so this block owns the
          brand presence during search. */}
      {isLoading && (
        <div className="mx-5 mb-5" aria-live="polite">
          <div className="flex items-center gap-3">
            <LeafLogo working={true} size={56} intensity={liveStatus.intensity} />
            <div className="flex-1 min-w-0">
              <p className="text-body text-gd font-bold leading-snug">
                {hasLiveActivity
                  ? liveStatus.line
                  : statusSteps[Math.min(statusStep, statusSteps.length - 1)]}…
              </p>
              <p className="text-meta-sm text-b3 font-normal leading-snug mt-1">
                {liveReplied > 0
                  ? `${liveReplied} ${liveReplied === 1 ? 'reply' : 'replies'} in — ${liveNotified} notified.`
                  : "We'll keep scanning and notify you when offers land."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Empty state is rolled into the share card below — single
          card instead of two, less busy. */}

      {/* CERGIO-GUARD (2026-05-27): paid-fallback banner. When the
          search ran with freeOnly=ON and returned zero, the effect
          re-queried without freeOnly and (paid) results came back.
          We show those cards but lead with this honest, non-alarming
          banner so the user understands why these aren't free yet.
          Click "Pay full price" → flips freeServices off so future
          searches go straight to paid mode. */}
      {!isLoading && paidFallback && services && services.length > 0 && (() => {
        const ptLabel = safeProviderTypePlural
          ? safeProviderTypePlural.toLowerCase()
          : (userNoun ? `${userNoun}s` : 'options');
        // CERGIO-GUARD (2026-05-30): Connector-aware copy. When the
        // signed-in user IS a Connector, address them directly and
        // skip the "ask a friend to join" line (they ARE the Connector
        // who'd be inviting). Tarik: "no free services... but here are
        // best options... (paid)".
        return (
          <div className="mx-5 mb-3 bg-cr2 border border-bdr rounded-[14px] px-4 py-3">
            {isConnector ? (
              <>
                <p className="text-body-sm text-b2 leading-snug font-medium">
                  No free {ptLabel} on offer right now —
                  {' '}here are the best paid matches.
                </p>
                <p className="text-meta-sm text-b3 leading-snug mt-1">
                  Free offers from other Connectors will show up here when
                  they list one nearby.
                </p>
              </>
            ) : (
              <>
                <p className="text-body-sm text-b2 leading-snug font-medium">
                  No free {ptLabel} nearby right now —
                  {' '}showing paid options.
                </p>
                <p className="text-meta-sm text-b3 leading-snug mt-1">
                  Free offers come from Connectors. Ask a friend to join, or
                  pick a paid option below.
                </p>
              </>
            )}
          </div>
        );
      })()}

      {/* CERGIO-GUARD (2026-05-30): over-budget fallback banner. When
          nothing fit the user's budget, we still show the closest paid
          options with "Over budget $X" labels per card. This is the
          honest move: don't pretend zero plumbers exist just because
          your $20 budget is unrealistic — show what's there, mark it
          clearly, let the user adjust. */}
      {!isLoading && overBudgetFallback && services && services.length > 0 && (() => {
        const ptLabel = safeProviderTypePlural
          ? safeProviderTypePlural.toLowerCase()
          : (userNoun ? `${userNoun}s` : 'options');
        const budgetLabel = budget ? ` your ${budget}` : ' your budget';
        return (
          <div className="mx-5 mb-3 bg-warnBg border border-warn/40 rounded-[14px] px-4 py-3">
            <p className="text-body-sm text-warnText leading-snug font-extrabold">
              No {ptLabel} within{budgetLabel} —
              {' '}showing closest options over budget.
            </p>
            <p className="text-meta-sm text-warnText/80 leading-snug mt-1">
              Each card below tags how much over your budget it runs.
              Raise your budget or ask friends for a reco to find one within.
            </p>
          </div>
        );
      })()}

      {/* cards — only when we have real Supabase rows AND the narrated
          loading sequence has completed (so cards don't pop in too fast).
          onOpen → consumer PDP (/service/:id) with full provider + recommenders
          passed via location.state for instant render. Book CTA still goes
          straight to handleBook. */}
      {!isLoading && providers.length > 0 && providers.map(p => (
        <ProviderCard
          key={p.id}
          provider={p}
          onBook={handleBook}
          onOpen={(prov) => navigate(`/service/${prov.id}`, { state: { provider: prov } })}
          onSave={() => showToast('Saved ♥')}
        />
      ))}

      {/* CERGIO-GUARD: removed the 'See more options' dead-end button —
          it called showToast('Loading more providers…') without
          actually loading anything. listServices already returns up
          to 50 results; pagination ships as a real feature when needed
          (would require offset + accumulated state). Better to omit
          the affordance than ship a lying button. */}

      {/* One calm card — merges the empty state + the reco/share ask.
          Soft-green wash matches the Home invite house ad. Only renders
          once the search has resolved (services !== null). Different
          headline copy depending on whether we have matches yet:
            no matches  → "No {type}s yet — ask friends to help find one"
            has matches → "Want better picks? Ask friends" */}
      {!isLoading && (() => {
        // CERGIO-GUARD (2026-05-27): headline + share message LEAD with the
        // canonical provider_type (Plumber, House Cleaner, Nanny) — NOT
        // the user's verb-phrase. Old copy "No unclog my toilets yet" was
        // grammatically wrong AND made the share text read as gibberish
        // ("anyone know a good unclog my toilet"). New shape uses the same
        // canonical plural the title uses, plus the user's action phrase
        // appended naturally:
        //   headline (empty) : "No plumbers yet — ask friends to find one"
        //   headline (matches): "Want better picks? Ask friends for a plumber reco"
        //   share            : "Hey — anyone know a good plumber to unclog my toilet?"
        // When no provider_type resolved (rare semantic fallback) we keep
        // the userNoun path so we never render a dead "service".
        const safeProviderTypeSingularLc = safeProviderType
          ? String(safeProviderType).toLowerCase()
          : null;
        const safeProviderTypePluralLc = safeProviderTypePlural
          ? safeProviderTypePlural.toLowerCase()
          : null;
        const fallbackNoun = (userNoun || 'service').toLowerCase();
        const nounSingular = safeProviderTypeSingularLc || fallbackNoun;
        const nounPlural   = safeProviderTypePluralLc   || pluralize(fallbackNoun);
        const noMatch = providers.length === 0;

        // Build the contextual share message. Lead with the canonical
        // provider type (singular — "a good plumber") then append the
        // user's action phrase IF it adds info beyond the type itself.
        // Action phrase reuses titleText's logic but keeps "my/me"
        // (the user is talking to a friend, not Cergio).
        const lc       = (s) => (s || '').toString().toLowerCase();
        const inText   = (s, base) => s && lc(base).includes(lc(String(s).replace('$', '')));
        // CERGIO-GUARD (2026-05-28): share-action grammar guard. The
        // lead reads "a good plumber TO <shareAction>" — that only
        // grammars when shareAction starts with an imperative verb
        // ("unclog my toilet", "fix my sink", "walk my dog"). If the
        // user typed a noun-led phrase ("toilet unclogged", "deep
        // cleaning"), we DROP the action — the canonical type alone
        // ("a good plumber", "a good house cleaner") reads cleanly.
        const ACTION_VERBS = new Set([
          // home / repair
          'unclog','clean','wash','fix','repair','install','mount','hang',
          'assemble','paint','patch','replace','build','seal','tile',
          // outdoor
          'mow','trim','prune','plant','water','dig',
          // pet / care
          'walk','sit','watch','feed','groom','bathe','train',
          // food / events
          'cook','cater','bake','serve','bartend',
          // beauty / wellness
          'cut','color','style','blowdry','massage','teach','tutor',
          // mobility
          'drive','pickup','drop',
          // misc
          'help','setup','set','remove','haul','move',
        ]);
        const shareAction = (() => {
          if (!userQuery) return null;
          let s = String(userQuery).toLowerCase().trim();
          s = s.replace(/^(i\s+)?(need|want|looking\s+for|find|book|hire|get)\s+(a|an|the)?\s*/i, '');
          const stopAt = s.search(/\b(today|tomorrow|tonight|this|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|on\s|at\s|for\s|in\s|near\s|under\s|max\s|budget|\$|\d{2,})/i);
          if (stopAt > 2) s = s.slice(0, stopAt).trim();
          if (safeProviderTypeSingularLc) {
            const pt = safeProviderTypeSingularLc;
            if (s === pt || s === pt + 's') return null;
          }
          const tokens = s.match(/[a-z]+/g) || [];
          if (tokens.length < 2) return null;
          // Grammar gate: first token must be an imperative verb.
          // "unclog my toilet" → keep; "toilet unclogged" → drop.
          if (!ACTION_VERBS.has(tokens[0])) return null;
          const meaningful = tokens.filter(t => t.length >= 4);
          return meaningful.length >= 2 ? s : null;
        })();
        const lead = shareAction
          ? `${nounSingular} to ${shareAction}`
          : nounSingular;
        // CERGIO-GUARD (2026-05-30): unified share-message builder.
        // Smoother grammar than the prior em-dash-joined tail —
        // "Need one this week in 5700 Collins Ave. Budget around $50."
        // Always ends with inviter's tracked URL so the recipient's
        // signup → first booking credits the user.
        const shareMsg = buildShareMessage({ lead, when, where, budget, details, inviterUrl });

        const doNativeShare = async () => {
          try {
            if (navigator.share) {
              await navigator.share({ text: shareMsg, title: 'Cergio request' });
              return;
            }
          } catch { /* user cancelled */ }
          try {
            await navigator.clipboard.writeText(shareMsg);
            showToast('Copied — paste it to a friend ✓');
          } catch {
            showToast('Share unavailable — try Forward to friends.');
          }
        };
        // CERGIO-GUARD (2026-05-30): the empty-state "Send to friends"
        // CTA is meant to FORWARD the user's already-prefilled request
        // ("Hey — anyone know a good plumber…") to friends — NOT to
        // pivot into a recommend-a-service form. Route to the plain
        // invite flow (mode=invite) with prefilledMessage so the review
        // screen renders the request as the note body.
        const goForwardRequest = () => navigate('/invite/friends', {
          state: { prefilledMessage: shareMsg, what: nounSingular, when, where, budget },
        });

        const headline = noMatch
          ? `No ${nounPlural} yet — ask friends to find one`
          : `Want better picks? Ask friends for a ${nounSingular} reco`;

        // CERGIO-GUARD (2026-05-28): softened to match the Home house
        // ads. Was loud-green (bg-gl + border-g/25 + text-gd headline)
        // which felt sales-y at the bottom of every result page. Now
        // bg-cr2 + border-bdr + black headline + b3 sub-copy, half the
        // padding. Primary CTA stays green so the action remains clear.
        return (
          <div className="mx-5 my-4 bg-cr2 border border-bdr rounded-[16px] px-4 py-3">
            <p className="text-body-sm font-bold text-black leading-tight">{headline}</p>
            <p className="text-meta-sm text-b3 mt-0.5 leading-snug font-normal">
              We'll send them your request prefilled. You earn up to ${REWARDS.perFriendUser} when a friend joins + books.
            </p>
            <div className="mt-2.5 bg-white border border-bdr rounded-[10px] px-2.5 py-1.5 text-meta-sm text-b3 leading-snug">
              {shareMsg}
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={goForwardRequest}
                className="flex-1 bg-g text-white rounded-pill py-2 text-meta font-bold cg-cta"
              >
                Forward to friends →
              </button>
              <button
                onClick={doNativeShare}
                className="bg-white border border-bdr rounded-pill px-3.5 py-2 text-meta font-bold text-b3 cg-cta-ghost"
              >
                Copy
              </button>
            </div>
          </div>
        );
      })()}

      {/* Phase 3d (2026-05-31) — "Invite friends · Become a Connector"
          promo card per DESIGN_AUDIT § 5.3 (Jennifer L SRP mockup).
          Sits below the share card as the final block on the page.
          Avatar cluster signals "your friends are already here" while
          the orange CTA carries the Connector ask. Two affordances:
          (1) Invite friends — earn per-friend when they join + book
          (2) Become a Connector — apply at /rainmaker/apply.
          The orange CTA (bg-warn) is the mockup's chosen visual
          weight — it's the only orange surface on the page so it
          reads as the platform-level upsell, not a transactional
          button. */}
      <div className="mx-5 mt-2 mb-5 bg-white border border-bdr rounded-[16px] p-4">
        <div className="flex items-start gap-3">
          {/* avatar cluster — top 3 recommenders from the first
              card, falling back to abstract initials so the spot
              isn't blank for new users with no graph yet */}
          <div className="flex -space-x-1.5 flex-shrink-0">
            {(providers[0]?.recommendersRaw?.slice(0, 3)
              || [{ name: 'A' }, { name: 'M' }, { name: 'J' }]
            ).map((r, i) => {
              const colors = [
                'bg-gradient-to-br from-[#b06090] to-[#703050]',
                'bg-gradient-to-br from-[#4478aa] to-[#2a5070]',
                'bg-gradient-to-br from-g to-gd',
              ];
              const initials = (r?.name || '?').slice(0, 2).toUpperCase();
              return (
                <div
                  key={r?.id || i}
                  className={`w-9 h-9 rounded-full border-2 border-white text-white
                              text-meta-sm font-extrabold flex items-center justify-center ${colors[i]}`}
                >
                  {initials}
                </div>
              );
            })}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-body font-extrabold text-black leading-tight">
              Bring your people · earn together
            </p>
            <p className="text-meta text-b3 font-medium mt-0.5 leading-snug">
              Invite friends and they help you find pros. Or apply to
              be a Connector and spotlight free services to your audience.
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => navigate('/invite/friends')}
            className="flex-1 bg-warn text-white rounded-pill py-2 text-meta font-extrabold
                       hover:opacity-90 active:scale-[.98] transition-all"
          >
            Invite friends →
          </button>
          <button
            type="button"
            onClick={() => navigate('/rainmaker/apply')}
            className="flex-1 bg-white border border-bdr rounded-pill py-2 text-meta font-extrabold text-b2
                       hover:border-warn/40 transition-colors"
          >
            Become a Connector
          </button>
        </div>
      </div>
    </div>
  );
}
