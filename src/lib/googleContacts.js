// CERGIO-GUARD (2026-06-16, Tarik — SPEC-52): Gmail contacts import for desktop.
//
// The native Contact Picker API only exists on Chrome Android, so desktop users
// had only a CSV/vCard upload. This adds a one-tap "Connect Gmail" path using
// Google Identity Services (GIS) + the People API (contacts.readonly), returning
// real {name, email, phone} rows to merge into the invite picker.
//
// SETUP REQUIRED (see GOOGLE_CONTACTS_SETUP.md): set VITE_GOOGLE_CLIENT_ID to a
// Google OAuth *Web* client ID with the People API enabled and the app's origin
// in "Authorized JavaScript origins". Until that's set, isGoogleContactsConfigured()
// returns false and the UI hides/disables the button — it NEVER breaks the page.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE   = 'https://www.googleapis.com/auth/contacts.readonly';
const CLIENT_ID = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || '';

export function isGoogleContactsConfigured() {
  return !!CLIENT_ID;
}

let gisPromise = null;
function loadGis() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) { existing.addEventListener('load', () => resolve()); existing.addEventListener('error', reject); return; }
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

function getAccessToken() {
  return new Promise((resolve, reject) => {
    if (!CLIENT_ID) { reject(new Error('Gmail connect is not configured yet.')); return; }
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
          if (resp && resp.access_token) resolve(resp.access_token);
          else reject(new Error('No access granted.'));
        },
        error_callback: () => reject(new Error('Gmail connection cancelled.')),
      });
      client.requestAccessToken();
    } catch (e) { reject(e); }
  });
}

async function fetchConnections(token) {
  const out = [];
  let pageToken = '';
  // People API caps at 1000/page; loop pages defensively (max ~3000).
  for (let i = 0; i < 3; i++) {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections');
    url.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Could not read Google contacts.');
    const json = await res.json();
    for (const p of json.connections || []) {
      out.push({
        name:  p.names?.[0]?.displayName || '',
        email: p.emailAddresses?.[0]?.value || '',
        phone: p.phoneNumbers?.[0]?.value || '',
      });
    }
    pageToken = json.nextPageToken || '';
    if (!pageToken) break;
  }
  // Real rows only — never synthesize (SPEC-12 / feedback_no_fake_feeds).
  return out.filter(c => c.name || c.email || c.phone);
}

// Public: opens Google consent, returns [{name,email,phone}]. Throws on
// cancel/error so the caller can toast.
export async function importGoogleContacts() {
  if (!CLIENT_ID) throw new Error('Gmail connect is not configured yet.');
  await loadGis();
  const token = await getAccessToken();
  return fetchConnections(token);
}
