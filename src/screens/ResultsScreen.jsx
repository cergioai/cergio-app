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

// Sequence of status lines shown while we hunt for providers. Each line
// advances ~900 ms after the previous; the last one repeats with an
// animated ellipsis until real data lands. Keep it warm + concrete, not
// generic-loader vibes. A label-level hint surfaces on "Negotiating
// offers" so the user knows that step is the slow one and can opt to
// be notified instead of waiting on this screen.
const STATUS_STEPS = [
  { label: 'Pinging local providers' },
  { label: "Scanning your friends' recos" },
  { label: 'Looking up your network' },
  { label: 'Getting quotes' },
  { label: 'Negotiating offers', hint: 'This may take a while…' },
];
const STATUS_STEP_MS = 900;

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
    rainmakers:  0,
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
  const { what, when, where, budget } = chatState;

  const [services, setServices]   = useState(null); // null = loading
  const [statusStep, setStatusStep] = useState(0);

  // While services is still loading, advance through the status reel.
  // Stops at the last item and lets it cycle the ellipsis there until
  // data arrives.
  useEffect(() => {
    if (services !== null) return;
    const t = setInterval(() => {
      setStatusStep(s => Math.min(s + 1, STATUS_STEPS.length - 1));
    }, STATUS_STEP_MS);
    return () => clearInterval(t);
  }, [services]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // If the AI chat captured an address, try to geocode it so we can rank
      // by distance. If no API key (or no address), fall back to plain list.
      let lat = null, lng = null;
      if (where) {
        const g = await geocodeAddress(where);
        if (g) { lat = g.lat; lng = g.lng; }
      }
      const { data, error } = await listServices({
        category: what || null, lat, lng, radiusMiles: 25,
      });
      if (cancelled) return;
      if (error || !data) { setServices([]); return; }
      setServices(data);
    })();
    return () => { cancelled = true; };
  }, [what, where]);

  const budgetCents = parseBudgetCents(budget);
  const providers   = (services && services.length > 0)
    ? services.map((s, i) => serviceToProvider(s, i, budgetCents))
    : PROVIDERS; // fallback to mock

  const usingReal = services && services.length > 0;
  const titleText = usingReal
    ? `Showing ${providers.length} ${(what || 'matching').toLowerCase()} providers`
    : (what ? `Showing ${providers.length} ${what.toLowerCase()} providers` : 'Here are your matches');
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

      {/* wait strip — soft info card */}
      <div className="mx-5 mb-5 bg-soft rounded-[18px] p-4">
        <p className="text-[13px] text-b3 leading-relaxed mb-3">
          I can keep searching for a better deal over the next 24 hours — at no extra cost.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => showToast('Showing results now…')}
            className="flex-1 bg-white rounded-pill py-2.5
                       text-[12px] font-semibold text-b3 cursor-pointer hover:text-b2 transition-colors"
          >
            Show now
          </button>
          <button
            onClick={() => showToast('✓ Searching for a better deal in 24hrs!')}
            className="flex-[1.6] bg-g rounded-pill py-2.5
                       text-[12px] font-bold text-white cursor-pointer hover:opacity-90 transition-opacity"
          >
            Wait 24hrs &amp; save more ↗
          </button>
        </div>
      </div>

      {services === null && (
        <div className="mx-5 mb-5 bg-white border border-bdr rounded-[18px] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Logo size={20} />
            <span className="text-[12px] font-extrabold tracking-widest uppercase text-g">
              Cergio AI is on it
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {STATUS_STEPS.map((step, i) => {
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
