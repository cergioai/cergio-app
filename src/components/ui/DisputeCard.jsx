// Below-4★ private review dispute (Tarik 2026-06-15). Both parties see the
// rating + comment and can reply; the PROVIDER (rated low) can also escalate to
// Cergio/support. Private — never public. listReviewThread / addReviewReply in
// lib/api do the writes.
import { useEffect, useState } from 'react';
import { listReviewThread, addReviewReply } from '../../lib/api';

function Stars({ value }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z"
            fill={i <= value ? '#f9754c' : '#E5E5E3'} />
        </svg>
      ))}
    </span>
  );
}

export function DisputeCard({ dispute, onChange, showToast }) {
  const { bookingId, role, stars, comment, otherName, serviceTitle, escalated } = dispute;
  const isProvider = role === 'provider';
  const otherFirst = (otherName || '').split(' ')[0] || 'they';
  const [thread, setThread] = useState([]);
  const [draft, setDraft]   = useState('');
  const [busy, setBusy]     = useState(false);

  const load = () => listReviewThread(bookingId).then(({ data }) => setThread(data || []));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [bookingId]);

  const send = async (escalate) => {
    const text = draft.trim();
    if (!text) { showToast?.('Write something first.'); return; }
    setBusy(true);
    const { error } = await addReviewReply(bookingId, text, { escalate });
    setBusy(false);
    if (error) { showToast?.(error.message || 'Could not send.'); return; }
    setDraft('');
    showToast?.(escalate ? 'Escalated to Cergio — support will review.' : 'Reply sent.');
    load();
    onChange?.();
  };

  return (
    <div className="bg-white border-2 border-salmon/30 rounded-[18px] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-body-sm font-extrabold text-black leading-snug">
          {serviceTitle} · {otherName}
        </p>
        <Stars value={stars} />
      </div>

      {/* Role-specific framing (Tarik's copy) */}
      {isProvider ? (
        <p className="text-meta text-b2 leading-snug mt-1.5">
          {otherFirst} rated your job <span className="font-extrabold">{stars}★</span>. For the Instagram
          post to go live, Connectors need to rate <span className="font-extrabold">4★+</span>. If you
          disagree, share your comment here for {otherFirst} to reply to.
        </p>
      ) : (
        <p className="text-meta text-b2 leading-snug mt-1.5">
          You rated {otherFirst} <span className="font-extrabold">{stars}★</span>. Your review is private
          and shared with them — they can reply. Re-rate 4★+ to release the spotlight.
        </p>
      )}

      {/* The rating comment */}
      {comment && (
        <p className="text-meta text-b2 italic leading-snug mt-2 bg-bg5 rounded-[10px] px-3 py-2">
          &ldquo;{comment}&rdquo;
        </p>
      )}

      {/* Thread */}
      {thread.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {thread.map(m => (
            <div key={m.id} className={`rounded-[10px] px-3 py-2 ${m.is_escalation ? 'bg-warnBg border border-warn/40' : 'bg-gl'}`}>
              <p className="text-meta-sm font-extrabold text-b2">
                {m.senderName}{m.is_escalation ? ' · escalated to Cergio' : ''}
              </p>
              <p className="text-meta text-black leading-snug">{m.body}</p>
            </div>
          ))}
        </div>
      )}

      {escalated && (
        <p className="text-meta-sm font-extrabold text-warnText mt-2">
          Escalated to Cergio — support is reviewing this dispute.
        </p>
      )}

      {/* Reply / escalate */}
      <div className="mt-2.5">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={2}
          placeholder={isProvider ? 'Reply to the rating…' : 'Reply to the provider…'}
          className="w-full bg-bg5 rounded-[12px] px-3 py-2.5 text-body-sm text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none"
        />
        <div className="flex items-center gap-2 mt-2">
          <button type="button" disabled={busy} onClick={() => send(false)}
            className="flex-1 bg-g text-white rounded-[12px] py-2.5 text-body-sm font-extrabold disabled:opacity-60">
            {busy ? 'Sending…' : 'Send reply'}
          </button>
          {isProvider && !escalated && (
            <button type="button" disabled={busy} onClick={() => send(true)}
              className="rounded-[12px] px-3 py-2.5 text-body-sm font-extrabold text-salmon border border-salmon/40 disabled:opacity-60">
              Escalate
            </button>
          )}
        </div>
      </div>

      <p className="text-meta-sm text-b3 leading-snug mt-2">
        Private — not public. Cergio is built on truthful reviews from trusted friends, not gamed reviews from strangers.
      </p>
    </div>
  );
}
