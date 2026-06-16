// Tappable Instagram-post tile (Tarik 2026-06-15). We can't fetch the actual
// photo until Meta media access is approved, so this is an honest IG-branded
// link tile (gradient + glyph + "View") — NOT a fabricated thumbnail (SPEC-12).
// When Graph media lands, swap the inner gradient for the real <img>.
export function IgPostTile({ url, size = 56, aspect, label }) {
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
      <div className="absolute inset-0 bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]" />
      <div className="absolute inset-0 flex items-center justify-center">
        <svg width="40%" height="40%" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none" />
        </svg>
      </div>
      <div className="absolute bottom-0 inset-x-0 bg-black/45 text-white text-[9px] font-extrabold text-center py-0.5">
        View
      </div>
    </a>
  );
}
