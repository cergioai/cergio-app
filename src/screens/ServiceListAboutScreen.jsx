// Per design-spec.md — step 1 of Service Listing flow.
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { RegHeader, RegFooter } from '../components/ui/RegHeader';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';

export function ServiceListAboutScreen() {
  const navigate = useNavigate();
  const { listingDraft, updateListingDraft, resetListingDraft } = useOutletContext();
  const [serviceType, setServiceType] = useState(listingDraft.category || '');
  const [location, setLocation]       = useState(listingDraft.location || '');
  const [coords, setCoords]           = useState(null); // {lat,lng} when Google Place picked
  const [headline, setHeadline]       = useState(listingDraft.description || '');

  const valid = serviceType.trim() && location.trim() && headline.trim();

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <RegHeader
        title="Tell us about your service"
        sub="Add basic information about your service"
        minHeight={260}
      />

      <div className="bg-cr rounded-t-[28px] -mt-7 px-7 pt-7 flex-1 pb-32 overflow-y-auto">
        <Field label="Service type" placeholder="Type a service category"
               value={serviceType} onChange={setServiceType} />
        <div className="mb-6">
          <label className="block text-[18px] font-extrabold text-black mb-2.5">Service location</label>
          <AddressAutocomplete
            value={location}
            onChange={setLocation}
            onSelect={({ lat, lng, address }) => { setCoords({ lat, lng }); setLocation(address); }}
            placeholder="Where do you offer this service?"
          />
        </div>
        <Field label="Service headline" placeholder="Add a quick bio about your service, your experience and what sets you apart."
               value={headline} onChange={setHeadline} type="textarea" />
      </div>

      <RegFooter
        progress={0.1}
        onNext={async () => {
          resetListingDraft();
          // If the user just typed an address without picking from autocomplete,
          // try a one-shot geocode so we still capture lat/lng. Wrapped in
          // try/catch so a Google Maps failure (bad key, blocked referrer,
          // offline) doesn't kill the form — proximity ranking just degrades
          // to recency-ordered until the next time we capture coords.
          let lat = coords?.lat ?? null;
          let lng = coords?.lng ?? null;
          if (!lat && location.trim()) {
            try {
              const { geocodeAddress } = await import('../lib/google');
              const g = await geocodeAddress(location);
              if (g) { lat = g.lat; lng = g.lng; }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('[list-service] geocode failed; saving without coords', e);
            }
          }
          updateListingDraft({
            category:    serviceType.trim(),
            location:    location.trim(),
            description: headline.trim(),
            lat, lng,
          });
          navigate('/list-service/hourly-or-session');
        }}
        nextEnabled={valid}
      />
    </div>
  );
}

function Field({ label, placeholder, value, onChange, type = 'input' }) {
  return (
    <div className="mb-6">
      <label className="block text-[18px] font-extrabold text-black mb-2.5">{label}</label>
      {type === 'textarea' ? (
        <textarea
          value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={4}
          className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans"
        />
      ) : (
        <input
          type="text"
          value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
        />
      )}
    </div>
  );
}
