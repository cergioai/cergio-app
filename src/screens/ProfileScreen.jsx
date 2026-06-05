// CERGIO-GUARD (2026-05-29): Profile screen v3 — collapsed from ~10 rows
// across 5 sections into 4 grouped CARDS, each tappable to reveal a
// bottom-sheet drawer with sub-actions. Top-of-screen priority is the
// most-relevant earnings/Connector/services actions; account + settings
// live in a calm bottom card.
//
// Top-down architecture:
//   Hero       — avatar + "Hi {firstName}!" + Connector status pill
//   Switch CTA — Switch to Service View (kept prominent, user requested)
//   Card 1     — Earn & grow      (always shown — primary income hub)
//   Card 2     — Connector        (signed-in)
//   Card 3     — Services         (provider mode OR has any service)
//   Card 4     — Account & settings (always shown)
//   Footer     — Log out / Sign in + "I'll do this later"
//
// Sub-actions reveal via <ActionDrawer/>. The drawer pattern mirrors the
// existing Connector explainer + GPI popup so it feels native to the app.
// Reusing rather than reinventing keeps the UX coherent.
//
// IMPORTANT: every legacy nav target still routes from the new drawers
// (qa #23 verifies). The reorg is purely cosmetic — no link is dropped.

import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  getStripeOnboardingUrl, getMyInstagram, saveInstagram, getMyTikTok, saveTikTok,
  getMySpotlightPrices, listMyServices,
  getPublicProfileStats, getMyEarnings,
} from '../lib/api';
import { supabase, supabaseReady } from '../lib/supabase';
import { useProviderReady } from '../hooks/useProviderReady';
import { InstagramConnectModal } from '../components/ui/InstagramConnectModal';
import { TikTokConnectModal } from '../components/ui/TikTokConnectModal';
import { EditProfileModal } from '../components/ui/EditProfileModal';
import { REWARDS, REWARD_COPY } from '../lib/rewards';

function fmtFollowers(n) {
  if (!Number.isFinite(+n)) return '';
  const x = +n;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (x >= 1_000)     return `${(x / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(x);
}

// ─── Small primitives ──────────────────────────────────────────────────────

function Chevron({ className = 'text-b3' }) {
  return (
    <svg width="8" height="13" viewBox="0 0 11 18" fill="none" className={`flex-shrink-0 ${className}`}>
      <path d="M1.5 1.5L9 9l-7.5 7.5" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MintPill({ children, tone = 'mint' }) {
  const cls = tone === 'mint' ? 'bg-gl text-gd'
            : tone === 'amber' ? 'bg-warnBg text-warnText'
            : 'bg-bg5 text-b2';
  return (
    <span className={`${cls} rounded-pill px-2.5 py-0.5 text-[11px] font-extrabold whitespace-nowrap`}>
      {children}
    </span>
  );
}

// Top-level group card. Big tappable surface with title, summary, and an
// optional value indicator on the right (earnings $ / count / status).
function GroupCard({ title, summary, value, valueLabel, pill, onClick, accent = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[20px] p-5 mb-3 flex items-start justify-between text-left
                  transition-colors border
                  ${accent
                    ? 'bg-gl border-g/30 hover:bg-gl/85'
                    : 'bg-card border-bdr/60 hover:bg-bg5/30'}`}
    >
      <div className="flex-1 pr-3">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[17px] font-extrabold text-black leading-tight">{title}</span>
          {pill}
        </div>
        <p className="text-[12.5px] text-b3 leading-snug">{summary}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {value && (
          <div className="text-right">
            <div className="text-[15px] font-extrabold text-gd leading-tight">{value}</div>
            {valueLabel && <div className="text-[10px] text-b3 leading-tight mt-0.5">{valueLabel}</div>}
          </div>
        )}
        <Chevron />
      </div>
    </button>
  );
}

// Bottom-sheet drawer — mirrors the existing Connector explainer pattern.
// Closes on backdrop click or × button. Content is whatever children the
// caller passes (typically a stack of <DrawerAction/> rows).
function ActionDrawer({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] bg-black/40 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[390px] bg-cream rounded-t-[24px] p-5 pb-7 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-3">
          <h3 className="text-[20px] font-extrabold text-black leading-tight">{title}</h3>
          <button
            onClick={onClose}
            className="text-[22px] text-b3 font-bold px-2 -mt-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}

// Action row inside a drawer. Optional icon, title, subtitle, pill.
function DrawerAction({ title, subtitle, pill, onClick, disabled = false, icon = null }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full bg-white rounded-[14px] px-4 py-3.5 flex items-center justify-between text-left
                  border border-bdr/40 transition-colors
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-bg5/30'}`}
    >
      <div className="flex items-center gap-3 flex-1 pr-2">
        {icon && (
          <div className="w-9 h-9 rounded-full bg-gl flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-bold text-black leading-tight">{title}</span>
            {pill}
          </div>
          {subtitle && (
            <p className="text-[11.5px] text-b3 mt-0.5 leading-snug">{subtitle}</p>
          )}
        </div>
      </div>
      <Chevron />
    </button>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ProfileScreen() {
  const navigate = useNavigate();
  const { showToast, serviceMode, setServiceMode, auth } = useOutletContext();
  const provider = useProviderReady(auth);

  const isSignedIn  = !!auth?.isSignedIn;
  const u           = auth?.user;
  // CERGIO-GUARD: no mock fallback name — signed-out shows a neutral label.
  const displayName = u?.user_metadata?.display_name || u?.email?.split('@')[0] || 'Guest';
  const initials    = (displayName[0] || '?').toUpperCase();
  const firstName   = displayName.split(/[\s@.]/)[0];

  // Drawers + modals
  const [openDrawer,  setOpenDrawer]  = useState(null); // 'earn' | 'connector' | 'services' | 'account' | null
  const [showIgModal, setShowIgModal] = useState(false);
  const [showTtModal, setShowTtModal] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showConnectorInfo, setShowConnectorInfo] = useState(false);

  // Live data
  const [ig, setIg] = useState(null);
  const [tt, setTt] = useState(null);
  const [spotlightPrices, setSpotlightPrices] = useState(null);
  const [hasService, setHasService] = useState(false);
  const [serviceCount, setServiceCount] = useState(0);
  // CERGIO-GUARD (2026-06-05): headline pulled from profiles row so the
  // hero subtitle reflects what the user typed in EditProfileModal. Bio
  // is loaded here too but rendered on PublicProfileScreen; ProfileScreen
  // hero only shows the headline (the longer bio belongs on the public
  // surface where viewers are deciding whether to engage).
  const [headline, setHeadline] = useState('');
  const [followerCount, setFollowerCount] = useState(0);
  // CERGIO-GUARD (2026-06-05): per-section counts + global stats strip
  // per Tarik: "for each header need to include related #'s (earnings,
  // friend invites, reco's etc.) and global above by name (followers,
  // friends reco's…)". One Promise.all on mount keeps the screen snappy
  // and avoids cascading skeleton states.
  const [stats, setStats] = useState({
    invited: 0, joined: 0, booked: 0, recommended: 0, listedServices: 0,
  });
  const [earningsTotalCents, setEarningsTotalCents] = useState(0);

  useEffect(() => {
    if (!isSignedIn) {
      setIg(null); setTt(null); setSpotlightPrices(null);
      setHasService(false); setServiceCount(0);
      setHeadline(''); setFollowerCount(0);
      setStats({ invited: 0, joined: 0, booked: 0, recommended: 0, listedServices: 0 });
      setEarningsTotalCents(0);
      return;
    }
    getMyInstagram().then(({ data }) => setIg(data || null));
    getMyTikTok().then(({ data }) => setTt(data || null));
    getMySpotlightPrices().then(({ data }) => setSpotlightPrices(data || null));
    listMyServices().then(({ data }) => {
      const n = (data || []).length;
      setHasService(n > 0);
      setServiceCount(n);
    });
    // Stats — invites/joined/booked/recommended/listedServices counts
    // for the user's own profile id, plus a follower count from
    // profiles.follower_count (column already used across api.js).
    if (u?.id) {
      getPublicProfileStats(u.id).then(({ data }) => {
        if (data) setStats(data);
      });
      getMyEarnings({ limit: 500 }).then(({ data }) => {
        const cents = (data || []).reduce((sum, e) => sum + (e.amount_cents || 0), 0);
        setEarningsTotalCents(cents);
      });
    }
    // Pull the user's headline + follower_count — defensive: column
    // may not exist if the migration hasn't been applied yet, in which
    // case the hero just shows the Member/Connector pill row with no
    // subtitle and follower count stays 0.
    if (supabaseReady && u?.id) {
      supabase
        .from('profiles')
        .select('headline, follower_count')
        .eq('id', u.id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) return;
          if (data?.headline) setHeadline(data.headline);
          if (data?.follower_count != null) setFollowerCount(data.follower_count);
        });
    }
  }, [isSignedIn, u?.id]);

  const hasRateCard = !!(
    spotlightPrices?.spotlight_price_instagram_cents != null ||
    spotlightPrices?.spotlight_price_tiktok_cents    != null
  );

  const closeDrawer = () => setOpenDrawer(null);
  const nav = (path) => { closeDrawer(); navigate(path); };

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

  const openStripe = () => {
    showToast('Opening Stripe…');
    getStripeOnboardingUrl().then(({ data }) => {
      if (data?.url) window.location.href = data.url;
      else showToast('Stripe onboarding link unavailable');
    });
  };

  const listGated = isSignedIn && !provider.loading && !provider.ready;
  const onListService = () => {
    closeDrawer();
    if (listGated) {
      showToast(provider.hasAccount
        ? 'Payouts pending Stripe verification — your listing will still publish.'
        : 'Heads up: set up payouts later in Profile → Services.');
    }
    navigate('/list-service');
  };

  // ── Status pills for the hero ────────────────────────────────────────────
  const connectorStatusPill = hasRateCard
    ? <MintPill>Connector ✓</MintPill>
    : null;

  const showServicesCard = serviceMode || hasService;

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-24">
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <div className="px-5 pt-8 pb-2 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-[24px] font-extrabold text-black leading-tight">
            Hi {firstName}!
          </h1>
          {/* CERGIO-GUARD (2026-06-05): user-typed headline. Sits between
              the greeting and the Connector/Member pill so the hero
              reflects the user's own positioning the moment they land. */}
          {headline && (
            <p className="text-[12.5px] text-b2 leading-snug mt-1 font-medium">
              {headline}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            {isSignedIn ? (
              hasRateCard
                ? <MintPill>Connector ✓</MintPill>
                : <span className="text-[11.5px] text-b3 font-bold uppercase tracking-wide">Member</span>
            ) : (
              <span className="text-[11.5px] text-b3 font-bold uppercase tracking-wide">Not signed in</span>
            )}
          </div>
        </div>
        <div className="w-12 h-12 rounded-full bg-bg5 flex items-center justify-center text-black text-[16px] font-extrabold flex-shrink-0 overflow-hidden">
          {initials}
        </div>
      </div>

      {/* ── Switch view CTA — primary action, kept at top ──────────────── */}
      <div className="px-5 mt-3 mb-3">
        <button
          onClick={() => {
            setServiceMode(!serviceMode);
            showToast(serviceMode ? 'Back to user view' : "You're now in Service view");
          }}
          className="w-full bg-g text-white rounded-[24px] py-3.5 text-[16px] font-extrabold
                     hover:opacity-90 active:scale-[.98] transition-all"
        >
          {serviceMode ? 'Switch to User View' : 'Switch to Service View'}
        </button>
      </div>

      {/* ── Global stats strip ─────────────────────────────────────────────
          CERGIO-GUARD (2026-06-05): four-tile bar Tarik asked for —
          "global above by name (followers, friends reco's…)". Mirrors
          the by-the-numbers block on PublicProfileScreen so the user's
          own view + their public view agree at a glance. Tiles route
          straight into the relevant tracking screen. Hidden for
          guests. */}
      {isSignedIn && (
        <div className="mx-5 mb-5 grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => navigate(`/u/${u.id}`)}
            className="bg-white border border-bdr rounded-[12px] py-2 px-1 text-center hover:bg-bg5/40 transition-colors"
            title="Your follower count — tap to view your public profile"
          >
            <p className="text-[16px] font-extrabold text-black leading-none">{fmtFollowers(followerCount)}</p>
            <p className="text-[9px] font-extrabold uppercase tracking-wide text-b3 mt-0.5">Followers</p>
          </button>
          <button
            type="button"
            onClick={() => navigate('/earnings/invites')}
            className="bg-white border border-bdr rounded-[12px] py-2 px-1 text-center hover:bg-bg5/40 transition-colors"
            title={`${stats.invited} friends invited — tap to track`}
          >
            <p className="text-[16px] font-extrabold text-black leading-none">{stats.invited}</p>
            <p className="text-[9px] font-extrabold uppercase tracking-wide text-b3 mt-0.5">Friends</p>
          </button>
          <button
            type="button"
            onClick={() => navigate(stats.recommended > 0 ? '/earnings/recos' : '/invite/recommend')}
            className="bg-white border border-bdr rounded-[12px] py-2 px-1 text-center hover:bg-bg5/40 transition-colors"
            title={`${stats.recommended} reco'd — tap to review`}
          >
            <p className="text-[16px] font-extrabold text-black leading-none">{stats.recommended}</p>
            <p className="text-[9px] font-extrabold uppercase tracking-wide text-b3 mt-0.5">Reco&apos;d</p>
          </button>
          <button
            type="button"
            onClick={() => navigate('/earnings')}
            className="bg-gl/60 border border-g/25 rounded-[12px] py-2 px-1 text-center hover:bg-gl transition-colors"
            title="Lifetime earnings — tap to view ledger"
          >
            <p className="text-[16px] font-extrabold text-gd leading-none">${Math.round(earningsTotalCents / 100)}</p>
            <p className="text-[9px] font-extrabold uppercase tracking-wide text-gd mt-0.5">Earned</p>
          </button>
        </div>
      )}

      {/* ── Grouped cards ──────────────────────────────────────────────── */}
      <div className="px-5">
        {/* CERGIO-GUARD (2026-06-05): each section header now includes
            related counts per Tarik — "for each header need to include
            related #'s (earnings, friend invites, reco's etc.)". The
            summaries lead with the user's actual numbers so the section
            reads as "here's where my N invites + M recos live", not a
            generic feature blurb. Hero value cell still shows the
            primary number (earnings $ for Earn, listing count for
            Services). */}

        {/* Card 1 — Earn & grow */}
        <GroupCard
          title="Earn & grow"
          summary={isSignedIn
            ? `${stats.invited} invited · ${stats.recommended} reco'd · $${REWARDS.perFriend}/friend who books`
            : `Invite, recommend, see earnings — $${REWARDS.perFriend} per friend who joins + books`}
          value={isSignedIn ? `$${Math.round(earningsTotalCents / 100)}` : '$0'}
          valueLabel="USD"
          accent
          onClick={() => setOpenDrawer('earn')}
        />

        {/* Card 2 — Connector (signed-in) */}
        {isSignedIn && (
          <GroupCard
            title="Connector"
            summary={hasRateCard
              ? `IG · TikTok rate card live — spotlight requests welcome`
              : `$${REWARDS.perFriendConnector} cash + free services + Growth Participation Income`}
            pill={connectorStatusPill}
            value={hasRateCard ? '✓' : 'Apply'}
            valueLabel={hasRateCard ? 'Active' : ''}
            onClick={() => setOpenDrawer('connector')}
          />
        )}

        {/* Card 3 — Services (provider-mode or has any service) */}
        {showServicesCard && (
          <GroupCard
            title="Services"
            summary={hasService
              ? `${serviceCount} listed · ${stats.booked} booked · manage + payouts`
              : 'List a new service and start receiving bookings'}
            value={hasService ? String(serviceCount) : 'New'}
            valueLabel={hasService ? (serviceCount === 1 ? 'listed' : 'listed') : ''}
            onClick={() => setOpenDrawer('services')}
          />
        )}

        {/* Card 4 — Account & settings */}
        <GroupCard
          title="Account & settings"
          summary="Profile · headline · bio · payments · privacy"
          onClick={() => setOpenDrawer('account')}
        />
      </div>

      {/* ── Bottom: Log out / Sign in + "later" ─────────────────────────── */}
      <div className="px-5 mt-8 mb-3">
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
        className="text-center text-[14px] font-bold text-b3 py-3 mx-auto underline underline-offset-2"
      >
        I'll do this later
      </button>

      {/* ── Drawer: Earn & grow ─────────────────────────────────────────── */}
      <ActionDrawer
        open={openDrawer === 'earn'}
        title="Earn & grow"
        onClose={closeDrawer}
      >
        <DrawerAction
          title="My earnings"
          subtitle="Balance, breakdown, history"
          pill={<MintPill>$0 USD</MintPill>}
          onClick={() => nav('/earnings')}
        />
        <DrawerAction
          title="Invite friends"
          subtitle={`$${REWARDS.perFriendUser} credit per friend who joins + books`}
          onClick={() => nav('/invite/friends-popup')}
        />
        <DrawerAction
          title="Recommend a service"
          subtitle="Earn when a friend books from your recommendation"
          onClick={() => nav('/invite/recommend')}
        />
        {!hasRateCard && (
          <DrawerAction
            title="Become a Connector"
            subtitle={`$${REWARDS.perFriendConnector} cash + free services + GPI`}
            onClick={() => { closeDrawer(); setShowConnectorInfo(true); }}
          />
        )}
        <DrawerAction
          title="How earnings work"
          subtitle="The 4-step story — cash, trust, barter, growth"
          onClick={() => nav('/earnings/how')}
        />
      </ActionDrawer>

      {/* ── Drawer: Connector ───────────────────────────────────────────── */}
      <ActionDrawer
        open={openDrawer === 'connector'}
        title="Connector"
        onClose={closeDrawer}
      >
        <DrawerAction
          title="What's a Connector?"
          subtitle="Influencers · super-users · providers · small biz"
          onClick={() => { closeDrawer(); setShowConnectorInfo(true); }}
        />
        <DrawerAction
          title={hasRateCard ? 'Edit spotlight rate card' : 'Set spotlight rate card'}
          subtitle={hasRateCard
            ? 'Update what you charge per IG / TikTok spotlight'
            : 'Services book you for spotlights — set your rate'}
          pill={hasRateCard ? <MintPill>Set</MintPill> : null}
          onClick={() => nav('/rainmaker/apply/instagram')}
        />
        <DrawerAction
          title="Spotlight requests"
          subtitle="Inbound + sent spotlight asks"
          onClick={() => nav('/connectors/requests')}
        />
        {ig?.instagram_handle ? (
          <DrawerAction
            title={`Instagram · @${ig.instagram_handle}`}
            subtitle={
              ig.instagram_followers != null
                ? `${fmtFollowers(ig.instagram_followers)} followers · helps Connectors tag you`
                : 'Add follower count for better matches'
            }
            pill={ig.instagram_verified_at ? <MintPill>✓ Verified</MintPill> : null}
            onClick={() => { closeDrawer(); setShowIgModal(true); }}
          />
        ) : (
          <DrawerAction
            title="Connect Instagram"
            subtitle="Required for Connectors · boosts trust for providers"
            onClick={() => { closeDrawer(); setShowIgModal(true); }}
          />
        )}
        {tt?.tiktok_handle ? (
          <DrawerAction
            title={`TikTok · @${tt.tiktok_handle}`}
            subtitle={
              tt.tiktok_followers != null
                ? `${fmtFollowers(tt.tiktok_followers)} audience · boosts your spotlight reach`
                : 'Add audience size for better matches'
            }
            pill={tt.tiktok_verified_at ? <MintPill>✓ Verified</MintPill> : null}
            onClick={() => { closeDrawer(); setShowTtModal(true); }}
          />
        ) : (
          <DrawerAction
            title="Connect TikTok"
            subtitle="Add your handle + audience size"
            onClick={() => { closeDrawer(); setShowTtModal(true); }}
          />
        )}
      </ActionDrawer>

      {/* ── Drawer: Services (provider) ─────────────────────────────────── */}
      <ActionDrawer
        open={openDrawer === 'services'}
        title="Services"
        onClose={closeDrawer}
      >
        <DrawerAction
          title="List a new service"
          subtitle={listGated
            ? (provider.hasAccount ? 'Stripe verifying…' : 'Offer your service on Cergio')
            : 'Offer your service on Cergio'}
          onClick={onListService}
        />
        <DrawerAction
          title="Manage services"
          subtitle="Edit listings, photos, and pricing"
          pill={serviceCount > 0 ? <MintPill tone="neutral">{serviceCount} live</MintPill> : null}
          onClick={() => nav('/services/manage')}
        />
        {!provider.ready && (
          <DrawerAction
            title="Set up payouts"
            subtitle="Connect a bank account via Stripe so we can pay you"
            pill={<MintPill tone="amber">Needed</MintPill>}
            onClick={() => { closeDrawer(); openStripe(); }}
          />
        )}
      </ActionDrawer>

      {/* ── Drawer: Account & settings ──────────────────────────────────── */}
      <ActionDrawer
        open={openDrawer === 'account'}
        title="Account & settings"
        onClose={closeDrawer}
      >
        <DrawerAction
          title="Edit profile"
          subtitle="Update your name and phone"
          onClick={() => { closeDrawer(); setShowEditProfile(true); }}
        />
        <DrawerAction
          title="Payment settings"
          subtitle={provider.hasAccount
            ? 'Manage your Stripe payouts'
            : 'Set up payouts to receive bookings'}
          onClick={() => {
            closeDrawer();
            if (provider.hasAccount) openStripe();
            else navigate('/list-service');
          }}
        />
        <DrawerAction
          title="Privacy"
          subtitle="How we protect your data"
          onClick={() => nav('/privacy')}
        />
        <DrawerAction
          title="Delete my data"
          subtitle="Request deletion of your account + history"
          onClick={() => nav('/data-deletion')}
        />
      </ActionDrawer>

      {/* ── Modals (preserved from v2) ──────────────────────────────────── */}
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
      {showEditProfile && (
        <EditProfileModal
          user={auth?.user}
          onClose={() => setShowEditProfile(false)}
          onSaved={() => showToast('Profile updated ✓')}
        />
      )}

      {/* "What's a Connector?" — full explainer, preserved from v2 */}
      {showConnectorInfo && (
        <div
          className="fixed inset-0 z-[80] bg-black/40 flex items-end justify-center"
          onClick={() => setShowConnectorInfo(false)}
        >
          <div
            className="w-full max-w-[390px] bg-cream rounded-t-[24px] p-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-[18px] font-extrabold text-black leading-tight">
                What's a Connector?
              </h3>
              <button
                onClick={() => setShowConnectorInfo(false)}
                className="text-[20px] text-b3 font-bold px-2 -mt-1"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="text-[13px] text-b2 leading-relaxed mb-3">
              A Connector is someone who can drive real users to great services in
              their community. It's broader than "influencer" — these are the
              kinds of people who become Connectors:
            </p>
            <ul className="text-[13px] text-b2 leading-relaxed mb-3 space-y-1.5 pl-1">
              <li>• <span className="font-bold text-black">Local influencers</span> (5K+ on IG/TikTok)</li>
              <li>• <span className="font-bold text-black">Super users</span> — {REWARDS.superUserFriendsPerMonth}+ friends booking per month, social graph compounding</li>
              <li>• <span className="font-bold text-black">Service providers</span> with a base of existing clients</li>
              <li>• <span className="font-bold text-black">Small businesses</span> — stores, salons, gyms, real-estate agents</li>
            </ul>
            <p className="text-[13px] text-b2 leading-relaxed mb-3">
              The thing in common: a network you can drive toward services worth
              booking. You become a partner in the marketplace — you grow it, it
              grows you.
            </p>
            <div className="bg-gl border border-g/25 rounded-[14px] p-3 mb-4">
              <p className="text-[12px] font-bold text-gd leading-snug mb-1.5">As a Connector you earn:</p>
              <ul className="text-[12px] text-gd/90 leading-snug space-y-1">
                <li>• ${REWARDS.perFriendConnector} <span className="font-bold">cash</span> per friend who joins + books</li>
                <li>• <span className="font-bold">{REWARDS.friendOfFriendPercent}% = ${REWARDS.friendOfFriendBonus}</span> when your friends bring in friends</li>
                <li>• Free services from providers who pay you in spotlights</li>
                <li>• Growth Participation Income — your earnings drive a bigger bonus as Cergio grows</li>
              </ul>
            </div>
            <p className="text-[12px] text-b3 leading-snug mb-4 italic">
              {REWARD_COPY.missionLine}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowConnectorInfo(false); navigate('/rainmaker/apply'); }}
                className="flex-1 bg-g text-white rounded-[14px] py-3 text-[14px] font-extrabold
                           hover:opacity-90 active:scale-[.98] transition-all"
              >
                I want in →
              </button>
              <button
                onClick={() => setShowConnectorInfo(false)}
                className="bg-white border border-bdr text-b3 rounded-[14px] px-4 py-3
                           text-[13px] font-bold hover:text-b2 transition-colors"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
