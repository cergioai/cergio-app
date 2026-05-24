// Service-side entry point — providers browse Connectors and request a
// paid spotlight. Each Connector has a rate card (per IG / TikTok post) set
// during their apply flow. When a provider requests, the Connector can
// accept at rate-card price, counter at a lower price (savings shown to
// provider), or decline.
//
// Phase 1: placeholder list + waitlist. The full request/negotiate flow
// (Phase 2) needs the spotlight_requests table (schema v10) + inbox
// integration + counter-offer modal — building those incrementally so
// providers can already see what the marketplace will feel like.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';

function fmtFollowers(n) {
  if (!Number.isFinite(+n) || n == null) return '—';
  const x = +n;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (x >= 1_000)     return `${(x / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(x);
}
function fmtPriceCents(cents) {
  if (cents == null) return null;
  const n = cents / 100;
  // Show whole-dollar prices without trailing .00 ("$25" not "$25.00").
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

export function BrowseConnectorsScreen() {
  const navigate = useNavigate();
  const { showToast } = useOutletContext();
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabaseReady) { setLoading(false); return; }
    (async () => {
      // Fetch any profile that has at least one social connected + a rate
      // set. Ordered by total reach (IG + TT followers) descending.
      // RLS: profiles table is publicly readable for these columns.
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id, display_name,
          instagram_handle, instagram_followers,
          tiktok_handle,    tiktok_followers,
          spotlight_price_instagram_cents,
          spotlight_price_tiktok_cents
        `)
        .or('spotlight_price_instagram_cents.not.is.null,spotlight_price_tiktok_cents.not.is.null')
        .limit(50);
      if (error) {
        // RLS or missing columns (v9 not run yet) → soft-fall to empty list.
        // eslint-disable-next-line no-console
        console.warn('[browse-connectors] fetch failed', error);
        setConnectors([]);
      } else {
        setConnectors(data || []);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-white overflow-y-auto pb-24">
      {/* header */}
      <div className="px-5 pt-10 pb-2 flex items-start justify-between gap-4">
        <h1 className="text-[28px] font-extrabold text-black leading-tight">
          Find a Connector<br />to spotlight you
        </h1>
        <button
          onClick={() => navigate('/home')}
          aria-label="Close"
          className="w-9 h-9 rounded-full bg-bg5 flex items-center justify-center text-b2 hover:bg-bdr transition-colors flex-shrink-0"
        >
          ✕
        </button>
      </div>
      <p className="px-5 text-[14px] text-b3 mt-1 leading-relaxed">
        Connectors set a rate card per post. You can also ask any Connector
        for a lower price — they're often willing for the right service.
      </p>

      {loading ? (
        <p className="px-5 mt-10 text-[14px] text-b3">Loading Connectors…</p>
      ) : connectors.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-6 flex flex-col">
          {connectors.map(c => (
            <ConnectorRow
              key={c.id}
              connector={c}
              onClick={() => showToast('Spotlight requests launch next — full counter-offer flow is being built.')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectorRow({ connector: c, onClick }) {
  const igReach  = c.instagram_followers || 0;
  const ttReach  = c.tiktok_followers || 0;
  const totalReach = igReach + ttReach;
  const igPrice = fmtPriceCents(c.spotlight_price_instagram_cents);
  const ttPrice = fmtPriceCents(c.spotlight_price_tiktok_cents);
  const initials = ((c.display_name || c.instagram_handle || c.tiktok_handle || '?')[0] || '?').toUpperCase();

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-5 py-4 flex items-start gap-3 text-left hover:bg-bg5/30 transition-colors border-b border-bdr"
    >
      <div className="w-12 h-12 rounded-full bg-bg5 flex items-center justify-center text-black text-[16px] font-extrabold flex-shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[16px] font-extrabold text-black leading-tight truncate">
          {c.display_name || `@${c.instagram_handle || c.tiktok_handle}`}
        </p>
        <p className="text-[13px] text-b3 mt-0.5 truncate">
          {c.instagram_handle && <>IG @{c.instagram_handle}</>}
          {c.instagram_handle && c.tiktok_handle && ' · '}
          {c.tiktok_handle && <>TT @{c.tiktok_handle}</>}
          {totalReach > 0 && <> · {fmtFollowers(totalReach)} total reach</>}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {igPrice && (
            <span className="bg-gl text-gd rounded-pill px-2.5 py-0.5 text-[12px] font-extrabold">
              IG · {igPrice}/post
            </span>
          )}
          {ttPrice && (
            <span className="bg-gl text-gd rounded-pill px-2.5 py-0.5 text-[12px] font-extrabold">
              TT · {ttPrice}/post
            </span>
          )}
          {!igPrice && !ttPrice && (
            <span className="bg-bg5 text-b2 rounded-pill px-2.5 py-0.5 text-[12px] font-extrabold">
              Free swap only
            </span>
          )}
        </div>
      </div>
      <svg width="10" height="16" viewBox="0 0 11 18" fill="none" className="flex-shrink-0 mt-2">
        <path d="M1.5 1.5L9 9l-7.5 7.5" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-black/60" />
      </svg>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="px-5 mt-10 text-center">
      <div className="w-16 h-16 rounded-full bg-gl flex items-center justify-center mx-auto mb-4">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
             stroke="#3D8B00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </div>
      <h2 className="text-[20px] font-extrabold text-black mb-2">No Connectors with rates yet</h2>
      <p className="text-[14px] text-b3 leading-relaxed">
        Connectors are setting their spotlight rates over the next few days.
        Check back soon — or invite Connectors you already know.
      </p>
    </div>
  );
}
