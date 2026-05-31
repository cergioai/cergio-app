// CERGIO-GUARD (2026-05-30): Public profile view for any Cergio user.
//
// Route: /u/:profileId
//
// Wired from every avatar in the app — PDP recommender stack/lead, the
// Activity-feed GoatShareCard (owner + recommender pill avatars), the
// ResultsScreen ProviderCard friend stack. The view is modeled on
// Tarik's 7 attached mockups (Jennifer Leighton + Jacob Flores empty
// state) and is read-only — owners edit via /profile.
//
// Sections (all from real DB rows; empty sections collapse silently —
// never fake-data, per feedback_no_fake_feeds):
//   • Header — close button, large avatar, big name, role badge,
//     Connector badge when cc_verified_at NOT NULL
//   • About — bio prose (with "No bio yet" empty state)
//   • Social — IG handle + follower count, falls back to plain "Instagram"
//     when not connected
//   • {Name}'s Services — services they own (top 1–N, opens PDP on tap)
//   • People who love {Name} — review rows from bookings on those services
//   • {Name}'s Go-Tos — services this profile has recommended (recommendations
//     authored by them, joined to services + service owners)
//
// Every nested avatar that points at another user is itself a Link
// to /u/{their-id}, so the graph is fully navigable.

import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';

function initialsOf(name) {
  if (!name) return '?';
  return name.split(' ').map(s => s[0] || '').slice(0, 2).join('').toUpperCase();
}

// Brand-friendly gradient pool — same set as ServiceDetailScreen so the
// avatar colors stay consistent across the app.
const AV_GRADS = [
  'bg-gradient-to-br from-[#8A6FD6] to-[#4F3DB0]',
  'bg-gradient-to-br from-[#F5A65E] to-[#C76A18]',
  'bg-gradient-to-br from-[#EE5586] to-[#A52454]',
  'bg-gradient-to-br from-[#5BC404] to-[#2F6E00]',
  'bg-gradient-to-br from-[#4478AA] to-[#2A5070]',
];
const PHOTO_GRADIENTS = {
  'fv-jamie': 'from-[#e8dcc8] via-[#b89870] to-[#604030]',
  'fv-john':  'from-[#cad8e8] via-[#7088b0] to-[#2e4060]',
  'fv-steve': 'from-[#d8e8ca] via-[#88b070] to-[#406030]',
};

function gradFor(id, fallback = 0) {
  if (!id) return AV_GRADS[fallback];
  // Stable hash → consistent color per profile id.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AV_GRADS[Math.abs(h) % AV_GRADS.length];
}

// Small circular avatar that's also a link to that user's public profile.
// `clickable` defaults to true; pass false to render a non-link circle
// (e.g. when the avatar belongs to the page's own subject and tapping
// would be a no-op).
function AvatarLink({ id, name, size = 40, className = '', clickable = true }) {
  const cls = `${gradFor(id)} rounded-full text-white font-extrabold
               flex items-center justify-center flex-shrink-0 ${className}`;
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.32)) };
  const body  = initialsOf(name);
  if (!clickable || !id) {
    return <span className={cls} style={style}>{body}</span>;
  }
  return (
    <Link to={`/u/${id}`} className={cls} style={style} aria-label={`View ${name || 'profile'}`}>
      {body}
    </Link>
  );
}

function ConnectorBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-gd font-extrabold">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.2" aria-hidden="true">
        <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
      </svg>
      Connector
    </span>
  );
}

function RoleBadge({ label }) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-gd font-extrabold">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#3FA821" aria-hidden="true">
        <path d="M12 2l2.4 2.6 3.5-.5.6 3.5 3 1.8-1.6 3.2 1.6 3.2-3 1.8-.6 3.5-3.5-.5L12 22l-2.4-2.6-3.5.5-.6-3.5-3-1.8L4.1 11l-1.6-3.2 3-1.8.6-3.5 3.5.5L12 2z"/>
        <path d="M9.5 12.2l1.7 1.7 3.4-3.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
      {label}
    </span>
  );
}

function fmtMonthYear(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch { return ''; }
}

// One service-card row (used in the "Their Services" + "Their Go-Tos"
// sections). Cover image or photo-class gradient fallback. Tap → PDP.
function ServiceTile({ svc, recoSummary, onOpen }) {
  const grad = PHOTO_GRADIENTS[svc.photo_class] || PHOTO_GRADIENTS['fv-jamie'];
  const price = svc.price_cents != null ? Math.round(svc.price_cents / 100) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left bg-white border border-bdr rounded-[16px] overflow-hidden hover:border-g/40 transition-colors"
    >
      <div className={`relative h-[160px] bg-gradient-to-br ${grad}`}>
        {svc.cover_url && (
          <img
            src={svc.cover_url}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                         w-10 h-10 rounded-full bg-white/85 flex items-center justify-center text-base pl-0.5">
          ▶
        </span>
      </div>
      <div className="p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[16px] font-extrabold text-black truncate">{svc.title || 'Service'}</p>
          {price != null && (
            <p className="text-[16px] font-extrabold text-black">
              {price === 0 ? 'Free' : `$${price}`}
            </p>
          )}
        </div>
        {svc.category && (
          <p className="inline-flex items-center gap-1 text-[12.5px] text-gd font-extrabold mt-0.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#3FA821" aria-hidden="true">
              <path d="M12 2l2.4 2.6 3.5-.5.6 3.5 3 1.8-1.6 3.2 1.6 3.2-3 1.8-.6 3.5-3.5-.5L12 22l-2.4-2.6-3.5.5-.6-3.5-3-1.8L4.1 11l-1.6-3.2 3-1.8.6-3.5 3.5.5L12 2z"/>
              <path d="M9.5 12.2l1.7 1.7 3.4-3.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            {svc.taxonomy_provider_type || svc.category}
          </p>
        )}
        {svc.description && (
          <p className="text-[12.5px] text-b3 leading-snug mt-1.5 line-clamp-2">{svc.description}</p>
        )}
        {recoSummary && recoSummary.total > 0 && (
          <div className="mt-2.5 inline-flex items-center gap-1.5 bg-gl rounded-pill px-3 py-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.4" aria-hidden="true">
              <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
            </svg>
            <p className="text-[11.5px] text-gd font-extrabold leading-none">
              Reco&apos;d by {recoSummary.friends || 0} {(recoSummary.friends === 1) ? 'friend' : 'friends'}
              {recoSummary.connectors > 0 && (
                <> and {recoSummary.connectors} {recoSummary.connectors === 1 ? 'Connector' : 'Connectors'}</>
              )}
            </p>
          </div>
        )}
      </div>
    </button>
  );
}

export function PublicProfileScreen() {
  const navigate = useNavigate();
  const { profileId } = useParams();

  const [profile, setProfile] = useState(null);
  const [services, setServices] = useState([]);
  // svcId → { total, friends, connectors }
  const [svcRecoSummary, setSvcRecoSummary] = useState({});
  // Reviews on services this profile owns: { id, stars, comment, reviewer:{id,name}, booked_at }
  const [reviews, setReviews] = useState([]);
  // Recommendations this profile has authored, joined to services + owners.
  const [recoServices, setRecoServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!supabaseReady || !profileId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);

      // Profile + Connector flag + IG/TikTok handles.
      const { data: prof } = await supabase
        .from('profiles')
        .select('id, display_name, bio, avatar_url, cc_verified_at, instagram_handle, instagram_followers, tiktok_handle, tiktok_followers, follower_count')
        .eq('id', profileId)
        .maybeSingle();
      if (cancelled) return;
      if (!prof) { setNotFound(true); setLoading(false); return; }
      setProfile(prof);

      // Services they own (for the "Their Services" + "People who love"
      // and to derive role).
      const { data: svcs } = await supabase
        .from('services')
        .select(`
          id, title, category, description, location_text, photo_class, cover_url,
          taxonomy_provider_type, owner_id, status,
          offerings ( id, name, price_cents, is_default )
        `)
        .eq('owner_id', profileId)
        .eq('status', 'listed')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      const svcRows = (svcs || []).map(s => {
        const def = (s.offerings || []).find(o => o.is_default) || s.offerings?.[0];
        return { ...s, price_cents: def?.price_cents ?? null };
      });
      setServices(svcRows);

      // For each service: count reco buckets (friends vs Connectors).
      if (svcRows.length) {
        const svcIds = svcRows.map(s => s.id);
        const { data: ownerRecs } = await supabase
          .from('recommendations')
          .select('id, service_id, recommender_id')
          .in('service_id', svcIds);
        const recRows = ownerRecs || [];
        const recIds = [...new Set(recRows.map(r => r.recommender_id).filter(Boolean))];
        const { data: recProfs } = recIds.length
          ? await supabase.from('profiles').select('id, cc_verified_at').in('id', recIds)
          : { data: [] };
        const profMap = Object.fromEntries((recProfs || []).map(p => [p.id, p]));
        const summary = {};
        for (const r of recRows) {
          const k = r.service_id;
          if (!summary[k]) summary[k] = { total: 0, friends: 0, connectors: 0 };
          summary[k].total += 1;
          if (profMap[r.recommender_id]?.cc_verified_at) summary[k].connectors += 1;
          else summary[k].friends += 1;
        }
        if (!cancelled) setSvcRecoSummary(summary);

        // Reviews for those services — bookings → reviews join.
        // Schema: reviews(id, booking_id, stars, comment, created_at);
        // bookings(id, service_id, consumer_id). We only need recent rows.
        const { data: bkgs } = await supabase
          .from('bookings')
          .select('id, service_id, consumer_id, created_at')
          .in('service_id', svcIds);
        const bkgMap = Object.fromEntries((bkgs || []).map(b => [b.id, b]));
        const bkgIds = (bkgs || []).map(b => b.id);
        const { data: revs } = bkgIds.length
          ? await supabase
              .from('reviews')
              .select('id, booking_id, stars, comment, created_at')
              .in('booking_id', bkgIds)
              .order('created_at', { ascending: false })
              .limit(8)
          : { data: [] };
        const consumerIds = [...new Set((revs || [])
          .map(r => bkgMap[r.booking_id]?.consumer_id)
          .filter(Boolean))];
        const { data: revProfs } = consumerIds.length
          ? await supabase.from('profiles').select('id, display_name').in('id', consumerIds)
          : { data: [] };
        const revProfMap = Object.fromEntries((revProfs || []).map(p => [p.id, p]));
        const shaped = (revs || []).map(r => {
          const bk = bkgMap[r.booking_id];
          const reviewer = bk ? revProfMap[bk.consumer_id] : null;
          return {
            id: r.id,
            stars: r.stars,
            comment: r.comment || '',
            booked_at: bk?.created_at || r.created_at,
            reviewer: reviewer ? { id: reviewer.id, name: reviewer.display_name } : null,
          };
        }).filter(r => r.comment); // only show rows with a comment
        if (!cancelled) setReviews(shaped);
      } else {
        setReviews([]);
        setSvcRecoSummary({});
      }

      // Their Go-Tos — services this profile has recommended.
      const { data: myRecs } = await supabase
        .from('recommendations')
        .select('id, service_id, message, sent_at')
        .eq('recommender_id', profileId)
        .order('sent_at', { ascending: false })
        .limit(20);
      const myRecRows = myRecs || [];
      const recoSvcIds = [...new Set(myRecRows.map(r => r.service_id).filter(Boolean))];
      const { data: recoSvcs } = recoSvcIds.length
        ? await supabase
            .from('services')
            .select(`
              id, title, category, description, location_text, photo_class, cover_url,
              taxonomy_provider_type, owner_id,
              offerings ( id, name, price_cents, is_default )
            `)
            .in('id', recoSvcIds)
        : { data: [] };
      const recoSvcMap = Object.fromEntries((recoSvcs || []).map(s => [s.id, s]));

      // Owner profiles for the recommended services (so the tile sub-line
      // can say "by {OwnerName}, {role}") and so we can show their avatar
      // as a clickable link.
      const ownerIds = [...new Set((recoSvcs || []).map(s => s.owner_id).filter(Boolean))];
      const { data: ownerProfs } = ownerIds.length
        ? await supabase.from('profiles').select('id, display_name, cc_verified_at').in('id', ownerIds)
        : { data: [] };
      const ownerProfMap = Object.fromEntries((ownerProfs || []).map(p => [p.id, p]));

      const shapedRecos = myRecRows
        .map(r => {
          const s = recoSvcMap[r.service_id];
          if (!s) return null;
          const def = (s.offerings || []).find(o => o.is_default) || s.offerings?.[0];
          const owner = ownerProfMap[s.owner_id];
          return {
            id: r.id,
            sent_at: r.sent_at,
            message: r.message || '',
            service: {
              id: s.id,
              title: s.title,
              category: s.category,
              taxonomy_provider_type: s.taxonomy_provider_type,
              description: s.description,
              location_text: s.location_text,
              photo_class: s.photo_class,
              cover_url: s.cover_url,
              price_cents: def?.price_cents ?? null,
              owner_id: s.owner_id,
            },
            owner: owner ? { id: owner.id, name: owner.display_name, is_connector: !!owner.cc_verified_at } : null,
          };
        })
        .filter(Boolean);
      if (!cancelled) setRecoServices(shapedRecos);

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  // Role for the badge row — pulled from the first listed service's
  // taxonomy_provider_type (e.g. "Housekeeper"). Falls back to null
  // when the profile has no services (purely a Connector who shares
  // others' services — no role badge needed).
  const role = useMemo(() => {
    return services?.[0]?.taxonomy_provider_type || services?.[0]?.category || null;
  }, [services]);

  const igHandle = profile?.instagram_handle || null;
  const igFollowers = profile?.instagram_followers || profile?.follower_count || 0;

  if (loading) {
    return (
      <div className="flex-1 flex flex-col bg-cream items-center justify-center pb-24">
        <p className="text-[14px] text-b3 font-medium">Loading profile…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col bg-cream items-center justify-center pb-24 px-6">
        <p className="text-[16px] font-extrabold text-black mb-1">Profile not found</p>
        <p className="text-[13px] text-b3 font-medium text-center">
          This user may no longer be on Cergio.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 bg-g text-white rounded-pill px-5 py-2.5 text-[13px] font-extrabold"
        >
          Go back
        </button>
      </div>
    );
  }

  const name = profile?.display_name || 'Cergio user';
  const firstName = name.split(' ')[0];
  const isConnector = !!profile?.cc_verified_at;

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-24">
      {/* Top bar — close button (back) */}
      <div className="px-5 pt-7">
        <button
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="w-9 h-9 rounded-full bg-white border border-bdr text-black text-[16px] flex items-center justify-center shadow-sm"
        >
          ×
        </button>
      </div>

      {/* Header — avatar + big name + role/Connector badge row */}
      <div className="px-5 pt-4">
        <div className="flex items-center gap-3">
          <AvatarLink id={profile?.id} name={name} size={64} clickable={false} className="ring-2 ring-white shadow-sm" />
          <h1 className="text-[26px] font-extrabold text-black leading-[1.05]">{name}</h1>
        </div>
        {(role || isConnector) && (
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <RoleBadge label={role} />
            {isConnector && <ConnectorBadge />}
          </div>
        )}
      </div>

      {/* About */}
      <div className="px-5 mt-6">
        <h2 className="text-[20px] font-extrabold text-black">About</h2>
        {profile?.bio ? (
          <p className="text-[13.5px] text-b2 leading-relaxed mt-2">{profile.bio}</p>
        ) : (
          <p className="text-[13.5px] text-b3 leading-relaxed mt-2">No bio yet!</p>
        )}
      </div>

      {/* Social */}
      <div className="px-5 mt-6">
        <h2 className="text-[20px] font-extrabold text-black">Social</h2>
        <div className="flex items-center justify-between gap-3 mt-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md border-2 border-gd">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5"/>
                <circle cx="12" cy="12" r="4"/>
                <circle cx="17.5" cy="6.5" r="1.2" fill="#3D8B00" stroke="none"/>
              </svg>
            </span>
            {igHandle ? (
              <span className="text-[14px] font-extrabold text-black truncate">{igHandle}</span>
            ) : (
              <span className="text-[14px] font-medium text-b3">Instagram</span>
            )}
          </div>
          {igHandle && igFollowers > 0 && (
            <span className="text-[13px] font-extrabold text-black whitespace-nowrap">
              {Number(igFollowers).toLocaleString()} followers
            </span>
          )}
        </div>
      </div>

      {/* Their Services */}
      {services.length > 0 && (
        <div className="px-5 mt-7">
          <h2 className="text-[20px] font-extrabold text-black">{firstName}&apos;s Services</h2>
          <div className="mt-3 flex flex-col gap-4">
            {services.slice(0, 4).map(svc => (
              <ServiceTile
                key={svc.id}
                svc={svc}
                recoSummary={svcRecoSummary[svc.id]}
                onOpen={() => navigate(`/service/${svc.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* People who love {firstName} — review rows from bookings */}
      {reviews.length > 0 && (
        <div className="px-5 mt-7">
          <h2 className="text-[20px] font-extrabold text-black">People who love {firstName}</h2>
          <p className="text-[12.5px] text-b3 font-medium mt-0.5">See top reviews of their service</p>
          <div className="mt-3 flex flex-col gap-3">
            {reviews.slice(0, 5).map(r => (
              <div key={r.id} className="bg-white border border-bdr rounded-[14px] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AvatarLink
                      id={r.reviewer?.id}
                      name={r.reviewer?.name}
                      size={36}
                      clickable={!!r.reviewer?.id}
                    />
                    <p className="text-[14px] font-extrabold text-black truncate">
                      {r.reviewer?.name || 'A customer'}
                    </p>
                  </div>
                  <p className="text-[11.5px] text-b3 font-medium whitespace-nowrap">
                    {fmtMonthYear(r.booked_at)
                      ? `Booked ${fmtMonthYear(r.booked_at)}`
                      : ''}
                  </p>
                </div>
                {r.comment && (
                  <div className="mt-2 bg-bg5 rounded-[12px] p-3">
                    <p className="text-[12.5px] text-b2 leading-snug">{r.comment}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* {firstName}'s Go-Tos — services they've recommended */}
      {recoServices.length > 0 && (
        <div className="px-5 mt-7">
          <h2 className="text-[20px] font-extrabold text-black">{firstName}&apos;s Go-Tos</h2>
          <p className="text-[12.5px] text-b3 font-medium mt-0.5">See their top rated service providers!</p>
          <div className="mt-3 flex flex-col gap-3">
            {recoServices.slice(0, 8).map(r => (
              <div key={r.id} className="bg-white border border-bdr rounded-[14px] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AvatarLink id={r.owner?.id} name={r.owner?.name} size={40} />
                    <div className="min-w-0">
                      <p className="text-[14px] font-extrabold text-black truncate">
                        {r.owner?.name || r.service?.title || 'A provider'}
                      </p>
                      <p className="inline-flex items-center gap-1 text-[12px] text-gd font-extrabold mt-0.5">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="#3FA821" aria-hidden="true">
                          <path d="M12 2l2.4 2.6 3.5-.5.6 3.5 3 1.8-1.6 3.2 1.6 3.2-3 1.8-.6 3.5-3.5-.5L12 22l-2.4-2.6-3.5.5-.6-3.5-3-1.8L4.1 11l-1.6-3.2 3-1.8.6-3.5 3.5.5L12 2z"/>
                          <path d="M9.5 12.2l1.7 1.7 3.4-3.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                        </svg>
                        {r.service?.taxonomy_provider_type || r.service?.category || 'Service'}
                      </p>
                      <p className="inline-flex items-center gap-1 text-[12px] text-gd font-extrabold mt-0.5">
                        <AvatarLink id={profile?.id} name={name} size={16} clickable={false} className="border border-white" />
                        Reco&apos;d by {firstName}
                      </p>
                    </div>
                  </div>
                  <p className="text-[11.5px] text-b3 font-medium whitespace-nowrap">
                    {fmtMonthYear(r.sent_at) ? `Reco'd ${fmtMonthYear(r.sent_at)}` : ''}
                  </p>
                </div>
                {r.message && (
                  <button
                    type="button"
                    onClick={() => navigate(`/service/${r.service.id}`)}
                    className="w-full text-left mt-2.5 bg-bg5 rounded-[12px] p-3 flex items-start gap-2.5 hover:bg-bdr/40 transition-colors"
                  >
                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#e8dcc8] to-[#604030] flex-shrink-0" />
                    <p className="flex-1 text-[12.5px] text-b2 leading-snug">{r.message}</p>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state — no services + no recos authored. Surfaces gently
          rather than rendering a blank scroll area. */}
      {services.length === 0 && recoServices.length === 0 && reviews.length === 0 && (
        <div className="px-5 mt-8 mb-8">
          <div className="bg-white border border-bdr rounded-[14px] p-5 text-center">
            <p className="text-[14px] font-extrabold text-black">{firstName} hasn&apos;t shared any go-tos yet.</p>
            <p className="text-[12.5px] text-b3 font-medium mt-1 leading-snug">
              Their recommendations + listed services will appear here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
