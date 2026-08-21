# Stagehand (AI-driven) E2E layer — setup

This is the second layer of the hybrid plan (Playwright first — done, 20+ specs
on `dev` — then Stagehand). Stagehand drives the browser with natural-language
instructions backed by an LLM, which is resilient to the LMS's frequent
restyles that make CSS/role selectors churn.

## Why it isn't running yet (the one blocker)

Stagehand needs an **LLM API key** to interpret each page and decide the next
action. None is present in this environment (`ANTHROPIC_API_KEY` /
`OPENAI_API_KEY` are both unset), and the package isn't installed. Those are
credentials/deps only the owner should add — so this layer is **scaffolded and
ready, blocked solely on the key**.

## Activate it (owner, ~2 minutes)

```bash
# 1. install (local Playwright browser mode — no Browserbase account needed)
cd /Users/suganthanarulvelan/Documents/GitHub/prefrontal-ui
npm i -D @browserbasehq/stagehand

# 2. provide an LLM key (Anthropic recommended — matches the rest of the stack)
export ANTHROPIC_API_KEY=sk-ant-...        # or OPENAI_API_KEY=sk-...

# 3. prereqs (same as the Playwright layer): mw on :5270, LMS on :4200,
#    and the seeded demo login. Then run the scaffold:
E2E_ORG='Micro World' \
E2E_USERNAME='labadmin@apollo.prefrontal' \
E2E_PASSWORD='LabAdmin@123' \
node apps/lms-e2e/stagehand/run.mjs
```

The runner (`run.mjs`) self-checks: if the key or the package is missing it
prints exactly what to add and exits 0 (never a hard crash), so it's safe to
wire into CI behind a "has key" guard.

## What the scaffold does

`run.mjs` logs in through the real UI by natural-language instruction, then runs
one AI-driven assertion (`observe`/`act`) against the frontdesk. It's a seed to
grow into the high-churn flows the Playwright layer's README flagged as
Stagehand candidates (multi-step register→order→collect→result, the drag/pin
profile editor, the collection drawer state machine).

## Model note

Per the owner rule (lean models for test execution), point Stagehand at a
mid-tier model (e.g. Claude Sonnet / Haiku) via its `modelName` option, not a
top model — set in `run.mjs`.
