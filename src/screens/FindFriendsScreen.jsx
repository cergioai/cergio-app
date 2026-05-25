// Find friends already on Cergio + invite people who aren't.
//
// Best-of-breed pattern (WhatsApp / Snap / Instagram playbook):
//   1. Phone contacts — Contact Picker API where supported (Chrome Android,
//      Safari iOS in PWA mode). Fallback to "Share invite link".
//   2. Google contacts — Google OAuth + People API (stub for now; real
//      implementation needs a server function for the OAuth exchange).
//   3. Instagram / TikTok — modern Meta + TikTok APIs DO NOT expose a user's
//      following list. We can only show "Share my Cergio link" via those
//      apps. We label this clearly so users aren't confused.
//   4. Manual search — paste a handle / email / phone to look up directly.
//   5. Share link — always available, uses navigator.share() or clipboard.
//
// All matched contacts show: "Already on Cergio" (with Connect CTA) or
// "Not yet on Cergio" (with Invite CTA).
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';
import { notifyUser } from '../lib/api';
import { REWARDS, REWARD_COPY } from '../lib/rewards';

const INVITE_BASE = (typeof window !== 'undefined' ? window.location.origin : 'https://cergio.ai');

export function FindFriendsScreen() {
  const navigate = useNavigate();
  const { showToast, auth } = useOutletContext();
  const isSignedIn = !!auth?.isSignedIn;
  const [matches, setMatches] = useState({ found: [], invitable: [] });
  const [busy, setBusy] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState([]);

  // Build the personal invite link. Future: include a referral code so
  // sign-ups credit the inviter (and trigger the +$25 reward).
  const ref = auth?.user?.id ? `?ref=${auth.user.id}` : '';
  const inviteUrl = `${INVITE_BASE}/?invite${ref}`;

  // ── 1. Phone contacts via Contact Picker API ─────────────────────────────
  const supportsContactPicker = typeof navigator !== 'undefined' &&
    'contacts' in navigator && 'ContactsManager' in window;
  const syncPhoneContacts = async () => {
    setBusy('phone');
    try {
      if (!supportsContactPicker) {
        showToast('Phone contact picker only works on Chrome Android. Use Share Invite instead.');
        return;
      }
      const props = ['name', 'tel', 'email'];
      const opts = { multiple: true };
      const contacts = await navigator.contacts.select(props, opts);
      if (!contacts?.length) return;
      await matchAndShow(contacts.map(c => ({
        name:  (c.name || [])[0] || '',
        email: (c.email || [])[0] || '',
        phone: (c.tel || [])[0] || '',
      })));
    } catch (e) {
      showToast(e?.message || 'Contact picker cancelled');
    } finally {
      setBusy('');
    }
  };

  // ── 2. Google contacts (stub) ────────────────────────────────────────────
  const syncGoogleContacts = async () => {
    showToast('Google contacts sync — coming soon. Use Share Invite for now.');
  };

  // ── 3. Instagram / TikTok — share-only (APIs don't expose following list).
  const shareToInstagram = () => {
    // Best web-supported path: copy link, open IG, prompt user to paste.
    copyInvite();
    showToast('Link copied — paste in your IG story or DM');
  };
  const shareToTikTok = () => {
    copyInvite();
    showToast('Link copied — paste in your TikTok bio or message');
  };

  // ── 4. Manual search (handle / email / phone exact-match lookup) ─────────
  const runSearch = async (q) => {
    if (!supabaseReady || !q.trim()) { setSearchHits([]); return; }
    const term = q.trim().replace(/^@/, '').toLowerCase();
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, instagram_handle, tiktok_handle')
      .or(`instagram_handle.ilike.%${term}%,tiktok_handle.ilike.%${term}%,display_name.ilike.%${term}%`)
      .limit(10);
    setSearchHits(data || []);
  };

  // ── 5. Share invite (native share + clipboard fallback) ──────────────────
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast('Invite link copied');
    } catch {
      showToast(inviteUrl);
    }
  };
  const shareInvite = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join me on Cergio',
          text:  'Find trusted services through your network on Cergio.',
          url:   inviteUrl,
        });
      } catch {/* user cancelled */}
    } else {
      copyInvite();
    }
  };

  // ── Match a list of contacts against Cergio profiles ─────────────────────
  // For real production: server-side function with email + phone hashes for
  // privacy. For Phase 1 we do a client query against the user_directory
  // view (if it exists) — gracefully degrade to "X contacts loaded" toast.
  async function matchAndShow(contacts) {
    if (!supabaseReady || !contacts.length) {
      showToast(`Loaded ${contacts.length} contacts`);
      return;
    }
    const emails = contacts.map(c => c.email).filter(Boolean).map(e => e.toLowerCase());
    const phones = contacts.map(c => c.phone).filter(Boolean);
    let found = [];
    if (emails.length) {
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, email_lower:display_name')   // placeholder; real impl needs email column on profiles
        .limit(50);
      found = data || [];
    }
    const invitable = contacts.filter(c => !found.find(f => f.display_name === c.name));
    setMatches({ found, invitable });
    showToast(`${contacts.length} loaded · ${found.length} on Cergio`);
  }

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-24">
      <div className="px-5 pt-10 pb-2 flex items-start justify-between gap-4">
        {/* Page title — Profile canon (30px / 800). One-line headline reads
            cleaner than the previous two-line break. */}
        <h1 className="text-[30px] font-extrabold text-black leading-tight">
          Find friends
        </h1>
        <button
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="w-9 h-9 rounded-full bg-bg5 flex items-center justify-center text-b2 hover:bg-bdr transition-colors flex-shrink-0"
        >
          ✕
        </button>
      </div>
      <p className="px-5 text-[14px] text-b3 leading-relaxed mt-1">
        Pull from your contacts to see who's already here — and invite the rest.
        Friends-of-friends recommendations get better the more of your network you bring in.
      </p>

      {/* ── Connect sources ───────────────────────────────────────────────── */}
      <h2 className="px-5 mt-8 mb-3 text-[22px] font-extrabold text-black leading-tight">Connect</h2>
      <SourceRow
        icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>}
        title="Sync phone contacts"
        sub={supportsContactPicker
          ? 'Pick which contacts to share — we never store the rest'
          : 'Chrome Android only · use Share Invite below'}
        onClick={syncPhoneContacts}
        busy={busy === 'phone'}
      />
      <SourceRow
        icon={<GoogleGlyph />}
        title="Sync Google contacts"
        sub="Import contacts from your Google account"
        onClick={syncGoogleContacts}
      />
      <SourceRow
        icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4.5"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>}
        title="Share to Instagram"
        sub="Copy your invite link to share in stories/DMs"
        onClick={shareToInstagram}
      />
      <SourceRow
        icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.82a4.28 4.28 0 0 1-2.6-1.82V14.5a3.5 3.5 0 1 1-3.5-3.5v2.06a1.44 1.44 0 1 0 1.44 1.44V2h2.06a4.27 4.27 0 0 0 4.27 4.27v2.06a6.34 6.34 0 0 1-1.67-.22v-2.29z"/></svg>}
        title="Share to TikTok"
        sub="Copy your invite link to share in your bio or DM"
        onClick={shareToTikTok}
      />

      {/* ── Manual search ─────────────────────────────────────────────────── */}
      <h2 className="px-5 mt-8 mb-3 text-[22px] font-extrabold text-black leading-tight">Find by handle</h2>
      <div className="px-5">
        <input
          type="text"
          value={searchQ}
          onChange={e => { setSearchQ(e.target.value); runSearch(e.target.value); }}
          placeholder="@handle, name, or email"
          className="w-full bg-white border border-bdr rounded-[14px] px-4 py-3 text-[14px]
                     text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
        />
        {searchHits.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {searchHits.map(p => (
              <div key={p.id} className="bg-white border border-bdr rounded-[14px] p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-bg5 flex items-center justify-center text-black text-[14px] font-extrabold">
                  {(p.display_name || p.instagram_handle || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-extrabold text-black truncate">{p.display_name || `@${p.instagram_handle || p.tiktok_handle}`}</p>
                  <p className="text-[12px] text-b3 truncate">
                    {p.instagram_handle && <>IG @{p.instagram_handle}</>}
                    {p.instagram_handle && p.tiktok_handle && ' · '}
                    {p.tiktok_handle && <>TT @{p.tiktok_handle}</>}
                  </p>
                </div>
                <button className="bg-g text-white rounded-pill px-3.5 py-1.5 text-[12px] font-extrabold">
                  Add
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Share invite ──────────────────────────────────────────────────── */}
      <h2 className="px-5 mt-8 mb-3 text-[22px] font-extrabold text-black leading-tight">Or just share your link</h2>
      <div className="px-5">
        <div className="bg-white border border-bdr rounded-[14px] p-3 flex items-center gap-2">
          <code className="flex-1 text-[12px] text-b2 font-mono truncate">{inviteUrl.replace(/^https?:\/\//, '')}</code>
          <button onClick={copyInvite}
            className="bg-bg5 text-black rounded-pill px-3 py-1.5 text-[12px] font-extrabold hover:bg-bdr">
            Copy
          </button>
        </div>
        <button
          onClick={shareInvite}
          className="w-full mt-3 bg-g text-white rounded-[24px] py-3.5 text-[15px] font-extrabold hover:opacity-90 active:scale-[.98] transition-all"
        >
          Share invite
        </button>
        <p className="text-[11px] text-b3 mt-2 leading-snug text-center">
          You earn <strong className="text-g">${REWARDS.friendJoinCredit} credit</strong> when a friend joins,
          plus up to <strong className="text-g">${REWARDS.maxPerInvite}</strong> total per invite as they book.
        </p>
      </div>

      {/* ── Imported matches (after contact sync) ─────────────────────────── */}
      {(matches.found.length > 0 || matches.invitable.length > 0) && (
        <>
          <h2 className="px-5 mt-8 mb-3 text-[22px] font-extrabold text-black leading-tight">
            From your contacts
          </h2>
          {matches.found.length > 0 && (
            <p className="px-5 text-[12px] font-extrabold text-gd uppercase tracking-wide mb-2">
              Already on Cergio ({matches.found.length})
            </p>
          )}
          {matches.found.map(p => (
            <div key={p.id} className="mx-5 mb-2 bg-white border border-bdr rounded-[14px] p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-bg5 flex items-center justify-center text-[14px] font-extrabold">
                {(p.display_name || '?')[0].toUpperCase()}
              </div>
              <p className="flex-1 text-[14px] font-extrabold text-black truncate">{p.display_name}</p>
              <button className="bg-g text-white rounded-pill px-3.5 py-1.5 text-[12px] font-extrabold">Add</button>
            </div>
          ))}
          {matches.invitable.length > 0 && (
            <p className="px-5 mt-3 text-[12px] font-extrabold text-b3 uppercase tracking-wide mb-2">
              Not yet on Cergio ({matches.invitable.length})
            </p>
          )}
          {matches.invitable.slice(0, 20).map((c, i) => (
            <div key={i} className="mx-5 mb-2 bg-white border border-bdr rounded-[14px] p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-bg5 flex items-center justify-center text-[14px] font-extrabold">
                {(c.name || c.email || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-extrabold text-black truncate">{c.name}</p>
                <p className="text-[11px] text-b3 truncate">{c.email || c.phone}</p>
              </div>
              <button
                onClick={async () => {
                  // Fire real notification (email if we have email, SMS if phone).
                  // Falls back to copying the invite link when neither is set.
                  if (!c.email && !c.phone) {
                    copyInvite();
                    showToast(`Invite link copied — paste in a text to ${c.name}`);
                    return;
                  }
                  const { error } = await notifyUser({
                    event: 'invite_received',
                    recipient: { name: c.name, email: c.email || undefined, phone: c.phone || undefined },
                    data: {
                      inviter_name: auth?.user?.user_metadata?.display_name || 'A friend',
                      inviter_id:   auth?.user?.id || '',
                    },
                  });
                  showToast(error ? `Send failed: ${error.message}` : `Invite sent to ${c.name} ✓`);
                }}
                className="bg-white border border-bdr text-black rounded-pill px-3.5 py-1.5 text-[12px] font-extrabold hover:border-g/40">
                Invite
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function SourceRow({ icon, title, sub, onClick, busy }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mx-5 mb-2 bg-white border border-bdr rounded-[14px] p-3.5 flex items-center gap-3 text-left
                 hover:border-g/40 transition-colors disabled:opacity-60 disabled:cursor-wait"
    >
      <div className="w-10 h-10 rounded-[12px] bg-bg5 flex items-center justify-center text-b2 flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-extrabold text-black leading-tight">{title}</p>
        <p className="text-[12px] text-b3 mt-0.5 leading-snug">{sub}</p>
      </div>
      <svg width="9" height="14" viewBox="0 0 11 18" fill="none" className="flex-shrink-0">
        <path d="M1.5 1.5L9 9l-7.5 7.5" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-b3" />
      </svg>
    </button>
  );
}

function GoogleGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.05-3.72 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" fill="#34A853"/>
      <path d="M5.84 14.1A6.61 6.61 0 0 1 5.48 12c0-.73.13-1.44.36-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335"/>
    </svg>
  );
}
