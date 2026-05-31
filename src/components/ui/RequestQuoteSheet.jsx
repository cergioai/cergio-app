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

import { useState, useMemo } from 'react';
import { createRequestToProvider, crossPostRequest } from '../../lib/api';

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="text-[12px] text-b3 font-extrabold uppercase tracking-wide block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

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

  // Form state — minimal, matches HomeScreen chat parse fields.
  const [what,   setWhat]   = useState(service?.taxonomy_provider_type || service?.category || '');
  const [where_, setWhere_] = useState(initialWhere);
  const [when_,  setWhen_]  = useState('');
  const [budget, setBudget] = useState('');
  const [notes,  setNotes]  = useState('');

  const providerType = useMemo(
    () => service?.taxonomy_provider_type || service?.category || what || 'service',
    [service, what]
  );

  const dollarToCents = (s) => {
    const m = String(s || '').match(/\$?\s*(\d+(?:\.\d+)?)/);
    return m ? Math.round(parseFloat(m[1]) * 100) : null;
  };

  const composedQuery = useMemo(() => {
    // Compose the user-readable query line the same way HomeScreen does
    // — so /results renders a familiar headline if they click through.
    const parts = [];
    if (what) parts.push(what);
    if (when_)   parts.push(when_);
    if (where_)  parts.push(`in ${where_}`);
    if (budget)  parts.push(`budget ${budget}`);
    if (notes)   parts.push(`— ${notes}`);
    return parts.join(' ').slice(0, 500);
  }, [what, when_, where_, budget, notes]);

  const submit = async () => {
    if (!service?.ownerId) {
      showToast?.('Cannot send — provider id missing');
      return;
    }
    if (!what.trim()) {
      showToast?.('Tell us what you need');
      return;
    }
    setBusy(true);
    const { request, error } = await createRequestToProvider({
      toProviderOwnerId: service.ownerId,
      toServiceId:       service.id || null,
      query:             composedQuery,
      provider_type:     providerType,
      category:          service?.category || null,
      what:              what.trim(),
      when_text:         when_.trim() || null,
      where_text:        where_.trim() || null,
      lat:               defaultLocation?.lat ?? service?.lat ?? null,
      lng:               defaultLocation?.lng ?? service?.lng ?? null,
      budget_cents:      dollarToCents(budget),
    });
    setBusy(false);
    if (error || !request) {
      showToast?.(`Couldn't send: ${error?.message || 'unknown error'}`);
      return;
    }
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
      query:         composedQuery,
      where_text:    where_.trim() || null,
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
              <Field label="What do you need?">
                <input
                  type="text"
                  value={what}
                  onChange={(e) => setWhat(e.target.value)}
                  placeholder="e.g. deep cleaning"
                  className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-[14px] text-black
                             placeholder:text-b3 focus:outline-none focus:border-g/60"
                />
              </Field>
              <Field label="Where?">
                <input
                  type="text"
                  value={where_}
                  onChange={(e) => setWhere_(e.target.value)}
                  placeholder="Street, neighborhood, or city"
                  className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-[14px] text-black
                             placeholder:text-b3 focus:outline-none focus:border-g/60"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="When?">
                  <input
                    type="text"
                    value={when_}
                    onChange={(e) => setWhen_(e.target.value)}
                    placeholder="ASAP, Sat, May 31…"
                    className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-[14px] text-black
                               placeholder:text-b3 focus:outline-none focus:border-g/60"
                  />
                </Field>
                <Field label="Budget?">
                  <input
                    type="text"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="$50"
                    className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-[14px] text-black
                               placeholder:text-b3 focus:outline-none focus:border-g/60"
                  />
                </Field>
              </div>
              <Field label="Anything else?">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="2-bed apartment, allergic to bleach, prefer eco supplies…"
                  rows={3}
                  className="w-full bg-white border border-bdr rounded-[12px] px-3.5 py-3 text-[14px] text-black
                             placeholder:text-b3 focus:outline-none focus:border-g/60 resize-none"
                />
              </Field>
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
                className="w-full mt-2 text-center text-[13px] font-extrabold text-b3 py-1"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 'sent' && (
          <>
            <div className="px-5 pt-3 pb-2 flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-gl text-gd flex items-center justify-center text-[16px] font-extrabold">✓</div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[18px] font-extrabold text-black leading-tight">
                  Sent to {providerName?.split(' ')[0] || 'them'}
                </h2>
                <p className="text-[12px] text-b3 font-medium mt-0.5 leading-snug">
                  They&apos;ll see it in their inbox right away.
                </p>
              </div>
            </div>

            <div className="flex-1 px-5 pt-4 pb-4 overflow-y-auto">
              <div className="bg-white border border-bdr rounded-[14px] p-4">
                <p className="text-[14px] font-extrabold text-black">
                  Also notify other matching providers?
                </p>
                <p className="text-[12.5px] text-b3 font-medium mt-1 leading-snug">
                  We&apos;ll ping nearby {providerType?.toLowerCase() || 'providers'} with the
                  same request so you get more options to compare. Same single thread —
                  every reply lands in this conversation.
                </p>
                {crossPosted && (
                  <p className="text-[12px] text-gd font-extrabold mt-2">
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
                    className="w-full text-center text-[14px] font-extrabold text-b3 py-2"
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
