import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { buildInviteUrl, buildConnectorInviteUrl } from '../lib/referral';
import { getMyCcStatus } from '../lib/api';
import { REWARDS } from '../lib/rewards';

// CERGIO-GUARD: NEVER hardcode the reward amounts in user-facing copy.
// They come from REWARDS in lib/rewards.js so a single bump there
// updates every screen at once. qa.mjs #24 locks this in.
const TABLE_ROWS = [
  {
    label: 'Free services',
    desc:  'Promote a provider on Instagram in exchange for a complimentary service',
    users: 'no',
    connectors: 'yes',
  },
  {
    label: 'Cash per invite',
    desc:  'Earn when an invited friend completes a booking — up to 10% on each booking they make',
    users:      { amount: `$${REWARDS.perFriendUser}`,      type: 'credit' },
    connectors: { amount: `$${REWARDS.perFriendConnector}`, type: 'cash' },
  },
  {
    label: "Per friend's invite",
    desc:  "Earn when friends you invited invite their own friends",
    users: null,
    connectors: { amount: `$${REWARDS.friendOfFriendBonus}`, type: 'cash' },
  },
  {
    label: '200 friends milestone',
    desc:  'Bonus when you invite 200 friends — up to 10% on each booking they make',
    users: 'no',
    connectors: { amount: '$10,000', type: 'cash', highlight: true },
  },
];

function CheckIcon({ ok }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm
                  ${ok ? 'bg-gl text-g' : 'bg-red-50 text-red-600'}`}
    >
      {ok ? '✓' : '✕'}
    </span>
  );
}

function CashCell({ val }) {
  if (!val) return <span className="text-body font-extrabold text-b3">—</span>;
  if (val === 'no')  return <CheckIcon ok={false} />;
  if (val === 'yes') return <CheckIcon ok={true} />;
  return (
    <div className="text-center">
      <div className={`text-body font-extrabold ${val.highlight ? 'text-gd' : 'text-black'}`}>
        {val.amount}
      </div>
      <span
        className={`text-caps font-extrabold px-2 py-0.5 rounded-pill inline-block mt-0.5
                    ${val.type === 'cash' ? 'bg-gl text-gd' : 'bg-bg5 text-b2'}`}
      >
        {val.type === 'cash' ? 'Cash or credit' : 'Credit only'}
      </span>
    </div>
  );
}

export function RainmakersScreen() {
  const navigate = useNavigate();
  const { showToast, auth } = useOutletContext();
  // Connector status — gates the "Invite a Connector" action (only verified
  // Connectors can auto-grant Connector status to those they invite). 2026-06-26.
  const [isConnector, setIsConnector] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!auth?.isSignedIn) { setIsConnector(false); return; }
    getMyCcStatus().then(({ data }) => { if (!cancelled) setIsConnector(!!data?.cc_verified_at); });
    return () => { cancelled = true; };
  }, [auth?.isSignedIn]);
  const copyConnectorInvite = async () => {
    const url = buildConnectorInviteUrl(auth?.user?.id);
    const msg = `Join me as a Connector on Cergio — get paid to spotlight local services to your network. You're set up as a Connector the moment you join with my link 👇 ${url}`;
    try { await navigator.clipboard.writeText(msg); showToast('Connector invite copied ✓'); }
    catch { showToast(url); }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-cr pb-20">

      {/* close */}
      <div className="px-5 pt-3.5">
        <button
          onClick={() => navigate(-1)}
          className="w-[34px] h-[34px] rounded-full bg-bg5 border-none cursor-pointer
                     flex items-center justify-center text-b3 text-base"
        >
          ✕
        </button>
      </div>

      {/* hero */}
      <div className="flex flex-col items-center px-7 pt-4 pb-6 text-center">
        <div className="relative w-[90px] h-[90px] mb-4">
          <div className="w-full h-full rounded-full bg-gradient-to-br from-[#f0c8a0] to-[#d89870]
                          flex items-center justify-center text-4xl overflow-hidden">
            👩
          </div>
          <div className="absolute bottom-0 right-0 w-8 h-8 bg-g rounded-full border-[2.5px] border-cr
                          flex items-center justify-center text-sm">
            ⭐
          </div>
        </div>
        <h2 className="text-heading-1 font-extrabold text-black tracking-[.06em] uppercase mb-2.5">
          CERGIO RAINMAKERS
        </h2>
        <p className="text-body text-b3 font-medium leading-relaxed max-w-[300px]">
          Insiders &amp; influencers who spotlight the best services, driving real earnings to great providers — while earning with them and building stronger communities.
        </p>
      </div>

      {/* benefits */}
      <div className="px-6 pb-6 flex flex-col gap-4">
        {[
          { icon: '💲', color: 'bg-gl', text: 'Get free services' },
          { icon: '💲', color: 'bg-gl', text: `Earn $${REWARDS.perFriendConnector} cash or $${REWARDS.perFriendUser} credit per friend you invite` },
          { icon: '💲', color: 'bg-gl', text: `Earn $${REWARDS.milestoneBonus.toLocaleString()} when you invite ${REWARDS.milestoneFriends} friends`, tag: 'Milestone bonus 🏆' },
        ].map((b, i) => (
          <div key={i} className="flex items-center gap-3.5">
            <div className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-lg ${b.color}`}>
              {b.icon}
            </div>
            <div>
              <p className="text-body-lg font-extrabold text-black leading-snug">{b.text}</p>
              {b.tag && <p className="text-meta font-extrabold text-g mt-0.5">{b.tag}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* green wave */}
      <svg viewBox="0 0 390 40" preserveAspectRatio="none" className="w-full block -mb-0.5">
        <path d="M0,40 C60,0 130,0 195,20 C260,40 320,10 390,0 L390,40 Z" fill="#4AA901" />
      </svg>
      <div className="bg-g px-7 pb-8 flex flex-col items-center text-center">
        <div
          className="rounded-full bg-white/20 flex items-center justify-center text-2xl mb-3.5"
          style={{ width: 52, height: 52 }}
        >
          ⭐
        </div>
        <h3 className="text-heading-1 font-extrabold text-white mb-2">How to earn Connector status</h3>
        <p className="text-body font-extrabold text-white/90 italic mb-3">
          Invite 10 new friends every month to book on Cergio
        </p>
        <ul className="text-left flex flex-col gap-2">
          {[
            'Friends must be new to the platform',
            'Must complete a booking within 30 days of joining',
            'All 10 friends must join within the same month',
          ].map(t => (
            <li key={t} className="text-body-sm text-white/85 font-medium flex gap-2">
              <span className="text-white/50 flex-shrink-0 mt-0.5">•</span>{t}
            </li>
          ))}
        </ul>
      </div>

      {/* comparison table */}
      <div className="px-5 pt-7 pb-2">
        <h3 className="text-heading-1 font-extrabold text-black text-center leading-tight mb-5">
          Enjoy exclusive benefits<br />as a Connector
        </h3>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left pb-2.5 text-body-sm font-extrabold text-black">Benefits</th>
              <th className="pb-2.5 w-20">
                <span className="inline-flex items-center gap-1 bg-bg5 text-b2 text-meta font-extrabold px-3 py-1.5 rounded-pill">
                  All Users
                </span>
              </th>
              <th className="pb-2.5 w-24">
                <span className="inline-flex items-center gap-1 bg-g text-white text-meta font-extrabold px-3 py-1.5 rounded-pill">
                  ⭐ Connectors
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {TABLE_ROWS.map(row => (
              <tr key={row.label} className="border-t border-bdr">
                <td className="py-3.5 pr-2">
                  <p className="text-body-sm font-extrabold text-black mb-0.5">{row.label}</p>
                  <p className="text-meta-sm text-b3 font-medium leading-snug">{row.desc}</p>
                </td>
                <td className="py-3.5 text-center"><CashCell val={row.users} /></td>
                <td className="py-3.5 text-center"><CashCell val={row.connectors} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* invite CTA card */}
      <div className="mx-5 mt-4 rounded-[24px] bg-gradient-to-br from-[#0A4F22] to-[#0F8C36] p-5">
        <div className="flex mb-4">
          {['S', 'M', 'A', 'J', 'R'].map((l, i) => {
            const colors = [
              'from-[#c07050] to-[#903828]',
              'from-[#507090] to-[#304d68]',
              'from-[#885088] to-[#5a3060]',
              'from-[#508050] to-[#305530]',
              'from-[#b09050] to-[#806028]',
            ];
            return (
              <div
                key={i}
                className={`w-11 h-11 rounded-full bg-gradient-to-br ${colors[i]}
                            border-[2.5px] border-white/40 flex items-center justify-center
                            text-meta-sm font-extrabold text-white ${i > 0 ? '-ml-2.5' : ''}`}
              >
                {l}
              </div>
            );
          })}
        </div>
        <h3 className="text-heading-1 font-extrabold text-white leading-tight mb-2">
          Invite friends.<br />Become a Connector
        </h3>
        <p className="text-body-sm text-white/72 leading-relaxed mb-4">
          Once ten (10) of them join and complete a booking, apply for Connector status.
        </p>
        <button
          onClick={async () => {
            // CERGIO-GUARD: actually copy the inviter-tracked URL, not
            // a lying toast. Falls back to navigate(/invite/friends-popup)
            // when the clipboard API isn't available.
            const url = buildInviteUrl(auth?.user?.id);
            // Copy a captivating message + link, never a bare URL (Tarik 2026-06-26).
            const msg = `I'm on Cergio: the services your friends actually trust. Join with my link + book your first one 👇 ${url}`;
            try {
              await navigator.clipboard.writeText(msg);
              showToast(auth?.isSignedIn
                ? 'Invite copied ✓'
                : 'Copied — sign in to earn from invites.');
            } catch {
              navigate('/invite/friends-popup');
            }
          }}
          className="w-full bg-g text-white rounded-pill py-3.5 text-body-lg font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all cg-cta"
        >
          Invite my friends
        </button>
        {isConnector && (
          <button
            onClick={copyConnectorInvite}
            className="w-full mt-3 bg-white/10 text-white border border-white/30 rounded-pill py-3
                       text-body font-extrabold hover:bg-white/15 active:scale-[.97] transition-all"
          >
            Invite a Connector →
          </button>
        )}
        <p className="text-center mt-3 text-meta text-white/55 font-semibold">
          0/10 invites joined and completed booking
        </p>
      </div>

      {/* apply footer */}
      <div className="px-5 py-4 mt-5 border-t border-bdr">
        <button
          onClick={() => navigate('/rainmaker/apply')}
          className="w-full bg-g text-white rounded-[24px] py-4
                     text-body-lg font-extrabold hover:opacity-90 active:scale-[.97] transition-all"
        >
          Apply for Connector status
        </button>
      </div>

    </div>
  );
}
