// Hosted Privacy Policy — required for Meta App Review (Instagram public)
// AND Google OAuth verification. Keep this page publicly accessible (no
// auth gate) since reviewers visit it without signing in.
//
// Content here is a sensible starter. Run it past a real lawyer before
// commercial launch — this draft is NOT legal advice.
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
      <p className="px-5 text-[13px] text-b3 mt-1">Last updated: May 24, 2026</p>

      <div className="px-5 mt-6 flex flex-col gap-5 text-[14px] text-black leading-relaxed">
        <Section title="Who we are">
          Cergio is a services marketplace operated by Cergio AI (the
          "Service"). This Privacy Policy explains what we collect, how we
          use it, and the choices you have.
        </Section>

        <Section title="What we collect">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Account info you give us: name, email, mobile number, password.</li>
            <li>Profile content: service descriptions, photos, addresses you save.</li>
            <li>Social handles you connect (Instagram, TikTok) and their public
                metadata (handle, follower count, profile picture).</li>
            <li>Payment info processed by Stripe — Cergio never sees full card numbers.</li>
            <li>Usage logs: pages visited, search queries, device + IP for security.</li>
          </ul>
        </Section>

        <Section title="How we use it">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Match you with services (or service providers with Connectors)
                based on your network, location, and needs.</li>
            <li>Process payments and pay out Connectors / providers.</li>
            <li>Send transactional emails about bookings + spotlight requests.</li>
            <li>Detect and prevent fraud / abuse.</li>
          </ul>
        </Section>

        <Section title="Who we share with">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Stripe (payment processing).</li>
            <li>Supabase (backend infrastructure).</li>
            <li>Resend (transactional email delivery).</li>
            <li>Meta / TikTok — only what you explicitly authorize via OAuth.</li>
            <li>Law enforcement when legally compelled.</li>
          </ul>
          <p className="mt-2">We don't sell your data to advertisers. Period.</p>
        </Section>

        <Section title="How long we keep it">
          As long as your account is active, plus a short retention window
          (typically 90 days) after deletion for legal + financial
          reconciliation. Payment records may be held longer if required by
          tax law.
        </Section>

        <Section title="Your rights">
          You can request a copy of your data, correct inaccurate info, or
          delete your account at any time. See the{' '}
          <button onClick={() => navigate('/data-deletion')} className="text-g font-bold underline underline-offset-2">
            Data Deletion page
          </button>{' '}
          for the deletion flow.
        </Section>

        <Section title="Contact">
          Questions about this policy: <strong className="text-black">privacy@cergio.ai</strong>
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
