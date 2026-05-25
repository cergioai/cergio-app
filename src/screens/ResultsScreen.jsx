// Per design-spec.md — Results / SRP.
//
// CERGIO-GUARD: this screen MUST query Supabase via listServices() and
// MUST NOT fall back to the PROVIDERS mock array under any condition.
// When 0 services match, render the EmptyState block — never fake
// providers. The leaf logo (shared brand mark) is the canonical visual;
// do not swap it for the legacy spinner Logo or any other icon.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { LeafLogo } from '../components/ui/LeafLogo';
import { ProviderCard } from '../components/ui/ProviderCard';
import { listServices } from '../lib/api';
import { geocodeAddress } from '../lib/google';

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
function serviceToProvider(svc, idx, budgetCents) {
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
    friends:     [],
    savings:     savings,
    pick:        idx === 0,        // first real listing gets the Cergio Pick badge
    photoClass:  svc.photo_class || PHOTO_FALLBACKS[idx % 3],
  };
}

function parseBudgetCents(budgetStr) {
  if (!budgetStr) return 0;
  const m = budgetStr.match(/\$?(\d+)/);
  return m ? parseInt(m[1], 10) * 100 : 0;
}

export function ResultsScreen() {
  const navigate = useNavigate();
  const { chat, showToast, handleBook } = useOutletContext();
  const chatState = chat.state;
  const { what, when, where, budget, category, provider_type } = chatState;

  const statusSteps = buildStatusSteps(provider_type);

  // services === null  → still searching (leaf rotates, status line ticks)
  // services === []    → search completed, zero matches (EmptyState)
  // services has rows → render ProviderCards
  const [services, setServices]     = useState(null);
  const [statusStep, setStatusStep] = useState(0);

  // Advance status line every STATUS_STEP_MS while loading, stop on last.
  useEffect(() => {
    if (services !== null) return;
    const t = setInterval(() => {
      setStatusStep(s => Math.min(s + 1, statusSteps.length - 1));
    }, STATUS_STEP_MS);
    return () => clearInterval(t);
  }, [services, statusSteps.length]);

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
        const { data, error } = await listServices({
          offering_id:   resolvedOfferingId || null,
          provider_type: provider_type      || null,
          category:      filterCategory,
          lat, lng, radiusMiles: 25,
        });
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
  }, [what, category, where, provider_type, chatState.offering_id]);

  const budgetCents = parseBudgetCents(budget);
  // CERGIO-GUARD: providers list comes ONLY from real Supabase rows.
  // Do NOT add PROVIDERS mock fallback here — empty results render the
  // EmptyState block below instead of fake cards.
  const providers = (services && services.length > 0)
    ? services.map((s, i) => serviceToProvider(s, i, budgetCents))
    : [];
  const n = providers.length;

  // Surface the inferred provider_type (broad category like "Driver" or
  // "Plumber") in the title — never the specific offering name. This
  // is the user's verification that Cergio understood their request.
  // If the resolver didn't capture provider_type, we use a neutral
  // fallback so we never echo a wrong offering.
  const inferredType = (provider_type || '').trim();
  const titleText = inferredType
    ? (n > 0
        ? `Showing ${n} ${inferredType.toLowerCase()}${n === 1 ? '' : 's'}`
        : `Looking for ${inferredType.toLowerCase()}s`)
    : (n > 0 ? `Showing ${n} match${n === 1 ? '' : 'es'}` : 'Here are your matches');

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
          onClick={() => showToast('Share coming soon!')}
          className="w-10 h-10 rounded-full bg-gl flex items-center justify-center border-none cursor-pointer text-lg"
          aria-label="Share"
        >
          🔗
        </button>
      </div>

      <h2 className="px-5 text-[20px] font-extrabold text-black leading-tight mb-3">{titleText}</h2>

      {pills.length > 0 && (
        <div className="flex flex-wrap gap-2 px-5 mb-4">
          {pills.map(p => (
            <span key={p} className="bg-white border border-bdr rounded-pill px-3 py-1
                                     text-[12px] font-medium text-b3">{p}</span>
          ))}
        </div>
      )}

      {/* Loading status — single line, leaf rotates beside it. Mirrors
          the Home engine ticker styling. */}
      {services === null && (
        <div className="mx-5 mb-5" aria-live="polite">
          <div className="flex items-center gap-2">
            <LeafLogo working={true} size={16} />
            <p className="text-[13px] text-gd font-medium leading-snug truncate">
              {statusSteps[Math.min(statusStep, statusSteps.length - 1)]}…
            </p>
          </div>
          <p className="ml-5 mt-1 text-[11px] text-b3 font-normal leading-snug">
            We'll keep going in the background.{' '}
            <button
              type="button"
              onClick={() => showToast("Got it — we'll ping you when offers land.")}
              className="text-g font-medium underline underline-offset-2"
            >
              Notify me when ready
            </button>
          </p>
        </div>
      )}

      {/* No matches yet — real empty state, NOT mock providers. Headline
          mentions the inferred provider_type so the user can see Cergio
          did understand their request, even though we have no rows. */}
      {services !== null && providers.length === 0 && (
        <div className="mx-5 mb-5 bg-white border border-bdr rounded-[18px] p-5 text-center">
          <div className="flex justify-center mb-3"><LeafLogo size={28} /></div>
          <p className="text-[15px] font-extrabold text-black leading-tight">
            {inferredType
              ? `No ${inferredType.toLowerCase()}s in your area yet`
              : 'No matches yet'}
          </p>
          <p className="text-[12px] text-b3 mt-1.5 leading-relaxed">
            {inferredType
              ? `Cergio is watching for ${inferredType.toLowerCase()}s near you. We'll notify you the moment one joins or sends an offer.`
              : "We're still growing in your area. Cergio will notify you the moment a matching provider joins or sends an offer."}
          </p>
          <button
            onClick={() => navigate('/find-friends')}
            className="mt-4 inline-block bg-g text-white rounded-pill px-5 py-2 text-[13px] font-extrabold"
          >
            Invite friends to speed it up →
          </button>
        </div>
      )}

      {/* cards — only when we have real Supabase rows. */}
      {services !== null && providers.length > 0 && providers.map(p => (
        <ProviderCard
          key={p.id}
          provider={p}
          onBook={handleBook}
          onSave={() => showToast('Saved ♥')}
        />
      ))}

      {services !== null && providers.length > 0 && (
        <div className="text-center py-4">
          <button
            onClick={() => showToast('Loading more providers…')}
            className="bg-transparent border-none text-[13px] font-bold text-g cursor-pointer
                       underline underline-offset-2"
          >
            See more options ↗
          </button>
        </div>
      )}

      {/* end-of-list reco card — touch-point for the invite/reco modules */}
      <div className="mx-5 my-4 bg-soft rounded-[18px] p-5">
        <p className="text-[16px] font-extrabold text-black leading-tight mb-1">
          Get <span className="text-g">recommendations</span> from your friends
        </p>
        <p className="text-[13px] text-b3 leading-relaxed mb-4">
          {/* Use provider_type when available (clean noun like "driver"),
              fall back to a generic "service" so the full pitch text
              never leaks here. */}
          Thinking of a {inferredType ? inferredType.toLowerCase() : 'service'}? Recommend one for free to earn,
          and we can show you their listings too.
        </p>
        <div className="flex flex-col">
          <button
            onClick={() => navigate('/invite/friends?mode=reco')}
            className="flex items-center justify-between py-3 border-b border-bdr text-left"
          >
            <span className="text-[14px] font-extrabold text-black">Invite from contacts</span>
            <span className="text-b3 text-lg">›</span>
          </button>
          <button
            onClick={() => showToast('Your link has been copied!')}
            className="flex items-center justify-between py-3 border-b border-bdr text-left"
          >
            <span className="text-[14px] font-extrabold text-black">Copy invite link</span>
            <span className="text-b3 text-lg">›</span>
          </button>
          <button
            onClick={() => showToast('Share via system — coming soon')}
            className="flex items-center justify-between py-3 text-left"
          >
            <span className="text-[14px] font-extrabold text-black">More</span>
            <span className="text-b3 text-lg">›</span>
          </button>
        </div>
      </div>

      {/* share */}
      <button
        onClick={() => showToast('Share link copied! 🔗')}
        className="block w-[calc(100%-40px)] mx-5 mb-4 bg-white border border-bdr rounded-pill
                   py-3.5 text-[14px] font-bold text-b2 cursor-pointer hover:border-g hover:text-gd transition-colors"
      >
        Share request with friends
      </button>
    </div>
  );
}
