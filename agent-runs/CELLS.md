# Open cells — one per feature, one agent each

    node scripts/agent-cell.mjs create <cell> <file>...   # build the wall
    node scripts/agent-cell.mjs diff   <cell>             # what it changed
    node scripts/agent-cell.mjs close  <cell>             # tear it down

| cell | feature | owner | files visible | hidden | status |
|---|---|---|---|---|---|
| `pay-fix` | Charge the card when a counter is accepted (launch gate) | feature-builder | 11 | **377 of 388** | ready |

## Verified, not asserted
The first version of the cell hid **0 of 388** files — sparse-checkout patterns were not
root-anchored, so the wall existed only in the description. It now counts what is on disk
and REFUSES to hand a cell to an agent unless the majority of the repo is genuinely absent.
Gate #199 fails if the anchoring is removed.
