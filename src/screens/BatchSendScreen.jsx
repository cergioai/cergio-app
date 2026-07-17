// One-click A2P SMS batch to the OPTED-IN pool (SPEC-84d) — /ops/batch
//
// SMS-only, consented-only, admin-gated (ops-batch-send). Dry-run counts the pool;
// one confirmed click sends up to N. Honest: until the A2P campaign is VERIFIED and
// OUTREACH_SMS_ENABLED is on, Send returns PENDING and nothing goes out (no fake sent).
import { useEffect, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { opsBatchDryRun, opsBatchSend } from '../lib/api';

export function BatchSendScreen() {
  const ctx = useOutletContext?.() || {};
  const showToast = ctx.showToast || (() => {});
  const [pool, setPool] = useState(null);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    const { data, error } = await opsBatchDryRun();
    setLoading(false);
    if (error) { setErr(error.message || 'Could not read the pool'); return; }
    setPool(data);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const doSend = async () => {
    setConfirm(false); setSending(true); setResult(null); setErr(null);
    const { data, error } = await opsBatchSend(limit);
    setSending(false);
    if (error) { setErr(error.message || 'Send failed'); return; }
    setResult(data);
    if (data?.sent) showToast(`Sent ${data.sent} texts`);
    else if (data?.pending) showToast('Pending — nothing sent');
    refresh();
  };

  const total = pool?.total ?? 0;
  const armed = pool?.sms_enabled;

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <h1 className="text-xl font-extrabold text-black">Batch send · opted-in pool</h1>
      <p className="text-meta-sm text-b3 mt-1 leading-snug">
        One click texts up to {limit} of your <b>opted-in</b> providers via A2P SMS.
        Consented-only — cold numbers are never included (use <b>/ops/sms</b> tap-queue for those).
      </p>

      {!armed && (
        <div className="mt-3 rounded-xl bg-bg5 p-3 text-meta-sm text-b3 leading-snug">
          ⏳ Automated SMS is <b>not armed yet</b> — the A2P campaign must be VERIFIED and
          <code> OUTREACH_SMS_ENABLED</code> turned on. Until then, Send reports <b>pending</b> and sends nothing.
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-bg5 p-4">
        <div className="flex items-baseline justify-between">
          <div className="text-lg font-extrabold text-black">{loading ? '…' : total}</div>
          <button onClick={refresh} className="text-meta-sm text-b3 underline">refresh</button>
        </div>
        <div className="text-meta-sm text-b3">
          opted-in pool · {pool?.opted_in_services ?? 0} services · {pool?.opted_in_creators ?? 0} creators
        </div>

        <div className="mt-3 flex items-center gap-2">
          <label className="text-meta-sm text-b3">Batch size</label>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            className="bg-bg5 rounded-xl px-3 py-2 text-body outline-none">
            {[10, 25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <button
          onClick={() => setConfirm(true)}
          disabled={sending || total === 0}
          className="mt-4 w-full rounded-xl py-3 bg-g text-white font-extrabold disabled:opacity-50">
          {sending ? 'Sending…' : `Send SMS to ${Math.min(limit, total)} opted-in`}
        </button>
      </div>

      {err && <p className="mt-3 text-meta-sm text-danger">{err}</p>}

      {result && (
        <div className="mt-4 rounded-2xl border border-bg5 p-4 text-meta-sm">
          {result.pending
            ? <p className="text-b3"><b>Pending:</b> {result.pending}</p>
            : <p className="text-black"><b>Sent {result.sent}</b> of batch {result.batch}. {(result.results || []).filter(r => r.error).length} errors.</p>}
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setConfirm(false)}>
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="font-extrabold text-black">Send SMS to {Math.min(limit, total)} opted-in?</div>
            <p className="text-meta-sm text-b3 mt-1">
              Consented providers only. {armed ? 'This sends real texts.' : 'SMS is not armed — this will report pending and send nothing.'}
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={doSend} className="flex-1 rounded-xl py-2.5 bg-g text-white font-bold">Confirm send</button>
              <button onClick={() => setConfirm(false)} className="rounded-xl px-5 py-2.5 bg-bg5 text-b3 font-bold">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BatchSendScreen;
