// crack-help-haiku — Founder support inbox (admin-only). Reads every ticket
// (RLS lets an admin see all), lets the founder open a ticket, read the full
// thread (user / ai / founder), and post a reply that closes it. Mirrors the
// AdminCrawlScreen admin-gate pattern; the DB RLS + the support-triage function
// enforce access server-side too. No fake data — honest empty states.
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { isAdminEmail, listSupportTickets, getSupportThread, postFounderReply } from '../lib/api';

const STATUS_TONE = {
  new:         'bg-gl text-gd',
  escalated:   'bg-yellow-100 text-yellow-800',
  human:       'bg-red-100 text-red-700',
  ai_resolved: 'bg-gray-100 text-gray-600',
  closed:      'bg-gray-100 text-gray-500',
};

const FILTERS = [
  { id: 'open',        label: 'Needs a human', match: (t) => t.status === 'human' || t.status === 'escalated' },
  { id: 'new',         label: 'New',           match: (t) => t.status === 'new' },
  { id: 'ai_resolved', label: 'AI resolved',   match: (t) => t.status === 'ai_resolved' },
  { id: 'all',         label: 'All',           match: () => true },
];

function StatusPill({ status }) {
  return (
    <span className={`text-[11px] font-extrabold rounded-full px-2 py-0.5 ${STATUS_TONE[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

export function SupportInboxScreen() {
  const [email, setEmail]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter]   = useState('open');
  const [active, setActive]   = useState(null); // { ticket, messages }
  const [reply, setReply]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await listSupportTickets({ limit: 200 });
    if (error) setErr(error.message || 'Failed to load');
    else { setTickets(data || []); setErr(null); }
  }, []);

  useEffect(() => {
    let timer;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const e = u?.user?.email || '';
      setEmail(e);
      if (isAdminEmail(e)) { await load(); timer = setInterval(load, 45000); }
      setLoading(false);
    })();
    return () => timer && clearInterval(timer);
  }, [load]);

  const openTicket = useCallback(async (id) => {
    setActive({ loading: true });
    const { data } = await getSupportThread(id);
    setActive(data || null);
    setReply('');
  }, []);

  const sendReply = async () => {
    if (busy || !reply.trim() || !active?.ticket) return;
    setBusy(true); setErr(null);
    const { error } = await postFounderReply(active.ticket.id, reply);
    setBusy(false);
    if (error) { setErr(error.message || 'Reply failed'); return; }
    await openTicket(active.ticket.id);
    await load();
  };

  if (!loading && email !== null && !isAdminEmail(email)) {
    return <div className="mx-auto max-w-md p-8 text-center text-b3">This inbox is for Cergio admins only.</div>;
  }
  if (loading) return <div className="mx-auto max-w-md p-8 text-center text-b3">Loading…</div>;

  const shown = tickets.filter(FILTERS.find(f => f.id === filter)?.match || (() => true));
  const counts = {
    open: tickets.filter(t => t.status === 'human' || t.status === 'escalated').length,
    new: tickets.filter(t => t.status === 'new').length,
  };

  // ── Thread view ──
  if (active?.ticket) {
    const t = active.ticket;
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <button onClick={() => setActive(null)} className="text-body-sm font-extrabold text-b3 mb-3">← Back to inbox</button>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-[19px] font-extrabold text-black flex-1">{t.subject || '(no subject)'}</h1>
          <StatusPill status={t.status} />
        </div>
        <p className="text-meta text-b3 mb-4">
          {t.email || 'no email'} · opened {new Date(t.created_at).toLocaleString()}
          {t.ai_stage ? ` · AI: ${t.ai_stage}` : ''}
        </p>
        {t.ai_reason && (
          <div className="bg-red-50 border border-red-200 rounded-[12px] px-3 py-2 text-meta text-red-700 mb-4">
            <b>Why it needs you:</b> {t.ai_reason}
          </div>
        )}

        <div className="flex flex-col gap-2 mb-4">
          {(active.messages || []).map((m) => (
            <div key={m.id}
              className={`rounded-[14px] px-4 py-2.5 text-body-sm leading-relaxed max-w-[85%]
                ${m.sender === 'user' ? 'bg-bg5 text-black self-start'
                  : m.sender === 'ai' ? 'bg-gl text-black self-start'
                  : 'bg-g text-white self-end'}`}>
              <div className="text-[10px] font-extrabold uppercase tracking-wide opacity-70 mb-0.5">{m.sender}</div>
              <div className="whitespace-pre-wrap">{m.body}</div>
            </div>
          ))}
          {(!active.messages || active.messages.length === 0) && (
            <p className="text-meta text-b3">No thread messages yet.</p>
          )}
        </div>

        {t.status !== 'closed' && (
          <div className="border-t border-line pt-3">
            <textarea
              value={reply} onChange={(e) => setReply(e.target.value)} rows={3}
              placeholder="Write a reply — this closes the ticket…"
              className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-body-sm text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none"
            />
            {err && <p className="text-meta text-danger font-extrabold mt-1">{err}</p>}
            <button onClick={sendReply} disabled={busy || !reply.trim()}
              className={`mt-2 w-full rounded-[24px] py-3 text-[15px] font-extrabold transition-all
                ${reply.trim() && !busy ? 'bg-g text-white hover:opacity-90 active:scale-[.97]' : 'bg-bg5 text-b3 cursor-not-allowed'}`}>
              {busy ? 'Sending…' : 'Reply & close'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="text-[22px] font-extrabold text-black mb-1">Support inbox</h1>
      <p className="text-meta text-b3 mb-4">
        {counts.open} need a human · {counts.new} new · {tickets.length} total
      </p>

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`whitespace-nowrap text-meta font-extrabold rounded-full px-3 py-1.5
              ${filter === f.id ? 'bg-g text-white' : 'bg-bg5 text-b3'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {err && <p className="text-meta text-danger font-extrabold mb-3">{err}</p>}

      {shown.length === 0 ? (
        <p className="text-body-sm text-b3 py-8 text-center">Nothing here — inbox zero.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((t) => (
            <button key={t.id} onClick={() => openTicket(t.id)}
              className="text-left rounded-[14px] border border-line bg-white px-4 py-3 hover:border-g/40 transition-colors">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="flex-1 text-body-sm font-extrabold text-black truncate">{t.subject || '(no subject)'}</span>
                <StatusPill status={t.status} />
              </div>
              <div className="text-meta text-b3 truncate">{t.body || ''}</div>
              <div className="text-[11px] text-b3 mt-1">{t.email || 'no email'} · {new Date(t.created_at).toLocaleDateString()}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
