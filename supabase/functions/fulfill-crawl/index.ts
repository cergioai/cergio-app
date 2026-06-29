// Supabase Edge Function — SPEC-64 in-app crawl fulfillment (Option A).
//
// Closes the "no crawl, no notify" gap: when a user searches a city with no
// providers, the app enqueues a crawl_request. This worker FULFILLS it:
//   1. Find real local businesses via the Google Places API (Text Search +
//      Details for phone/website) for the city + service_type.
//   2. Upsert them into leads_services (dedupe by Google place_id), staged at
//      outreach_status='new'. NOTE: we DO NOT send any cold email/SMS here —
//      contacting businesses that never opted in is governed by CAN-SPAM / TCPA,
//      so leads are QUEUED for the operator to review + send. (See FROZEN_SPEC.)
//   3. Stamp crawl_requests status='delivered' + delivered_count (or 'failed').
//   4. Notify the SEARCHER (requested_by) by email so they're never left
//      hanging: "we're adding <type> in <city> — we'll notify you as pros join."
//
// Only handles kind='services' (Google Places is a business directory; influencer
// crawls remain for the external/manual pipeline).
//
// AUTH: service-role bearer only (cron / "Fulfill Crawls.command").
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//          GOOGLE_PLACES_API_KEY  (server key — must NOT be HTTP-referrer
//          restricted, or Google returns REQUEST_DENIED for server calls).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const FROM_EMAIL = 'Cergio <notify@cergio.ai>';
const MAX_REQUESTS_PER_RUN = 5;

serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const placesKey   = Deno.env.get('GOOGLE_PLACES_API_KEY')
      || Deno.env.get('GOOGLE_MAPS_KEY') || '';
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return json({ error: 'Unauthorized' }, 401);
    if (!placesKey) return json({ error: 'GOOGLE_PLACES_API_KEY not set (server key, no referrer restriction)' }, 500);

    const db = createClient(supabaseUrl, serviceKey);

    // Pick up unworked service crawls.
    const { data: jobs, error: jobsErr } = await db
      .from('crawl_requests')
      .select('id, kind, city, state, service_type, target_count, requested_by, status')
      .eq('kind', 'services')
      .eq('status', 'new')
      .order('created_at', { ascending: true })
      .limit(MAX_REQUESTS_PER_RUN);
    if (jobsErr) throw jobsErr;

    const out: Array<Record<string, unknown>> = [];
    for (const job of jobs ?? []) {
      // Mark crawling so concurrent runs don't double-process.
      await db.from('crawl_requests').update({ status: 'crawling', updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'new');

      try {
        const want = Math.min(Math.max(job.target_count || 10, 1), 20);
        const where = [job.city, job.state].filter(Boolean).join(', ');
        const query = `${job.service_type || 'local service'} in ${where || 'United States'}`;

        // ── Google Places Text Search ─────────────────────────────────────────
        const tsUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${placesKey}`;
        const tsRes = await fetch(tsUrl);
        const ts = await tsRes.json();
        if (ts.status && ts.status !== 'OK' && ts.status !== 'ZERO_RESULTS') {
          throw new Error(`Places: ${ts.status}${ts.error_message ? ' — ' + ts.error_message : ''}`);
        }
        const results = (ts.results || []).slice(0, want);

        // ── Details (phone + website) + upsert leads ──────────────────────────
        let saved = 0;
        for (const r of results) {
          let phone = null, website = null, email = null;
          try {
            const dUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${r.place_id}&fields=formatted_phone_number,website&key=${placesKey}`;
            const dRes = await fetch(dUrl);
            const d = await dRes.json();
            phone = d.result?.formatted_phone_number ?? null;
            website = d.result?.website ?? null;
          } catch { /* details best-effort */ }

          // SPEC-65: best-effort capture of a PUBLIC contact email from the
          // business's own website, so compliant email outreach has an address.
          if (website) email = await scrapeEmail(website);

          const row = {
            id: r.place_id,
            name: r.name,
            service_type: job.service_type || null,
            phone, phone_origin: phone ? 'google_places' : null,
            website_url: website,
            owner_email: email,
            address: r.formatted_address || null,
            city: job.city || null,
            state: job.state || 'FL',
            lat: r.geometry?.location?.lat ?? null,
            lon: r.geometry?.location?.lng ?? null,
            data_source: 'google_places',
            fetched_at: new Date().toISOString(),
            outreach_status: 'new', // raw/ungraded — the gate promotes mobile→'queued'; never auto-sent
            outreach_notes: `auto-sourced via Google Places (${job.city || '?'}) ${new Date().toISOString().slice(0,10)}`,
          };
          // 2026-06-28 reset: service crawls feed leads_services (the real mobile
          // provider bucket that outreach + the gate read). leads_localbiz is
          // dormant (brick-and-mortar Phase 2). The gate quarantines storefront/
          // off-target rows; only mobile/reachable types are promoted to 'queued'.
          const { error: upErr } = await db.from('leads_services').upsert(row, { onConflict: 'id' });
          if (!upErr) saved++;
        }

        await db.from('crawl_requests').update({
          status: 'delivered', delivered_count: saved,
          notes: saved === 0 ? 'no Google Places results for this city/type' : null,
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);

        // ── Notify the searcher ───────────────────────────────────────────────
        await notifySearcher(db, job, saved);
        out.push({ id: job.id, query, found: results.length, saved });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.from('crawl_requests').update({ status: 'failed', notes: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', job.id);
        out.push({ id: job.id, error: msg });
      }
    }

    return json({ processed: out.length, results: out });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function notifySearcher(db: any, job: any, saved: number) {
  try {
    if (!job.requested_by) return;
    const { data: u } = await db.auth.admin.getUserById(job.requested_by);
    const email = u?.user?.email;
    if (!email) return;
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return;
    const place = job.city || 'your area';
    const type = job.service_type || 'local pros';
    const subject = saved > 0
      ? `We're adding ${type} in ${place} to Cergio`
      : `We're working on ${type} in ${place}`;
    const body = saved > 0
      ? `Good news — we found ${saved} ${type} in ${place} and we're working to bring them onto Cergio. We'll notify you as they become available so you can book through your network.`
      : `Thanks for searching ${type} in ${place}. We don't have them yet, but your request told us to source that area — we'll notify you as soon as pros are available.`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: email, subject, html: `<p>${body}</p>` }),
    });
  } catch { /* notify best-effort; never fail the crawl on it */ }
}

// Best-effort: fetch a business homepage and pull the first published contact
// email. Skips role addresses that aren't useful and obvious junk. Times out
// fast so one slow site can't stall the run. Returns null if none found.
async function scrapeEmail(website: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(website, { signal: ctrl.signal, headers: { 'User-Agent': 'CergioBot/1.0 (+https://cergio.ai)' } });
    clearTimeout(t);
    if (!res.ok) return null;
    const htmlText = (await res.text()).slice(0, 200000);
    const matches = htmlText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    for (const m of matches) {
      const e = m.toLowerCase();
      if (/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/.test(e)) continue; // asset filename false-positives
      if (/(sentry|wixpress|example\.com|godaddy|squarespace)/.test(e)) continue;
      return e;
    }
    return null;
  } catch { return null; }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
