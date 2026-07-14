// CERGIO-GUARD: this banner exists because we kept shipping band-aids
// for missing migrations / env vars that failed silently. It runs at
// app load, probes the live deployment, and surfaces a single bright
// banner naming the EXACT remediation. Add new checks here every time
// a load-bearing piece of infra gets added so the user never has to
// guess what's missing.
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase, supabaseReady } from '../../lib/supabase';
import {
  getGoogleMapsKey,
  getGoogleMapsStatus,
  onGoogleMapsStatusChange,
  describeGoogleError,
  clearGeocodeError,
} from '../../lib/google';

// How long a geocode error is held before it's shown to the user. The
// Nominatim fallback inside verifyAddress() clears a rescued error well
// inside this window (measured live: ~700ms round-trip), so a rescued
// failure is never rendered. See the A1f guard below.
const GEOCODE_GRACE_MS = 4000;

async function probeTable(name) {
  if (!supabaseReady) return { ok: true }; // can't probe without supabase wired
  // HEAD count is the cheapest possible probe.
  const { error } = await supabase.from(name).select('id', { count: 'exact', head: true }).limit(1);
  if (!error) return { ok: true };
  if (/relation .* does not exist|schema cache|not find/i.test(`${error.message} ${error.details} ${error.hint}`)) {
    return { ok: false, reason: 'missing' };
  }
  return { ok: true }; // RLS / auth errors mean the table EXISTS — that's fine
}

const DISMISS_KEY = 'cergio.setupCheckDismissed';

export function SetupCheckBanner() {
  const [problems, setProblems] = useState([]);
  const [googleProblem, setGoogleProblem] = useState(null); // observed runtime error
  const [dismissed, setDismissed] = useState(() => {
    try { return !!sessionStorage.getItem(DISMISS_KEY); } catch { return false; }
  });
  const { pathname } = useLocation();

  // CERGIO-GUARD (A1d): a geocode error is scoped to the search that
  // produced it. Live 2026-07-13: one unresolvable address on /results
  // pinned the banner and it FOLLOWED the user to /home, /earnings and
  // /inbox — covering the Jobs tab header with a raw "REQUEST_DENIED"
  // string on screens that never geocode anything. On navigation we drop
  // the geocode-kind error (config problems + auth errors are untouched,
  // so a genuinely broken deploy still shouts — SPEC-44).
  useEffect(() => {
    clearGeocodeError();
    setGoogleProblem(p => (p?.key === 'google_runtime_geocode' ? null : p));
  }, [pathname]);

  // Listen for live Google Maps load/auth/geocode errors. This is what
  // surfaces "key rejected", "Places API not enabled", "billing
  // disabled" etc. without the user having to crack open devtools.
  //
  // CERGIO-GUARD (A1f, QA 2026-07-13): a GEOCODE error is only worth
  // showing if nothing rescued it. Live: the production Google key has
  // the Geocoding API disabled, so EVERY search recorded REQUEST_DENIED,
  // flashed a red "Setup needed — geocoder returned REQUEST_DENIED for
  // '134, Henry Street, ...'" banner over the results header, and then
  // vanished ~1s later when the Nominatim fallback resolved the address
  // and cleared the error. Every user, every search, saw a raw provider
  // error string for a search that in fact worked. A geocode error is
  // therefore held for GEOCODE_GRACE_MS: if the fallback clears it (the
  // normal case) the user never sees it; if it's still set after the
  // grace window the address genuinely failed and the banner shows.
  // AUTH + LOAD errors are untouched — they still shout immediately
  // (SPEC-44: a genuinely broken deploy must never be silent).
  useEffect(() => {
    let geoTimer = null;
    const show = (err) => {
      const d = describeGoogleError(err) || {};
      setGoogleProblem({
        key:   `google_runtime_${err.kind}`,
        label: d.title || 'Google Maps error',
        fix:   d.detail || err.message || '',
      });
    };
    const off = onGoogleMapsStatusChange((s) => {
      if (geoTimer) { clearTimeout(geoTimer); geoTimer = null; }
      if (!s.lastError) { setGoogleProblem(null); return; }
      if (s.lastError.kind === 'geocode') {
        const when = s.lastError.when;
        geoTimer = setTimeout(() => {
          const still = getGoogleMapsStatus().lastError;
          // Still the same unrescued geocode failure → it's real, show it.
          if (still?.kind === 'geocode' && still.when === when) show(still);
        }, GEOCODE_GRACE_MS);
        return;
      }
      show(s.lastError);
    });
    return () => { if (geoTimer) clearTimeout(geoTimer); off(); };
  }, []);

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    (async () => {
      const found = [];

      // 1. user_addresses — required for address persistence.
      const ua = await probeTable('user_addresses');
      if (!ua.ok) found.push({
        key: 'user_addresses',
        label: 'Address persistence migration is not applied',
        fix:  'Double-click Run Migrations.command in your Cergio Claude folder.',
      });

      // 2. services taxonomy_* — required for typed routing.
      // Cheap probe: try to select one of the new columns; missing →
      // schema cache error.
      try {
        const { error } = await supabase.from('services')
          .select('taxonomy_category', { count: 'exact', head: true })
          .limit(1);
        if (error && /taxonomy_(category|provider_type|offering_id)|schema cache/i.test(`${error.message}`)) {
          found.push({
            key: 'taxonomy_columns',
            label: 'Taxonomy columns missing on services table',
            fix:  'Double-click Run Migrations.command to apply 20260525190000_taxonomy_columns.sql.',
          });
        }
      } catch { /* ignore */ }

      // 2b. service-covers Storage bucket — required for photo upload.
      // CERGIO-GUARD: do NOT use listBuckets() to probe — it returns
      // an empty array (with no error) for anonymous users even when
      // the bucket exists, producing a false-positive "missing" banner.
      // Probe the bucket DIRECTLY via .list('', limit:1). If the bucket
      // exists we get { data: [...] }; if it doesn't we get an error
      // whose message contains "Bucket not found".
      try {
        const { error: bErr } = await supabase.storage
          .from('service-covers')
          .list('', { limit: 1 });
        if (bErr && /bucket not found|does not exist|404/i.test(`${bErr.message || ''} ${bErr.statusCode || ''}`)) {
          found.push({
            key: 'service_covers_bucket',
            label: 'Service-cover photo bucket not configured',
            fix:  'Apply 20260527000000_storage_service_covers.sql (Run Migrations.command).',
          });
        }
        // Any other error (e.g. anon RLS denial on list-objects) means
        // the bucket exists but the anon role can't list. That's fine —
        // upload writes go through authenticated users.
      } catch { /* network blip — silent */ }

      // 3. Google Maps key — required for address autocomplete + verification.
      if (!getGoogleMapsKey()) {
        found.push({
          key: 'google_maps_key',
          label: 'Google Maps API key not configured',
          fix:  'Set VITE_GOOGLE_MAPS_KEY in your .env.local (or Vercel env) and redeploy.',
        });
      }

      if (!cancelled) setProblems(found);
    })();
    return () => { cancelled = true; };
  }, [dismissed]);

  // Compose static config problems + live Google runtime error.
  const allProblems = googleProblem
    ? [...problems.filter(p => p.key !== 'google_maps_key' || googleProblem.key !== 'google_runtime_auth'), googleProblem]
    : problems;

  if (dismissed || allProblems.length === 0) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] z-[70] px-3 pt-3">
      <div className="bg-warnBg border border-warnText/30 rounded-[14px] p-3 shadow-card">
        <div className="flex items-start gap-2">
          <span className="text-body flex-shrink-0">⚠️</span>
          <div className="flex-1 min-w-0">
            <p className="text-meta font-extrabold text-warnText leading-snug">
              {allProblems.length === 1 ? 'Setup needed' : `${allProblems.length} setup steps needed`}
            </p>
            <ul className="mt-1 space-y-1.5">
              {allProblems.map(p => (
                <li key={p.key} className="text-meta-sm text-warnText leading-snug">
                  <span className="font-extrabold">{p.label}.</span>{' '}
                  <span className="font-normal opacity-90">{p.fix}</span>
                </li>
              ))}
            </ul>
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="text-warnText text-body font-extrabold leading-none px-1"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
