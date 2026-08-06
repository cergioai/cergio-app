// Supabase Edge Function — FREE website contact harvest for IG rows (SPEC-263).
//
// FOUNDER ORDER (2026-08-06, verbatim): "figure out a solution to capture more contact
// details for IG... my search showed some had websites with emails and or phones.. it
// may need a 3 step crawl or alternative straetgy.. worst case we scale the numbers to
// 5000 to get 500 contactable ... per city .. but creators always ahve an email
// somewhere as they want to attract partners and advertising..."
//
// MEASURED (audit 2026-08-06T04:28Z): ig_services holds 276 rows, 218 with an
// external_url (websites / linktrees), but only 29 emails and 0 phones — 10.5%
// contactable. The contact details exist ONE HOP AWAY, on pages we already know the
// address of, and fetching them costs $0. This worker walks that hop before anyone
// scales a paid buy 10x to compensate for contacts we never went and read.
//
// MECHANISM — 3-step crawl per candidate, ALL free plain fetch (no Apify, no vendor):
//   step 1: fetch external_url. If the host is a link-in-bio service (linktr.ee,
//           beacons.ai, bio.link, linkin.bio, lnk.bio, taplink), extract outbound
//           hrefs and treat up to 3 non-social external links as additional pages —
//           a linktree is an index, not a destination.
//   step 2: scan the HTML for contacts: mailto: links first, then an email regex;
//           tel: links first, then a US phone pattern. JUNK FILTER mandatory —
//           a junk email written to a lead row is worse than none: it poisons
//           outreach with bounces and spam-trap hits.
//   step 3: nothing on the landing page → try up to 2 same-origin contact-shaped
//           pages (/contact, /contact-us, /about, or any same-origin link whose
//           text says contact).
//
// WRITE-BACK IS FILL-ONLY: email/phone (owner_email/phone on leads_services) are set
// ONLY where currently null — this worker never overwrites a contact another path
// already found. site_enriched_at is stamped on EVERY attempt, success or not, so an
// attempted site is never retried in a loop and the candidate query drains forward.
//
// BUDGETS: 5s AbortSignal.timeout per request, ~45s total run budget — candidate
// selection STOPS when the budget is spent, so a slow site can never wedge the cron.
//
// AUTH: service-role bearer (cron/launcher) — mirrors creator-enrich.
// GROWTH: leads tables live ONLY on the growth DB (SPEC-132) — gdb, FAIL LOUD if
// the growth env is absent (a silent product-DB fallback is the 2026-07-30 outage).
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import { growthDb } from '../_shared/growthDb.ts';

const BATCH = 12;                 // candidates per run (oldest first)
const FETCH_TIMEOUT_MS = 5000;    // per-request cap — one dead site costs 5s, never the run
const RUN_BUDGET_MS = 45000;      // total crawl budget — stop picking candidates past this
const UA = 'CergioBot/1.0 (+https://cergio.ai)';

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
}

// ── link-in-bio index hosts: the landing page is a menu, follow it outward ──
const LINK_BIO_HOSTS = ['linktr.ee', 'beacons.ai', 'bio.link', 'linkin.bio', 'lnk.bio', 'taplink'];
// social/platform hosts are never "the creator's website" — following them re-crawls IG
const SOCIAL_HOSTS = [
  'instagram.com', 'facebook.com', 'fb.com', 'tiktok.com', 'youtube.com', 'youtu.be',
  'twitter.com', 'x.com', 'threads.net', 'snapchat.com', 'pinterest.com', 'linkedin.com',
  'spotify.com', 'apple.com', 'wa.me', 'whatsapp.com', 't.me', 'telegram.me', 'discord.gg',
  'twitch.tv', 'onlyfans.com', 'patreon.com', 'venmo.com', 'cash.app', 'paypal.com',
];

function hostOf(u: string): string {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
function isLinkBio(u: string): boolean {
  const h = hostOf(u);
  return LINK_BIO_HOSTS.some((s) => h === s || h.endsWith('.' + s) || h.startsWith(s + '.'));
}
function isSocial(u: string): boolean {
  const h = hostOf(u);
  return SOCIAL_HOSTS.some((s) => h === s || h.endsWith('.' + s));
}

// ── JUNK FILTER (mandatory): a junk email written to a lead row is worse than none —
// it poisons outreach. Sources of noise measured on real pages: asset filenames that
// look like emails (icon@2x.png), platform plumbing (wixpress sentry cloudflare
// godaddy), RFC examples, and no-reply mailboxes nobody reads.
const JUNK_EMAIL_DOMAINS = ['wixpress.com', 'sentry.io', 'example.com', 'sentry-next', 'godaddy', 'cloudflare'];
const JUNK_LOCAL_PARTS = ['noreply', 'no-reply', 'donotreply'];
const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|ico|css|js|woff2?)\b/i;
function isJunkEmail(email: string): boolean {
  const e = email.toLowerCase();
  if (ASSET_EXT.test(e)) return true;                                  // icon@2x.png "emails"
  const [local, domain] = e.split('@');
  if (!local || !domain) return true;
  if (JUNK_EMAIL_DOMAINS.some((d) => domain.includes(d))) return true; // platform plumbing
  if (JUNK_LOCAL_PARTS.some((p) => local.startsWith(p))) return true;  // mailboxes nobody reads
  return false;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const EMAIL_OK = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

// US phone: 10 digits (optionally +1), area code can't start 0/1. tel: links win.
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  if (ten[0] === '0' || ten[0] === '1') return null;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/g;

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct && !/text\/html|application\/xhtml|text\/plain/i.test(ct)) return null;
    return (await res.text()).slice(0, 500_000);
  } catch (_e) {
    return null; // timeout / DNS / TLS — the attempt still stamps site_enriched_at
  }
}

type Found = { email: string | null; phone: string | null; junk: number };

function scanHtml(html: string): Found {
  let email: string | null = null, phone: string | null = null, junk = 0;
  // mailto: first — an explicit contact affordance beats a regex hit in a blob
  const mailtos = [...html.matchAll(/mailto:([^"'?\s<>&]+)/gi)].map((m) => decodeURIComponent(m[1]).toLowerCase());
  const regexEmails = (html.match(EMAIL_RE) || []).map((e) => e.toLowerCase());
  for (const cand of [...mailtos, ...regexEmails]) {
    if (!EMAIL_OK.test(cand)) continue;
    if (isJunkEmail(cand)) { junk++; continue; }
    email = cand; break;
  }
  // tel: first, then the US pattern over visible-ish text
  const tels = [...html.matchAll(/tel:([^"'\s<>&]+)/gi)].map((m) => decodeURIComponent(m[1]));
  for (const t of tels) { const p = normalizePhone(t); if (p) { phone = p; break; } }
  if (!phone) {
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
    for (const m of text.match(PHONE_RE) || []) { const p = normalizePhone(m); if (p) { phone = p; break; } }
  }
  return { email, phone, junk };
}

function extractLinks(html: string, baseUrl: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    try {
      const abs = new URL(m[1], baseUrl).toString();
      if (!/^https?:/i.test(abs)) continue;
      out.push({ href: abs, text: m[2].replace(/<[^>]+>/g, ' ') });
    } catch { /* malformed href */ }
  }
  return out;
}

// The full 3-step crawl for one candidate URL. Pure function of its inputs —
// module-level, so it can never close over a handler-scoped client (SPEC-166 class).
async function crawlSite(startUrl: string): Promise<Found> {
  const found: Found = { email: null, phone: null, junk: 0 };
  const url = /^https?:\/\//i.test(startUrl) ? startUrl : `https://${startUrl}`;

  // step 1 — landing page (a link-in-bio landing fans out to real sites)
  const pages: string[] = [];
  const landing = await fetchPage(url);
  let landingLinks: { href: string; text: string }[] = [];
  if (landing) {
    landingLinks = extractLinks(landing, url);
    if (isLinkBio(url)) {
      const outbound = landingLinks
        .filter((l) => !isSocial(l.href) && !isLinkBio(l.href) && hostOf(l.href) !== hostOf(url))
        .map((l) => l.href);
      pages.push(...[...new Set(outbound)].slice(0, 3));
    }
    const s = scanHtml(landing);
    found.junk += s.junk;
    found.email = found.email ?? s.email;
    found.phone = found.phone ?? s.phone;
  }

  // step 2 — scan the fanned-out real sites (linktree outbounds)
  for (const p of pages) {
    if (found.email && found.phone) break;
    const html = await fetchPage(p);
    if (!html) continue;
    const s = scanHtml(html);
    found.junk += s.junk;
    found.email = found.email ?? s.email;
    found.phone = found.phone ?? s.phone;
    if (!found.email && !found.phone) {
      // remember this page's own contact links for step 3
      landingLinks.push(...extractLinks(html, p));
    }
  }

  // step 3 — nothing yet: up to 2 contact-shaped same-origin pages
  if (!found.email && !found.phone && landing) {
    const origin = (() => { try { return new URL(url).origin; } catch { return ''; } })();
    const guesses: string[] = [];
    const contactLinks = landingLinks
      .filter((l) => /contact/i.test(l.text) && l.href.startsWith(origin) && origin)
      .map((l) => l.href);
    guesses.push(...contactLinks);
    if (origin) guesses.push(`${origin}/contact`, `${origin}/contact-us`, `${origin}/about`);
    for (const g of [...new Set(guesses)].slice(0, 2)) {
      const html = await fetchPage(g);
      if (!html) continue;
      const s = scanHtml(html);
      found.junk += s.junk;
      found.email = found.email ?? s.email;
      found.phone = found.phone ?? s.phone;
      if (found.email || found.phone) break;
    }
  }
  return found;
}

serve(async (req: Request) => {
  // FAIL LOUD without the growth env — growthDb() throws (SPEC-132); no fallback.
  const gdb = growthDb();
  const started = Date.now();
  const url = Deno.env.get('SUPABASE_URL')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!auth || auth !== svc) return json({ error: 'Unauthorized' }, 401);
  const db = createClient(url, svc);

  // ── candidates: creators first (email null AND phone null AND has a URL AND never
  // attempted), oldest first so the backlog drains in order; top up from the
  // ig_services rows in leads_services with the same shape.
  const { data: infl, error: inflErr } = await gdb.from('leads_influencers')
    .select('id, email, phone, external_url')
    .is('email', null)
    .is('phone', null)
    .not('external_url', 'is', null)
    .is('site_enriched_at', null)
    .order('fetched_at', { ascending: true })
    .limit(BATCH);
  if (inflErr) return json({ status: 'error', where: 'leads_influencers candidates', error: inflErr.message }, 200);

  type Cand = { table: 'leads_influencers' | 'leads_services'; id: string; url: string };
  const cands: Cand[] = (infl || [])
    .filter((r: { external_url: string | null }) => (r.external_url || '').trim())
    .map((r: { id: string; external_url: string }) => ({ table: 'leads_influencers' as const, id: r.id, url: r.external_url }));

  if (cands.length < BATCH) {
    const { data: svcRows, error: svcErr } = await gdb.from('leads_services')
      .select('id, owner_email, phone, website_url')
      .eq('data_source', 'ig_services')
      .is('phone', null)
      .is('owner_email', null)
      .not('website_url', 'is', null)
      .is('site_enriched_at', null)
      .order('fetched_at', { ascending: true })
      .limit(BATCH - cands.length);
    if (svcErr) return json({ status: 'error', where: 'leads_services candidates', error: svcErr.message }, 200);
    for (const r of (svcRows || []) as { id: string; website_url: string | null }[]) {
      if ((r.website_url || '').trim()) cands.push({ table: 'leads_services', id: r.id, url: r.website_url as string });
    }
  }

  let scanned = 0, enriched_email = 0, enriched_phone = 0, skipped_junk = 0;
  const stamp = new Date().toISOString();

  for (const c of cands) {
    // run budget: stop PICKING candidates once spent — un-attempted rows keep
    // site_enriched_at null and lead the next run's oldest-first queue.
    if (Date.now() - started > RUN_BUDGET_MS) break;
    const found = await crawlSite(c.url);
    scanned++;
    skipped_junk += found.junk;

    // FILL-ONLY write-back: only currently-null contact columns are set, and
    // site_enriched_at is stamped on EVERY attempt so no site is retried forever.
    const patch: Record<string, string> = { site_enriched_at: stamp };
    if (c.table === 'leads_influencers') {
      if (found.email) patch.email = found.email;
      if (found.phone) patch.phone = found.phone;
      const { data: w, error } = await gdb.from('leads_influencers').update(patch).eq('id', c.id)
        .is('email', null).is('phone', null) // never overwrite a contact another path found
        .select('id');
      if (!error && w && w.length) {
        if (found.email) enriched_email++;
        if (found.phone) enriched_phone++;
      } else {
        // fill-only guard matched 0 rows (a contact landed meanwhile) or the write
        // failed — the ATTEMPT still stamps, alone, so this site is never re-crawled
        await gdb.from('leads_influencers').update({ site_enriched_at: stamp }).eq('id', c.id);
      }
    } else {
      if (found.email) patch.owner_email = found.email;
      if (found.phone) patch.phone = found.phone;
      const { data: w, error } = await gdb.from('leads_services').update(patch).eq('id', c.id)
        .is('owner_email', null).is('phone', null) // never overwrite a contact another path found
        .select('id');
      if (!error && w && w.length) {
        if (found.email) enriched_email++;
        if (found.phone) enriched_phone++;
      } else {
        await gdb.from('leads_services').update({ site_enriched_at: stamp }).eq('id', c.id);
      }
    }
  }

  const out = { status: 'ok', scanned, enriched_email, enriched_phone, skipped_junk, elapsed_ms: Date.now() - started };
  try {
    await db.from('agent_runs').insert({ agent: 'site-enrich', started_at: new Date(started).toISOString(),
      finished_at: new Date().toISOString(), raw_found: scanned, rows_written: enriched_email + enriched_phone, status: 'ok', meta: out });
  } catch (_e) { /* best-effort */ }
  return json(out);
});
