# Securities language

**agent** `legal-copy` · **priority** 8 · **NEEDS WORK** · 2026-08-02T04:13:07.578Z

> **Green when:** legal review clears the copy, or it is de-securitised and the paraphrases are added to the gate

## Its gates

| gate | state |
|---|---|
| #170 | pass |

Whole suite: 207 pass · 0 fail. Build: clean. Wall: HIDDEN FROM THIS AGENT: 329 of 421 repo files.

## Open defects it is accountable for

- /rainmaker/apply carries securities-PARAPHRASE copy that gate #170 is blind to — it bans 5 exact phrasings, not the risk

## What this report does NOT prove

The suite is a STATIC gate — it reads source, it makes no network calls. It cannot
see production. So a green report here means "the code says the right thing and the
guards are in place", never "this works live". Anything requiring live proof is named
above as an open defect and stays open until an artifact exists.
