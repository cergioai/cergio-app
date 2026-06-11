// Review-and-send screen for both invite + reco flows.
//
// For reco mode the user now adds: (1) WHO they're recommending (the
// service type / provider, e.g. "Plumber") via autosuggest from
// PROVIDER_TYPES, and (2) WHY they recommend them — the review blurb.
// Service type is prefilled from chat.state.provider_type when the
// user came from a search ("Recommend a {type}?"), so they don't
// re-type. CERGIO-GUARD: provider_type-level only, no offering names.
import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { listInvitableProfiles } from '../lib/api';
import { PROVIDER_TYPES } from '../data/providerTypes';
import { deriveDisplayNoun } from '../lib/serviceNoun';

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

export function InviteSelectedReviewScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast, chat } = useOutletContext();

  const { mode = 'invite', selectedIds = [], prefilledMessage = null } = location.state || {};
  // CERGIO-GUARD (2026-05-30): hydrate the picked contacts from real
  // profiles. Was filtering CONTACTS (mock) by selectedIds — now we
  // pull the profiles table and pick the matching ids. Same shape as
  // InviteFriendsScreen so the avatar/name rendering carries over.
  const [allContacts, setAllContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    listInvitableProfiles({ limit: 200 }).then(({ data }) => {
      if (!cancelled) setAllContacts(data || []);
    });
    return () => { cancelled = true; };
  }, []);
  const picked = allContacts.filter(c => selectedIds.includes(c.id));

  // CERGIO-GUARD: seed the service type from the USER'S OWN WORDS
  // VERBATIM. Auto-canonicalization to PROVIDER_TYPES was hurting more
  // than it helped: "deep cleaning" → "Airbnb Cleaner" (wrong! user
  // wants a general cleaner not an Airbnb specialist). "Nanny" was
  // landing on "Live-In Nanny" without that qualifier in the user's
  // ask. The safe default is the user's own phrasing — they can tap
  // the autosuggest below to refine if they want. PROVIDER_TYPES still
  // drives the autosuggest list (line ~stMatches) but no auto-pick.
  const userNoun = deriveDisplayNoun(chat?.state);
  const seededType = userNoun || chat?.state?.provider_type || '';
  const [serviceType, setServiceType] = useState(seededType);
  const [stFocused, setStFocused] = useState(false);

  const stMatches = useMemo(() => {
    const q = serviceType.trim().toLowerCase();
    if (!q) return PROVIDER_TYPES.slice(0, 6);
    return PROVIDER_TYPES.filter(t => t.toLowerCase().includes(q)).slice(0, 6);
  }, [serviceType]);

  const noun = serviceType.trim() || 'this service';
  // CERGIO-GUARD: seed the review with the user's original search
  // context (their words + when/where/budget if captured). The friend
  // gets useful context instead of an empty textarea, and "Spanish-
  // speaking nanny under 55" is preserved verbatim instead of being
  // collapsed to just the canonical "Nanny".
  const seedReview = useMemo(() => {
    if (mode !== 'reco') {
      // CERGIO-GUARD (2026-05-30): when ResultsScreen forwards a search
      // request (prefilledMessage = "Hey — anyone know a good plumber…"),
      // use THAT as the note body, not the generic invite copy. The
      // friend gets actual context about what the inviter is looking for.
      if (prefilledMessage) return prefilledMessage;
      return "Hey — I think you'd love Cergio. Use my link to join and we both earn.";
    }
    const phrase = userNoun || serviceType || 'a great provider';
    const parts = [`Looking for a ${phrase}`];
    if (chat?.state?.when)   parts.push(chat.state.when);
    if (chat?.state?.where)  parts.push(`in ${chat.state.where}`);
    if (chat?.state?.budget) parts.push(`max ${chat.state.budget}`);
    return `${parts.join(' — ')}. Anyone you know good?`;
  }, [mode, userNoun, serviceType, chat?.state?.when, chat?.state?.where, chat?.state?.budget]);
  const [review, setReview] = useState(seedReview);
  const remaining = mode === 'reco' ? Math.max(0, 240 - review.length) : null;

  const valid = mode === 'reco'
    ? (serviceType.trim().length > 0 && review.trim().length > 0)
    : review.trim().length > 0;

  const handleSend = () => {
    if (!valid) return;
    showToast(
      mode === 'reco'
        ? `Recommendation sent to ${picked.length} ${picked.length === 1 ? 'friend' : 'friends'}`
        : `${picked.length} ${picked.length === 1 ? 'invite' : 'invites'} sent`
    );
    navigate('/earnings');
  };

  return (
    <div className="flex-1 flex flex-col bg-white pb-32 overflow-y-auto">
      {/* nav */}
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-extrabold w-9 h-9 flex items-center justify-center"
        >
          ‹
        </button>
      </div>

      <div className="px-5 pt-2 pb-4">
        <h1 className="text-heading-1 font-extrabold text-black">
          {mode === 'reco' ? `Recommend a ${noun}` : 'Add a personal note'}
        </h1>
        <p className="text-body-sm text-b3 leading-relaxed mt-1.5">
          {mode === 'reco'
            ? 'Pick the service type, write a quick review. Friends see this when they tap your link.'
            : 'These friends will receive your invite with the note below.'}
        </p>
      </div>

      {/* selected avatars row */}
      {picked.length > 0 && (
        <div className="px-5 pb-4">
          <div className="flex flex-wrap gap-2">
            {picked.map(c => (
              <div key={c.id} className="flex items-center gap-2 bg-soft rounded-pill pl-1 pr-3 py-1">
                <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${c.avatarBg}
                                 flex items-center justify-center text-white text-caps font-extrabold`}>
                  {getInitials(c.name)}
                </div>
                <span className="text-body-sm font-extrabold text-black">{c.name.split(' ')[0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reco mode: service-type autosuggest + review */}
      {mode === 'reco' && (
        <>
          <div className="px-5 mb-4 relative">
            <label className="block text-meta-sm font-extrabold text-b2 mb-1.5 uppercase tracking-wide">
              Service type
            </label>
            <input
              type="text"
              value={serviceType}
              onChange={e => setServiceType(e.target.value)}
              onFocus={() => setStFocused(true)}
              onBlur={() => setTimeout(() => setStFocused(false), 150)}
              placeholder="e.g. Plumber, Cleaner, Personal Chef"
              autoComplete="off"
              className="w-full bg-white border border-bdr rounded-[14px] px-4 py-3 text-body
                         text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
            />
            {stFocused && stMatches.length > 0 && (
              <div className="absolute left-5 right-5 top-full mt-1 z-20 bg-white border border-bdr
                              rounded-[14px] shadow-card py-1 max-h-[240px] overflow-y-auto">
                {stMatches.map(t => (
                  <button
                    key={t}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setServiceType(t); setStFocused(false); }}
                    className="w-full text-left px-4 py-2 text-body text-b2 hover:bg-bg5 transition-colors"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="px-5 flex-1">
            <label className="block text-meta-sm font-extrabold text-b2 mb-1.5 uppercase tracking-wide">
              Your review
            </label>
            <textarea
              value={review}
              onChange={e => setReview(e.target.value)}
              maxLength={240}
              rows={5}
              placeholder={`Try: "${noun === 'this service' ? 'Maria' : 'Great ' + noun.toLowerCase()} — fast, friendly, fair price."`}
              className="w-full border border-bdr rounded-[18px] p-4 text-body text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans leading-relaxed"
            />
            <p className="text-meta-sm text-b3 mt-1.5 text-right">{remaining} characters left</p>
          </div>
        </>
      )}

      {/* Invite mode: single note */}
      {mode !== 'reco' && (
        <div className="px-5 flex-1">
          <textarea
            value={review}
            onChange={e => setReview(e.target.value)}
            rows={6}
            className="w-full border border-bdr rounded-[18px] p-4 text-body text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans"
          />
        </div>
      )}

      {/* footer */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] bg-white border-t border-bdr px-5 pt-3 pb-5">
        <button
          onClick={handleSend}
          disabled={!valid}
          className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all
            ${valid ? 'bg-g text-white hover:opacity-90 active:scale-[.97]' : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          {mode === 'reco' ? `Send ${noun} reco` : 'Send invites'}
        </button>
      </div>
    </div>
  );
}
