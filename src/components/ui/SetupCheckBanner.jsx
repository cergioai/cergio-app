// CERGIO-GUARD: this banner exists because we kept shipping band-aids
// for missing migrations / env vars that failed silently. It runs at
// app load, probes the live deployment, and surfaces a single bright
// banner naming the EXACT remediation. Add new checks here every time
// a load-bearing piece of infra gets added so the user never has to
// guess what's missing.
import { useEffect, useState } from 'react';
import { supabase, supabaseReady } from '../../lib/supabase';
import {
  getGoogleMapsKey,
  onGoogleMapsStatusChange,
  describeGoogleError,
} from '../../lib/google';

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

  // Listen for live Google Maps load/auth/geocode errors. This is what
  // surfaces "key rejected", "Places API not enabled", "billing
  // disabled" etc. without the user having to crack open devtools.
  useEffect(() => {
    const off = onGoogleMapsStatusChange((s) => {
      if (s.lastError) {
        const d = describeGoogleError(s.lastError) || {};
        setGoogleProblem({
          key:   `google_runtime_${s.lastError.kind}`,
          label: d.title || 'Google Maps error',
          fix:   d.detail || s.lastError.message || '',
        });
      } else {
        setGoogleProblem(null);
      }
    });
    return off;
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
