import { useNavigate, useOutletContext } from 'react-router-dom';

export function BookingScreen() {
  const navigate = useNavigate();
  const { booking } = useOutletContext();
  const { name = 'Jamie Hall', price = '$170' } = booking ?? {};

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-7 bg-white">
      {/* check */}
      <div className="w-20 h-20 rounded-full bg-gl flex items-center justify-center text-4xl mb-5 animate-pop-in">
        ✓
      </div>
      <h2 className="text-[26px] font-extrabold text-black text-center mb-2.5">Booking confirmed!</h2>
      <p className="text-[14px] text-b3 text-center leading-relaxed mb-8">
        You've booked {name} for your service. Confirmation sent!
      </p>

      {/* summary card */}
      <div className="w-full bg-soft rounded-[20px] p-4 mb-6">
        {[
          ['Service',     'Deep Cleaning'],
          ['Provider',    name],
          ['Date & Time', 'Tuesday 2:00 PM'],
          ['Address',     '123 Main St'],
          ['Total',       price, 'text-g'],
        ].map(([label, value, extra]) => (
          <div
            key={label}
            className="flex justify-between items-center py-1.5 border-b border-bg5 last:border-0"
          >
            <span className="text-[12px] text-b3 font-medium">{label}</span>
            <span className={`text-[13px] font-bold text-black ${extra ?? ''}`}>{value}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => navigate('/home')}
        className="w-full bg-g text-white rounded-pill py-4 text-[15px] font-extrabold
                   mb-3 hover:opacity-90 active:scale-[.97] transition-all"
      >
        Back to home
      </button>
      <button
        onClick={() => navigate('/home')}
        className="w-full bg-transparent border border-bdr text-b3 rounded-pill py-4
                   text-[15px] font-bold hover:bg-bg5 transition-colors"
      >
        Share with friends
      </button>
    </div>
  );
}
