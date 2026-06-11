// CERGIO-GUARD (2026-06-04): Invite tracking dashboard per Tarik —
// every invite the user has sent with status pill (Invited / Joined /
// Booked), timestamps, and a Resend menu (WhatsApp / SMS / Copy
// link). Filter chips above the list. Routed at /earnings/invites,
// reached from a "View invite tracking" link on EarningsScreen.
//
// Recipient routing:
//   • WhatsApp is the primary nudge channel per Tarik — "far more
//     effective for users (keep text as well, just route if text
//     doesn't convert)".
//   • SMS stays as the fallback.
//   • Copy link is the universal fallback for any other channel.
//
// Resend marker:
//   bumpInvite() updates invited_at so the row floats to the top
//   and counts as a fresh outreach. Actual outbound message is
//   sent client-side via the share intent buttons.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { getMyInvitesDetailed, bumpInvite, getInviteServiceContexts } from '../lib/api';
import { buildInviteUrl } from '../lib/referral';
import { REWARDS } from '../lib/rewards';

function fmtAgo(iso) {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60)        return 'just now';
  if (sec < 3600)      return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400)     return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function statusOf(invite) {
  if (invite.first_booking_at) return 'booked';
  if (invite.joined_at)        return 'joined';
  return 'invited';
}

const STATUS_META = {
  invited: { label: 'Invited', cls: 'bg-bg5 text-b2' },
  joined:  { label: 'Joined',  cls: 'bg-warnBg text-warnText' },
  booked:  { label: 'Booked',  cls: 'bg-gl text-gd' },
};

function digitsOnly(s) {
  return String(s || '').replace(/[^\d+]/g, '');
}

export function InviteTrackingScreen() {
  const navigate = useNavigate();
  const outlet = useOutletContext() || {};
  const auth = outlet.auth;
  const showToast = outlet.showToast || (() => {});

  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('all');
  // pending-action map so a row's buttons can show a spinner during
  // the bump call without locking the whole screen.
  const [pending, setPending] = useState({});
  // CERGIO-GUARD (2026-06-05): per-invite service-type pill. Sourced
  // from recommendations rows the user wrote against the same recipient
  // (digit-matched phone or invitee_id). Lets the user see at a glance
  // which invites were Reco'd as e.g. a Plumber. Tarik 2026-06-05:
  // "don't see how to track invite with type of service added".
  const [recoCtx, setRecoCtx] = useState({});

  // Inviter's tracked URL — every share message embeds this so the
  // converting friend's signup + first booking credit Tarik.
  const inviteUrl = buildInviteUrl(auth?.user?.id);

  useEffect(() => {
    if (!auth?.isSignedIn) { setRows([]); return; }
    let cancelled = false;
    getMyInvitesDetailed({ limit: 200 }).then(async ({ data }) => {
      if (cancelled) return;
      const invites = data || [];
      setRows(invites);
      // Best-effort enrichment — failures fall back to a label-less row.
      const { data: ctxMap } = await getInviteServiceContexts(invites);
      if (!cancelled) setRecoCtx(ctxMap || {});
    });
    return () => { cancelled = true; };
  }, [auth?.isSignedIn]);

  const counts = useMemo(() => {
    const base = { all: 0, invited: 0, joined: 0, booked: 0 };
    for (const r of (rows || [])) {
      base.all += 1;
      base[statusOf(r)] = (base[statusOf(r)] || 0) + 1;
    }
    return base;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (filter === 'all') return rows;
    return rows.filter(r => statusOf(r) === filter);
  }, [rows, filter]);

  // Canonical nudge copy. Short by design — WhatsApp + SMS both reward
  // brevity and the tracked URL pulls the recipient into the right
  // attribution flow on landing.
  const nudgeText = (firstName) =>
    `${firstName ? `Hi ${firstName} — ` : ''}I'm on Cergio. Each friend who joins + books earns me $${REWARDS.perFriendUser}. Want to try? ${inviteUrl}`;

  async function onResend(invite, channel) {
    // Always bump invited_at so the row floats up + the timeline
    // shows the fresh outreach time.
    setPending(p => ({ ...p, [invite.id]: channel }));
    const { error } = await bumpInvite(invite.id);
    if (error) {
      showToast(`Couldn't re-stamp: ${error.message}`);
      setPending(p => ({ ...p, [invite.id]: undefined }));
      return;
    }
    // Optimistic local update.
    setRows(rs => (rs || []).map(r => r.id === invite.id
      ? { ...r, invited_at: new Date().toISOString() }
      : r));
    setPending(p => ({ ...p, [invite.id]: undefined }));

    const first = invite.invitee?.display_name?.split(' ')[0] || '';
    const text  = nudgeText(first);
    const phone = digitsOnly(invite.invitee_phone);

    if (channel === 'whatsapp') {
      const url = phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
      return;
    }
    if (channel === 'sms') {
      const sms = phone
        ? `sms:${phone}?body=${encodeURIComponent(text)}`
        : `sms:?body=${encodeURIComponent(text)}`;
      window.location.href = sms;
      return;
    }
    // copy
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied — paste it into any chat ✓');
    } catch {
      showToast('Copy unavailable on this device.');
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-cream pb-24 overflow-y-auto">
      {/* Header */}
      <div className="px-5 pt-7 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="w-9 h-9 rounded-full bg-white border border-bdr text-black text-body-lg flex items-center justify-center shadow-sm"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => navigate('/invite/friends')}
          className="bg-g text-white rounded-pill px-4 py-1.5 text-meta font-extrabold cg-cta"
        >
          + Invite
        </button>
      </div>

      <h1 className="px-5 pt-3 text-display-2 font-extrabold text-black leading-tight">Invites</h1>
      <p className="px-5 text-body-sm text-b3 mt-1 leading-snug">
        Track every friend you've invited. Tap Resend to nudge them on WhatsApp, SMS, or copy the link.
      </p>

      {/* Filter chips */}
      <div className="px-5 mt-5 flex gap-2 flex-wrap">
        {[
          { id: 'all',     label: 'All' },
          { id: 'invited', label: 'Pending' },
          { id: 'joined',  label: 'Joined' },
          { id: 'booked',  label: 'Booked' },
        ].map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-pill px-3 py-1 text-meta font-extrabold transition-colors
                        ${filter === f.id
                          ? 'bg-g text-white'
                          : 'bg-white border border-bdr text-b2 hover:border-g/40'}`}
          >
            {f.label} <span className="opacity-70 ml-0.5">{counts[f.id] || 0}</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="px-5 mt-4 flex flex-col gap-2.5">
        {rows === null && (
          <p className="text-body-sm text-b3 py-4">Loading invites…</p>
        )}
        {rows !== null && filtered.length === 0 && (
          <div className="bg-white border border-bdr rounded-[14px] p-5 text-center">
            <p className="text-body font-extrabold text-black">
              {filter === 'all' ? 'No invites yet.' : 'No invites in this status.'}
            </p>
            <p className="text-meta text-b3 mt-1 leading-snug">
              Send your first invite — every friend who joins + books earns you ${REWARDS.perFriendUser}.
            </p>
            <button
              type="button"
              onClick={() => navigate('/invite/friends')}
              className="mt-3 bg-g text-white rounded-pill px-4 py-1.5 text-meta font-extrabold cg-cta"
            >
              Invite friends →
            </button>
          </div>
        )}
        {(filtered || []).map(r => {
          const status = statusOf(r);
          const meta   = STATUS_META[status];
          const name   = r.invitee?.display_name || r.invitee_phone || r.invitee_email || 'Unknown';
          const sub    = r.invitee?.display_name && r.invitee_phone
            ? r.invitee_phone
            : (r.invitee_email && r.invitee_email !== name ? r.invitee_email : null);
          const busy   = pending[r.id];
          return (
            <div key={r.id} className="bg-white border border-bdr rounded-[14px] p-3.5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#b06090] to-[#703050]
                                text-white text-meta font-extrabold flex items-center justify-center flex-shrink-0">
                  {(name[0] || '?').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-body font-extrabold text-black leading-tight truncate">{name}</p>
                    <span className={`text-caps font-extrabold uppercase tracking-wide rounded-pill px-1.5 py-0.5 ${meta.cls}`}>
                      {meta.label}
                    </span>
                    {/* CERGIO-GUARD (2026-06-05): service-type pill —
                        sourced from a matching recommendations row.
                        Hidden when no reco was sent (plain invite). */}
                    {recoCtx[r.id]?.service_type_label && (
                      <span className="text-caps font-extrabold uppercase tracking-wide rounded-pill px-1.5 py-0.5 bg-gl text-gd">
                        as {recoCtx[r.id].service_type_label}
                      </span>
                    )}
                  </div>
                  {sub && <p className="text-meta-sm text-b3 mt-0.5 truncate">{sub}</p>}
                  <p className="text-meta-sm text-b3 mt-0.5">
                    Invited {fmtAgo(r.invited_at)}
                    {r.joined_at        && <> · Joined {fmtAgo(r.joined_at)}</>}
                    {r.first_booking_at && <> · Booked {fmtAgo(r.first_booking_at)}</>}
                  </p>
                </div>
              </div>
              {/* Resend row — hide when already booked (no need to nudge). */}
              {status !== 'booked' && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="text-meta-sm font-extrabold uppercase tracking-wide text-b3">
                    Nudge
                  </span>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => onResend(r, 'whatsapp')}
                    className="bg-[#25D366] text-white rounded-pill px-3 py-1 text-meta font-extrabold disabled:opacity-60"
                  >
                    {busy === 'whatsapp' ? '…' : 'WhatsApp'}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => onResend(r, 'sms')}
                    className="bg-white border border-bdr text-b2 rounded-pill px-3 py-1 text-meta font-extrabold disabled:opacity-60"
                  >
                    {busy === 'sms' ? '…' : 'SMS'}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => onResend(r, 'copy')}
                    className="text-gd font-extrabold text-meta underline-offset-2 hover:underline bg-transparent border-none p-0 cursor-pointer disabled:opacity-60"
                  >
                    {busy === 'copy' ? '…' : 'Copy link'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
