// Per design-spec.md — Activity tab: unified feed of bookings/jobs/social.
// Mock ACTIVITY list + filter pills removed per audit. Real activity comes
// from bookings + spotlights + invitations once those write into a single
// view; until then the screen shows an empty-state that drives the user
// back into the value loop.
import { useNavigate, useOutletContext } from 'react-router-dom';
import { REWARDS } from '../lib/rewards';

export function ActivityScreen() {
  const navigate = useNavigate();
  const { auth } = useOutletContext() || {};
  const isSignedIn = !!auth?.isSignedIn;

  return (
    <div className="flex-1 flex flex-col bg-cream pb-24 overflow-y-auto">
      <div className="px-5 pt-8 pb-4">
        <h1 className="text-[24px] font-extrabold text-black leading-tight">Activity</h1>
        <p className="text-[13px] text-b3 font-medium mt-1.5 leading-snug">
          Bookings, jobs, and shares in one place.
        </p>
      </div>

      {/* Empty state — no real activity feed yet, so route the user to the
          actions that create activity. */}
      <div className="mx-5 mb-3 bg-white border border-bdr rounded-[18px] p-5">
        <p className="text-[15px] font-extrabold text-black leading-tight">
          {isSignedIn ? 'No activity yet' : 'Sign in to see your activity'}
        </p>
        <p className="text-[12px] text-b3 mt-1.5 leading-snug">
          {isSignedIn
            ? `Book a service, list yours, or refer a friend (earn $${REWARDS.perFriend}/friend).`
            : 'Bookings, jobs, and shares show up here once you sign in.'}
        </p>
        <div className="flex flex-col gap-2 mt-4">
          {isSignedIn ? (
            <>
              <button
                onClick={() => navigate('/home')}
                className="w-full bg-g text-white rounded-[24px] py-3 text-[14px] font-extrabold"
              >
                Find a service →
              </button>
              <button
                onClick={() => navigate('/find-friends')}
                className="w-full bg-white border border-bdr text-black rounded-[24px] py-3 text-[14px] font-extrabold"
              >
                Refer a friend — ${REWARDS.perFriend}/friend
              </button>
            </>
          ) : (
            <button
              onClick={() => navigate('/auth')}
              className="w-full bg-g text-white rounded-[24px] py-3 text-[14px] font-extrabold"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
