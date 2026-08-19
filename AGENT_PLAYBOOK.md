# Agent Playbook — prefrontal-ui (regression net + watchdog)

Run each numbered agent as its OWN session/subagent with a cheap model
(Haiku). One scope per agent, exact commands, a pasted done-proof, hard
stop rules. Unsure = stop and report, never guess.

## Ground rules (paste into EVERY agent's prompt)

- Work ONLY inside `~/Documents/GitHub/prefrontal-ui`. One scope per agent.
- NEVER `git push`. Commit locally.
- NEVER commit `apps/lms/src/environments/environment.development.ts`
  pointing at localhost — it is skip-worktree'd locally; leave it alone.
- Build: `npx nx build lms --configuration=development`
  Test:  `npx nx test lms`
- A failing spec is fixed by changing the CODE, not the spec — unless the
  change was intended (Watchdog W2); then update the spec AND say so.
- Done-proof: paste the nx test summary. No summary, not done.
- Refactors, renames, style passes outside the stated scope: forbidden.
- The dev server can serve STALE chunks after transient compile errors.
  Never "verify" through the dev server; verify through `nx build` + specs.

## Invariants the case net must encode

1. Report PDF: reference column prints EVERY authored tier, one line each,
   uniform size/left edge/dim; abnormal qualitative values ('A' flag) draw
   the same bold ▲ as numeric highs; 'N' rows stay plain; no AMENDED banner.
2. Report package rule: packages never print their name; profiles compile
   members under the profile title; a profile block uses the PROFILE's
   column override, never a member's.
3. Result entry: dropdown options come from the parameter's own
   `optionRows` (active rows, in order); non-normal selection shows the
   amber Abnormal state; zero normal rows = no flagging (stone colours).
4. Test editor: `options` + `normalValue` always derive from `optionRows`
   on save (never drift); a new option row's code continues its series with
   the next number unused ANYWHERE in the catalogue (URO008 belongs to
   Urine Appearance — adding to Urine Colour must propose URO020+).
5. Reference bands with `profileCode` win under that profile and drop out
   under other profiles; standalone shows all bands.
6. Global scanner: `/p/{id}` and `/o/{id}` app URLs resolve locally;
   unknown codes toast "not recognized" (never silent).
7. Patient registration: a 409 `duplicate_patient` opens a confirm dialog
   and retries with `force=true` only on explicit yes; post-save navigation
   failure ALWAYS toasts (never silent).
8. Mobile conventions: phone-first screens keep back chevron/swipe-back,
   safe areas, and never regress desktop (see memory/mobile rules).

## Phase 1 — build the case net (one-time; parallel)

**A0 · Spec mapper (read-only).** List files under
`apps/lms/src/app/shared/utils/` and `shared/components/` with NO matching
`.spec.ts`. Rank by import-count (how many features import them). Output a
JSON work queue. Do not write code.

**A1..An · Spec writers (one target each).** Write vitest specs in the
established styles:
- Pure utils (`calculation.ts`, `reference-range.ts`, `qualitative.ts`):
  direct input→output cases.
- Report rendering: the render-real-PDF-and-grep pattern of
  `report-notes-rule.spec.ts` / `report-column-override.spec.ts` — build a
  snapshot fixture, render with the REAL pipeline, grep the text layer.
Assert CURRENT behavior (characterization). 5–15 cases each. Component
DOM testing: skip and report `needs-harness` — do not fight TestBed.

## Phase 2 — watchdog loop (after every change / merge / daily)

**W1 · Detect.** `nx build` + `nx test lms`; then `graphify update .` and
diff `graphify-out/GRAPH_REPORT.md` vs the saved previous copy. Output
failing specs + changed graph communities. Clean → report and stop.

**W2 · Localize (one agent per failure).** Read the spec + the code under
test; `git log --oneline -10 -- <file>`; classify `regression` vs
`intended` (the commit message must actually claim the behavior change).
Output a JSON verdict only.

**W3 · Fix (one agent per regression).** Smallest code change to restore
the case; run the FULL suite + `nx build`. >2 files, template restructures,
or route/guard changes → STOP and escalate.

**W3b · Case update (per intended change).** Update the spec, cite the
commit hash in a comment.

**W4 · Verify + report.** Full build + suite + graphify. Report counts +
hashes + escalations.

## Escalate — never let Haiku decide

- Routes, guards, permissions, auth, anything under `core/auth`.
- The report PDF layout beyond making an existing spec pass.
- Cross-repo DTO shape changes (must match prefrontal-mw).
- Merge conflicts with teammates' restructures (tests/, test-editor/,
  sample-collection — these get rewritten upstream; porting is judgment).
- Any temptation to delete or weaken an invariant spec.
