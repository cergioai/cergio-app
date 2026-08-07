// Tappable Instagram-post tile (Tarik 2026-06-15; FW-21 2026-08-07).
//
// FW-21 (founder): "spotlights show REAL IG post image, not the IG logo
// tile." The real image comes from Meta's OFFICIAL oEmbed endpoint via the
// ig-oembed edge function (token-gated server-side — the app token never
// reaches the browser). Honesty rules unchanged since SPEC-12:
//   • real thumbnail returned  → render the real <img>
//   • no token / API miss / any failure → the SAME honest IG-branded link
//     tile as before (gradient + glyph + "View") — NEVER a fabricated
//     thumbnail.
// Results memoize per-URL for the session so a profile with six spotlights
// costs one fetch per post, not one per render.
import { useEffect, useState } from 'react';
import { supabase, supabaseReady } from '../../lib/supabase';

const thumbCache = new Map(); // url → thumbnail_url | null (null = fell back)

async function fetchThumb(url) {
  if (thumbCache.has(url)) return thumbCache.get(url);
  if (!supabaseReady) { thumbCache.set(url, null); return null; }
  try {
    const { data, error } = await supabase.functions.invoke('ig-oembed', { body: { url } });
    const thumb = !error && data?.thumbnail_url ? data.thumbnail_url : null;
    thumbCache.set(url, thumb);
    return thumb;
  } catch {
    thumbCache.set(url, null);
    return null;
  }
}

export function IgPostTile({ url, size = 56, aspect, label }) {
  const [thumb, setThumb] = useState(() => thumbCache.get(url) ?? null);

  useEffect(() => {
    if (!url || thumbCache.has(url)) { setThumb(thumbCache.get(url) ?? null); return; }
    let cancelled = false;
    fetchThumb(url).then(t => { if (!cancelled) setThumb(t); });
    return () => { cancelled = true; };
  }, [url]);

  if (!url) return null;
  const style = aspect ? { aspectRatio: aspect } : { width: size, height: size };
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={label || 'View Instagram post'}
      className="relative block rounded-[12px] overflow-hidden flex-shrink-0 active:scale-[.97] transition-transform"
      style={style}
    >
      {thumb ? (
        // FW-21: the REAL post image (official oEmbed). onError falls back to
        // the branded tile by clearing the thumb — never a broken image.
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => { thumbCache.set(url, null); setThumb(null); }}
        />
      ) : (
        <>
          <div className="absolute inset-0 bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <svg width="40%" height="40%" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none" />
            </svg>
          </div>
        </>
      )}
      <div className="absolute bottom-0 inset-x-0 bg-black/45 text-white text-[9px] font-extrabold text-center py-0.5">
        View
      </div>
    </a>
  );
}
