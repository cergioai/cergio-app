// Cross-post / Free Profile — one-click distribution of a service's profile
// and offers to Google Business, Instagram, TikTok, plus a copy-paste
// Craigslist post (CL has no API). Per design-spec.md tokens.
//
// Honest states: Google/IG/TikTok publish only once their integration is
// live AND the service's account is connected; until then the button still
// works and reports a friendly "saved, goes out once connected" status.
// Craigslist always returns a ready post + steps for the owner to paste.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import {
  getService, getChannelConnections, connectServiceChannel, crosspost,
} from '../lib/api';

const CHANNELS = [
  { key: 'google',     label: 'Google Business', blurb: 'Show up on Maps + Search', emoji: '🟢' },
  { key: 'instagram',  label: 'Instagram',       blurb: 'Post to your IG',          emoji: '📸' },
  { key: 'tiktok',     label: 'TikTok',          blurb: 'Post to your TikTok',      emoji: '🎵' },
  { key: 'craigslist', label: 'Craigslist',      blurb: "We'll give you the post",  emoji: '📋' },
];

const STATUS_PILL = {
  connected:      { text: 'Connected',     cls: 'bg-gl text-gd' },
  manual:         { text: 'Manual',        cls: 'bg-warnBg text-warnText' },
  pending_review: { text: 'Coming soon',   cls: 'bg-warnBg text-warnText' },
  disconnected:   { text: 'Not connected', cls: 'bg-bg5 text-b3' },
  error:          { text: 'Needs attention', cls: 'bg-warnBg text-warnText' },
};

export function CrossPostScreen() {
  const { serviceId } = useParams();
  const navigate = useNavigate();
  const ctx = useOutletContext() || {};
  const showToast = ctx.showToast || (() => {});

  const [service, setService]   = useState(null);
  const [conns, setConns]       = useState([]);
  const [busy, setBusy]         = useState(null);   // channel key currently posting
  const [cl, setCl]             = useState(null);   // craigslist { post, steps }
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    if (!serviceId) { setLoading(false); return; }
    const [{ data: svc }, { data: c }] = await Promise.all([
      getService(serviceId),
      getChannelConnections(serviceId),
    ]);
    setService(svc);
    setConns(c || []);
    setLoading(false);
  }, [serviceId]);

  useEffect(() => { load(); }, [load]);

  const statusOf = (ch) => conns.find((c) => c.channel === ch)?.status || 'disconnected';

  const assetFor = () => ({
    kind: 'profile',
    caption: service
      ? `${service.title} — book on Cergio.`
      : 'Now bookable on Cergio.',
    description: service?.description || undefined,
    link: service ? `https://cergio.ai/service/${service.id}` : 'https://cergio.ai',
  });

  const handleConnect = async (ch) => {
    if (ch === 'craigslist') return doPost('craigslist');
    const handle = window.prompt(
      `Enter this service's ${ch} ${ch === 'google' ? 'listing name' : '@handle'} to connect:`,
    );
    if (handle == null) return;
    setBusy(ch);
    const { error } = await connectServiceChannel(serviceId, ch, { handle });
    setBusy(null);
    if (error) return showToast(error.message || 'Could not connect.');
    showToast(`${ch} connected.`);
    load();
  };

  const doPost = async (ch) => {
    setBusy(ch);
    const { data, error } = await crosspost({ serviceId, channel: ch, asset: assetFor() });
    setBusy(null);
    if (error) return showToast(error.message || 'Post failed.');
    if (ch === 'craigslist' && data?.post) {
      setCl({ post: data.post, steps: data.steps || [] });
      return;
    }
    const msg =
      data?.status === 'posted'          ? `Posted to ${ch}! 🎉`
    : data?.status === 'needs_connection' ? data.message || `Connect ${ch} first.`
    : data?.status === 'pending_review'   ? data.message || `${ch} goes out once it's connected.`
    : data?.message || `Saved for ${ch}.`;
    showToast(msg);
    load();
  };

  const postAllConnected = async () => {
    const apiChannels = ['google', 'instagram', 'tiktok'].filter((ch) => statusOf(ch) === 'connected');
    if (apiChannels.length === 0) {
      return showToast('Connect at least one channel first.');
    }
    for (const ch of apiChannels) {
      // eslint-disable-next-line no-await-in-loop
      await doPost(ch);
    }
  };

  const copyCl = async () => {
    if (!cl) return;
    const text = `${cl.post.title}\n\n${cl.post.body}`;
    try { await navigator.clipboard.writeText(text); showToast('Copied — paste it into Craigslist.'); }
    catch { showToast('Select and copy the text above.'); }
  };

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-16">
      <div className="px-5 pt-8 pb-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-extrabold text-black leading-tight">Your free profile,<br />everywhere</h1>
          <p className="text-[13px] text-b3 mt-1">Push your Cergio listing to the places customers search — free.</p>
        </div>
        <button
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="w-9 h-9 rounded-full bg-bg5 flex items-center justify-center text-b2 hover:bg-bdr transition-colors flex-shrink-0"
        >✕</button>
      </div>

      {loading ? (
        <div className="px-5 mt-8 text-b3 text-[14px]">Loading…</div>
      ) : !serviceId || !service ? (
        <div className="px-5 mt-8 text-b3 text-[14px]">
          Open this from one of your listings to cross-post it.
        </div>
      ) : (
        <>
          <div className="px-5 mt-3">
            <div className="rounded-2xl bg-card border border-line p-4">
              <p className="text-[12px] text-b3">Cross-posting</p>
              <p className="text-[15px] font-bold text-black mt-0.5">{service.title}</p>
            </div>
          </div>

          {/* One-click post-all */}
          <div className="px-5 mt-4">
            <button
              onClick={postAllConnected}
              disabled={!!busy}
              className="w-full h-12 rounded-full bg-g text-white font-bold text-[15px]
                         shadow-card disabled:opacity-60 hover:bg-gd transition-colors"
            >
              {busy ? 'Posting…' : 'Post to all connected channels'}
            </button>
            <p className="text-[11px] text-b3 mt-2 text-center">
              Posts to Google, Instagram &amp; TikTok where connected. Craigslist below.
            </p>
          </div>

          {/* Channel cards */}
          <div className="px-5 mt-5 flex flex-col gap-3">
            {CHANNELS.map((c) => {
              const st = statusOf(c.key);
              const pill = STATUS_PILL[st] || STATUS_PILL.disconnected;
              const connected = st === 'connected' || st === 'manual';
              return (
                <div key={c.key} className="rounded-2xl bg-card border border-line p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-[22px] leading-none">{c.emoji}</span>
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold text-black truncate">{c.label}</p>
                        <p className="text-[12px] text-b3 truncate">{c.blurb}</p>
                      </div>
                    </div>
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${pill.cls}`}>
                      {pill.text}
                    </span>
                  </div>

                  <div className="mt-3 flex gap-2">
                    {c.key === 'craigslist' ? (
                      <button
                        onClick={() => doPost('craigslist')}
                        disabled={busy === 'craigslist'}
                        className="flex-1 h-10 rounded-full border border-g text-gd font-bold text-[13px]
                                   hover:bg-gl transition-colors disabled:opacity-60"
                      >
                        {busy === 'craigslist' ? 'Preparing…' : 'Get my Craigslist post'}
                      </button>
                    ) : connected ? (
                      <button
                        onClick={() => doPost(c.key)}
                        disabled={busy === c.key}
                        className="flex-1 h-10 rounded-full bg-g text-white font-bold text-[13px]
                                   hover:bg-gd transition-colors disabled:opacity-60"
                      >
                        {busy === c.key ? 'Posting…' : `Post to ${c.label}`}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(c.key)}
                        disabled={busy === c.key}
                        className="flex-1 h-10 rounded-full border border-g text-gd font-bold text-[13px]
                                   hover:bg-gl transition-colors disabled:opacity-60"
                      >
                        {busy === c.key ? 'Connecting…' : `Connect ${c.label}`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Craigslist result */}
          {cl && (
            <div className="px-5 mt-5">
              <div className="rounded-2xl bg-soft border border-line p-4">
                <p className="text-[14px] font-extrabold text-black">Your Craigslist post</p>
                <p className="text-[12px] text-b3 mt-0.5">Copy this, then follow the steps.</p>
                <div className="mt-3 rounded-xl bg-white border border-bdr p-3">
                  <p className="text-[13px] font-bold text-black">{cl.post.title}</p>
                  <p className="text-[13px] text-b2 mt-2 whitespace-pre-line">{cl.post.body}</p>
                </div>
                <button
                  onClick={copyCl}
                  className="mt-3 w-full h-10 rounded-full bg-g text-white font-bold text-[13px] hover:bg-gd transition-colors"
                >Copy post</button>
                <ol className="mt-4 pl-5 list-decimal text-[13px] text-b2 space-y-1.5">
                  {cl.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
