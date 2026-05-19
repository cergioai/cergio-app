// Per design-spec.md — Per-booking chat thread with Supabase realtime.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import {
  listMessages, sendMessage, subscribeToMessages, getBooking,
} from '../lib/api';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getInitials(name = '') {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

export function MessagesScreen() {
  const navigate = useNavigate();
  const { id: bookingId } = useParams();
  const { showToast, auth } = useOutletContext();

  const [booking, setBooking]   = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft]       = useState('');
  const [sending, setSending]   = useState(false);
  const bottomRef = useRef(null);
  const myId = auth?.user?.id;

  // Load booking metadata (for the header) + initial messages.
  useEffect(() => {
    let cancelled = false;
    Promise.all([getBooking(bookingId), listMessages(bookingId)]).then(([b, m]) => {
      if (cancelled) return;
      if (b.data) setBooking(b.data);
      setMessages(m.data || []);
    });
    return () => { cancelled = true; };
  }, [bookingId]);

  // Realtime: append new inserts as they arrive.
  useEffect(() => {
    const off = subscribeToMessages(bookingId, (msg) => {
      setMessages(curr => curr.some(m => m.id === msg.id) ? curr : [...curr, msg]);
    });
    return off;
  }, [bookingId]);

  // Auto-scroll on new messages.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    const text = draft;
    setDraft('');
    // Optimistic append.
    const temp = { id: `temp-${Date.now()}`, sender_id: myId, body: text, created_at: new Date().toISOString(), _pending: true };
    setMessages(curr => [...curr, temp]);

    const { data, error } = await sendMessage(bookingId, text);
    setSending(false);
    if (error) {
      showToast(`Failed: ${error.message}`);
      setMessages(curr => curr.filter(m => m.id !== temp.id));
      setDraft(text); // restore so user can retry
      return;
    }
    // Replace optimistic temp row with the real one (id from server).
    setMessages(curr => curr.map(m => m.id === temp.id ? data : m).filter((m, i, arr) =>
      arr.findIndex(x => x.id === m.id) === i
    ));
  };

  // Figure out the OTHER party's display name for the header.
  const otherName = !booking
    ? '…'
    : (myId === booking.consumer_id
        ? (booking.provider?.display_name || 'Provider')
        : (booking.consumer?.display_name || 'Customer'));
  const subtitle = booking?.service?.title || 'Booking thread';

  return (
    <div className="flex-1 flex flex-col bg-cr">
      {/* header */}
      <div className="bg-white border-b border-bdr px-5 pt-5 pb-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-white border border-bdr
                     flex items-center justify-center text-b2 text-base"
        >
          ←
        </button>
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#4478aa] to-[#2a5070]
                        flex items-center justify-center text-white text-[12px] font-extrabold">
          {getInitials(otherName)}
        </div>
        <div className="flex-1">
          <p className="text-[15px] font-extrabold text-black leading-tight">{otherName}</p>
          <p className="text-[12px] text-b3 truncate">{subtitle}</p>
        </div>
      </div>

      {/* thread */}
      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-2.5">
        {messages.length === 0 && (
          <p className="text-center text-[13px] text-b3 py-10">
            No messages yet. Say hi.
          </p>
        )}
        {messages.map(m => {
          const mine = m.sender_id === myId;
          return (
            <div
              key={m.id}
              className={`max-w-[80%] px-3.5 py-2.5 leading-relaxed
                          ${mine
                            ? 'bg-g text-white rounded-[18px_4px_18px_18px] self-end'
                            : 'bg-soft text-black rounded-[4px_18px_18px_18px] self-start'}`}
            >
              <p className="text-[14px] font-medium" style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
              <p className={`text-[10px] mt-1 ${mine ? 'text-white/75' : 'text-b3'}`}>
                {formatTime(m.created_at)}{m._pending ? ' · sending…' : ''}
              </p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <div className="bg-white border-t border-bdr px-4 py-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          rows={1}
          placeholder="Type a message…"
          className="flex-1 bg-bg5 rounded-[14px] px-4 py-3 text-[14px] text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30
                     resize-none font-sans min-h-[42px] max-h-[120px]"
        />
        <button
          onClick={send}
          disabled={!draft.trim() || sending}
          className={`w-[42px] h-[42px] rounded-xl flex items-center justify-center transition-opacity
            ${draft.trim() && !sending ? 'bg-g hover:opacity-90 active:scale-95' : 'bg-bg5 cursor-not-allowed'}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke={draft.trim() && !sending ? 'white' : '#9B9B9B'}
               strokeWidth="2.5" strokeLinecap="round" width="18" height="18">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
