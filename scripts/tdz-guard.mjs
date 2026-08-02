// SPEC-219 — THE TEMPORAL DEAD ZONE GUARD.
//
// Four production outages on this project have had ONE shape: an identifier used above
// the line that declares it.
//   1. blank homepage      — `mode` used in JSX; it was a parameter of startEngine
//   2. white /auth         — useEffect placed above `const returnTo`
//   3. every crawled row discarded — flushBuf referencing a handler-scoped `gdb`
//   4. /ops/data 500       — `emailCol` used 7 lines above its own const
//
// EVERY ONE PASSED THE BUILD. Every one passed the gate suite. And `deno check` does not
// catch them either — verified against the real broken file, which produced ZERO type
// errors. TypeScript treats a reference inside a closure as deferred, so `(b) => b.not(x)`
// is legal to the compiler even when it is awaited immediately and therefore runs before
// the declaration.
//
// So this is not another type check. It is a scope check: for every const/let, is there a
// use of that name EARLIER in the same block?
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'supabase/functions'];
const EXT = /\.(ts|tsx|js|jsx|mjs)$/;

// Blank comments and string/template bodies so a name inside a comment or a SQL string is
// never mistaken for a use. Lengths are preserved so every offset stays valid.
function blank(src) {
  let o = '', i = 0, n = src.length;
  const keep = (c) => (c === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') o += keep(src[i++]); continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const s = e < 0 ? n : e + 2; while (i < s) o += keep(src[i++]); continue; }
    // Regex literals too. /^osm-blocked/i made the guard report a use of `blocked` that
    // was a fragment of a pattern — the exact class of mistake this suite keeps catching
    // in my own gates: matching text that only LOOKS like the thing being guarded. A `/`
    // starts a regex only where a value may begin, which is what the preceding-token test
    // below approximates.
    if (c === '/' && d !== '/' && d !== '*') {
      let k = o.length - 1;
      while (k >= 0 && /\s/.test(o[k])) k--;
      const prev = k >= 0 ? o[k] : '(';
      if ('(,=:[!&|?{;+-*%<>~^'.includes(prev) || prev === undefined) {
        o += c; i++;
        while (i < n && src[i] !== '\n') {
          if (src[i] === '\\') { o += '  '; i += 2; continue; }
          if (src[i] === '/') break;
          o += keep(src[i++]);
        }
        o += src[i] ?? ''; i++;
        while (i < n && /[gimsuyd]/.test(src[i])) o += src[i++];
        continue;
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; o += c; i++;
      while (i < n) { if (src[i] === '\\') { o += '  '; i += 2; continue; } if (src[i] === q) break; o += keep(src[i++]); }
      o += src[i] ?? ''; i++; continue;
    }
    o += c; i++;
  }
  return o;
}

const files = [];
for (const r of ROOTS) {
  const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|dist|\.git/.test(p)) walk(p); }
      else if (EXT.test(e.name)) files.push(p); } };
  walk(r);
}

const hits = [];
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const s = blank(raw);
  for (const m of s.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    const name = m[1], at = m.index;
    // Walk back to the start of the enclosing block.
    let depth = 0, start = 0;
    for (let i = at - 1; i >= 0; i--) {
      const c = s[i];
      if (c === '}') depth++;
      else if (c === '{') { if (depth === 0) { start = i + 1; break; } depth--; }
    }
    const before = s.slice(start, at);
    // If the name is ALREADY declared somewhere in `before`, the earlier use refers to
    // THAT binding, not to this one — a sibling `for (let i…)`, or an outer `let found`
    // that this inner function shadows. Without this, the guard reported four confident
    // findings that were all wrong, and a guard with known false positives blocks
    // legitimate work until someone learns to ignore it. That is how a check becomes
    // decoration, which is the failure mode this whole suite exists to prevent.
    if (new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(before)) continue;
    if (new RegExp(`\\(\\s*(?:const|let|var)\\s+${name}\\b`).test(before)) continue;
    // A use, not a property key (`name:`), not a member (`.name`), not another declaration.
    const use = new RegExp(`(?<![.\\w$])${name}\\b(?!\\s*:)`, 'g');
    let found = null;
    for (const u of before.matchAll(use)) {
      const ctx = before.slice(Math.max(0, u.index - 12), u.index);
      if (/\b(const|let|var|function|class|import)\s+$/.test(ctx)) continue; // its own or a sibling decl
      found = u.index; break;
    }
    if (found != null) {
      const line = raw.slice(0, start + found).split('\n').length;
      const dline = raw.slice(0, at).split('\n').length;
      hits.push(`${f}:${line} uses "${name}" but it is declared at line ${dline}`);
    }
  }
}

const BASE = 'tdz-baseline.json';
let baseline = [];
try { baseline = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch {}
if (process.argv.includes('--baseline')) {
  fs.writeFileSync(BASE, JSON.stringify(hits.sort(), null, 1));
  console.log(`tdz guard: baselined ${hits.length} existing occurrence(s)`);
  process.exit(0);
}
const isNew = hits.filter((h) => !baseline.includes(h));
console.log(`tdz guard: ${files.length} files · ${hits.length} occurrence(s) · baseline ${baseline.length} · new ${isNew.length}`);
if (isNew.length) {
  console.error('\nUSED BEFORE IT IS DECLARED — this is the shape that has caused four production outages here:\n');
  for (const h of isNew) console.error('  ' + h);
  console.error('\nThe build will not catch this. deno check will not catch this. Move the declaration above its first use.');
  process.exit(1);
}
console.log('tdz guard: nothing new');
