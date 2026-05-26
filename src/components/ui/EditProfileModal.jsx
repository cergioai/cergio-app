// CERGIO-GUARD: the "View and edit profile" row on ProfileScreen
// opens this modal. Fields are stored in Supabase auth user_metadata
// (display_name, phone) via supabase.auth.updateUser — same approach
// as the address-persistence fix, so it works without any migration.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export function EditProfileModal({ user, onClose, onSaved }) {
  const initial = {
    name:  user?.user_metadata?.display_name || '',
    phone: user?.user_metadata?.phone        || user?.phone || '',
    email: user?.email                       || '',
  };
  const [name,  setName]  = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState('');

  useEffect(() => {
    // Re-sync when user changes (e.g. signin flip)
    setName(initial.name);
    setPhone(initial.phone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const dirty = name.trim() !== initial.name.trim() ||
                phone.trim() !== initial.phone.trim();

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true); setErr('');
    const { error } = await supabase.auth.updateUser({
      data: {
        display_name: name.trim(),
        phone:        phone.trim() || null,
      },
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved?.({ name: name.trim(), phone: phone.trim() });
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
            <h3 className="text-[18px] font-extrabold text-black leading-tight">Edit profile</h3>
            <p className="text-[12px] text-b3 mt-0.5">Your name and phone for Cergio.</p>
          </div>
          <button onClick={onClose} className="text-[20px] text-b3 font-bold px-2 -mt-1" aria-label="Close">×</button>
        </div>

        <label className="block text-[11px] font-extrabold uppercase tracking-wide text-b2 mb-1.5 mt-4">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-[14px] text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          autoComplete="name"
        />

        <label className="block text-[11px] font-extrabold uppercase tracking-wide text-b2 mb-1.5 mt-4">
          Phone (optional)
        </label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 555 …"
          className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-[14px] text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          inputMode="tel"
          autoComplete="tel"
        />

        <label className="block text-[11px] font-extrabold uppercase tracking-wide text-b2 mb-1.5 mt-4">
          Email
        </label>
        <input
          value={initial.email}
          disabled
          className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-[14px] text-b3 outline-none opacity-70"
        />
        <p className="text-[11px] text-b3 mt-1.5 leading-snug">
          Email changes require re-verification — contact support for now.
        </p>

        {err && (
          <p className="text-[12px] text-danger mt-3 leading-snug">{err}</p>
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
