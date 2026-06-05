// CERGIO-GUARD (2026-06-05): Reco tracking dashboard per Tarik —
// "clicking on # of reco's should show the reco's made and ability to
// edit them". Routed at /earnings/recos, reached from the "Reco'd"
// counts-strip tile on EarningsScreen.
//
// Each row shows:
//   • recipient (name or phone)
//   • "Reco'd as {ServiceType}" pill (parsed from the persisted message
//      prefix written by RecommendServiceFormScreen.submit())
//   • the blurb body
//   • sent-time (ago)
//   • Edit → inline textarea + Save/Cancel, patches recommendations.message
//   • Nudge → WhatsApp / SMS / Copy (mirrors InviteTrackingScreen)
//   • Delete → armed-state inline confirm (matches the no-window.confirm
//      rule we already enforced on ResultsScreen + ServiceDetailProvider)
//
// + Reco button in the header routes to /invite/recommend for sending a
// new one, matching the Invite tracking screen's affordance.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  listMyRecommendations,
  updateRecommendation,
  deleteRecommendation,
} from '../lib/api';
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

function digitsOnly(s) {
  return String(s || '').replace(/[^\d+]/g, '');
}

export function RecoTrackingScreen() {
  const navigate = useNavigate();
  const outlet = useOutletContext() || {};
  const auth = outlet.auth;
  const showToast = outlet.showToast || (() => {});

  const [rows, setRows] = useState(null);
  // Per-row UI state — editing id, current draft body, armed-delete flag,
  // pending nudge channel. Kept as plain object maps so we never need to
  // re-render the whole list to flip one row.
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  const [armed, setArmed] = useState({});
  const [pending, setPending] = useState({});

  const inviteUrl = buildInviteUrl(auth?.user?.id);
  const recommenderName =
    auth?.user?.user_metadata?.display_name?.split(' ')[0] || '';

  useEffect(() => {
    if (!auth?.isSignedIn) { setRows([]); return; }
    let cancelled = false;
    listMyRecommendations({ limit: 200 }).then(({ data }) => {
      if (cancelled) return;
      setRows(data || []);
    });
    return () => { cancelled = true; };
  }, [auth?.isSignedIn]);

  // Canonical nudge copy for a reco resend — mirrors the notify-user
  // SMS template so the recipient gets a consistent message whether the
  // server-side notify path or this client-side share intent runs.
  const nudgeText = (row) => {
    const firstName = row.recipient.display_name?.split(' ')[0] || '';
    const svc = row.service_type_label || 'a great service';
    const lead = firstName ? `${firstName} — ` : '';
    return `${lead}${recommenderName ? `${recommenderName} ` : 'A friend '}reco'd you on Cergio as a great ${svc}. Claim your profile + earn from your network: ${inviteUrl}`;
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setDraft(row.body || '');
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };
  const saveEdit = async (row) => {
    setPending(p => ({ ...p, [row.id]: 'save' }));
    const { error } = await updateRecommendation(row.id, {
      body: draft.trim(),
      service_type_label: row.service_type_label || null,
    });
    setPending(p => ({ ...p, [row.id]: undefined }));
    if (error) {
      showToast(`Couldn't save: ${error.message}`);
      return;
    }
    setRows(rs => (rs || []).map(r => r.id === row.id
      ? { ...r, body: draft.trim() }
      : r));
    setEditingId(null);
    setDraft('');
    showToast('Reco updated ✓');
  };

  // Armed-state delete pattern — first tap arms (4s window), second tap
  // confirms. No browser confirm dialog (Tarik 2026-06-04: "cancel
  // request should be inline (not a popup from browser)" — the rule
  // applies to every destructive action surface).
  const onDelete = async (row) => {
    if (!armed[row.id]) {
      setArmed(a => ({ ...a, [row.id]: true }));
      setTimeout(() => {
        setArmed(a => ({ ...a, [row.id]: false }));
      }, 4000);
      return;
    }
    setPending(p => ({ ...p, [row.id]: 'delete' }));
    const { error } = await deleteRecommendation(row.id);
    setPending(p => ({ ...p, [row.id]: undefined }));
    if (error) {
      showToast(`Couldn't delete: ${error.message}`);
      return;
    }
    setRows(rs => (rs || []).filter(r => r.id !== row.id));
    setArmed(a => ({ ...a, [row.id]: false }));
    showToast('Reco removed.');
  };

  const onResend = async (row, channel) => {
    setPending(p => ({ ...p, [row.id]: channel }));
    const text  = nudgeText(row);
    const phone = digitsOnly(row.recipient.phone);

    if (channel === 'whatsapp') {
      const url = phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    } else if (channel === 'sms') {
      const sms = phone
        ? `sms:${phone}?body=${encodeURIComponent(text)}`
        : `sms:?body=${encodeURIComponent(text)}`;
      window.location.href = sms;
    } else {
      try {
        await navigator.clipboard.writeText(text);
        showToast('Copied — paste it into any chat ✓');
      } catch {
        showToast('Copy unavailable on this device.');
      }
    }
    setPending(p => ({ ...p, [row.id]: undefined }));
  };

  // Aggregate counts pinned to the top so the user sees their totals
  // without scrolling. Matches the Invite tracking screen's information
  // density.
  const counts = useMemo(() => {
    const total = rows?.length || 0;
    const claimed = (rows || []).filter(r => !!r.recipient.id).length;
    return { total, claimed };
  }, [rows]);

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
          onClick={() => navigate('/invite/recommend')}
          className="bg-g text-white rounded-pill px-4 py-1.5 text-meta font-extrabold cg-cta"
        >
          + Reco
        </button>
      </div>

      <h1 className="px-5 pt-3 text-[28px] font-extrabold text-black leading-tight">Recos</h1>
      <p className="px-5 text-[13px] text-b3 mt-1 leading-snug">
        Every service provider you&apos;ve reco&apos;d. Tap Edit to refine
        your note, Nudge to resend, or × to remove.
      </p>

      {/* Stats strip — total reco'd + how many have claimed a profile */}
      <div className="px-5 mt-4 flex gap-2">
        <div className="flex-1 bg-white border border-bdr rounded-[12px] px-3 py-2 text-center">
          <p className="text-[18px] font-extrabold text-black leading-none">{counts.total}</p>
          <p className="text-[9.5px] font-extrabold uppercase tracking-wide text-b3 mt-0.5">Reco&apos;d</p>
        </div>
        <div className="flex-1 bg-gl/60 border border-g/25 rounded-[12px] px-3 py-2 text-center">
          <p className="text-[18px] font-extrabold text-gd leading-none">{counts.claimed}</p>
          <p className="text-[9.5px] font-extrabold uppercase tracking-wide text-gd mt-0.5">Claimed</p>
        </div>
      </div>

      {/* List */}
      <div className="px-5 mt-4 flex flex-col gap-2.5">
        {rows === null && (
          <p className="text-[13px] text-b3 py-4">Loading recos…</p>
        )}
        {rows !== null && rows.length === 0 && (
          <div className="bg-white border border-bdr rounded-[14px] p-5 text-center">
            <p className="text-[14px] font-extrabold text-black">No recos yet.</p>
            <p className="text-[12px] text-b3 mt-1 leading-snug">
              Reco a service provider you know — when they claim their
              profile + earn, you earn ${REWARDS.perFriendUser}.
            </p>
            <button
              type="button"
              onClick={() => navigate('/invite/recommend')}
              className="mt-3 bg-g text-white rounded-pill px-4 py-1.5 text-[12px] font-extrabold cg-cta"
            >
              Reco someone →
            </button>
          </div>
        )}
        {(rows || []).map(r => {
          const name = r.recipient.display_name || r.recipient.phone || 'Unknown';
          const isEditing = editingId === r.id;
          const isArmed   = !!armed[r.id];
          const busy      = pending[r.id];
          return (
            <div key={r.id} className="bg-white border border-bdr rounded-[14px] p-3.5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#6090b0] to-[#305070]
                                text-white text-[12px] font-extrabold flex items-center justify-center flex-shrink-0">
                  {(name[0] || '?').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-[14px] font-extrabold text-black leading-tight truncate">{name}</p>
                    {r.service_type_label && (
                      <span className="text-[10px] font-extrabold uppercase tracking-wide rounded-pill px-1.5 py-0.5 bg-gl text-gd">
                        as {r.service_type_label}
                      </span>
                    )}
                    {r.recipient.id && (
                      <span className="text-[10px] font-extrabold uppercase tracking-wide rounded-pill px-1.5 py-0.5 bg-warnBg text-warnText">
                        Claimed
                      </span>
                    )}
                  </div>
                  {r.recipient.phone && r.recipient.display_name && (
                    <p className="text-[11px] text-b3 mt-0.5 truncate">{r.recipient.phone}</p>
                  )}
                  <p className="text-[11px] text-b3 mt-0.5">Sent {fmtAgo(r.sent_at)}</p>
                </div>
                {/* Per-row × armed-state delete control — top-right so
                    it's reachable without scrolling into action affordances. */}
                <button
                  type="button"
                  disabled={busy === 'delete'}
                  onClick={() => onDelete(r)}
                  className={`text-[12px] font-extrabold rounded-pill px-2 py-1 transition-colors
                              ${isArmed
                                ? 'bg-red-600 text-white'
                                : 'bg-bg5 text-b3 hover:text-black'}`}
                  title={isArmed ? 'Tap to confirm' : 'Remove this reco'}
                >
                  {busy === 'delete' ? '…' : isArmed ? 'Confirm ×' : '×'}
                </button>
              </div>

              {/* Body — inline editor when editing, otherwise read-only blurb. */}
              {isEditing ? (
                <div className="mt-3">
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    rows={3}
                    className="w-full bg-bg5 border border-bdr rounded-[10px] p-2 text-[13px] text-black leading-snug
                               focus:outline-none focus:ring-2 focus:ring-g/40"
                    placeholder={r.service_type_label ? `Why they're a great ${r.service_type_label}` : 'Why you reco this person'}
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy === 'save'}
                      onClick={() => saveEdit(r)}
                      className="bg-g text-white rounded-pill px-3 py-1 text-[12px] font-extrabold disabled:opacity-60"
                    >
                      {busy === 'save' ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="bg-white border border-bdr text-b2 rounded-pill px-3 py-1 text-[12px] font-extrabold"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                r.body && (
                  <p className="mt-2 text-[12.5px] text-b2 leading-snug whitespace-pre-wrap break-words">
                    &ldquo;{r.body}&rdquo;
                  </p>
                )
              )}

              {/* Action row — hidden while editing so the editor commands
                  stay unambiguous. */}
              {!isEditing && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => startEdit(r)}
                    className="bg-white border border-bdr text-b2 rounded-pill px-3 py-1 text-[12px] font-extrabold hover:border-g/40"
                  >
                    Edit
                  </button>
                  <span className="text-[11px] font-extrabold uppercase tracking-wide text-b3 ml-1">
                    Nudge
                  </span>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => onResend(r, 'whatsapp')}
                    className="bg-[#25D366] text-white rounded-pill px-3 py-1 text-[12px] font-extrabold disabled:opacity-60"
                  >
                    {busy === 'whatsapp' ? '…' : 'WhatsApp'}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => onResend(r, 'sms')}
                    className="bg-white border border-bdr text-b2 rounded-pill px-3 py-1 text-[12px] font-extrabold disabled:opacity-60"
                  >
                    {busy === 'sms' ? '…' : 'SMS'}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => onResend(r, 'copy')}
                    className="text-gd font-extrabold text-[12px] underline-offset-2 hover:underline bg-transparent border-none p-0 cursor-pointer disabled:opacity-60"
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
