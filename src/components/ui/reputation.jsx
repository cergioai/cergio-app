// CERGIO-GUARD (2026-06-25, Tarik — SPEC-49g): SHARED reputational-stream
// primitives. Trust, mutuals, reco-network size, and social reach are Cergio's
// core differentiator and must read identically anywhere a person or a
// recommendation appears (profile, PDP, results cards, request previews, feed).
// Centralised here so every surface uses the SAME logic + type treatment — no
// per-screen reinvention (SPEC-48b DRY rule). No fake data (SPEC-12): every
// number is real or the element collapses.

export function firstNameOf(n) { return (n || '').trim().split(/\s+/)[0] || ''; }

// Compact follower/network count — 12.3K, 1.1M.
export function compactN(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 ? 1 : 0) + 'K';
  return String(n);
}

// Trust-first reco byline — names the VIEWER's own connections FIRST:
// "Reco'd by you and your friend Jason + 4 more", falling back to plain counts
// ("Reco'd by 5 friends and 1 Connector") when the viewer shares no one.
// `s` = { total, friends, connectors, mutualNames[], viewerRecommended }.
export function recoByline(s) {
  if (!s || !s.total) return null;
  const mutuals = (s.mutualNames || []).map(firstNameOf).filter(Boolean);
  const you = !!s.viewerRecommended;
  if (you || mutuals.length) {
    const named = (you ? 1 : 0) + mutuals.length;
    const others = Math.max(0, s.total - named);
    let core;
    if (mutuals.length === 0) core = 'You';
    else if (mutuals.length === 1) core = you ? `you and your friend ${mutuals[0]}` : `your friend ${mutuals[0]}`;
    else {
      const list = mutuals.length === 2
        ? `${mutuals[0]} and ${mutuals[1]}`
        : `${mutuals.slice(0, 2).join(', ')} and ${mutuals.length - 2} more`;
      core = you ? `you, ${list}` : `your friends ${list}`;
    }
    let txt = `Reco'd by ${core}`;
    if (others > 0) txt += ` + ${others} more`;
    return txt;
  }
  const parts = [];
  if (s.friends > 0) parts.push(`${s.friends} ${s.friends === 1 ? 'friend' : 'friends'}`);
  if (s.connectors > 0) parts.push(`${s.connectors} ${s.connectors === 1 ? 'Connector' : 'Connectors'}`);
  return `Reco'd by ${parts.join(' and ') || s.total}`;
}

// One-line social reach for a person — "12.3K IG · 40 network". Collapses when
// the person has no IG/TikTok and no Cergio network.
export function SocialReachLine({ counts, className = '' }) {
  if (!counts) return null;
  const ig = Number(counts.igFollowers) || 0;
  const tt = Number(counts.ttFollowers) || 0;
  const net = Number(counts.networkCount) || 0;
  const parts = [];
  if (ig > 0) parts.push(`${compactN(ig)} IG`);
  else if (tt > 0) parts.push(`${compactN(tt)} TikTok`);
  if (net > 0) parts.push(`${net} network`);
  if (!parts.length) return null;
  return <p className={`text-meta-sm text-b3 font-semibold leading-none mt-0.5 ${className}`}>{parts.join(' · ')}</p>;
}

// SOLID Connector chip — the verified-Connector badge, used consistently
// everywhere (SPEC-49g: solid, not the soft mint pill).
export function ConnectorChip({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 bg-g text-white text-meta-sm font-extrabold px-2 py-0.5 rounded-pill leading-none ${className}`}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" /></svg>
      Connector
    </span>
  );
}

// "In your network" mutual badge — the trust signal (green).
export function MutualBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-0.5 text-meta-sm text-gd font-extrabold ${className}`}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h8v-2.5c0-.9.3-1.7.9-2.4A12 12 0 0 0 8 13zm8 0c-.4 0-.9 0-1.4.1a4.3 4.3 0 0 1 1.4 3.1V19h7v-2.5c0-2.3-4.7-3.5-7-3.5z"/>
      </svg>
      In your network
    </span>
  );
}

// TrustStream — the HEADLINE reputational strip (mutuals · on-Cergio · recos).
// This is THE differentiator, so it uses a superior type scale (big numerals
// that POP) and leads with mutuals-with-the-viewer. Each stat collapses when
// zero; the whole strip collapses when there's no signal at all.
// `counts` = one entry from getInboxPartyCounts. `recoKind`: 'received' (a
// provider — people who reco them) or 'made' (a connector — recos they've made).
export function TrustStream({ counts, recoKind = 'received', className = '' }) {
  if (!counts) return null;
  const network = Number(counts.networkCount) || 0;
  const recos = Number(recoKind === 'made' ? counts.recosMade : counts.recosReceived) || 0;
  const mutual = Number(counts.mutualCount) || 0;
  const stats = [];
  if (mutual > 0) stats.push({ n: mutual, label: mutual === 1 ? 'mutual with you' : 'mutuals with you', hot: true });
  if (network > 0) stats.push({ n: network, label: 'on Cergio' });
  if (recos > 0) stats.push({ n: recos, label: recoKind === 'made' ? (recos === 1 ? 'reco made' : 'recos made') : (recos === 1 ? 'reco' : 'recos') });
  if (!stats.length) return null;
  return (
    <div className={`flex items-stretch gap-2 ${className}`}>
      {stats.map((s, i) => (
        <div
          key={i}
          className={`flex-1 rounded-[14px] px-3 py-2.5 border text-left ${s.hot ? 'bg-gl border-g/30' : 'bg-white border-line'}`}
        >
          <p className={`text-display-2 font-black leading-none ${s.hot ? 'text-g' : 'text-black'}`}>{compactN(s.n)}</p>
          <p className="text-meta-sm text-b3 font-semibold mt-1 leading-tight">{s.label}</p>
        </div>
      ))}
    </div>
  );
}
