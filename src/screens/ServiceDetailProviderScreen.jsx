// Per design-spec.md — Provider's view of a service they offer.
// Real Supabase data only. Non-UUID ids (old mock ids like `svc-u1`)
// render the not-found state — CERGIO-GUARD: no fake data.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { getService, unlistService, relistService, deleteService, updateService } from '../lib/api';
import { uploadAndPersistServiceCover } from '../lib/storage';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function centsToPrice(cents) {
  if (cents == null) return '—';
  const dollars = (cents / 100).toFixed(0);
  return `$${dollars}`;
}

export function ServiceDetailProviderScreen() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { showToast } = useOutletContext();
  const [svc, setSvc] = useState(null);
  const [loading, setLoading] = useState(true);
  // Cover-photo upload state. fileInputRef is the hidden <input
  // type="file"> the "Edit photos" button triggers via click(). busy
  // gates concurrent uploads + shows the spinner.
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  // CERGIO-GUARD (2026-06-05 v6): inline-confirm armed state for the
  // destructive "Delete service" button. Tarik: "cancel request should
  // be in line (not a pop up from browser)." Auto-disarms after 5s.
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    if (!deleteArmed) return;
    const t = setTimeout(() => setDeleteArmed(false), 5000);
    return () => clearTimeout(t);
  }, [deleteArmed]);

  const handleCoverPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';                 // reset so the same file can re-fire
    if (!file || !svc?.real) return;
    setUploading(true);
    const { url, error } = await uploadAndPersistServiceCover(file, svc.id);
    setUploading(false);
    if (error) { showToast(`Couldn't upload: ${error.message}`); return; }
    // Optimistic local update + we'll re-render the hero with the new URL.
    setSvc(s => ({ ...s, coverUrl: url }));
    showToast('Cover updated ✓');
  };

  /** Inline single-field editor via window.prompt — no extra screens.
   *  Persists via updateService(). The svc state updates optimistically
   *  so the row's subtitle reflects the new value without a refresh.
   *  CERGIO-GUARD: replaces three 'coming soon' toast dead-ends. */
  const editServiceField = async (column, current, label) => {
    if (!svc?.real) { showToast('Demo service — sign up to edit your own.'); return; }
    const next = typeof window !== 'undefined' ? window.prompt(label, current || '') : null;
    if (next == null) return;                 // user cancelled
    const trimmed = next.trim();
    if (trimmed === (current || '')) return;  // no change
    const { error } = await updateService(svc.id, { [column]: trimmed || null });
    if (error) { showToast(`Couldn't save: ${error.message}`); return; }
    const localKey = column === 'location_text' ? 'location' : column;
    setSvc(s => ({ ...s, [localKey]: trimmed || null }));
    showToast('Saved ✓');
  };

  useEffect(() => {
    let cancelled = false;

    if (UUID_RE.test(id)) {
      getService(id).then(({ data, error }) => {
        if (cancelled) return;
        setLoading(false);
        if (error || !data) {
          // CERGIO-GUARD: previously fell back to MANAGED_SERVICES.listed[0]
          // — a fake "Jamie's House Cleaning" — so a provider whose real
          // service failed to load saw a Jamie listing they didn't own and
          // could edit it (writes would no-op because svc.real=false).
          // Brand-killing on its own; legally noisy because a real provider
          // appears to be misrepresented as their own service. Show a
          // proper not-found state instead.
          setSvc({ id, real: false, notFound: true });
        } else {
          // Normalise to the same shape the screen renders from
          const firstOffering = data.offerings?.[0];
          setSvc({
            id: data.id,
            title: data.title,
            sub:   data.category,
            description: data.description,
            photoClass: data.photo_class,
            coverUrl: data.cover_url,
            location: data.location_text,
            hourly: firstOffering ? `${centsToPrice(firstOffering.price_cents)} ${firstOffering.kind === 'hourly' ? 'per hour' : 'per session'}` : '—',
            bookings: data.bookings_count || 0,
            rating:   data.rating_avg || null,
            offerings: data.offerings || [],
            status: data.status,
            real: true,
          });
        }
      });
    } else {
      // Non-UUID id — nothing real to show. Never fall back to a mock
      // listing the provider doesn't own.
      setSvc({ id, real: false, notFound: true });
      setLoading(false);
    }

    return () => { cancelled = true; };
  }, [id]);

  if (loading || !svc) {
    return (
      <div className="flex-1 flex items-center justify-center bg-cr">
        <p className="text-body text-b3">Loading service…</p>
      </div>
    );
  }

  // CERGIO-GUARD: real UUID id whose service failed to load. Don't
  // pretend it's somebody else's service — render an honest
  // not-found state.
  if (svc.notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-cr px-7">
        <p className="text-heading-2 font-extrabold text-black text-center mb-2">Service not found</p>
        <p className="text-body text-b3 text-center leading-relaxed mb-6">
          We couldn't load this service. It may have been removed,
          or you may not have permission to view it.
        </p>
        <button
          onClick={() => navigate('/services/manage')}
          className="bg-black text-white rounded-pill px-5 py-2.5 text-body font-extrabold"
        >
          Back to my services
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      {/* photo hero */}
      <div className={`relative h-[220px] overflow-hidden ${svc.coverUrl ? 'bg-bg5' : (svc.photoClass || 'fv-jamie')}`}>
        {/* Real cover photo when uploaded; else the gradient palette. */}
        {svc.coverUrl && (
          <img
            src={svc.coverUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        {/* Top gradient strip for the button row legibility. */}
        <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/35 to-transparent pointer-events-none" />
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/95 flex items-center justify-center text-black text-base"
        >
          ‹
        </button>
        {/* Hidden file input — the Edit photos button triggers click() on
            this. accept restricted to images so the OS picker filters. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleCoverPick}
        />
        <button
          onClick={() => {
            if (!svc.real) { showToast('Demo service — sign up to upload your own photo.'); return; }
            if (uploading) return;
            fileInputRef.current?.click();
          }}
          disabled={uploading}
          className="absolute top-4 right-4 bg-white/95 rounded-pill px-3 py-1.5 text-meta font-extrabold text-black
                     disabled:opacity-60 disabled:cursor-wait"
        >
          {uploading ? 'Uploading…' : (svc.coverUrl ? 'Change photo' : 'Add photo')}
        </button>
        <span className="absolute bottom-3 left-4 bg-white/95 rounded-pill px-3 py-1 text-meta-sm font-extrabold text-black">
          Cover media
        </span>
      </div>

      {/* title + status */}
      <div className="px-5 pt-5 pb-3">
        <p className="text-meta font-extrabold text-g uppercase tracking-widest mb-1">{svc.sub || 'Service'}</p>
        <h1 className="text-display-2 font-extrabold text-black leading-tight">{svc.title}</h1>
        <div className="flex items-center gap-3 mt-2">
          <span className={`inline-flex items-center gap-1.5 text-meta font-extrabold px-2.5 py-1 rounded-pill
            ${svc.status === 'draft' ? 'bg-bg5 text-b2' : 'bg-gl text-gd'}`}>
            <span className={`w-2 h-2 rounded-full ${svc.status === 'draft' ? 'bg-b3' : 'bg-g'}`} />
            {svc.status === 'draft' ? 'Draft' : 'Listed'}
          </span>
          {svc.rating != null && (
            <span className="text-body-sm text-b2 font-medium">★ {Number(svc.rating).toFixed(1)} · {svc.bookings} bookings</span>
          )}
        </div>
      </div>

      {/* stat row */}
      <div className="mx-5 grid grid-cols-3 gap-2 mb-5">
        {[
          { label: 'Bookings', value: svc.bookings ?? 0 },
          { label: 'Rating',   value: svc.rating ? `${Number(svc.rating).toFixed(1)}★` : '—' },
          { label: 'Pricing',  value: svc.hourly || '—' },
        ].map(s => (
          <div key={s.label} className="bg-soft rounded-[14px] p-3 text-center">
            <p className="text-body font-extrabold text-black">{s.value}</p>
            <p className="text-meta-sm text-b3 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <p className="px-5 text-meta-sm font-extrabold uppercase tracking-widest text-b3 mb-3">
        Service details
      </p>
      <div className="mx-5 bg-white border border-bdr rounded-[16px] mb-5 overflow-hidden">
        {[
          { label: 'Offerings & pricing',
            // Pass the service id so ServiceListMoreOfferingsScreen can load
            // this service's real offerings, not the in-memory listingDraft.
            run: () => navigate('/list-service/more-offerings', { state: { serviceId: svc.id } }),
            sub: `${svc.offerings?.length ?? 1} item${(svc.offerings?.length ?? 1) === 1 ? '' : 's'} · tap to manage` },
          { label: 'Service area',
            sub: svc.location || 'Tap to set the city / address you serve',
            run: () => editServiceField('location_text', svc.location, 'Service area (city, address, or both)') },
          { label: 'Description',
            sub: svc.description || 'Tap to add a description',
            run: () => editServiceField('description', svc.description, 'How would you describe this service?') },
          { label: 'Photos & videos',
            sub: svc.coverUrl ? 'Cover uploaded · tap to change' : 'Add a cover photo',
            run: () => { if (!svc.real) { showToast('Demo service — sign up to upload your own photo.'); return; } fileInputRef.current?.click(); } },
          { label: 'Availability defaults',to: '/calendar/availability',
            sub: 'Auto-accept bookings on weekdays' },
        ].map((row, i, arr) => (
          <button
            key={row.label}
            onClick={() => {
              if (row.to) return navigate(row.to);
              if (row.run) return row.run();
              if (row.toast) return showToast(row.toast);
            }}
            className={`w-full flex items-center justify-between px-4 py-4 text-left
                        ${i < arr.length - 1 ? 'border-b border-bdr' : ''}`}
          >
            <div className="flex-1 pr-3">
              <p className="text-body font-extrabold text-black">{row.label}</p>
              <p className="text-meta text-b3 mt-0.5">{row.sub}</p>
            </div>
            <span className="text-b3 text-lg">›</span>
          </button>
        ))}
      </div>

      <p className="px-5 text-meta-sm font-extrabold uppercase tracking-widest text-b3 mb-3">
        Visibility
      </p>
      <div className="mx-5 flex flex-col gap-2 mb-5">
        {/* Unlist / Relist — toggles services.status between listed and draft.
            CERGIO-GUARD: must hit the real API, not just toast. Mock
            services (non-UUID ids) get a polite no-op since there's
            nothing to update on the backend. */}
        <button
          onClick={async () => {
            if (!svc.real) { showToast('Demo service — sign up to publish your own.'); return; }
            const wasListed = svc.status === 'listed';
            const fn = wasListed ? unlistService : relistService;
            const { error } = await fn(svc.id);
            if (error) { showToast(`Couldn't ${wasListed ? 'unlist' : 'relist'}: ${error.message}`); return; }
            setSvc(s => ({ ...s, status: wasListed ? 'draft' : 'listed' }));
            showToast(wasListed
              ? 'Service unlisted — only you can see it now'
              : 'Service relisted — visible in search again ✓');
          }}
          className="bg-white border border-bdr rounded-[14px] py-3.5 text-body font-extrabold text-black"
        >
          {svc.status === 'listed' ? 'Unlist this service' : 'Relist this service'}
        </button>
        {deleteArmed ? (
          <div className="bg-white border border-danger/40 rounded-[14px] py-3 px-4 flex flex-col gap-2">
            <p className="text-meta text-b2 leading-snug">
              Permanently remove <span className="font-extrabold">&ldquo;{svc.title}&rdquo;</span> + all offerings + pending bookings? This can&apos;t be undone.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  if (!svc.real) { showToast('Demo service — sign up to manage your own.'); setDeleteArmed(false); return; }
                  const { error } = await deleteService(svc.id);
                  if (error) { showToast(`Couldn't delete: ${error.message}`); setDeleteArmed(false); return; }
                  showToast('Service deleted ✓');
                  navigate('/account/services');
                }}
                className="text-body-sm font-extrabold text-danger underline underline-offset-2 bg-transparent border-none p-0 cursor-pointer"
              >
                Confirm delete
              </button>
              <span className="text-b3 text-body-sm">·</span>
              <button
                onClick={() => setDeleteArmed(false)}
                className="text-body-sm font-extrabold text-b3 hover:text-b2 bg-transparent border-none p-0 cursor-pointer"
              >
                Keep service
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setDeleteArmed(true)}
            className="bg-white border border-bdr rounded-[14px] py-3.5 text-body font-extrabold text-danger"
          >
            Delete service
          </button>
        )}
      </div>
    </div>
  );
}
