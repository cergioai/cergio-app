// Per design-spec.md — review selected contacts, optionally attach service blurb, send.
import { useState } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { CONTACTS } from '../data/mock';

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

export function InviteSelectedReviewScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useOutletContext();

  const { mode = 'invite', selectedIds = [] } = location.state || {};
  const picked = CONTACTS.filter(c => selectedIds.includes(c.id));
  const [note, setNote] = useState(
    mode === 'reco'
      ? 'I recommend this service because…'
      : 'Hey — I think you\'d love Cergio. Use my link to join and we both earn.'
  );

  const handleSend = () => {
    showToast(
      mode === 'reco'
        ? `Recommendation sent to ${picked.length} ${picked.length === 1 ? 'friend' : 'friends'}`
        : `${picked.length} ${picked.length === 1 ? 'invite' : 'invites'} sent`
    );
    navigate('/earnings');
  };

  return (
    <div className="flex-1 flex flex-col bg-white pb-24 overflow-y-auto">
      {/* nav */}
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-bold w-9 h-9 flex items-center justify-center"
        >
          ‹
        </button>
      </div>

      <div className="px-5 pt-2 pb-5">
        <h1 className="text-[24px] font-extrabold text-black">
          {mode === 'reco' ? 'Tell us about this service' : 'Add a personal note'}
        </h1>
        <p className="text-[14px] text-b3 leading-relaxed mt-2">
          {mode === 'reco'
            ? "Write a quick blurb about why you recommend this service. Users looking to book this service will see your recommendation."
            : 'These friends will receive your invite with the note below.'}
        </p>
      </div>

      {/* selected avatars row */}
      {picked.length > 0 && (
        <div className="px-5 pb-5">
          <div className="flex flex-wrap gap-2">
            {picked.map(c => (
              <div key={c.id} className="flex items-center gap-2 bg-soft rounded-pill pl-1 pr-3 py-1">
                <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${c.avatarBg}
                                 flex items-center justify-center text-white text-[10px] font-extrabold`}>
                  {getInitials(c.name)}
                </div>
                <span className="text-[13px] font-extrabold text-black">{c.name.split(' ')[0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* note */}
      <div className="px-5">
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={6}
          className="w-full border border-bdr rounded-[18px] p-4 text-[14px] text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans"
        />
      </div>

      {/* footer */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] bg-white border-t border-bdr px-5 pt-3 pb-5">
        <button
          onClick={handleSend}
          className="w-full bg-g text-white rounded-[24px] py-3.5 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          {mode === 'reco' ? 'Send recommendation' : 'Send invites'}
        </button>
      </div>
    </div>
  );
}
