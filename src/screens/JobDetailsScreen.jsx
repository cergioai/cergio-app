// Per design-spec.md — provider's view of a booked job (map + details sheet).
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';

const JOB = {
  jobType: 'Housekeeper Job',
  provider: { name: 'Jennifer', category: 'Housekeeper', clientName: 'David' },
  earnings: 'Instagram marketing',
  requestedTime: '10:00 AM @ Fri, Feb 15',
  location: { line1: '1145 Broadway St.', line2: 'New York, NY 10001' },
  requestDetails: {
    type: 'Apartment / House Clean',
    items: ['2 Bedrooms', '2 Baths', '1000+ Sq Ft.'],
    extras: ['+ (2) Laundry Bags', '+ Deep Cleaning', '+ Needs cleaning supplies'],
  },
};

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

export function JobDetailsScreen() {
  const navigate = useNavigate();
  const routerLoc = useLocation();
  const { showToast } = useOutletContext();
  const { jobType, provider, earnings, requestedTime, location, requestDetails } = JOB;
  const bookingId = routerLoc.state?.bookingId;

  const rows = [
    { label: 'Your earnings', sub: earnings,                                     action: 'Free Benefits',  to: '/benefits' },
    { label: 'Requested time', sub: requestedTime,                               action: 'Change',         toast: 'Reschedule — coming later' },
    { label: 'Job location',  sub: `${location.line1}\n${location.line2}`,      action: 'Get Directions', toast: 'Map directions — coming later' },
  ];

  return (
    <div className="flex-1 flex flex-col bg-cr pb-20 overflow-y-auto">
      {/* map placeholder */}
      <div className="relative h-[220px] bg-soft overflow-hidden">
        <svg width="100%" height="220" viewBox="0 0 390 220" preserveAspectRatio="xMidYMid slice">
          <rect width="390" height="220" fill="#F4F4F2" />
          {[50, 100, 150, 195].map(y => (
            <line key={y} x1="0" y1={y} x2="390" y2={y} stroke="#FFFFFF" strokeWidth="6" />
          ))}
          {[70, 160, 250, 330].map(x => (
            <line key={x} x1={x} y1="0" x2={x} y2="220" stroke="#FFFFFF" strokeWidth="6" />
          ))}
          <circle cx="195" cy="120" r="40" fill="#E8F5E0" opacity="0.9" />
          <circle cx="195" cy="120" r="40" fill="none" stroke="#4AA901" strokeWidth="2.5" />
          <circle cx="195" cy="120" r="6" fill="#4AA901" />
        </svg>
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white border border-bdr
                     flex items-center justify-center text-b2"
        >
          ✕
        </button>
        <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 bg-g
                        rounded-pill px-3 py-1.5">
          <span className="w-4 h-4 rounded-full bg-white text-g flex items-center justify-center
                           text-caps font-extrabold">$</span>
          <span className="text-body-sm font-extrabold text-white">Booked</span>
        </div>
      </div>

      {/* sheet */}
      <div className="bg-cr rounded-t-[24px] -mt-4 px-5 pt-4 pb-6">
        <div className="w-9 h-1 bg-bdr rounded-full mx-auto mb-4" />
        <h1 className="text-heading-1 font-extrabold text-black mb-4">{jobType}</h1>

        {/* provider row */}
        <div className="flex items-center justify-between py-4 border-b border-bdr">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-g to-gd
                            flex items-center justify-center text-white font-extrabold text-body">
              {getInitials(provider.name)}
            </div>
            <div>
              <p className="text-[15px] font-extrabold text-black">{provider.name}</p>
              <p className="text-meta text-g font-extrabold">{provider.category}</p>
            </div>
          </div>
          <button
            onClick={() => bookingId
              ? navigate(`/messages/${bookingId}`)
              : showToast(`Calling ${provider.clientName}…`)}
            className="text-body font-extrabold text-g"
          >
            {bookingId ? 'Message' : `Call ${provider.clientName}`}
          </button>
        </div>

        {/* info rows */}
        {rows.map((row, i) => (
          <div key={i} className="flex justify-between items-start py-4 border-b border-bdr">
            <div className="flex-1 pr-3">
              <p className="text-[15px] font-extrabold text-black mb-1">{row.label}</p>
              {row.sub.split('\n').map((line, j) => (
                <p key={j} className="text-body-sm text-b3">{line}</p>
              ))}
            </div>
            <button
              onClick={() => row.to ? navigate(row.to) : showToast(row.toast)}
              className="text-body font-extrabold text-g whitespace-nowrap pt-1"
            >
              {row.action}
            </button>
          </div>
        ))}

        {/* request details */}
        <div className="pt-5">
          <p className="text-[15px] font-extrabold text-black mb-2">Request Details</p>
          <p className="text-body-sm text-b3 mb-2">{requestDetails.type}</p>
          <div className="flex flex-col gap-1.5 mb-4">
            {requestDetails.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-black" />
                <span className="text-body-sm text-black">{item}</span>
              </div>
            ))}
          </div>
          <p className="text-body-sm text-b3 mb-2">Extras</p>
          <div className="flex flex-col gap-1.5">
            {requestDetails.extras.map((e, i) => (
              <span key={i} className="text-body-sm text-black">{e}</span>
            ))}
          </div>
        </div>

        <div className="pt-6">
          <button
            onClick={() => navigate('/rate', { state: { bookingId } })}
            className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                       hover:opacity-90 active:scale-[.97] transition-all"
          >
            Mark service complete
          </button>
        </div>
      </div>
    </div>
  );
}
