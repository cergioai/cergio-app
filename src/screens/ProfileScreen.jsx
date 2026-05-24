// Per Figma "Hi Jacob!" Profile view — pure white bg, large greeting +
// avatar top-right, large bold section headers, NO dividers between rows,
// generous vertical rhythm. Switch to Service View is full-width GREEN
// inside the Services section.
//
// Brand language: Rainmaker → Connector (rename applied across UI 2026-05-24;
// route paths + DB columns kept on `rainmaker_*` until a follow-up migration
// renames them too — the user-visible copy is what matters most right now).
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { PROFILE } from '../data/mock';
import { getStripeOnboardingUrl, getMyInstagram, saveInstagram, getMyTikTok, saveTikTok, getMySpotlightPrices } from '../lib/api';
import { useProviderReady } from '../hooks/useProviderReady';
import { InstagramConnectModal } from '../components/ui/InstagramConnectModal';
import { TikTokConnectModal } from '../components/ui/TikTokConnectModal';

function fmtFollowers(n) {
  if (!Number.isFinite(+n)) return '';
  const x = +n;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (x >= 1_000)     return `${(x / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(x);
}

// Big-row pattern per Figma: title (text-[18px] bold) + optional subtitle
// (text-[15px] b3) + optional inline mint pill, with a fat chevron at right.
// No bottom-border — separation comes from generous py-4.5 spacing alone.
function Row({ title, subtitle, pill, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full px-5 py-4 flex items-center justify-between text-left
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-bg5/30 transition-colors'}`}
    >
      <div className="flex-1 pr-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[18px] font-bold text-black leading-tight">{title}</span>
          {pill && pill}
        </div>
        {subtitle && (
          <p className="text-[15px] text-b3 mt-1 leading-snug font-medium">{subtitle}</p>
        )}
      </div>
      <Chevron />
    </button>
  );
}

// Small, cute chevron — thin stroke + compact size per Tarik's "small cute
// etc" direction. Softer visual weight than the row titles.
function Chevron() {
  return (
    <svg width="8" height="13" viewBox="0 0 11 18" fill="none" className="flex-shrink-0 text-b3">
      <path d="M1.5 1.5L9 9l-7.5 7.5" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Section header — big, bold, generous top margin to define rhythm
// between sections. Sits at the same px-5 inset as rows.
function SectionHeader({ title }) {
  return (
    <h2 className="px-5 text-[26px] font-extrabold text-black mt-10 mb-1 leading-tight">{title}</h2>
  );
}

function SetupPayoutsRow({ showToast }) {
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
  const initials    = (displayName[0] || 'T').toUpperCase();

  // Social connections + spotlight rate card (drives "Become a Connector"
  // vs "Add spotlight rate" label on the Social section entry row).
  const [ig, setIg] = useState(null);
  const [showIgModal, setShowIgModal] = useState(false);
  const [tt, setTt] = useState(null);
  const [showTtModal, setShowTtModal] = useState(false);
  const [spotlightPrices, setSpotlightPrices] = useState(null);
  useEffect(() => {
    if (!isSignedIn) { setIg(null); setTt(null); setSpotlightPrices(null); return; }
    getMyInstagram().then(({ data }) => setIg(data || null));
    getMyTikTok().then(({ data }) => setTt(data || null));
    getMySpotlightPrices().then(({ data }) => setSpotlightPrices(data || null));
  }, [isSignedIn]);
  const hasRateCard = !!(
    spotlightPrices?.spotlight_price_instagram_cents != null ||
    spotlightPrices?.spotlight_price_tiktok_cents    != null
  );
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
  const handleSaveTt = async ({ handle: h, followers: f, verified }) => {
    const { data, error } = await saveTikTok({ handle: h, followers: f, verified });
    if (error) throw new Error(error.message);
    setTt({
      tiktok_handle:       data?.tiktok_handle ?? h,
      tiktok_followers:    data?.tiktok_followers ?? f ?? null,
      tiktok_connected_at: data?.tiktok_connected_at ?? new Date().toISOString(),
      tiktok_verified_at:  data?.tiktok_verified_at ?? (verified ? new Date().toISOString() : null),
    });
    showToast?.('TikTok saved ✓');
    setShowTtModal(false);
  };

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

  // Inline pills used inside row titles.
  const MintPill = ({ children }) => (
    <span className="bg-gl text-gd rounded-pill px-3 py-0.5 text-[14px] font-extrabold whitespace-nowrap">
      {children}
    </span>
  );

  // Greeting first name only.
  const firstName = displayName.split(/[\s@.]/)[0];

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-24">
      {/* ── Top: greeting + avatar ─────────────────────────────────────────── */}
      <div className="px-5 pt-10 pb-2 flex items-start justify-between gap-4">
        <h1 className="text-[30px] font-extrabold text-black leading-tight">
          Hi {firstName}!
        </h1>
        <div className="w-14 h-14 rounded-full bg-bg5 flex items-center justify-center text-black text-[20px] font-extrabold flex-shrink-0 overflow-hidden">
          {initials}
        </div>
      </div>

      {/* ── Account ────────────────────────────────────────────────────────── */}
      <SectionHeader title="Account" />
      <Row title="View and edit profile" onClick={() => showToast('Profile editing — coming soon')} />
      <Row title="Edit account info"   onClick={() => showToast('Account info — coming soon')} />
      <Row title="Payment settings"    onClick={() => showToast('Payment methods — coming soon')} />

      {/* ── Social — Connector entry on top, then IG, then TikTok ─────────
          The first row flips between "Become a Connector" (new user, no
          rate card yet) and "Add spotlight rate" (already a Connector).
          Both route to the apply flow where IG/TT and rate-card are set. */}
      {isSignedIn && (
        <>
          <SectionHeader title="Social" />
          <Row
            title={hasRateCard ? 'Add a spotlight rate' : 'Become a Connector'}
            subtitle={hasRateCard
              ? 'Edit your IG / TikTok rate card or audience'
              : 'Set your rate card — services book you for spotlights'}
            pill={hasRateCard ? <MintPill>Connector ✓</MintPill> : null}
            onClick={() => navigate('/rainmaker/apply/instagram')}
          />
          {/* Spotlight requests — second Social row. Shows for everyone since
              providers also see their outbound requests here. */}
          <Row
            title="Spotlight requests"
            subtitle="Manage inbound + sent spotlight asks"
            onClick={() => navigate('/connectors/requests')}
          />
          {ig?.instagram_handle ? (
            <Row
              title={`Instagram · @${ig.instagram_handle}`}
              subtitle={
                ig.instagram_followers != null
                  ? `${fmtFollowers(ig.instagram_followers)} followers · helps Connectors tag you`
                  : 'Connected — add follower count for better matches'
              }
              pill={ig.instagram_verified_at ? <MintPill>✓ Verified</MintPill> : null}
              onClick={() => setShowIgModal(true)}
            />
          ) : (
            <Row title="Connect Instagram" subtitle="Required for Connectors · boosts trust for providers" onClick={() => setShowIgModal(true)} />
          )}
          {tt?.tiktok_handle ? (
            <Row
              title={`TikTok · @${tt.tiktok_handle}`}
              subtitle={
                tt.tiktok_followers != null
                  ? `${fmtFollowers(tt.tiktok_followers)} audience · boosts your spotlight reach`
                  : 'Connected — add audience size for better matches'
              }
              pill={tt.tiktok_verified_at ? <MintPill>✓ Verified</MintPill> : null}
              onClick={() => setShowTtModal(true)}
            />
          ) : (
            <Row title="Connect TikTok" subtitle="Add your TikTok handle + audience size" onClick={() => setShowTtModal(true)} />
          )}
        </>
      )}

      {/* ── Services — GREEN switch CTA right at the top of the section ────── */}
      <SectionHeader title="Services" />
      <Row
        title="List a new service"
        subtitle={listGated
          ? (provider.hasAccount ? 'Stripe verifying…' : 'Needs payouts setup first')
          : 'Offer your service on Cergio'}
        onClick={onListService}
      />
      {/* Switch button — full-width GREEN per Figma. Moved to TOP of
          Services per user direction (was previously below the list at the
          bottom of the screen). */}
      <div className="px-5 mt-3 mb-1">
        <button
          onClick={() => {
            setServiceMode(!serviceMode);
            showToast(serviceMode ? 'Back to user view' : 'You\'re now in Service view');
          }}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[17px] font-extrabold
                     hover:opacity-90 active:scale-[.98] transition-all"
        >
          {serviceMode ? 'Switch to User View' : 'Switch to Service View'}
        </button>
      </div>
      {serviceMode && (
        <>
          <Row
            title="Manage services"
            subtitle="Edit listings, photos, and pricing"
            onClick={() => navigate('/services/manage')}
          />
          {!provider.ready && <SetupPayoutsRow showToast={showToast} />}
        </>
      )}

      {/* ── Earn Cash! ─────────────────────────────────────────────────────── */}
      <SectionHeader title="Earn Cash!" />
      <Row
        title="My credits"
        subtitle="See and manage your earnings"
        pill={<MintPill>$0 USD</MintPill>}
        onClick={() => navigate('/earnings')}
      />
      <Row
        title="Find friends on Cergio"
        subtitle="Sync contacts · Instagram · TikTok — see who's already here"
        onClick={() => navigate('/find-friends')}
      />
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
        title="Manage network"
        onClick={() => showToast('Network management — coming soon')}
      />
      <Row
        title="Invite Connectors and influencers"
        onClick={() => navigate('/rainmakers')}
      />

      {/* ── Additional Links ───────────────────────────────────────────────── */}
      <SectionHeader title="Additional Links" />
      <Row title="Cergio FAQ"          onClick={() => showToast('FAQ — coming soon')} />
      <Row title="About Cergio"        onClick={() => showToast('About — coming soon')} />
      <Row title="Become a Connector"  onClick={() => navigate('/rainmaker/apply')} />
      <Row title="Contact support"     onClick={() => showToast('Support — coming soon')} />

      {/* ── Bottom: outlined Log out + "later" link ────────────────────────── */}
      <div className="px-5 mt-10 mb-3">
        {isSignedIn ? (
          <button
            onClick={async () => { await auth.signOut(); showToast('Signed out'); navigate('/'); }}
            className="w-full bg-white border-2 border-black text-black rounded-[14px] py-4
                       text-[17px] font-extrabold hover:bg-bg5/40 transition-colors"
          >
            Log out
          </button>
        ) : (
          <button
            onClick={() => navigate('/auth')}
            className="w-full bg-white border-2 border-black text-black rounded-[14px] py-4
                       text-[17px] font-extrabold hover:bg-bg5/40 transition-colors"
          >
            Sign in
          </button>
        )}
      </div>
      <button
        onClick={() => navigate('/home')}
        className="text-center text-[16px] font-extrabold text-b3 py-3 mx-auto"
      >
        I'll do this later
      </button>

      {/* Modals */}
      {showIgModal && (
        <InstagramConnectModal
          initialHandle={ig?.instagram_handle ?? ''}
          initialFollowers={ig?.instagram_followers ?? ''}
          onSave={handleSaveIg}
          onClose={() => setShowIgModal(false)}
        />
      )}
      {showTtModal && (
        <TikTokConnectModal
          initialHandle={tt?.tiktok_handle ?? ''}
          initialFollowers={tt?.tiktok_followers ?? ''}
          onSave={handleSaveTt}
          onClose={() => setShowTtModal(false)}
        />
      )}
    </div>
  );
}
