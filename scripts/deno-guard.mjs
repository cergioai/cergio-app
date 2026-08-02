// SPEC-195b — DENO TYPE-CHECK, BASELINED.
//
// Five production outages on 2026-08-01 were the same defect: an identifier used where
// it is not bound (`gdb is not defined` in flushBuf silently discarded every crawled
// row for hours; `request.city` made crossPostRequest throw on every call). All of them
// passed `npm run build`, because edge functions are DENO and the Vite build never sees
// them. `deno check` finds that class in seconds.
//
// But making a strict check REQUIRED on 42 files that have never been type-checked
// blocks every merge on pre-existing errors — which is exactly what happened to the
// first version of this guard: it failed its own PR. The standard way to introduce a
// check to legacy code is to BASELINE what exists and fail only on what is NEW.
//
// So: every error is recorded in deno-baseline.json. A NEW error fails the build. An
// error that disappears is removed from the baseline automatically on the next update,
// so the baseline can only shrink.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASELINE = 'deno-baseline.json';
const UPDATE = process.argv.includes('--update');
const dir = 'supabase/functions';

const files = fs.readdirSync(dir)
  .filter((d) => !d.startsWith('_') && fs.existsSync(path.join(dir, d, 'index.ts')))
  .map((d) => `${dir}/${d}/index.ts`)
  .sort();

// One error signature = "file :: TSxxxx :: message-head". Line numbers deliberately
// excluded — a baseline keyed on line numbers goes stale the moment anyone edits above.
function errorsFor(f) {
  try {
    execSync(`deno check --no-lock ${f} 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
    return [];
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    return [...out.matchAll(/TS(\d+) \[ERROR\]: ([^\n]{0,120})/g)]
      .map((m) => `${f} :: TS${m[1]} :: ${m[2].trim()}`);
  }
}

const found = new Set();
for (const f of files) for (const e of errorsFor(f)) found.add(e);

const baseline = new Set(fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : []);

if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify([...found].sort(), null, 2) + '\n');
  console.log(`baseline updated: ${found.size} known error(s) across ${files.length} functions`);
  process.exit(0);
}

const added = [...found].filter((e) => !baseline.has(e));
const fixed = [...baseline].filter((e) => !found.has(e));

console.log(`deno guard: ${files.length} functions · ${found.size} error(s) · baseline ${baseline.size} · new ${added.length} · fixed ${fixed.length}`);
for (const e of fixed) console.log(`  FIXED (remove from baseline): ${e}`);

if (added.length) {
  console.error('\nNEW TYPE ERROR — this is the class that caused five silent outages:');
  for (const e of added) console.error(`  ✗ ${e}`);
  console.error('\nFix it, or if it is genuinely pre-existing run: node scripts/deno-guard.mjs --update');
  process.exit(1);
}
console.log('deno guard: no new type errors');
