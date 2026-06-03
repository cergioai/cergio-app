// Per design-spec.md — Earnings tab: balance, network feed, invite cards.
// All hardcoded mock numbers stripped; filter pills removed; copy uses
// REWARDS canonical $250-per-friend across every CTA.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { getMyEarnings, listMyServices } from '../lib/api';
import { fmtDollars } from '../lib/fees';
import { REWARDS } from '../lib/rewards';

function timeAgo(iso) {
  if (!iso) return '';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60)   return 'just now';
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  return `${Math.floor(sec/86400)}d ago`;
}

const BALANCE_UNIT = 'USD';
const CASH_OUT_THRESHOLD_CENTS = 250 * 100; // $250 to cash out (matches reward ceiling)

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

// CERGIO-GUARD (2026-05-29): earnings.kind classification — used for
// the Referrals vs Client bookings tab split. Service providers earn
// from BOTH streams; consumers + Connectors only ever see referrals.
//   - 'invite'    → referral bonus when invited friend completes first booking
//   - 'spotlight' → Connector paid spotlight on IG/TikTok
//   - 'booking'   → revenue from the user's OWN service being booked
// Referrals tab = invite + spotlight (anything earned by promoting).
// Client bookings tab = booking (anything earned by providing service).
const REFERRAL_KINDS  = new Set(['invite', 'spotlight']);
const BOOKING_KINDS   = new Set(['booking']);
function isReferralKind(k) { return REFERRAL_KINDS.has(k); }
function isBookingKind(k)  { return BOOKING_KINDS.has(k); }

// CERGIO-GUARD (2026-05-29): tier classification for referral earnings.
// 'direct'  — you invited the friend who booked (full $250-track payout)
// 'chain'   — friend-of-friend bonus (+5%, $12.50 per chain extension)
// Prefer the meta.tier field if the stripe-webhook writes it; fall back
// to amount-based heuristic (FoF bonuses are always $50 or less). This
// is what powers the per-row tier pill on the Referrals tab. Returns
// null for non-referral rows (spotlight payouts + bookings render plain).
function earningTier(e) {
  if (e.kind !== 'invite') return null;
  if (e.meta?.tier === 'fof' || e.meta?.tier === 'friend_of_friend') return 'chain';
  if (e.meta?.tier === 'direct') return 'direct';
  const cents = e.amount_cents || 0;
  return cents <= 5000 ? 'chain' : 'direct';
}

export function EarningsScreen() {
  const navigate = useNavigate();
  const { showToast, auth, serviceMode } = useOutletContext();
  const [showGrowthInfo, setShowGrowthInfo] = useState(false);

  // Real earnings from the ledger (bookings + spotlights). No filter pills
  // — single chronological list keeps things simple when there's nothing
  // to filter yet (and even when there is).
  const [earnings, setEarnings] = useState([]);
  // CERGIO-GUARD (2026-05-29): tab state for Referrals vs Client bookings.
  // Default tab is 'bookings' for providers (their main revenue line),
  // 'referrals' otherwise. We compute the default once after the provider
  // probe lands, so the screen doesn't flip tabs mid-render.
  const [activeTab, setActiveTab] = useState('referrals');
  const [tabSetByUser, setTabSetByUser] = useState(false);
  // Provider check — if signed in user has at least one listed service,
  // OR they're toggled into service view, we show provider-flavored
  // benefit copy. Consumers see the friend-referral angle instead.
  const [hasService, setHasService] = useState(false);
  // CERGIO-GUARD (2026-05-28): real counters for the empty state.
  // friends-invited = invites where inviter_id = me
  // recs-sent       = recommendations where recommender_id = me
  // Read on mount + when auth changes. Both fall back to 0 on RLS /
  // schema issues so the UI stays honest, never lies with mock counts.
  const [invitesCount, setInvitesCount] = useState(0);
  const [recsCount,    setRecsCount]    = useState(0);
  useEffect(() => {
    if (!auth?.isSignedIn) {
      setEarnings([]); setHasService(false);
      setInvitesCount(0); setRecsCount(0);
      return;
    }
    getMyEarnings({ limit: 50 }).then(({ data }) => setEarnings(data || []));
    listMyServices().then(({ data }) => setHasService((data || []).length > 0));
    // Pull real counts — head:true so we don't pay for row payload.
    import('../lib/supabase').then(async ({ supabase, supabaseReady }) => {
      if (!supabaseReady) return;
      const uid = auth.user.id;
      const [inv, rec] = await Promise.all([
        supabase.from('invites').select('id', { count: 'exact', head: true }).eq('inviter_id', uid),
        supabase.from('recommendations').select('id', { count: 'exact', head: true }).eq('recommender_id', uid),
      ]);
      setInvitesCount(inv.error ? 0 : (inv.count || 0));
      setRecsCount(rec.error ? 0 : (rec.count || 0));
    });
  }, [auth?.isSignedIn]);
  const isProvider = serviceMode || hasService;
  // CERGIO-GUARD: once we know they're a provider, default the tab to
  // 'bookings' (their primary income source) unless the user has already
  // explicitly tapped a tab. This avoids fighting their selection.
  useEffect(() => {
    if (!tabSetByUser && isProvider) setActiveTab('bookings');
  }, [isProvider, tabSetByUser]);
  const totals = earnings.reduce((acc, e) => {
    if (e.status !== 'cleared') return acc;
    acc.all       += e.amount_cents;
    acc[e.kind]   = (acc[e.kind] || 0) + e.amount_cents;
    if (isReferralKind(e.kind)) acc.referrals += e.amount_cents;
    if (isBookingKind(e.kind))  acc.bookings  += e.amount_cents;
    return acc;
  }, { all: 0, referrals: 0, bookings: 0 });
  const balanceCents = totals.all;
  const balanceStr   = fmtDollars(balanceCents);
  const canCashOut   = balanceCents >= CASH_OUT_THRESHOLD_CENTS;

  // Filtered ledger per active tab.
  const referralRows = earnings.filter(e => isReferralKind(e.kind));
  const bookingRows  = earnings.filter(e => isBookingKind(e.kind));
  const visibleRows  = activeTab === 'bookings' ? bookingRows : referralRows;
  const visibleTotal = activeTab === 'bookings' ? totals.bookings : totals.referrals;

  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      {/* Page title aligns with Profile canon: 30px / 800 / leading-tight,
          generous top padding to match the rhythm Profile sets. */}
      <h1 className="px-5 pt-10 pb-4 text-[30px] font-extrabold text-black leading-tight">Earnings</h1>

      {/* hero balance card — kelly-green gradient outer, white inner.
          Balance = real summed cleared earnings (booking + spotlight). */}
      <div className="mx-5 rounded-[20px] bg-gradient-to-br from-gm to-g p-3 mb-5 shadow-card">
        <div className="bg-white rounded-[14px] p-4 flex items-center justify-between">
          <div>
            <p className="text-[28px] font-extrabold text-black leading-none">
              {balanceStr}<span className="text-[14px] text-b3 font-bold ml-1">{BALANCE_UNIT}</span>
            </p>
            {!canCashOut && balanceCents > 0 && (
              <p className="text-[11px] text-b3 mt-1">
                ${(CASH_OUT_THRESHOLD_CENTS - balanceCents) / 100} more to cash out
              </p>
            )}
          </div>
          <button
            onClick={() => navigate('/earnings/breakdown')}
            className="w-12 h-12 rounded-full bg-g flex items-center justify-center"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
          </button>
        </div>
        {canCashOut ? (
          // CERGIO-GUARD: Stripe Connect payout endpoint isn't wired
          // yet (it's a real product gap, see ROADMAP.md → "Provider
          // payouts via Stripe Connect"). Until it ships, we do a
          // REAL action — open the user's mail client with a
          // pre-filled cash-out request to support@cergio.ai AND
          // copy the support email to the clipboard so the user
          // still has a path if their browser has no mailto handler
          // (reviewer wave 3 flag).
          <a
            href={`mailto:support@cergio.ai?subject=${encodeURIComponent('Cash out request — Cergio')}&body=${encodeURIComponent(`Hi — I'd like to cash out my Cergio balance of $${(balanceCents/100).toFixed(2)}.\n\nMy account: ${auth?.user?.email || '(email)'}\nUser ID: ${auth?.user?.id || ''}\n\nThanks!`)}`}
            onClick={() => {
              try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText('support@cergio.ai');
                }
                showToast('Opening cash-out request — support email copied as a backup');
              } catch {
                showToast('Opening cash-out request — email: support@cergio.ai');
              }
            }}
            className="w-full bg-white rounded-[14px] py-3.5 mt-2 text-[15px] font-extrabold text-black text-center block"
          >
            Cash out
          </a>
        ) : (
          <button
            onClick={() => navigate('/earnings/breakdown')}
            className="w-full bg-white rounded-[14px] py-3 mt-2 flex items-center justify-between px-4
                       text-[14px] font-extrabold text-black"
          >
            See Earnings Breakdown
            <span className="text-b3 text-base">›</span>
          </button>
        )}
        {canCashOut && (
          <p className="text-center text-[12px] text-white font-medium mt-3 px-2">
            You're eligible to cash out — your balance is over ${REWARDS.perFriend}.
          </p>
        )}
      </div>

      {/* ── Real earnings ledger ─────────────────────────────────────────
          CERGIO-GUARD (2026-05-29): split into two tabs.
            Referrals      = kind in (invite, spotlight) — promoted income
            Client bookings = kind = booking            — own-service income
          Service providers default to "Client bookings" (their primary
          income line); consumers and Connectors default to "Referrals".
          The tab user explicitly tapped wins after the first tap.
          For providers with both streams, the totals in the tab header
          let them see at a glance which line is performing. */}
      {earnings.length > 0 ? (
        <>
          {/* Tabs */}
          <div className="mx-5 mb-3 flex bg-bg5 rounded-pill p-1">
            <button
              data-tab="referrals"
              onClick={() => { setActiveTab('referrals'); setTabSetByUser(true); }}
              className={`flex-1 rounded-pill py-2 text-[13px] font-extrabold transition-colors
                          ${activeTab === 'referrals' ? 'bg-white text-black shadow-sm' : 'text-b3'}`}
            >
              Referrals
              <span className="ml-1.5 text-[11px] font-bold opacity-70">
                {fmtDollars(totals.referrals)}
              </span>
            </button>
            <button
              data-tab="bookings"
              onClick={() => { setActiveTab('bookings'); setTabSetByUser(true); }}
              className={`flex-1 rounded-pill py-2 text-[13px] font-extrabold transition-colors
                          ${activeTab === 'bookings' ? 'bg-white text-black shadow-sm' : 'text-b3'}`}
            >
              Client bookings
              <span className="ml-1.5 text-[11px] font-bold opacity-70">
                {fmtDollars(totals.bookings)}
              </span>
            </button>
          </div>

          {visibleRows.length > 0 ? (
            <>
              <div className="flex items-center justify-between px-5 mb-2">
                <p className="text-[14px] font-extrabold uppercase tracking-widest text-b3">
                  {activeTab === 'bookings' ? 'Service bookings' : 'Referrals & spotlights'}
                </p>
                <p className="text-[14px] font-extrabold text-g">{fmtDollars(visibleTotal)}</p>
              </div>
              <div className="px-5 flex flex-col gap-2 mb-6">
                {visibleRows.map(e => (
                  <div key={e.id} className="bg-white border border-bdr rounded-[14px] p-3.5 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0
                                      ${e.kind === 'spotlight' ? 'bg-gl text-gd'
                                       : e.kind === 'booking'  ? 'bg-card text-gd border border-g/30'
                                       : 'bg-bg5 text-b2'}`}>
                      {e.kind === 'spotlight' ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                      ) : e.kind === 'booking' ? (
                        // House icon — own-service booking
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z" />
                        </svg>
                      ) : (
                        // Invite icon — friend payout
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-[14px] font-extrabold text-black leading-tight">
                          {e.kind === 'spotlight'
                            ? `${(e.meta?.platform === 'tiktok' ? 'TikTok' : 'Instagram')} spotlight`
                            : e.kind === 'booking'
                            ? 'Service booking'
                            : 'Friend referral'}
                        </p>
                        {/* CERGIO-GUARD: degree-of-separation pill so users
                            see which payouts are direct ($250-track) vs
                            friend-of-friend chain bonus ($12.50). */}
                        {(() => {
                          const tier = earningTier(e);
                          if (!tier) return null;
                          return (
                            <span className={`text-[9.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-pill
                              ${tier === 'direct' ? 'bg-gl text-gd' : 'bg-warnBg text-warnText'}`}>
                              {tier === 'direct' ? 'Direct' : 'Chain +5%'}
                            </span>
                          );
                        })()}
                      </div>
                      <p className="text-[11px] text-b3 mt-0.5">
                        {timeAgo(e.created_at)} · {e.status === 'cleared' ? 'cleared' : e.status}
                      </p>
                    </div>
                    <span className="text-[15px] font-extrabold text-black">
                      +{fmtDollars(e.amount_cents)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            // Tab has no rows yet — show a tiny tab-aware empty state.
            <div className="mx-5 mb-6 bg-white border border-bdr rounded-[14px] p-4 text-center">
              <p className="text-[13px] text-b3 leading-snug">
                {activeTab === 'bookings'
                  ? <>No service bookings yet. <button onClick={() => navigate('/list-service')} className="text-gd font-bold underline">List a service</button> to start earning from your own work.</>
                  : <>No referral earnings yet. <button onClick={() => navigate('/invite/friends-popup')} className="text-gd font-bold underline">Invite a friend</button> to start earning ${REWARDS.perFriend}/friend.</>}
              </p>
            </div>
          )}
        </>
      ) : (
        // Empty state — counters + benefit summary. Copy adapts to
        // whether the user is on the consumer or provider side, mirroring
        // the Home invite house ad. CERGIO-GUARD: don't reintroduce
        // hardcoded mock totals here — counts come from earnings (real).
        <div className="mx-5 mb-6 bg-white border border-bdr rounded-[18px] p-4">
          {/* Real counters — live from invites + recommendations tables.
              CERGIO-GUARD (2026-05-28): NEVER hardcode "0" here. The
              counts must reflect actual rows the user authored. qa #27
              statically enforces these counts come from real tables. */}
          <div className="flex items-center gap-4 mb-3">
            <div className="flex-1">
              <p className="text-[18px] font-extrabold text-black leading-none">{invitesCount}</p>
              <p className="text-[11px] text-b3 mt-0.5 leading-snug">friends invited</p>
            </div>
            <div className="flex-1">
              <p className="text-[18px] font-extrabold text-black leading-none">{recsCount}</p>
              <p className="text-[11px] text-b3 mt-0.5 leading-snug">services reco'd</p>
            </div>
            <div className="flex-1">
              <p className="text-[18px] font-extrabold text-black leading-none">{balanceStr}</p>
              <p className="text-[11px] text-b3 mt-0.5 leading-snug">earned</p>
            </div>
          </div>

          {/* CERGIO-GUARD (2026-05-28): de-cluttered per user audit.
              The two stat rows (top 3 + bottom 3) overlapped (both
              had "earned" + "invited"). Collapsed to one row: invites
              count + recs count + earned, with Invite + Reco buttons
              inline on the right. The lower duplicate row was removed. */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <p className="text-[16px] font-extrabold text-black leading-none">{recsCount}</p>
              <p className="text-[10px] text-b3 mt-0.5 leading-snug uppercase tracking-wide">
                Recs sent
              </p>
            </div>
            <button
              onClick={() => navigate('/find-friends')}
              className="bg-g text-white rounded-pill px-3 py-1.5 text-[11px] font-bold whitespace-nowrap"
            >
              Invite
            </button>
            <button
              onClick={() => navigate('/invite/recommend')}
              className="bg-white border border-bdr rounded-pill px-3 py-1.5 text-[11px] font-bold text-b2 whitespace-nowrap"
            >
              Reco
            </button>
          </div>

          {/* Mode-tailored one-liner — provider vs consumer is genuinely
              different audiences. CERGIO-GUARD: do NOT use 'invite
              clients' copy in consumer mode and vice versa. Pull from
              REWARD_COPY so this stays in sync with the Connector page. */}
          <p className="text-[12px] text-b3 leading-snug">
            {isProvider
              ? <>Turn your client list into your referral network. Every client who joins + books earns you <span className="font-bold text-black">${REWARDS.perFriendConnector} cash</span> + Growth Participation Income.{' '}
                  <button type="button" onClick={() => setShowGrowthInfo(true)} className="text-gd underline underline-offset-2 font-bold">ⓘ</button>
                </>
              : <>Help friends, earn <span className="font-bold text-black">${REWARDS.perFriendUser} credit</span> per friend who joins + books + free services + Growth Participation Income.{' '}
                  <button type="button" onClick={() => setShowGrowthInfo(true)} className="text-gd underline underline-offset-2 font-bold">ⓘ</button>
                </>}
          </p>
          {/* Friend-of-friend kicker — a calm extra line, not a card. */}
          <p className="text-[11px] text-b3 mt-1.5 leading-snug">
            <span className="font-bold text-black">+{REWARDS.friendOfFriendPercent}%</span> when your friends invite their friends — <span className="font-bold text-black">${REWARDS.friendOfFriendBonus}</span> per second-tier signup.
          </p>

          {/* Connector upsell — visible to users (not providers, who are
              already on the cash track). One-liner that mirrors the
              Connector page hero. */}
          {!isProvider && (
            <button
              type="button"
              onClick={() => navigate('/rainmaker/apply')}
              className="mt-3 w-full bg-gl border border-g/25 rounded-[12px] px-3 py-2.5 flex items-center justify-between
                         text-left hover:bg-gl/80 active:scale-[.99] transition-all"
            >
              <span className="text-[12px] font-extrabold text-gd leading-snug">
                Become a Connector → earn ${REWARDS.perFriendConnector} <span className="font-bold">cash</span> instead of credit
              </span>
              <span className="text-gd text-base flex-shrink-0">›</span>
            </button>
          )}
        </div>
      )}

      {/* "How earnings work" link — replaces the old action-card stack
          + earnings benefit list. Action buttons (Invite / Reco) now
          live inline next to the counters above. Growth Participation
          Income is also there with its ⓘ; no need to repeat the long
          block here. */}
      <div className="px-5 mb-4">
        <button
          onClick={() => navigate('/earnings/how')}
          className="w-full bg-soft rounded-[14px] py-3 px-4 flex items-center justify-between
                     text-left hover:bg-bg5 transition-colors"
        >
          <span className="text-[13px] font-extrabold text-black">How earnings work</span>
          <span className="text-b3 text-base">›</span>
        </button>
      </div>

      {/* Popup explainer — airmiles analogy + IPO contingency + mission. */}
      {showGrowthInfo && (
        <div
          className="fixed inset-0 z-[80] bg-black/40 flex items-end justify-center"
          onClick={() => setShowGrowthInfo(false)}
        >
          <div
            className="w-full max-w-[390px] bg-cream rounded-t-[24px] p-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-[18px] font-extrabold text-black leading-tight">
                Growth Participation Income
              </h3>
              <button
                onClick={() => setShowGrowthInfo(false)}
                className="text-[20px] text-b3 font-bold px-2 -mt-1"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="text-[13px] text-b2 leading-relaxed mb-3">
              Like airmiles — but tied to Cergio's growth instead of flights.
              The more you make on Cergio, the higher your participation score, the bigger your bonus.
            </p>
            <p className="text-[13px] text-b2 leading-relaxed mb-3">
              <span className="font-bold">How it works:</span> every dollar of cash income you earn
              also accrues a Growth Participation Score. We track it from day one.
            </p>
            <p className="text-[13px] text-b2 leading-relaxed mb-3">
              <span className="font-bold">When it activates:</span> if Cergio goes public (IPO).
              IPO isn't guaranteed — community participation in our growth helps accelerate it.
            </p>
            <div className="bg-gl border border-g/25 rounded-[14px] p-3 mt-4">
              <p className="text-[12px] text-gd font-extrabold leading-snug">
                Cergio's mission
              </p>
              <p className="text-[12px] text-gd/85 mt-1 leading-snug font-normal">
                Build friend-powered AI so we all prosper together. Your bonus is directly
                tied to your participation in that growth.
              </p>
            </div>
            <p className="text-[10px] text-b3 mt-4 leading-relaxed">
              Growth Participation Income is a loyalty-style bonus, not a security.
              No guaranteed payout. Final terms set at activation.
            </p>
            <button
              onClick={() => setShowGrowthInfo(false)}
              className="w-full mt-5 bg-g text-white rounded-[14px] py-3 text-[14px] font-extrabold"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ActionCard + ICONS helpers removed — replaced by the inline Invite
// + Reco buttons next to the counter row + the "How earnings work"
// link. Less surface, clearer signal.
