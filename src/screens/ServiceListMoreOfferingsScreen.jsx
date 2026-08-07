// Per design-spec.md — review offerings, add more or proceed.
//
// TWO MODES:
//  • New-listing flow (no state.serviceId): renders listingDraft offerings,
//    "+ Add another" goes through the draft flow, footer continues to photos.
//  • MANAGE mode (state.serviceId from ServiceDetailProviderScreen): FW-22
//    (founder 2026-08-07: "Edit Offerings doesn't let you edit.. and doesn't
//    show you existing offerings"). Root cause of the blank list: the api
//    selected a `price` column the offerings table has never had (it is
//    price_cents) — the 42703 was swallowed and every real service read
//    "No offerings yet". And the cards were read-only: "+ Add another"
//    routed into the DRAFT flow (writes that never touch the real service)
//    and the footer pushed on into the new-listing photos step.
//    Manage mode now: loads the REAL rows (fixed select, empty array is an
//    honest empty state), every card edits IN PLACE (name / description /
//    price — inline Save/Cancel per the founder's recorded no-browser-popup
//    rule, FW-13), rows delete with an inline armed confirm, "+ Add another"
//    is an inline form writing straight to the service via addOffering, and
//    the footer is "Done" back to the provider screen.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import { RegHeader, RegFooter } from '../components/ui/RegHeader';
import { getServiceOfferings, updateOffering, addOffering, deleteOffering } from '../lib/api';

function formatDraftPrice(o) {
  const price = o.price?.startsWith('$') ? o.price : `$${o.price || '0'}`;
  if (o.kind === 'hourly')  return `${price} per hour`;
  if (o.kind === 'session') return `${price} per session${o.durationMinutes ? ` · ${o.durationMinutes} min` : ''}`;
  return price;
}

function formatLivePrice(o) {
  const price = `$${Math.round((o.price_cents ?? 0) / 100)}`;
  if (o.kind === 'hourly')  return `${price} per hour`;
  if (o.kind === 'session') return `${price} per session${o.duration_minutes ? ` · ${o.duration_minutes} min` : ''}`;
  return price;
}

const dollarsToCents = (s) => {
  const m = String(s || '').match(/\$?\s*(\d+(?:\.\d+)?)/);
  return m ? Math.round(parseFloat(m[1]) * 100) : 0;
};

const inputCls = 'w-full bg-bg5 rounded-[10px] px-3 py-2 text-body text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30';

export function ServiceListMoreOfferingsScreen() {
  const navigate   = useNavigate();
  const location   = useLocation();
  const { listingDraft, showToast } = useOutletContext();
  const serviceId  = location.state?.serviceId || null;

  // ── MANAGE mode state ─────────────────────────────────────────────────────
  const [liveOfferings, setLiveOfferings] = useState(null); // null = loading (manage mode only)
  const [loadErr, setLoadErr] = useState(null);
  const [editingId, setEditingId] = useState(null);         // offering id being edited | 'new'
  const [draft, setDraft] = useState({ name: '', description: '', price: '', duration: '', kind: 'session' });
  const [saving, setSaving] = useState(false);
  const [removeArmedId, setRemoveArmedId] = useState(null); // inline confirm (no popups)

  useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;
    getServiceOfferings(serviceId).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setLoadErr(error.message || 'load failed'); setLiveOfferings([]); return; }
      // FW-22: an EMPTY array is a real, honest answer — never fall back to
      // the draft rows for an existing service.
      setLiveOfferings(data || []);
    });
    return () => { cancelled = true; };
  }, [serviceId]);

  useEffect(() => {
    if (!removeArmedId) return;
    const t = setTimeout(() => setRemoveArmedId(null), 5000);
    return () => clearTimeout(t);
  }, [removeArmedId]);

  const startEdit = (o) => {
    setEditingId(o.id);
    setDraft({
      name:        o.name || '',
      description: o.description || '',
      price:       String(Math.round((o.price_cents ?? 0) / 100)),
      duration:    o.duration_minutes ? String(o.duration_minutes) : '',
      kind:        o.kind || 'session',
    });
  };

  const startAdd = () => {
    setEditingId('new');
    setDraft({ name: '', description: '', price: '', duration: '', kind: 'session' });
  };

  const saveEdit = async () => {
    if (saving) return;
    if (!draft.name.trim()) { showToast?.('Give the offering a name'); return; }
    setSaving(true);
    if (editingId === 'new') {
      const { data, error } = await addOffering(serviceId, {
        name:             draft.name.trim(),
        description:      draft.description.trim() || null,
        kind:             draft.kind,
        price_cents:      dollarsToCents(draft.price),
        duration_minutes: parseInt(draft.duration, 10) || null,
      });
      setSaving(false);
      if (error || !data) { showToast?.(`Couldn't add: ${error?.message || 'try again'}`); return; }
      setLiveOfferings(list => [...(list || []), data]);
      showToast?.('Offering added ✓');
    } else {
      const patch = {
        name:             draft.name.trim(),
        description:      draft.description.trim() || null,
        price_cents:      dollarsToCents(draft.price),
        duration_minutes: draft.kind === 'session' ? (parseInt(draft.duration, 10) || null) : null,
      };
      const { data, error } = await updateOffering(editingId, patch);
      setSaving(false);
      if (error) { showToast?.(`Couldn't save: ${error.message}`); return; }
      setLiveOfferings(list => (list || []).map(o => (o.id === editingId ? { ...o, ...(data || patch) } : o)));
      showToast?.('Saved ✓');
    }
    setEditingId(null);
  };

  const removeRow = async (o) => {
    const { error } = await deleteOffering(o.id);
    if (error) { showToast?.(`Couldn't remove: ${error.message}`); return; }
    setLiveOfferings(list => (list || []).filter(x => x.id !== o.id));
    setRemoveArmedId(null);
    showToast?.('Removed ✓');
  };

  // ── Inline editor card (manage mode) ──────────────────────────────────────
  const editorCard = (
    <div className="bg-white border-2 border-g rounded-[18px] p-4">
      <p className="text-meta-sm font-extrabold uppercase tracking-wide text-b2 mb-1.5">Name</p>
      <input autoFocus value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
             placeholder="e.g. Deep clean" className={inputCls} />
      <p className="text-meta-sm font-extrabold uppercase tracking-wide text-b2 mb-1.5 mt-3">Description</p>
      <textarea value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                rows={2} placeholder="What's included?" className={`${inputCls} resize-none`} />
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <p className="text-meta-sm font-extrabold uppercase tracking-wide text-b2 mb-1.5">
            Price {draft.kind === 'hourly' ? '(per hour)' : '(per session)'}
          </p>
          <input value={draft.price} onChange={e => setDraft(d => ({ ...d, price: e.target.value }))}
                 placeholder="$50" inputMode="decimal" className={inputCls} />
        </div>
        {draft.kind === 'session' && (
          <div>
            <p className="text-meta-sm font-extrabold uppercase tracking-wide text-b2 mb-1.5">Minutes</p>
            <input value={draft.duration} onChange={e => setDraft(d => ({ ...d, duration: e.target.value }))}
                   placeholder="60" inputMode="numeric" className={inputCls} />
          </div>
        )}
      </div>
      {editingId === 'new' && (
        <div className="flex gap-2 mt-3">
          {['session', 'hourly'].map(k => (
            <button key={k} onClick={() => setDraft(d => ({ ...d, kind: k }))}
                    className={`rounded-pill px-3.5 py-1.5 text-meta font-extrabold border
                      ${draft.kind === k ? 'bg-g text-white border-g' : 'bg-white text-b2 border-bdr'}`}>
              {k === 'session' ? 'Per session' : 'Per hour'}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-4 mt-4">
        <button onClick={saveEdit} disabled={saving}
                className="text-body font-extrabold text-g underline disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => setEditingId(null)} className="text-body font-extrabold text-b3 underline">
          Cancel
        </button>
      </div>
    </div>
  );

  // ── MANAGE mode render ────────────────────────────────────────────────────
  if (serviceId) {
    return (
      <div className="flex-1 flex flex-col bg-cr">
        <RegHeader
          title="Offerings & pricing"
          sub="Tap an offering to edit its name, description, or price — changes go live right away."
          minHeight={220}
        />
        <div className="bg-cr rounded-t-[28px] -mt-7 px-5 pt-7 flex-1 pb-32 overflow-y-auto">
          <p className="text-heading-2 font-extrabold text-black mb-4">Your offerings</p>

          {liveOfferings === null && (
            <p className="text-body text-b3 mb-4">Loading your offerings…</p>
          )}
          {loadErr && (
            <p className="text-body text-danger mb-4">Couldn't load offerings: {loadErr}</p>
          )}
          {liveOfferings?.length === 0 && !loadErr && (
            <p className="text-body text-b3 mb-4">No offerings yet — add your first one below.</p>
          )}

          <div className="flex flex-col gap-3 mb-4">
            {(liveOfferings || []).map(o => (
              editingId === o.id ? (
                <div key={o.id}>{editorCard}</div>
              ) : (
                <div key={o.id} className="bg-white border border-bdr rounded-[18px] p-4">
                  <button onClick={() => startEdit(o)} className="w-full text-left">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-body-lg font-extrabold text-black mb-1">{o.name || 'Offering'}</p>
                      <span className="text-meta font-extrabold text-gd shrink-0">Edit ›</span>
                    </div>
                    {o.description && <p className="text-body-sm text-b3 leading-relaxed mb-2">{o.description}</p>}
                    <p className="text-body-lg font-extrabold text-black">{formatLivePrice(o)}</p>
                  </button>
                  <div className="mt-2 pt-2 border-t border-bdr">
                    {removeArmedId === o.id ? (
                      <span className="flex items-center gap-3">
                        <span className="text-meta font-extrabold text-danger">Remove this offering?</span>
                        <button onClick={() => removeRow(o)} className="text-meta font-extrabold text-danger underline">Yes, remove</button>
                        <button onClick={() => setRemoveArmedId(null)} className="text-meta font-extrabold text-b3 underline">Keep</button>
                      </span>
                    ) : (
                      <button onClick={() => setRemoveArmedId(o.id)} className="text-meta font-extrabold text-b3 underline">
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )
            ))}
            {editingId === 'new' && editorCard}
          </div>

          {editingId !== 'new' && (
            <button
              onClick={startAdd}
              className="w-full border-2 border-dashed border-g bg-gl/40 rounded-[18px] py-5
                         text-body font-extrabold text-g"
            >
              + Add another
            </button>
          )}
        </div>
        <RegFooter
          progress={1}
          nextLabel="Done"
          onNext={() => navigate(`/services/${serviceId}`)}
        />
      </div>
    );
  }

  // ── New-listing draft mode (unchanged behavior) ──────────────────────────
  const draftRows = listingDraft.offerings.length > 0
    ? listingDraft.offerings.map((o, i) => ({
        id: `o${i}`,
        name: o.name || (o.kind === 'session' ? 'Session' : 'Hourly'),
        desc: o.description || (o.kind === 'session' ? 'A session-based offering' : 'An hourly offering'),
        rate: formatDraftPrice(o),
      }))
    : [{ id: 'empty', name: 'No offerings yet', desc: 'Add one to continue', rate: '' }];

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <RegHeader
        title="Any more offerings?"
        sub="We added your hourly house cleaning service! Feel free to add any special packages or custom offerings."
        minHeight={300}
      />

      <div className="bg-cr rounded-t-[28px] -mt-7 px-5 pt-7 flex-1 pb-32 overflow-y-auto">
        <p className="text-heading-2 font-extrabold text-black mb-4">Your offerings</p>

        <div className="flex flex-col gap-3 mb-4">
          {draftRows.map(o => (
            <div key={o.id} className="bg-white border border-bdr rounded-[18px] p-4">
              <p className="text-body-lg font-extrabold text-black mb-1">{o.name}</p>
              <p className="text-body-sm text-b3 leading-relaxed mb-3">{o.desc}</p>
              <p className="text-body-lg font-extrabold text-black">{o.rate}</p>
            </div>
          ))}
        </div>

        <button
          onClick={() => navigate('/list-service/add-new-offering')}
          className="w-full border-2 border-dashed border-g bg-gl/40 rounded-[18px] py-5
                     text-body font-extrabold text-g"
        >
          + Add another
        </button>
      </div>

      <RegFooter
        progress={0.5}
        onNext={() => navigate('/list-service/photos-intro')}
      />
    </div>
  );
}
