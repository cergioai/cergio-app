// SPEC-216 — a CI agent that is equivalent to a Cowork subagent.
//
// Founder: "can CI but equivalent/identical to subagents?... can't have my mac be a blocker."
// Yes. A subagent is a model call with a brief, a bounded set of files, and a way to act.
// All three exist on a CI runner. What differs is only WHERE it runs — and that is the
// whole point, because a runner does not care whether the laptop is open.
//
// THE ONE THING THAT IS NOT IDENTICAL, DELIBERATELY: a subagent talks to you and can be
// stopped mid-thought. This one cannot. So its output is a PULL REQUEST on its own branch,
// never a push to main, and the fleet PRs carry do-not-auto-merge. Every past outage here
// reached production through an automatic merge; a PR waiting for you cannot.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

// COST. Eight subagents on Opus every hour is wasteful and Tarik has been right to say so.
// The hourly SCAN — read the spec and the files, name one defect — runs on Haiku. Opus is
// used only when a real defect needs an actual fix written, which is rare and worth it.
const SCAN_MODEL = process.env.AGENT_SCAN_MODEL || 'claude-haiku-4-5-20251001';
const FIX_MODEL = process.env.AGENT_FIX_MODEL || 'claude-opus-5';
const MODEL = SCAN_MODEL;
const KEY = process.env.ANTHROPIC_API_KEY || '';
const id = process.argv[2];
const fleet = JSON.parse(fs.readFileSync('agents/fleet.json', 'utf8'));
const a = fleet.agents.find((x) => x.id === id);
// SPEC-251: suspended = transferred to the growth project. Exit quietly, never run.
if (a && a.suspended) { console.log(`${id}: SUSPENDED — ${String(a.suspended).slice(0, 120)}`); process.exit(0); }
if (!a) { console.error(`no agent "${id}"`); process.exit(1); }

const out = (o) => { fs.mkdirSync('reports', { recursive: true }); fs.writeFileSync(`reports/${id}.work.json`, JSON.stringify(o, null, 1)); console.log(`${id}: ${o.state}${o.detail ? ' — ' + o.detail : ''}`); };

// A dead agent must SCREAM. The build agent was dark for weeks on a 400 while every
// dashboard read green, because nothing distinguished "idle" from "broken".
if (!KEY) { out({ state: 'CANNOT RUN', detail: 'ANTHROPIC_API_KEY is not set on this runner — the agent is not idle, it is unable to start' }); process.exit(0); }

// FREQUENT INTENTIONAL COMPACTION (HumanLayer / Dex Horthy, validated on 100k-300k line
// production codebases). Keep context utilisation in the 40-60% band. Above that you enter
// what they call the "dumb zone" — the middle of a large window where recall degrades and
// reasoning falters, measured across 100,000 developer sessions.
//
// This is not a micro-optimisation. It is the best available explanation for a specific
// failure of mine: inventing values that the spec already contained. A 6-city list when 12
// were authorised, a second URL parser when one existed, a gate ID already in use. Each
// happened deep into a long session, and each was a recall failure dressed as a decision.
//
// So each subagent gets its SPEC first, its own files second, and a hard cap. Progress
// lives in files and git history, never in the window (Geoffrey Huntley's Ralph pattern).
const CTX_CAP = Number(process.env.AGENT_CTX_CAP || 80000);
const context = a.owns.flatMap((f) => {
  try {
    if (fs.statSync(f).isDirectory()) return fs.readdirSync(f).slice(0, 12).map((x) => `${f}/${x}`);
    return [f];
  } catch { return []; }
}).map((f) => { try { return `--- ${f}\n${fs.readFileSync(f, 'utf8')}`; } catch { return ''; } }).filter(Boolean).join('\n\n').slice(0, CTX_CAP);

// The spec comes BEFORE the code, deliberately. Spec Kit's one honest idea: the spec is
// the source of truth, not the code. Reading the code first is how a spec gets rebuilt
// from bugs — which is exactly what Tarik caught me doing.
let spec = '';
try { spec = fs.readFileSync(`specs/${id}.md`, 'utf8'); } catch { spec = '(no spec file — treat that as the first defect)'; }

const brief = `You are the "${a.id}" agent for the Cergio codebase. You own ONLY these files: ${a.owns.join(', ')}.

Your area: ${a.title}
You are GREEN only when: ${a.green_when}
Known open defects you are accountable for:
${a.defects.map((d) => `- ${d}`).join('\n')}

House rules, which are absolute:
- A guard must sit BEFORE the point of no return, never after.
- Never swallow an error. A best-effort write that never reports is invisible, not best-effort.
- One definition of anything. Two parsers or two lists for one concept is a defect on its own.
- Never invent a value the spec does not contain. If a number is missing, say so; do not pick one.
- A check that cannot fail is worse than no check.

THE SPEC FOR YOUR AREA (source of truth — if the code disagrees with this, the code is wrong):
${spec}

Reply with STRICT JSON only:
{"finding":"one sentence naming the single most important real defect you can see in YOUR files, or the string NONE",
 "evidence":"the exact code or line that proves it",
 "fix":"what should change, in one or two sentences",
 "confidence":"high|medium|low",
 "needs_founder":true|false}

Do not propose refactors, style changes, or improvements. Only real defects with evidence.

FILES:
${context}`;

// SPEC-253 (founder, 2026-08-04: "switch subagents run under the monthly plan here..
// so it's economical"). When CLAUDE_CODE_OAUTH_TOKEN is present (a `claude setup-token`
// from the founder's Max subscription, added as a repo secret), the thinking half runs
// through the Claude Code CLI and bills the SUBSCRIPTION — zero API credits. The raw
// API-key path stays as the automatic fallback, so a missing/expired token can never
// stop the fleet; it just costs credits again until fixed.
function askViaSubscription(prompt, wantModel) {
  const tok = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!tok) return null;
  try {
    const alias = /opus/i.test(wantModel) ? 'opus' : /haiku/i.test(wantModel) ? 'haiku' : 'sonnet';
    const out = execSync(`claude -p --model ${alias} --output-format text`, {
      input: prompt, encoding: 'utf8', timeout: 240000,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    return String(out || '');
  } catch (e) {
    console.log(`${id}: subscription transport failed (${String(e.message).slice(0, 120)}) — falling back to API key`);
    return null;
  }
}

let r, body;
const subScan = askViaSubscription(brief, MODEL);
if (subScan !== null) { r = { ok: true }; body = JSON.stringify({ content: [{ text: subScan }] }); }
else try {
  r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content: brief }] }),
  });
  body = await r.text();
} catch (e) { out({ state: 'CANNOT RUN', detail: `network: ${String(e).slice(0, 200)}` }); process.exit(0); }

// Report the API's own words. "Build blocked" told us nothing for weeks; "400
// invalid_request" would have named a fake model the first night.
if (!r.ok) { out({ state: 'CANNOT RUN', model: MODEL, http: r.status, detail: body.slice(0, 400) }); process.exit(0); }

let parsed = null;
try {
  const txt = JSON.parse(body).content?.map((c) => c.text || '').join('') || '';
  parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
} catch { out({ state: 'UNREADABLE', detail: body.slice(0, 300) }); process.exit(0); }

const finding = parsed.finding && parsed.finding !== 'NONE' ? parsed : null;
if (!finding) { out({ state: 'NO FINDING', model: MODEL }); process.exit(0); }

// ─── THE RALPH LOOP (Geoffrey Huntley) ────────────────────────────────────────────
// Same brief every run; progress accumulates in FILES and git history, never in the
// window. So this run does not need to remember the last one — it reads the spec's
// progress log, which is on disk.
//
// The loop closes on itself the way Anthropic describes: the subagent acts, runs a hard
// pass/fail, reads the result, and either keeps the change or throws it away. Nothing
// here is trusted because the model said so.
// ─── THE LOOP, PER SUBAGENT (founder, 2026-08-02: "apply the loop and the upgrades we
// implemented yesterday (ralph etc) to force fixing at subagent level") ────────────────
//
// Huntley's Ralph loop: the same brief every run, with progress accumulating in FILES and
// git history rather than the context window. A subagent therefore does not need to
// remember the last run — it reads its own progress log off disk, which is exactly why
// this survives the session ending and the Mac being off.
//
// ATTEMPTS ARE BOUNDED. Two strikes on the same finding and it stops and comes to Tarik
// with what was tried. Today cost him five craigslist iterations and three spend-gate
// iterations; a bounded loss is the difference between a setback and a spiral.
const LOG = `specs/${id}.md`;
const priorLog = (() => { try { return fs.readFileSync(LOG, 'utf8'); } catch { return ''; } })();
const sig = String(finding.finding || '').slice(0, 60).toLowerCase();
const priorAttempts = (priorLog.toLowerCase().match(new RegExp(sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
if (priorAttempts >= 2) {
  out({ state: 'STOPPED', acted: false, attempts: priorAttempts,
        why_not: `two attempts on this same finding already failed — stopping rather than looping. Needs a decision: ${finding.fix}`,
        ...finding });
  try { fs.appendFileSync(LOG, `\n- ${new Date().toISOString().slice(0, 16)} — STOPPED after ${priorAttempts} attempts: ${finding.finding}\n`); } catch {}
  process.exit(0);
}

if (finding.needs_founder || finding.confidence === 'low') {
  out({ state: 'FINDING', model: MODEL, acted: false, why_not: finding.needs_founder ? 'needs a founder decision — I will not invent the answer' : 'confidence too low to act unattended', ...finding });
  process.exit(0);
}

const target = a.owns.find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
const askFix = `You found this defect: ${finding.finding}
Evidence: ${finding.evidence}
Proposed: ${finding.fix}

Return the COMPLETE new contents of exactly ONE file you own, as strict JSON:
{"path":"<one of: ${a.owns.join(', ')}>","contents":"<the entire file>"}

Rules: change the minimum. Do not reformat. Do not rename. Do not touch anything outside
the defect. Add a comment above the change explaining WHY, naming what went wrong.`;

let fixed = null;
const subFix = askViaSubscription(askFix, FIX_MODEL);
if (subFix !== null) {
  try { fixed = JSON.parse(subFix.slice(subFix.indexOf('{'), subFix.lastIndexOf('}') + 1)); } catch (e) { out({ state: 'FINDING', acted: false, why_not: `subscription fix unreadable: ${String(e).slice(0, 120)}`, ...finding }); process.exit(0); }
}
else try {
  const r2 = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: FIX_MODEL, max_tokens: 16000, messages: [{ role: 'user', content: askFix }] }),
  });
  if (!r2.ok) { out({ state: 'FINDING', acted: false, why_not: `fix call HTTP ${r2.status}`, ...finding }); process.exit(0); }
  const t2 = JSON.parse(await r2.text()).content?.map((c) => c.text || '').join('') || '';
  fixed = JSON.parse(t2.slice(t2.indexOf('{'), t2.lastIndexOf('}') + 1));
} catch (e) { out({ state: 'FINDING', acted: false, why_not: `fix unreadable: ${String(e).slice(0, 150)}`, ...finding }); process.exit(0); }

// THE WALL, ENFORCED HERE TOO. The cell hides other files from view, but a model can still
// NAME a path it does not own. Refuse it — an agent that can write outside its wall has no
// wall.
if (!fixed?.path || !a.owns.includes(fixed.path) || !fixed.contents || fixed.contents.length < 50) {
  out({ state: 'FINDING', acted: false, why_not: `refused: proposed writing "${fixed?.path}" which is outside this agent's owned files`, ...finding });
  process.exit(0);
}

const before = fs.readFileSync(fixed.path, 'utf8');
fs.writeFileSync(fixed.path, fixed.contents);

// THE HARD PASS/FAIL. If the gates or the build reject it, the change is thrown away and
// the run reports the attempt. A fix that cannot prove itself is not a fix.
let verdict = 'kept', detail = '';
try { execSync('node scripts/qa.mjs', { stdio: 'pipe' }); }
catch (e) { verdict = 'reverted'; detail = 'qa gates failed'; }
if (verdict === 'kept') {
  try { execSync('npm run build', { stdio: 'pipe' }); }
  catch { verdict = 'reverted'; detail = 'build failed'; }
}
if (verdict === 'kept') {
  try { execSync('node scripts/scope-guard.mjs', { stdio: 'pipe' }); }
  catch { verdict = 'reverted'; detail = 'change left its wall'; }
}
if (verdict === 'reverted') {
  fs.writeFileSync(fixed.path, before);
  // Log the FAILED attempt too. Only logging successes meant the next run saw a clean
  // history, proposed the same fix, and failed the same way — a loop with no memory is
  // just repetition.
  try { fs.appendFileSync(LOG, `\n- ${new Date().toISOString().slice(0, 16)} — attempt REVERTED (${detail}): ${finding.finding}\n`); } catch {}
  out({ state: 'ATTEMPTED', acted: false, file: fixed.path, attempt: priorAttempts + 1, why_not: detail, ...finding });
  process.exit(0);
}

// Progress goes in the file, not the window.
try {
  fs.appendFileSync(LOG, `\n- ${new Date().toISOString().slice(0, 16)} — FIXED in \`${fixed.path}\`: ${finding.finding}\n`);
} catch { /* the spec log is a record, not a gate */ }

out({ state: 'FIXED', model: MODEL, acted: true, file: fixed.path, ...finding });
