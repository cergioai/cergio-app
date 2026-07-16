// Per design-spec.md — step 1 of Service Listing flow.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { RegHeader, RegFooter } from '../components/ui/RegHeader';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';
import { ServiceAreaMapPicker } from '../components/ui/ServiceAreaMapPicker';
// TaxonomyMatchBadge removed from the visible UI — taxonomy is only
// used internally (provider_type / offering_id are still resolved and
// saved on submit so we can route notifications to matching providers
// and surface this listing in the right consumer searches).
import { InstagramConnectModal } from '../components/ui/InstagramConnectModal';

// Provider-type suggestions sourced from the LIVE backend taxonomy.
// PROVIDER_TYPES is auto-generated from
// supabase/functions/chat-parse/data/taxonomy.json (373 entries
// including Personal Chef, Dog Sitter, Lactation Consultant, etc.) —
// so the dropdown always matches what the backend can actually route.
// CERGIO-GUARD: provider_type-level only, never offering names.
// See CHECKLIST §2.
import { PROVIDER_TYPES } from '../data/providerTypes';
// CERGIO-GUARD (launch-13-match-notify): the LISTING side must resolve a
// free-text service type through the SAME deterministic local taxonomy the
// REQUEST side uses (resolveProviderTypeLocal). Without it, a phrase like
// "french tutor" matched no exact catalog entry (canonicalMatch=null) and,
// whenever the cloud resolver stalled/low-confidenced (parserPT=null), the
// listing saved taxonomy_provider_type=NULL → invisible to getProvidersForNotify
// AND listServices. Meanwhile a "french tutor" SEARCH resolves locally to
// "Tutor", so the request never reached the listed provider. The local map
// returns the EXACT string providers register under, so it closes that
// request↔listing asymmetry (the dead-core-loop the founder hit).
import { resolveProviderTypeLocal } from '../lib/serviceTaxonomy';

// Case-insensitive substring filter. When the field is empty, show the
// most-commonly-used handful as starter suggestions; otherwise filter
// the full 373-entry list and cap at 8 visible matches.
const STARTER_TYPES = [
  'Plumber', 'Cleaner', 'Driver', 'Babysitter', 'Tutor',
  'Personal Chef', 'Dog Walker', 'Dog Trainer',
];
function filterServiceSuggestions(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return STARTER_TYPES;
  return PROVIDER_TYPES
    .filter(opt => opt.toLowerCase().includes(q))
    .slice(0, 8);
}
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
  const [serviceTypeFocused, setServiceTypeFocused] = useState(false);
  const [location, setLocation]       = useState(listingDraft.location || '');
  const [coords, setCoords]           = useState(null); // {lat,lng} when Google Place picked
  // CERGIO-GUARD (2026-05-30): provider-drawn service-area polygon.
  // Persisted on Next as draft.serviceAreaGeoJson and saved on the
  // services row by createService.
  const [serviceAreaGeoJson, setServiceAreaGeoJson] = useState(
    listingDraft.serviceAreaGeoJson || null
  );
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [headline, setHeadline]       = useState(listingDraft.description || '');
  const [overrideTaxonomy, setOverrideTaxonomy] = useState(false);

  // Optional Instagram + TikTok connect for providers. Loaded from profile
  // so we pre-fill if they already linked either via the Connector flow.
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
        {/* Service type with LIVE type-ahead dropdown. As the provider
            types, we filter SERVICE_TYPE_OPTIONS by substring and show
            up to 6 matches. CERGIO-GUARD: suggestions are provider-type
            level only (Plumber / Babysitter / …), never offering names. */}
        <div className="mb-6 relative">
          <label className="block text-heading-2 font-extrabold text-black mb-2.5">Service type</label>
          <input
            type="text"
            value={serviceType}
            onChange={e => { setServiceType(e.target.value); setOverrideTaxonomy(false); }}
            onFocus={() => setServiceTypeFocused(true)}
            onBlur={() => setTimeout(() => setServiceTypeFocused(false), 150)} /* delay so click lands */
            placeholder="e.g. Plumber, Cleaner, Babysitter"
            autoComplete="off"
            className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-body text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
          {serviceTypeFocused && (() => {
            const matches = filterServiceSuggestions(serviceType);
            if (matches.length === 0) return null;
            // Hide if the only match is exactly what's already typed.
            if (matches.length === 1 && matches[0].toLowerCase() === serviceType.toLowerCase()) return null;
            return (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-bdr
                              rounded-[14px] shadow-card py-1 max-h-[240px] overflow-y-auto">
                {matches.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()} /* keep input focus so onBlur doesn't fire first */
                    onClick={() => {
                      setServiceType(opt);
                      setOverrideTaxonomy(false);
                      setServiceTypeFocused(false);
                    }}
                    className="w-full text-left px-4 py-2 text-body text-b2 hover:bg-bg5 transition-colors"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            );
          })()}
          {/* Taxonomy-resolve hint — Phase 6.5 (2026-06-02): per Tarik's
              "can we add new service types not in taxonomy and cross-check
              if they're real" — surface what chat-parse mapped the typed
              text to + related candidates. Three states:
                resolving   → muted spinner copy
                ok (≥0.60)  → mint pill with "Mapped to {provider_type}"
                              + first 3 candidate offering hints
                low conf    → amber "We don't recognize this — try a more
                              specific category" warning (does NOT block
                              the form; provider can still submit but we
                              tag the row with taxonomy_provider_type=null
                              and log for backfill). */}
          {serviceType.trim().length >= 3 && (() => {
            const inStarter = STARTER_TYPES.some(t => t.toLowerCase() === serviceType.toLowerCase().trim());
            const inFull    = PROVIDER_TYPES.some(t => t.toLowerCase() === serviceType.toLowerCase().trim());
            const knownExact = inStarter || inFull;
            const candidates = (result?.candidates || []).slice(0, 3);
            const okMapped = result?.ok && !knownExact;
            const noiseWarn = !!result && !result.ok && !knownExact && (result.confidence ?? 0) < 0.30;
            return (
              <div className="mt-2 leading-snug">
                {resolving && (
                  <p className="text-meta text-b3 italic">Checking taxonomy…</p>
                )}
                {okMapped && (
                  <div className="inline-flex flex-wrap items-center gap-1.5 bg-gl text-gd
                                  rounded-pill px-2.5 py-1 text-meta-sm font-extrabold">
                    Mapped to {result.provider_type}
                    {candidates.length > 0 && (
                      <span className="font-medium text-gd/80">
                        · related: {candidates.map(c => c.offering_name || c.provider_type || c).filter(Boolean).slice(0,3).join(', ')}
                      </span>
                    )}
                  </div>
                )}
                {noiseWarn && (
                  <p className="text-meta text-warnText bg-warnBg border border-warn/40 rounded-[10px] px-2.5 py-1.5">
                    We don't recognize "{serviceType.trim()}" as a known service type.
                    Try something more specific (e.g. <span className="font-extrabold">Personal Chef</span>,
                    <span className="font-extrabold"> Plumber</span>). You can still submit — Cergio will review it.
                  </p>
                )}
              </div>
            );
          })()}
        </div>
        {/* The original <Field> wrapper is replaced by the relative
            container above; we keep this dummy spacing so the rest of
            the form lays out the same. */}
        <div className="mb-6 mt-6">
          <label className="block text-heading-2 font-extrabold text-black mb-2.5">Service location</label>
          <AddressAutocomplete
            value={location}
            onChange={setLocation}
            onSelect={({ lat, lng, address }) => { setCoords({ lat, lng }); setLocation(address); }}
            placeholder="Where do you offer this service?"
          />
          {/* CERGIO-GUARD (2026-05-30): optional service-area polygon.
              Provider can draw their coverage on a map. When set, the
              consumer search filters out anyone whose search point is
              outside the polygon (point-in-polygon, client-side). */}
          <button
            type="button"
            onClick={() => setAreaPickerOpen(true)}
            disabled={!coords && !location.trim()}
            className={`mt-2 w-full flex items-center gap-2 px-3 py-2.5 rounded-[12px] border text-left
                        ${serviceAreaGeoJson
                          ? 'bg-gl border-g/40 text-gd'
                          : 'bg-white border-bdr text-b2 hover:border-g/40 disabled:opacity-50'}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z"/><path d="M9 4v13"/><path d="M15 7v13"/>
            </svg>
            <span className="text-meta font-extrabold">
              {serviceAreaGeoJson
                ? 'Service area drawn — tap to edit'
                : 'Draw your service area (optional)'}
            </span>
            {serviceAreaGeoJson && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); setServiceAreaGeoJson(null); }}
                className="ml-auto text-meta-sm font-medium underline cursor-pointer"
              >
                Clear
              </span>
            )}
          </button>
          {!coords && !location.trim() && (
            <p className="text-meta-sm text-b3 mt-1">Pick a service location first to anchor the map.</p>
          )}
        </div>
        <Field label="Service headline" placeholder="Add a quick bio about your service, your experience and what sets you apart."
               value={headline} onChange={setHeadline} type="textarea" />

        {/* Socials — optional. Boosts trust + lets the service appear in
            friend-of-friend social feeds when Connectors spotlight them. */}
        <div className="mb-2">
          <label className="block text-heading-2 font-extrabold text-black mb-1.5">
            Socials <span className="text-meta font-extrabold text-b3 align-middle">(optional)</span>
          </label>
          <p className="text-meta text-b3 mb-2.5 leading-relaxed">
            Helps customers trust your work and lets Connectors tag you when they spotlight your service.
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
                <p className="text-body font-extrabold text-black leading-tight">@{igHandle}</p>
                {igFollowers != null && (
                  <p className="text-meta-sm text-b3 mt-0.5">{fmtFollowers(igFollowers)} followers</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowIgModal(true)}
                className="text-meta font-extrabold text-g underline underline-offset-2"
              >
                Edit
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowIgModal(true)}
              className="w-full bg-white border border-bdr rounded-[14px] py-3 text-body-sm font-extrabold text-black
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
                <p className="text-body font-extrabold text-black leading-tight">@{ttHandle}</p>
                {ttFollowers != null && (
                  <p className="text-meta-sm text-b3 mt-0.5">{fmtFollowers(ttFollowers)} audience</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowTtModal(true)}
                className="text-meta font-extrabold text-g underline underline-offset-2"
              >
                Edit
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowTtModal(true)}
              className="w-full bg-white border border-bdr rounded-[14px] py-3 text-body-sm font-extrabold text-black
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
          subtitle="Optional — boosts trust and lets Connectors tag you in spotlights."
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
          // CERGIO-GUARD: Next MUST always advance even if geocode or
          // resolveNow stalls. Each external call is wrapped with a
          // 2s race; whatever resolves first wins, and the provider
          // moves forward either way. See CHECKLIST.md §6.
          try {
            resetListingDraft();
            let lat = coords?.lat ?? null;
            let lng = coords?.lng ?? null;
            let canonicalLocation = location.trim();
            if (!lat && location.trim()) {
              try {
                // CERGIO-GUARD: verify the provider's typed service
                // location via Google so the listing carries a real
                // address. Canonicalize text + capture coords.
                const { verifyAddress } = await import('../lib/google');
                const v = await Promise.race([
                  verifyAddress(location),
                  new Promise(res => setTimeout(() => res({ ok: false, reason: 'timeout' }), 2000)),
                ]);
                if (v?.ok) {
                  lat = v.lat; lng = v.lng;
                  canonicalLocation = v.address;
                  setLocation(v.address);
                }
              } catch (e) {
                // eslint-disable-next-line no-console
                console.warn('[list-service] geocode failed; saving without coords', e);
              }
            }

            // Resolve taxonomy with a hard 2s timeout. Stale or hanging
            // edge functions can no longer block the user from advancing.
            let taxo = result;
            if (!taxo) {
              try {
                taxo = await Promise.race([
                  resolveNow(),
                  new Promise(res => setTimeout(() => res(null), 2000)),
                ]);
              } catch (_e) { taxo = null; }
            }
            const useTaxo = !overrideTaxonomy && taxo?.ok;

            // CERGIO-GUARD (2026-06-02): canonical-match fast path.
            // Per Tarik (2026-06-02): "registered a service as a
            // plumber info@cergio.ai .. then logged in as t@cergio.ai
            // and did a search and couldn't find the service." Root
            // cause: when the chat-parse resolver stalls / returns
            // low confidence, `taxonomy_provider_type` saved as NULL.
            // listServices' STRICT filter (lib/api.js: provider_type
            // → `s.taxonomy_provider_type == want`) and
            // getProvidersForNotify's exact-match allowlist BOTH
            // exclude rows with NULL taxonomy. Result: service is
            // invisible to search AND providers don't get notified
            // of matching free-spotlight requests from Connectors.
            //
            // Fix: when the typed serviceType is an EXACT match
            // (case-insensitive) against the canonical PROVIDER_TYPES
            // catalog, lock it in as taxonomy_provider_type
            // regardless of chat-parse confidence. The dropdown
            // selection IS the verified taxonomy — chat-parse is
            // only needed for fuzzy free-text input.
            const typedTrim = serviceType.trim();
            const canonicalMatch = (STARTER_TYPES.find(t => t.toLowerCase() === typedTrim.toLowerCase())
                                 || PROVIDER_TYPES.find(t => t.toLowerCase() === typedTrim.toLowerCase())
                                 || null);
            // CERGIO-GUARD (2026-06-03): when chat-parse stalls / drifts
            // it can return a generic catch-all string like "Service
            // Provider" or "Professional". listServices' strict filter
            // AND getProvidersForNotify's allowlist BOTH require an
            // exact canonical match — generic values mean the row is
            // invisible AND the provider misses every notification.
            // Discovered 2026-06-03 from info@cergio.ai's two Personal
            // Chef listings both saved with taxonomy_provider_type=
            // 'Service Provider' → didn't appear in fan-out.
            // Guard: drop the parser's value when it's generic and
            // fall through to the dropdown canonical.
            const GENERIC_PT = new Set([
              'service','services','service provider','service providers',
              'provider','providers','professional','professionals',
              'expert','experts','specialist','specialists',
              'worker','workers','helper','helpers',
              'contractor','contractors','vendor','vendors',
              'business','businesses','company','companies',
              'freelancer','freelancers',
            ]);
            const isGeneric = (v) =>
              !v || GENERIC_PT.has(String(v).trim().toLowerCase());
            const parserPT = (useTaxo && !isGeneric(taxo.provider_type))
              ? taxo.provider_type
              : null;
            // CERGIO-GUARD (launch-13-match-notify): deterministic local
            // taxonomy is the LAST-RESORT lock so a free-text type never
            // saves NULL. It only fires when the cloud parser (parserPT) AND
            // the exact catalog match (canonicalMatch) both came up empty —
            // exactly the "french tutor + cloud stalled" case that was saving
            // NULL and making the listing invisible to the request fan-out.
            // Same resolver, same EXACT strings, as the request write path.
            const localPT = resolveProviderTypeLocal(typedTrim);
            const resolvedProviderType = parserPT || canonicalMatch || localPT;

            // CERGIO-GUARD (2026-06-02): novel-type telemetry. Per
            // Tarik: "augment the taxonomy gradually (and add related
            // terms)." When a provider types something that doesn't
            // map to a known PROVIDER_TYPES entry exactly AND the
            // resolver couldn't confidently classify it, log it for
            // backfill. A future migration ships a
            // `provider_type_suggestions` table; for now console.warn
            // is the channel so Tarik can grep logs / hook a webhook.
            const isKnown = STARTER_TYPES.includes(serviceType.trim())
                         || PROVIDER_TYPES.includes(serviceType.trim());
            if (!isKnown) {
              const payload = {
                novel_type:        serviceType.trim(),
                resolved_to:       taxo?.provider_type || null,
                confidence:        taxo?.confidence ?? 0,
                accepted:          !!useTaxo,
                candidate_offerings: (taxo?.candidates || []).slice(0,5).map(c => c.offering_name || c.provider_type || c),
                source:            'list-service-about',
                ts:                new Date().toISOString(),
              };
              // eslint-disable-next-line no-console
              console.warn('[cergio/novel-provider-type]', payload);
              // Best-effort persistent log: a tiny analytics event so
              // we can pull a backfill list from Supabase later without
              // needing a new table. Falls back silently if not wired.
              try {
                const { logEvent } = await import('../lib/api');
                if (typeof logEvent === 'function') logEvent('novel_provider_type', payload).catch(() => {});
              } catch { /* api doesn't export logEvent yet — console is enough */ }
            }

            updateListingDraft({
              category:    serviceType.trim(),
              location:    canonicalLocation,
              description: headline.trim(),
              lat, lng,
              taxonomy_category:      useTaxo ? (taxo.category || null) : null,
              taxonomy_provider_type: resolvedProviderType,
              taxonomy_offering_id:   useTaxo ? (taxo.offering_id || null) : null,
              // CERGIO-GUARD (2026-05-30): forward the drawn polygon
              // (if any) into the draft so createService persists it.
              serviceAreaGeoJson: serviceAreaGeoJson,
            });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[list-service] onNext error, advancing anyway', e);
          }
          navigate('/list-service/hourly-or-session');
        }}
        nextEnabled={valid}
      />

      {/* Service-area polygon picker — bottom sheet, opens centered on
          the typed/picked location. Defaults to Times Square if no
          coords resolved yet (the inner picker handles that). */}
      {areaPickerOpen && (
        <ServiceAreaMapPicker
          center={coords || null}
          value={serviceAreaGeoJson}
          onChange={setServiceAreaGeoJson}
          onClose={() => setAreaPickerOpen(false)}
        />
      )}
    </div>
  );
}

function Field({ label, placeholder, value, onChange, type = 'input' }) {
  return (
    <div className="mb-6">
      <label className="block text-heading-2 font-extrabold text-black mb-2.5">{label}</label>
      {type === 'textarea' ? (
        <textarea
          value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={4}
          className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-body text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans"
        />
      ) : (
        <input
          type="text"
          value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-body text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
        />
      )}
    </div>
  );
}
