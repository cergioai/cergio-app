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

const MODEL = process.env.AGENT_MODEL || 'claude-opus-5';
const KEY = process.env.ANTHROPIC_API_KEY || '';
const id = process.argv[2];
const fleet = JSON.parse(fs.readFileSync('agents/fleet.json', 'utf8'));
const a = fleet.agents.find((x) => x.id === id);
if (!a) { console.error(`no agent "${id}"`); process.exit(1); }

const out = (o) => { fs.mkdirSync('reports', { recursive: true }); fs.writeFileSync(`reports/${id}.work.json`, JSON.stringify(o, null, 1)); console.log(`${id}: ${o.state}${o.detail ? ' — ' + o.detail : ''}`); };

// A dead agent must SCREAM. The build agent was dark for weeks on a 400 while every
// dashboard read green, because nothing distinguished "idle" from "broken".
if (!KEY) { out({ state: 'CANNOT RUN', detail: 'ANTHROPIC_API_KEY is not set on this runner — the agent is not idle, it is unable to start' }); process.exit(0); }

// Only the files this agent owns. Reading is the cheap part of isolation; the cell
// enforces the rest.
const context = a.owns.flatMap((f) => {
  try {
    if (fs.statSync(f).isDirectory()) return fs.readdirSync(f).slice(0, 12).map((x) => `${f}/${x}`);
    return [f];
  } catch { return []; }
}).map((f) => { try { return `--- ${f}\n${fs.readFileSync(f, 'utf8').slice(0, 60000)}`; } catch { return ''; } }).filter(Boolean).join('\n\n');

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

Reply with STRICT JSON only:
{"finding":"one sentence naming the single most important real defect you can see in YOUR files, or the string NONE",
 "evidence":"the exact code or line that proves it",
 "fix":"what should change, in one or two sentences",
 "confidence":"high|medium|low",
 "needs_founder":true|false}

Do not propose refactors, style changes, or improvements. Only real defects with evidence.

FILES:
${context.slice(0, 300000)}`;

let r, body;
try {
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

out({ state: parsed.finding && parsed.finding !== 'NONE' ? 'FINDING' : 'NO FINDING', model: MODEL, ...parsed });
