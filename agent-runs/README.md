
---

## How to interact with a specific agent

**What is true:** each agent runs in its own context with its own ID and its own CELL —
a worktree where files outside its feature are physically absent. Two agents cannot see
each other's code, and neither can see the rest of the repo.

**What is also true, stated plainly:** you talk to me, and I relay to a named agent. You
cannot type directly into a subagent's window from Cowork. Anyone who tells you otherwise
is describing a different product.

**So the addressing works like this:**

> "Tell the payment agent the card must be charged the moment the counter is accepted,
>  not on a later screen."

I pass that to that agent's context by ID — it keeps everything it already knows — and
return its reply attributed to it, unedited.

**Your proof that they are separate, and none of it is my word:**

| Question | Where the answer is |
|---|---|
| What could this agent SEE? | `HIDDEN FROM THIS AGENT: 377 of 388` in its cell record |
| What did it actually TOUCH? | `node scripts/agent-cell.mjs diff <cell>` — the diff cannot contain a file that was never on disk |
| Who decided it passed? | the verifier's verdict in the run record — a separate agent that never saw the builder's reasoning |
| Did it stay in budget? | attempt n of 2 in the run record |
| Is it really separate? | each ships its own branch and its own PR, revertible alone |

**The strongest evidence is the cell count.** An agent handed 11 of 388 files cannot break
the other 377 — not because it was told not to, but because they are not there.
