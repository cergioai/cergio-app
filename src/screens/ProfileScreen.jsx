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
import { getStripeOnboardingUrl, getMyInstagram, saveInstagram, getMyTikTok, saveTikTok, getMySpotlightPrices, listMyServices } from '../lib/api';
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

// Row pattern — sized down per Tarik's audit (title 18→16, subtitle 15→13).
// Rows are dense + numerous on this screen; smaller type makes the section
// hierarchy breathe.
// CERGIO-GUARD (2026-05-28): row typography tightened per user audit.
// Title 16 → 14, subtitle 13 → 11, slightly more vertical padding so the
// row breathes despite smaller text. Goal: match the design-spec.md
// reference of dense-but-readable settings rows.
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
          <span className="text-[14px] font-bold text-black leading-tight">{title}</span>
          {pill && pill}
        </div>
        {subtitle && (
          <p className="text-[11px] text-b3 mt-1 leading-snug font-medium">{subtitle}</p>
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

// Section header — sized down per Tarik's audit (was 26, now 20). Still
// reads as a major divider thanks to the generous mt-8 vertical rhythm.
function SectionHeader({ title }) {
  return (
    <h2 className="px-5 text-[20px] font-extrabold text-black mt-8 mb-1 leading-tight">{title}</h2>
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
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [spotlightPrices, setSpotlightPrices] = useState(null);
  // CERGIO-GUARD (2026-05-28): "What's a Connector?" popup. The
  // Connector concept is broader than "influencer" — it covers super
  // users, service providers, small biz, anyone with a local network.
  // We explain it before sending the user into the apply flow so they
  // know whether it's for them.
  const [showConnectorInfo, setShowConnectorInfo] = useState(false);
  // hasService — true if the signed-in user has at least one listed
  // service. Drives whether to render the "Services" section, which
  // is noise for consumer-only users (most of the audience).
  const [hasService, setHasService] = useState(false);
  useEffect(() => {
    if (!isSignedIn) { setIg(null); setTt(null); setSpotlightPrices(null); setHasService(false); return; }
    getMyInstagram().then(({ data }) => setIg(data || null));
    getMyTikTok().then(({ data }) => setTt(data || null));
    getMySpotlightPrices().then(({ data }) => setSpotlightPrices(data || null));
    listMyServices().then(({ data }) => setHasService((data || []).length > 0));
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
  // CERGIO-GUARD: list-service navigation is NEVER blocked by Stripe
  // state. Publishing a listing is decoupled from payouts; Stripe
  // verification completes asynchronously and the listing stays live.
  const onListService = () => {
    if (listGated) {
      showToast(provider.hasAccount
        ? 'Payouts pending Stripe verification — your listing will still publish.'
        : 'Heads up: set up payouts later in Profile → Service view.');
    }
    navigate('/list-service');
  };

  // Inline pills used inside row titles. Spec puts badges at 11-12px so they
  // sit next to the 18px row title without competing for visual weight.
  const MintPill = ({ children }) => (
    <span className="bg-gl text-gd rounded-pill px-2.5 py-0.5 text-[12px] font-extrabold whitespace-nowrap">
      {children}
    </span>
  );

  // Greeting first name only.
  const firstName = displayName.split(/[\s@.]/)[0];

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-24">
      {/* ── Top: greeting + avatar (greeting 30→24 per audit) ──────────────── */}
      <div className="px-5 pt-8 pb-2 flex items-start justify-between gap-4">
        <h1 className="text-[24px] font-extrabold text-black leading-tight">
          Hi {firstName}!
        </h1>
        <div className="w-12 h-12 rounded-full bg-bg5 flex items-center justify-center text-black text-[16px] font-extrabold flex-shrink-0 overflow-hidden">
          {initials}
        </div>
      </div>

      {/* ── Switch view CTA — MOVED to the top per audit, right under the
          greeting and above Account. The primary action on this screen
          should be the most visible. ─────────────────────────────────── */}
      <div className="px-5 mt-3 mb-2">
        <button
          onClick={() => {
            setServiceMode(!serviceMode);
            showToast(serviceMode ? 'Back to user view' : 'You\'re now in Service view');
          }}
          className="w-full bg-g text-white rounded-[24px] py-3.5 text-[16px] font-extrabold
                     hover:opacity-90 active:scale-[.98] transition-all"
        >
          {serviceMode ? 'Switch to User View' : 'Switch to Service View'}
        </button>
      </div>

      {/* ── Account ──────────────────────────────────────────────────────────
          Edit profile NOW opens a real modal (name + phone — the only fields
          stored in auth user_metadata). The "coming soon" stubs that
          frustrated the user are gone. */}
      <SectionHeader title="Account" />
      <Row
        title="View and edit profile"
        subtitle="Update your name and phone"
        onClick={() => setShowEditProfile(true)}
      />
      <Row
        title="Payment settings"
        subtitle={provider.hasAccount ? 'Manage your Stripe payouts' : 'Set up payouts to receive bookings'}
        onClick={() => {
          if (provider.hasAccount) {
            showToast('Opening Stripe…');
            getStripeOnboardingUrl().then(({ data }) => {
              if (data?.url) window.location.href = data.url;
              else showToast('Stripe onboarding link unavailable');
            });
          } else {
            navigate('/list-service');
          }
        }}
      />

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

      {/* ── Services — provider-only.
          CERGIO-GUARD (2026-05-28): consumers don't need to see "List
          a service" or "Manage services" — those are noise for the
          80%+ user audience. Show ONLY when the user is in service
          mode OR has at least one listed service. The "Switch to
          provider mode" button at the top of the screen is the path
          in if they ever want to flip. */}
      {(serviceMode || hasService) && (
        <>
          <SectionHeader title="Services" />
          <Row
            title="List a new service"
            subtitle={listGated
              ? (provider.hasAccount ? 'Stripe verifying…' : 'Needs payouts setup first')
              : 'Offer your service on Cergio'}
            onClick={onListService}
          />
          <Row
            title="Manage services"
            subtitle="Edit listings, photos, and pricing"
            onClick={() => navigate('/services/manage')}
          />
          {!provider.ready && <SetupPayoutsRow showToast={showToast} />}
        </>
      )}

      {/* ── Earn $250+ ───────────────────────────────────────────────────────
          CERGIO-GUARD (2026-05-28): collapsed from 5 rows → 3. The
          "Invite friends" + "Recommend a service" + "Find friends on
          Cergio" all already converge to /invite/friends-popup (which
          has Invite + Reco buttons inline), so one "Invite & earn"
          row replaces all three. Earnings stays its own row because
          it's high-frequency. Connector entry stays separate so the
          cash-track upgrade is one tap away. */}
      <SectionHeader title={`Earn $${REWARDS.perFriend}+`} />
      <Row
        title="My earnings"
        subtitle="Balance, breakdown, and how it works"
        pill={<MintPill>$0 USD</MintPill>}
        onClick={() => navigate('/earnings')}
      />
      {!hasRateCard && (
        <Row
          title="Become a Connector"
          subtitle={`$${REWARDS.perFriendConnector} cash + free services + Growth Participation Income`}
          onClick={() => setShowConnectorInfo(true)}
        />
      )}
      <Row
        title="Invite & earn"
        subtitle={`$${REWARDS.perFriendUser} credit per friend who joins + books`}
        onClick={() => navigate('/invite/friends-popup')}
      />

      {/* ── About ──────────────────────────────────────────────────────────── */}
      <SectionHeader title="About" />
      <Row
        title="Privacy"
        subtitle="How we protect your data"
        onClick={() => navigate('/privacy')}
      />
      <Row
        title="Delete my data"
        subtitle="Request deletion of your account + history"
        onClick={() => navigate('/data-deletion')}
      />

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
        className="text-center text-[14px] font-bold text-b3 py-3 mx-auto underline underline-offset-2"
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
      {showEditProfile && (
        <EditProfileModal
          user={auth?.user}
          onClose={() => setShowEditProfile(false)}
          onSaved={() => showToast('Profile updated ✓')}
        />
      )}

      {/* "What's a Connector?" — bottom sheet explainer.
          CERGIO-GUARD (2026-05-28): the Connector role is broader than
          influencer — covers super users, service providers, small biz,
          anyone with a strong local network. Explain that BEFORE the
          apply flow so people self-select correctly. Mirrors the Growth
          Participation Income popup pattern on EarningsScreen. */}
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
              <li>• <span className="font-bold text-black">Super users</span> — people whose friends actually listen when they recommend something</li>
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
