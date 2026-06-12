// Per design-spec.md — review/arrange uploaded photos before saving.
// Receives location.state.photos = [{url, file}] from ServiceListPhotosPickScreen.
// Renders real <img> previews, lets the user remove individual photos,
// and persists the array to listingDraft so the setup/verify flow can upload them.
import { useState } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';

export function ServiceListPhotosArrangeScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { updateListingDraft } = useOutletContext();

  // location.state.photos comes from ServiceListPhotosPickScreen.
  // Each entry: { url: objectURL string, file: File }.
  const [photos, setPhotos] = useState(
    location.state?.photos?.length > 0 ? location.state.photos : []
  );

  const cover = photos[0] || null;
  const rest  = photos.slice(1);

  const removePhoto = (idx) =>
    setPhotos(prev => prev.filter((_, i) => i !== idx));

  return (
    <div className="flex-1 flex flex-col bg-white pb-24">
      {/* top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-extrabold w-9 h-9 flex items-center justify-center"
        >‹</button>
        <button
          onClick={() => navigate('/list-service/photos-pick', { state: { photos } })}
          className="border border-black rounded-[20px] px-5 py-2 flex items-center gap-2
                     text-body font-extrabold text-black"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          Upload more
        </button>
      </div>

      {/* heading */}
      <div className="px-5 pb-3">
        <p className="text-heading-2 font-extrabold text-black">Looking good!</p>
        <p className="text-body text-b3">
          {photos.length > 1 ? 'First photo is your cover' : 'Your cover photo'}
        </p>
      </div>

      {/* gallery */}
      <div className="px-4 pt-2 flex-1 overflow-y-auto">

        {/* cover — large square */}
        {cover ? (
          <div className="relative aspect-square rounded-[14px] overflow-hidden mb-3 bg-bg5">
            <img
              src={cover.url}
              alt="Cover"
              className="w-full h-full object-cover"
            />
            <span className="absolute bottom-3 left-3 bg-white/95 text-black text-meta
                             font-extrabold px-3 py-1.5 rounded-pill">
              Cover media
            </span>
            <button
              onClick={() => removePhoto(0)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90
                         flex items-center justify-center text-black text-lg leading-none"
            >×</button>
          </div>
        ) : (
          <div className="relative aspect-square rounded-[14px] border-2 border-dashed
                          border-bdr mb-3 flex flex-col items-center justify-center gap-2">
            <p className="text-body-sm text-b3">No photo selected</p>
            <button
              onClick={() => navigate('/list-service/photos-pick')}
              className="text-body-sm font-extrabold text-g underline underline-offset-2"
            >Pick photos</button>
          </div>
        )}

        {/* small grid — additional photos */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {rest.map((p, i) => (
            <div key={i} className="relative aspect-square rounded-[14px] overflow-hidden bg-bg5">
              <img src={p.url} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => removePhoto(i + 1)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90
                           flex items-center justify-center text-black text-sm leading-none"
              >×</button>
            </div>
          ))}

          {/* add-more slot */}
          <button
            onClick={() => navigate('/list-service/photos-pick', { state: { photos } })}
            className="aspect-square rounded-[14px] border-2 border-dashed border-bdr
                       flex items-center justify-center text-b3"
            aria-label="Add more photos"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 16l5-5 5 5 4-4 4 4" />
            </svg>
          </button>
        </div>
      </div>

      {/* progress bar */}
      <div className="fixed bottom-[68px] left-1/2 -translate-x-1/2 w-full max-w-[390px] h-[3px] bg-bdr">
        <div className="h-full bg-g" style={{ width: '85%' }} />
      </div>

      {/* save button */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-white px-5 py-4 flex justify-end">
        <button
          onClick={() => {
            // Persist photos into listingDraft so the setup/verify screens
            // can upload them when the service is created.
            updateListingDraft({ photos });
            navigate('/list-service/setup');
          }}
          disabled={!cover}
          className={`rounded-[24px] px-10 py-3.5 text-body-lg font-extrabold transition-all
            ${cover
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          Save
        </button>
      </div>
    </div>
  );
}
