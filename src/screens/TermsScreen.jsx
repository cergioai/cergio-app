// CERGIO-GUARD (2026-05-31): Terms of Use — standard booking-platform
// terms with the no-liability + connector-platform character Tarik
// flagged. Patterned after Yelp/Booking/TaskRabbit terms so users
// recognise the shape.
//
// Route: /terms. Linked from About + Contact + Splash + Auth + Home
// footers and from the Contact form's submit-fineprint.
//
// IMPORTANT — NOT LEGAL ADVICE
// This file ships as a starting template Tarik will tune with counsel.
// Do not represent it as final terms. The on-screen disclaimer at the
// top says exactly that.

import { Link, useNavigate } from 'react-router-dom';

export function TermsScreen() {
  const navigate = useNavigate();
  const effective = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <div className="flex-1 flex flex-col bg-cream pb-16 overflow-y-auto">
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
          className="text-meta font-extrabold text-gd hover:underline"
        >
          Contact us →
        </Link>
      </div>

      <div className="px-5 pt-6">
        <h1 className="text-display-2 font-extrabold text-black leading-tight">
          Terms of Use
        </h1>
        <p className="text-meta text-b3 font-medium mt-2">
          Effective {effective}. Subject to change.
        </p>
      </div>

      {/* Highlight: booking-platform character + no liability */}
      <div className="mx-5 mt-5 bg-warnBg border border-warn/40 rounded-[14px] p-4">
        <p className="text-body-sm font-extrabold text-warnText leading-tight mb-1">
          Cergio is a booking + introduction platform.
        </p>
        <p className="text-meta text-warnText leading-snug">
          We connect Users, Providers, and Connectors and facilitate
          payments — we do not deliver the underlying services, we are
          not your employer or theirs, and we accept no liability for
          the actions or outputs of any party introduced via the
          platform. Bookings are agreements directly between you and
          the Provider.
        </p>
      </div>

      <div className="mx-5 mt-6 flex flex-col gap-5 text-body-sm text-b2 leading-relaxed">

        <Section title="1. Acceptance">
          By creating a Cergio account, using the Cergio app, or
          completing a booking through Cergio, you agree to these Terms
          of Use and to the Privacy Policy. If you don&apos;t agree,
          don&apos;t use Cergio.
        </Section>

        <Section title="2. What Cergio does">
          Cergio is a marketplace and booking platform that uses AI to
          help Users find local services through people in their
          network. We facilitate introductions and bookings between
          three groups:
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><b>Users</b> — people looking to book a service.</li>
            <li><b>Providers</b> — independent businesses or
                individuals offering a service.</li>
            <li><b>Connectors</b> — verified influencers who recommend
                services to their audience.</li>
          </ul>
          Cergio is not a party to the service contract between Users
          and Providers.
        </Section>

        <Section title="3. Eligibility and accounts">
          You must be at least 18 years old to use Cergio. You are
          responsible for all activity under your account and for
          keeping your credentials secure. You agree to provide
          accurate information. You may sign in using third-party
          platform identities (Google, Instagram, TikTok); doing so
          authorizes Cergio to access only the data described in our
          Privacy Policy for that platform.
        </Section>

        <Section title="4. Bookings, payments, and cancellations">
          Bookings are placed through Cergio and paid via our payments
          processor (currently Stripe). Cergio charges a platform fee
          on each booking; a portion of that fee may be shared with
          the inviter or recommending User/Connector. Refund and
          cancellation policies are set by each Provider; Cergio may
          mediate disputes but is not the merchant of record for the
          underlying service.
        </Section>

        <Section title="5. Connectors and spotlights">
          A Connector may offer paid or barter spotlight posts on
          Instagram, TikTok, or other channels in exchange for payment
          or a free service from a Provider. Spotlight content is the
          sole responsibility of the Connector. Cergio does not pre-
          review or endorse spotlight posts and accepts no liability
          for their content, accuracy, FTC compliance, or audience
          reaction.
        </Section>

        <Section title="6. User content + recommendations">
          When you recommend a service or post a review on Cergio, you
          grant Cergio a non-exclusive, worldwide, royalty-free license
          to host, display, and share that content in connection with
          the platform. You are responsible for the accuracy of
          recommendations you make and the content you post.
        </Section>

        <Section title="7. Asset Participation Growth Income (APGI)">
          Cergio may credit some Users with Asset Participation Growth
          Income ("APGI") as a loyalty bonus tied to platform usage
          and network growth. APGI is a contractual bonus only — not
          a security, not a guarantee, not a promise of future
          payout — and may be modified, paused, or discontinued at
          any time. APGI has no fixed dollar value and is not
          redeemable for cash except as described in published payout
          policies.
        </Section>

        <Section title="8. Disclaimers">
          Cergio is provided <b>as is</b> and <b>as available</b> with
          all faults. To the maximum extent permitted by law, Cergio
          disclaims all warranties, express or implied, including
          warranties of merchantability, fitness for a particular
          purpose, non-infringement, and warranties arising from
          course of dealing or usage of trade.
        </Section>

        <Section title="9. Limitation of liability">
          To the maximum extent permitted by law, Cergio (and its
          officers, directors, employees, and partners) will not be
          liable for any indirect, incidental, special, consequential,
          or punitive damages, including lost profits, lost data, or
          loss of goodwill, arising out of or in connection with your
          use of (or inability to use) Cergio. Our total aggregate
          liability to you for any claim arising out of or relating to
          these Terms will not exceed the greater of (a) the amount
          you paid Cergio in the twelve months preceding the claim or
          (b) US$100.
        </Section>

        <Section title="10. Indemnity">
          You agree to indemnify and hold Cergio harmless from any
          claim or demand, including reasonable attorneys&apos; fees,
          arising out of your use of Cergio, your violation of these
          Terms, or your infringement of any third-party rights.
        </Section>

        <Section title="11. Intellectual property">
          Cergio, the Cergio logo, and the visual design language are
          trademarks of Cergio (and/or its legal entity Yogotoo).
          Nothing in these Terms grants you a license to use them
          without prior written permission.
        </Section>

        <Section title="12. Termination">
          You may delete your account at any time. We may suspend or
          terminate access to Cergio for any user who violates these
          Terms, the Privacy Policy, or applicable law.
        </Section>

        <Section title="13. Governing law">
          These Terms are governed by the laws of the State of New
          York, without regard to its conflict-of-laws principles.
          Disputes will be resolved in the state or federal courts
          located in New York County, New York.
        </Section>

        <Section title="14. Changes to these Terms">
          We may update these Terms from time to time. Material changes
          will be notified through the app or by email. Continued use
          after the effective date of an updated Terms constitutes
          acceptance.
        </Section>

        <Section title="15. Contact">
          Questions? Reach us via the{' '}
          <Link to="/contact" className="text-gd font-extrabold underline">
            Contact form
          </Link>. Pick the relevant subject so the right person
          replies.
        </Section>

        <Section title="16. Data processing">
          Cergio (operated by Yogotoo Inc) acts as data controller. Our
          data processors are Supabase and Vercel (infrastructure, US),
          Stripe (payments, US), and Resend (email, US). We process
          personal data only for the purposes described in the Privacy
          Policy and only to the extent users have been informed of and
          consented to. We do not grant governments standing access to
          user data; we comply with lawful requests only and will
          challenge overly broad demands. See our{' '}
          <Link to="/privacy" className="text-gd font-extrabold underline">
            Privacy Policy
          </Link>{' '}
          for full detail.
        </Section>

      </div>

      <div className="mt-10 px-5">
        <p className="text-meta-sm text-b3 font-medium text-center">
          &copy; {new Date().getFullYear()} Cergio.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-body-lg font-extrabold text-black leading-tight mb-1.5">
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}
