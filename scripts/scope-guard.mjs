// SPEC-196 — BLAST-RADIUS GUARD.
//
// The founder's diagnosis, and it is the right one: "every edit came with an
// avalanche of unrelated changes that were never prescribed... the only way to
// execute this is to GUARANTEE each part is COMPLETELY ISOLATED from the other.
// NOT JUST THEORY, ACTUALLY CHINESE WALLED."
//
// On 2026-08-01 alone: a FREE-link change blanked the entire homepage; a spend-gate
// change killed ALL crawling; a YellowPages fix silently reverted craigslist. Each
// was a change to X that broke Y. Discipline did not stop it and will not.
//
// So a change DECLARES the files it may touch, in SCOPE.md, and this refuses
// anything wider. It runs in CI because agent-side hooks DO NOT FIRE IN COWORK
// (anthropics/claude-code#40495) — a guard that does not run is not a guard.
//
// TWO CLASSES OF PATH:
//   declared   — listed in SCOPE.md for this change. Free to edit.
//   SHARED     — imported by many features (api.js, _shared/**, fulfill-crawl).
//                A shared file may only GROW: new exports, new optional params
//                with defaults. Modifying or deleting an existing line changes
//                behaviour for every caller at once, which is the contamination
//                path itself. Requires an explicit SHARED-CHANGE-APPROVED marker.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.SCOPE_BASE || 'origin/main';
const SHARED = [
  'src/lib/api.js',
  'supabase/functions/_shared/',
  'supabase/functions/fulfill-crawl/index.ts',
  'scripts/qa.mjs',
];
// Files that carry no runtime behaviour — never a contamination path.
const ALWAYS_OK = [
  'SCOPE.md', 'MASTER-SPEC.md', 'SPEC-REGISTRY.md', 'FROZEN_SPEC.md', 'CLAUDE.md',
  '.github/growth-fire/', 'plans/', 'agent-runs/', 'audit/',
];

function sh(c) { try { return execSync(c, { encoding: 'utf8' }); } catch { return ''; } }

const scopeFile = fs.existsSync('SCOPE.md') ? fs.readFileSync('SCOPE.md', 'utf8') : '';
const declared = [...scopeFile.matchAll(/^\s*[-*]\s+`([^`]+)`/gm)].map((m) => m[1]);
const sharedApproved = /SHARED-CHANGE-APPROVED/.test(scopeFile);

sh(`git fetch -q origin main`);
const changed = sh(`git diff --name-only ${BASE}...HEAD`).split('\n').map((s) => s.trim()).filter(Boolean);

if (!changed.length) { console.log('scope guard: no changes'); process.exit(0); }
if (!declared.length) {
  console.log('scope guard: SCOPE.md declares nothing — treating every path as undeclared');
}

const violations = [];
for (const f of changed) {
  if (ALWAYS_OK.some((p) => f.startsWith(p))) continue;
  const isDeclared = declared.some((d) => (d.endsWith('/') ? f.startsWith(d) : f === d));
  const isShared = SHARED.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));

  if (isShared) {
    // A shared file may only GROW unless explicitly approved.
    const body = sh(`git diff ${BASE}...HEAD -- ${f}`);
    const removed = body.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
    if (removed > 0 && !sharedApproved) {
      violations.push(`${f}: ${removed} existing line(s) MODIFIED or DELETED in a SHARED file. `
        + `Every caller changes behaviour at once — that is the contamination path. `
        + `Add a new export or an optional parameter with a default instead, or put `
        + `SHARED-CHANGE-APPROVED in SCOPE.md with the reason.`);
    }
    continue;
  }
  if (!isDeclared) {
    violations.push(`${f}: touched but NOT declared in SCOPE.md — this is the "avalanche of unrelated changes"`);
  }
}

console.log(`scope guard: ${changed.length} file(s) changed, ${declared.length} declared, ${violations.length} violation(s)`);
for (const f of changed) console.log(`   ${f}`);
if (violations.length) {
  console.error('\nBLAST-RADIUS VIOLATION:');
  for (const v of violations) console.error(`  ✗ ${v}`);
  process.exit(1);
}
console.log('scope guard: clean — the change stayed inside its wall');
