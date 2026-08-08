// SPEC-279 / FW-25 — THE OPEN BOARD (founder, 2026-08-08).
//
// "Publish OPEN requests (both from users and from creators on the site.. for
//  everyone to browse)... add ability to filter by type data ... uses will see
//  posts that are around their location ..combine both feeds (optins from
//  services and creators .. and specific jobs open requests...services can
//  accept specific jobs .. by clicking accept.. (but the booking isn't confirmed
//  until the user actually books ...for optin acceptance requests without a
//  specific request posted, show 'flexible' click to suggest a service"
//
// ONE feed, two card kinds:
//   job    → "need a driver Tuesday". Primary action ACCEPT — which writes an
//            OFFER, never a booking. The requester books; that is what confirms.
//   optin  → FLEXIBLE. Nothing specific was asked for, so the only sensible
//            action is to propose something: "Suggest a service".
//
// Nothing on this screen fabricates a match. Distance shows only when BOTH the
// viewer and the post have coordinates; everything else reads "Anywhere".
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import {
  listOpenBoard, listOwnerServices, listMyServices,
  acceptOpenJob, suggestServiceOnOptIn,
} from '../lib/api';

const RADII = [
  { label: '10 mi',    value: 10 },
  { label: '25 mi',    value: 25 },
  { label: '50 mi',    value: 50 },
  { label: 'Anywhere', value: null },
];
const KINDS = [
  { label: 'All',      value: 'all' },
  { label: 'Jobs',     value: 'job' },
  { label: 'Flexible', value: 'optin' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  if (ms < 60000) return 'now';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.round(d / 7)}w`;
}
function distanceLabel(mi) {
  if (mi === null || mi === undefined) return 'Anywhere';
  if (mi < 1) return 'Under 1 mi';
  return `${Math.round(mi)} mi away`;
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 rounded-pill px-3 py-1.5 text-meta font-extrabold border transition-colors ${
        active ? 'bg-g text-white border-g' : 'bg-white text-b2 border-line hover:border-g'
      }`}
    >
      {children}
    </button>
  );
}

export function OpenBoardScreen() {
  const navigate = useNavigate();
  const { showToast, auth, defaultAddress } = useOutletContext();

  const [rows, setRows]     = useState(null); // null = loading
  const [types, setTypes]   = useState([]);
  const [kind, setKind]     = useState('all');
  const [type, setType]     = useState(null);
  const [radius, setRadius] = useState(25);
  const [q, setQ]           = useState('');
  const [busy, setBusy]     = useState({});
  const [myServices, setMyServices] = useState([]);
  const [suggestFor, setSuggestFor] = useState(null);

  const near = useMemo(() => (
    defaultAddress?.lat != null && defaultAddress?.lng != null
      ? { lat: defaultAddress.lat, lng: defaultAddress.lng }
      : null
  ), [defaultAddress?.lat, defaultAddress?.lng]);

  const load = useCallback(async () => {
    const { data, types: t } = await listOpenBoard({
      kind,
      type,
      q,
      near,
      // A radius with no known viewer location would silently empty the board.
      radiusMiles: near ? radius : null,
    });
    setRows(data || []);
    if (t) setTypes(t);
  }, [kind, type, q, near, radius]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!auth?.isSignedIn) { setMyServices([]); return; }
    listMyServices().then(({ data }) => {
      setMyServices((data || []).filter(s => s.status === 'listed'));
    });
  }, [auth?.isSignedIn]);

  const onAccept = async (row) => {
    if (!auth?.isSignedIn) { navigate('/auth?returnTo=/board'); return; }
    if (myServices.length === 0) {
      showToast('List a service first — then you can accept jobs here.', { sticky: true });
      navigate('/list-service');
      return;
    }
    setBusy(b => ({ ...b, [row.id]: true }));
    // One listed service → accept with it. More than one → the accept carries
    // the service whose category matches the request, else the first listed.
    const match = myServices.find(s =>
      [s.taxonomy_provider_type, s.category].filter(Boolean)
        .some(v => [row.service_type, row.category, row.what].filter(Boolean)
          .some(w => String(w).toLowerCase() === String(v).toLowerCase()))) || myServices[0];
    const { error } = await acceptOpenJob({ requestId: row.id, serviceId: match.id });
    setBusy(b => ({ ...b, [row.id]: false }));
    if (error) { showToast(error.message || 'Could not accept.'); return; }
    // The wording is the guarantee: accepting does NOT book anything.
    showToast(`Accepted with ${match.title || 'your service'} — they'll book to confirm the time.`);
    load();
  };

  const signedOut = auth && !auth.loading && !auth.isSignedIn;

  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      <div className="px-5 pt-5">
        <h1 className="text-heading-1 font-extrabold text-black">Open board</h1>
        <p className="text-body-sm text-b3 mt-1 leading-snug">
          Everything open right now — jobs people posted, and creators and
          providers who are up for a barter.
        </p>
        {!near && (
          <p className="text-meta text-b3 mt-2">
            Add your address in Profile to sort by what&rsquo;s closest.
          </p>
        )}
      </div>

      {/* post-your-own */}
      <div className="px-5 mt-4">
        <button
          type="button"
          onClick={() => navigate('/join')}
          className="w-full bg-g text-white rounded-[18px] py-3 text-body-sm font-extrabold cg-cta active:scale-[.98] transition-all"
        >
          Post a request or opt in →
        </button>
      </div>

      {/* filters */}
      <div className="px-5 mt-4 flex flex-col gap-2">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search the board…"
          className="w-full border border-line rounded-[14px] px-3 py-2.5 text-body-sm text-black bg-white outline-none focus:border-g"
        />
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {KINDS.map(k => (
            <Chip key={k.value} active={kind === k.value} onClick={() => setKind(k.value)}>{k.label}</Chip>
          ))}
          <span className="w-px bg-line flex-shrink-0 my-1" />
          {RADII.map(r => (
            <Chip key={String(r.value)} active={radius === r.value} onClick={() => setRadius(r.value)}>{r.label}</Chip>
          ))}
        </div>
        {types.length > 0 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
            <Chip active={!type} onClick={() => setType(null)}>All types</Chip>
            {types.map(t => (
              <Chip key={t} active={type === t} onClick={() => setType(type === t ? null : t)}>{t}</Chip>
            ))}
          </div>
        )}
      </div>

      {/* feed */}
      <div className="px-5 mt-4 flex flex-col gap-3">
        {rows === null && <p className="text-body-sm text-b3">Loading the board…</p>}

        {rows !== null && rows.length === 0 && (
          <div className="bg-white border border-line rounded-[18px] p-5 text-center">
            <p className="text-body font-extrabold text-black">Nothing open here yet.</p>
            <p className="text-body-sm text-b3 mt-1 leading-snug">
              {radius && near
                ? 'Try a wider radius, or be the first to post.'
                : 'Be the first to post what you need.'}
            </p>
          </div>
        )}

        {(rows || []).map(row => {
          const name  = row.requester?.display_name || 'Cergio user';
          const isOpt = row.kind === 'optin';
          const title = isOpt
            ? `${name} is open to barter`
            : (row.what || row.service_type || row.category || 'Open request');
          const roleLine = row.poster_role === 'creator'
            ? 'Creator · will post an IG spotlight'
            : row.poster_role === 'service'
              ? 'Service provider · offering a free service'
              : null;
          return (
            <div key={row.id} className="bg-white border border-line rounded-[18px] p-4">
              <div className="flex items-start gap-3">
                <Avatar url={row.requester?.avatar_url} name={name} size={44} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-body font-extrabold text-black leading-snug">{title}</p>
                    {isOpt ? (
                      <span className="flex-shrink-0 bg-gl text-gd text-meta-sm font-extrabold px-2 py-0.5 rounded-pill leading-none">
                        FLEXIBLE
                      </span>
                    ) : row.is_free_for_rainmaker ? (
                      <span className="flex-shrink-0 bg-gl text-gd text-meta-sm font-extrabold px-2 py-0.5 rounded-pill leading-none">
                        FREE
                      </span>
                    ) : null}
                  </div>
                  {!isOpt && (
                    <p className="text-meta text-b2 font-medium leading-snug mt-0.5">{name}</p>
                  )}
                  {isOpt && roleLine && (
                    <p className="text-meta text-g font-extrabold leading-snug mt-0.5">{roleLine}</p>
                  )}
                  {row.description && (
                    <p className="text-body-sm text-black leading-snug mt-1 line-clamp-3">{row.description}</p>
                  )}
                  <p className="text-meta-sm text-b3 font-medium mt-1">
                    {[
                      distanceLabel(row.distanceMiles),
                      row.location_text,
                      row.when_text,
                      timeAgo(row.created_at),
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3">
                {isOpt ? (
                  <button
                    type="button"
                    onClick={() => (auth?.isSignedIn ? setSuggestFor(row) : navigate('/auth?returnTo=/board'))}
                    className="flex-1 bg-g text-white rounded-[12px] py-2 text-meta font-extrabold cg-cta active:scale-[.98] transition-all"
                  >
                    Suggest a service
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!!busy[row.id]}
                      onClick={() => onAccept(row)}
                      className="flex-1 bg-g text-white rounded-[12px] py-2 text-meta font-extrabold cg-cta active:scale-[.98] transition-all disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/inbound/${row.id}`)}
                      className="rounded-[12px] border border-line px-4 py-2 text-meta font-extrabold text-b2"
                    >
                      View
                    </button>
                  </>
                )}
              </div>
              {!isOpt && (
                <p className="text-meta-sm text-b3 mt-2 leading-snug">
                  Accepting sends them your offer — they confirm by booking.
                </p>
              )}
            </div>
          );
        })}

        {signedOut && (
          <p className="text-meta text-b3 text-center mt-2">
            <button onClick={() => navigate('/auth?returnTo=/board')} className="text-g font-extrabold">Sign in</button>
            {' '}to accept jobs or suggest a service.
          </p>
        )}
      </div>

      {suggestFor && (
        <SuggestSheet
          post={suggestFor}
          myServices={myServices}
          defaultAddress={defaultAddress}
          onClose={() => setSuggestFor(null)}
          onDone={(msg) => { setSuggestFor(null); showToast(msg); load(); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

/**
 * The two-direction suggest sheet.
 *
 * If the poster has LISTED SERVICES, what you can suggest is one of THEIRS —
 * you're asking them for it ("a creator can suggest a service to a service
 * provider"). If they have none (a creator), you suggest one of YOURS — you're
 * offering it ("a service provider can suggest a service to a creator"). The
 * copy states which one is happening, because the two produce different rows.
 */
function SuggestSheet({ post, myServices, defaultAddress, onClose, onDone, showToast }) {
  const [theirs, setTheirs] = useState(null); // null = loading
  const [pickId, setPickId] = useState(null);
  const [note, setNote]     = useState('');
  const [busy, setBusy]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    listOwnerServices(post.requester?.id).then(({ data }) => {
      if (!cancelled) setTheirs(data || []);
    });
    return () => { cancelled = true; };
  }, [post.requester?.id]);

  const asking  = (theirs || []).length > 0;
  const options = asking ? theirs : myServices;
  const posterName = post.requester?.display_name || 'them';

  const send = async () => {
    const service = (options || []).find(s => s.id === pickId);
    if (!service) { showToast('Pick a service first.'); return; }
    setBusy(true);
    const { error, direction } = await suggestServiceOnOptIn({
      optInId:   post.id,
      posterId:  post.requester?.id,
      service,
      message:   note,
      whereText: defaultAddress?.formatted_address || '',
      lat: defaultAddress?.lat ?? null,
      lng: defaultAddress?.lng ?? null,
    });
    setBusy(false);
    if (error) { showToast(error.message || 'Could not send that suggestion.'); return; }
    onDone(direction === 'asked'
      ? `Sent — ${posterName} will accept, then you book the time.`
      : `Offered — ${posterName} books the time to confirm it.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-[390px] bg-cr rounded-t-[24px] px-5 pt-4 pb-6 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-9 h-1 bg-bdr rounded-full mx-auto mb-4" />
        <h2 className="text-heading-2 font-extrabold text-black">Suggest a service</h2>

        {theirs === null && <p className="text-body-sm text-b3 mt-3">Loading…</p>}

        {theirs !== null && (options || []).length === 0 && (
          <p className="text-body-sm text-b3 mt-3 leading-snug">
            {asking
              ? `${posterName} hasn't listed a service yet.`
              : 'List a service first — then you can offer it here.'}
          </p>
        )}

        {theirs !== null && (options || []).length > 0 && (
          <>
            <p className="text-body-sm text-b3 mt-1 leading-snug">
              {asking
                ? `Ask ${posterName} for one of their services. They accept, then you book the time.`
                : `Offer ${posterName} one of your services. They book the time to confirm it.`}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {options.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPickId(s.id)}
                  className={`w-full text-left rounded-[14px] px-3 py-2.5 border transition-colors ${
                    pickId === s.id ? 'border-g bg-gl' : 'border-line bg-white'
                  }`}
                >
                  <p className="text-body-sm font-extrabold text-black leading-snug">
                    {s.headline || s.title}
                  </p>
                  {(s.category || s.taxonomy_provider_type) && (
                    <p className="text-meta-sm text-b3 font-medium mt-0.5">
                      {s.taxonomy_provider_type || s.category}
                    </p>
                  )}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Add a note (optional)"
              className="w-full mt-3 border border-line rounded-[14px] px-3 py-2.5 text-body-sm text-black bg-white outline-none focus:border-g resize-none"
            />
            <button
              type="button"
              disabled={busy || !pickId}
              onClick={send}
              className="w-full mt-3 bg-g text-white rounded-[24px] py-3.5 text-body-lg font-extrabold disabled:opacity-60"
            >
              {asking ? 'Send request' : 'Send offer'}
            </button>
          </>
        )}
        <button type="button" onClick={onClose} className="w-full mt-2 py-3 text-body-sm text-b3 font-extrabold">
          Cancel
        </button>
      </div>
    </div>
  );
}
