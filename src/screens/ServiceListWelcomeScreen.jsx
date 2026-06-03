// Per design-spec.md — entry to Service Listing flow.
// Per Profile-as-canon: 30px page title (post-hero spacing keeps 26 here),
// 17px primary CTA, real user first name instead of hardcoded "Jennifer",
// and a 1-2-3 step preview so the user knows how long the listing flow is.
import { useNavigate, useOutletContext } from 'react-router-dom';

export function ServiceListWelcomeScreen() {
  const navigate = useNavigate();
  const { auth, resetListingDraft } = useOutletContext() || {};
  const u           = auth?.user;
  const displayName = u?.user_metadata?.display_name || u?.email?.split('@')[0] || 'there';
  const firstName   = displayName.split(/[\s@.]/)[0];

  // CERGIO-GUARD (2026-06-01): Tarik (2026-06-01) — "registered as a
  // new service and saw a default address (5700 collins). should be
  // blank for new users." The listingDraft state in App.jsx lives for
  // the whole session, so a prior in-progress listing (or stale chat
  // state) leaks into the form. Welcome IS the "start fresh" entry,
  // so wipe the draft here. Resumed flows would route directly to
  // /list-service/about without passing through Welcome.
  const handleStart = () => {
    resetListingDraft?.();
    navigate('/list-service/about');
  };

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* hero image area — soft mint wave-bottom */}
      <div className="relative bg-gl pt-10 pb-2 flex items-center justify-center">
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/95
                     flex items-center justify-center text-black text-base"
        >
          ✕
        </button>
        <div className="w-44 h-44 rounded-full bg-g flex items-center justify-center shadow-card">
          <svg width="92" height="92" viewBox="0 0 24 24" fill="none"
               stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" fill="rgba(255,255,255,0.18)" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
      </div>
      <svg viewBox="0 0 390 32" preserveAspectRatio="none" className="w-full block -mt-px">
        <path d="M0,0 C60,30 130,30 195,15 C260,0 320,18 390,5 L390,0 Z" fill="#E8F5E0" />
      </svg>

      {/* body — 26px hero title + 15px b3 body matches Profile section
          treatment. Steps preview so users know what they're committing to. */}
      <div className="flex-1 px-7 pt-7">
        <h1 className="text-[26px] font-extrabold text-black leading-tight mb-3">
          Hi {firstName}!
        </h1>
        <p className="text-[15px] text-b3 leading-relaxed mb-5 font-medium">
          You're about to list your service on Cergio — friends-of-friends
          will find you, book you, and grow your network.
        </p>
        <div className="flex flex-col gap-2.5 mb-5">
          <Step n="1" body="Tell us what you offer + your prices" />
          <Step n="2" body="Add a few photos and your verification info" />
          <Step n="3" body="Invite your clients + friends to find you here" />
        </div>
        <p className="text-[14px] text-b3 leading-relaxed font-medium">
          Takes about 5 minutes. Ready?
        </p>
      </div>

      {/* CTA */}
      <div className="px-5 pt-6 pb-6">
        <button
          onClick={handleStart}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[17px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          List my service
        </button>
      </div>
    </div>
  );
}

function Step({ n, body }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-6 h-6 rounded-full bg-gl text-gd text-[11px] font-extrabold
                       flex items-center justify-center flex-shrink-0">
        {n}
      </span>
      <p className="text-[14px] text-b2 font-medium leading-snug">{body}</p>
    </div>
  );
}
