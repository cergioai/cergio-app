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
      <span className="text-[11px] font-bold text-danger">
        ${Math.abs(savings)} over budget
      </span>
    );
  }
  return (
    <span className="text-[11px] font-bold text-gd">
      Saves ${savings}
    </span>
  );
}

function FriendAvatars({ friends }) {
  if (!friends || friends.length === 0) return null;
  const initials = friends.slice(0, 3).map(f => f.slice(0, 2).toUpperCase());
  const colors = [
    'bg-gradient-to-br from-[#b06090] to-[#703050]',
    'bg-gradient-to-br from-[#4478aa] to-[#2a5070]',
    'bg-gradient-to-br from-g to-gd',
  ];
  return (
    <div className="flex">
      {initials.map((ini, i) => (
        <div
          key={i}
          className={`w-[22px] h-[22px] rounded-full border-2 border-cr text-white text-[8px] font-bold
                      ${colors[i]} ${i > 0 ? '-ml-1.5' : ''}`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {ini}
        </div>
      ))}
    </div>
  );
}

export function ProviderCard({ provider, onBook, onSave }) {
  const { name, category, bio, price, recos, rainmakers, friends, savings, pick, photoClass } = provider;

  const recoText = () => {
    if (!friends || friends.length === 0) return null;
    const fStr = friends.join(', ');
    const rmStr = rainmakers > 0 ? ` and ${rainmakers} Rainmakers` : '';
    return `Reco'd by ${fStr}${rmStr}`;
  };

  return (
    <div className="mb-5">
      {/* ── PHOTO ── */}
      <div
        className={`relative mx-4 h-[210px] rounded-2xl overflow-hidden cursor-pointer
                    ${PHOTO_BG[photoClass] || PHOTO_BG['fv-jamie']}`}
        onClick={() => onBook(provider)}
      >
        {/* light overlay for depth */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />

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
                           text-[10px] font-bold uppercase tracking-wide
                           px-2.5 py-1 rounded-pill z-10">
            Cergio Pick
          </span>
        )}

        {/* over/save on photo for non-pick cards */}
        {!pick && savings !== 0 && (
          <span
            className={`absolute top-2.5 right-2.5 text-[11px] font-bold
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
        {/* Cergio Pick label above name */}
        {pick && (
          <div className="mb-1.5">
            <span className="inline-block bg-g text-white text-[10px] font-bold
                             uppercase tracking-wide px-2.5 py-0.5 rounded-pill">
              Cergio Pick
            </span>
          </div>
        )}

        {/* ROW 1 — Name · Recos */}
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-[17px] font-extrabold text-black">{name}</span>
          <span className="text-[13px] font-bold text-black">{recos} Recos</span>
        </div>

        {/* ROW 2 — Category · Price */}
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-[13px] text-b3 font-medium">{category}</span>
          <span className="text-[17px] font-extrabold text-black">${price}</span>
        </div>

        {/* ROW 3 — Bio · Savings */}
        <div className="flex justify-between items-start mb-2">
          <span className="text-[12px] text-b3 font-normal flex-1 pr-3 leading-snug">{bio}</span>
          <SavingsLabel savings={savings} />
        </div>

        {/* Reco line */}
        {recoText() ? (
          <div className="flex items-center gap-2 mb-3">
            <FriendAvatars friends={friends} />
            <p className="text-[12px] italic text-b2 leading-snug">{recoText()}</p>
          </div>
        ) : (
          <p className="text-[12px] text-b3 mb-3">No mutual friends yet</p>
        )}

        {/* Book button */}
        <button
          onClick={() => onBook(provider)}
          className={`w-full rounded-pill py-3 text-[14px] font-extrabold transition-opacity
                      active:scale-[.98] ${pick
                        ? 'bg-g text-white hover:opacity-90'
                        : 'bg-transparent border border-bdr text-black hover:bg-bg5'}`}
        >
          Book {name} · ${price} ↗
        </button>
      </div>

      {/* divider */}
      <hr className="mx-4 mt-4 border-bdr" />
    </div>
  );
}
