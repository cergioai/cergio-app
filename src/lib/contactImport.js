// Contact import for the P2P SMS tap-queue (SPEC-84b). Lets the founder seed
// outreach from personal relationships: upload a .csv/.vcf, paste a list, or use
// the phone's native contact picker. Pure client-side parsing — the numbers feed
// the SAME tap-to-send queue (human sends each), so it stays genuine P2P.

/** Normalize to a dialable string: keep leading +, strip everything else. */
export function normalizePhone(s) {
  const raw = String(s || '').trim();
  const plus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return (plus ? '+' : '') + digits;
}

/** Minimal, quote-aware CSV → [{name, phone}]. Detects name/phone columns by header. */
export function parseContactsCsv(text) {
  const rows = []; let row = [], field = '', inQ = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
      if (ch === '\r' && s[i + 1] === '\n') i++;
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.toLowerCase());
  const col = (re) => header.findIndex(h => re.test(h));
  const iName = col(/^name$|display name|^first name$|full name/);
  const iLast = col(/^last name$/);
  const iPhone = col(/phone.*(1 - value|number)?|^mobile|^tel/);
  return rows.slice(1).map(r => {
    const first = iName >= 0 ? r[iName] || '' : '';
    const last = iLast >= 0 ? r[iLast] || '' : '';
    return { name: `${first} ${last}`.trim(), phone: normalizePhone(iPhone >= 0 ? (r[iPhone] || '').split(':').pop() : '') };
  });
}

/** vCard (.vcf) → [{name, phone}]. */
export function parseVcf(text) {
  return String(text || '').split(/BEGIN:VCARD/i).slice(1).map(card => {
    const grab = (re) => (card.match(re) || [, ''])[1].trim();
    return { name: grab(/\nFN[^:]*:(.+)/i), phone: normalizePhone(grab(/\nTEL[^:]*:(.+)/i)) };
  });
}

/** Free-paste: one contact per line. "Name, +1555…" | "+1555…, Name" | "+1555…". */
export function parsePasted(text) {
  const has7 = (x) => normalizePhone(x).replace(/\D/g, '').length >= 7;
  return String(text || '').split(/\n+/).map(line => {
    const t = line.trim(); if (!t) return null;
    const parts = t.split(/[,\t;]+/).map(x => x.trim());
    let phone = '', name = '';
    for (const p of parts) { if (!phone && has7(p)) phone = normalizePhone(p); else if (!name && /[a-z]/i.test(p)) name = p; }
    if (!phone && has7(t)) phone = normalizePhone(t);
    return phone ? { name, phone } : null;
  }).filter(Boolean);
}

/** Route a file by extension. */
export function parseContactFile(filename, text) {
  return /\.vcf$/i.test(filename || '') ? parseVcf(text) : parseContactsCsv(text);
}

/** Shape any imported list into tap-queue rows (phone required). */
export function toQueueRows(list) {
  return (list || [])
    .map(c => ({ name: c.name || '', phone: normalizePhone(c.phone), city: c.city || '', service_type: c.service_type || '', ig_handle: c.ig_handle || '' }))
    .filter(c => c.phone);
}
