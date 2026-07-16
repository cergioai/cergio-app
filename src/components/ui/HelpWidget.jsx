// CERGIO-GUARD (2026-07-15, crack-help-haiku): the app-wide Help entry.
//
// A small floating "Help" button (bottom-right, above the BottomNav) mounted in
// the shared Layout — NOT per-screen. Tapping it opens a bottom-sheet with a
// subject + message + optional screenshot. On submit it opens a support_ticket
// and fires the AI triage ladder (support-triage: Haiku → Opus → human). The
// AI's reply (when it resolved) is shown inline; otherwise the user is told a
// teammate will follow up. No fake data — every state is real.
//
// Styling is design-spec tokens only (g / black / b3 / bdr / bg5 / meta scale),
// mirroring the other bottom-sheet modals (RecommendProviderModal etc.).
import { useState } from 'react';
import { createSupportTicket } from '../../lib/api';
import { uploadSupportScreenshot } from '../../lib/storage';

export function HelpWidget({ visible = true, userEmail = '' }) {
  const [open, setOpen]         = useState(false);
  const [subject, setSubject]   = useState('');
  const [message, setMessage]   = useState('');
  const [email, setEmail]       = useState('');
  const [file, setFile]         = useState(null);
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);
  const [result, setResult]     = useState(null); // { stage, reply } after submit

  if (!visible) return null;

  const needEmail = !userEmail; // logged-out users must give us a reply address

  const reset = () => {
    setSubject(''); setMessage(''); setEmail(''); setFile(null);
    setErr(null); setResult(null); setBusy(false);
  };
  const close = () => { setOpen(false); reset(); };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    if (!message.trim()) { setErr('Tell us what you need help with.'); return; }
    if (needEmail && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setErr('Add an email so we can reply.'); return;
    }
    setBusy(true); setErr(null);

    // Optional screenshot — best-effort; a failed upload NEVER blocks the ticket.
    let screenshotUrl = null;
    if (file) {
      const { url } = await uploadSupportScreenshot(file);
      screenshotUrl = url || null; // null → submitted as a follow-up
    }

    const { data, error } = await createSupportTicket({
      subject, body: message, email: email || userEmail, screenshotUrl,
    });
    setBusy(false);
    if (error) { setErr(error.message || 'Could not send — please try again.'); return; }

    const tri = data?.triage || null;
    if (tri?.resolved && tri?.reply) {
      setResult({ stage: tri.stage, reply: tri.reply });
    } else {
      setResult({
        stage: 'human',
        reply: tri?.reply
          || "Thanks — we've got your message and a teammate will get back to you shortly."
          + (screenshotUrl ? '' : file ? ' (We couldn’t attach your screenshot, but your message came through.)' : ''),
      });
    }
  };

  return (
    <>
      {/* Floating launcher — above the BottomNav, inside the phone column. */}
      {!open && (
        <button
          type="button"
          aria-label="Get help"
          onClick={() => setOpen(true)}
          className="absolute bottom-20 right-4 z-[10000] flex items-center gap-1.5
                     bg-g text-white rounded-full pl-3 pr-4 py-2.5 shadow-lg
                     hover:opacity-90 active:scale-[.96] transition-all"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1-1.3 1.8v.5" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="17.5" r="1.1" fill="currentColor" />
            <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
          </svg>
          <span className="text-[14px] font-extrabold">Help</span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[10003] bg-black/40 flex items-end justify-center" onClick={close}>
          <div
            className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 pb-7 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-4" />

            {result ? (
              // ── Post-submit: show the AI's answer or the human-handoff note ──
              <div className="flex flex-col gap-3">
                <h2 className="text-[20px] font-extrabold text-black leading-tight">
                  {result.stage === 'human' ? 'Passed to the team' : 'Here’s a hand'}
                </h2>
                <div className="bg-gl rounded-[14px] px-4 py-3 text-body-sm text-black leading-relaxed whitespace-pre-wrap">
                  {result.reply}
                </div>
                <p className="text-meta text-b3 leading-relaxed">
                  {result.stage === 'human'
                    ? 'We’ll reply by email. You can close this now.'
                    : 'Did that help? If not, reply and we’ll get a teammate on it.'}
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="w-full rounded-[24px] py-3.5 text-[15px] font-extrabold bg-g text-white hover:opacity-90 active:scale-[.97]"
                >
                  Done
                </button>
                {result.stage !== 'human' && (
                  <button
                    type="button"
                    onClick={reset}
                    className="w-full text-body-sm font-extrabold text-b3 py-1"
                  >
                    Ask something else
                  </button>
                )}
              </div>
            ) : (
              // ── The form ──
              <form onSubmit={submit} className="flex flex-col gap-3">
                <h2 className="text-[20px] font-extrabold text-black leading-tight">How can we help?</h2>
                <p className="text-meta text-b3 leading-relaxed -mt-1">
                  Ask a question or report an issue. Our support assistant answers instantly, and a
                  teammate steps in for anything about your account, payments, or a bug.
                </p>

                <div>
                  <label className="block text-meta font-extrabold text-black mb-1">Subject <span className="text-b3 font-semibold">(optional)</span></label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. How do free bookings work?"
                    className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-body-sm text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
                  />
                </div>

                <div>
                  <label className="block text-meta font-extrabold text-black mb-1">Message</label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    autoFocus
                    placeholder="Tell us what's going on…"
                    className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-body-sm text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none"
                  />
                </div>

                {needEmail && (
                  <div>
                    <label className="block text-meta font-extrabold text-black mb-1">Your email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@email.com"
                      className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-body-sm text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-meta font-extrabold text-black mb-1">Screenshot <span className="text-b3 font-semibold">(optional)</span></label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="block w-full text-meta text-b3 file:mr-3 file:rounded-full file:border-0 file:bg-gl file:px-3 file:py-1.5 file:text-meta file:font-extrabold file:text-gd"
                  />
                </div>

                {err && <p className="text-meta text-danger font-extrabold">{err}</p>}

                <button
                  type="submit"
                  disabled={busy || !message.trim()}
                  className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all
                    ${message.trim() && !busy
                      ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                      : 'bg-bg5 text-b3 cursor-not-allowed'}`}
                >
                  {busy ? 'Sending…' : 'Send'}
                </button>
                <button type="button" onClick={close} disabled={busy}
                        className="w-full text-body-sm font-extrabold text-b3 py-1 disabled:opacity-50">
                  Cancel
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
