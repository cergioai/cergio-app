// CERGIO-GUARD (2026-05-31): About Cergio — Mission + Asset
// Participation Income concept + team credibility.
//
// Tarik supplied the canonical copy in chat:
//   "I'm Cergio — friend-powered AI. Every result is backed by someone
//    you know.
//    I create revenue through cash earnings, free service barters, and
//    Asset Participation Income — sharing Cergio's growth with the
//    people who build it.
//    Built with tech leads from Uber, Google, Grubhub, and Goldman Sachs."
//
// Mission framing: "Human-Powered Guided AI for Shared Prosperity".
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
          className="w-9 h-9 rounded-full bg-white border border-bdr text-black text-[16px] flex items-center justify-center shadow-sm"
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
        <h1 className="text-[28px] font-extrabold text-black leading-tight mt-5 tracking-wide">
          About <span className="tracking-[0.18em] uppercase">Cergio</span>
        </h1>
        <p className="text-[14px] text-b2 font-medium leading-relaxed mt-3 max-w-[320px]">
          Friend-powered AI. Every result is backed by someone you know.
        </p>
      </div>

      {/* Mission card — Tarik tweak 2026-05-31:
          "Upgrade Ai with Human Friend to Friend Endorsements and
           Guide it to Enable Shared Prosperity via Asset Participation
           Growth Income to provide users with rewards tied to platform
           growth relative to their participation.. Turning users into
           strategic partners".
          Compressed to a one-line mission + one-line proof. */}
      <div className="mx-5 mt-8 bg-white border border-line rounded-[18px] p-5">
        <p className="text-[11px] font-extrabold text-gd tracking-[0.18em] uppercase">
          Our mission
        </p>
        <h2 className="text-[20px] font-extrabold text-black leading-tight mt-2">
          Upgrade AI with human endorsements.<br />
          Share its growth with the network that built it.
        </h2>
        <p className="text-[13.5px] text-b2 leading-relaxed mt-3">
          Cergio guides AI through friend-to-friend trust, then returns
          the upside as <span className="font-extrabold text-black">Asset Participation Growth Income</span> —
          every user&apos;s share of Cergio&apos;s growth, scaled to
          their participation. Users become strategic partners, not
          customers.
        </p>
      </div>

      {/* What we believe — Tarik 2026-05-31:
            "1-AI should be corrected by human recommendations (to
             correct the infected internet data) otherwise AI will
             just give you garbage more efficiently faster.
             2-We can create larger platforms by aligning user
             interests with shareholders... which turns users into
             highly strategic partners earning income relative to
             their participation in the growth of the platform."
          The two convictions underneath everything. Sits between
          the one-line mission above and the "three revenue streams"
          below — the WHY before the HOW. */}
      <div className="mx-5 mt-5 bg-white border border-line rounded-[18px] p-5">
        <p className="text-[11px] font-extrabold text-gd tracking-[0.18em] uppercase">
          What we believe
        </p>
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <p className="text-[14px] font-extrabold text-black leading-tight">
              1. AI corrected by humans, not the other way around.
            </p>
            <p className="text-[13px] text-b2 leading-snug mt-1">
              Internet data is polluted. Without endorsement from
              people you trust, AI just delivers garbage faster.
              Cergio routes every result through your real network —
              so the AI keeps getting corrected by humans.
            </p>
          </div>
          <div>
            <p className="text-[14px] font-extrabold text-black leading-tight">
              2. Platforms grow bigger when users own a piece.
            </p>
            <p className="text-[13px] text-b2 leading-snug mt-1">
              Align user interests with shareholders and the network
              earns alongside the platform. Every Cergio user
              becomes a strategic partner — paid in income tied to
              platform growth, scaled to their participation.
            </p>
          </div>
        </div>
      </div>

      {/* Three revenue streams — short, scannable */}
      <div className="mx-5 mt-5 bg-white border border-line rounded-[18px] p-5">
        <p className="text-[11px] font-extrabold text-gd tracking-[0.18em] uppercase">
          Three ways Cergio creates value
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <p className="text-[14px] font-extrabold text-black leading-tight">
              1. Cash earnings
            </p>
            <p className="text-[13px] text-b2 leading-snug mt-0.5">
              Connectors earn cash per client booked. Users earn credit
              from every invite + reco that turns into a booking.
            </p>
          </div>
          <div>
            <p className="text-[14px] font-extrabold text-black leading-tight">
              2. Free service barters — or pay
            </p>
            <p className="text-[13px] text-b2 leading-snug mt-0.5">
              Connectors trade their reach (Instagram, TikTok) for free
              services from providers — or pay cash if they prefer.
              Spotlight, service, money, or any mix — match the deal
              to the moment.
            </p>
          </div>
          <div>
            <p className="text-[14px] font-extrabold text-black leading-tight">
              3. Asset Participation Growth Income
            </p>
            <p className="text-[13px] text-b2 leading-snug mt-0.5">
              Every dollar you earn also accrues a share of
              Cergio&apos;s growth, scaled to your participation. The
              earlier you join and the more your network grows, the
              larger your share. Regular income tied to the orchard
              you helped grow — not a one-off referral bonus.
            </p>
          </div>
        </div>
      </div>

      {/* Team credibility */}
      <div className="mx-5 mt-5 bg-gl border border-g/25 rounded-[18px] p-5">
        <p className="text-[11px] font-extrabold text-gd tracking-[0.18em] uppercase">
          Built by
        </p>
        <p className="text-[14px] font-extrabold text-black leading-tight mt-2">
          Tech leads from Uber, Google, Grubhub, and Goldman Sachs.
        </p>
        <p className="text-[12.5px] text-b2 leading-snug mt-2">
          Marketplaces, money flow, search ranking, and growth — the
          stack that scaled the last decade of consumer apps, now
          building one where the network earns alongside the platform.
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
        <p className="text-[11px] text-b3 font-medium mt-6 text-center">
          &copy; {new Date().getFullYear()} Cergio.
        </p>
      </div>
    </div>
  );
}

function FooterCol({ heading, children }) {
  return (
    <div>
      <p className="text-[11px] font-extrabold text-b2 tracking-[0.12em] uppercase mb-2">
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
