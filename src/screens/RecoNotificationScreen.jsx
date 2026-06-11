// Per design-spec.md — notifies that a recommendation was received.
// CERGIO-GUARD: previously this screen rendered a hard-coded
// "received a recommendation from Gervon" banner with fake badge
// counts and "filters coming soon" chips on the filter row. The
// fake banner and lying filter buttons have been replaced with an
// empty state that points users to the real /inbox (Jobs Inbox)
// where Connector requests actually land. Route kept for back-
// compat in case any old links/notifications still point here.
//
// Reviewer (2026-05-27 wave 3) flagged the three tabs — Requests /
// Upcoming / Past — as a soft lie: clicking them moved the green
// underline but didn't actually filter anything. The tabs and
// `activeTab` state are now removed; this screen is a single calm
// empty state that funnels people to /inbox.
import { useNavigate } from 'react-router-dom';

export function RecoNotificationScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col bg-cr pb-20 overflow-y-auto">
      <div className="px-5 pt-16 text-center">
        <p className="text-heading-2 font-extrabold text-black mb-2">
          You're all caught up
        </p>
        <p className="text-body text-b3 leading-relaxed mb-6">
          New Connector requests show up in your inbox.
        </p>
        <button
          onClick={() => navigate('/inbox')}
          className="bg-black text-white rounded-pill px-5 py-2.5 text-body font-extrabold"
        >
          Open inbox
        </button>
      </div>
    </div>
  );
}
