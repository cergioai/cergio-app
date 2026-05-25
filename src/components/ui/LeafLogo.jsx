// CERGIO-GUARD: this is the shared leaf brand mark. Do NOT replace it
// with the legacy spinner / eye Logo on any screen that imports it.
// The leaf is the canonical Cergio logo across the app — Home headline,
// Results header + status, anywhere "Cergio is working" needs to be
// represented visually.
//
// Props:
//   working — true to slow-rotate (Claude-thinking-style); false stays
//             still (brand mark only).
//   size    — pixel width/height of the mark (default 22).
//
// Animation classes live in src/index.css:
//   .cg-leaf-think   — slow 3.5s rotate + subtle scale breath
//   (.cg-leaf-rest is the default — no animation)

export function LeafLogo({ working = false, size = 22 }) {
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 ${working ? 'cg-leaf-think' : ''}`}
      style={{ width: size, height: size, transformOrigin: '50% 60%' }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
        {/* Stem */}
        <path
          d="M14 26 C14 22 14 18 14 14"
          stroke="#3D8B00" strokeWidth="2" strokeLinecap="round"
        />
        {/* Left leaf — wide teardrop */}
        <path
          d="M14 17 C 8 17, 4 14, 4 9 C 4 7, 5 5.5, 6 4.5 C 9 6, 12 8.5, 14 14 Z"
          fill="#4AA901"
        />
        {/* Right leaf — mirrored, slightly larger */}
        <path
          d="M14 14 C 16 9, 19 5.5, 22.5 4 C 23.5 5, 24.5 7, 24.5 9 C 24.5 14, 20 17, 14 17 Z"
          fill="#5BC404"
        />
        {/* Veins */}
        <path d="M14 14 L 8 9" stroke="#2F6E00" strokeWidth="0.8" strokeLinecap="round" opacity=".55" />
        <path d="M14 14 L 20 8" stroke="#2F6E00" strokeWidth="0.8" strokeLinecap="round" opacity=".55" />
      </svg>
    </span>
  );
}
