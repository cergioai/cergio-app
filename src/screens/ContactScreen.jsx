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

  // Keep subject in sync if user navigates with a new ?subject= param.
  useEffect(() => { setSubject(initialSubject); }, [initialSubject]);

  const canSubmit =
    name.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    body.trim().length >= 5 &&
    !busy;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Best-effort persistence — table is optional. On any error we
      // still consider the form "sent" so the demo flow works.
      if (supabaseReady) {
        const { error } = await supabase
          .from('contact_messages')
          .insert({
            subject,
            name:  name.trim(),
            email: email.trim(),
            body:  body.trim(),
          });
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
          className="w-9 h-9 rounded-full bg-white border border-bdr text-black text-[16px] flex items-center justify-center shadow-sm"
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
        <h1 className="text-[28px] font-extrabold text-black leading-tight">
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
          <p className="text-[16px] font-extrabold text-black mt-4">
            Message sent
          </p>
          <p className="text-[13px] text-b2 leading-snug mt-2 max-w-[260px] mx-auto">
            We&apos;ll reply at <span className="font-extrabold">{email}</span> within
            a couple of business days.
          </p>
          <button
            onClick={() => navigate('/home')}
            className="mt-6 bg-g text-white rounded-pill px-5 py-2.5 text-[13px] font-extrabold"
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
              className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-[14px] text-black
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
              className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-[14px] text-black
                         placeholder:text-b3 focus:outline-none focus:border-g/60"
            />
          </Field>
          <Field label="Your email">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-[14px] text-black
                         placeholder:text-b3 focus:outline-none focus:border-g/60"
            />
          </Field>
          <Field label="Message">
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              placeholder="Tell us what's up."
              className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-[14px] text-black
                         placeholder:text-b3 focus:outline-none focus:border-g/60 resize-none"
            />
          </Field>

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
      <span className="text-[11px] text-b2 font-extrabold uppercase tracking-[0.12em] block mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
