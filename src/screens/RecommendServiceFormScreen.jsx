// Per design-spec.md — manual recommendation form, NOW with contacts
// autosuggest so the user doesn't hand-type a friend's name / email / phone.
//
// Flow:
//   1. If contacts haven't been synced yet → show "Connect contacts" prompt.
//      Tap → Contact Picker API on supported devices (Chrome Android, iOS
//      Safari PWA). Picked contacts get held in component state for this
//      session — they're not persisted.
//   2. Name field auto-suggests against the synced contacts (and the mock
//      CONTACTS list as a fallback when nothing is synced). Tap a result
//      → contact is locked in, phone/email auto-populate, name field shows
//      a green pill with an × to clear.
//   3. Once a contact is locked, the blurb textarea unlocks.
//   4. Send fires notify-user with the `service_recommended` event so the
//      friend gets the actual email / SMS with the user's blurb embedded.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { CONTACTS } from '../data/mock';
import { REWARDS } from '../lib/rewards';
import { notifyUser } from '../lib/api';

const supportsContactPicker = typeof navigator !== 'undefined' &&
  'contacts' in navigator && 'ContactsManager' in window;

export function RecommendServiceFormScreen() {
  const navigate = useNavigate();
  const { showToast, auth } = useOutletContext();

  // Synced phone contacts (this session only). Fallback to mock CONTACTS
  // when the user hasn't synced — keeps autosuggest useful for first-timers.
  const [synced, setSynced] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const hasSynced = synced.length > 0;
  const pool = useMemo(
    () => hasSynced ? synced : CONTACTS,
    [hasSynced, synced],
  );

  // Selected contact + name input state.
  const [picked, setPicked]   = useState(null);   // { name, phone, email }
  const [query, setQuery]     = useState('');
  const [focused, setFocused] = useState(false);
  const nameRef = useRef(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return pool
      .filter(c => (c.name || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, pool]);

  // Blurb state.
  const [blurb, setBlurb] = useState('');
  const [busy, setBusy]   = useState(false);
  const valid = !!picked && blurb.trim().length > 0;
  const remaining = Math.max(0, 280 - blurb.length);

  // ── Contact Picker API — only available on Chrome Android + iOS PWA.
  const connectContacts = async () => {
    if (!supportsContactPicker) {
      showToast("Contact picker isn't supported on this browser. Type a name to use Cergio's sample contacts.");
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
        name:  (c.name || [])[0] || '',
        phone: (c.tel || [])[0] || '',
        email: (c.email || [])[0] || '',
      })).filter(c => c.name);
      if (!mapped.length) {
        showToast('No contacts picked.');
        return;
      }
      setSynced(mapped);
      showToast(`${mapped.length} contacts ready — start typing a name.`);
      nameRef.current?.focus();
    } catch (e) {
      showToast(e?.message || 'Contact picker cancelled');
    } finally {
      setSyncing(false);
    }
  };

  const pickMatch = (c) => {
    setPicked(c);
    setQuery(c.name);
    setFocused(false);
  };
  const clearPick = () => {
    setPicked(null);
    setQuery('');
    nameRef.current?.focus();
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      // If we have email or phone, fire the real notify-user event so the
      // friend gets the email/SMS. If neither, fall back to a toast so the
      // user can copy/paste the blurb themselves.
      const recipient = {
        name:  picked.name,
        email: picked.email || undefined,
        phone: picked.phone || undefined,
      };
      if (!recipient.email && !recipient.phone) {
        showToast(`No email / phone on ${picked.name}. Share the link instead.`);
        return;
      }
      const { error } = await notifyUser({
        event: 'service_recommended',
        recipient,
        data: {
          recommender_name: auth?.user?.user_metadata?.display_name || 'A friend',
          recommender_id:   auth?.user?.id || '',
          service_title:    'a service on Cergio',
          deep_link:        typeof window !== 'undefined' ? window.location.origin : 'https://cergio.ai',
          blurb:            blurb.trim(),
        },
      });
      if (error) {
        showToast(`Send failed: ${error.message}`);
      } else {
        showToast(`Sent to ${picked.name} ✓`);
        navigate('/earnings');
      }
    } finally {
      setBusy(false);
    }
  };

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
          Pick a friend from your contacts — we send them your blurb and a
          one-tap link to book.
        </p>
        <p className="text-[12px] text-gd font-extrabold mt-2.5">
          Earn up to ${REWARDS.perFriend} per friend who books from your recommendation.
        </p>
      </div>

      {/* ── Step 1: connect contacts ─────────────────────────────────────── */}
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
              Connect your contacts
            </p>
            <p className="text-[12px] text-b3 mt-0.5 leading-snug">
              Type a name and we auto-fill the rest — no manual entry.
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

      {/* ── Step 2: name input with autosuggest ──────────────────────────── */}
      <div className="px-5 mb-3">
        <label className="block text-[12px] font-extrabold text-b2 mb-1.5 uppercase tracking-wide">
          Who are you recommending to?
        </label>
        {picked ? (
          <div className="flex items-center gap-2 bg-gl border border-g/30 rounded-[14px] px-4 py-3">
            <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-gd text-[13px] font-extrabold flex-shrink-0">
              {picked.name.split(' ').map(s => s[0] || '').slice(0, 2).join('').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-extrabold text-black truncate">{picked.name}</p>
              <p className="text-[11px] text-b3 truncate">{picked.email || picked.phone || '—'}</p>
            </div>
            <button
              onClick={clearPick}
              aria-label="Clear"
              className="w-7 h-7 rounded-full bg-white border border-bdr flex items-center justify-center text-b2 text-[12px]"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              ref={nameRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder={hasSynced ? 'Start typing a name…' : 'Type a name (Cergio samples shown)'}
              className="w-full bg-white border border-bdr rounded-[14px] px-4 py-3 text-[14px]
                         text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
            />
            {focused && matches.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-bdr
                              rounded-[14px] shadow-card overflow-hidden z-10 max-h-[280px] overflow-y-auto">
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
        )}
      </div>

      {/* ── Step 3: blurb (locked until a contact is picked) ─────────────── */}
      <div className="px-5 flex-1">
        <label className="block text-[12px] font-extrabold text-b2 mb-1.5 uppercase tracking-wide">
          Why you'd send a friend here
        </label>
        <textarea
          value={blurb}
          onChange={e => setBlurb(e.target.value)}
          maxLength={280}
          disabled={!picked}
          placeholder={picked
            ? `Try: "Maria did our deep clean before move-out — fast, friendly, fair price."`
            : 'Pick a friend above to start writing.'}
          className={`w-full h-[200px] bg-white border border-bdr rounded-[18px] p-4 text-[15px] text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans leading-relaxed
                     ${!picked ? 'opacity-50 cursor-not-allowed' : ''}`}
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
          {busy ? 'Sending…' : (picked ? `Send to ${picked.name.split(' ')[0]}` : 'Pick a friend first')}
        </button>
      </div>
    </div>
  );
}
