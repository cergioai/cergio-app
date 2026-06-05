// CERGIO-GUARD (2026-05-29): unified Recommend flow.
//
// REPLACES the old dual-path popup (Recommend from contacts vs Write
// a recommendation) which Tarik flagged as confusing.
//
// CERGIO-GUARD (2026-06-04 v8): one-at-a-time wizard per Tarik —
// "the reco form from the invite is wrong... services can only be
// recommended one at a time." Same three inputs, but now exposed in
// three sequential steps with a pill summary at top once a step is
// completed. The user makes one decision per screen, never sees a
// long form. Step 3's CTA reads "Send to {firstName}" so the action
// is unambiguous.
//
// Submit fires notify-user with the `service_recommended` event so the
// recipient gets the actual email/SMS, plus writes a row to the
// recommendations table so the user has a personal record + EarningsScreen
// can count it (qa #27).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { REWARDS } from '../lib/rewards';
import { notifyUser, listInvitableProfiles } from '../lib/api';
import { buildInviteUrl } from '../lib/referral';
import { supabase, supabaseReady } from '../lib/supabase';

const supportsContactPicker = typeof navigator !== 'undefined' &&
  'contacts' in navigator && 'ContactsManager' in window;

const COMMON_SERVICE_TYPES = [
  'House Cleaner', 'Plumber', 'Electrician', 'Handyman',
  'Babysitter', 'Tutor', 'Personal Trainer', 'Hairstylist',
  'Photographer', 'Personal Chef', 'Dog Walker', 'Mover',
];

function isPlausiblePhone(s) {
  const digits = String(s || '').replace(/\D+/g, '');
  return digits.length >= 7;
}
function isPlausibleEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

export function RecommendServiceFormScreen() {
  const navigate = useNavigate();
  const { showToast, auth } = useOutletContext();

  // ── Wizard state ─────────────────────────────────────────────────────
  // 1 = service type, 2 = recipient, 3 = blurb. Forward only when the
  // current step is valid; back is always allowed.
  const [step, setStep] = useState(1);

  // ── Step 1: service type ─────────────────────────────────────────────
  const [serviceType, setServiceType] = useState('');

  // ── Step 2: recipient ────────────────────────────────────────────────
  const [synced, setSynced] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [seededPool, setSeededPool] = useState([]);
  useEffect(() => {
    let cancelled = false;
    listInvitableProfiles({ limit: 200 }).then(({ data }) => {
      if (!cancelled) setSeededPool(data || []);
    });
    return () => { cancelled = true; };
  }, []);
  const hasSynced = synced.length > 0;
  const pool = useMemo(
    () => hasSynced ? synced : seededPool,
    [hasSynced, synced, seededPool],
  );

  const [name,  setName]  = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [pickedId, setPickedId] = useState(null);
  const [focused, setFocused] = useState(false);
  const nameRef = useRef(null);

  const matches = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q || pickedId) return [];
    return pool
      .filter(c => (c.name || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [name, pool, pickedId]);

  const pickMatch = (c) => {
    setName(c.name || '');
    setPhone(c.phone || '');
    setEmail(c.email || '');
    setPickedId(c.id || `pick-${Date.now()}`);
    setFocused(false);
  };
  const clearPick = () => {
    setPickedId(null);
    nameRef.current?.focus();
  };

  // ── Step 3: blurb ────────────────────────────────────────────────────
  const [blurb, setBlurb] = useState('');
  const [busy, setBusy]   = useState(false);

  const hasContact  = isPlausiblePhone(phone) || isPlausibleEmail(email);
  const step1Valid  = serviceType.trim().length > 0;
  const step2Valid  = name.trim().length > 0 && hasContact;
  const step3Valid  = blurb.trim().length > 0;
  const allValid    = step1Valid && step2Valid && step3Valid;
  const remaining   = Math.max(0, 280 - blurb.length);

  const connectContacts = async () => {
    if (!supportsContactPicker) {
      if (seededPool.length > 0) {
        setSynced(seededPool);
        showToast(`${seededPool.length} sample contacts loaded — start typing a name.`);
        nameRef.current?.focus();
      } else {
        showToast('No contacts available yet. Try again in a moment.');
      }
      return;
    }
    setSyncing(true);
    try {
      const result = await navigator.contacts.select(
        ['name', 'tel', 'email'],
        { multiple: true },
      );
      const mapped = (result || []).map((c, i) => ({
        id:    `synced-${i}`,
        name:  (c.name  || [])[0] || '',
        phone: (c.tel   || [])[0] || '',
        email: (c.email || [])[0] || '',
      })).filter(c => c.name);
      if (!mapped.length) { showToast('No contacts picked.'); return; }
      setSynced(mapped);
      showToast(`${mapped.length} contacts ready — start typing a name.`);
      nameRef.current?.focus();
    } catch (e) {
      showToast(e?.message || 'Contact picker cancelled');
    } finally {
      setSyncing(false);
    }
  };

  const submit = async () => {
    if (!allValid || busy) return;
    setBusy(true);
    try {
      const recipient = {
        name:  name.trim(),
        email: isPlausibleEmail(email) ? email.trim() : undefined,
        phone: isPlausiblePhone(phone) ? phone.trim() : undefined,
      };
      const svcType = serviceType.trim();
      const { error } = await notifyUser({
        event: 'service_recommended',
        recipient,
        data: {
          recommender_name: auth?.user?.user_metadata?.display_name || 'A friend',
          recommender_id:   auth?.user?.id || '',
          service_title:    svcType || 'a service on Cergio',
          deep_link:        buildInviteUrl(auth?.user?.id),
          blurb:            blurb.trim(),
        },
      });
      if (error) {
        showToast(`Send failed: ${error.message}`);
        return;
      }
      if (supabaseReady && auth?.user?.id) {
        const messagePersist = svcType
          ? `[${svcType}] ${blurb.trim()}`
          : blurb.trim();
        const { error: recoErr } = await supabase
          .from('recommendations')
          .insert({
            recommender_id:  auth.user.id,
            inviter_id:      auth.user.id,
            recipient_phone: recipient.phone || null,
            service_id:      null,
            message:         messagePersist,
          });
        if (recoErr) {
          // eslint-disable-next-line no-console
          console.warn('[reco] could not write recommendations row:', recoErr.message);
        }
      }
      showToast(`Sent to ${recipient.name} ✓`);
      navigate('/earnings');
    } finally {
      setBusy(false);
    }
  };

  const initials = name
    .split(' ')
    .map(s => s[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

  const firstName = name.trim().split(' ')[0];

  // ── Wizard navigation ────────────────────────────────────────────────
  const goNext = () => {
    if (step === 1 && step1Valid) setStep(2);
    else if (step === 2 && step2Valid) setStep(3);
  };
  const goBack = () => {
    if (step === 1) navigate(-1);
    else setStep(step - 1);
  };

  // CTA label per step. Step 3 is the final submit.
  const ctaLabel = step === 3
    ? (busy ? 'Sending…' : step3Valid ? `Send to ${firstName}` : 'Write a quick blurb to send')
    : step === 2
      ? (step2Valid ? 'Next' : 'Pick or type a friend')
      : (step1Valid ? 'Next' : 'Pick a service type to continue');
  const ctaReady = step === 3 ? (allValid && !busy) : (step === 2 ? step2Valid : step1Valid);

  return (
    <div className="flex-1 flex flex-col bg-cream pb-32">
      {/* Top bar — back arrow + step indicator */}
      <div className="px-5 pt-5 flex items-center gap-3">
        <button
          onClick={goBack}
          aria-label="Back"
          className="text-2xl text-black font-bold w-9 h-9 flex items-center justify-center"
        >
          ‹
        </button>
        <div className="flex-1 flex items-center justify-center gap-1.5" role="presentation" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map(n => (
            <span
              key={n}
              className={`h-1.5 rounded-full transition-all ${n === step ? 'w-7 bg-g' : n < step ? 'w-3 bg-g/50' : 'w-3 bg-bdr'}`}
            />
          ))}
        </div>
        <span className="w-9" aria-hidden="true" />
      </div>

      <div className="px-5 pt-2 pb-3">
        <h1 className="text-[22px] font-extrabold text-black leading-tight">
          Recommend a service
        </h1>
        <p className="text-[12px] text-gd font-extrabold mt-1.5">
          Earn up to ${REWARDS.perFriend} per friend who books from your recommendation.
        </p>
      </div>

      {/* Completed-step pill summary (live so the user feels the wizard
          accruing context). Service shows from step 2; recipient shows
          from step 3. */}
      {step >= 2 && (
        <div className="px-5 mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="inline-flex items-center gap-1.5 bg-white border border-bdr rounded-pill px-3 py-1.5 text-[12px] font-extrabold text-black hover:bg-bg5/40 transition-colors"
          >
            <span className="text-b3 uppercase tracking-wide text-[9.5px]">Service</span>
            <span>{serviceType}</span>
            <span className="text-gd">›</span>
          </button>
          {step >= 3 && firstName && (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1.5 bg-white border border-bdr rounded-pill px-3 py-1.5 text-[12px] font-extrabold text-black hover:bg-bg5/40 transition-colors"
            >
              <span className="text-b3 uppercase tracking-wide text-[9.5px]">To</span>
              <span>{firstName}</span>
              <span className="text-gd">›</span>
            </button>
          )}
        </div>
      )}

      {/* ── Step 1 — service type ───────────────────────────────────── */}
      {step === 1 && (
        <div className="px-5 flex-1 flex flex-col">
          <p className="text-[15px] text-b2 leading-snug mb-4">
            What service are you recommending?
          </p>
          <input
            type="text"
            autoFocus
            value={serviceType}
            onChange={e => setServiceType(e.target.value)}
            list="reco-service-types"
            placeholder="e.g. Plumber, Tutor, Cleaner…"
            className="w-full bg-white border border-bdr rounded-[14px] px-4 py-3.5 text-[15px]
                       text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
            onKeyDown={e => { if (e.key === 'Enter' && step1Valid) goNext(); }}
          />
          <datalist id="reco-service-types">
            {COMMON_SERVICE_TYPES.map(t => <option key={t} value={t} />)}
          </datalist>
          {/* Chip shortcuts — tap to auto-fill + advance. */}
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-b3 mt-5 mb-2.5">
            Common
          </p>
          <div className="flex flex-wrap gap-2">
            {COMMON_SERVICE_TYPES.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => { setServiceType(t); setStep(2); }}
                className={`px-3 py-1.5 rounded-pill text-[12.5px] font-extrabold border transition-colors
                  ${serviceType === t
                    ? 'bg-g text-white border-g'
                    : 'bg-white text-b2 border-bdr hover:border-g/40 hover:text-black'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 2 — recipient ──────────────────────────────────────── */}
      {step === 2 && (
        <div className="px-5 flex-1 flex flex-col">
          <p className="text-[15px] text-b2 leading-snug mb-4">
            Who are you recommending {serviceType} to?
          </p>

          {/* Connect contacts (only on initial entry to step 2). */}
          {!hasSynced && (
            <div className="mb-3 bg-white border border-bdr rounded-[14px] p-3.5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-[10px] bg-gl flex items-center justify-center flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M22 11l-3 3-3-3M19 14V2"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-extrabold text-black leading-tight">
                  Plug in your contacts
                </p>
                <p className="text-[11.5px] text-b3 mt-0.5 leading-snug">
                  We auto-fill name + phone + email as you type.
                </p>
              </div>
              <button
                onClick={connectContacts}
                disabled={syncing}
                className="bg-g text-white rounded-pill px-3.5 py-1.5 text-[12px] font-extrabold disabled:opacity-60"
              >
                {syncing ? '…' : 'Connect'}
              </button>
            </div>
          )}

          <div className="bg-white border border-bdr rounded-[18px] p-3.5 flex flex-col gap-2.5">
            {pickedId && (
              <div className="flex items-center gap-2 bg-gl border border-g/30 rounded-pill px-3 py-1 self-start">
                <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center text-gd text-[10px] font-extrabold">
                  {initials}
                </div>
                <span className="text-[11px] font-extrabold text-gd">From contacts</span>
                <button
                  onClick={clearPick}
                  aria-label="Edit manually"
                  className="text-gd text-[11px] font-bold ml-0.5"
                >
                  ×
                </button>
              </div>
            )}

            <div className="relative">
              <input
                ref={nameRef}
                type="text"
                autoFocus
                value={name}
                onChange={e => { setName(e.target.value); if (pickedId) setPickedId(null); }}
                onFocus={() => setFocused(true)}
                onBlur={() => setTimeout(() => setFocused(false), 150)}
                placeholder="Friend's name"
                className="w-full bg-bg5/40 rounded-[10px] px-3 py-2.5 text-[14px] font-bold
                           text-black placeholder-b3 outline-none focus:bg-white focus:ring-2 focus:ring-g/30"
              />
              {focused && matches.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-bdr
                                rounded-[14px] shadow-card overflow-hidden z-10 max-h-[260px] overflow-y-auto">
                  {matches.map(c => (
                    <button
                      key={c.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickMatch(c)}
                      className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-bg5/40 text-left
                                 border-b border-bdr last:border-0"
                    >
                      <div className="w-8 h-8 rounded-full bg-bg5 flex items-center justify-center text-black text-[12px] font-extrabold flex-shrink-0">
                        {c.name.split(' ').map(s => s[0] || '').slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-extrabold text-black truncate">{c.name}</p>
                        <p className="text-[11px] text-b3 truncate">{c.email || c.phone || ''}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="Phone"
                className="flex-1 bg-bg5/40 rounded-[10px] px-3 py-2.5 text-[13px] font-bold
                           text-black placeholder-b3 outline-none focus:bg-white focus:ring-2 focus:ring-g/30"
              />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email"
                className="flex-1 bg-bg5/40 rounded-[10px] px-3 py-2.5 text-[13px] font-bold
                           text-black placeholder-b3 outline-none focus:bg-white focus:ring-2 focus:ring-g/30"
              />
            </div>
            <p className="text-[11px] text-b3 leading-snug">
              Either phone or email is enough — that's how we send the recommendation.
            </p>
          </div>
        </div>
      )}

      {/* ── Step 3 — blurb ──────────────────────────────────────────── */}
      {step === 3 && (
        <div className="px-5 flex-1 flex flex-col">
          <p className="text-[15px] text-b2 leading-snug mb-4">
            Why would <span className="font-extrabold text-black">{firstName}</span> book {serviceType.toLowerCase()}?
          </p>
          <textarea
            autoFocus
            value={blurb}
            onChange={e => setBlurb(e.target.value)}
            maxLength={280}
            placeholder={`Try: "Maria did our deep clean before move-out — fast, friendly, fair price."`}
            className="w-full h-[200px] bg-white border border-bdr rounded-[18px] p-4 text-[15px] text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans leading-relaxed"
          />
          <p className="text-[11px] text-b3 mt-2 text-right">{remaining} characters left</p>
          {step3Valid && (
            <p className="text-[11.5px] text-b3 leading-snug mt-3">
              We'll send {firstName} this blurb + a one-tap link to book. You earn when they book.
            </p>
          )}
        </div>
      )}

      {/* Sticky bottom CTA */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] bg-cream border-t border-bdr px-5 pt-3 pb-5">
        <button
          onClick={step === 3 ? submit : goNext}
          disabled={!ctaReady}
          className={`w-full rounded-[24px] py-4 text-[16px] font-extrabold transition-all
            ${ctaReady
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
