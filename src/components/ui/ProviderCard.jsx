import { Link } from 'react-router-dom';

// Photo background classes — CSS gradients, no external images
const PHOTO_BG = {
  'fv-jamie': 'bg-gradient-to-br from-[#e8dcc8] via-[#b89870] to-[#604030]',
  'fv-john':  'bg-gradient-to-br from-[#dce8f0] via-[#88a8c4] to-[#2c5070]',
  'fv-steve': 'bg-gradient-to-br from-[#ede4d4] via-[#b8a078] to-[#584028]',
};

function SavingsLabel({ savings }) {
  if (!savings || savings === 0) return null;
  if (savings < 0) {
    return (
      <span className="text-meta-sm font-bold text-danger">
        ${Math.abs(savings)} over budget
      </span>
    );
  }
  return (
    <span className="text-meta-sm font-bold text-gd">
      Saves ${savings}
    </span>
  );
}

// CERGIO-GUARD (2026-05-30): when recommenders[] (full objects with
// id+name) is provided, render each avatar as a Link to /u/{id}.
// Falls back to friends[] (strings only) for legacy/mock paths.
function FriendAvatars({ friends, recommenders }) {
  const colors = [
    'bg-gradient-to-br from-[#b06090] to-[#703050]',
    'bg-gradient-to-br from-[#4478aa] to-[#2a5070]',
    'bg-gradient-to-br from-g to-gd',
  ];
  const initialsOf = (s) => (s || '?').slice(0, 2).toUpperCase();
  const cls = (i) =>
    `w-[22px] h-[22px] rounded-full border-2 border-cr text-white text-[8px] font-bold
     ${colors[i]} ${i > 0 ? '-ml-1.5' : ''} flex items-center justify-center`;

  if (recommenders && recommenders.length > 0) {
    const visible = recommenders.slice(0, 3);
    return (
      <div className="flex">
        {visible.map((r, i) => (
          r.id ? (
            <Link
              key={r.id}
              to={`/u/${r.id}`}
              aria-label={`View ${r.name || 'profile'}`}
              onClick={(e) => e.stopPropagation()}
              className={cls(i)}
            >
              {initialsOf(r.name)}
            </Link>
          ) : (
            <div key={i} className={cls(i)}>{initialsOf(r.name)}</div>
          )
        ))}
      </div>
    );
  }

  if (!friends || friends.length === 0) return null;
  const ini = friends.slice(0, 3).map(f => initialsOf(f));
  return (
    <div className="flex">
      {ini.map((s, i) => (
        <div key={i} className={cls(i)}>{s}</div>
      ))}
    </div>
  );
}

export function ProviderCard({ provider, onBook, onSave, onOpen }) {
  const { name, category, bio, price, recos, connectors, friends, savings, pick, photoClass, coverUrl,
          friendCount = 0, connectorCount = 0, leadFriendName = null,
          // CERGIO-GUARD (2026-05-30): full recommender objects (id+name)
          // — used to render the FriendAvatars as Links to /u/{id}.
          recommendersRaw = null,
          // CERGIO-GUARD (2026-06-03): counter-offer plumbing per Tarik.
          // When a provider countered the user's request with a price,
          // the card strikes through the official rate and shows the
          // counter price in green, plus a line like "Maria countered
          // with $5". officialPrice is the headline rate; price is now
          // ALREADY the effective (counter) price when a counter exists.
          officialPrice = null, counterPriceCents = null,
          counterStatus = null, responderFirstName = null } = provider;
  const hasCounter = counterStatus === 'countered' && counterPriceCents != null;

  // CERGIO-GUARD (2026-05-30): reco line format:
  //   "Reco'd by Jennifer Hu, 3 other friends and 21 Connectors"
  // Anchored on a NAMED lead friend (when one exists in your network),
  // then count of remaining friends ("X other friends"), then count of
  // Connectors. Connector-only services (no friends) still read cleanly:
  // "Reco'd by 21 Connectors". Falls back to the legacy `friends`-only
  // shape for cards seeded via the old single-friend hint.
  const recoText = () => {
    const parts = [];
    if (leadFriendName) {
      parts.push(leadFriendName);
      const otherFriends = Math.max(0, friendCount - 1);
      if (otherFriends > 0) {
        parts.push(`${otherFriends} other ${otherFriends === 1 ? 'friend' : 'friends'}`);
      }
    } else if (friendCount > 0) {
      parts.push(`${friendCount} ${friendCount === 1 ? 'friend' : 'friends'}`);
    }
    if (connectorCount > 0) {
      parts.push(`${connectorCount} ${connectorCount === 1 ? 'Connector' : 'Connectors'}`);
    }
    if (parts.length === 0) {
      // Legacy fallback — old codepath populated `friends` without
      // friendCount/connectorCount; preserve the previous behaviour.
      if (!friends || friends.length === 0) return null;
      const fStr = friends.join(', ');
      const rmStr = connectors > 0 ? ` and ${connectors} Connectors` : '';
      return `Reco'd by ${fStr}${rmStr}`;
    }
    // Natural-language join with "and" before the last clause.
    const last = parts.pop();
    return parts.length > 0
      ? `Reco'd by ${parts.join(', ')} and ${last}`
      : `Reco'd by ${last}`;
  };

  // CERGIO-GUARD (2026-05-29): photo tap now opens the PDP (provider
  // detail) screen instead of jumping straight to booking. The Book
  // button below remains the fast-path for users who already know they
  // want to book. Falls back to onBook if onOpen isn't wired (legacy
  // mock-data demo flow).
  const handleOpen = () => (onOpen ? onOpen(provider) : onBook(provider));

  return (
    <div className="mb-5">
      {/* ── PHOTO ── CERGIO-GUARD: real cover_url wins over the legacy
            CSS-gradient photoClass when set. Falls back to the gradient
            when no real photo is available so existing seeded rows still
            render. img tag uses object-cover + lazy loading. */}
      <div
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); } }}
        className={`relative mx-4 h-[210px] rounded-2xl overflow-hidden cursor-pointer cg-tap
                    ${coverUrl ? 'bg-bg5' : (PHOTO_BG[photoClass] || PHOTO_BG['fv-jamie'])}`}
        onClick={handleOpen}
      >
        {coverUrl && (
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        {/* light overlay for depth — adds readability for badges/buttons */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/20" />

        {/* heart */}
        <button
          onClick={e => { e.stopPropagation(); onSave?.(provider); }}
          className="absolute top-2.5 left-2.5 w-8 h-8 rounded-full bg-white/85
                     flex items-center justify-center text-sm z-10 border-none"
        >
          ♡
        </button>

        {/* play */}
        <button
          onClick={e => e.stopPropagation()}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                     w-11 h-11 rounded-full bg-white/85 flex items-center justify-center
                     text-base pl-0.5 z-10 border-none cursor-pointer"
        >
          ▶
        </button>

        {/* pick badge */}
        {pick && (
          <span className="absolute top-2.5 right-2.5 bg-g text-white
                           text-caps font-bold uppercase tracking-wide
                           px-2.5 py-1 rounded-pill z-10">
            Cergio Pick
          </span>
        )}

        {/* over/save on photo for non-pick cards */}
        {!pick && savings !== 0 && (
          <span
            className={`absolute top-2.5 right-2.5 text-meta-sm font-bold
                        px-2.5 py-1 rounded-pill z-10
                        ${savings < 0
                          ? 'bg-red-50/95 text-danger'
                          : 'bg-gl/95 text-gd'}`}
          >
            {savings < 0 ? `$${Math.abs(savings)} over budget` : `Saves $${savings}`}
          </span>
        )}
      </div>

      {/* ── CONTENT ── */}
      <div className="px-4 pt-3 pb-1">
        {/* CERGIO-GUARD (2026-05-30): the "Cergio Pick" label above the
            name was a DUPLICATE of the green pill anchored top-right
            on the photo above (the same `pick` flag rendered both).
            Removed per Tarik: "remove one of the cergio's pick's tags
            ... its duplicated". The photo overlay stays — it's more
            visible and reads as a Featured badge over the cover. */}

        {/* ROW 1 — Name · Recos */}
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-heading-2 font-extrabold text-black">{name}</span>
          <span className="text-body-sm font-bold text-black">{recos} Recos</span>
        </div>

        {/* ROW 2 — Category · Price.
            CERGIO-GUARD (2026-06-03): when the provider countered with
            a price, strike through the official rate and show the
            counter in green so the user sees the offer they got. */}
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-body-sm text-b3 font-medium">{category}</span>
          {hasCounter ? (
            <span className="flex items-baseline gap-2">
              <span className="text-body-sm text-b3 font-bold line-through">${officialPrice || price}</span>
              <span className="text-heading-2 font-extrabold text-gd">${price}</span>
            </span>
          ) : (
            <span className="text-heading-2 font-extrabold text-black">${price}</span>
          )}
        </div>
        {hasCounter && responderFirstName && (
          <p className="text-meta-sm font-extrabold text-gd leading-snug mb-1">
            {responderFirstName} countered with ${price}
          </p>
        )}

        {/* ROW 3 — Bio · Savings */}
        <div className="flex justify-between items-start mb-2">
          <span className="text-meta text-b3 font-normal flex-1 pr-3 leading-snug">{bio}</span>
          <SavingsLabel savings={savings} />
        </div>

        {/* Reco line — Phase 3d (2026-05-31): converted from italic
            inline text to a mint pill matching the Jennifer L SRP
            mockup. Pill anchors bottom-left of the content block, sits
            inline with the avatar stack. Reads "Reco'd by Jennifer Hu,
            3 other friends and 21 Connectors" in green-dark on a
            green-light wash, with a shield glyph echoing the Connector
            badge from the PDP. Empty case stays as muted body copy so
            cards without friend recos don't render a hollow pill. */}
        {recoText() ? (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <FriendAvatars friends={friends} recommenders={recommendersRaw} />
            <span className="inline-flex items-center gap-1.5 bg-gl rounded-pill px-2.5 py-1
                             text-meta-sm font-extrabold text-gd leading-none">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.4" aria-hidden="true">
                <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
              </svg>
              {recoText()}
            </span>
          </div>
        ) : (
          <p className="text-meta text-b3 mb-3">No mutual friends yet</p>
        )}

        {/* Book button — Phase 4 (2026-05-31): standardized to .cg-cta
            for primary fill, .cg-cta-ghost for outline. Both pick up
            hover opacity, active scale, and focus-visible mint ring
            from the global components layer. */}
        <button
          onClick={() => onBook(provider)}
          className={`w-full rounded-pill py-3 text-body font-extrabold
                      ${pick
                        ? 'bg-g text-white cg-cta'
                        : 'bg-transparent border border-bdr text-black cg-cta-ghost'}`}
        >
          Book {name} · ${price} ↗
        </button>
      </div>

      {/* divider */}
      <hr className="mx-4 mt-4 border-bdr" />
    </div>
  );
}
