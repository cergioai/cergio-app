// Per design-spec.md — Profile tab: identity, role pills, role entry points.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { PROFILE } from '../data/mock';
import { getStripeOnboardingUrl, getMyInstagram, saveInstagram } from '../lib/api';
import { useProviderReady } from '../hooks/useProviderReady';
import { InstagramConnectModal } from '../components/ui/InstagramConnectModal';

function fmtFollowers(n) {
  if (!Number.isFinite(+n)) return '';
  const x = +n;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (x >= 1_000)     return `${(x / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(x);
}

const QUICK_LINKS = [
  { label: 'Invite friends',           to: '/invite/friends-popup',    desc: 'Earn $25 credit per friend',       icon: 'people' },
  { label: 'Recommend services',       to: '/invite/recommend-popup',  desc: 'Earn $100 credit per service',     icon: 'briefcase' },
  { label: 'List my service',          to: '/list-service',            desc: 'Become a Cergio service provider', icon: 'briefcase' },
  { label: 'Become a Rainmaker',       to: '/rainmakers',              desc: 'Spotlight services and earn',      icon: 'shield' },
  { label: 'Apply for Rainmaker',      to: '/rainmaker/apply',         desc: 'Submit your application',          icon: 'spark' },
  { label: 'Free Service Benefits',    to: '/benefits',                desc: 'How free services work',           icon: 'heart' },
];

// Settings is now built dynamically based on auth state — see render below.

function SetupPayoutsButton({ showToast }) {
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    setBusy(true);
    const { data, error } = await getStripeOnboardingUrl();
    setBusy(false);
    if (error) { showToast(error.message); return; }
    if (data?.url) {
      // Open in same tab (Stripe redirects back to /profile?stripe=done)
      window.location.href = data.url;
    }
  };
  return (
    <button
      onClick={handle}
      disabled={busy}
      className={`w-full mt-3 rounded-[16px] p-4 flex items-center justify-between text-left
        ${busy ? 'bg-bg5 text-b3' : 'bg-black text-white hover:opacity-90'}`}
    >
      <div>
        <p className="text-[14px] font-extrabold">{busy ? 'Opening Stripe…' : 'Set up payouts'}</p>
        <p className={`text-[12px] mt-0.5 ${busy ? 'text-b3' : 'text-white/70'}`}>
          Connect a bank account so we can pay you
        </p>
      </div>
      <span className={`text-lg ${busy ? 'text-b3' : 'text-white/70'}`}>›</span>
    </button>
  );
}

const ICONS = {
  people:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 21c0-3 3-5 6-5s6 2 6 5"/><path d="M16 12c3 0 5 2 5 5"/></svg>,
  briefcase: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2"/></svg>,
  shield:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z"/><path d="M9 12l2 2 4-4"/></svg>,
  spark:     () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M5 19l4-4M15 9l4-4"/></svg>,
  heart:     () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
};

export function ProfileScreen() {
  const navigate = useNavigate();
  const { showToast, serviceMode, setServiceMode, auth } = useOutletContext();
  // Used to gate "List my service" — provider must be Stripe-ready first
  // (per Phase B decision). Free Rainmaker listings could be exempted later
  // if needed; for now we apply the same gate uniformly.
  const provider = useProviderReady(auth);

  // Use real auth data when signed in; fall back to PROFILE mock otherwise.
  const isSignedIn = !!auth?.isSignedIn;
  const u          = auth?.user;
  const displayName = u?.user_metadata?.display_name || u?.email?.split('@')[0] || PROFILE.name;
  const handle      = u?.email ? '@' + (u.email.split('@')[0]) : PROFILE.handle;
  const initials    = (displayName[0] || 'T').toUpperCase();
  const joinedDate  = u?.created_at ? new Date(u.created_at).toLocaleString('default', { month: 'long', year: 'numeric' }) : PROFILE.joinedDate;

  const p = { ...PROFILE, name: displayName, handle, initials, joinedDate };

  // Instagram connection — loaded once, surfaced as a card in the header.
  const [ig, setIg] = useState(null);
  const [showIgModal, setShowIgModal] = useState(false);
  useEffect(() => {
    if (!isSignedIn) { setIg(null); return; }
    getMyInstagram().then(({ data }) => setIg(data || null));
  }, [isSignedIn]);
  const handleSaveIg = async ({ handle: h, followers: f }) => {
    const { data, error } = await saveInstagram({ handle: h, followers: f });
    if (error) throw new Error(error.message);
    setIg({
      instagram_handle:       data?.instagram_handle ?? h,
      instagram_followers:    data?.instagram_followers ?? f ?? null,
      instagram_connected_at: data?.instagram_connected_at ?? new Date().toISOString(),
      instagram_verified_at:  data?.instagram_verified_at ?? null,
    });
    showToast?.('Instagram saved ✓');
    setShowIgModal(false);
  };

  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      {/* header — green gradient + identity */}
      <div className="bg-gradient-to-b from-gm to-g px-5 pt-8 pb-7">
        <div className="flex items-center gap-4">
          <div className={`w-20 h-20 rounded-full bg-white/20 border-[3px] border-white
                          flex items-center justify-center text-white text-[28px] font-extrabold`}>
            {p.initials}
          </div>
          <div className="flex-1 text-white">
            <p className="text-[22px] font-extrabold leading-tight">{p.name}</p>
            <p className="text-[14px] text-white/80 mt-0.5">{p.handle}</p>
            <p className="text-[12px] text-white/70 mt-1">Joined {p.joinedDate}</p>
          </div>
        </div>

        {/* role pills */}
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="bg-white text-black text-[11px] font-extrabold px-3 py-1 rounded-pill">
            Booker
          </span>
          {p.isProvider && (
            <span className="bg-white text-black text-[11px] font-extrabold px-3 py-1 rounded-pill">
              Provider
            </span>
          )}
          {p.isRainmaker && (
            <span className="bg-black text-white text-[11px] font-extrabold px-3 py-1 rounded-pill">
              ⭐ Rainmaker
            </span>
          )}
        </div>
      </div>

      {/* Instagram card — show connected handle + followers, or a "Connect"
          CTA when empty. Drives the spotlight flow and trust score. */}
      {isSignedIn && (
        <div className="px-5 pt-5">
          {ig?.instagram_handle ? (
            <button
              type="button"
              onClick={() => setShowIgModal(true)}
              className="w-full bg-white border border-bdr rounded-[16px] p-3.5 flex items-center gap-3 text-left
                         hover:border-g/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-[10px] bg-black flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                     stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <circle cx="12" cy="12" r="4.5" />
                  <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-extrabold text-black leading-tight">
                  @{ig.instagram_handle}
                  {ig.instagram_verified_at && (
                    <span className="ml-1.5 inline-flex items-center bg-gl text-gd rounded-pill px-2 py-0.5 text-[10px] font-extrabold align-middle">
                      ✓ Verified
                    </span>
                  )}
                </p>
                {ig.instagram_followers != null && (
                  <p className="text-[12px] text-b3 mt-0.5">
                    {fmtFollowers(ig.instagram_followers)} followers
                  </p>
                )}
              </div>
              <span className="text-b3 text-lg">›</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowIgModal(true)}
              className="w-full bg-white border border-bdr rounded-[16px] p-3.5 flex items-center gap-3 text-left
                         hover:border-g/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-[10px] bg-black flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                     stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <circle cx="12" cy="12" r="4.5" />
                  <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-extrabold text-black leading-tight">Connect Instagram</p>
                <p className="text-[12px] text-b3 mt-0.5">Required for Rainmakers · boosts trust for providers</p>
              </div>
              <span className="text-b3 text-lg">›</span>
            </button>
          )}
        </div>
      )}

      {showIgModal && (
        <InstagramConnectModal
          initialHandle={ig?.instagram_handle ?? ''}
          initialFollowers={ig?.instagram_followers ?? ''}
          onSave={handleSaveIg}
          onClose={() => setShowIgModal(false)}
        />
      )}

      {/* Service mode toggle — provider <-> consumer view */}
      <div className="px-5 pt-6">
        <button
          onClick={() => {
            setServiceMode(!serviceMode);
            showToast(serviceMode ? 'Back to user view' : 'You\'re now in Service view');
          }}
          className="w-full bg-black text-white rounded-[24px] py-4 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          {serviceMode ? 'Switch to user view' : 'Switch to Service view'}
        </button>

        {serviceMode && (
          <>
            <button
              onClick={() => navigate('/services/manage')}
              className="w-full mt-3 bg-white border border-bdr rounded-[16px] p-4 flex items-center justify-between text-left"
            >
              <div>
                <p className="text-[14px] font-extrabold text-black">Manage services</p>
                <p className="text-[12px] text-b3 mt-0.5">Edit listings, photos, and pricing</p>
              </div>
              <span className="text-b3 text-lg">›</span>
            </button>
            <SetupPayoutsButton showToast={showToast} />
          </>
        )}
      </div>

      {/* quick links */}
      <p className="px-5 pt-6 pb-3 text-[11px] font-extrabold uppercase tracking-widest text-b3">
        Become more on Cergio
      </p>
      <div className="px-5 flex flex-col gap-2">
        {QUICK_LINKS.map(link => {
          const Icon = ICONS[link.icon];
          // Gate the "List my service" entry on Stripe readiness.
          const gated = link.to === '/list-service' && isSignedIn && !provider.loading && !provider.ready;
          const onClick = () => {
            if (gated) {
              showToast(
                provider.hasAccount
                  ? 'Stripe is still verifying your payout account'
                  : 'Tap Switch to Service view, then Set up payouts first'
              );
              return;
            }
            navigate(link.to);
          };
          return (
            <button
              key={link.label}
              onClick={onClick}
              className={`bg-white border border-bdr rounded-[16px] p-4 flex items-center gap-3 text-left
                         transition-colors ${gated ? 'opacity-60' : 'hover:border-g/40'}`}
            >
              <div className="w-10 h-10 rounded-full bg-gl flex items-center justify-center text-gd flex-shrink-0">
                <Icon />
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-extrabold text-black leading-tight">{link.label}</p>
                <p className="text-[12px] text-b3 mt-0.5">
                  {gated
                    ? (provider.hasAccount ? 'Stripe verifying…' : 'Needs payouts setup')
                    : link.desc}
                </p>
              </div>
              <span className="text-b3 text-lg">›</span>
            </button>
          );
        })}
      </div>

      {/* settings */}
      <p className="px-5 pt-6 pb-3 text-[11px] font-extrabold uppercase tracking-widest text-b3">
        Settings
      </p>
      <div className="px-5 flex flex-col">
        {(() => {
          const settings = [
            { label: 'Payment methods', onClick: () => showToast('Payment methods — coming soon') },
            { label: 'Notifications',   onClick: () => showToast('Notifications — coming soon') },
            { label: 'Help & support',  onClick: () => showToast('Help — coming soon') },
            isSignedIn
              ? { label: 'Sign out', onClick: async () => { await auth.signOut(); showToast('Signed out'); navigate('/'); } }
              : { label: 'Sign in',  onClick: () => navigate('/auth') },
          ];
          return settings.map((s, i) => (
            <button
              key={s.label}
              onClick={s.onClick}
              className={`bg-white py-4 flex items-center justify-between text-left
                          ${i === 0 ? 'rounded-t-[16px]' : ''}
                          ${i === settings.length - 1 ? 'rounded-b-[16px]' : 'border-b border-bdr'}
                          px-4`}
            >
              <span className={`text-[14px] font-extrabold ${s.label === 'Sign out' ? 'text-[#A32D2D]' : 'text-black'}`}>{s.label}</span>
              <span className="text-b3 text-lg">›</span>
            </button>
          ));
        })()}
      </div>
    </div>
  );
}
