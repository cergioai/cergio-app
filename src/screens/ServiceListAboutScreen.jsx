// Per design-spec.md — step 1 of Service Listing flow.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { RegHeader, RegFooter } from '../components/ui/RegHeader';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';
import { TaxonomyMatchBadge } from '../components/ui/TaxonomyMatchBadge';
import { InstagramConnectModal } from '../components/ui/InstagramConnectModal';
import { TikTokConnectModal } from '../components/ui/TikTokConnectModal';
import { useTaxonomyResolve } from '../hooks/useTaxonomyResolve';
import { getMyInstagram, saveInstagram, getMyTikTok, saveTikTok } from '../lib/api';

function fmtFollowers(n) {
  if (!Number.isFinite(+n)) return '';
  const x = +n;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (x >= 1_000)     return `${(x / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(x);
}

export function ServiceListAboutScreen() {
  const navigate = useNavigate();
  const { listingDraft, updateListingDraft, resetListingDraft, auth, showToast } = useOutletContext();
  const [serviceType, setServiceType] = useState(listingDraft.category || '');
  const [location, setLocation]       = useState(listingDraft.location || '');
  const [coords, setCoords]           = useState(null); // {lat,lng} when Google Place picked
  const [headline, setHeadline]       = useState(listingDraft.description || '');
  const [overrideTaxonomy, setOverrideTaxonomy] = useState(false);

  // Optional Instagram + TikTok connect for providers. Loaded from profile
  // so we pre-fill if they already linked either via the Rainmaker flow.
  const [igHandle, setIgHandle]    = useState('');
  const [igFollowers, setIgFollowers] = useState(null);
  const [showIgModal, setShowIgModal] = useState(false);
  const [ttHandle, setTtHandle]    = useState('');
  const [ttFollowers, setTtFollowers] = useState(null);
  const [showTtModal, setShowTtModal] = useState(false);
  useEffect(() => {
    if (!auth?.isSignedIn) return;
    getMyInstagram().then(({ data }) => {
      if (data?.instagram_handle) {
        setIgHandle(data.instagram_handle);
        setIgFollowers(data.instagram_followers ?? null);
      }
    });
    getMyTikTok().then(({ data }) => {
      if (data?.tiktok_handle) {
        setTtHandle(data.tiktok_handle);
        setTtFollowers(data.tiktok_followers ?? null);
      }
    });
  }, [auth?.isSignedIn]);

  // As the provider types the service type, run it through the same chat
  // resolver consumers use. We surface the match inline so they see how
  // their listing will be classified.
  const { resolving, result, resolveNow } = useTaxonomyResolve(serviceType);

  const valid = serviceType.trim() && location.trim() && headline.trim();

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <RegHeader
        title="Tell us about your service"
        sub="Add basic information about your service"
        minHeight={260}
      />

      <div className="bg-cr rounded-t-[28px] -mt-7 px-7 pt-7 flex-1 pb-32 overflow-y-auto">
        <Field label="Service type" placeholder="e.g. Plumber, Cleaning, Dog walker"
               value={serviceType} onChange={v => { setServiceType(v); setOverrideTaxonomy(false); }} />
        <TaxonomyMatchBadge
          resolving={resolving}
          result={result}
          overridden={overrideTaxonomy}
          onOverride={() => setOverrideTaxonomy(true)}
          onUndoOverride={() => setOverrideTaxonomy(false)}
        />
        <div className="mb-6 mt-6">
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

        {/* Socials — optional. Boosts trust + lets the service appear in
            friend-of-friend social feeds when Rainmakers spotlight them. */}
        <div className="mb-2">
          <label className="block text-[18px] font-extrabold text-black mb-1.5">
            Socials <span className="text-[12px] font-bold text-b3 align-middle">(optional)</span>
          </label>
          <p className="text-[12px] text-b3 mb-2.5 leading-relaxed">
            Helps customers trust your work and lets Rainmakers tag you when they spotlight your service.
          </p>

          {/* Instagram row */}
          {igHandle ? (
            <div className="bg-white border border-bdr rounded-[14px] p-3 flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-[10px] bg-black flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                     stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <circle cx="12" cy="12" r="4.5" />
                  <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-extrabold text-black leading-tight">@{igHandle}</p>
                {igFollowers != null && (
                  <p className="text-[11px] text-b3 mt-0.5">{fmtFollowers(igFollowers)} followers</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowIgModal(true)}
                className="text-[12px] font-extrabold text-g underline underline-offset-2"
              >
                Edit
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowIgModal(true)}
              className="w-full bg-white border border-bdr rounded-[14px] py-3 text-[13px] font-extrabold text-black
                         flex items-center justify-center gap-2 hover:border-g hover:bg-gl/40 transition-colors mb-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="black" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" />
                <circle cx="12" cy="12" r="4.5" />
                <circle cx="17.5" cy="6.5" r="1.2" fill="black" stroke="none" />
              </svg>
              Connect Instagram
            </button>
          )}

          {/* TikTok row */}
          {ttHandle ? (
            <div className="bg-white border border-bdr rounded-[14px] p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-[10px] bg-black flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                  <path d="M16.6 5.82a4.28 4.28 0 0 1-2.6-1.82V14.5a3.5 3.5 0 1 1-3.5-3.5v2.06a1.44 1.44 0 1 0 1.44 1.44V2h2.06a4.27 4.27 0 0 0 4.27 4.27v2.06a6.34 6.34 0 0 1-1.67-.22v-2.29z"/>
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-extrabold text-black leading-tight">@{ttHandle}</p>
                {ttFollowers != null && (
                  <p className="text-[11px] text-b3 mt-0.5">{fmtFollowers(ttFollowers)} audience</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowTtModal(true)}
                className="text-[12px] font-extrabold text-g underline underline-offset-2"
              >
                Edit
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowTtModal(true)}
              className="w-full bg-white border border-bdr rounded-[14px] py-3 text-[13px] font-extrabold text-black
                         flex items-center justify-center gap-2 hover:border-g hover:bg-gl/40 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="black">
                <path d="M16.6 5.82a4.28 4.28 0 0 1-2.6-1.82V14.5a3.5 3.5 0 1 1-3.5-3.5v2.06a1.44 1.44 0 1 0 1.44 1.44V2h2.06a4.27 4.27 0 0 0 4.27 4.27v2.06a6.34 6.34 0 0 1-1.67-.22v-2.29z"/>
              </svg>
              Connect TikTok
            </button>
          )}
        </div>
      </div>

      {showIgModal && (
        <InstagramConnectModal
          initialHandle={igHandle}
          initialFollowers={igFollowers ?? ''}
          title="Connect your Instagram"
          subtitle="Optional — boosts trust and lets Rainmakers tag you in spotlights."
          onSave={async ({ handle: h, followers: f, verified }) => {
            const { data, error } = await saveInstagram({ handle: h, followers: f, verified });
            if (error) throw new Error(error.message);
            setIgHandle(data?.instagram_handle ?? h);
            setIgFollowers(data?.instagram_followers ?? f ?? null);
            showToast?.('Instagram saved ✓');
            setShowIgModal(false);
          }}
          onClose={() => setShowIgModal(false)}
        />
      )}

      {showTtModal && (
        <TikTokConnectModal
          initialHandle={ttHandle}
          initialFollowers={ttFollowers ?? ''}
          title="Connect your TikTok"
          subtitle="Optional — adds your TikTok audience so we can spotlight you to a broader crowd."
          onSave={async ({ handle: h, followers: f, verified }) => {
            const { data, error } = await saveTikTok({ handle: h, followers: f, verified });
            if (error) throw new Error(error.message);
            setTtHandle(data?.tiktok_handle ?? h);
            setTtFollowers(data?.tiktok_followers ?? f ?? null);
            showToast?.('TikTok saved ✓');
            setShowTtModal(false);
          }}
          onClose={() => setShowTtModal(false)}
        />
      )}

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

          // Make sure we have a resolver result before saving. The debounce
          // may not have fired yet if the user submitted quickly.
          const taxo = result ?? await resolveNow();
          const useTaxo = !overrideTaxonomy && taxo?.ok;

          updateListingDraft({
            category:    serviceType.trim(),
            location:    location.trim(),
            description: headline.trim(),
            lat, lng,
            taxonomy_category:      useTaxo ? (taxo.category || null) : null,
            taxonomy_provider_type: useTaxo ? (taxo.provider_type || null) : null,
            taxonomy_offering_id:   useTaxo ? (taxo.offering_id || null) : null,
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
