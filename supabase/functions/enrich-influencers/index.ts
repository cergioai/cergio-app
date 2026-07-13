// Supabase Edge Function — SPEC-68 influencer contact enrichment (safe layer).
//
// Raises email/phone coverage on leads_influencers WITHOUT touching Instagram.
// For creators we have no email for, it reads their bio text and fetches their
// own link-in-bio / website (external_url) — third-party public sites, NOT
// Meta's property, so this is low ToS risk and OK to run from Cergio infra.
// (The higher-yield IG contact-button harvest stays in the separate clean-room
// crawler per CRAWLER_BRIEF_IG_contacts.md — never here.)
//
// Fills only NULL fields, never overwrites; skips do_not_contact + suppressed.
// AUTH: service-role bearer only (cron / "Enrich Influencers.command").
//
// ── ROOT CAUSE OF THE "SILENT COLLISION" (found 40, wrote 0 — open since
//    2026-07-08, fixed 2026-07-13) ─────────────────────────────────────────────
// It was never an upsert collision. The candidate query had NO cursor and NO
// ordering: `.is('email', null).limit(40)` returns the SAME head-of-table 40 rows
// on EVERY 30-minute run. Those rows had already been mined and yielded nothing
// (no bio, no external_url, or a site with no address), and NOTHING was written
// back on a miss — so the next run re-picked the identical 40, re-mined the same
// dead links, and wrote 0 again. Forever. A livelock, not a collision.
// Three fixes, all here:
//   1. CURSOR — `enrich_attempted_at` is stamped on EVERY candidate we look at
//      (hit or miss) and the query takes the least-recently-attempted rows first,
//      so the worker walks the whole table instead of head-banging 40 rows.
//   2. PROOF-OF-WRITE — every update ends in `.select('id')`, so a write that
//      matched 0 rows is counted as a FAILURE, not as success. The old code
//      ignored the update's error AND its row count entirely.
//   3. NO SILENT SUCCESS — a 0-written run reports status 'empty' (or 'error' on
//      a write failure) with a per-reason breakdown in agent_runs.meta.skips.
// Requires migration 20260713000000 (adds leads_influencers.enrich_attempted_at).
// If that migration has NOT been applied the worker degrades to the legacy query
// and SAYS SO in meta.cursor — it never pretends to be healthy.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const BATCH = 40;
// Re-mine a creator at most this often: a link-in-bio can gain an email later,
// but re-fetching the same dead site every 30 min is what created the livelock.
const RETRY_AFTER_DAYS = 7;

serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const started = Date.now();
  let dbRef: any = null;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return json({ error: 'Unauthorized' }, 401);
    const db = createClient(supabaseUrl, serviceKey);
    dbRef = db;

    // ── CANDIDATE QUERY (cursored — see the header note) ──────────────────────
    // Least-recently-attempted first, never-attempted first of all, and never a
    // row we already mined inside RETRY_AFTER_DAYS. This is what makes the worker
    // advance through the table instead of re-mining the same head-of-table 40.
    const cutoff = new Date(Date.now() - RETRY_AFTER_DAYS * 864e5).toISOString();
    let cursor: string = 'enrich_attempted_at';
    let rows: any[] | null = null;
    {
      const { data, error } = await db
        .from('leads_influencers')
        .select('id, ig_handle, bio, external_url, email, phone')
        .neq('outreach_status', 'do_not_contact')
        .is('email', null)
        .or(`enrich_attempted_at.is.null,enrich_attempted_at.lt.${cutoff}`)
        .order('enrich_attempted_at', { ascending: true, nullsFirst: true })
        .limit(BATCH);
      if (error) {
        // Migration 20260713000000 not applied yet → degrade to the legacy query,
        // but record WHY in meta so the dashboard shows the worker is hobbled.
        cursor = `legacy-head-of-table (enrich_attempted_at unavailable: ${serr(error)})`;
        const { data: legacy, error: e2 } = await db
          .from('leads_influencers')
          .select('id, ig_handle, bio, external_url, email, phone')
          .neq('outreach_status', 'do_not_contact')
          .is('email', null)
          .limit(BATCH);
        if (e2) throw e2;
        rows = legacy ?? [];
      } else {
        rows = data ?? [];
      }
    }

    let enriched = 0;
    const results: Array<Record<string, unknown>> = [];
    const attempted: string[] = [];
    const writeErrors: string[] = [];
    // WHY a run wrote nothing — the thing whose absence made this agent opaque.
    const skips = { no_source: 0, mined_no_contact: 0, suppressed_only: 0, nothing_new: 0, write_failed: 0 };

    for (const r of rows ?? []) {
      attempted.push(r.id);
      let email: string | null = null, phone: string | null = null;

      // Nothing to mine at all — the single biggest bucket, and previously invisible.
      if (!r.bio && !r.external_url) {
        skips.no_source++;
        results.push({ ig: r.ig_handle, skip: 'no bio and no external_url to mine' });
        continue;
      }

      // 1) Parse the bio first (free).
      if (r.bio) { email = firstEmail(r.bio); phone = phone || firstPhone(r.bio); }

      // 2) Fetch their link/site if still missing an email.
      if (!email && r.external_url) {
        const page = await fetchText(r.external_url);
        if (page) {
          email = firstEmail(page);
          phone = phone || firstPhone(page);
          // linktree-style: follow one website link if no email yet
          if (!email) {
            const sub = (page.match(/https?:\/\/[^\s"'<>]+/g) || [])
              .find(u => !/instagram|tiktok|facebook|twitter|x\.com|youtube|linktr\.ee|beacons|cdn|\.(png|jpg|css|js)/i.test(u));
            if (sub) { const p2 = await fetchText(sub); if (p2) { email = firstEmail(p2); phone = phone || firstPhone(p2); } }
          }
        }
      }

      if (!email && !phone) {
        skips.mined_no_contact++;
        results.push({ ig: r.ig_handle, skip: 'mined bio/link, no email or phone published' });
        continue;
      }

      // Suppression check before persisting a contact we'd reach out to.
      let suppressed = false;
      if (email) {
        const { data: s, error: sErr } = await db.from('outreach_suppressions')
          .select('id').eq('channel', 'email').ilike('address', email).maybeSingle();
        if (!sErr && s) { email = null; suppressed = true; }
      }

      const patch: Record<string, unknown> = {};
      if (email && !r.email) patch.email = email;
      if (phone && !r.phone) patch.phone = phone;
      if (Object.keys(patch).length === 0) {
        // We found something but had nothing NEW to store (suppressed email, or a
        // phone the row already had). Previously this fell through silently.
        if (suppressed) skips.suppressed_only++; else skips.nothing_new++;
        results.push({ ig: r.ig_handle, skip: suppressed ? 'email is suppressed' : 'contact already on the row' });
        continue;
      }
      patch.updated_at = new Date().toISOString();
      patch.outreach_notes = `enriched ${new Date().toISOString().slice(0, 10)} (${patch.email ? 'email' : ''}${patch.email && patch.phone ? '+' : ''}${patch.phone ? 'phone' : ''})`;

      // PROOF OF WRITE: `.select('id')` returns the rows the UPDATE actually
      // touched. An error OR an empty return is a FAILURE — never counted as
      // enriched. (The old code awaited the update and threw the result away, so
      // a rejected write and a 0-row write both looked identical to success.)
      const { data: wrote, error: uErr } = await db.from('leads_influencers')
        .update(patch).eq('id', r.id).select('id');
      if (uErr || !(wrote ?? []).length) {
        // Row-by-row retry with ONLY the contact columns: a bad/missing extra
        // column (outreach_notes / updated_at) must not cost us the contact.
        const minimal: Record<string, unknown> = {};
        if (patch.email) minimal.email = patch.email;
        if (patch.phone) minimal.phone = patch.phone;
        const { data: w2, error: u2 } = await db.from('leads_influencers')
          .update(minimal).eq('id', r.id).select('id');
        if (u2 || !(w2 ?? []).length) {
          skips.write_failed++;
          writeErrors.push(`${r.id}: ${u2 ? serr(u2) : 'UPDATE matched 0 rows (RLS or id mismatch)'}${uErr ? ` (first attempt: ${serr(uErr)})` : ''}`);
          results.push({ ig: r.ig_handle, skip: 'write failed', error: u2 ? serr(u2) : 'matched 0 rows' });
          continue;
        }
        enriched++;
        results.push({ ig: r.ig_handle, email: !!minimal.email, phone: !!minimal.phone, retried: true });
        continue;
      }
      enriched++;
      results.push({ ig: r.ig_handle, email: !!patch.email, phone: !!patch.phone });
    }

    // ── STAMP THE CURSOR (hit or miss) — this is what breaks the livelock ──────
    let stamped = 0; let stampError: string | null = null;
    if (attempted.length && cursor === 'enrich_attempted_at') {
      const { data: st, error: sErr } = await db.from('leads_influencers')
        .update({ enrich_attempted_at: new Date().toISOString() })
        .in('id', attempted).select('id');
      if (sErr) stampError = serr(sErr); else stamped = (st ?? []).length;
    }

    // BACKBONE: unified agent_runs ledger. raw_found = candidates checked,
    // rows_written = rows actually enriched (proof-of-write, not "no error").
    // A 0-written run is NEVER a silent success: it is 'empty' with an explicit
    // reason, or 'error' when a write genuinely failed.
    const checked = (rows ?? []).length;
    const reason = enriched > 0 ? null
      : checked === 0
        ? 'no candidates: every non-do_not_contact creator either has an email or was mined within the last ' + RETRY_AFTER_DAYS + 'd'
        : `checked ${checked}, wrote 0 — ${skips.no_source} had no bio/external_url to mine, ` +
          `${skips.mined_no_contact} published no contact, ${skips.suppressed_only} suppressed, ` +
          `${skips.nothing_new} already had the contact found, ${skips.write_failed} write failure(s)` +
          (writeErrors.length ? ` :: ${writeErrors[0]}` : '');
    const status = skips.write_failed > 0 ? 'error' : (enriched === 0 ? 'empty' : 'ok');
    await logAgentRun(db, 'enrich-influencers', {
      started, raw_found: checked, rows_written: enriched,
      status,
      error: skips.write_failed > 0
        ? `${skips.write_failed} write failure(s): ${writeErrors.slice(0, 3).join(' | ')}`
        : reason,
      meta: { checked, enriched, skips, cursor, stamped, stamp_error: stampError, write_errors: writeErrors.slice(0, 5) },
    });
    return json({ checked, enriched, status, reason, skips, cursor, stamped, stamp_error: stampError, results });
  } catch (e) {
    await logAgentRun(dbRef, 'enrich-influencers', {
      started, raw_found: null, rows_written: 0,
      status: 'error', error: serr(e),
    });
    return json({ error: serr(e) }, 500);
  }
});

// ── CANONICAL ERROR SERIALIZER — DO NOT FORK ─────────────────────────────────
// Supabase/PostgREST rejects with a PLAIN OBJECT ({message, details, hint, code}),
// NOT an Error. `String(e)` on that object yields the opaque "[object Object]" —
// which is exactly how 11/11 failed autonomous actions recorded an unreadable
// `result` and the loop went blind (Forensic Auditor 2026-07-13). Always extract a
// REAL message + code (+ 2 stack frames) so every failure is diagnosable.
// qa.mjs #73 asserts every copy of this helper is byte-identical, unit-tests it
// against a PostgREST-shaped rejection, and fails the push if it can ever emit
// "[object Object]".
function serr(e: unknown): string {
  if (e === null || e === undefined) return 'unknown error (null)';
  if (typeof e === 'string') return e || 'unknown error (empty string)';
  const o = e as any;
  const msg = (e instanceof Error ? e.message : null)
    || o?.message || o?.error?.message || o?.error_description || o?.msg
    || o?.details || o?.hint || null;
  const code = o?.code ?? o?.error?.code ?? o?.status ?? o?.statusCode ?? null;
  const parts: string[] = [];
  if (msg) parts.push(String(msg));
  if (code !== null && code !== undefined && String(code) !== '') parts.push('[' + String(code) + ']');
  if (o?.details && String(o.details) !== String(msg)) parts.push('- ' + String(o.details));
  if (o?.hint && String(o.hint) !== String(msg)) parts.push('(hint: ' + String(o.hint) + ')');
  if (parts.length === 0) {
    let dump = '';
    try { dump = JSON.stringify(e); } catch (_j) { dump = ''; }
    parts.push(dump && dump !== '{}' ? dump : 'unhandled ' + (typeof e) + ' thrown with no message/code/details fields');
  }
  if (e instanceof Error && e.stack) {
    const frames = String(e.stack).split('\n').slice(1, 3).map((s) => s.trim()).filter(Boolean).join(' <- ');
    if (frames) parts.push('| ' + frames);
  }
  return parts.join(' ').trim().slice(0, 900);
}

// BACKBONE helper — write ONE agent_runs row per invocation. NEVER throws.
async function logAgentRun(
  db: any,
  agent: string,
  o: { started: number; raw_found?: number | null; rows_written?: number | null;
       status?: string; error?: string | null; meta?: unknown },
): Promise<void> {
  if (!db) return;
  try {
    await db.from('agent_runs').insert({
      agent,
      started_at: new Date(o.started).toISOString(),
      finished_at: new Date().toISOString(),
      raw_found: o.raw_found ?? null,
      rows_written: o.rows_written ?? null,
      status: o.status ?? 'ok',
      error: o.error ? String(o.error).slice(0, 1000) : null,
      meta: o.meta ?? null,
    });
  } catch (_e) { /* best-effort */ }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'CergioBot/1.0 (+https://cergio.ai)' } });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.text()).slice(0, 200000);
  } catch { return null; }
}

function firstEmail(s: string): string | null {
  const m = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  for (const e of m) {
    const x = e.toLowerCase();
    if (/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/.test(x)) continue;
    if (/(sentry|wixpress|example\.com|godaddy|squarespace|cloudflare)/.test(x)) continue;
    return x;
  }
  return null;
}

function firstPhone(s: string): string | null {
  const m = s.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+1\d{10}/g) || [];
  for (const p of m) {
    const digits = p.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  }
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
