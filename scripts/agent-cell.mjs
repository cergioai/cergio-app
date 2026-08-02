// SPEC-199 — THE AGENT CELL. A wall you cannot walk through, because there is no door.
//
// Founder, 2026-08-02: "i need to make sure the chinese wall is definitive so the agent
// is isolated from the rest and looking at just his feature and executing towards it."
//
// Every previous attempt at isolation was a RULE — a scope declaration, a CI check, an
// instruction in a brief. Rules are checked AFTER the damage: the FREE-link change had
// already blanked the homepage by the time anything noticed. Research on this is blunt:
// Claude Code hooks do not fire in Cowork at all (anthropics/claude-code#40495), and
// git worktrees isolate SESSIONS from each other, not a change from the codebase.
//
// This is different in kind. It builds a git worktree with a SPARSE-CHECKOUT limited to
// the declared files. Everything else is NOT ON DISK. The agent cannot edit
// api.js by accident because api.js does not exist in its cell. Isolation stops being a
// promise about behaviour and becomes a property of the filesystem.
//
//   node scripts/agent-cell.mjs create <cell> <file> [<file>...]   # build the cell
//   node scripts/agent-cell.mjs diff   <cell>                      # what it changed
//   node scripts/agent-cell.mjs close  <cell>                      # tear it down
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [, , cmd, cell, ...files] = process.argv;
const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const CELLS = path.join(ROOT, '.cells');
const dir = cell ? path.join(CELLS, cell) : null;
const sh = (c, o = {}) => execSync(c, { encoding: 'utf8', stdio: 'pipe', ...o });

// Read-only context every cell needs to work correctly. Present so an agent can read the
// rules and the spec, never so it can edit code outside its feature.
const CONTEXT = ['CLAUDE.md', 'MASTER-SPEC.md', 'SPEC-REGISTRY.md', 'FROZEN_SPEC.md', 'package.json', 'scripts/qa.mjs'];

if (cmd === 'create') {
  if (!cell || !files.length) { console.error('usage: create <cell> <file>...'); process.exit(1); }
  fs.mkdirSync(CELLS, { recursive: true });
  if (fs.existsSync(dir)) sh(`git worktree remove --force ${dir}`, { cwd: ROOT });

  sh(`git worktree add --detach ${dir} HEAD`, { cwd: ROOT });
  sh(`git sparse-checkout init --no-cone`, { cwd: dir });
  const allow = [...new Set([...files, ...CONTEXT])];
  // Patterns are gitignore-style and MUST be root-anchored with a leading slash.
  // Without it, sparse-checkout matches nothing to exclude and the whole repo stays on
  // disk — which is exactly what happened on the first attempt: 0 of 388 files hidden,
  // an isolation claim that was false. Verified below rather than asserted.
  sh(`git sparse-checkout set ${allow.map((f) => JSON.stringify('/' + f.replace(/^\//, ''))).join(' ')}`, { cwd: dir });

  fs.writeFileSync(path.join(dir, 'CELL.md'),
`# CELL: ${cell}

You are working inside an isolated cell. The ONLY files on disk are the ones this
feature owns, plus read-only project context. Everything else in the repo is absent —
not forbidden, ABSENT. If you find yourself needing a file that is not here, that is
the signal to STOP and report, not to widen the change.

## Files this feature owns
${files.map((f) => `- \`${f}\``).join('\n')}

## Read-only context
${CONTEXT.map((f) => `- \`${f}\``).join('\n')}

## Rules
- Do not create new files outside the list above.
- Shared code may only GROW: add an export or an optional parameter with a default.
  Never modify an existing signature or body — every caller changes at once.
- Every gate must be MUTATION-TESTED: break it, watch it FAIL, restore it.
- Two attempts. If the criterion is not met twice, stop and report.
`);
  // Count what is ACTUALLY on disk, not what git lists as tracked — the two differ
  // under sparse-checkout, and only the on-disk set is the real wall.
  const present = sh(`find . -type f -not -path './.git/*' | sed 's|^\./||' | sort`, { cwd: dir })
    .trim().split('\n').filter(Boolean);
  console.log(`cell created: ${dir}`);
  console.log(`files visible: ${present.length}`);
  for (const f of present) console.log(`   ${f}`);
  const total = sh(`git ls-files`, { cwd: ROOT }).trim().split('\n').length;
  const hidden = total - present.length;
  console.log(`\nHIDDEN FROM THIS AGENT: ${hidden} of ${total} repo files`);
  if (hidden < total * 0.5) {
    console.error('CELL FAILED — the wall is not isolating. Refusing to hand this to an agent.');
    process.exit(1);
  }
} else if (cmd === 'diff') {
  console.log(sh(`git -C ${dir} status --short`) || '(no changes)');
  console.log(sh(`git -C ${dir} diff --stat`) || '');
} else if (cmd === 'close') {
  sh(`git worktree remove --force ${dir}`, { cwd: ROOT });
  console.log(`cell closed: ${cell}`);
} else {
  console.log('usage: agent-cell.mjs create|diff|close <cell> [files...]');
}
