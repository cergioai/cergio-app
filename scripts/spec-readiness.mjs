// Soft-launch readiness — the one number that answers "is this ready?".
// A row is PROVEN only with a spec line, a mutation-tested gate, AND a dated live
// artifact. CODED means it exists but has never been demonstrated working, which is
// exactly the state that produced a green build over a blank homepage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = fs.readFileSync(path.join(ROOT, 'SPEC-REGISTRY.md'), 'utf8');
const block = md.split('REGISTRY:START')[1].split('REGISTRY:END')[0];

export function rows() {
  return block.split('\n')
    .filter((l) => l.trim().startsWith('|') && !/^\|\s*-+/.test(l.trim()))
    .slice(1)
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
    .filter((c) => c.length >= 5)
    .map(([id, behaviour, gate, proof, status]) => ({
      id, behaviour, gate, proof, status: status.replace(/\*/g, ''),
    }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = rows();
  const by = (s) => r.filter((x) => x.status === s).length;
  const proven = by('PROVEN');
  const pct = Math.round((proven / r.length) * 100);
  console.log(`\nSOFT LAUNCH READINESS      ${proven} / ${r.length} PROVEN  (${pct}%)`);
  console.log(`  PROVEN     ${String(by('PROVEN')).padStart(2)}   <- trustworthy`);
  console.log(`  CODED      ${String(by('CODED')).padStart(2)}   <- exists, never proven live`);
  console.log(`  UNGUARDED  ${String(by('UNGUARDED')).padStart(2)}   <- regression risk`);
  console.log(`  BLOCKER    ${String(by('BLOCKER')).padStart(2)}   <- blocks soft launch\n`);
  for (const x of r.filter((x) => x.status === 'BLOCKER')) console.log(`  BLOCKER  ${x.id}  ${x.behaviour}`);
  console.log('');
}
