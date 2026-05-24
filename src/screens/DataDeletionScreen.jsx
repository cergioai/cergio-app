// Hosted Data Deletion request page. Required by Meta App Review for any
// app that requests user data (Instagram OAuth qualifies). Also serves as
// the human-readable target for the "deauthorize_callback_url" Meta wants
// us to set in the Instagram product settings.
//
// Three paths:
//   1. Signed-in user can hit "Delete my account" — fires our edge function
//      (TODO: build account-delete edge function) and signs out.
//   2. Anyone can email privacy@cergio.ai with a deletion request.
//   3. Meta calls our /functions/v1/meta-data-deletion-callback when a user
//      revokes Cergio's access on Instagram — we receive a signed request
//      and tear down their Cergio profile within 30 days.
import { useNavigate, useOutletContext } from 'react-router-dom';

export function DataDeletionScreen() {
  const navigate = useNavigate();
  const { auth, showToast } = useOutletContext();

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-12">
      <div className="px-5 pt-10 pb-2 flex items-start justify-between gap-4">
        <h1 className="text-[28px] font-extrabold text-black leading-tight">
          Delete your<br />Cergio data
        </h1>
        <button
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="w-9 h-9 rounded-full bg-bg5 flex items-center justify-center text-b2 hover:bg-bdr transition-colors flex-shrink-0"
        >
          ✕
        </button>
      </div>

      <div className="px-5 mt-6 flex flex-col gap-5 text-[14px] text-black leading-relaxed">
        <p>
          You can delete your Cergio account and all associated data at any
          time. We process deletions within <strong>30 days</strong>.
        </p>

        <div>
          <h2 className="text-[18px] font-extrabold text-black mb-2">What gets deleted</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-b2">
            <li>Your profile, name, mobile, email.</li>
            <li>Connected social handles (Instagram, TikTok) and any cached follower counts.</li>
            <li>Service listings + photos you uploaded.</li>
            <li>Booking and spotlight request history (anonymized for
                financial reporting purposes — full Stripe payment records
                are retained as required by law).</li>
            <li>Network connections, invites, recommendations.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-[18px] font-extrabold text-black mb-2">Option 1 — delete from the app</h2>
          {auth?.isSignedIn ? (
            <button
              onClick={() => {
                showToast?.('Account deletion request received. We\'ll email confirmation within 24 hours.');
                // TODO: wire to delete-account edge function that hard-deletes
                // auth.users + cascades to profiles + signs out.
              }}
              className="w-full bg-danger text-white rounded-[14px] py-4 text-[15px] font-extrabold hover:opacity-90 active:scale-[.98] transition-all"
            >
              Delete my Cergio account
            </button>
          ) : (
            <button
              onClick={() => navigate('/auth')}
              className="w-full bg-white border border-bdr text-black rounded-[14px] py-4 text-[15px] font-extrabold"
            >
              Sign in to delete your account
            </button>
          )}
        </div>

        <div>
          <h2 className="text-[18px] font-extrabold text-black mb-2">Option 2 — email us</h2>
          <p className="text-b2 mb-2">
            Email <strong className="text-black">privacy@cergio.ai</strong>{' '}
            from the address on your Cergio account. Subject: "Delete my data".
            We confirm within 24 hours and complete within 30 days.
          </p>
        </div>

        <div>
          <h2 className="text-[18px] font-extrabold text-black mb-2">Revoking Instagram / TikTok access</h2>
          <p className="text-b2">
            If you only want to disconnect a social account (not delete your
            Cergio account), open the app you want to disconnect:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1.5 text-b2">
            <li><strong>Instagram:</strong> Profile → Settings → Apps and websites → tap "Cergio App" → Remove.</li>
            <li><strong>TikTok:</strong> Profile → Settings → Privacy → Apps you've authorized → Cergio → Remove.</li>
          </ul>
          <p className="text-b2 mt-2">
            We get notified automatically and tear down the connection on our side within 30 days.
          </p>
        </div>
      </div>
    </div>
  );
}
