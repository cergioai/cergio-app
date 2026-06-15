// Per design-spec.md — rate the service then confirm completion (irreversible).
import { useEffect, useState } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { updateBookingStatus, createReview, getBooking } from '../lib/api';

// Fallback shown for demo paths (no bookingId), or while real data is loading.
const JOB_FALLBACK = {
  provider: { name: 'Jennifer L', category: 'Housekeeper' },
  requestDetails: {
    type: 'Apartment / House Clean',
    items: ['2 Bedrooms', '2 Baths', '1000+ Sq Ft.'],
    extras: ['+ (2) Laundry Bags', '+ Deep Cleaning', '+ Needs cleaning supplies'],
  },
};

// Pull a renderable shape out of a Supabase bookings row joined with
// consumer/provider/service/offering. We rate the OTHER party — provider rates
// the customer; customer rates the provider.
function bookingToJob(b, myId) {
  const consumerName = b.consumer?.display_name || 'Customer';
  const providerName = b.provider?.display_name || 'Provider';
  const iAmProvider  = myId && b.provider?.id === myId;
  const otherName    = iAmProvider ? consumerName : providerName;
  const otherCategory = b.service?.category || (iAmProvider ? 'Customer' : 'Provider');

  return {
    provider: { name: otherName, category: otherCategory },
    requestDetails: {
      type: b.service?.title || b.service?.category || 'Service',
      items: [b.location_text].filter(Boolean),
      extras: b.notes ? [b.notes] : [],
    },
  };
}

const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent!'];

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

function StarRating({ value, onChange, size = 44 }) {
  return (
    <div>
      <div className="flex gap-3 mb-2">
        {[1, 2, 3, 4, 5].map(i => (
          <svg
            key={i}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className="cursor-pointer flex-shrink-0"
            onClick={() => onChange(i)}
          >
            <path
              d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z"
              fill={i <= value ? '#4AA901' : '#E5E5E3'}
            />
          </svg>
        ))}
      </div>
      {value > 0 && (
        <p className="text-body font-extrabold text-g">{RATING_LABELS[value]}</p>
      )}
    </div>
  );
}

export function RateConfirmScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast, auth } = useOutletContext();
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);
  const bookingId = location.state?.bookingId;

  // When a real bookingId is present, fetch the booking and render its actual
  // customer/service. Otherwise (demo path), keep the hardcoded fallback so
  // the screen still looks complete.
  const [job, setJob] = useState(JOB_FALLBACK);
  const [client, setClient] = useState({ name: null, followers: 0 });
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    getBooking(bookingId).then(({ data, error }) => {
      if (cancelled || error || !data) return;
      setJob(bookingToJob(data, auth?.user?.id));
      setClient({ name: data.consumer?.display_name || null, followers: data.consumer?.instagram_followers || 0 });
    });
    return () => { cancelled = true; };
  }, [bookingId, auth?.user?.id]);

  const { provider, requestDetails } = job;

  return (
    <div className="flex-1 flex flex-col bg-cr pb-20 overflow-y-auto">
      {/* close */}
      <div className="px-5 pt-4">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-card border border-bdr
                     flex items-center justify-center text-b2"
        >
          ✕
        </button>
      </div>

      {/* heading */}
      <div className="px-5 pt-4 pb-5">
        <h1 className="text-display-2 font-extrabold text-black leading-tight">
          Rate and confirm completion
        </h1>
      </div>

      {/* provider */}
      <div className="px-5 pb-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-g to-gd
                        flex items-center justify-center text-white font-extrabold text-body">
          {getInitials(provider.name)}
        </div>
        <div>
          <p className="text-body-lg font-extrabold text-black">{provider.name}</p>
          <p className="text-meta text-g font-extrabold">{provider.category}</p>
        </div>
      </div>

      {/* stars */}
      <div className="px-5 pb-2">
        <StarRating value={rating} onChange={setRating} />
      </div>

      <div className="h-px bg-bdr mx-5 my-4" />

      {/* details */}
      <div className="px-5 flex-1">
        <p className="text-body-lg font-extrabold text-black mb-2">{requestDetails.type}</p>
        <div className="flex flex-col gap-1.5 mb-5">
          {requestDetails.items.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-b3" />
              <span className="text-body-sm text-b3">{item}</span>
            </div>
          ))}
        </div>
        <p className="text-body-lg font-extrabold text-black mb-2">Extras</p>
        <div className="flex flex-col gap-1.5">
          {requestDetails.extras.map((e, i) => (
            <span key={i} className="text-body-sm text-b3">{e}</span>
          ))}
        </div>
      </div>

      {/* confirm */}
      <div className="px-5 pt-6 pb-4 mt-auto">
        <p className="text-body-sm font-extrabold text-black mb-1">
          Marking a job complete is final
        </p>
        <p className="text-meta text-b3 mb-4">This action cannot be reversed.</p>
        <button
          onClick={async () => {
            if (rating === 0) { showToast('Please rate before confirming'); return; }
            setBusy(true);
            if (bookingId) {
              // 1. Mark the booking complete (provider side already did this
              //    when reaching here from /job; this is idempotent).
              const { error: statusErr } = await updateBookingStatus(bookingId, 'completed');
              if (statusErr) { setBusy(false); showToast(`Failed: ${statusErr.message}`); return; }

              // 2. Persist the star rating as a review.
              const { error: revErr } = await createReview(bookingId, rating);
              if (revErr && !/duplicate key/i.test(revErr.message || '')) {
                setBusy(false);
                showToast(`Couldn't save rating: ${revErr.message}`);
                return;
              }
            }
            setBusy(false);
            navigate('/complete', { state: { consumerName: client.name, followers: client.followers } });
          }}
          disabled={rating === 0 || busy}
          className={`w-full rounded-[24px] py-4 text-body-lg font-extrabold transition-all
                      ${rating === 0 || busy
                        ? 'bg-bg5 text-b3 cursor-not-allowed'
                        : 'bg-g text-white hover:opacity-90 active:scale-[.97]'}`}
        >
          {busy ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
