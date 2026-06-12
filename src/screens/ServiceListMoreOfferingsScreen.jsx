// Per design-spec.md — review offerings, add more or proceed.
// When reached from ServiceDetailProviderScreen (managing an existing
// service), location.state.serviceId is present and we load that
// service's real offerings from the API rather than listingDraft.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import { RegHeader, RegFooter } from '../components/ui/RegHeader';

function formatPrice(o) {
  const price = o.price?.startsWith('$') ? o.price : `$${o.price || '0'}`;
  if (o.kind === 'hourly')  return `${price} per hour`;
  if (o.kind === 'session') return `${price} per session${o.durationMinutes ? ` · ${o.durationMinutes} min` : ''}`;
  return price;
}

export function ServiceListMoreOfferingsScreen() {
  const navigate   = useNavigate();
  const location   = useLocation();
  const { listingDraft } = useOutletContext();
  const serviceId  = location.state?.serviceId || null;

  // When serviceId is present we load offerings from the real service;
  // otherwise fall back to the in-memory listingDraft (new listing flow).
  const [liveOfferings, setLiveOfferings] = useState(null);
  useEffect(() => {
    if (!serviceId) return;
    import('../lib/api').then(({ getServiceOfferings }) => {
      if (!getServiceOfferings) return;          // guard: fn may not exist yet
      getServiceOfferings(serviceId).then(({ data }) => {
        if (data?.length) setLiveOfferings(data);
      });
    });
  }, [serviceId]);

  // Fallback so the screen still has something to show if the user landed here
  // directly (e.g. via dev URL) without first picking offerings.
  const draftRows = listingDraft.offerings.length > 0
    ? listingDraft.offerings.map((o, i) => ({
        id: `o${i}`,
        name: o.name || (o.kind === 'session' ? 'Session' : 'Hourly'),
        desc: o.description || (o.kind === 'session' ? 'A session-based offering' : 'An hourly offering'),
        rate: formatPrice(o),
      }))
    : [{ id: 'empty', name: 'No offerings yet', desc: 'Add one to continue', rate: '' }];

  const offerings = liveOfferings
    ? liveOfferings.map((o, i) => ({
        id: o.id || `lo${i}`,
        name: o.name || o.title || 'Offering',
        desc: o.description || '',
        rate: formatPrice(o),
      }))
    : draftRows;

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <RegHeader
        title="Any more offerings?"
        sub="We added your hourly house cleaning service! Feel free to add any special packages or custom offerings."
        minHeight={300}
      />

      <div className="bg-cr rounded-t-[28px] -mt-7 px-5 pt-7 flex-1 pb-32 overflow-y-auto">
        <p className="text-heading-2 font-extrabold text-black mb-4">Your offerings</p>

        <div className="flex flex-col gap-3 mb-4">
          {offerings.map(o => (
            <div key={o.id} className="bg-white border border-bdr rounded-[18px] p-4">
              <p className="text-body-lg font-extrabold text-black mb-1">{o.name}</p>
              <p className="text-body-sm text-b3 leading-relaxed mb-3">{o.desc}</p>
              <p className="text-body-lg font-extrabold text-black">{o.rate}</p>
            </div>
          ))}
        </div>

        <button
          onClick={() => navigate('/list-service/add-new-offering')}
          className="w-full border-2 border-dashed border-g bg-gl/40 rounded-[18px] py-5
                     text-body font-extrabold text-g"
        >
          + Add another
        </button>
      </div>

      <RegFooter
        progress={0.5}
        onNext={() => navigate('/list-service/photos-intro')}
      />
    </div>
  );
}
