// Per design-spec.md — Results / SRP.
// Fetches real listed services from Supabase, falls back to mock when empty
// or when Supabase isn't configured. While fetching, runs a Claude-style
// status reel ("pinging providers… scanning friends' recos…") instead of
// showing a static spinner.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Logo } from '../components/ui/Logo';
import { ProviderCard } from '../components/ui/ProviderCard';
import { PROVIDERS } from '../data/mock';
import { listServices } from '../lib/api';
import { geocodeAddress } from '../lib/google';

// Sequence of status lines shown while we hunt for providers. When the
// resolver gave us a provider_type ("Plumber", "Pet Sitter"…) we splice
// it in to make the copy specific instead of generic. The last step
// repeats its ellipsis until real data lands; its sub-hint signals it's
// the slow one and offers a Notify-me bail.
const STATUS_STEP_MS = 900;
function buildStatusSteps(providerType) {
  const plural = providerType ? `${providerType}s` : 'providers';
  return [
    { label: `Pinging local ${plural}` },
    { label: `Scanning your friends' ${plural.toLowerCase()} recos` },
    { label: 'Looking up your network' },
    { label: providerType ? `Getting quotes from ${plural}` : 'Getting quotes' },
    { label: 'Negotiating offers', hint: 'This may take a while…' },
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

  // Build the status reel from the resolver's provider_type so the user
  // sees "Pinging local Plumbers" instead of generic copy when known.
  const statusSteps = useMemo(() => buildStatusSteps(provider_type), [provider_type]);

  const [services, setServices]     = useState(null); // null = loading
  const [statusStep, setStatusStep] = useState(0);

  // While services is still loading, advance through the status reel.
  // Stops at the last item and lets it cycle the ellipsis there until
  // data arrives.
  useEffect(() => {
    if (services !== null) return;
    const t = setInterval(() => {
      setStatusStep(s => Math.min(s + 1, statusSteps.length - 1));
    }, STATUS_STEP_MS);
    return () => clearInterval(t);
  }, [services, statusSteps.length]);

  useEffect(() => {
    let cancelled = false;
    // Hard timeout so the user is never stuck on the status reel — if
    // Supabase / geocode is slow or hanging, we fall through to mock
    // providers after 6s.
    const timeoutId = setTimeout(() => {
      if (!cancelled) setServices([]);
    }, 6000);

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
        setServices([]); // graceful fallback to mock providers
      }
    })();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [what, category, where, provider_type, chatState.offering_id]);

  const budgetCents = parseBudgetCents(budget);
  const providers   = (services && services.length > 0)
    ? services.map((s, i) => serviceToProvider(s, i, budgetCents))
    : PROVIDERS; // fallback to mock

  // Title — neutral copy. No taxonomy noun echo (which used to produce
  // bugs like "service providers providers"). User's typed request is
  // still visible via the pills below.
  const n = providers.length;
  const titleText = n > 0
    ? `Showing ${n} match${n === 1 ? '' : 'es'}`
    : 'Here are your matches';
  const pills = [when, where, budget && `Budget ${budget}`].filter(Boolean);

  return (
    <div className="flex-1 overflow-y-auto pb-20 bg-cr">
      {/* header */}
      <div className="flex justify-between items-center px-5 py-3.5">
        <button
          onClick={() => navigate(-1)}
          className="text-[20px] text-b3 bg-transparent border-none cursor-pointer"
        >
          ←
        </button>
        <div className="flex items-center gap-2">
          <Logo size={36} />
          <span className="text-[13px] font-extrabold tracking-widest uppercase text-g">Cergio AI</span>
        </div>
        <button
          onClick={() => showToast('Share coming soon!')}
          className="w-10 h-10 rounded-full bg-gl flex items-center justify-center border-none cursor-pointer text-lg"
        >
          🔗
        </button>
      </div>

      <h2 className="px-5 text-[22px] font-extrabold text-black leading-tight mb-3">{titleText}</h2>

      {pills.length > 0 && (
        <div className="flex flex-wrap gap-2 px-5 mb-4">
          {pills.map(p => (
            <span key={p} className="bg-white border border-bdr rounded-pill px-3 py-1
                                     text-[12px] font-medium text-b3">{p}</span>
          ))}
        </div>
      )}

      {/* "Wait 24hrs / Show now" walkthrough strip removed — the AI now
          runs the search directly and surfaces matches as soon as they
          land. No interstitial CTA. */}

      {services === null && (
        <div className="mx-5 mb-5 bg-white border border-bdr rounded-[18px] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Logo size={20} />
            <span className="text-[12px] font-extrabold tracking-widest uppercase text-g">
              Cergio AI is on it
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {statusSteps.map((step, i) => {
              const done   = i < statusStep;
              const active = i === statusStep;
              return (
                <li
                  key={step.label}
                  className={`flex items-start gap-2.5 text-[13px] leading-tight transition-opacity
                              ${i > statusStep ? 'opacity-40' : 'opacity-100'}`}
                >
                  <span className="pt-0.5">
                    {done ? (
                      <span className="w-4 h-4 rounded-full bg-g text-white text-[10px] font-extrabold
                                       flex items-center justify-center flex-shrink-0">✓</span>
                    ) : active ? (
                      <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                        <span className="w-3 h-3 border-2 border-g border-t-transparent rounded-full animate-spin" />
                      </span>
                    ) : (
                      <span className="w-4 h-4 rounded-full border-2 border-bdr flex-shrink-0" />
                    )}
                  </span>
                  <span className="flex flex-col">
                    <span className={done ? 'text-b2 font-medium' : active ? 'text-black font-extrabold' : 'text-b3 font-medium'}>
                      {step.label}{active ? '…' : ''}
                    </span>
                    {/* slow-step hint surfaces only while we're on it */}
                    {active && step.hint && (
                      <span className="text-[11px] text-b3 mt-0.5 italic">{step.hint}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Notify-me opt-out so the user doesn't feel stuck on this screen
              while the slow Negotiating step runs in the background. */}
          <div className="mt-4 pt-3 border-t border-bdr flex items-start gap-2.5">
            <div className="flex-1">
              <p className="text-[12px] text-b2 leading-relaxed">
                We'll keep negotiating in the background.{' '}
                <button
                  type="button"
                  onClick={() => showToast("Got it — we'll ping you when offers land.")}
                  className="text-g font-extrabold underline underline-offset-2"
                >
                  Notify me when offers are ready
                </button>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* cards */}
      {services !== null && providers.map(p => (
        <ProviderCard
          key={p.id}
          provider={p}
          onBook={handleBook}
          onSave={() => showToast('Saved ♥')}
        />
      ))}

      {/* see more */}
      {services !== null && (
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
          Thinking for a {what ? what.toLowerCase() : 'housekeeper'}? Recommend one for free to earn,
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
