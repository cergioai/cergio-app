// Hosted Privacy Policy — required for Meta App Review (Instagram public)
// AND Google OAuth verification AND TikTok Login Kit review.
// Keep this page publicly accessible (no auth gate) since reviewers visit
// it without signing in.
//
// Content here is a sensible starter. Run it past a real lawyer before
// commercial launch — this draft is NOT legal advice.
//
// 2026-06-10: Added Instagram data §6, TikTok data §7, data processors §9,
//             public-authority policies, Yogotoo Inc as controller.
import { useNavigate } from 'react-router-dom';

export function PrivacyPolicyScreen() {
  const navigate = useNavigate();
  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-12">
      <div className="px-5 pt-10 pb-2 flex items-start justify-between gap-4">
        <h1 className="text-[28px] font-extrabold text-black leading-tight">
          Privacy Policy
        </h1>
        <button
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="w-9 h-9 rounded-full bg-bg5 flex items-center justify-center text-b2 hover:bg-bdr transition-colors flex-shrink-0"
        >
          ✕
        </button>
      </div>
      <p className="px-5 text-[13px] text-b3 mt-1">Last updated: June 10, 2026</p>

      <div className="px-5 mt-6 flex flex-col gap-5 text-[14px] text-black leading-relaxed">

        <Section title="1. Who we are">
          Cergio is a services marketplace operated by{' '}
          <strong>Yogotoo Inc</strong> ("Cergio," "we," "us," or "our"). This
          Privacy Policy explains what we collect, how we use it, and the
          choices you have. It applies to cergio.ai and any related apps or
          services that link to it.
        </Section>

        <Section title="2. What we collect">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Account info you give us: name, email, mobile number, password.</li>
            <li>Profile content: service descriptions, photos, location or service-area information.</li>
            <li>
              Third-party platform identities you connect (Google, Instagram,
              TikTok) and their authorized public metadata — see §6 (Instagram)
              and §7 (TikTok) for full detail.
            </li>
            <li>Payment info processed by Stripe — Cergio never sees full card numbers.</li>
            <li>Usage logs: pages visited, search queries, device type and IP address for security.</li>
          </ul>
        </Section>

        <Section title="3. How we use it">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Match you with services (or service providers with Connectors) based on your network, location, and needs.</li>
            <li>Process payments and pay out Connectors and providers.</li>
            <li>Send transactional emails about bookings, spotlight requests, and account activity.</li>
            <li>Detect and prevent fraud and abuse.</li>
            <li>Improve the platform using aggregated, de-identified usage analytics.</li>
          </ul>
        </Section>

        <Section title="4. Who we share with">
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Stripe</strong> — payment processing (US).</li>
            <li><strong>Supabase</strong> — backend database and authentication infrastructure (US).</li>
            <li><strong>Vercel</strong> — hosting and CDN (US).</li>
            <li><strong>Resend</strong> — transactional email delivery.</li>
            <li>Meta / Instagram or TikTok — only what you explicitly authorize via OAuth; we never write back to these platforms on your behalf.</li>
            <li>Law enforcement when legally compelled.</li>
          </ul>
          <p className="mt-2 font-semibold">We do not sell your data to advertisers. Period.</p>
        </Section>

        <Section title="5. How long we keep it">
          As long as your account is active, plus a short retention window
          (typically 90 days) after deletion for legal and financial
          reconciliation. Payment records may be held longer if required by
          tax law. Instagram and TikTok data is deleted within 24 hours of
          you disconnecting the respective integration — see §6 and §7.
        </Section>

        {/* ─── §6 Instagram — Meta reviewers look for this section ─── */}
        <Section title="6. Instagram data">
          <p className="mb-2">
            When you connect Instagram via Cergio, we request only the{' '}
            <strong>instagram_basic</strong> permission. Here is exactly what
            we store and what we never do:
          </p>
          <p className="font-semibold mb-1">What we store:</p>
          <ul className="list-disc pl-5 space-y-1.5 mb-3">
            <li>Your Instagram user ID</li>
            <li>Your Instagram username (handle)</li>
            <li>Your Instagram profile picture URL</li>
            <li>The URLs and captions of your last ~12 Instagram media items</li>
          </ul>
          <p className="font-semibold mb-1">What we never do:</p>
          <ul className="list-disc pl-5 space-y-1.5 mb-3">
            <li>We never post, like, comment, or share to Instagram on your behalf.</li>
            <li>We never send direct messages through Instagram.</li>
            <li>We never access the accounts of people who follow you.</li>
            <li>We never read your private messages, stories, or non-public content.</li>
          </ul>
          <p className="font-semibold mb-1">Deletion:</p>
          <p>
            When you disconnect Instagram from your Cergio profile (Settings →
            Connections → Disconnect Instagram), all stored Instagram data —
            user ID, handle, avatar, and media — is permanently deleted within
            24 hours. You may also request immediate deletion by emailing
            privacy@cergio.ai.
          </p>
        </Section>

        {/* ─── §7 TikTok — TikTok Login Kit reviewers look for this section ─── */}
        <Section title="7. TikTok data">
          <p className="mb-2">
            When you connect TikTok via Cergio, we request only the{' '}
            <strong>user.info.basic</strong> scope. Here is exactly what we
            store and what we never do:
          </p>
          <p className="font-semibold mb-1">What we store:</p>
          <ul className="list-disc pl-5 space-y-1.5 mb-3">
            <li>Your TikTok open ID (anonymized platform identifier)</li>
            <li>Your TikTok username / display name (handle)</li>
            <li>Your TikTok profile picture URL</li>
            <li>Your TikTok follower count (public figure)</li>
          </ul>
          <p className="font-semibold mb-1">What we never do:</p>
          <ul className="list-disc pl-5 space-y-1.5 mb-3">
            <li>We never post, like, comment, or share to TikTok on your behalf.</li>
            <li>We never send direct messages through TikTok.</li>
            <li>We never access videos, follower lists, or private data beyond the basic profile scope.</li>
          </ul>
          <p className="font-semibold mb-1">Deletion:</p>
          <p>
            When you disconnect TikTok from your Cergio profile (Settings →
            Connections → Disconnect TikTok), all stored TikTok data is
            permanently deleted within 24 hours. You may also request immediate
            deletion by emailing privacy@cergio.ai.
          </p>
        </Section>

        <Section title="8. Your rights">
          You can request a copy of your data, correct inaccurate info, or
          delete your account at any time. See the{' '}
          <button
            onClick={() => navigate('/data-deletion')}
            className="text-gd font-bold underline underline-offset-2"
          >
            Data Deletion page
          </button>{' '}
          for the deletion flow. California residents have additional rights
          under CCPA including the right to know, right to delete, and right
          to opt out of sale (we do not sell data).
        </Section>

        <Section title="9. Data processors and transfers">
          <p className="mb-2">
            Yogotoo Inc (Cergio) is the data controller. We use the following
            processors, all operating in the United States:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 mb-3">
            <li>Supabase Inc — database, authentication, and edge functions</li>
            <li>Vercel Inc — web hosting and CDN</li>
            <li>Stripe Inc — payment processing</li>
            <li>Resend Inc — transactional email</li>
          </ul>
          <p className="mb-2 font-semibold">Public authority access policy:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>We disclose personal data to government or law enforcement only when legally required.</li>
            <li>We will notify affected users of government data requests to the extent permitted by law.</li>
            <li>We do not grant any government entity standing or back-door access to user data.</li>
            <li>We will challenge overly broad government requests for user data.</li>
          </ul>
        </Section>

        <Section title="10. Cookies and tracking">
          Cergio uses only functional cookies necessary to keep you logged in
          and to maintain session state. We do not use advertising cookies,
          third-party analytics cookies, or tracking pixels.
        </Section>

        <Section title="11. Children">
          Cergio is not directed at children under 13 and we do not knowingly
          collect their data. If you believe a child has provided us with
          personal information, contact privacy@cergio.ai.
        </Section>

        <Section title="12. Changes to this policy">
          We may update this Privacy Policy from time to time. We will post the
          new version at cergio.ai/privacy with an updated date. Material
          changes affecting how we use your data will be notified through the
          app or by email.
        </Section>

        <Section title="13. Contact">
          Questions about this policy:{' '}
          <strong className="text-black">privacy@cergio.ai</strong>
        </Section>

      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h2 className="text-[18px] font-extrabold text-black mb-2">{title}</h2>
      <div className="text-[14px] text-b2 leading-relaxed">{children}</div>
    </div>
  );
}
