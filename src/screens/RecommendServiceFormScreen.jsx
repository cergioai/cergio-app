// CERGIO-GUARD (2026-05-29): unified Recommend flow.
//
// REPLACES the old dual-path popup (Recommend from contacts vs Write
// a recommendation) which Tarik flagged as confusing — the contacts
// picker looked like it was asking the user to pick a SERVICE, not
// a recipient, and the second path was redundant.
//
// New model: ONE screen. Recipient can be provided two ways, merged
// into the same form:
//   1. Pick from contacts — autosuggests as you type; tap to autofill
//      name + phone + email from the picked contact.
//   2. Type manually — if the person isn't in your contacts, just type
//      their name + (phone OR email). No second screen, no redirects.
//
// Submit fires notify-user with the `service_recommended` event so the
// recipient gets the actual email/SMS, plus writes a row to the
// recommendations table so the user has a personal record + EarningsScreen
// can count it (qa #27).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
// CERGIO-GUARD (2026-05-30): pool now comes from real profiles +
// synthesized phone/email (listInvitableProfiles). Was reading the
// CONTACTS mock — Tarik: "wire this to contacts (seed with fake
// data..)". Seeded test friends (Alex / Connie / Sam / etc.) are
// returned with deterministic synthesized contact channels so the
// form is usable end-to-end against real DB rows.
import { REWARDS } from '../lib/rewards';
import { notifyUser, listInvitableProfiles } from '../lib/api';
import { buildInviteUrl } from '../lib/referral';
import { supabase, supabaseReady } from '../lib/supabase';

const supportsContactPicker = typeof navigator !== 'undefined' &&
  'contacts' in navigator && 'ContactsManager' in window;

// Very loose validators — we want to fail closed only on obviously-wrong
// input. Real validation happens server-side when notify-user fires.
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

  // Synced phone contacts (this session only). Fallback to the seeded
  // pool (real profiles via listInvitableProfiles) when the user hasn't
  // synced — keeps autosuggest useful for first-timers and pre-launch
  // testing alike.
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

  // Unified recipient state — name + phone + email + an optional pickedId
  // that flags "this came from contacts" so we can show a subtle indicator.
  // Editing the name after a pick clears pickedId (back to manual mode).
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

  // Pick a contact from the autosuggest list — autofills the three fields.
  const pickMatch = (c) => {
    setName(c.name || '');
    setPhone(c.phone || '');
    setEmail(c.email || '');
    setPickedId(c.id || `pick-${Date.now()}`);
    setFocused(false);
  };
  // Reset to fully-manual mode (clears the picked indicator only; lets the
  // user edit any field freely).
  const clearPick = () => {
    setPickedId(null);
    nameRef.current?.focus();
  };

  // CERGIO-GUARD (2026-05-29): service type the user is recommending
  // (Plumber, Tutor, Cleaner, ...). User caught this gap — the form
  // sent the recipient a generic "a service on Cergio" blurb without
  // saying WHAT was being recommended. Free text; passed through to
  // notify-user data.service_title so the email/SMS reads naturally,
  // and prepended to the saved message so the recommendations row
  // carries the context.
  const [serviceType, setServiceType] = useState('');

  // Blurb state.
  const [blurb, setBlurb] = useState('');
  const [busy, setBusy]   = useState(false);
  const hasContact  = isPlausiblePhone(phone) || isPlausibleEmail(email);
  const valid       = name.trim().length > 0 && hasContact && blurb.trim().length > 0 && serviceType.trim().length > 0;
  const remaining   = Math.max(0, 280 - blurb.length);

  // ── Contact Picker API — Chrome Android + iOS PWA only. Pulls real
  // contacts into the autosuggest pool for the rest of the session.
  // CERGIO-GUARD (2026-05-30): on platforms without
  // navigator.contacts (every desktop browser), the button used to
  // show a "not supported" toast and bail. Tarik: "connect on reco
  // form still not connecting to contacts.. (seed with data..) so
  // test reco's invites". New behaviour: when navigator.contacts
  // isn't available, the Connect button promotes the seeded pool
  // (real DB profiles + deterministic synthesized phone/email from
  // listInvitableProfiles) into `synced` so the autosuggest is
  // unambiguously primed + the "Connect" CTA disappears. End-to-end
  // testable from any browser.
  const connectContacts = async () => {
    if (!supportsContactPicker) {
      // Fall through to the seeded pool — populate `synced` so the
      // Connect card disappears and the autosuggest is primed.
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
    if (!valid || busy) return;
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
          // CERGIO-GUARD: deep_link MUST be the inviter's tracked URL so
          // the recipient's signup → first booking credits this user.
          deep_link:        buildInviteUrl(auth?.user?.id),
          blurb:            blurb.trim(),
        },
      });
      if (error) {
        showToast(`Send failed: ${error.message}`);
        return;
      }
      // CERGIO-GUARD (2026-05-28): write a recommendations row so the
      // user has a personal record + EarningsScreen counts it. Best-
      // effort — if it fails (RLS/schema drift), the email was still
      // sent. qa #27 statically enforces this insert exists.
      if (supabaseReady && auth?.user?.id) {
        // Prepend the service type to the saved message so the
        // recommendations row carries the context. Format: "[Plumber] blurb…"
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

  return (
    <div className="flex-1 flex flex-col bg-cream pb-24">
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-bold w-9 h-9 flex items-center justify-center"
        >
          ‹
        </button>
      </div>

      <div className="px-5 pt-2 pb-4">
        <h1 className="text-[24px] font-extrabold text-black leading-tight">
          Recommend a service
        </h1>
        <p className="text-[13px] text-b3 font-medium leading-snug mt-2">
          Pick a friend from your contacts <span className="text-b2 font-bold">or</span> type
          their info — we send them your blurb and a one-tap link to book.
        </p>
        <p className="text-[12px] text-gd font-extrabold mt-2.5">
          Earn up to ${REWARDS.perFriend} per friend who books from your recommendation.
        </p>
      </div>

      {/* ── Step 1 (optional): connect contacts for autosuggest ───────────── */}
      {!hasSynced && (
        <div className="mx-5 mb-3 bg-white border border-bdr rounded-[14px] p-3.5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-gl flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M22 11l-3 3-3-3M19 14V2"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-extrabold text-black leading-tight">
              Connect your contacts <span className="text-b3 font-medium">(optional)</span>
            </p>
            <p className="text-[12px] text-b3 mt-0.5 leading-snug">
              Type a name and we auto-fill the rest. Skip to type manually.
            </p>
          </div>
          <button
            onClick={connectContacts}
            disabled={syncing}
            className="bg-g text-white rounded-pill px-3.5 py-1.5 text-[12px] font-extrabold
                       disabled:opacity-60"
          >
            {syncing ? '…' : 'Connect'}
          </button>
        </div>
      )}

      {/* ── Step 1.5: what kind of service are you recommending? ─────────── */}
      <div className="px-5 mb-3">
        <label className="block text-[12px] font-extrabold text-b2 mb-1.5 uppercase tracking-wide">
          What service are you recommending?
        </label>
        <input
          type="text"
          value={serviceType}
          onChange={e => setServiceType(e.target.value)}
          list="reco-service-types"
          placeholder="Plumber, Tutor, Cleaner, Photographer…"
          className="w-full bg-white border border-bdr rounded-[14px] px-4 py-3 text-[14px]
                     text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
        />
        <datalist id="reco-service-types">
          <option value="House Cleaner" />
          <option value="Plumber" />
          <option value="Electrician" />
          <option value="Handyman" />
          <option value="Babysitter" />
          <option value="Nanny" />
          <option value="Tutor" />
          <option value="Personal Trainer" />
          <option value="Hairstylist" />
          <option value="Massage Therapist" />
          <option value="Photographer" />
          <option value="Personal Chef" />
          <option value="Dog Walker" />
          <option value="Pet Sitter" />
          <option value="Gardener" />
          <option value="Mover" />
        </datalist>
      </div>

      {/* ── Step 2: recipient — unified pick-or-type ───────────────────────── */}
      <div className="px-5 mb-3">
        <label className="block text-[12px] font-extrabold text-b2 mb-1.5 uppercase tracking-wide">
          Who are you recommending to?
        </label>

        <div className="bg-white border border-bdr rounded-[18px] p-3.5 flex flex-col gap-2.5">
          {/* Picked indicator (only when picked from contacts). Subtle pill
              that confirms autofill source. Tap × to keep the values but
              switch back to manual-edit mode. */}
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

          {/* Name with autosuggest. Always editable; selecting a suggestion
              autofills phone/email below. */}
          <div className="relative">
            <input
              ref={nameRef}
              type="text"
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

      {/* ── Step 3: blurb ─────────────────────────────────────────────────── */}
      <div className="px-5 flex-1">
        <label className="block text-[12px] font-extrabold text-b2 mb-1.5 uppercase tracking-wide">
          Why you'd send them here
        </label>
        <textarea
          value={blurb}
          onChange={e => setBlurb(e.target.value)}
          maxLength={280}
          placeholder={`Try: "Maria did our deep clean before move-out — fast, friendly, fair price."`}
          className="w-full h-[170px] bg-white border border-bdr rounded-[18px] p-4 text-[15px] text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans leading-relaxed"
        />
        <p className="text-[11px] text-b3 mt-2 text-right">{remaining} characters left</p>
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] bg-cream border-t border-bdr px-5 pt-3 pb-5">
        <button
          onClick={submit}
          disabled={!valid || busy}
          className={`w-full rounded-[24px] py-4 text-[16px] font-extrabold transition-all
            ${valid && !busy
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          {busy
            ? 'Sending…'
            : valid
              ? `Send to ${name.trim().split(' ')[0]}`
              : !serviceType.trim()
                ? 'Pick a service type first'
                : (name.trim() && !hasContact)
                  ? 'Add a phone or email'
                  : 'Fill in the form to send'}
        </button>
      </div>
    </div>
  );
}
