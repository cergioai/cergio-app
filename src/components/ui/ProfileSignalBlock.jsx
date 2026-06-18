// CERGIO-GUARD (2026-06-16, Tarik — SPEC-49): the unified profile's LEAD signal
// block. Copies the interim pre-acceptance party-signal from the request
// previews (same getInboxPartyCounts + formatKeyCounts source) onto the public
// profile, so a profile is judged at a glance with the SAME data and the SAME
// ordering rule as a request card.
//
// A profile can be a SERVICE, a CONNECTOR, or BOTH. When it's both, we show both
// facets and PRIORITIZE by the viewer (SPEC-48c, same rule as request previews):
//   • viewer in CONSUMER mode (looking to book)   → SERVICE facet first
//   • viewer in PROVIDER mode (marketing service)  → CONNECTOR facet first
//
// Example facets (Tarik 2026-06-16):
//   Connector → "Connector"      · 319 IG · 5 network · 5 recos made · No mutuals
//   Service   → "Hair Stylist · 0 recos received"  ·  No mutuals · 12.4K IG · 3.1K TikTok
import { formatKeyCounts } from '../../hooks/usePartyCounts';

function ShieldIcon({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" />
    </svg>
  );
}

function ConnectorFacet({ counts, prominent, headline }) {
  const line = formatKeyCounts(counts, { recoKind: 'made' });
  return (
    <div className={prominent ? '' : 'mt-2.5 pt-2.5 border-t border-bdr'}>
      <span className="inline-flex items-center gap-1 bg-gl text-gd text-meta-sm font-extrabold px-2 py-0.5 rounded-pill">
        <ShieldIcon size={10} />Connector
      </span>
      {/* Headline — below the Connector badge, above the IG/counts line
          (Tarik 2026-06-17). Only on the lead facet to avoid duplication. */}
      {prominent && headline && (
        <p className="mt-1 text-body-sm text-b2 font-medium leading-snug">{headline}</p>
      )}
      {line && (
        <p className={`mt-1 leading-snug ${prominent ? 'text-body-sm font-extrabold text-black' : 'text-meta text-b2 font-medium'}`}>
          {line}
        </p>
      )}
    </div>
  );
}

function ServiceFacet({ counts, role, prominent, headline }) {
  const recos = counts?.recosReceived || 0;
  // Always-on "N recos received" (service reputation signal) — suppress the
  // duplicate reco chip in the sub-line via includeReco:false. includeReach:false
  // + includeNetwork:false drop IG/TikTok AND the Cergio-network count here
  // (SPEC-49b, Tarik 2026-06-17): reach + network are CONNECTOR signals shown
  // around the connector badge, not relevant on a service (e.g. a plumber),
  // and they were duplicating across both facets. The service facet keeps only
  // the always-on mutuals line (trust) under its "role · N recos received".
  const line = formatKeyCounts(counts, { recoKind: 'received', includeReco: false, includeReach: false, includeNetwork: false });
  return (
    <div className={prominent ? '' : 'mt-2.5 pt-2.5 border-t border-bdr'}>
      <p className={`leading-snug ${prominent ? 'text-body-sm font-extrabold text-black' : 'text-meta text-b2 font-extrabold'}`}>
        {role || 'Service'}
        <span className="text-b3 font-medium"> · {recos} reco{recos === 1 ? '' : 's'} received</span>
      </p>
      {/* Headline under the lead identity (Tarik 2026-06-17), once. */}
      {prominent && headline && (
        <p className="mt-1 text-body-sm text-b2 font-medium leading-snug">{headline}</p>
      )}
      {line && (
        <p className={`mt-0.5 leading-snug ${prominent ? 'text-body-sm text-b2 font-medium' : 'text-meta text-b3 font-medium'}`}>
          {line}
        </p>
      )}
    </div>
  );
}

// counts: one entry from getInboxPartyCounts (igFollowers, ttFollowers,
// networkCount, recosMade, recosReceived, mutualCount, isConnector).
// isService / isConnector: the subject's roles. serviceMode: viewer is a
// provider (true) vs consumer (false) — drives which facet leads.
export function ProfileSignalBlock({ counts, role, isService, isConnector, serviceMode, headline }) {
  if (!counts || (!isService && !isConnector)) return null;

  const connector = isConnector ? <ConnectorFacet key="c" counts={counts} prominent headline={headline} /> : null;
  const service   = isService   ? <ServiceFacet   key="s" counts={counts} role={role} prominent headline={headline} /> : null;

  // Only one role → render that facet alone.
  if (!connector || !service) {
    const only = connector || service;
    return (
      <div className="mx-5 mt-5 bg-white border border-bdr rounded-[16px] p-4">
        {only}
      </div>
    );
  }

  // Both roles → priority facet prominent on top, the other muted below.
  // Provider/marketing viewer leads with the Connector; consumer/booking
  // viewer leads with the Service (SPEC-48c).
  const lead      = serviceMode ? <ConnectorFacet counts={counts} prominent headline={headline} /> : <ServiceFacet counts={counts} role={role} prominent headline={headline} />;
  const secondary = serviceMode ? <ServiceFacet   counts={counts} role={role} /> : <ConnectorFacet counts={counts} />;
  return (
    <div className="mx-5 mt-5 bg-white border border-bdr rounded-[16px] p-4">
      {lead}
      {secondary}
    </div>
  );
}
