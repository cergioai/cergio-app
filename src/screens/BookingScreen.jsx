// CERGIO-GUARD: this screen used to render hard-coded mock data
// ("Deep Cleaning / Jamie Hall / Tuesday 2:00 PM / 123 Main St")
// whenever fields were missing. A user paying real $$ for a
// totally different service would see a confirmation describing
// a fabricated booking — brand-killing lie of the same family as
// the title/share-message divergence (invariant #3). Fields now
// come from the live `booking` context set in App.handleBook, and
// rows render only when their real value is present.
import { useNavigate, useOutletContext } from 'react-router-dom';

export function BookingScreen() {
  const navigate = useNavigate();
  const { booking } = useOutletContext();
  const {
    name    = '',
    price   = '',
    service = '',
    when    = '',
    where   = '',
  } = booking ?? {};

  // Build the list of rows from real data only. No fabricated
  // defaults — if the chat didn't capture a field, we omit the
  // row entirely rather than show a placeholder the user might
  // mistake for ground truth.
  const rows = [
    service && ['Service',     service],
    name    && ['Provider',    name],
    when    && ['Date & Time', when],
    where   && ['Address',     where],
    price   && ['Total',       price, 'text-g'],
  ].filter(Boolean);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-7 bg-white">
      {/* check */}
      <div className="w-20 h-20 rounded-full bg-gl flex items-center justify-center text-4xl mb-5 animate-pop-in">
        ✓
      </div>
      <h2 className="text-[26px] font-extrabold text-black text-center mb-2.5">Booking confirmed!</h2>
      <p className="text-body text-b3 text-center leading-relaxed mb-8">
        {name
          ? <>You've booked {name}. We've sent the confirmation to your email.</>
          : <>We've sent the confirmation to your email.</>}
      </p>

      {/* summary card — only renders if we have at least one real row */}
      {rows.length > 0 && (
        <div className="w-full bg-soft rounded-[20px] p-4 mb-6">
          {rows.map(([label, value, extra]) => (
            <div
              key={label}
              className="flex justify-between items-center py-1.5 border-b border-bg5 last:border-0"
            >
              <span className="text-meta text-b3 font-medium">{label}</span>
              <span className={`text-body-sm font-extrabold text-black ${extra ?? ''}`}>{value}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => navigate('/home')}
        className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                   mb-3 hover:opacity-90 active:scale-[.97] transition-all"
      >
        Back to home
      </button>
      <button
        onClick={() => navigate('/invite/friends-popup')}
        className="w-full bg-transparent border border-bdr text-b3 rounded-[24px] py-4
                   text-[15px] font-extrabold hover:bg-bg5 transition-colors"
      >
        Share with friends
      </button>
    </div>
  );
}
