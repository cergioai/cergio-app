// Per design-spec.md — Earnings tab: balance, network feed, invite cards.
// All hardcoded mock numbers stripped; filter pills removed; copy uses
// REWARDS canonical $250-per-friend across every CTA.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { getMyEarnings, listMyServices, getMyInviteCounts } from '../lib/api';
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
// CERGIO-GUARD (2026-06-05): pulled from REWARDS so the cash-out
// threshold tracks the canonical per-friend cap. Previously a raw
// `250 * 100` literal — Tarik's hardcoded-number sweep.
const CASH_OUT_THRESHOLD_CENTS = REWARDS.perFriend * 100;

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
  // CERGIO-GUARD (2026-06-04): listed-services count for the top
  // counts strip — Tarik: "show counts all services reco'd invited
  // friends..joined etc.. should lead to invite reco more.. and
  // friends tracking naturally."
  const [servicesCount, setServicesCount] = useState(0);
  // CERGIO-GUARD (2026-06-04): full invite funnel — Invited / Joined /
  // Booked. Replaces the bare invitesCount on the summary block.
  const [inviteCounts, setInviteCounts] = useState({ invited: 0, joined: 0, booked: 0 });
  useEffect(() => {
    if (!auth?.isSignedIn) {
      setEarnings([]); setHasService(false);
      setInvitesCount(0); setRecsCount(0);
      setInviteCounts({ invited: 0, joined: 0, booked: 0 });
      return;
    }
    getMyEarnings({ limit: 50 }).then(({ data }) => setEarnings(data || []));
    listMyServices().then(({ data }) => {
      const rows = data || [];
      setHasService(rows.length > 0);
      setServicesCount(rows.length);
    });
    getMyInviteCounts().then(({ data }) => setInviteCounts(data || { invited: 0, joined: 0, booked: 0 }));
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
  // (qa.mjs invariant #33 locks this exact line.)
  useEffect(() => {
    if (!tabSetByUser && isProvider) setActiveTab('bookings');
  }, [isProvider, tabSetByUser]);
  // CERGIO-GUARD (2026-06-03): smart override. When the provider's
  // bookings tab would be EMPTY but referrals has rows, flip the
  // default to referrals so they see their $X payout breakdown
  // immediately. Tarik 2026-06-03: "can't see Earnings $588 USD."
  // Runs after earnings load. Still respects an explicit user tap.
  const _bookingRowCount  = earnings.filter(e => isBookingKind(e.kind)).length;
  const _referralRowCount = earnings.filter(e => isReferralKind(e.kind)).length;
  useEffect(() => {
    if (tabSetByUser) return;
    if (isProvider && _bookingRowCount === 0 && _referralRowCount > 0) {
      setActiveTab('referrals');
    }
  }, [isProvider, tabSetByUser, _bookingRowCount, _referralRowCount]);
  // CERGIO-GUARD (2026-06-05 v5): compute rowCapState BEFORE totals so
  // hero balance reflects EFFECTIVE credit (post-cap) for referral
  // rows, not raw ledger. Tarik: the activity tape IS the balance.
  // Pre-compute a referralRowCaps map keyed by row id → effectiveCents.
  const referralRowsAll = earnings.filter(e => isReferralKind(e.kind));
  const perFriendCapCentsForBal = REWARDS.perFriend * 100;
  const chainBonusCentsForBal   = Math.round(REWARDS.friendOfFriendBonus * 100);
  const referralRowCaps = (() => {
    const out = {};
    const dRun = {};
    const cRun = {};
    const sorted = [...referralRowsAll].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return ta - tb;
    });
    for (const e of sorted) {
      const t = earningTier(e);
      const cents = e.amount_cents || 0;
      if (t === 'direct') {
        const name = e.meta?.friend ? String(e.meta.friend).split('->')[0] : `direct_${e.id}`;
        const before = dRun[name] || 0;
        const room   = Math.max(0, perFriendCapCentsForBal - before);
        const eff    = Math.min(cents, room);
        dRun[name]   = before + cents;
        out[e.id]    = eff;
      } else if (t === 'chain') {
        const key    = e.meta?.friend || `chain_${e.id}`;
        const before = cRun[key] || 0;
        const room   = Math.max(0, chainBonusCentsForBal - before);
        const eff    = Math.min(cents, room);
        cRun[key]    = before + cents;
        out[e.id]    = eff;
      } else {
        out[e.id] = cents;
      }
    }
    return out;
  })();
  const totals = earnings.reduce((acc, e) => {
    if (e.status !== 'cleared') return acc;
    const amt = isReferralKind(e.kind)
      ? (referralRowCaps[e.id] ?? e.amount_cents)
      : e.amount_cents;
    acc.all       += amt;
    acc[e.kind]   = (acc[e.kind] || 0) + amt;
    if (isReferralKind(e.kind)) acc.referrals += amt;
    if (isBookingKind(e.kind))  acc.bookings  += amt;
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

  // CERGIO-GUARD (2026-06-04): per-friend totals SPLIT into direct
  // and chain buckets. Previously we summed both buckets under one
  // friend name, which made a chain row from "Sam->FriendA" show as
  // "Sam: $88/$250" — but the $250 cap is for Sam's DIRECT bookings,
  // while the $12.50 chain cap is for FriendA. Now we key direct
  // rows on the friend name and chain rows on the FULL chain path
  // ("Sam->FriendA") so each cap pill reads honestly.
  const friendName = (e) => {
    const raw = e.meta?.friend;
    if (!raw) return null;
    return String(raw).split('->')[0];
  };
  const directByFriend = (() => {
    const map = {};
    for (const e of referralRows) {
      const t = earningTier(e);
      if (t !== 'direct') continue;
      const name = friendName(e);
      if (!name) continue;
      if (!map[name]) map[name] = { name, total: 0, count: 0 };
      map[name].total += e.amount_cents;
      map[name].count += 1;
    }
    return map;
  })();
  const chainByPath = (() => {
    const map = {};
    for (const e of referralRows) {
      const t = earningTier(e);
      if (t !== 'chain') continue;
      const raw = e.meta?.friend;
      if (!raw) continue;
      if (!map[raw]) map[raw] = { path: raw, total: 0, count: 0 };
      map[raw].total += e.amount_cents;
      map[raw].count += 1;
    }
    return map;
  })();
  // perFriend (combined) — kept for the Top 3 leaderboard which
  // ranks by overall driver, not per-cap. Each friend's "total" =
  // direct + every chain bucket they routed.
  const perFriend = (() => {
    const map = {};
    for (const e of referralRows) {
      const name = friendName(e);
      if (!name) continue;
      if (!map[name]) map[name] = { name, total: 0, count: 0 };
      map[name].total += e.amount_cents;
      map[name].count += 1;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  })();
  // Suppress unused-warning — perFriend is still referenced below in
  // the row render for completeness even though direct/chain split
  // pulls from the new bucket maps.
  void perFriend;

  // CERGIO-GUARD (2026-06-04 v3): per-row remaining cap.
  // Tarik: "the 250 at far right should really be 0 if credit was
  // reached prior to this transaction." Walk referralRows oldest-
  // first, accumulating per-bucket; stamp each row with how much
  // cap is left AFTER this row's contribution. The pill on the row
  // then reads honestly: $0 left when capped earlier, $X left when
  // partway, or "maxed by this booking" when this row tips it over.
  const perFriendCapCentsAll = REWARDS.perFriend * 100;
  const chainBonusCentsAll   = Math.round(REWARDS.friendOfFriendBonus * 100);
  const rowCapState = (() => {
    const out = {};
    const directRun = {};
    const chainRun  = {};
    // Oldest first so the running totals match real chronology.
    const chronological = [...referralRows].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return ta - tb;
    });
    for (const e of chronological) {
      const t = earningTier(e);
      const cents = e.amount_cents || 0;
      let bucketKey, cap, run;
      if (t === 'direct') {
        const name = e.meta?.friend ? String(e.meta.friend).split('->')[0] : `direct_${e.id}`;
        bucketKey = name; cap = perFriendCapCentsAll; run = directRun;
      } else if (t === 'chain') {
        bucketKey = e.meta?.friend || `chain_${e.id}`;
        cap = chainBonusCentsAll; run = chainRun;
      } else {
        out[e.id] = { capLeftCents: null, capCents: null, capReachedBefore: false };
        continue;
      }
      // CERGIO-GUARD (2026-06-05 v5): per-row EFFECTIVE credit.
      // Tarik: "activity is a running tape of individual payments
      // hitting your balance. 250 was already earned in sessions
      // before — should be +0." We were showing raw amount_cents
      // even when the cap was already maxed. Compute the actual
      // delta-to-balance for THIS row (= min of this payout and
      // the cap room remaining BEFORE this row).
      const before     = run[bucketKey] || 0;
      const room       = Math.max(0, cap - before);
      const effectiveCents = Math.min(cents, room);
      const after      = before + cents;
      run[bucketKey]   = after;
      const capLeftCents     = Math.max(0, cap - after);
      const capReachedBefore = before >= cap;
      const capReachedByThis = !capReachedBefore && after >= cap;
      out[e.id] = { capLeftCents, capCents: cap, capReachedBefore, capReachedByThis, effectiveCents, rawCents: cents };
    }
    return out;
  })();

  // CERGIO-GUARD (2026-06-03): sort control on Referrals tab.
  // 'recent' = chronological (current behavior).
  // 'top'    = highest payout first — surfaces which friends are
  //            driving the earnings.
  const [sortMode, setSortMode] = useState('recent');
  const sortedVisibleRows = activeTab === 'referrals' && sortMode === 'top'
    ? [...visibleRows].sort((a, b) => (b.amount_cents || 0) - (a.amount_cents || 0))
    : visibleRows;

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

      {/* CERGIO-GUARD (2026-06-04): top counts strip — Tarik:
          "show counts all services reco'd invited friends..joined
          etc.. should lead to invite reco more.. and friends
          tracking naturally." Five tappable cells, each routes to
          the next-best action so the strip itself is the funnel
          accelerator. Uses REAL counts pulled from invites /
          recommendations / services.

          CERGIO-GUARD (2026-06-04 v4): when ALL counts are zero, the
          strip would render five hollow "0 0 0 0 0" tiles — that's
          worse than nothing. Replace with a single tall CTA card
          that nudges first invite. Once any count > 0, the strip
          renders in full again. */}
      {(() => {
        const totalCount = inviteCounts.invited + inviteCounts.joined + inviteCounts.booked + recsCount + servicesCount;
        if (totalCount === 0) {
          return (
            <button
              type="button"
              onClick={() => navigate('/invite/friends-popup')}
              className="mx-5 mb-5 w-[calc(100%-2.5rem)] bg-gradient-to-br from-gl to-white border border-g/30 rounded-[16px] p-4 text-left hover:from-gl/80 hover:to-gl/40 transition-colors"
            >
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-gd">Start earning</p>
              <p className="text-[15px] font-extrabold text-black leading-snug mt-1">
                Invite your first friend — earn ${REWARDS.perFriendUser} when they book.
              </p>
              <p className="text-[12px] text-b3 font-medium mt-1.5 leading-snug">
                Plus ${REWARDS.friendOfFriendBonus} chain bonus when their friends book too. <span className="text-gd font-extrabold">Send invite →</span>
              </p>
            </button>
          );
        }
        // CERGIO-GUARD (2026-06-05 v7): Tarik — "no need for # booked
        // (they can see numbers below)" and "differentiate services
        // reco'd VS services offered." 5-tile → 4-tile strip:
        //   Invited · Joined · Reco'd · Offered
        // The "Offered" tile renders with a distinct font weight + italic
        // so it reads as a different category (services I personally list,
        // not services I've recommended).
        return (
          <div className="mx-5 mb-5 grid grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => navigate('/earnings/invites')}
              className="bg-white border border-bdr rounded-[12px] py-2 px-1.5 text-center hover:bg-bg5/40 transition-colors"
              title={`${inviteCounts.invited} invited — tap to open`}
            >
              <p className="text-[18px] font-extrabold text-black leading-none">{inviteCounts.invited}</p>
              <p className="text-[9.5px] font-extrabold uppercase tracking-wide text-b3 mt-0.5">Invited</p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/earnings/invites?filter=joined')}
              className="bg-white border border-bdr rounded-[12px] py-2 px-1.5 text-center hover:bg-bg5/40 transition-colors"
              title={`${inviteCounts.joined} joined — tap to open`}
            >
              <p className="text-[18px] font-extrabold text-black leading-none">{inviteCounts.joined}</p>
              <p className="text-[9.5px] font-extrabold uppercase tracking-wide text-b3 mt-0.5">Joined</p>
            </button>
            {/* CERGIO-GUARD (2026-06-05): Reco'd tile now opens the
                reco tracking dashboard (list of who you've reco'd +
                edit/nudge per row), not the new-reco form. Tarik:
                "clicking on # of reco's should show the reco's made and
                ability to edit them". The + Reco button inside the
                tracking screen is the entry point for new recos. */}
            <button
              type="button"
              onClick={() => navigate(recsCount > 0 ? '/earnings/recos' : '/invite/recommend')}
              className="bg-white border border-bdr rounded-[12px] py-2 px-1.5 text-center hover:bg-bg5/40 transition-colors"
              title={recsCount > 0
                ? `${recsCount} reco'd — tap to review, edit, or nudge`
                : 'Reco someone you know — tap to start'}
            >
              <p className="text-[18px] font-extrabold text-black leading-none">{recsCount}</p>
              <p className="text-[9.5px] font-extrabold uppercase tracking-wide text-b3 mt-0.5">Reco&apos;d</p>
            </button>
            <button
              type="button"
              onClick={() => navigate(servicesCount > 0 ? '/profile' : '/list-service')}
              className="bg-gl/60 border border-g/25 rounded-[12px] py-2 px-1.5 text-center hover:bg-gl transition-colors"
              title={`${servicesCount} services you offer — tap to manage`}
            >
              <p className="text-[18px] font-extrabold text-gd leading-none italic">{servicesCount}</p>
              <p className="text-[9.5px] font-extrabold uppercase tracking-wide text-gd mt-0.5">Offered</p>
            </button>
          </div>
        );
      })()}

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
              {/* CERGIO-GUARD (2026-06-03): aggregate summary + per-friend
                  context per Tarik: "show calculation 7% of 250 booking ..
                  tally so far $X out of $250 from alex.. aggregate balances
                  (N friends invited, M reco'd, $X/$Y potential)... sorts
                  to see top connections driving earnings". Renders only
                  on Referrals tab; Bookings keeps the original simple list. */}
              {activeTab === 'referrals' && (
                <ReferralsSummary
                  referralRows={referralRows}
                  inviteCounts={inviteCounts}
                  recsCount={recsCount}
                  sortMode={sortMode}
                  onSortChange={setSortMode}
                  onReinvite={() => navigate('/invite/friends')}
                  onOpenTracking={() => navigate('/earnings/invites')}
                />
              )}
              <div className="flex items-center justify-between px-5 mb-2">
                <p className="text-[14px] font-extrabold uppercase tracking-widest text-b3">
                  {activeTab === 'bookings' ? 'Service bookings' : 'Referrals & spotlights'}
                </p>
                <p className="text-[14px] font-extrabold text-g">{fmtDollars(visibleTotal)}</p>
              </div>
              <div className="px-5 flex flex-col gap-2 mb-6">
                {sortedVisibleRows.map(e => (
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
                      {/* CERGIO-GUARD (2026-06-03): per Tarik — show
                          breakdown of WHERE each payout came from.
                          Headline carries the friend name when known
                          (e.g. "Alex booked", "Jamie via your chain"),
                          falls back to generic copy when meta is sparse.
                          Tier pill stays as the secondary signal. */}
                      {(() => {
                        const tier   = earningTier(e);
                        const friend = e.meta?.friend;
                        const friendShort = friend ? String(friend).split('->')[0] : null;
                        const fofShort    = friend && friend.includes('->')
                          ? friend.split('->')[1]
                          : null;
                        const tier1Rate = REWARDS.referrerSharePercent;    // 7
                        const tier2Rate = REWARDS.chainSharePercent;       // 0.5
                        const tier1Cap  = REWARDS.perFriend * 100;         // 25000 cents
                        const tier2Cap  = Math.round(REWARDS.friendOfFriendBonus * 100); // 1250 cents
                        // CERGIO-GUARD (2026-06-03): per Tarik — reframe
                        // headline as "{Friend} booked {someone}" so the
                        // user sees both parties. Service title isn't in
                        // earnings.meta today; a follow-up commit can
                        // join via source_id → invites → bookings →
                        // services.title. For now the second name reads
                        // as "a service".
                        // CERGIO-GUARD (2026-06-03): infer the booking
                        // amount from the payout when we're not at the
                        // cap. Tier 1: payout / 0.07. Tier 2: payout
                        // / 0.005. At-cap rows skip the inferred number
                        // and read "Tier X cap reached" instead.
                        const cents     = e.amount_cents || 0;
                        const atTier1Cap = tier === 'direct' && cents >= tier1Cap;
                        const atTier2Cap = tier === 'chain'  && cents >= tier2Cap;
                        const inferredBookingCents = tier === 'direct'
                          ? Math.round(cents / (tier1Rate / 100))
                          : tier === 'chain'
                            ? Math.round(cents / (tier2Rate / 100))
                            : null;
                        const bookingPriceTag = inferredBookingCents && !atTier1Cap && !atTier2Cap
                          ? ` $${(inferredBookingCents / 100).toFixed(0)}`
                          : '';
                        // CERGIO-GUARD (2026-06-05 v7): per Tarik —
                        // "break these types of notes (which service
                        // was booked for how much)". Surface the
                        // inferred booking $ in the headline so the row
                        // reads as a real transaction, not abstract
                        // credit. Service name itself still pending the
                        // earnings → bookings → services.title join.
                        let headline = 'Friend referral';
                        if (e.kind === 'spotlight') {
                          headline = `${e.meta?.platform === 'tiktok' ? 'TikTok' : 'Instagram'} spotlight`;
                        } else if (e.kind === 'booking') {
                          headline = 'Service booking';
                        } else if (friendShort && tier === 'direct') {
                          headline = `${friendShort} booked a${bookingPriceTag} service`;
                        } else if (fofShort && tier === 'chain') {
                          headline = `${fofShort} booked a${bookingPriceTag} service`;
                        } else if (friendShort && tier === 'chain') {
                          headline = `Friend-of-friend booked a${bookingPriceTag} service`;
                        } else if (tier === 'chain') {
                          headline = `Friend-of-friend booked a${bookingPriceTag} service`;
                        }
                        const tierLabel  = tier === 'direct' ? 'Tier 1' : tier === 'chain' ? 'Tier 2' : null;
                        const tierRate   = tier === 'direct' ? tier1Rate : tier2Rate;
                        const tierCapStr = tier === 'direct' ? `${REWARDS.perFriend}` : `${REWARDS.friendOfFriendBonus}`;
                        // CERGIO-GUARD (2026-06-04): pull the running
                        // total from the CORRECT bucket per tier.
                        // Direct row → directByFriend[friend].total
                        //              vs $250 cap.
                        // Chain row  → chainByPath[fullChainPath].total
                        //              vs $12.50 cap.
                        // Fixes the audit confusion where a chain row
                        // showed Sam's $88 mixed total against a $250
                        // cap that doesn't apply to the chain bucket.
                        const isChain = tier === 'chain';
                        const chainPathKey = isChain ? friend : null;
                        // CERGIO-GUARD (2026-06-04 v3): pill now reports
                        // *remaining* cap as of this row (not lifetime
                        // total). Tarik: "the 250 at far right should
                        // really be 0 if credit was reached prior to
                        // this transaction." rowCapState[e.id] tracks
                        // before/after caps walked oldest→newest.
                        const rs = rowCapState[e.id] || null;
                        const friendTotalCents = !isChain
                          ? (directByFriend[friendShort]?.total || 0)
                          : (chainByPath[chainPathKey]?.total || 0);
                        const capLeftCents    = rs ? rs.capLeftCents : null;
                        const capReachedBefore = !!(rs && rs.capReachedBefore);
                        const tallyCapCents   = isChain ? tier2Cap : tier1Cap;
                        const tallyLabel      = isChain
                          ? (fofShort || friendShort || 'Chain')
                          : (friendShort || 'Friend');
                        return (
                          <>
                            {/* CERGIO-GUARD (2026-06-05 v7): row IA
                                broken onto separate lines per Tarik —
                                "need to break these types of notes"
                                (headline + tier + cap state were
                                cramped on one line). Now:
                                  L1: headline (Alex booked a $900 service)
                                  L2: tier pill + cap-left pill
                                  L3: status caption (only if relevant)
                                  L4: time + status (rendered below) */}
                            <p className="text-[14px] font-extrabold text-black leading-tight">
                              {headline}
                            </p>
                            <div className="flex items-center gap-1.5 flex-wrap mt-1">
                              {tierLabel && (
                                <span
                                  className={`text-[9.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-pill
                                    ${tier === 'direct' ? 'bg-gl text-gd' : 'bg-warnBg text-warnText'}`}
                                  title={`${tierLabel}: ${tierRate}% per booking, up to ${tierCapStr} cap per friend`}
                                >
                                  {tierLabel} · {tierRate}% · ${tierCapStr} cap
                                </span>
                              )}
                              {friendShort && (
                                <FriendTallyPill
                                  name={tallyLabel}
                                  friendTotalCents={friendTotalCents}
                                  capCents={tallyCapCents}
                                  capLeftCents={capLeftCents}
                                  capReachedBefore={capReachedBefore}
                                />
                              )}
                            </div>
                            {/* CERGIO-GUARD (2026-06-04): clearer cap copy
                                per Tarik — "the 250 at far right should
                                really be 0 if credit was reached prior
                                to this transaction." The cap is reached
                                BY this booking; the +$250 IS the credit
                                from this row. Spell it out so users
                                don't think there's a prior unseen
                                transaction. */}
                            {e.kind === 'invite' && (
                              <p className="text-[11px] text-b3 mt-0.5 leading-snug">
                                {capReachedBefore && tier === 'direct'
                                  ? <>${REWARDS.perFriend} Tier 1 cap from {friendShort || 'this friend'} was already maxed — $0 paid on this booking</>
                                  : capReachedBefore && tier === 'chain'
                                  ? <>${REWARDS.friendOfFriendBonus} Tier 2 chain cap via {friendShort || 'this friend'} was already maxed — $0 paid on this booking</>
                                  : atTier1Cap
                                  ? <>${REWARDS.perFriend} Tier 1 cap maxed out by this booking — no further Tier 1 credit from {friendShort || 'this friend'}</>
                                  : atTier2Cap
                                  ? <>${REWARDS.friendOfFriendBonus} Tier 2 chain cap maxed out by this booking — no further chain credit from {fofShort || 'this friend-of-friend'}</>
                                  : tier === 'direct' && inferredBookingCents
                                  ? <>{tier1Rate}% of {friendShort || 'their'} ${(inferredBookingCents / 100).toFixed(0)} booking</>
                                  : tier === 'chain' && inferredBookingCents
                                  ? <>{tier2Rate}% of {fofShort || 'a friend-of-friend'}&apos;s ${(inferredBookingCents / 100).toFixed(0)} booking</>
                                  : tier === 'direct'
                                  ? <>Tier 1 — {tier1Rate}% per booking up to ${REWARDS.perFriend}</>
                                  : <>Tier 2 — {tier2Rate}% per booking up to ${REWARDS.friendOfFriendBonus}</>}
                              </p>
                            )}
                            <p className="text-[11px] text-b3 mt-0.5 leading-snug">
                              {timeAgo(e.created_at)} · {e.status === 'cleared' ? 'cleared' : e.status}
                            </p>
                          </>
                        );
                      })()}
                    </div>
                    {/* CERGIO-GUARD (2026-06-05 v5): show the EFFECTIVE
                        amount that hit balance for this transaction,
                        not the raw ledger entry. If the friend's cap
                        was already maxed in a prior row, this row's
                        balance impact is $0 — Tarik: "63 earned that
                        session... but 250 was already earned in
                        sessions before so it should be +0." Cap-tipping
                        rows show the partial amount that fit. The pill
                        below labels capped/partial state explicitly. */}
                    {(() => {
                      const rs = rowCapState[e.id];
                      const effCents = rs ? rs.effectiveCents : (e.amount_cents || 0);
                      const rawCents = e.amount_cents || 0;
                      const cappedOut = effCents === 0 && rawCents > 0;
                      const partial   = effCents > 0 && effCents < rawCents;
                      return (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={`text-[15px] font-extrabold ${cappedOut ? 'text-b3' : 'text-black'}`}>
                            +{fmtDollars(effCents)}
                          </span>
                          {(cappedOut || partial) && (
                            <span className="text-[9.5px] text-b3 font-extrabold uppercase tracking-wide">
                              {cappedOut ? 'cap maxed' : `partial · raw +${fmtDollars(rawCents)}`}
                            </span>
                          )}
                        </div>
                      );
                    })()}
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
          {/* CERGIO-GUARD (2026-06-05 v6): stat tiles are now TAPPABLE.
              Tarik: "these should take to actual profiles reco'd etc.
              it doesn't." Each tile routes to the matching ledger:
                friends invited → /earnings/invites (invite tracker)
                services reco'd → /earnings/invites (same surface for
                                  the recommendations the user authored)
                earned         → /earnings/breakdown (ledger view)
              Visual: hover affordance + chevron so the tap target reads. */}
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => navigate('/earnings/invites')}
              className="flex-1 text-left bg-bg5/40 hover:bg-bg5 rounded-[12px] px-3 py-2 transition-colors"
            >
              <p className="text-[18px] font-extrabold text-black leading-none">{invitesCount}</p>
              <p className="text-[10.5px] text-b3 mt-0.5 leading-snug flex items-center gap-1">friends invited <span className="text-gd font-extrabold">›</span></p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/earnings/invites')}
              className="flex-1 text-left bg-bg5/40 hover:bg-bg5 rounded-[12px] px-3 py-2 transition-colors"
            >
              <p className="text-[18px] font-extrabold text-black leading-none">{recsCount}</p>
              <p className="text-[10.5px] text-b3 mt-0.5 leading-snug flex items-center gap-1">services reco&apos;d <span className="text-gd font-extrabold">›</span></p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/earnings/breakdown')}
              className="flex-1 text-left bg-bg5/40 hover:bg-bg5 rounded-[12px] px-3 py-2 transition-colors"
            >
              <p className="text-[18px] font-extrabold text-black leading-none">{balanceStr}</p>
              <p className="text-[10.5px] text-b3 mt-0.5 leading-snug flex items-center gap-1">earned <span className="text-gd font-extrabold">›</span></p>
            </button>
          </div>

          {/* Action row: Invite + Reco buttons + a small "see all
              recos sent" link. CERGIO-GUARD (2026-06-05): dropped the
              duplicate "Recs sent" stat (already shown above as
              "services reco'd"); the action row stays focused on
              actions, not stats. */}
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => navigate('/find-friends')}
              className="flex-1 bg-g text-white rounded-pill px-3 py-2 text-[12px] font-extrabold whitespace-nowrap"
            >
              Invite a friend
            </button>
            <button
              onClick={() => navigate('/invite/recommend')}
              className="flex-1 bg-white border border-bdr rounded-pill px-3 py-2 text-[12px] font-extrabold text-b2 whitespace-nowrap"
            >
              Reco a provider
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

// CERGIO-GUARD (2026-06-03): aggregate referral summary block.
// Renders above the per-row ledger when the Referrals tab is active.
// Sections:
//   1. Aggregates — N friends invited, M reco'd, $X earned / $Y potential
//      with a progress bar so the room-to-grow is visceral.
//   2. Top contributors — top 3 friends driving total earnings + their share.
//   3. Sort control — Most recent / Top earners.
// Pulls REWARDS.referrerSharePercent for the calculation copy so the
// number stays in sync with the legal/payments docs.
function ReferralsSummary({ referralRows, inviteCounts, recsCount, sortMode, onSortChange, onReinvite, onOpenTracking }) {
  void recsCount;
  // CERGIO-GUARD (2026-06-04 v3): TRUTHFUL totals — Tarik:
  // "the total of 838 is wrong (as we only have one invitee)…"
  //
  // The raw sum of referralRows can exceed what's actually possible
  // under the cap rules when seeded test data piles up. Display the
  // *capped* earned amount instead:
  //   capped(direct) = min($250, sum of payouts for that friend)
  //   capped(chain)  = min($12.50, sum of payouts for that chain path)
  // Potential = perFriend × actual invites + chainBonus × actual chain paths.
  // Both numerator and denominator now reflect the real network only.
  const perFriendCapCents     = REWARDS.perFriend * 100;
  const chainBonusCents       = Math.round(REWARDS.friendOfFriendBonus * 100);

  // Group payouts by source (direct: friend name; chain: full path).
  const directBuckets = {};
  const chainBuckets  = {};
  for (const e of referralRows) {
    const t = earningTier(e);
    const raw = e.meta?.friend;
    const cents = e.amount_cents || 0;
    if (t === 'direct') {
      const name = raw ? String(raw).split('->')[0] : `direct_${e.id}`;
      directBuckets[name] = (directBuckets[name] || 0) + cents;
    } else if (t === 'chain') {
      const key = raw || `chain_${e.id}`;
      chainBuckets[key] = (chainBuckets[key] || 0) + cents;
    }
  }
  // Sum each bucket clamped to its cap — this is the legally-payable
  // total under our rules. Anything above is excess seed/test noise.
  const cappedDirectCents = Object.values(directBuckets)
    .reduce((s, v) => s + Math.min(v, perFriendCapCents), 0);
  const cappedChainCents  = Object.values(chainBuckets)
    .reduce((s, v) => s + Math.min(v, chainBonusCents),  0);
  const totalCents = cappedDirectCents + cappedChainCents;

  // Potential — based on REAL invited counts (not the seeded earnings ledger).
  const distinctChainPaths    = Object.keys(chainBuckets).length;
  const directPotentialCents  = perFriendCapCents * Math.max(inviteCounts.invited, 0);
  const chainPotentialCents   = chainBonusCents * distinctChainPaths;
  const potentialCents        = Math.max(
    directPotentialCents + chainPotentialCents,
    totalCents  // never less than what we've already earned
  );
  const pct = potentialCents > 0
    ? Math.min(100, Math.round((totalCents / potentialCents) * 100))
    : 0;
  const stalled = Math.max(0, inviteCounts.invited - inviteCounts.joined);

  // CERGIO-GUARD (2026-06-04 v3): Top-3 sums respect the per-friend
  // caps so the leaderboard reconciles with the capped hero total.
  // Per friend: direct contribution + every chain bucket routed
  // through them, each clamped at its respective cap.
  const friendCapped = {};
  for (const [name, cents] of Object.entries(directBuckets)) {
    friendCapped[name] = (friendCapped[name] || 0) + Math.min(cents, perFriendCapCents);
  }
  for (const [path, cents] of Object.entries(chainBuckets)) {
    const root = String(path).split('->')[0];
    if (!root) continue;
    friendCapped[root] = (friendCapped[root] || 0) + Math.min(cents, chainBonusCents);
  }
  const friends = Object.entries(friendCapped)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
  const top3 = friends.slice(0, 3);
  const top3Share = totalCents > 0
    ? Math.round((top3.reduce((s, f) => s + f.total, 0) / totalCents) * 100)
    : 0;

  return (
    <div className="mx-5 mb-4 bg-white border border-bdr rounded-[16px] p-4">
      {/* CERGIO-GUARD (2026-06-04): redesigned per Tarik —
          "earnings still very confusing". Three calm blocks:
            1. Earned-to-date hero ($X of $Y) + progress bar
            2. Funnel — Invited → Joined → Booked
            3. Re-invite CTA when there's a stall gap
            4. Top 3 leaderboard
            5. Sort */}
      {/* 1. Hero */}
      <p className="text-[11px] font-extrabold uppercase tracking-widest text-b3">
        Earned to date
      </p>
      <p className="text-[26px] font-extrabold text-black leading-none mt-1">
        ${(totalCents / 100).toFixed(0)}
        <span className="text-b3 font-bold text-[14px] ml-1.5">
          of ${(potentialCents / 100).toLocaleString()} potential
        </span>
      </p>
      <div className="mt-2 h-1.5 rounded-full bg-bg5 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-g to-gd rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-b3 font-medium mt-1.5 leading-snug">
        {REWARDS.referrerSharePercent}% per friend booking up to ${REWARDS.perFriend}, plus ${REWARDS.friendOfFriendBonus} chain bonus per friend-of-friend.
      </p>

      {/* 2. Funnel — Invited → Joined → Booked */}
      <div className="mt-4 pt-3 border-t border-bdr">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-b3">
            Friends funnel
          </p>
          <button
            type="button"
            onClick={() => onOpenTracking?.()}
            className="text-meta-sm text-gd font-extrabold underline-offset-2 hover:underline bg-transparent border-none p-0 cursor-pointer"
          >
            View all →
          </button>
        </div>
        <div className="flex items-center justify-between gap-1.5 text-center">
          {[
            { label: 'Invited', n: inviteCounts.invited },
            { label: 'Joined',  n: inviteCounts.joined },
            { label: 'Booked',  n: inviteCounts.booked },
          ].map((stage, i) => (
            <div key={stage.label} className="flex-1 flex items-center gap-1.5">
              <div className="flex-1 bg-bg5 rounded-[10px] py-1.5">
                <p className="text-[18px] font-extrabold text-black leading-none">{stage.n}</p>
                <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-b3 mt-0.5">{stage.label}</p>
              </div>
              {i < 2 && <span className="text-b3 text-[11px] font-extrabold">→</span>}
            </div>
          ))}
        </div>
        {stalled > 0 && (
          <button
            type="button"
            onClick={onReinvite}
            className="mt-2.5 text-meta-sm text-gd font-extrabold underline-offset-2 hover:underline bg-transparent border-none p-0 cursor-pointer"
          >
            Re-invite {stalled} {stalled === 1 ? 'friend who hasn’t joined' : 'friends who haven’t joined'} →
          </button>
        )}
      </div>

      {/* 3. Top contributors */}
      {top3.length > 0 && (
        <div className="mt-4 pt-3 border-t border-bdr">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-b3 mb-1.5">
            Top 3 · {top3Share}% of your earnings
          </p>
          <div className="flex flex-col gap-1.5">
            {top3.map((f) => {
              const share = totalCents > 0 ? Math.round((f.total / totalCents) * 100) : 0;
              return (
                <div key={f.name} className="flex items-center justify-between text-[13px]">
                  <span className="font-extrabold text-black truncate pr-2">{f.name}</span>
                  <span className="text-b3 font-bold flex-shrink-0">
                    ${(f.total / 100).toFixed(0)}
                    <span className="ml-1.5 text-gd">{share}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Sort */}
      <div className="mt-4 pt-3 border-t border-bdr flex items-center gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-widest text-b3">Sort</span>
        <button
          type="button"
          onClick={() => onSortChange('recent')}
          className={`text-[12px] font-extrabold rounded-pill px-2.5 py-0.5 transition-colors
                      ${sortMode === 'recent' ? 'bg-gl text-gd' : 'bg-bg5 text-b3 hover:text-b2'}`}
        >
          Most recent
        </button>
        <button
          type="button"
          onClick={() => onSortChange('top')}
          className={`text-[12px] font-extrabold rounded-pill px-2.5 py-0.5 transition-colors
                      ${sortMode === 'top' ? 'bg-gl text-gd' : 'bg-bg5 text-b3 hover:text-b2'}`}
        >
          Top earners
        </button>
      </div>
    </div>
  );
}

// CERGIO-GUARD (2026-06-04 v3): row pill now reads REMAINING cap at
// this row, not lifetime total. Tarik: "the 250 at far right should
// really be 0 if credit was reached prior to this transaction."
// capLeftCents is the room left AFTER this row's payout; if a prior
// row already maxed the bucket, capLeftCents is 0 and capReachedBefore
// is true — pill renders "$0 left ✓".
function FriendTallyPill({
  name,
  friendTotalCents,
  capCents = REWARDS.perFriend * 100,
  capLeftCents = null,
  capReachedBefore = false,
}) {
  const usingLeft = capLeftCents !== null;
  const left      = usingLeft ? capLeftCents : Math.max(0, capCents - friendTotalCents);
  const maxedOut  = left <= 0;
  const cap$  = (capCents % 100 === 0)
    ? (capCents / 100).toFixed(0)
    : (capCents / 100).toFixed(2);
  const left$ = (left % 100 === 0)
    ? (left / 100).toFixed(0)
    : (left / 100).toFixed(2);
  const titleSuffix = capReachedBefore
    ? '(cap already reached before this booking)'
    : maxedOut
      ? '(cap reached this booking)'
      : `($${cap$} cap)`;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10.5px] font-extrabold rounded-pill px-1.5 py-0.5
                  ${maxedOut ? 'bg-gl text-gd' : 'bg-bg5 text-b2'}`}
      title={`${name}: $${left$} left ${titleSuffix}`}
    >
      ${left$} left
      {maxedOut && <span aria-hidden="true">✓</span>}
    </span>
  );
}
