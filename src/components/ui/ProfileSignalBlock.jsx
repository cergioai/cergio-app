// CERGIO-GUARD (2026-06-18, Tarik — SPEC-49 / SPEC-49e): the unified profile's
// LEAD identity block. Replicates the interim /inbound accept screen's identity
// block EXACTLY so a profile reads the same on the full page as on the request
// preview. Structure for a Connector subject (Tarik's exact spec):
//
//   Connector                                  (badge)
//   Fitness Pro and Creator..                  (headline)
//   319 IG followers                           (reach line, IG icon)
//   5 network on Cergio · 5 reco's made        (strength line)
//   See Instagram                              (link)
//   Creator in fitness sports … Love to surf   (bio)
//   Plumber (0 recos received)                 (service facet, if they list one)
//   You have no mutual friends with T yet.     (mutuals line)
//
// A pure service (non-Connector) leads with the service facet instead. Data
// comes from getInboxPartyCounts (the SAME source as the request previews) plus
// the profile's bio / IG handle / name passed down. No fake data (SPEC-12).
import { formatKeyCounts } from '../../hooks/usePartyCounts';
import { mutualNamesText, TrustStream } from './reputation';

function ShieldIcon({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" />
    </svg>
  );
}

function IgGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2" aria-hidden="true" className="shrink-0">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="#3D8B00" stroke="none" />
    </svg>
  );
}

// counts: one entry from getInboxPartyCounts (igFollowers, ttFollowers,
// networkCount, recosMade, recosReceived, mutualCount, isConnector).
// isService / isConnector: the subject's roles. serviceMode: viewer is a
// provider (true) vs consumer (false) — retained for the booking nuance but a
// Connector always leads with reach. bio / igHandle / name: from the profile.
export function ProfileSignalBlock({ counts, role, isService, isConnector, serviceMode, headline, bio, igHandle, name, mutualNames }) {
  if (!counts || (!isService && !isConnector)) return null;

  // A Connector subject ALWAYS leads with the Connector/reach identity, exactly
  // like the interim /inbound screen ("not plumber then connector"). serviceMode
  // is kept for the consumer/booking nuance but never demotes a Connector.
  const connectorLeads = isConnector || serviceMode;

  const igFollowers = counts.igFollowers || 0;
  const ttFollowers = counts.ttFollowers || 0;
  const networkCount = counts.networkCount || 0;
  const recosMade = counts.recosMade || 0;
  const recosReceived = counts.recosReceived || 0;
  const mutualCount = counts.mutualCount || 0;
  const firstName = (name || 'them').split(' ')[0];

  // Reach line — "319 IG followers" (+ "1.2K TikTok"). Full count via formatter
  // for K/M shaping; shown with the IG glyph, bold.
  const reachLine = [
    igFollowers > 0 ? `${Number(igFollowers).toLocaleString()} IG followers` : null,
    ttFollowers > 0 ? `${formatKeyCounts({ ttFollowers }, { recoKind: 'made', includeMutual: false, includeReco: false, includeNetwork: false })}` : null,
  ].filter(Boolean).join(' · ');

  const igLink = igHandle ? (
    <a
      href={`https://instagram.com/${String(igHandle).replace(/^@/, '')}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block text-body-sm text-gd font-extrabold underline underline-offset-2 hover:opacity-80 mt-3"
    >
      See Instagram
    </a>
  ) : null;

  // Airbnb type ramp (design-spec "Lead identity card"): readable sizes, real
  // jumps, 12px (mt-3) between distinct blocks. Reading content (headline, bio)
  // is body (14/16) — NEVER meta — so it doesn't read as "too small". Metrics use
  // the shared inline TrustStream (bold number + quiet label). Mutuals are the one
  // green trust line, NAMED.

  // Bio — primary reading prose at body (14), relaxed. (Was body-sm/13 — too small
  // per Tarik's Airbnb feedback.)
  const bioEl = bio ? (
    <p className="text-body text-b2 leading-relaxed mt-3">{bio}</p>
  ) : null;

  // SOLID Connector badge (Tarik 2026-06-25: "make the Connector badge solid").
  const connectorBadge = (
    <span className="inline-flex items-center gap-1 bg-g text-white text-meta-sm font-extrabold px-2.5 py-1 rounded-pill leading-none">
      <ShieldIcon size={10} />Connector
    </span>
  );

  // Reach line — "319 IG followers" — bold black, the loudest metric.
  const reachEl = reachLine ? (
    <p className="flex items-center gap-1.5 text-body font-extrabold text-black mt-3">
      <IgGlyph />{reachLine}
    </p>
  ) : null;

  // Trust stream — "5 on Cergio · 5 recos made" via the SHARED primitive so it
  // reads identically to the PDP / request previews (no per-screen restyle). The
  // mutual stat is stripped here because it gets its own NAMED green line below.
  const trustEl = (
    <div className="mt-2">
      <TrustStream counts={{ ...counts, mutualCount: 0 }} recoKind="made" />
    </div>
  );

  // Service-type line — green bold, its own distinct weight/color, body size.
  const serviceLine = isService ? (
    <p className="text-body leading-snug mt-3">
      <span className="font-extrabold text-gd">{role || 'Service'}</span>
      <span className="text-b3 font-medium"> · {recosReceived} reco{recosReceived === 1 ? '' : 's'} received</span>
    </p>
  ) : null;

  // Headline — secondary identity at body (14), medium-gray (distinct from the
  // black name above and the bio prose). Was meta/12 — read as cramped.
  const headlineEl = headline ? (
    <p className="mt-2 text-body text-b2 font-medium leading-snug">{headline}</p>
  ) : null;

  // Mutuals — GREEN, the trust signal, at body-sm. NAMES the people ("1 mutual
  // friend in common — Jane") rather than a bare count (Tarik 2026-06-25).
  const mutualLine = (
    <p className="text-body-sm font-semibold leading-snug mt-3 text-gd">
      {mutualCount > 0
        ? (mutualNamesText(mutualNames, mutualCount) || `${mutualCount} mutual ${mutualCount === 1 ? 'friend' : 'friends'} in common`)
        : <span className="text-b3 font-medium">You have no mutual friends with {firstName} yet.</span>}
    </p>
  );

  return (
    <div className="mx-5 mt-3 bg-white border border-line rounded-[16px] p-5">
      {connectorLeads ? (
        <>
          {connectorBadge}
          {headlineEl}
          {reachEl}
          {trustEl}
          {igLink}
          {bioEl}
          {serviceLine}
          {mutualLine}
        </>
      ) : (
        <>
          {/* Service facet leads with role, but ALWAYS carries the social-reach
              stream now (Tarik 2026-06-25: "next to connectors add social data
              — # Cergio network, IG if any"). reverses SPEC-49b. */}
          <p className="text-heading-2 font-extrabold text-black leading-snug">
            {role || 'Service'}
            <span className="text-body-sm text-b3 font-medium"> · {recosReceived} reco{recosReceived === 1 ? '' : 's'} received</span>
          </p>
          {headlineEl}
          {reachEl}
          {trustEl}
          {igLink}
          {bioEl}
          {mutualLine}
        </>
      )}
    </div>
  );
}
