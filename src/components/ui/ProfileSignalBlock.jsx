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
export function ProfileSignalBlock({ counts, role, isService, isConnector, serviceMode, headline, bio, igHandle, name }) {
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

  // Strength line — "5 network on Cergio · 5 reco's made" (omit zero parts).
  const strength = [
    networkCount > 0 ? `${networkCount} network on Cergio` : null,
    recosMade > 0 ? `${recosMade} reco${recosMade === 1 ? '' : 's'} made` : null,
  ].filter(Boolean).join(' · ');

  const igLink = igHandle ? (
    <a
      href={`https://instagram.com/${String(igHandle).replace(/^@/, '')}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block text-meta-sm text-gd font-extrabold underline underline-offset-2 hover:opacity-80 mt-0.5"
    >
      See Instagram
    </a>
  ) : null;

  const bioEl = bio ? (
    <p className="text-meta text-b3 leading-snug mt-1">{bio}</p>
  ) : null;

  const serviceLine = isService ? (
    <p className="text-meta-sm text-b3 leading-snug mt-2">
      <span className="font-extrabold text-b2">{role || 'Service'}</span>
      {' '}({recosReceived} reco{recosReceived === 1 ? '' : 's'} received)
    </p>
  ) : null;

  const mutualLine = (
    <p className="text-meta text-b3 leading-snug mt-2">
      {mutualCount > 0
        ? `${mutualCount} mutual ${mutualCount === 1 ? 'friend' : 'friends'} in common`
        : `You have no mutual friends with ${firstName} yet.`}
    </p>
  );

  return (
    <div className="mx-5 mt-5 bg-white border border-bdr rounded-[16px] p-4">
      {connectorLeads ? (
        <>
          <span className="inline-flex items-center gap-1 bg-gl text-gd text-meta-sm font-extrabold px-2 py-0.5 rounded-pill">
            <ShieldIcon size={10} />Connector
          </span>
          {headline && (
            <p className="mt-1 text-body-sm text-b2 font-medium leading-snug">{headline}</p>
          )}
          {reachLine && (
            <p className="flex items-center gap-1 text-body-sm font-extrabold text-black mt-0.5">
              <IgGlyph />{reachLine}
            </p>
          )}
          {strength && <p className="text-meta-sm text-b3 mt-0.5">{strength}</p>}
          {igLink}
          {bioEl}
          {serviceLine}
          {mutualLine}
        </>
      ) : (
        <>
          <p className="text-body-sm font-extrabold text-black leading-snug">
            {role || 'Service'}
            <span className="text-b3 font-medium"> · {recosReceived} reco{recosReceived === 1 ? '' : 's'} received</span>
          </p>
          {headline && (
            <p className="mt-1 text-body-sm text-b2 font-medium leading-snug">{headline}</p>
          )}
          {bioEl}
          {mutualLine}
        </>
      )}
    </div>
  );
}
