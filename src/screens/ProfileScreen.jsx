// Per Figma "User Profile View with Invite etc...png" — minimal, flat,
// list-based design. No green gradient header, no role pills, no bordered
// cards. Just sections of plain list rows with thin dividers. Inline pills
// for status/values (e.g. @handle, follower count, earnings).
//
// Section structure mirrors the Figma:
//   - Top: tiny avatar + name (horizontal, no extras)
//   - Account: profile / payments / notifications
//   - Instagram: connect-or-show status (rolled into Account-style list)
//   - Services: list / manage / payouts (gated on Stripe-readiness)
//   - Earn: invite / recommend / Rainmaker / benefits
//   - Support: help / about
//   - Bottom CTAs: Switch view + Sign out
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

// Plain list row: title + optional inline pill + optional subtitle + chevron.
// Thin border-b for separation, no card container.
function Row({ title, subtitle, pill, onClick, danger = false, disabled = false, isLast = false }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full py-4 flex items-center justify-between text-left
                  ${isLast ? '' : 'border-b border-bdr'}
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-bg5/40 transition-colors'}`}
    >
      <div className="flex-1 pr-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[16px] font-bold ${danger ? 'text-danger' : 'text-black'}`}>
            {title}
          </span>
          {pill && pill}
        </div>
        {subtitle && (
          <p className="text-[14px] text-b3 mt-0.5 leading-snug">{subtitle}</p>
        )}
      </div>
      {!danger && <span className="text-b3 text-xl flex-shrink-0">›</span>}
    </button>
  );
}

// Section header — big bold text, generous top spacing.
function SectionHeader({ title }) {
  return (
    <h2 className="text-[22px] font-extrabold text-black mt-8 mb-2 px-5">{title}</h2>
  );
}

function SetupPayoutsRow({ showToast, isLast }) {
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    setBusy(true);
    const { data, error } = await getStripeOnboardingUrl();
    setBusy(false);
    if (error) { showToast(error.message); return; }
    if (data?.url) window.location.href = data.url;
  };
  return (
    <Row
      title={busy ? 'Opening Stripe…' : 'Set up payouts'}
      subtitle="Connect a bank account so we can pay you"
      onClick={handle}
      disabled={busy}
      isLast={isLast}
    />
  );
}

export function ProfileScreen() {
  const navigate = useNavigate();
  const { showToast, serviceMode, setServiceMode, auth } = useOutletContext();
  const provider = useProviderReady(auth);

  const isSignedIn  = !!auth?.isSignedIn;
  const u           = auth?.user;
  const displayName = u?.user_metadata?.display_name || u?.email?.split('@')[0] || PROFILE.name;
  const handle      = u?.email ? '@' + (u.email.split('@')[0]) : PROFILE.handle;
  const initials    = (displayName[0] || 'T').toUpperCase();

  // Instagram connection
  const [ig, setIg] = useState(null);
  const [showIgModal, setShowIgModal] = useState(false);
  useEffect(() => {
    if (!isSignedIn) { setIg(null); return; }
    getMyInstagram().then(({ data }) => setIg(data || null));
  }, [isSignedIn]);
  const handleSaveIg = async ({ handle: h, followers: f, verified }) => {
    const { data, error } = await saveInstagram({ handle: h, followers: f, verified });
    if (error) throw new Error(error.message);
    setIg({
      instagram_handle:       data?.instagram_handle ?? h,
      instagram_followers:    data?.instagram_followers ?? f ?? null,
      instagram_connected_at: data?.instagram_connected_at ?? new Date().toISOString(),
      instagram_verified_at:  data?.instagram_verified_at ?? (verified ? new Date().toISOString() : null),
    });
    showToast?.('Instagram saved ✓');
    setShowIgModal(false);
  };

  // Gating for List my service
  const listGated = isSignedIn && !provider.loading && !provider.ready;
  const onListService = () => {
    if (listGated) {
      showToast(
        provider.hasAccount
          ? 'Stripe is still verifying your payout account'
          : 'Tap Switch to Service view, then Set up payouts first'
      );
      return;
    }
    navigate('/list-service');
  };

  // Inline pill helpers — small rounded-full chips that sit beside row titles.
  const MintPill = ({ children }) => (
    <span className="bg-gl text-gd rounded-pill px-2.5 py-0.5 text-[12px] font-extrabold">
      {children}
    </span>
  );
  const GrayPill = ({ children }) => (
    <span className="bg-bg5 text-b2 rounded-pill px-2.5 py-0.5 text-[12px] font-extrabold">
      {children}
    </span>
  );

  return (
    <div className="flex-1 flex flex-col bg-white overflow-y-auto pb-24">
      {/* ── Top identity strip — minimal, no gradient ────────────────────────── */}
      <div className="px-5 pt-10 pb-2 flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-bg5 flex items-center justify-center text-black text-[18px] font-extrabold flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[22px] font-extrabold text-black leading-tight truncate">{displayName}</p>
          {isSignedIn && (
            <p className="text-[13px] text-b3 truncate">{handle}</p>
          )}
        </div>
      </div>

      {/* ── Account section ──────────────────────────────────────────────────── */}
      <SectionHeader title="Account" />
      <div className="px-5">
        <Row
          title="View and edit profile"
          onClick={() => showToast('Profile editing — coming soon')}
        />
        <Row
          title="Payment methods"
          onClick={() => showToast('Payment methods — coming soon')}
        />
        <Row
          title="Notifications"
          onClick={() => showToast('Notifications — coming soon')}
          isLast
        />
      </div>

      {/* ── Instagram section ────────────────────────────────────────────────── */}
      {isSignedIn && (
        <>
          <SectionHeader title="Instagram" />
          <div className="px-5">
            {ig?.instagram_handle ? (
              <Row
                title={`@${ig.instagram_handle}`}
                subtitle={
                  ig.instagram_followers != null
                    ? `${fmtFollowers(ig.instagram_followers)} followers · helps Rainmakers tag you`
                    : 'Connected — add follower count for better matches'
                }
                pill={ig.instagram_verified_at ? <MintPill>✓ Verified</MintPill> : null}
                onClick={() => setShowIgModal(true)}
                isLast
              />
            ) : (
              <Row
                title="Connect Instagram"
                subtitle="Required for Rainmakers · boosts trust for providers"
                onClick={() => setShowIgModal(true)}
                isLast
              />
            )}
          </div>
        </>
      )}

      {/* ── Services section ─────────────────────────────────────────────────── */}
      <SectionHeader title="Services" />
      <div className="px-5">
        <Row
          title="List a new service"
          subtitle={listGated
            ? (provider.hasAccount ? 'Stripe verifying…' : 'Needs payouts setup first')
            : 'Offer your service on Cergio'}
          onClick={onListService}
        />
        {serviceMode && (
          <Row
            title="Manage services"
            subtitle="Edit listings, photos, and pricing"
            onClick={() => navigate('/services/manage')}
          />
        )}
        {serviceMode && !provider.ready && (
          <SetupPayoutsRow showToast={showToast} />
        )}
        <Row
          title="My earnings"
          subtitle="See and manage your cash earnings"
          pill={<MintPill>$0 USD</MintPill>}
          onClick={() => navigate('/earnings')}
          isLast
        />
      </div>

      {/* ── Earn section ─────────────────────────────────────────────────────── */}
      <SectionHeader title="Earn" />
      <div className="px-5">
        <Row
          title="Invite friends"
          subtitle="Earn $25 credit per friend"
          onClick={() => navigate('/invite/friends-popup')}
        />
        <Row
          title="Recommend services"
          subtitle="Earn $100 credit per service"
          onClick={() => navigate('/invite/recommend-popup')}
        />
        <Row
          title="Become a Rainmaker"
          subtitle="Spotlight services and earn"
          onClick={() => navigate('/rainmakers')}
        />
        <Row
          title="Apply for Rainmaker"
          subtitle="Submit your application"
          onClick={() => navigate('/rainmaker/apply')}
        />
        <Row
          title="Free Service Benefits"
          subtitle="How free services work"
          onClick={() => navigate('/benefits')}
          isLast
        />
      </div>

      {/* ── Support section ──────────────────────────────────────────────────── */}
      <SectionHeader title="Support" />
      <div className="px-5">
        <Row
          title="Help & support"
          onClick={() => showToast('Help — coming soon')}
        />
        <Row
          title="About Cergio"
          onClick={() => showToast('About — coming soon')}
          isLast
        />
      </div>

      {/* ── Bottom CTAs ──────────────────────────────────────────────────────── */}
      <div className="px-5 mt-10 mb-6 flex flex-col gap-3">
        <button
          onClick={() => {
            setServiceMode(!serviceMode);
            showToast(serviceMode ? 'Back to user view' : 'You\'re now in Service view');
          }}
          className="w-full bg-black text-white rounded-[12px] py-4 text-[16px] font-bold
                     hover:opacity-90 active:scale-[.98] transition-all"
        >
          {serviceMode ? 'Switch to user view' : 'Switch to Service view'}
        </button>

        {isSignedIn ? (
          <button
            onClick={async () => { await auth.signOut(); showToast('Signed out'); navigate('/'); }}
            className="w-full bg-white border border-bdr text-black rounded-[12px] py-4
                       text-[16px] font-bold hover:bg-bg5/40 transition-colors"
          >
            Sign out
          </button>
        ) : (
          <button
            onClick={() => navigate('/auth')}
            className="w-full bg-white border border-bdr text-black rounded-[12px] py-4
                       text-[16px] font-bold hover:bg-bg5/40 transition-colors"
          >
            Sign in
          </button>
        )}
      </div>

      {/* Instagram connect modal */}
      {showIgModal && (
        <InstagramConnectModal
          initialHandle={ig?.instagram_handle ?? ''}
          initialFollowers={ig?.instagram_followers ?? ''}
          onSave={handleSaveIg}
          onClose={() => setShowIgModal(false)}
        />
      )}
    </div>
  );
}
