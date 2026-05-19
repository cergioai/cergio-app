// Per design-spec.md — final step: choose how to get verified.
import { useNavigate, useOutletContext } from 'react-router-dom';
import { RegHeader } from '../components/ui/RegHeader';

export function ServiceListVerifyScreen() {
  const navigate = useNavigate();
  const { showToast } = useOutletContext();

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <RegHeader
        title="Get verified!"
        sub="Verified services are visible to everyone on Cergio and gets booked more. Here's how to get verified."
        minHeight={280}
      />

      <div className="bg-cr rounded-t-[28px] -mt-7 px-5 pt-7 flex-1 pb-8 overflow-y-auto">
        {/* card 1 */}
        <div className="bg-white border border-bdr rounded-[18px] p-5 mb-4">
          <p className="text-[16px] font-extrabold text-black mb-2">Invite friends &amp; clients</p>
          <p className="text-[13px] text-b3 leading-relaxed mb-4">
            Complete (10) bookings from friends and past clients to become verified.
            Invite a friend and you'll both earn $25 Cergio Coin.
          </p>
          <button
            onClick={() => showToast('Invite link copied!')}
            className="bg-g text-white rounded-[24px] px-5 py-2.5 text-[14px] font-extrabold"
          >
            Learn more
          </button>
        </div>

        {/* card 2 */}
        <div className="bg-white border border-bdr rounded-[18px] p-5 mb-4">
          <p className="text-[16px] font-extrabold text-black mb-2">Offer free service to Expert</p>
          <p className="text-[13px] text-b3 leading-relaxed mb-4">
            Cergio Experts have huge networks on social media. Complete (1) free booking with
            an Expert to become verified, earn Cergio coin, and get free marketing to thousands.
          </p>
          <button
            onClick={() => navigate('/rainmaker-request')}
            className="bg-black text-white rounded-[24px] px-5 py-2.5 text-[14px] font-extrabold"
          >
            Learn more
          </button>
        </div>

        {/* secondary CTA */}
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
