// Per design-spec.md — Transactions list with Completed / Pending tabs.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TRANSACTIONS } from '../data/mock';

const TABS = ['Completed', 'Pending'];

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

export function TransactionsScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('Completed');
  const rows = tab === 'Completed' ? TRANSACTIONS.completed : TRANSACTIONS.pending;

  return (
    <div className="flex-1 flex flex-col bg-white pb-8 overflow-y-auto">
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white border border-bdr
                     flex items-center justify-center text-black text-base"
        >
          ✕
        </button>
      </div>

      <h1 className="px-5 pt-3 pb-5 text-[28px] font-extrabold text-black tracking-tight">Transactions</h1>

      {/* tabs */}
      <div className="flex items-center gap-6 px-5 border-b border-bdr">
        {TABS.map(t => {
          const active = tab === t;
          return (
            <button key={t} onClick={() => setTab(t)} className="relative pb-3">
              <span className={`text-[15px] ${active ? 'font-extrabold text-black' : 'font-medium text-b3'}`}>
                {t}
              </span>
              {active && <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-black rounded-full" />}
            </button>
          );
        })}
      </div>

      <div className="px-5 flex flex-col">
        {rows.map(r => (
          <div key={r.id} className="flex items-center gap-3 py-4 border-b border-bdr">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#4478aa] to-[#2a5070]
                            flex items-center justify-center text-white text-[14px] font-extrabold flex-shrink-0">
              {getInitials(r.name)}
            </div>
            <div className="flex-1">
              <p className="text-[15px] font-extrabold text-black">{r.name}</p>
              <p className="text-[12px] text-b3 mt-0.5">{r.date}</p>
              <p className={`text-[12px] font-bold mt-0.5 ${
                r.status === 'Paid' ? 'text-g' :
                r.status.includes('In transit') ? 'text-[#4478aa]' :
                'text-b3'
              }`}>{r.status}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[15px] font-extrabold text-black">{r.amount}</p>
              <p className="text-[11px] text-b3 mt-0.5">{r.txnId}</p>
            </div>
            <span className="text-b3 text-lg ml-1">›</span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-[14px] text-b3">No {tab.toLowerCase()} transactions.</p>
          </div>
        )}
      </div>
    </div>
  );
}
