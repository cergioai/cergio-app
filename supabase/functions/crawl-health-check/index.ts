// Supabase Edge Function — SPEC-63 crawl health check + alerting.
//
// The app ENQUEUES crawl_requests; a separate crawler service is supposed to
// pick them up, crawl + message leads, and stamp status='delivered'. If that
// crawler stops (or errors, or returns nothing), requests would pile up at
// status='new' and USERS WOULD GET NO RESULTS, silently. This function is the
// watchdog: it classifies problems and emails the admin a plain-English
// diagnosis so a stalled pipeline never goes unnoticed.
//
// Detects:
//   • STALLED   — status in (new,crawling) older than STALE_HOURS  → crawler not polling
//   • FAILED    — status = 'failed'                                → crawler errored (see notes)
//   • EMPTY     — status = 'delivered' but delivered_count = 0      → crawler found nothing
//
// Returns the same JSON it emails, so it also powers the admin dashboard and the
// "Crawl Health Check.command" launcher. Email goes out only when there are
// issues (or when ?force=1). Auth: service-role bearer only (cron / launcher).
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
// Optional env: CRAWL_STALE_HOURS (default 2), ADMIN_ALERT_EMAIL (default t@cergio.ai).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const FROM_EMAIL = 'Cergio <notify@cergio.ai>';

serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return json({ error: 'Unauthorized' }, 401);

    const url = new URL(req.url);
    const force = url.searchParams.get('force') === '1';
    const staleHours = Number(Deno.env.get('CRAWL_STALE_HOURS') || '2');
    const adminEmail = Deno.env.get('ADMIN_ALERT_EMAIL') || 't@cergio.ai';
    const db = createClient(supabaseUrl, serviceKey);

    const sinceIso = new Date(Date.now() - staleHours * 3600 * 1000).toISOString();

    // STALLED — open requests older than the threshold.
    const { data: stalled } = await db
      .from('crawl_requests')
      .select('id, kind, city, state, service_type, status, created_at')
      .in('status', ['new', 'crawling'])
      .lt('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(100);

    // FAILED.
    const { data: failed } = await db
      .from('crawl_requests')
      .select('id, kind, city, service_type, status, notes, updated_at')
      .eq('status', 'failed')
      .order('updated_at', { ascending: false })
      .limit(100);

    // EMPTY — delivered but nothing found.
    const { data: empty } = await db
      .from('crawl_requests')
      .select('id, kind, city, service_type, delivered_count, updated_at')
      .eq('status', 'delivered')
      .eq('delivered_count', 0)
      .order('updated_at', { ascending: false })
      .limit(100);

    // Overall queue snapshot.
    const { data: queue } = await db
      .from('crawl_requests')
      .select('kind, status')
      .limit(2000);
    const byStatus: Record<string, number> = {};
    for (const r of queue ?? []) {
      const k = `${r.kind}/${r.status}`;
      byStatus[k] = (byStatus[k] ?? 0) + 1;
    }

    const issues: Array<{ type: string; severity: string; count: number; diagnosis: string; fix: string; rows: unknown[] }> = [];
    if ((stalled ?? []).length) issues.push({
      type: 'STALLED', severity: 'critical', count: stalled!.length,
      diagnosis: `${stalled!.length} crawl request(s) have sat unworked for over ${staleHours}h. The crawler service is not picking up the queue — users in these locations are getting no results.`,
      fix: 'Check the crawler service is running and polling crawl_requests WHERE status=\'new\'. Confirm its service-role key + project ref are correct.',
      rows: stalled!,
    });
    if ((failed ?? []).length) issues.push({
      type: 'FAILED', severity: 'high', count: failed!.length,
      diagnosis: `${failed!.length} crawl request(s) are marked failed. The crawler errored on these.`,
      fix: 'Read each row\'s notes for the error; re-queue by setting status=\'new\' after fixing the cause.',
      rows: failed!,
    });
    if ((empty ?? []).length) issues.push({
      type: 'EMPTY', severity: 'medium', count: empty!.length,
      diagnosis: `${empty!.length} crawl(s) delivered ZERO leads. The crawler ran but found nothing for that city/type.`,
      fix: 'Verify the source coverage for that vertical/geo, widen the radius, or broaden the service_type mapping.',
      rows: empty!,
    });

    const ok = issues.length === 0;
    const report = { ok, checked_at: new Date().toISOString(), stale_hours: staleHours, queue_by_status: byStatus, issues };

    // Email the admin when there are issues (or forced).
    let emailed = false;
    if (!ok || force) {
      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (resendKey) {
        const html = renderEmail(report);
        const subject = ok
          ? '✅ Cergio crawl pipeline healthy'
          : `🚨 Cergio crawl pipeline: ${issues.map(i => `${i.count} ${i.type}`).join(', ')}`;
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM_EMAIL, to: adminEmail, subject, html }),
        });
        emailed = r.ok;
      }
    }

    // ── SPEC-72.1 · SELF-HEAL: keep the FREE OSM seeder alive without a cron ─────
    // ROOT CAUSE (forensic runs 30/35/36): the crawl-seed-osm seeder was REGISTERED
    // (migration 20260715 osm_primary_source) but the cron.schedule migration that
    // was supposed to actually INVOKE it (20260717120000_schedule_crawl_seed_osm)
    // merged to main WITHOUT ever being applied to the live DB — deploy-functions.yml
    // deploys FUNCTIONS only and deliberately never runs `db push`; the manual apply
    // launcher (run30) was never clicked; the _autorun drop is dead. Net effect: the
    // seeder never fires → zero OSM crawl_requests are enqueued → fulfill-crawl (15m)
    // drains nothing → services intake has been flat (~32,531) for days.
    //
    // THIS worker already runs on an APPLIED every-2h cron (cergio_crawl_health,
    // FROZEN SPEC-63/-52), so we piggy-back the single wire the un-applied migration
    // was meant to add: when the open services queue has run dry, kick the keyless
    // Overpass seeder to refill it. Intake now self-heals with no migration apply and
    // no founder click.
    //
    // SAFE · free-first · reversible · additive:
    //   * ENQUEUE-ONLY and dedup-guarded inside crawl-seed-osm (it pre-filters OPEN
    //     rows) → repeated kicks never duplicate work / can't worsen the de-dup pile.
    //   * ZERO paid calls — Overpass is keyless; Google Places stays dormant.
    //   * Detection/email path above is UNCHANGED (SPEC-63 behavior is untouched).
    //   * One env flag OSM_SELFHEAL_ENABLED (default on) fully reverses it;
    //     OSM_SELFHEAL_REFILL_BELOW tunes the dry-queue threshold.
    let osm_selfheal: Record<string, unknown> = { enabled: false, kicked: false };
    try {
      const selfhealOn = (Deno.env.get('OSM_SELFHEAL_ENABLED') || 'true').toLowerCase() !== 'false';
      const refillBelow = Number(Deno.env.get('OSM_SELFHEAL_REFILL_BELOW') || '50');
      const openServices = (byStatus['services/new'] ?? 0) + (byStatus['services/crawling'] ?? 0);
      osm_selfheal = { enabled: selfhealOn, open_services: openServices, refill_below: refillBelow, kicked: false };
      if (selfhealOn && openServices < refillBelow) {
        const { error: kickErr } = await db.rpc('cergio_call_edge', { fn: 'crawl-seed-osm' });
        osm_selfheal.kicked = !kickErr;
        if (kickErr) osm_selfheal.error = String(kickErr.message || kickErr).slice(0, 200);
      }
    } catch (e) {
      osm_selfheal = { ...osm_selfheal, error: e instanceof Error ? e.message : String(e) };
    }

    return json({ ...report, emailed, osm_selfheal });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function renderEmail(report: any): string {
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (report.ok) return `<p>Crawl pipeline healthy as of ${esc(report.checked_at)}. No stalled, failed, or empty crawls.</p>`;
  const blocks = report.issues.map((i: any) => {
    const rows = i.rows.slice(0, 15).map((r: any) =>
      `<li>${esc(r.city || '?')}${r.state ? ', ' + esc(r.state) : ''} — ${esc(r.kind)}/${esc(r.service_type || 'any')} — ${esc(r.status || '')}${r.notes ? ' — ' + esc(r.notes) : ''}</li>`,
    ).join('');
    return `<h3>${esc(i.type)} · ${i.count} (${esc(i.severity)})</h3>
      <p><b>What's wrong:</b> ${esc(i.diagnosis)}</p>
      <p><b>Fix:</b> ${esc(i.fix)}</p>
      <ul>${rows}</ul>`;
  }).join('');
  return `<h2>Cergio crawl pipeline needs attention</h2>
    <p>Checked ${esc(report.checked_at)} (stall threshold ${esc(report.stale_hours)}h).</p>
    ${blocks}
    <p>Full live view: open the Admin → Crawls dashboard in the app.</p>`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
