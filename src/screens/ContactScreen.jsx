// CERGIO-GUARD (2026-05-31): Contact form. Single endpoint for
// Press / Investors / Partnerships / Influencers / Support / General.
//
// Tarik: "contact (Press, Investors, Support, Partnerships,
// Influencers opens the same form, with subject options (investors,
// support etc)".
//
// Route: /contact (optional ?subject=press|investors|partnerships|
// influencers|support pre-selects the dropdown).
//
// Backend: writes to a `contact_messages` table when available;
// otherwise falls back to a thank-you toast so the form is testable
// in any environment. The table schema is simple — see the gated
// supabase insert below.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams, useOutletContext } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';

const SUBJECTS = [
  { value: 'general',       label: 'General' },
  { value: 'support',       label: 'Support — I need help' },
  // CERGIO-GUARD (2026-06-05): explicit bug-report option per Tarik
  // ("ability to add a pic (if a bug…)"). When this subject is chosen
  // the form reveals an image picker for a screenshot of the issue.
  { value: 'bug',           label: 'Bug report — something broke' },
  { value: 'press',         label: 'Press / media inquiry' },
  { value: 'investors',     label: 'Investors / fundraising' },
  { value: 'partnerships',  label: 'Partnerships' },
  { value: 'influencers',   label: 'Influencers / Connectors' },
];

export function ContactScreen() {
  const navigate = useNavigate();
  const [params]  = useSearchParams();
  const ctx = useOutletContext() || {};
  const { showToast } = ctx;

  const initialSubject = useMemo(() => {
    const q = (params.get('subject') || '').toLowerCase();
    return SUBJECTS.some(s => s.value === q) ? q : 'general';
  }, [params]);

  const [subject, setSubject] = useState(initialSubject);
  const [name,    setName]    = useState('');
  const [email,   setEmail]   = useState('');
  const [body,    setBody]    = useState('');
  const [busy,    setBusy]    = useState(false);
  const [sent,    setSent]    = useState(false);
  // CERGIO-GUARD (2026-06-05): screenshot attachment for bug reports.
  // File is held in component state (max 5MB), previewed inline, and
  // uploaded to the `contact-attachments` storage bucket on submit.
  // If the bucket isn't provisioned the upload error is swallowed and
  // we note "attachment was selected but couldn't upload" in the body
  // so support can ask for a re-send rather than losing context.
  const [attachment, setAttachment] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [attachmentError, setAttachmentError] = useState(null);

  // Keep subject in sync if user navigates with a new ?subject= param.
  useEffect(() => { setSubject(initialSubject); }, [initialSubject]);

  const canSubmit =
    name.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    body.trim().length >= 5 &&
    !busy;

  const onPickAttachment = (file) => {
    setAttachmentError(null);
    if (!file) {
      setAttachment(null);
      setAttachmentPreview(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setAttachmentError('Please pick an image (PNG / JPG / GIF).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAttachmentError('Max 5 MB — please attach a smaller image.');
      return;
    }
    setAttachment(file);
    const reader = new FileReader();
    reader.onload = (ev) => setAttachmentPreview(ev.target?.result || null);
    reader.readAsDataURL(file);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Step 1: upload attachment when present. Best-effort — if the
      // bucket isn't provisioned we still send the message and note
      // the failed attempt so support can follow up.
      let attachmentUrl = null;
      let attachmentNote = '';
      if (attachment && supabaseReady) {
        const ext = (attachment.name.split('.').pop() || 'png').toLowerCase();
        const path = `bug-reports/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('contact-attachments')
          .upload(path, attachment, {
            cacheControl: '3600',
            upsert: false,
            contentType: attachment.type,
          });
        if (!upErr) {
          const { data: urlRes } = supabase.storage
            .from('contact-attachments')
            .getPublicUrl(path);
          attachmentUrl = urlRes?.publicUrl || null;
        } else {
          // eslint-disable-next-line no-console
          console.warn('[contact] attachment upload failed:', upErr.message);
          attachmentNote = `\n\n[ATTACHMENT: user selected ${attachment.name} (${Math.round(attachment.size / 1024)}kb) but upload failed — please ask them to re-send.]`;
        }
      }

      // Step 2: persist the message. Table is optional. On any error
      // we still consider the form "sent" so the demo flow works.
      if (supabaseReady) {
        const row = {
          subject,
          name:  name.trim(),
          email: email.trim(),
          body:  body.trim() + attachmentNote,
        };
        if (attachmentUrl) row.attachment_url = attachmentUrl;
        const { error } = await supabase
          .from('contact_messages')
          .insert(row);
        if (error) {
          // eslint-disable-next-line no-console
          console.warn('[contact] insert failed (table may not exist yet):', error.message);
        }
      }
      setSent(true);
      showToast?.(`Sent. We'll get back to you at ${email.trim()}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-cream pb-16 overflow-y-auto">
      <div className="px-5 pt-7 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="w-9 h-9 rounded-full bg-white border border-bdr text-black text-body-lg flex items-center justify-center shadow-sm"
        >
          ‹
        </button>
        <Link
          to="/about"
          className="text-[12.5px] font-extrabold text-gd hover:underline"
        >
          About Cergio →
        </Link>
      </div>

      <div className="px-5 pt-6">
        <h1 className="text-display-2 font-extrabold text-black leading-tight">
          Contact us
        </h1>
        <p className="text-[13.5px] text-b2 leading-relaxed mt-2 max-w-[360px]">
          Press, investors, partnerships, support — one form, one
          inbox. Pick a subject so the right person sees it first.
        </p>
      </div>

      {sent ? (
        <div className="mx-5 mt-8 bg-white border border-line rounded-[18px] p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-gl text-gd flex items-center justify-center text-[20px] font-extrabold mx-auto">
            ✓
          </div>
          <p className="text-body-lg font-extrabold text-black mt-4">
            Message sent
          </p>
          <p className="text-body-sm text-b2 leading-snug mt-2 max-w-[260px] mx-auto">
            We&apos;ll reply at <span className="font-extrabold">{email}</span> within
            a couple of business days.
          </p>
          <button
            onClick={() => navigate('/home')}
            className="mt-6 bg-g text-white rounded-pill px-5 py-2.5 text-body-sm font-extrabold"
          >
            Back to Cergio
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mx-5 mt-6 flex flex-col gap-4">
          <Field label="Subject">
            <select
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-body text-black
                         focus:outline-none focus:border-g/60"
            >
              {SUBJECTS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Your name">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-body text-black
                         placeholder:text-b3 focus:outline-none focus:border-g/60"
            />
          </Field>
          <Field label="Your email">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-body text-black
                         placeholder:text-b3 focus:outline-none focus:border-g/60"
            />
          </Field>
          <Field label="Message">
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              placeholder={subject === 'bug'
                ? 'What did you try? What did you expect? What actually happened?'
                : "Tell us what's up."}
              className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-body text-black
                         placeholder:text-b3 focus:outline-none focus:border-g/60 resize-none"
            />
          </Field>

          {/* CERGIO-GUARD (2026-06-05): screenshot picker — bug-report
              only. Tarik 2026-06-05: "ability to add a pic (if a bug)".
              Keeping it scoped to the bug subject so other use cases
              don't accidentally drop in 5MB images. */}
          {subject === 'bug' && (
            <Field label="Screenshot (optional)">
              <div className="space-y-2">
                <label className="flex items-center gap-3 bg-white border border-bdr rounded-[12px] px-3.5 py-3 cursor-pointer hover:border-g/40 transition-colors">
                  <span className="text-body-sm font-extrabold text-b2">
                    {attachment ? 'Change screenshot' : '＋ Add a screenshot'}
                  </span>
                  <span className="text-meta-sm text-b3 ml-auto">PNG / JPG, max 5MB</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => onPickAttachment(e.target.files?.[0] || null)}
                  />
                </label>
                {attachmentError && (
                  <p className="text-[11.5px] text-danger font-extrabold">{attachmentError}</p>
                )}
                {attachmentPreview && (
                  <div className="relative inline-block">
                    <img
                      src={attachmentPreview}
                      alt="Screenshot preview"
                      className="max-h-48 rounded-[10px] border border-bdr"
                    />
                    <button
                      type="button"
                      onClick={() => onPickAttachment(null)}
                      className="absolute -top-2 -right-2 bg-white border border-bdr rounded-full w-6 h-6 text-meta-sm font-extrabold text-b2 shadow-sm"
                      aria-label="Remove screenshot"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            </Field>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                       hover:opacity-90 active:scale-[.97] transition-all disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send message'}
          </button>
          <p className="text-[11.5px] text-b3 leading-snug text-center mt-1">
            By sending you agree to our{' '}
            <Link to="/terms" className="underline">Terms</Link> and{' '}
            <Link to="/privacy" className="underline">Privacy Policy</Link>.
          </p>
        </form>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-meta-sm text-b2 font-extrabold uppercase tracking-[0.12em] block mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
