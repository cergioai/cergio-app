// CERGIO-GUARD (2026-06-03): About Cergio — three-pillar mission
// (Correct AI / Direct AI / Align AI) + APGI mechanics + team.
//
// Tarik 2026-06-03 mission tweak:
//   1. Correct AI with friend & endorsements vs gamed web data it
//      was trained on.
//   2. Direct AI to enable shared human prosperity — distribute
//      abundance profitably for everyone.
//   3. Create architectures that drive everyone's prosperity
//      together (vs shortsighted individualist goals that pit
//      users vs investors, users vs users, etc).
//
// One-line tagline: "Friend-powered AI — built so we all
// prosper together."
//
// Route: /about. Reached via the small "About · Contact · Terms"
// row in HomeScreen / Splash / Auth footers, or directly.

import { Link, useNavigate } from 'react-router-dom';
import { LeafLogo } from '../components/ui/LeafLogo';

export function AboutScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col bg-cream pb-16 overflow-y-auto">
      {/* Top bar — close back to wherever the user came from */}
      <div className="px-5 pt-7 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="w-9 h-9 rounded-full bg-white border border-bdr text-black text-body-lg flex items-center justify-center shadow-sm"
        >
          ‹
        </button>
        <Link
          to="/contact"
          className="text-[12.5px] font-extrabold text-gd hover:underline"
        >
          Contact us →
        </Link>
      </div>

      {/* Hero — logo + name + the canonical one-line tagline */}
      <div className="px-5 pt-8 flex flex-col items-center text-center">
        <LeafLogo size={88} />
        <h1 className="text-display-2 font-extrabold text-black leading-tight mt-5 tracking-wide">
          About <span className="tracking-[0.18em] uppercase">Cergio</span>
        </h1>
        {/* CERGIO-GUARD (2026-06-03): one-line tagline now hints at
            all three mission pillars (correction, direction,
            shared prosperity) without going over a single line. */}
        <p className="text-body text-b2 font-medium leading-relaxed mt-3 max-w-[340px]">
          Friend-powered AI — built so we all prosper together.
        </p>
      </div>

      {/* Mission — Tarik 2026-06-03:
          Three hard-hitting pillars distilled from Tarik's direction:
            1. Correct AI with friend + endorsement data vs gamed
               web data it was trained on.
            2. Direct AI toward shared human prosperity, distributing
               abundance profitably for everyone.
            3. Create architectures that drive everyone's prosperity
               together — instead of pitting users vs investors,
               users vs users, etc.
          Three short verb-led pillars. The cascading copy below
          (revenue streams + team) lands relative to these. */}
      <div className="mx-5 mt-8 bg-white border border-line rounded-[18px] p-5">
        <p className="text-meta-sm font-extrabold text-gd tracking-[0.18em] uppercase">
          Our mission
        </p>
        <h2 className="text-[20px] font-extrabold text-black leading-tight mt-2">
          Correct AI. Direct AI. Align AI.
        </h2>
        <p className="text-[13.5px] text-b2 leading-relaxed mt-2">
          Rebuilding AI on three foundations the web economy refuses
          to fix.
        </p>
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <p className="text-body font-extrabold text-black leading-tight">
              1. Correct it.
            </p>
            <p className="text-body-sm text-b2 leading-snug mt-1">
              Friend-to-friend trust and human endorsements replace
              the gamed, ad-saturated web data today&apos;s AI was
              trained on. Real signal beats clickbait.
            </p>
          </div>
          <div>
            <p className="text-body font-extrabold text-black leading-tight">
              2. Direct it.
            </p>
            <p className="text-body-sm text-b2 leading-snug mt-1">
              Aim AI at shared human prosperity — distribute the
              abundance it unlocks profitably for everyone, not
              quarterly extraction for a few.
            </p>
          </div>
          <div>
            <p className="text-body font-extrabold text-black leading-tight">
              3. Align it.
            </p>
            <p className="text-body-sm text-b2 leading-snug mt-1">
              Build architectures where users, builders, and investors
              all earn together — instead of pitting users against
              investors, or users against each other.
            </p>
          </div>
        </div>
      </div>

      {/* Three revenue streams — Tarik 2026-06-03: framing tweaked
          so this section reads as the concrete mechanics that DELIVER
          on pillar 3 (Align it). The section header + intro tie the
          model back to the mission instead of standing alone. */}
      <div className="mx-5 mt-5 bg-white border border-line rounded-[18px] p-5">
        <p className="text-meta-sm font-extrabold text-gd tracking-[0.18em] uppercase">
          How the alignment works
        </p>
        <p className="text-body-sm text-b2 leading-snug mt-2">
          Three earning surfaces, one platform — designed so users,
          providers, Connectors, and investors all grow together.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <p className="text-body font-extrabold text-black leading-tight">
              1. Cash earnings
            </p>
            <p className="text-body-sm text-b2 leading-snug mt-0.5">
              Providers and Connectors earn cash per booking.
              Users earn credit from every invite + reco that turns
              into a booking. Real money for real signal.
            </p>
          </div>
          <div>
            <p className="text-body font-extrabold text-black leading-tight">
              2. Free service barters — or pay
            </p>
            <p className="text-body-sm text-b2 leading-snug mt-0.5">
              Connectors trade their reach (Instagram, TikTok) for
              free services — or pay cash if they prefer. Spotlight,
              service, money, or any mix; the deal flexes to the
              moment.
            </p>
          </div>
          <div>
            <p className="text-body font-extrabold text-black leading-tight">
              3. Asset Participation Growth Income (APGI)
            </p>
            <p className="text-body-sm text-b2 leading-snug mt-0.5">
              Every dollar earned also accrues a share of Cergio&apos;s
              growth, scaled to your participation. Regular income
              tied to the network you helped build — not a one-off
              referral bonus. This is how the abundance gets
              distributed.
            </p>
          </div>
        </div>
      </div>

      {/* Team credibility */}
      <div className="mx-5 mt-5 bg-gl border border-g/25 rounded-[18px] p-5">
        <p className="text-meta-sm font-extrabold text-gd tracking-[0.18em] uppercase">
          Built by
        </p>
        <p className="text-body font-extrabold text-black leading-tight mt-2">
          Tech leads from Uber, Google, Grubhub, and Goldman Sachs.
        </p>
        <p className="text-[12.5px] text-b2 leading-snug mt-2">
          Marketplaces, money flow, ranking, and growth — the stack
          that scaled the last decade of consumer apps, now turned
          toward an AI that corrects itself on human trust and
          shares its upside with everyone it serves.
        </p>
      </div>

      {/* Footer link row */}
      <div className="mt-8 px-5">
        <div className="grid grid-cols-3 gap-3">
          <FooterCol heading="Platform">
            <FooterLink to="/home" label="How it works" />
            <FooterLink to="/auth" label="Join" />
            <FooterLink to="/terms" label="Terms" />
          </FooterCol>
          <FooterCol heading="Company">
            <FooterLink to="/about" label="About" />
            <FooterLink to="/contact" label="Contact" />
            <FooterLink to="/contact?subject=press" label="Press" />
            <FooterLink to="/contact?subject=investors" label="Investors" />
            <FooterLink to="/contact?subject=partnerships" label="Partnerships" />
          </FooterCol>
          <FooterCol heading="Support">
            <FooterLink to="/contact?subject=support" label="Get help" />
            <FooterLink to="/terms" label="Terms" />
            <FooterLink to="/privacy" label="Privacy" />
          </FooterCol>
        </div>
        <p className="text-meta-sm text-b3 font-medium mt-6 text-center">
          &copy; {new Date().getFullYear()} Cergio.
        </p>
      </div>
    </div>
  );
}

function FooterCol({ heading, children }) {
  return (
    <div>
      <p className="text-meta-sm font-extrabold text-b2 tracking-[0.12em] uppercase mb-2">
        {heading}
      </p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function FooterLink({ to, label }) {
  return (
    <Link
      to={to}
      className="text-[12.5px] text-b2 font-medium hover:text-gd hover:underline"
    >
      {label}
    </Link>
  );
}
