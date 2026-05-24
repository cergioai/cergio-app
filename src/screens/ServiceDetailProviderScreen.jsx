// Per design-spec.md — Provider's view of a service they offer.
// Pulls real data from Supabase when the id is a UUID; falls back to mock
// for non-UUID ids (e.g. `svc-u1`, `svc-l1` from MANAGED_SERVICES mock).
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { MANAGED_SERVICES } from '../data/mock';
import { getService } from '../lib/api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findMockService(id) {
  return [...MANAGED_SERVICES.unpublished, ...MANAGED_SERVICES.listed].find(s => s.id === id);
}

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

  useEffect(() => {
    let cancelled = false;

    if (UUID_RE.test(id)) {
      getService(id).then(({ data, error }) => {
        if (cancelled) return;
        setLoading(false);
        if (error || !data) {
          setSvc(findMockService(id) || MANAGED_SERVICES.listed[0]);
        } else {
          // Normalise to the same shape the screen renders from
          const firstOffering = data.offerings?.[0];
          setSvc({
            id: data.id,
            title: data.title,
            sub:   data.category,
            description: data.description,
            photoClass: data.photo_class,
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
      setSvc(findMockService(id) || MANAGED_SERVICES.listed[0]);
      setLoading(false);
    }

    return () => { cancelled = true; };
  }, [id]);

  if (loading || !svc) {
    return (
      <div className="flex-1 flex items-center justify-center bg-cr">
        <p className="text-[14px] text-b3">Loading service…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      {/* photo hero */}
      <div className={`relative h-[220px] ${svc.photoClass || 'fv-jamie'}`}>
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/95 flex items-center justify-center text-black text-base"
        >
          ‹
        </button>
        <button
          onClick={() => showToast('Edit photos — coming soon')}
          className="absolute top-4 right-4 bg-white/95 rounded-pill px-3 py-1.5 text-[12px] font-extrabold text-black"
        >
          Edit photos
        </button>
        <span className="absolute bottom-3 left-4 bg-white/95 rounded-pill px-3 py-1 text-[11px] font-extrabold text-black">
          Cover media
        </span>
      </div>

      {/* title + status */}
      <div className="px-5 pt-5 pb-3">
        <p className="text-[12px] font-extrabold text-g uppercase tracking-widest mb-1">{svc.sub || 'Service'}</p>
        <h1 className="text-[24px] font-extrabold text-black leading-tight">{svc.title}</h1>
        <div className="flex items-center gap-3 mt-2">
          <span className={`inline-flex items-center gap-1.5 text-[12px] font-extrabold px-2.5 py-1 rounded-pill
            ${svc.status === 'draft' ? 'bg-bg5 text-b2' : 'bg-gl text-gd'}`}>
            <span className={`w-2 h-2 rounded-full ${svc.status === 'draft' ? 'bg-b3' : 'bg-g'}`} />
            {svc.status === 'draft' ? 'Draft' : 'Listed'}
          </span>
          {svc.rating != null && (
            <span className="text-[13px] text-b2 font-medium">★ {Number(svc.rating).toFixed(1)} · {svc.bookings} bookings</span>
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
            <p className="text-[14px] font-extrabold text-black">{s.value}</p>
            <p className="text-[11px] text-b3 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <p className="px-5 text-[11px] font-extrabold uppercase tracking-widest text-b3 mb-3">
        Service details
      </p>
      <div className="mx-5 bg-white border border-bdr rounded-[16px] mb-5 overflow-hidden">
        {[
          { label: 'Offerings & pricing',  to: '/list-service/more-offerings',
            sub: `${svc.offerings?.length ?? 1} item${(svc.offerings?.length ?? 1) === 1 ? '' : 's'} · tap to manage` },
          { label: 'Service area',         toast: 'Service area — coming soon',
            sub: svc.location || 'Not set' },
          { label: 'Description',          toast: 'Description — coming soon',
            sub: svc.description || 'No description yet' },
          { label: 'Photos & videos',      toast: 'Photos — coming soon',
            sub: 'Edit your cover & gallery' },
          { label: 'Availability defaults',to: '/calendar/availability',
            sub: 'Auto-accept bookings on weekdays' },
        ].map((row, i, arr) => (
          <button
            key={row.label}
            onClick={() => row.to ? navigate(row.to) : showToast(row.toast)}
            className={`w-full flex items-center justify-between px-4 py-4 text-left
                        ${i < arr.length - 1 ? 'border-b border-bdr' : ''}`}
          >
            <div className="flex-1 pr-3">
              <p className="text-[14px] font-extrabold text-black">{row.label}</p>
              <p className="text-[12px] text-b3 mt-0.5">{row.sub}</p>
            </div>
            <span className="text-b3 text-lg">›</span>
          </button>
        ))}
      </div>

      <p className="px-5 text-[11px] font-extrabold uppercase tracking-widest text-b3 mb-3">
        Visibility
      </p>
      <div className="mx-5 flex flex-col gap-2 mb-5">
        <button
          onClick={() => showToast('Service unlisted — only you can see it now')}
          className="bg-white border border-bdr rounded-[14px] py-3.5 text-[14px] font-extrabold text-black"
        >
          Unlist this service
        </button>
        <button
          onClick={() => showToast('Delete service — coming soon')}
          className="bg-white border border-bdr rounded-[14px] py-3.5 text-[14px] font-extrabold text-danger"
        >
          Delete service
        </button>
      </div>
    </div>
  );
}
