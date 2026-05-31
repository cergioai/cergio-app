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
        // cr   = page bg. Updated 2026-05-24 to the ultra-light salmon-cream
        //        Tarik picked from the latest Figma set — warmer than the
        //        previous neutral #F8F8F8. Same token name; cascades app-wide.
        // cream = explicit alias for the new bg (also usable as bg-cream).
        // card = mockup card-on-page bg (subtle lift over page).
        // soft = stronger info-strip bg (e.g. "wait 24h"). NOT in mockup,
        //        added per Tarik's request for utility info patterns.
        // crd  = legacy alias kept pointing to soft.
        cr:    '#FAF4EE',
        cream: '#FAF4EE',
        card:  '#FCFCFC',
        soft:  '#F4F4F2',
        crd:   '#F4F4F2',

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
        // line = ultra-thin separator on cream pages. cream-tinted so it
        // blends into the page rather than reading as a neutral grey.
        // Use this (border-line) for the hairline dividers between PDP
        // sections, around offering cards, and any "barely there" border
        // the Figma mockups call for. CERGIO-GUARD (2026-05-30):
        // pixel-comp pass against Tarik's PDP/SRP mockups — bdr was too
        // contrast-y on the warm cream bg; line lands the same intent.
        line: '#EFE7D6',

        // ── Semantic: danger / destructive ───────────────────────────────
        // Consistent across the app for: required-field asterisks, sign-out
        // labels, validation errors, decline buttons. Was previously hard-coded
        // as `text-[#A32D2D]` in ~8 files; replaced with `text-danger`.
        danger: '#A32D2D',

        // ── Semantic: warning / amber notice ─────────────────────────────
        // For "tentative" / "we'll review" / "wait" panels. Used by
        // TaxonomyMatchBadge (provider override), RequestDetailScreen
        // (negotiating notice), IntakeScreen (free-listing override). Was
        // previously hard-coded as #FFF5E0 / #F0A030 / #8A5A10 in many places.
        warn:     '#F0A030',   // accent / icon (was #F0A030)
        warnBg:   '#FFF5E0',   // soft bg for warn panels
        warnText: '#8A5A10',   // strong text on warnBg
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
