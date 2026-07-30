// Apply pending Supabase migrations from CI — the last Mac dependency.
//
// deploy-functions.yml deployed FUNCTIONS but never MIGRATIONS ("needs the DB
// password"), so pg_cron schedules and schema changes rotted until someone
// double-clicked a .command. But the Management API accepts SQL with the
// SUPABASE_ACCESS_TOKEN that CI ALREADY HAS as a secret — no DB password needed.
//
// SAFETY (this runs unattended, so it is deliberately paranoid):
//   • tracks applied files in public.schema_migrations_applied; each file runs ONCE
//   • applies in filename order, STOPS on the first failure (never skips ahead)
//   • refuses any file containing an unscoped destructive statement
//   • never prints the token
const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) { console.error('missing SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN'); process.exit(1); }

const fs = await import('node:fs');
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return []; }
};

// An unscoped DELETE/UPDATE or a DROP/TRUNCATE is never applied unattended.
const DESTRUCTIVE = [
  /\bdrop\s+table\b/i, /\btruncate\b/i, /\bdrop\s+schema\b/i,
  /\bdelete\s+from\s+[a-z0-9_."]+\s*;/i,            // DELETE with no WHERE
  /\bupdate\s+[a-z0-9_."]+\s+set\b[^;]*;(?![^;]*\bwhere\b)/i,
];

await q(`create table if not exists public.schema_migrations_applied (
  filename text primary key,
  applied_at timestamptz not null default now(),
  sha text
);`);

const applied = new Set(
  (await q('select filename from public.schema_migrations_applied;')).map((r) => r.filename)
);
const files = fs.readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
const pending = files.filter((f) => !applied.has(f));

console.log(`${files.length} migrations on disk · ${applied.size} already applied · ${pending.length} pending`);
if (!pending.length) { console.log('nothing to apply'); process.exit(0); }

// First run against a DB that predates this table would replay everything. Baseline
// instead: record existing files as applied and only truly-new ones run from now on.
if (applied.size === 0 && pending.length > 1) {
  console.log(`BASELINE: first run — recording ${pending.length - 1} pre-existing migrations as applied,`);
  console.log(`          applying only the newest (${pending[pending.length - 1]}).`);
  for (const f of pending.slice(0, -1)) {
    await q(`insert into public.schema_migrations_applied (filename) values ('${f}') on conflict do nothing;`);
  }
  pending.splice(0, pending.length - 1);
}

let ok = 0;
for (const f of pending) {
  const sql = fs.readFileSync(`supabase/migrations/${f}`, 'utf8');
  const bad = DESTRUCTIVE.find((re) => re.test(sql));
  if (bad) {
    console.error(`REFUSED ${f}: contains an unscoped destructive statement (${bad}). Apply it deliberately, not unattended.`);
    process.exit(1);
  }
  try {
    await q(sql);
    await q(`insert into public.schema_migrations_applied (filename) values ('${f}') on conflict do nothing;`);
    console.log(`  applied ${f}`);
    ok++;
  } catch (e) {
    console.error(`  FAILED ${f}: ${String(e).slice(0, 400)}`);
    console.error('  stopping — later migrations are NOT applied (order matters).');
    process.exit(1);
  }
}
console.log(`applied ${ok} migration(s)`);
