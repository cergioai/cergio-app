# Agent register — who is doing what, and what they produced

One record per agent run. A run with no verdict and no evidence is **not a completed run**.

**How to read a record**
- `criterion` — the requirement, in the founder's words or quoted from frozen spec
- `scope` — the ONLY files that agent was allowed to touch (the Chinese wall)
- `verdict` — PASS / FAIL, and who decided
- `evidence` — the artifact: qa count, build exit, deno check, live row, screenshot
- `attempt` — n of 2. Two strikes and it stops and returns to the founder.

**How to watch them live:** GitHub → Actions → the branch named in `branch:`.
Each fix ships as its own PR so it can be reverted alone.
