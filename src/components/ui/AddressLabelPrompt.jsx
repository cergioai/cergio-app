// Bottom-sheet modal that pops up after Cergio captures + validates a new
// address. Asks the user whether they want to save it for next time and,
// if yes, which label (Home / Office / Other-custom). Skipping leaves the
// address one-shot — used for the booking but not persisted.
import { useState } from 'react';

const SUGGESTIONS = [
  { label: 'Home',   icon: '🏠' },
  { label: 'Office', icon: '💼' },
  { label: 'Gym',    icon: '🏋️' },
  { label: 'Other',  icon: '📍' },
];

export function AddressLabelPrompt({
  formattedAddress,
  defaultLabel = 'Home',
  onSave,         // (label: string) => Promise<void>
  onSkip,
}) {
  const [picked, setPicked] = useState(defaultLabel);
  const [custom, setCustom] = useState('');
  const [busy,   setBusy]   = useState(false);

  const finalLabel = picked === 'Other' ? (custom.trim() || 'Other') : picked;

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(finalLabel);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10001] bg-black/40 flex items-end justify-center"
      onClick={onSkip}
    >
      <div
        className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 pb-7"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-4" />

        <h2 className="text-heading-2 font-extrabold text-black mb-1">Save this address?</h2>
        <p className="text-body-sm text-b3 mb-1 leading-relaxed">
          We'll default to it next time — you won't have to retype it.
        </p>
        <p className="text-body-sm text-black font-extrabold mb-4 leading-snug">
          {formattedAddress}
        </p>

        {/* label chips */}
        <p className="text-meta-sm font-extrabold uppercase tracking-widest text-b3 mb-2">
          Label
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {SUGGESTIONS.map(s => {
            const active = picked === s.label;
            return (
              <button
                key={s.label}
                type="button"
                onClick={() => setPicked(s.label)}
                className={`flex items-center gap-1.5 rounded-pill px-3.5 py-2 text-body-sm font-extrabold transition-colors
                  ${active
                    ? 'bg-gl border-2 border-g text-gd'
                    : 'bg-white border border-bdr text-b2 hover:border-g/40'}`}
              >
                <span className="text-base">{s.icon}</span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {picked === 'Other' && (
          <input
            type="text"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            placeholder="Custom label (e.g. Mom's place)"
            className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-body text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 mb-3"
            maxLength={40}
            autoFocus
          />
        )}

        <div className="flex flex-col gap-2 mt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all
              ${busy ? 'bg-bg5 text-b3 cursor-not-allowed'
                     : 'bg-g text-white hover:opacity-90 active:scale-[.97]'}`}
          >
            {busy ? 'Saving…' : `Save as ${finalLabel}`}
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="w-full text-body-sm font-extrabold text-b3 py-2 disabled:opacity-50"
          >
            Skip — just use it once
          </button>
        </div>
      </div>
    </div>
  );
}
