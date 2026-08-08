// SPEC-279 / FW-25 — JOIN THE BARTER (founder, 2026-08-08):
// "add option for creator and service who receive a msg to join the barter to
//  Optin and Post a request (eg: need a driver tuesday .. )"
//
// This is where an outreach recipient lands after they say yes. Until now the
// opt-in redirect (outreach-optin → /auth?src=soft_launch&role=…&optin=1)
// dropped its own parameters at /auth and dumped the person on /home with no
// next step — they opted in and nothing happened. Now the role rides through
// and they get the two things they can actually do, on one screen:
//
//   1. POST WHAT YOU NEED  — a specific open request ("need a driver Tuesday"),
//      parsed by the REAL chat-parse edge function (never a local regex), which
//      publishes to the open board AND fans out to matching providers.
//   2. I'M FLEXIBLE        — an opt-in card on the board with no specific ask.
//      The other side proposes; see OpenBoardScreen's suggest sheet.
//
// Neither path books anything. Posting is posting.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { RequestBox } from '../components/ui/RequestBox';
import { chatParse, createRequestAndFanOut, postFlexibleOptIn } from '../lib/api';

export function BarterJoinScreen() {
  const navigate  = useNavigate();
  const routerLoc = useLocation();
  const { showToast, auth, defaultAddress } = useOutletContext();

  const params = new URLSearchParams(routerLoc.search);
  const roleParam = params.get('role');
  // outreach-optin sends role=connector for influencers, role=service for
  // businesses. 'connector' is this codebase's word for a creator.
  const role = roleParam === 'connector' || roleParam === 'creator'
    ? 'creator'
    : roleParam === 'service' || roleParam === 'biz'
      ? 'service'
      : null;

  const [text, setText]   = useState('');
  const [where, setWhere] = useState('');
  const [echo, setEcho]   = useState(null);
  const [parsed, setParsed]     = useState(null);
  const [resolver, setResolver] = useState(null);
  const [busy, setBusy]   = useState(false);

  useEffect(() => {
    if (defaultAddress?.formatted_address) setWhere(defaultAddress.formatted_address);
  }, [defaultAddress?.formatted_address]);

  useEffect(() => {
    if (auth && !auth.loading && !auth.isSignedIn) {
      navigate(`/auth?returnTo=/join${role ? `&role=${role}` : ''}`, { replace: true });
    }
  }, [auth, auth?.loading, auth?.isSignedIn, navigate, role]);

  const echoLine = (p) => {
    if (!p) return null;
    return [p.what, p.when, p.where].filter(Boolean).join(' · ') || null;
  };

  const runParse = async (t) => {
    const { data, error } = await chatParse({
      user_message:    t,
      state:           {},
      default_address: where || null,
    });
    if (error || !data?.parsed) return null;
    setParsed(data.parsed);
    setResolver(data._resolver || null);
    const line = echoLine(data.parsed);
    setEcho(line || null);
    return line || null;
  };

  const postRequest = async () => {
    if (!text.trim()) { showToast('Tell us what you need — e.g. "need a driver Tuesday".'); return; }
    setBusy(true);
    // The structured columns must come from chat-parse, not from raw text. If
    // they typed and hit post without blurring, parse now and read the result
    // directly — component state is not visible in this tick.
    let p = parsed, r = resolver;
    if (!p) {
      const { data } = await chatParse({ user_message: text.trim(), state: {}, default_address: where || null });
      p = data?.parsed || null;
      r = data?._resolver || null;
    }
    const { request, error, blocked } = await createRequestAndFanOut({
      query:         text.trim().slice(0, 500),
      provider_type: r?.provider_type || p?.what || null,
      category:      r?.category || null,
      what:          (p?.what || '').trim() || null,
      when_text:     p?.when?.trim?.() || null,
      where_text:    p?.where?.trim?.() || where || null,
      lat:           defaultAddress?.lat ?? null,
      lng:           defaultAddress?.lng ?? null,
      kind:          'job',
      posterRole:    role,
    });
    setBusy(false);
    if (blocked) { showToast(typeof blocked === 'string' ? blocked : "We can't take that kind of request.", { sticky: true }); return; }
    if (error || !request) { showToast(error?.message || 'Could not post that.'); return; }
    showToast('Posted to the open board — providers can accept it now.');
    navigate('/board');
  };

  const optIn = async () => {
    setBusy(true);
    const { error } = await postFlexibleOptIn({
      role,
      note: text.trim().slice(0, 500),
      whereText: where || null,
      lat: defaultAddress?.lat ?? null,
      lng: defaultAddress?.lng ?? null,
    });
    setBusy(false);
    if (error) { showToast(error.message || 'Could not add you to the board.'); return; }
    showToast("You're on the board as flexible — people can suggest a service to you.");
    navigate('/board');
  };

  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      <div className="px-5 pt-5">
        <h1 className="text-heading-1 font-extrabold text-black">You&rsquo;re in.</h1>
        <p className="text-body-sm text-b3 mt-1 leading-snug">
          {role === 'creator'
            ? 'Tell us what you need and providers can accept it — you post an IG spotlight in return.'
            : role === 'service'
              ? 'Post what you need, or go on the board as flexible so creators can suggest a barter.'
              : 'Post what you need, or go on the board as flexible so the other side can suggest something.'}
        </p>
      </div>

      <div className="px-5 mt-5">
        <p className="text-body-lg font-extrabold text-black mb-2">Post what you need</p>
        <RequestBox
          value={text}
          onChange={setText}
          onParse={runParse}
          echo={echo}
          placeholder='e.g. "need a driver Tuesday afternoon"'
        />
        <label className="block mt-3">
          <span className="text-meta font-extrabold text-b3 uppercase tracking-wide">Where</span>
          <input
            value={where}
            onChange={e => setWhere(e.target.value)}
            placeholder="City or neighborhood"
            className="w-full mt-1 border border-line rounded-[14px] px-3 py-2.5 text-body-sm text-black bg-white outline-none focus:border-g"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={postRequest}
          className="w-full mt-3 bg-g text-white rounded-[24px] py-3.5 text-body-lg font-extrabold disabled:opacity-60 cg-cta active:scale-[.98] transition-all"
        >
          Post to the open board
        </button>
      </div>

      <div className="px-5 mt-6">
        <div className="border-t border-line pt-5">
          <p className="text-body-lg font-extrabold text-black">Nothing specific yet?</p>
          <p className="text-body-sm text-b3 mt-1 leading-snug">
            Go on the board as <span className="font-extrabold text-gd">flexible</span> — the other
            side can suggest a service and you decide. Anything you typed above rides along as a note.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={optIn}
            className="w-full mt-3 bg-white border border-bdr text-black rounded-[24px] py-3.5 text-body-lg font-extrabold disabled:opacity-60 active:scale-[.98] transition-all"
          >
            I&rsquo;m flexible — add me to the board
          </button>
        </div>
      </div>

      <div className="px-5 mt-5">
        <button onClick={() => navigate('/board')} className="text-body-sm font-extrabold text-g">
          Browse the open board →
        </button>
      </div>
    </div>
  );
}
