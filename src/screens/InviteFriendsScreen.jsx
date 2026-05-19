// Per design-spec.md — Contacts picker for invite/reco flow.
import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CONTACTS } from '../data/mock';

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

export function InviteFriendsScreen() {
  const navigate = useNavigate();
  const [params]  = useSearchParams();
  const mode      = params.get('mode') === 'reco' ? 'reco' : 'invite';
  const [selected, setSelected] = useState(new Set(['c2', 'c5'])); // pre-selected like the mockup
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? CONTACTS.filter(c => c.name.toLowerCase().includes(q)) : CONTACTS;
  }, [query]);

  // Group by first letter
  const grouped = useMemo(() => {
    const g = {};
    filtered.forEach(c => {
      g[c.initial] = g[c.initial] || [];
      g[c.initial].push(c);
    });
    return g;
  }, [filtered]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const selectedList = CONTACTS.filter(c => selected.has(c.id));
  const summary = selectedList.length === 0
    ? null
    : selectedList.length <= 3
      ? selectedList.map(c => c.name).join(', ')
      : `${selectedList.slice(0, 3).map(c => c.name).join(', ')}, and ${selectedList.length - 3} others`;

  const headerTitle = mode === 'reco' ? 'Recommend a service' : 'Invite a friend';
  const altLink     = mode === 'reco' ? 'Or, invite a friend' : 'Or, recommend a service';
  const altPath     = mode === 'reco' ? '/invite/friends' : '/invite/friends?mode=reco';

  return (
    <div className="flex-1 flex flex-col bg-white pb-24 overflow-hidden">
      {/* header */}
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-bold w-9 h-9 flex items-center justify-center"
        >
          ‹
        </button>
      </div>
      <div className="px-5 pt-2 pb-4">
        <h1 className="text-[24px] font-extrabold text-black">{headerTitle}</h1>
        <button
          onClick={() => navigate(altPath)}
          className="text-[14px] font-bold text-g underline underline-offset-2 mt-1"
        >
          {altLink}
        </button>
      </div>

      {/* search */}
      <div className="px-5 pb-3">
        <div className="bg-white border border-bdr rounded-[14px] px-4 py-3 flex items-center gap-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search contacts"
            className="flex-1 text-[14px] text-black placeholder-b3 outline-none bg-transparent"
          />
        </div>
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto">
        {Object.keys(grouped).sort().map(letter => (
          <div key={letter}>
            <div className="bg-bg5 px-5 py-1">
              <p className="text-[13px] font-extrabold text-b3 uppercase">{letter}</p>
            </div>
            {grouped[letter].map(c => {
              const isSel = selected.has(c.id);
              return (
                <div key={c.id} className="px-5 py-3 flex items-center gap-3 border-b border-bdr">
                  {c.hasPhoto ? (
                    <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${c.avatarBg}
                                     flex items-center justify-center text-white text-[14px] font-extrabold flex-shrink-0`}>
                      {getInitials(c.name)}
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-bg5 flex items-center justify-center flex-shrink-0">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9B9B9B" strokeWidth="1.6" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="text-[15px] font-extrabold text-black">{c.name}</p>
                    <p className="text-[12px] text-b3">{c.phone}</p>
                  </div>
                  <button
                    onClick={() => toggle(c.id)}
                    className={`rounded-[24px] px-4 py-2 text-[13px] font-extrabold transition-colors
                                ${isSel
                                  ? 'bg-g text-white'
                                  : 'bg-white border-2 border-g text-g'}`}
                  >
                    {isSel ? 'Selected' : '+ Invite'}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* footer */}
      {selectedList.length > 0 && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] bg-white border-t border-bdr px-5 pt-3 pb-5">
          {summary && (
            <p className="text-[12px] text-b3 mb-2 truncate">{summary}</p>
          )}
          <button
            onClick={() => navigate('/invite/review', { state: { mode, selectedIds: Array.from(selected) } })}
            className="w-full bg-g text-white rounded-[24px] py-3.5 text-[15px] font-extrabold
                       hover:opacity-90 active:scale-[.97] transition-all"
          >
            {mode === 'reco' ? 'Continue' : `Invite selected (${selectedList.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
