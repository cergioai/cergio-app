// Per design-spec.md — photo/video picker grid (mock library).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Mock 15-tile library using gradient placeholders so no external assets needed.
const TILES = [
  'fv-john', 'fv-steve', 'fv-jamie',
  'fv-john', 'fv-jamie', 'fv-steve',
  'fv-jamie', 'fv-steve', 'fv-john',
  'fv-steve', 'fv-jamie', 'fv-john',
  'fv-jamie', 'fv-steve', 'fv-john',
];

export function ServiceListPhotosPickScreen() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(new Set());

  const toggle = (i) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i); else next.add(i);
    setSelected(next);
  };

  const enough = selected.size >= 5;
  const summary = selected.size === 0
    ? 'Choose photos and videos'
    : `${selected.size} ${selected.size === 1 ? 'photo' : 'photos'} selected`;

  return (
    <div className="flex-1 flex flex-col bg-white pb-24">
      {/* top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-extrabold w-9 h-9 flex items-center justify-center"
        >
          ✕
        </button>
        <p className="text-[15px] font-extrabold text-black">{summary}</p>
        <button className="w-9 h-9 flex items-center justify-center text-black">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
      </div>

      {/* grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-3 gap-1 px-1">
          {TILES.map((bg, i) => {
            const isSel = selected.has(i);
            return (
              <button
                key={i}
                onClick={() => toggle(i)}
                className={`relative aspect-square ${bg} ${isSel ? 'ring-4 ring-g' : ''}`}
              >
                {isSel && (
                  <div className="absolute top-2 right-2 w-6 h-6 bg-black rounded
                                  flex items-center justify-center text-white text-xs font-extrabold">
                    ✓
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* footer */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-white border-t border-bdr px-5 py-4 flex items-center justify-between">
        <span className="text-body-sm text-b3">Choose at least 5</span>
        <button
          onClick={() => {
            if (!enough) return;
            // Pass the user's actual picks (as gradient class names) to the
            // arrange screen so it shows what they chose, not a hardcoded 4.
            const tiles = Array.from(selected).sort((a, b) => a - b).map(i => TILES[i]);
            navigate('/list-service/photos-arrange', { state: { tiles } });
          }}
          disabled={!enough}
          className={`rounded-[24px] px-8 py-3 text-[15px] font-extrabold transition-all
            ${enough
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-gl text-g/60 cursor-not-allowed'}`}
        >
          Upload
        </button>
      </div>
    </div>
  );
}
