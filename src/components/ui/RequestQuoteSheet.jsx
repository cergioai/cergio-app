// CERGIO-GUARD (2026-05-30): "Submit a request" sheet on the PDP.
//
// Tarik: "submit a request should open a request box... to the specific
// service (when clicked on on service profile)... same homepage box
// (and same logic (what where etc..) ... it can also offer ... the
// ability to cross post that to all services at the end post
// submission".
//
// Two-step modal:
//   Step 1 — compose: what / where / when / budget / details, pre-filled
//   with the service category + provider name. Submit calls
//   createRequestToProvider(toProviderOwnerId).
//   Step 2 — confirm: "Sent ✓ to {provider}. Also notify other matching
//   providers nearby?" Two buttons: "Also notify others" → crossPostRequest;
//   "No, just them" → close.
//
// Style matches the cream-on-white sheet used by PaymentSheet —
// fixed-bottom modal with a subtle scrim above. Keep the field layout
// terse: the PDP user came here because they ALREADY decided this
// provider is interesting; we just need the specifics.

// PR 5 (redesign handoff, Booking Flow.dc.html + PATCHES §5): the
// configure-with-fields step is replaced by the ONE free-form request box
// (the kit RequestBox — same parse-and-echo surface as home capture), wired
// to the REAL chat-parse edge function via the chatParse client. The
// prototype's regex is demo scaffolding and does not ship. The green
// "Read as: …" echo is the user's chance to catch a bad parse before
// sending. PATCHES §2: "Add photos or video" uploads land in the private
// request-media bucket + request_attachments AFTER the request row exists.

import { useState, useMemo, useRef } from 'react';
import { createRequestToProvider, crossPostRequest, chatParse } from '../../lib/api';
import { uploadRequestAttachments } from '../../lib/storage';
import { RequestBox } from './RequestBox';

export function RequestQuoteSheet({
  service,            // { id, ownerId, name, category, taxonomy_provider_type, location_text, lat, lng }
  providerName,       // string — shown in the headline
  defaultLocation,    // { formatted_address, lat, lng } | null  — to pre-fill Where
  notifySafe = false, // passed through to crossPostRequest
  onClose,            // () => void
  onSent,             // ({ requestId }) => void  — invoked after step-1 success
  showToast,          // toast helper from useOutletContext
}) {
  const initialWhere = defaultLocation?.formatted_address || service?.location_text || '';

  const [step, setStep] = useState('compose'); // 'compose' | 'sent'
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(null);
  const [crossPosted, setCrossPosted] = useState(false);

  // PR 5: ONE free-form box. The parse result (chat-parse, the real engine)
  // fills the structured request columns; the echo line renders inside
  // RequestBox so a bad parse is correctable before sending.
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);   // { what, when, where, budget, details }
  const [resolver, setResolver] = useState(null); // { provider_type, category }
  const [echo, setEcho] = useState(null);
  // PATCHES §2: photos/video staged locally, uploaded AFTER the request row
  // exists (the storage path is uid/requestId/…).
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);

  const providerType = useMemo(
    () => service?.taxonomy_provider_type || service?.category || 'service',
    [service]
  );

  const dollarToCents = (s) => {
    const m = String(s || '').match(/\$?\s*(\d+(?:\.\d+)?)/);
    return m ? Math.round(parseFloat(m[1]) * 100) : null;
  };

  const echoLine = (p) => {
    const parts = [];
    if (p?.what)   parts.push(p.what);
    if (p?.when)   parts.push(p.when);
    if (p?.where)  parts.push(`in ${p.where}`);
    if (p?.budget) parts.push(`budget ${p.budget}`);
    return parts.join(' · ');
  };

  // Wired to the REAL chat-parse edge function (PATCHES §5 — never the
  // prototype regex). Runs on RequestBox blur; submit re-uses the result.
  const runParse = async (t) => {
    const { data, error } = await chatParse({
      user_message:    t,
      state:           {},
      default_address: initialWhere || null,
    });
    if (error || !data?.parsed) return null;
    setParsed(data.parsed);
    setResolver(data._resolver || null);
    const line = echoLine(data.parsed);
    setEcho(line || null);
    return line || null;
  };

  const handleFilesPick = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    setFiles(f => [...f, ...picked].slice(0, 6)); // sane cap
  };

  const submit = async () => {
    if (!service?.ownerId) {
      showToast?.('Cannot send — provider id missing');
      return;
    }
    if (!text.trim()) {
      showToast?.('Tell us what you need');
      return;
    }
    setBusy(true);
    // If the user typed and hit send without blurring, parse now — the
    // structured columns must come from chat-parse, not raw text.
    let p = parsed, r = resolver;
    if (!p) {
      await runParse(text.trim());
      p = null; // state updates aren't visible yet — re-read via a direct call
      const { data } = await chatParse({ user_message: text.trim(), state: {}, default_address: initialWhere || null });
      p = data?.parsed || null;
      r = data?._resolver || null;
    }
    const { request, error } = await createRequestToProvider({
      toProviderOwnerId: service.ownerId,
      toServiceId:       service.id || null,
      query:             text.trim().slice(0, 500),
      provider_type:     r?.provider_type || providerType,
      category:          r?.category || service?.category || null,
      what:              (p?.what || providerType).trim(),
      when_text:         p?.when?.trim?.() || null,
      where_text:        p?.where?.trim?.() || initialWhere || null,
      lat:               defaultLocation?.lat ?? service?.lat ?? null,
      lng:               defaultLocation?.lng ?? service?.lng ?? null,
      budget_cents:      dollarToCents(p?.budget),
    });
    if (error || !request) {
      setBusy(false);
      showToast?.(`Couldn't send: ${error?.message || 'unknown error'}`);
      return;
    }
    // PATCHES §2: upload the staged photos/video now that the request id
    // exists. Best-effort — failures surface but never kill the sent state.
    if (files.length) {
      const { failed } = await uploadRequestAttachments(files, request.id);
      if (failed.length) showToast?.(`${failed.length} attachment${failed.length === 1 ? '' : 's'} didn't upload — the request still went out.`);
    }
    setBusy(false);
    setRequestId(request.id);
    setStep('sent');
    onSent?.({ requestId: request.id });
  };

  const crossPost = async () => {
    if (!requestId) return;
    setBusy(true);
    const { notified, error } = await crossPostRequest({
      requestId,
      provider_type: providerType,
      query:         text.trim().slice(0, 500),
      where_text:    parsed?.where?.trim?.() || initialWhere || null,
      lat:           defaultLocation?.lat ?? service?.lat ?? null,
      lng:           defaultLocation?.lng ?? service?.lng ?? null,
      notifySafe,
      excludeOwnerId: service?.ownerId || null,
    });
    setBusy(false);
    if (error) {
      showToast?.(`Couldn't notify other providers: ${error.message}`);
      return;
    }
    setCrossPosted(true);
    showToast?.(notified > 0
      ? `Also sent to ${notified} other ${notified === 1 ? 'provider' : 'providers'}`
      : 'No other matching providers in range');
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 backdrop-blur-[1px]">
      <div className="w-full max-w-[390px] bg-cream rounded-t-[24px] shadow-2xl flex flex-col"
           style={{ maxHeight: 'min(85vh, 720px)' }}>
        {/* Drag handle */}
        <div className="pt-3 pb-1 flex justify-center">
          <div className="w-10 h-1 rounded-full bg-bdr" />
        </div>

        {step === 'compose' && (
          <>
            <div className="px-5 pt-3 pb-2">
              <h2 className="text-[20px] font-extrabold text-black leading-tight">
                Submit a request
              </h2>
              <p className="text-[12.5px] text-b3 font-medium mt-1 leading-snug">
                Goes straight to <span className="font-extrabold text-black">{providerName || 'this provider'}</span>.
                You can also notify other matching providers after.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pt-3 pb-4">
              {/* PR 5: the ONE free-form box, chat-parse behind it, green
                  "Read as: …" echo inside RequestBox. */}
              <RequestBox
                value={text}
                onChange={setText}
                onParse={runParse}
                echo={echo}
                rows={4}
                placeholder={`e.g. ${providerType.toLowerCase()} this Saturday morning, 2-bed apartment, under $150…`}
              />

              {/* PATCHES §2: Add photos or video */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={handleFilesPick}
              />
              <div className="mt-3">
                {files.length > 0 && (
                  <div className="flex gap-2 flex-wrap mb-2">
                    {files.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 bg-white border border-bdr rounded-pill px-2.5 py-1 text-meta-sm font-extrabold text-b2 max-w-[160px]">
                        <span className="truncate">{f.type.startsWith('video/') ? '🎬' : '📷'} {f.name}</span>
                        <button
                          onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))}
                          aria-label="Remove attachment"
                          className="text-b3 font-extrabold"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-body-sm font-extrabold text-gd bg-gl/60 rounded-pill px-3.5 py-2"
                >
                  + Add photos or video
                </button>
              </div>
            </div>

            <div className="px-5 pb-5 pt-2 border-t border-bdr">
              <button
                onClick={submit}
                disabled={busy}
                className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                           hover:opacity-90 active:scale-[.97] transition-all disabled:opacity-50"
              >
                {busy ? 'Sending…' : `Send request to ${providerName?.split(' ')[0] || 'them'}`}
              </button>
              <button
                onClick={onClose}
                className="w-full mt-2 text-center text-body-sm font-extrabold text-b3 py-1"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 'sent' && (
          <>
            <div className="px-5 pt-3 pb-2 flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-gl text-gd flex items-center justify-center text-body-lg font-extrabold">✓</div>
              <div className="flex-1 min-w-0">
                <h2 className="text-heading-2 font-extrabold text-black leading-tight">
                  Sent to {providerName?.split(' ')[0] || 'them'}
                </h2>
                <p className="text-meta text-b3 font-medium mt-0.5 leading-snug">
                  They&apos;ll see it in their inbox right away.
                </p>
              </div>
            </div>

            <div className="flex-1 px-5 pt-4 pb-4 overflow-y-auto">
              <div className="bg-white border border-bdr rounded-[14px] p-4">
                <p className="text-body font-extrabold text-black">
                  Also notify other matching providers?
                </p>
                <p className="text-[12.5px] text-b3 font-medium mt-1 leading-snug">
                  We&apos;ll ping nearby {providerType?.toLowerCase() || 'providers'} with the
                  same request so you get more options to compare. Same single thread —
                  every reply lands in this conversation.
                </p>
                {crossPosted && (
                  <p className="text-meta text-gd font-extrabold mt-2">
                    ✓ Other providers notified
                  </p>
                )}
              </div>
            </div>

            <div className="px-5 pb-5 pt-2 border-t border-bdr flex flex-col gap-2">
              {!crossPosted ? (
                <>
                  <button
                    onClick={crossPost}
                    disabled={busy}
                    className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                               hover:opacity-90 active:scale-[.97] transition-all disabled:opacity-50"
                  >
                    {busy ? 'Notifying…' : 'Also notify other providers'}
                  </button>
                  <button
                    onClick={onClose}
                    className="w-full text-center text-body font-extrabold text-b3 py-2"
                  >
                    No, just {providerName?.split(' ')[0] || 'them'}
                  </button>
                </>
              ) : (
                <button
                  onClick={onClose}
                  className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                             hover:opacity-90 active:scale-[.97] transition-all"
                >
                  Done
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
