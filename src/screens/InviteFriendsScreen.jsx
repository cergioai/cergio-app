// CERGIO-GUARD (2026-05-30): contacts picker for invite/reco flow —
// rewritten to load REAL profiles, not the CONTACTS mock.
//
// Tarik: "populate with test data instead of hard coded data... button
// at bottom is hidden". Two fixes:
//   1. listInvitableProfiles() pulls real profiles from supabase
//      (seeded Alex/Connie/Sam/etc. + any future signups). No more
//      Angel Smith / Aaron Cole / etc. fake names.
//   2. The CTA footer was `fixed bottom-0` inside a `pb-24 overflow-hidden`
//      container — on some viewports the fixed positioning + the parent's
//      overflow could clip the button below the visible area. Switched
//      to a sticky-at-end flex footer (mt-auto + shrink-0) so it's
//      ALWAYS the last block in the column and never gets covered.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation, useOutletContext } from 'react-router-dom';
import { listInvitableProfiles } from '../lib/api';
import { importGoogleContacts, isGoogleContactsConfigured } from '../lib/googleContacts';

function initialsOf(name) {
  if (!name) return '?';
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

// Stable gradient pick from id — same pool used across the app so
// avatars on this screen match the avatars on /u/{id}.
const AV_GRADS = [
  'from-[#8A6FD6] to-[#4F3DB0]',
  'from-[#F5A65E] to-[#C76A18]',
  'from-[#EE5586] to-[#A52454]',
  'from-[#5BC404] to-[#2F6E00]',
  'from-[#4478AA] to-[#2A5070]',
  'from-[#b06090] to-[#703050]',
];
function gradFor(seed) {
  if (!seed) return AV_GRADS[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AV_GRADS[Math.abs(h) % AV_GRADS.length];
}

export function InviteFriendsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useOutletContext();
  const [params]  = useSearchParams();
  const mode      = params.get('mode') === 'reco' ? 'reco' : 'invite';
  // Forward the prefilled request message from ResultsScreen → review.
  const prefilledMessage = location.state?.prefilledMessage || null;

  const [contacts, setContacts] = useState(null); // null = loading
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState('');

  // CERGIO-GUARD (2026-06-12): device contacts-book import. Tarik:
  // "need ability to connect my contacts book to upload them". Uses
  // ONLY the native Contact Picker API — same rules as SPEC-46:
  // never synthesize contacts, never fall back to Cergio profiles,
  // unsupported browsers get an honest toast. Imported contacts get
  // ids prefixed 'dev:' so they never collide with profile UUIDs and
  // the review screen knows to send a real email/SMS invite (these
  // people are NOT on Cergio yet).
  const [deviceContacts, setDeviceContacts] = useState([]);
  const [gmailBusy, setGmailBusy] = useState(false);
  const gmailReady = isGoogleContactsConfigured();
  const fileInputRef = useRef(null);
  const supportsContactPicker = typeof navigator !== 'undefined' &&
    'contacts' in navigator && typeof window !== 'undefined' && 'ContactsManager' in window;

  // Merge helper — dedupes on email/phone/name, never synthesizes fields.
  const mergeDeviceContacts = (incoming) => {
    setDeviceContacts(prev => {
      const seen = new Set(prev.map(c => c.dedupe));
      const next = [...prev];
      for (const c of incoming) {
        const name  = (c.name  || '').trim();
        const email = (c.email || '').trim();
        const phone = (c.phone || '').trim();
        if (!name && !email && !phone) continue;
        const dedupe = email || phone || name;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        next.push({
          id: `dev:${dedupe}`,
          name: name || email || phone,
          email, phone, dedupe,
          initial: (name || email || phone)[0].toUpperCase(),
          device: true,
        });
      }
      return next;
    });
  };

  const importFromContacts = async () => {
    if (!supportsContactPicker) {
      // CERGIO-GUARD (2026-06-12): desktop fallback per Tarik ("says
      // contacts picker needs android / mobile"). The native Contact
      // Picker API genuinely only exists on Chrome Android — on desktop
      // we open a file picker for a contacts export (.csv from Google
      // Contacts / Outlook, or .vcf vCard). Real contacts only.
      fileInputRef.current?.click();
      return;
    }
    try {
      const picked = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: true });
      if (!picked?.length) return;
      mergeDeviceContacts(picked.map(c => ({
        name:  (c.name  || [])[0] || '',
        email: (c.email || [])[0] || '',
        phone: (c.tel   || [])[0] || '',
      })));
      showToast('Contacts added — pick who to invite');
    } catch {
      /* user cancelled the picker — not an error */
    }
  };

  // Connect Gmail (desktop gold-standard import). Opens Google consent,
  // pulls People API connections, merges them like device contacts. Falls
  // back to the CSV/vCard file picker when Gmail isn't configured yet.
  const importFromGmail = async () => {
    if (!gmailReady) { fileInputRef.current?.click(); return; }
    setGmailBusy(true);
    try {
      const rows = await importGoogleContacts();
      if (!rows.length) { showToast('No contacts found in that Google account.'); return; }
      mergeDeviceContacts(rows);
      showToast(`${rows.length} Gmail contacts added — pick who to invite`);
    } catch (e) {
      showToast(e?.message || 'Could not connect Gmail — try again.');
    } finally {
      setGmailBusy(false);
    }
  };

  // Parse a Google Contacts / Outlook CSV export. Header-driven: finds
  // name/email/phone columns by pattern so both export shapes work.
  const parseContactsCsv = (text) => {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQ = false;
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    if (rows.length < 2) return [];
    const header = rows[0].map(h => h.toLowerCase());
    const col = (re) => header.findIndex(h => re.test(h));
    const iName  = col(/^name$|display name|^first name$/);
    const iLast  = col(/^last name$/);
    const iEmail = col(/e-?mail.*(1 - value|address)?|^e-?mail$/);
    const iPhone = col(/phone.*(1 - value|number)?|^mobile/);
    return rows.slice(1).map(r => {
      const first = iName  >= 0 ? r[iName]  || '' : '';
      const last  = iLast  >= 0 ? r[iLast]  || '' : '';
      return {
        name:  `${first} ${last}`.trim(),
        email: iEmail >= 0 ? (r[iEmail] || '').split(':').pop().trim() : '',
        phone: iPhone >= 0 ? (r[iPhone] || '').split(':').pop().trim() : '',
      };
    });
  };

  // Parse a vCard (.vcf) export — FN / EMAIL / TEL per card.
  const parseVcf = (text) => text.split(/BEGIN:VCARD/i).slice(1).map(card => {
    const grab = (re) => (card.match(re) || [, ''])[1].trim();
    return {
      name:  grab(/\nFN[^:]*:(.+)/i),
      email: grab(/\nEMAIL[^:]*:(.+)/i),
      phone: grab(/\nTEL[^:]*:(.+)/i),
    };
  });

  const handleContactsFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text   = await f.text();
      const parsed = /\.vcf$/i.test(f.name) ? parseVcf(text) : parseContactsCsv(text);
      const usable = parsed.filter(c => (c.name || c.email || c.phone));
      if (usable.length === 0) {
        showToast('No contacts found — export a .csv or .vcf from Google Contacts and try again.');
        return;
      }
      mergeDeviceContacts(usable);
      showToast(`${usable.length} contacts imported — pick who to invite`);
    } catch {
      showToast("Couldn't read that file — export a .csv or .vcf and try again.");
    } finally {
      e.target.value = '';
    }
  };

  // Real profiles — replaces the CONTACTS mock.
  useEffect(() => {
    let cancelled = false;
    listInvitableProfiles({ limit: 200 }).then(({ data }) => {
      if (cancelled) return;
      setContacts(data || []);
      // CERGIO-GUARD: no pre-selection — user picks their own contacts.
    });
    return () => { cancelled = true; };
  }, []);

  const list = contacts || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter(c => c.name.toLowerCase().includes(q)) : list;
  }, [query, list]);

  // Device contacts honor the same search box.
  const filteredDevice = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? deviceContacts.filter(c =>
          [c.name, c.email, c.phone].filter(Boolean).some(v => v.toLowerCase().includes(q)))
      : deviceContacts;
  }, [query, deviceContacts]);

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

  const selectedList = [...deviceContacts, ...list].filter(c => selected.has(c.id));
  const summary = selectedList.length === 0
    ? null
    : selectedList.length <= 3
      ? selectedList.map(c => c.name).join(', ')
      : `${selectedList.slice(0, 3).map(c => c.name).join(', ')}, and ${selectedList.length - 3} others`;

  const headerTitle = mode === 'reco' ? 'Recommend a service' : 'Invite a friend';
  const altLink     = mode === 'reco' ? 'Or, invite a friend' : 'Or, recommend a service';
  // CERGIO-GUARD (2026-06-04): "Or, recommend a service" used to send
  // users to /invite/friends?mode=reco — which just re-listed the
  // same contacts as a generic picker without asking which service
  // they're recommending. Tarik: "the reco form from the invite is
  // wrong … the link should take the reco form from where to plug
  // your contacts (here /invite/recommend), not the current one
  // which lists all users." Route directly to the proper reco form
  // (RecommendServiceFormScreen at /invite/recommend) which asks the
  // user to pick a service first, then a contact.
  const altPath     = mode === 'reco' ? '/invite/friends' : '/invite/recommend';

  return (
    // CERGIO-GUARD: outer is flex-col with no overflow-hidden so the
    // sticky footer at the end of the column always renders inside the
    // visible viewport. The list area handles its own scroll.
    <div className="flex-1 flex flex-col bg-cream">
      {/* header — cream bg per app-wide canon. Page title 30px / 800 to
          match Profile. Helper microcopy below explains what tapping does. */}
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-extrabold w-9 h-9 flex items-center justify-center"
        >
          ‹
        </button>
      </div>
      <div className="px-5 pt-2 pb-4">
        <h1 className="text-display-1 font-extrabold text-black leading-tight">{headerTitle}</h1>
        <p className="text-body-sm text-b3 font-medium mt-1.5 leading-snug">
          {mode === 'reco'
            ? 'Pick contacts and we send them your recommendation — they tap one link to book.'
            : 'Pick contacts and we send a friendly invite — you earn when they join.'}
        </p>
        <button
          onClick={() => navigate(altPath)}
          className="text-body-sm font-extrabold text-g underline underline-offset-2 mt-2"
        >
          {altLink}
        </button>
      </div>

      {/* CERGIO-GUARD (2026-06-12): contacts-book connect button.
          Real device contacts via the native picker — Cergio-network
          profiles below stay untouched (SPEC-43). */}
      {/* CERGIO-GUARD (2026-06-18, Tarik — Gmail is the permanent web gold
          standard; native iOS/Android picker comes post-launch): show ONE clear
          PRIMARY import path for the device, plus at most one quiet fallback —
          never two identical "upload a file" buttons.
            • Android  → native phone-contacts picker (best on mobile).
            • iOS/desktop + Gmail configured → one-tap Connect Gmail (primary).
            • otherwise → a single clean contacts-file upload. */}
      <div className="px-5 pb-3 flex flex-col gap-2">
        {supportsContactPicker ? (
          <button
            type="button"
            onClick={importFromContacts}
            className="w-full bg-g text-white rounded-[14px] py-3 px-4 flex items-center justify-center gap-2 text-body-sm font-extrabold hover:opacity-90 active:scale-[.98] transition"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="2.5"/><path d="M8.5 17c.7-1.8 2-2.5 3.5-2.5s2.8.7 3.5 2.5"/>
            </svg>
            Pick from your phone contacts
          </button>
        ) : gmailReady ? (
          <button
            type="button"
            onClick={importFromGmail}
            disabled={gmailBusy}
            className="w-full bg-g text-white rounded-[14px] py-3 px-4 flex items-center justify-center gap-2 text-body-sm font-extrabold hover:opacity-90 active:scale-[.98] transition disabled:opacity-60"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#fff" d="M22 12.06c0-.7-.06-1.36-.18-2H12v3.83h5.6a4.8 4.8 0 0 1-2.08 3.15v2.62h3.36C20.85 17.9 22 15.27 22 12.06z"/>
              <path fill="#fff" d="M12 22c2.7 0 4.97-.9 6.62-2.43l-3.36-2.62c-.93.62-2.12.99-3.26.99-2.5 0-4.62-1.69-5.38-3.96H3.15v2.6A10 10 0 0 0 12 22z"/>
              <path fill="#fff" d="M6.62 13.98a6 6 0 0 1 0-3.84v-2.6H3.15a10 10 0 0 0 0 9.04l3.47-2.6z"/>
              <path fill="#fff" d="M12 6.18c1.47 0 2.79.5 3.83 1.5l2.87-2.87A10 10 0 0 0 12 2 10 10 0 0 0 3.15 7.54l3.47 2.6C7.38 7.87 9.5 6.18 12 6.18z"/>
            </svg>
            {gmailBusy ? 'Connecting Gmail…' : 'Connect Gmail — import contacts'}
          </button>
        ) : (
          <button
            type="button"
            onClick={importFromContacts}
            className="w-full bg-g text-white rounded-[14px] py-3 px-4 flex items-center justify-center gap-2 text-body-sm font-extrabold hover:opacity-90 active:scale-[.98] transition"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="2.5"/><path d="M8.5 17c.7-1.8 2-2.5 3.5-2.5s2.8.7 3.5 2.5"/>
            </svg>
            Upload a contacts file (.csv / .vcf)
          </button>
        )}

        {/* Quiet fallback — ONLY when the primary above isn't already the file
            upload (i.e. Android native, or Gmail). Never a duplicate. */}
        {(supportsContactPicker || gmailReady) && (
          <button
            type="button"
            onClick={importFromContacts}
            className="w-full bg-white border border-bdr text-b2 rounded-[14px] py-2.5 px-4 flex items-center justify-center gap-2 text-meta font-extrabold hover:bg-bg5 transition-colors"
          >
            Or upload a contacts file (.csv / .vcf)
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.vcf,text/csv,text/vcard"
          onChange={handleContactsFile}
          className="hidden"
          aria-hidden="true"
        />
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
            className="flex-1 text-body text-black placeholder-b3 outline-none bg-transparent"
          />
        </div>
      </div>

      {/* list — scrollable, takes remaining vertical space above the
          sticky CTA footer */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* From your contacts book — imported device contacts, own section
            so they're never confused with Cergio profiles. */}
        {filteredDevice.length > 0 && (
          <div>
            <div className="bg-gl px-5 py-1">
              <p className="text-body-sm font-extrabold text-gd uppercase">From your contacts</p>
            </div>
            {filteredDevice.map(c => {
              const isSel = selected.has(c.id);
              return (
                <div key={c.id} className="px-5 py-3 flex items-center gap-3 border-b border-bdr">
                  <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${gradFor(c.name)}
                                   flex items-center justify-center text-white text-body font-extrabold flex-shrink-0`}>
                    {initialsOf(c.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-body-lg font-extrabold text-black truncate">{c.name}</p>
                    {(c.phone || c.email) && (
                      <p className="text-meta-sm text-b3 font-medium mt-0.5 truncate">
                        {c.phone || c.email}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => toggle(c.id)}
                    className={`rounded-[24px] px-4 py-2 text-body-sm font-extrabold transition-colors flex-shrink-0
                                ${isSel
                                  ? 'bg-g text-white'
                                  : 'bg-white border-2 border-g text-g'}`}
                  >
                    {isSel ? 'Selected' : mode === 'reco' ? '+ Reco' : '+ Invite'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {contacts === null ? (
          <div className="px-5 py-8 text-center">
            <p className="text-body-sm text-b3 font-medium">Loading contacts…</p>
          </div>
        ) : list.length === 0 && filteredDevice.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-body font-extrabold text-black">No one to invite yet</p>
            <p className="text-meta text-b3 font-medium mt-1 leading-snug">
              Connect your contacts book above, or when friends sign up to Cergio they&apos;ll appear here.
            </p>
          </div>
        ) : Object.keys(grouped).sort().map(letter => (
          <div key={letter}>
            <div className="bg-bg5 px-5 py-1">
              <p className="text-body-sm font-extrabold text-b3 uppercase">{letter}</p>
            </div>
            {grouped[letter].map(c => {
              const isSel = selected.has(c.id);
              return (
                <div key={c.id} className="px-5 py-3 flex items-center gap-3 border-b border-bdr">
                  <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${gradFor(c.avatar_seed)}
                                   flex items-center justify-center text-white text-body font-extrabold flex-shrink-0`}>
                    {initialsOf(c.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-body-lg font-extrabold text-black truncate">{c.name}</p>
                    {c.is_connector && (
                      <p className="text-meta-sm text-gd font-extrabold inline-flex items-center gap-1 mt-0.5">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.4">
                          <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
                        </svg>
                        Connector
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => toggle(c.id)}
                    className={`rounded-[24px] px-4 py-2 text-body-sm font-extrabold transition-colors flex-shrink-0
                                ${isSel
                                  ? 'bg-g text-white'
                                  : 'bg-white border-2 border-g text-g'}`}
                  >
                    {isSel ? 'Selected' : mode === 'reco' ? '+ Reco' : '+ Invite'}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Sticky CTA footer — was `fixed bottom-0` and could hide on
          certain viewports. Now it's the last child of the flex column
          with `shrink-0` so it's always visible inside the 390px
          column, never covered by anything. */}
      <div className="shrink-0 bg-white border-t border-bdr px-5 pt-3 pb-5">
        {selectedList.length === 0 ? (
          <p className="text-center text-meta text-b3 font-medium py-2">
            Pick at least one contact to continue
          </p>
        ) : (
          <>
            {summary && (
              <p className="text-meta text-b3 mb-2 truncate">{summary}</p>
            )}
            <button
              onClick={() => navigate('/invite/review', {
                state: {
                  mode,
                  selectedIds: Array.from(selected),
                  // Device-book contacts ride along with full contact
                  // details — they're not in the profiles table, so the
                  // review screen sends them a real email/SMS invite.
                  deviceContacts: selectedList.filter(c => c.device),
                  prefilledMessage,
                },
              })}
              className="w-full bg-g text-white rounded-[24px] py-4 text-heading-2 font-extrabold
                         hover:opacity-90 active:scale-[.97] transition-all"
            >
              {mode === 'reco' ? `Continue (${selectedList.length})` : `Invite selected (${selectedList.length})`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
