import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { LeafLogo } from '../components/ui/LeafLogo';
import { AddressLabelPrompt } from '../components/ui/AddressLabelPrompt';

export function IntakeScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    chat, freeServices, auth, showToast,
    defaultAddress, refreshDefaultAddress,
  } = useOutletContext();
  const seedTask       = location.state?.seedTask       ?? null;
  const initialMessage = location.state?.initialMessage ?? null;

  const {
    messages, quickReplies, phase, typing, needsForm, init, send, state,
  } = chat;
  const inputRef  = useRef(null);
  const bottomRef = useRef(null);

  // Re-initialize the chat each time the user navigates here fresh
  // (location.key changes on every new navigation entry). Prefer the
  // free-text initialMessage path (from Home search) over seedTask
  // (from Home category chips) when both are present. Pass the user's
  // saved default address so Claude can short-circuit the where step
  // for repeat users.
  const initedKey = useRef(null);
  useEffect(() => {
    if (initedKey.current !== location.key) {
      initedKey.current = location.key;
      // Reset address validation tracking — a new chat session may
      // re-ask about where and we want to re-validate the new value.
      validatedAddressRef.current = null;
      const opts = {
        default_address: defaultAddress?.formatted_address ?? null,
        is_repeat_user:  !!defaultAddress,
      };
      if (initialMessage) {
        init({ ...opts, initialMessage });
      } else if (seedTask) {
        init({ ...opts, seedTask });
      } else {
        init(opts);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const handleSend = () => {
    const val = inputRef.current?.value.trim();
    if (!val) return;
    inputRef.current.value = '';
    send(val);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Address validation + save-as-label prompt ─────────────────────────────
  //
  // When the chat captures a where value we haven't validated yet:
  //   1. Skip if it matches the user's existing default address (string OR
  //      a substring overlap — Claude sometimes normalises wording).
  //   2. Geocode via Google Places. null = couldn't verify → toast a warning
  //      so the user can re-try, but don't block the chat.
  //   3. Look up the user's saved addresses by place_id. Already saved →
  //      silently use it. New → open the label prompt.
  const validatedAddressRef = useRef(null);
  const [savePrompt, setSavePrompt] = useState(null); // { formatted, lat, lng, placeId } | null

  useEffect(() => {
    const where = state.where;
    if (!where) return;
    if (validatedAddressRef.current === where) return;
    validatedAddressRef.current = where;

    // Not signed in → no address-saving flow. Bail.
    if (!auth?.isSignedIn) return;

    // Matches current default? Treat as a no-op.
    if (defaultAddress?.formatted_address &&
        (where === defaultAddress.formatted_address ||
         where.toLowerCase().includes(defaultAddress.formatted_address.toLowerCase().slice(0, 14)))) {
      return;
    }

    let cancelled = false;
    (async () => {
      const { geocodeAddress } = await import('../lib/google');
      const g = await geocodeAddress(where);
      if (cancelled) return;
      if (!g) {
        showToast("Couldn't verify that address. Try a more specific one?");
        return;
      }
      // Check existing saved addresses by place_id.
      const { listMyAddresses } = await import('../lib/api');
      const { data: saved } = await listMyAddresses();
      if (cancelled) return;
      if (saved?.some(a => a.place_id && a.place_id === g.placeId)) return;

      setSavePrompt({
        formatted: g.formatted,
        lat:       g.lat,
        lng:       g.lng,
        placeId:   g.placeId,
      });
    })();

    return () => { cancelled = true; };
  }, [state.where, auth?.isSignedIn, defaultAddress, showToast]);

  const handleSaveAddress = async (label) => {
    if (!savePrompt) return;
    const { saveAddress } = await import('../lib/api');
    const { data, error } = await saveAddress({
      label,
      formattedAddress: savePrompt.formatted,
      lat:    savePrompt.lat,
      lng:    savePrompt.lng,
      placeId: savePrompt.placeId,
    });
    if (error) {
      showToast(`Couldn't save: ${error.message}`);
    } else {
      showToast(`Saved as ${label}`);
      // If this saved address is the user's first (and therefore the new
      // default), refresh the layout-level default so subsequent chats
      // pre-fill it.
      if (data?.is_default) await refreshDefaultAddress();
    }
    setSavePrompt(null);
  };

  // Progress dots — count the three mandatory fields (what / when / where).
  // Budget + details + photos are optional and don't move the bar.
  const fields = useMemo(() => {
    let n = 0;
    if (state.what)  n++;
    if (state.when)  n++;
    if (state.where) n++;
    return n;
  }, [state.what, state.when, state.where]);

  return (
    <div className="flex-1 flex flex-col bg-cr overflow-hidden">

      {/* header */}
      <div className="flex justify-between items-center px-5 py-3.5 border-b border-bdr bg-white flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="text-[20px] text-b3 bg-transparent border-none cursor-pointer px-1"
        >
          ←
        </button>
        <div className="flex items-center gap-2">
          <LeafLogo size={22} />
          <span className="text-[14px] font-bold text-black">Cergio AI</span>
        </div>
        <button
          onClick={() => navigate('/intake-form', { state: { prefill: state } })}
          className="text-[12px] font-extrabold text-g underline underline-offset-2 px-1"
          aria-label="Switch to structured form"
        >
          Use form
        </button>
      </div>

      {/* progress */}
      <div className="flex items-center gap-1.5 px-5 py-2.5 bg-white border-b border-bg5 flex-shrink-0">
        {[1, 2, 3].map(n => (
          <div
            key={n}
            className={`w-2.5 h-2.5 rounded-full transition-colors duration-300
                        ${fields >= n ? 'bg-g' : 'bg-bdr'}`}
          />
        ))}
        <span className={`text-[11px] font-bold ml-1 ${fields >= 3 ? 'text-g' : 'text-b3'}`}>
          {fields >= 3 ? '3 / 3 ✓' : `${fields} / 3 required`}
        </span>
      </div>

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2.5">
        {messages.map(m => (
          <div
            key={m.id}
            className={`max-w-[88%] px-3.5 py-2.5 text-[13px] font-medium leading-relaxed
                        ${m.role === 'bot'
                          ? 'bg-crd rounded-[4px_18px_18px_18px] text-black self-start'
                          : 'bg-g rounded-[18px_4px_18px_18px] text-white font-semibold self-end'}`}
            style={{ whiteSpace: 'pre-wrap' }}
          >
            {m.text}
          </div>
        ))}

        {typing && (
          <div className="self-start flex gap-1.5 px-3.5 py-2.5">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-b3 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Claude bailed — offer to switch to the structured form */}
      {needsForm && (
        <div className="mx-4 mb-2 bg-warnBg border border-warn/40 rounded-[14px] p-3">
          <p className="text-[13px] font-extrabold text-warnText mb-1">
            Want to use a quick form instead?
          </p>
          <p className="text-[12px] text-warnText mb-2 leading-relaxed">
            We'll show you fields one screen at a time. No back-and-forth typing.
          </p>
          <button
            onClick={() => navigate('/intake-form', { state: { prefill: state } })}
            className="bg-black text-white rounded-[12px] px-3.5 py-1.5 text-[12px] font-extrabold"
          >
            Switch to form
          </button>
        </div>
      )}

      {/* quick replies */}
      {quickReplies.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {quickReplies.map(r => (
            <button
              key={r}
              onClick={() => send(r)}
              className={`border rounded-pill px-3.5 py-1.5 text-[12px] font-bold cursor-pointer transition-colors
                          ${r === 'Skip →' || /skip/i.test(r)
                            ? 'border-bdr text-b3 hover:bg-bg5'
                            : 'border-g text-gd hover:bg-gl'}`}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {/* CTA when ready — chat covered the mandatory three. The
          free-services toggle now lives on Home (top of /home), so this
          screen no longer duplicates it — it just reads the current value
          off context to pick which CTA to show. */}
      {phase === 'ready' && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          <button
            onClick={() => navigate(freeServices ? '/enable-free-offers' : '/results')}
            className="w-full bg-g text-white rounded-[24px] py-4 text-[17px] font-extrabold
                       hover:opacity-90 active:scale-[.97] transition-all"
          >
            {freeServices ? 'Get my free offers →' : 'Show me providers →'}
          </button>
          <button
            onClick={() => send('Add some photos / videos to my request')}
            className="w-full bg-bg5 text-b2 rounded-pill py-3 text-[13px] font-bold"
          >
            📷 Add photos / videos
          </button>
        </div>
      )}

      {/* input */}
      {phase === 'chat' && (
        <div className="px-4 py-2.5 bg-white border-t border-bdr flex-shrink-0">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              rows={1}
              placeholder={
                fields === 0
                  ? "Type everything: service + when + where + budget…"
                  : "Type here…"
              }
              onKeyDown={handleKey}
              className="flex-1 bg-cr border border-bdr rounded-[14px] px-3.5 py-2.5
                         text-[13px] text-black font-medium resize-none outline-none
                         focus:border-g min-h-[42px] max-h-[120px] font-sans"
            />
            <button
              onClick={handleSend}
              className="w-[42px] h-[42px] bg-g border-none rounded-xl flex items-center
                         justify-center cursor-pointer hover:opacity-90 active:scale-95 flex-shrink-0"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" width="18" height="18">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Save-as-label modal — pops up after Cergio captures a NEW address
          that Google validated and the user hasn't saved before. */}
      {savePrompt && (
        <AddressLabelPrompt
          formattedAddress={savePrompt.formatted}
          defaultLabel={defaultAddress ? 'Office' : 'Home'}
          onSave={handleSaveAddress}
          onSkip={() => setSavePrompt(null)}
        />
      )}
    </div>
  );
}
