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
import { listServices } from '../lib/api';
import { geocodeAddress } from '../lib/google';
import { supabase, supabaseReady } from '../lib/supabase';
import { buildInviteUrl } from '../lib/referral';
import { pluralProviderTypeLocal } from '../lib/serviceTaxonomy';

// Status lines shown while the leaf is rotating + Supabase is searching.
// Each line dwells for STATUS_STEP_MS; the last one stays until real
// data lands (or the 6s timeout falls through to the empty state).
const STATUS_STEP_MS = 1100;
function buildStatusSteps(providerType) {
  const plural = providerType ? `${providerType.toLowerCase()}s` : 'providers';
  return [
    `Connecting with your friends' ${plural} recos`,
    `Looking up your local network`,
    `Pinging matching ${plural}`,
    `Negotiating offers on your behalf`,
  ];
}

const PHOTO_FALLBACKS = ['fv-jamie', 'fv-john', 'fv-steve'];

// Map a Supabase service row → the shape ProviderCard expects.
// friendDisplayName is the signed-in user's friend who "owns" this
// provider (i.e. they follow them); pass null when there's no friend
// link so the card renders "No mutual friends yet".
function serviceToProvider(svc, idx, budgetCents, friendDisplayName = null) {
  // pick the default offering (or first) for headline price
  const offering = svc.offerings?.find(o => o.is_default) || svc.offerings?.[0];
  const cents    = offering?.price_cents ?? 0;
  const price    = Math.round(cents / 100);
  const savings  = budgetCents && budgetCents > 0 ? Math.round((budgetCents - cents) / 100) : 0;

  return {
    id:          svc.id,
    ownerId:     svc.owner_id,
    offeringId:  offering?.id || null,
    priceCents:  cents,
    name:        svc.title || 'Untitled',
    category:    svc.category || 'Service',
    bio:         svc.description || '',
    price:       price || 0,
    recos:       svc.rating_count || 0,
    connectors:  0,
    // CERGIO-GUARD: friends array drives the "Reco'd by …" line on the
    // card. Populated from the network table — if the signed-in user
    // follows this provider, they're treated as the reco source. When
    // we have richer friend-of-friend data we can extend this.
    friends:     friendDisplayName ? [friendDisplayName] : [],
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
  const { what, when, where, budget, category, provider_type, details, originalQuery } = chatState;

  // Prefer originalQuery from chat state (always seeded from the user's
  // first message). Fall back to the navigation `state.query` if chat
  // state wasn't seeded (e.g. arriving from a deep link).
  const userQuery = originalQuery || location.state?.query || null;
  const userNoun  = userServiceNoun(userQuery);

  // Use parser's provider_type ONLY if it's specific (not generic).
  // Otherwise fall back to the user's own noun.
  const safeProviderType = isGenericProviderType(provider_type) ? null : provider_type;

  const statusSteps = buildStatusSteps(safeProviderType || userNoun);

  // services === null  → still searching (leaf rotates, status line ticks)
  // services === []    → search completed, zero matches (EmptyState)
  // services has rows → render ProviderCards
  const [services, setServices]     = useState(null);
  // [CERGIO-DIAG] surfaces the actual values being sent to listServices
  // directly on the Results page so search bugs are diagnosable WITHOUT
  // DevTools. Tap the banner to toggle visibility. Auto-shows when
  // services is empty for >1s after geocode finished.
  const [diag, setDiag] = useState(null);
  const [statusStep, setStatusStep] = useState(0);

  // Advance status line every STATUS_STEP_MS while loading, stop on last.
  useEffect(() => {
    if (services !== null) return;
    const t = setInterval(() => {
      setStatusStep(s => Math.min(s + 1, statusSteps.length - 1));
    }, STATUS_STEP_MS);
    return () => clearInterval(t);
  }, [services, statusSteps.length]);

  // Friends graph — owner_ids the signed-in user follows. Loaded once,
  // then used to tag each provider card with friend recos. Empty list
  // is fine; the card just shows "No mutual friends yet".
  const [friendOwnerIds, setFriendOwnerIds] = useState(new Set());
  useEffect(() => {
    if (!supabaseReady) return;
    let cancelled = false;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from('network')
        .select('followed_id')
        .eq('follower_id', uid);
      if (cancelled) return;
      setFriendOwnerIds(new Set((data || []).map(r => r.followed_id)));
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
        let lat = null, lng = null;
        if (where) {
          const g = await geocodeAddress(where).catch(() => null);
          if (g) { lat = g.lat; lng = g.lng; }
        }
        const { offering_id: resolvedOfferingId } = chatState;
        const filterCategory = category || what || null;
        // [CERGIO-DIAG] surfaces the actual values via in-page banner.
        const diagCall = {
          provider_type, offering_id: resolvedOfferingId,
          category: filterCategory,
          lat, lng, originalQuery: userQuery,
        };
        // eslint-disable-next-line no-console
        console.log('[CERGIO-DIAG] listServices call', diagCall);
        setDiag(prev => ({ ...(prev || {}), call: diagCall }));
        const { data, error } = await listServices({
          offering_id:    resolvedOfferingId || null,
          provider_type:  provider_type      || null,
          category:       filterCategory,
          lat, lng, radiusMiles: 25,
          // CERGIO-GUARD: matching MUST respect budget + free toggle.
          // Previously these were cosmetic-only (budget pill shown,
          // free CTA flipped) but the actual SQL ignored them. Fixed
          // 2026-05-26.
          maxBudgetCents: maxBudgetCentsForFilter,
          freeOnly:       !!freeServices,
          // CERGIO-GUARD: the user's RAW words are the matching safety
          // net. When the parser returns taxonomy IDs/provider_types
          // that don't match seeded services exactly (e.g. "Housekeeper"
          // vs "House Cleaner"), the stem-text fallback in listServices
          // still catches them via title/description ilike.
          originalQuery: userQuery,
        });
        // [CERGIO-DIAG] result → banner
        const diagResult = {
          count: (data || []).length,
          error: error?.message || null,
          first: (data || []).slice(0, 3).map(s => ({
            title: s.title,
            ptype: s.taxonomy_provider_type,
            dist: s.distance_miles?.toFixed?.(2),
          })),
        };
        // eslint-disable-next-line no-console
        console.log('[CERGIO-DIAG] listServices result', diagResult);
        setDiag(prev => ({ ...(prev || {}), result: diagResult }));
        if (cancelled) return;
        clearTimeout(timeoutId);
        if (error || !data) { setServices([]); return; }
        setServices(data);
      } catch (_e) {
        if (cancelled) return;
        clearTimeout(timeoutId);
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
        return serviceToProvider(s, i, budgetCents, isFriend ? 'a friend' : null);
      })
    : [];
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
    if (n > 0) {
      // Results returned — keep the existing count-style copy.
      if (displayNoun) {
        return n === 1
          ? `Showing 1 ${displayNounLc}`
          : `Showing ${n} ${pluralize(displayNounLc)}`;
      }
      return `Showing ${n} match${n === 1 ? '' : 'es'}`;
    }
    // Empty / loading state.
    if (safeProviderTypePlural) {
      return actionPhrase
        ? `Looking for ${safeProviderTypePlural.toLowerCase()} to ${actionPhrase}`
        : `Looking for ${safeProviderTypePlural.toLowerCase()}`;
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
          className="text-[20px] text-b3 bg-transparent border-none cursor-pointer"
          aria-label="Back"
        >
          ←
        </button>
        <div className="flex items-center gap-2">
          <LeafLogo working={services === null} size={26} />
          <span className="text-[12px] font-extrabold tracking-widest uppercase text-g">Cergio AI</span>
        </div>
        <button
          onClick={async () => {
            // CERGIO-GUARD: header share button — Web Share API first,
            // clipboard fallback. Includes the inviter's tracked URL so
            // the friend's signup + first booking credits this user
            // (see buildInviteUrl).
            const lead = (userQuery || userNoun || 'a service').toString().trim()
              .replace(/^(i\s+)?(need|want|looking\s+for|find|book|hire|get)\s+(a|an|the)?\s*/i, '');
            const tail = [
              when   && when,
              where  && `in ${where}`,
              budget && `max ${budget}`,
            ].filter(Boolean);
            const ctx = tail.length ? ` — ${tail.join(', ')}` : '';
            const msg = `Hey — anyone know a good ${lead}${ctx}? Booking on Cergio → ${inviterUrl}`;
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
          className="w-10 h-10 rounded-full bg-gl flex items-center justify-center border-none cursor-pointer text-lg"
          aria-label="Share this request"
        >
          🔗
        </button>
      </div>

      <h2 className="px-5 text-[20px] font-extrabold text-black leading-tight mb-3">{titleText}</h2>

      {/* [CERGIO-DIAG] in-page diagnostic banner — visible only when
          services came back empty so we can see exactly which value is
          wrong (provider_type / lat-lng / count) without opening DevTools.
          Tap to dismiss. Removable once the search bug is fully closed. */}
      {diag && services !== null && services.length === 0 && (
        <div className="mx-5 mb-3 p-3 rounded-[10px] bg-warnBg border border-warn text-warnText text-[11px] font-mono leading-snug">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold">🐞 CERGIO-DIAG — search returned 0</span>
            <button onClick={() => setDiag(null)} className="text-warnText/70 text-[14px]">✕</button>
          </div>
          <div>provider_type: <b>{String(diag.call?.provider_type)}</b></div>
          <div>offering_id: {String(diag.call?.offering_id)}</div>
          <div>category: {String(diag.call?.category)}</div>
          <div>lat/lng: {diag.call?.lat?.toFixed?.(4)}, {diag.call?.lng?.toFixed?.(4)}</div>
          <div>originalQuery: "{diag.call?.originalQuery}"</div>
          <div className="mt-1 pt-1 border-t border-warn/40">
            count: <b>{diag.result?.count ?? '…'}</b>{diag.result?.error ? ` · err: ${diag.result.error}` : ''}
          </div>
          {diag.result?.first?.length > 0 && (
            <div>first: {diag.result.first.map(s => `${s.title} (${s.ptype})`).join(' | ')}</div>
          )}
        </div>
      )}

      {pills.length > 0 && (
        <div className="flex flex-wrap gap-2 px-5 mb-4">
          {pills.map(p => (
            <span key={p} className="bg-white border border-bdr rounded-pill px-3 py-1
                                     text-[12px] font-medium text-b3">{p}</span>
          ))}
        </div>
      )}

      {/* Loading status — single line, leaf rotates beside it. */}
      {services === null && (
        <div className="mx-5 mb-5" aria-live="polite">
          <div className="flex items-center gap-2">
            <LeafLogo working={true} size={16} />
            <p className="text-[13px] text-gd font-medium leading-snug truncate">
              {statusSteps[Math.min(statusStep, statusSteps.length - 1)]}…
            </p>
          </div>
          <p className="ml-5 mt-1 text-[11px] text-b3 font-normal leading-snug">
            We'll keep going in the background and notify you when offers land.
          </p>
        </div>
      )}

      {/* Empty state is rolled into the share card below — single
          card instead of two, less busy. */}

      {/* cards — only when we have real Supabase rows. */}
      {services !== null && providers.length > 0 && providers.map(p => (
        <ProviderCard
          key={p.id}
          provider={p}
          onBook={handleBook}
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
      {services !== null && (() => {
        // CERGIO-GUARD: headline + share message lead with the user's
        // own words (userNoun, derived from originalQuery), not the
        // parser's `what`. safeProviderType is used only when it's
        // specific (not a generic catch-all like "Service provider").
        const noun    = (userNoun || safeProviderType || 'service').toLowerCase();
        const noMatch = providers.length === 0;

        // Build a contextual share message. Lead with what the user typed,
        // append structured when / where / budget / details only if not
        // already present in the lead. Falls back to userNoun if for some
        // reason originalQuery wasn't captured.
        const lc       = (s) => (s || '').toString().toLowerCase();
        const inText   = (s, base) => s && lc(base).includes(lc(String(s).replace('$', '')));
        const rawLead  = (userQuery || userNoun || noun).toString().trim()
          .replace(/^(i\s+)?(need|want|looking\s+for|find|book|hire|get)\s+(a|an|the)?\s*/i, '')
          .replace(/^(a |an |the )/i, '');
        // Use the noun-only lead for the contextual append check so we
        // don't double-up when the lead is a full sentence.
        const lead = rawLead || noun;
        const base = lead;
        const tail = [];
        if (when   && !inText(when,   base)) tail.push(when);
        if (where  && !inText(where,  base)) tail.push(`in ${where}`);
        if (budget && !inText(budget, base)) tail.push(`max ${budget}`);
        if (details && !inText(details, base)) tail.push(details);
        const ctx     = tail.length ? ` — ${tail.join(', ')}` : '';
        // CERGIO-GUARD: every share message MUST end with the inviter's
        // tracked URL so the recipient's signup → first booking credits
        // the user. Without this the chain breaks and they earn nothing.
        const shareMsg = `Hey — anyone know a good ${lead}${ctx}? Booking on Cergio → ${inviterUrl}`;

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
            showToast('Share unavailable — try Send to friends.');
          }
        };
        const goReco = () => navigate('/invite/friends?mode=reco', {
          state: { prefilledMessage: shareMsg, what: noun, when, where, budget },
        });

        const headline = noMatch
          ? `No ${noun}s yet — ask friends to find one`
          : `Want better picks? Ask friends for a ${noun} reco`;

        return (
          <div className="mx-5 my-4 bg-gl border border-g/25 rounded-[20px] p-4">
            <p className="text-[14px] font-extrabold text-gd leading-tight">{headline}</p>
            <p className="text-[11px] text-gd/80 mt-1 leading-snug font-normal">
              We'll send them your request prefilled. You earn ${'250'} when any friend joins.
            </p>
            <div className="mt-3 bg-white border border-bdr rounded-[12px] px-3 py-2 text-[12px] text-b2 leading-snug font-medium">
              {shareMsg}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={goReco}
                className="flex-1 bg-g text-white rounded-pill py-2.5 text-[12px] font-extrabold
                           hover:opacity-90 active:scale-[.98] transition-all"
              >
                Send to friends →
              </button>
              <button
                onClick={doNativeShare}
                className="bg-white border border-bdr rounded-pill px-4 py-2.5 text-[12px] font-extrabold text-b2
                           hover:border-g hover:text-gd transition-colors"
              >
                Copy
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
