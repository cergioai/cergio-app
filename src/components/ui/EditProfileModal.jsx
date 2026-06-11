// CERGIO-GUARD: the "View and edit profile" row on ProfileScreen
// opens this modal. Display name + phone are stored in Supabase auth
// user_metadata via supabase.auth.updateUser (no migration needed).
//
// CERGIO-GUARD (2026-06-05): added headline + bio per Tarik —
// "add ability for users to add a headline and a bio". Headline is
// a one-liner (≤120 chars) and bio is a longer free-form summary
// (≤500 chars). Both live on the profiles table so they're public:
// PublicProfileScreen reads them when rendering /u/{id}. RLS already
// pins UPDATE to auth.uid() = id (see db/schema-v1.sql).
//
// Schema note: `bio` already exists on profiles. `headline` is added
// by db/migrations/2026-06-05-profile-headline.sql — run via
// "Apply Profile Headline Migration.command". The save path is
// defensive: if the headline column doesn't exist yet, the UPDATE
// errors gracefully and we surface the message so Tarik can run the
// migration without losing the typed copy.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const HEADLINE_MAX = 120;
const BIO_MAX = 500;

export function EditProfileModal({ user, onClose, onSaved }) {
  const initial = {
    name:  user?.user_metadata?.display_name || '',
    phone: user?.user_metadata?.phone        || user?.phone || '',
    email: user?.email                       || '',
  };
  const [name,     setName]     = useState(initial.name);
  const [phone,    setPhone]    = useState(initial.phone);
  const [headline, setHeadline] = useState('');
  const [bio,      setBio]      = useState('');
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');
  // Track the loaded profile state so dirty-check is honest.
  const [loaded,   setLoaded]   = useState({ headline: '', bio: '' });

  // Pull existing headline + bio when the modal mounts so the user
  // sees their saved copy, not a blank slate. Errors are swallowed —
  // if the row hasn't been backfilled yet, both fields stay empty.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('headline, bio')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // headline column may not exist yet — try bio alone.
        const fallback = await supabase
          .from('profiles')
          .select('bio')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        const b = fallback.data?.bio || '';
        setBio(b);
        setLoaded({ headline: '', bio: b });
        return;
      }
      const h = data?.headline || '';
      const b = data?.bio      || '';
      setHeadline(h);
      setBio(b);
      setLoaded({ headline: h, bio: b });
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    // Re-sync name/phone when user changes (e.g. signin flip)
    setName(initial.name);
    setPhone(initial.phone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const dirty =
    name.trim()     !== initial.name.trim()  ||
    phone.trim()    !== initial.phone.trim() ||
    headline.trim() !== loaded.headline.trim() ||
    bio.trim()      !== loaded.bio.trim();

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true); setErr('');

    // Step 1: auth metadata (name + phone).
    const nameChanged  = name.trim()  !== initial.name.trim();
    const phoneChanged = phone.trim() !== initial.phone.trim();
    if (nameChanged || phoneChanged) {
      const { error: authErr } = await supabase.auth.updateUser({
        data: {
          display_name: name.trim(),
          phone:        phone.trim() || null,
        },
      });
      if (authErr) {
        setBusy(false);
        setErr(authErr.message);
        return;
      }
    }

    // Step 2: profiles row (headline + bio). RLS pins to auth.uid().
    const headlineChanged = headline.trim() !== loaded.headline.trim();
    const bioChanged      = bio.trim()      !== loaded.bio.trim();
    if (headlineChanged || bioChanged) {
      const patch = {};
      if (headlineChanged) patch.headline = headline.trim() || null;
      if (bioChanged)      patch.bio      = bio.trim()      || null;
      const { error: profErr } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user.id);
      if (profErr) {
        setBusy(false);
        // Most common cause: headline column not yet migrated. Keep the
        // typed copy in the form so the user can retry after running
        // Apply Profile Headline Migration.command.
        const detail = /headline/i.test(profErr.message)
          ? `${profErr.message} — run Apply Profile Headline Migration.command`
          : profErr.message;
        setErr(detail);
        return;
      }
      setLoaded({ headline: headline.trim(), bio: bio.trim() });
    }

    setBusy(false);
    onSaved?.({
      name:     name.trim(),
      phone:    phone.trim(),
      headline: headline.trim(),
      bio:      bio.trim(),
    });
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/40 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[390px] bg-white rounded-t-[24px] p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-3">
          <div>
            <h3 className="text-heading-2 font-extrabold text-black leading-tight">Edit profile</h3>
            <p className="text-meta text-b3 mt-0.5">Your public-facing details on Cergio.</p>
          </div>
          <button onClick={onClose} className="text-[20px] text-b3 font-extrabold px-2 -mt-1" aria-label="Close">×</button>
        </div>

        <label className="block text-meta-sm font-extrabold uppercase tracking-wide text-b2 mb-1.5 mt-4">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-body text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          autoComplete="name"
        />

        <label className="block text-meta-sm font-extrabold uppercase tracking-wide text-b2 mb-1.5 mt-4">
          Phone (optional)
        </label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 555 …"
          className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-body text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          inputMode="tel"
          autoComplete="tel"
        />

        {/* CERGIO-GUARD (2026-06-05): public headline — appears beside
            the display name on PublicProfileScreen. Keep it short and
            scannable: ≤120 chars, ideally one phrase. */}
        <label className="block text-meta-sm font-extrabold uppercase tracking-wide text-b2 mb-1.5 mt-4">
          Headline
        </label>
        <input
          value={headline}
          onChange={(e) => setHeadline(e.target.value.slice(0, HEADLINE_MAX))}
          placeholder="e.g. Personal trainer · Miami Beach"
          maxLength={HEADLINE_MAX}
          className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-body text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
        />
        <p className="text-[10.5px] text-b3 mt-1 text-right">{headline.length}/{HEADLINE_MAX}</p>

        {/* Bio — longer free-form summary. Renders on PublicProfileScreen
            below the stats block. */}
        <label className="block text-meta-sm font-extrabold uppercase tracking-wide text-b2 mb-1.5 mt-3">
          Bio
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
          placeholder="What you do, who you help, what you love."
          rows={4}
          maxLength={BIO_MAX}
          className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-body text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none"
        />
        <p className="text-[10.5px] text-b3 mt-1 text-right">{bio.length}/{BIO_MAX}</p>

        <label className="block text-meta-sm font-extrabold uppercase tracking-wide text-b2 mb-1.5 mt-4">
          Email
        </label>
        <input
          value={initial.email}
          disabled
          className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-body text-b3 outline-none opacity-70"
        />
        <p className="text-meta-sm text-b3 mt-1.5 leading-snug">
          Email changes require re-verification — contact support for now.
        </p>

        {err && (
          <p className="text-meta text-danger mt-3 leading-snug">{err}</p>
        )}

        <button
          onClick={save}
          disabled={!dirty || busy}
          className={`w-full rounded-[14px] py-3.5 text-[15px] font-extrabold mt-5 transition-all
            ${dirty && !busy ? 'bg-g text-white hover:opacity-90 active:scale-[.97]' : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
