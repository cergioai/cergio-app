// Per design-spec.md — real photo picker using device file system.
// Users select images from camera roll or take a new photo; previews
// show inline; minimum 1 photo required to proceed (removed the
// artificial "5" floor since providers may have only 1 cover shot).
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function ServiceListPhotosPickScreen() {
  const navigate  = useNavigate();
  const inputRef  = useRef(null);
  // Each entry: { file: File, url: string (object URL) }
  const [photos, setPhotos] = useState([]);

  const handleFiles = (fileList) => {
    const incoming = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (!incoming.length) return;
    const entries = incoming.map(f => ({ file: f, url: URL.createObjectURL(f) }));
    setPhotos(prev => [...prev, ...entries]);
  };

  const remove = (i) => {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[i].url);          // free memory
      return prev.filter((_, idx) => idx !== i);
    });
  };

  const enough = photos.length >= 1;
  const summary = photos.length === 0
    ? 'Add photos'
    : `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} selected`;

  return (
    <div className="flex-1 flex flex-col bg-white pb-24">
      {/* hidden real file input — accepts images from camera roll or camera */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
      />

      {/* top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-extrabold w-9 h-9 flex items-center justify-center"
        >
          ✕
        </button>
        <p className="text-body-lg font-extrabold text-black">{summary}</p>
        {/* camera-roll / add-more button */}
        <button
          onClick={() => inputRef.current?.click()}
          className="w-9 h-9 flex items-center justify-center text-black"
          aria-label="Add photos"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto">
        {photos.length === 0 ? (
          /* empty state — tap the big zone to open picker */
          <button
            onClick={() => inputRef.current?.click()}
            className="mx-5 mt-4 w-[calc(100%-40px)] aspect-video rounded-[18px]
                       border-2 border-dashed border-bdr bg-soft
                       flex flex-col items-center justify-center gap-3 text-b3"
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-body font-extrabold">Tap to choose photos</p>
            <p className="text-meta text-b3">From your camera roll or take a new one</p>
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-1 px-1">
            {photos.map((p, i) => (
              <div key={p.url} className="relative aspect-square">
                <img
                  src={p.url}
                  alt=""
                  className="w-full h-full object-cover"
                />
                {/* remove badge */}
                <button
                  onClick={() => remove(i)}
                  className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full
                             flex items-center justify-center text-white text-xs font-extrabold"
                  aria-label="Remove photo"
                >
                  ✕
                </button>
                {/* order badge */}
                <div className="absolute bottom-1 left-1 w-5 h-5 bg-black/60 rounded
                                flex items-center justify-center text-white text-xs font-extrabold">
                  {i + 1}
                </div>
              </div>
            ))}
            {/* add-more tile */}
            <button
              onClick={() => inputRef.current?.click()}
              className="aspect-square bg-soft border border-dashed border-bdr
                         flex items-center justify-center text-b3"
              aria-label="Add more photos"
            >
              <span className="text-3xl leading-none">+</span>
            </button>
          </div>
        )}
      </div>

      {/* footer */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-white border-t border-bdr px-5 py-4 flex items-center justify-between">
        <span className="text-body-sm text-b3">
          {photos.length === 0 ? 'Add at least 1 photo' : `${photos.length} ready`}
        </span>
        <button
          onClick={() => {
            if (!enough) { inputRef.current?.click(); return; }
            // Pass File objects (and preview URLs) to the arrange screen.
            navigate('/list-service/photos-arrange', {
              state: { photos: photos.map(p => ({ url: p.url, file: p.file })) },
            });
          }}
          className={`rounded-[24px] px-8 py-3 text-body-lg font-extrabold transition-all
            ${enough
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-gl text-gd cursor-not-allowed'}`}
        >
          {enough ? 'Next' : 'Add photos'}
        </button>
      </div>
    </div>
  );
}
