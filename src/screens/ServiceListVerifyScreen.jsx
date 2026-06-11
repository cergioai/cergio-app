// Final step of the list-service flow — choose how to get verified.
// CERGIO-GUARD: copy uses Connector (not Expert), cash dollars (not
// Cergio Coin), and the $250-per-friend canon defined in lib/rewards.js.
import { useNavigate, useOutletContext } from 'react-router-dom';
import { RegHeader } from '../components/ui/RegHeader';
import { REWARDS } from '../lib/rewards';

export function ServiceListVerifyScreen() {
  const navigate = useNavigate();
  const { showToast } = useOutletContext();

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <RegHeader
        title="Get verified!"
        sub="Verified services are visible to everyone on Cergio and get booked more. Here's how to get verified."
        minHeight={280}
      />

      <div className="bg-cr rounded-t-[28px] -mt-7 px-5 pt-7 flex-1 pb-8 overflow-y-auto">
        {/* Card 1 — Invite & earn */}
        <div className="bg-white border border-bdr rounded-[18px] p-5 mb-4">
          <p className="text-body-lg font-extrabold text-black mb-2">Invite friends &amp; clients</p>
          <p className="text-body-sm text-b3 leading-relaxed mb-4">
            Complete 10 bookings from friends and past clients to become verified.
            Invite a friend and earn ${REWARDS.perFriend} per friend when they book on Cergio.
          </p>
          <button
            onClick={() => navigate('/invite/friends-popup')}
            className="bg-g text-white rounded-[24px] px-5 py-2.5 text-body font-extrabold"
          >
            Learn more
          </button>
        </div>

        {/* Card 2 — Offer a free service to a Connector */}
        <div className="bg-white border border-bdr rounded-[18px] p-5 mb-4">
          <p className="text-body-lg font-extrabold text-black mb-2">Offer a free service to a Connector</p>
          <p className="text-body-sm text-b3 leading-relaxed mb-4">
            Connectors have large Instagram / TikTok audiences. Complete 1 free booking with a Connector
            to become verified and get spotlighted to their followers.
          </p>
          <button
            onClick={() => navigate('/rainmaker-request')}
            className="bg-black text-white rounded-[24px] px-5 py-2.5 text-body font-extrabold"
          >
            Learn more
          </button>
        </div>

        <button
          onClick={() => navigate('/home')}
          className="w-full bg-white border border-bdr rounded-[18px] py-4
                     text-[15px] font-extrabold text-black hover:bg-bg5 transition-colors"
        >
          I'll do this later
        </button>
      </div>
    </div>
  );
}
