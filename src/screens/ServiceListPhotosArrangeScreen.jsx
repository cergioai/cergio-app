// Per design-spec.md — review/arrange uploaded photos before saving.
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';

// Fallback for users who land here directly (e.g. dev URL) without picking
// photos. The real flow passes location.state.tiles from PhotosPick.
const FALLBACK_TILES = ['fv-jamie', 'fv-john', 'fv-steve', 'fv-jamie'];

export function ServiceListPhotosArrangeScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { updateListingDraft } = useOutletContext();

  const tiles = (location.state?.tiles && location.state.tiles.length > 0)
    ? location.state.tiles
    : FALLBACK_TILES;
  const cover = tiles[0];
  const rest  = tiles.slice(1);

  return (
    <div className="flex-1 flex flex-col bg-white pb-24">
      {/* top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-bold w-9 h-9 flex items-center justify-center"
        >
          ‹
        </button>
        <button className="border border-black rounded-[20px] px-5 py-2 flex items-center gap-2
                           text-[14px] font-extrabold text-black">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          Upload more
        </button>
      </div>

      {/* labels */}
      <div className="px-5 pb-3">
        <p className="text-[18px] font-extrabold text-black">Looking good!</p>
        <p className="text-[14px] text-b3">Drag to re-order</p>
      </div>

      {/* gallery */}
      <div className="px-4 pt-2 flex-1 overflow-y-auto">
        {/* cover — first selected tile */}
        <div className={`relative aspect-square rounded-[14px] overflow-hidden mb-3 ${cover}`}>
          <span className="absolute top-3 left-3 bg-white text-black text-[12px] font-extrabold px-3 py-1.5 rounded">
            Cover media
          </span>
          <button className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90
                             flex items-center justify-center text-black">⋯</button>
        </div>
        {/* small grid — remaining selected tiles */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {rest.map((bg, i) => (
            <div key={i} className={`relative aspect-square rounded-[14px] overflow-hidden ${bg}`}>
              <button className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90
                                 flex items-center justify-center text-black text-sm">⋯</button>
            </div>
          ))}
          {/* add slot */}
          <button
            onClick={() => navigate('/list-service/photos-pick')}
            className="aspect-square rounded-[14px] border-2 border-dashed border-bdr
                       flex items-center justify-center text-b3"
            aria-label="Add more photos"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 16l5-5 5 5 4-4 4 4" />
            </svg>
          </button>
        </div>
      </div>

      {/* progress + save */}
      <div className="fixed bottom-[68px] left-1/2 -translate-x-1/2 w-full max-w-[390px] h-[3px] bg-bdr">
        <div className="h-full bg-g" style={{ width: '85%' }} />
      </div>
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-white px-5 py-4 flex justify-end">
        <button
          onClick={() => {
            // Persist the cover into the listing draft so createService writes
            // the right photo_class when the listing is saved.
            updateListingDraft({ photoClass: cover });
            navigate('/list-service/setup');
          }}
          className="bg-g text-white rounded-[24px] px-10 py-3.5 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Save
        </button>
      </div>
    </div>
  );
}
