/** @type {import('tailwindcss').Config} */
//
// All values here MUST match `Cergio Claude/design-spec.md`.
// Do not edit hex codes here without updating the spec, and do not edit the
// spec without re-sampling from the canonical Figma PNG.
// Source of truth: ../design-spec.md
//
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ── Primary brand greens ────────────────────────────────────────
        // PIXEL-SAMPLED from Trending Free and Discounted Home.png (Figma).
        // g  = Free pill solid fill (1.90% of image, brand primary).
        // gd = darker for hover/active text.
        // gd2 = deep accent (Cergio Pick text on mint).
        // gm = brighter lime accent (icon highlights).
        // gl = All Services / Discounted pill bg (pixel-confirmed).
        g:   '#4AA901',
        gd:  '#3D8B00',
        gd2: '#2C5D21',
        gm:  '#77C000',
        gl:  '#F3FFEA',

        // ── Salmon family — RETIRED ──────────────────────────────────────
        // Mockup uses green + neutrals only. Tokens kept defined and aliased
        // to neutrals so any forgotten class doesn't crash the build, but
        // nothing should USE these names going forward.
        p:   '#E5E5E3',
        pl:  '#F4F4F2',
        pd:  '#5C5C5C',
        pm:  '#C8C8C5',

        // ── Backgrounds ──────────────────────────────────────────────────
        // cr   = page bg (88% frequency in canonical PNG).
        // card = mockup card-on-page bg (subtle lift over page).
        // soft = stronger info-strip bg (e.g. "wait 24h"). NOT in mockup,
        //        added per Tarik's request for utility info patterns.
        // crd  = legacy alias kept pointing to soft.
        cr:   '#F8F8F8',
        card: '#FCFCFC',
        soft: '#F4F4F2',
        crd:  '#F4F4F2',

        // ── Text ─────────────────────────────────────────────────────────
        // b3 = body / inactive gray, pixel-sampled (2.37% frequency).
        // b2 = mid-emphasis (rare; kept for transition cases).
        // Heading black is `text-black` (Tailwind default #000), but the
        // mockup uses #111114. We override `black` below to match.
        black: '#111114',
        b2:    '#3D3D3D',
        b3:    '#A0A0A2',

        // ── UI greys ─────────────────────────────────────────────────────
        bdr: '#E5E5E3',
        bg5: '#F5F5F5',
        bg4: '#FAFAFA',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
        pill: '99px',
      },
      boxShadow: {
        card: '0 2px 16px rgba(0,0,0,.08)',
        up:   '0 -2px 20px rgba(0,0,0,.07)',
      },
      animation: {
        'spin-slow':  'spin 2.4s linear infinite',
        'spin-rev':   'spin-rev 3.6s linear infinite',
        'pulse-ball': 'pulse-ball 2.4s ease-in-out infinite',
        'fade-up':    'fade-up .7s ease both',
      },
      keyframes: {
        'spin-rev':   { to: { transform: 'rotate(-360deg)' } },
        'pulse-ball': {
          '0%,100%': { transform: 'scale(1)',   opacity: '1' },
          '50%':     { transform: 'scale(.85)', opacity: '.8' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to:   { opacity: '1', transform: 'none' },
        },
      },
    },
  },
  plugins: [],
};
