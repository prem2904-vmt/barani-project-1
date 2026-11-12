# @prefrontal/forms-engine

The case-sheet form engine, ported 1:1 from prefrontal-prepare-ui `libs/forms-engine` (origin/main `bca8282`) for
the "case sheets into Prefrontal" project (plan `pf-work/plans/prepare-into-prefrontal.md`, WP0-ui).

- v2 form-definition types (TS mirror of the API), the rule engine (show-when, links, triggers), the page wizard
  model, and per kind the doctor's touch control (fill) + the Studio half (build); the canvas engine; narrative tables.
- Imports: `@prefrontal/forms-engine` (full barrel), `@prefrontal/forms-engine/providers` (light root entry:
  registry + tokens), `@prefrontal/forms-engine/testing` (fixtures for specs only).
- Kit seam: `src/lib/kit.ts` is the ONLY place engine files get kit things from — `pf-select` from the LMS
  original (`@prefrontal/shared`), the dialog through the `FeDialog` token (the LMS app provides it with its
  DialogService in `app.config.ts`), and `pf-icon` + the icon set, which moved INTO this lib (`src/lib/icons`, SVG).
- SCSS partials use the LMS `libs/shared` mixins.
- Specs run inside `nx test lms` (`apps/lms/tsconfig.spec.json` includes `libs/forms-engine/src`).

Port rule: keep the files diff-able against Prepare — adapt imports only; don't rewrite logic.

Picture choice + combination sentences (2026-11-12): `kinds/pictureChoice` (fill: tap-to-highlight pictures in a box, optional live total;
Studio panel: layout editor, upload / draw per part) and `narrative/combinations.ts` (the shared multi-select sentence engine, parity-tested
against `docs/vectors/casesheet-combinations.json`). "Sentences for combinations" (the Studio editor) lives in the LMS app
(`studio/editor/combinations.component.ts`) because it reuses the app's `DragReorder`. A host that reuses this lib for master case sheets
(prefrontal-admin-ui) needs: `FE_ASSETS` (asset store: `asset`, `uploadTemplate`), `FE_KINDS` (`KIND_SPECS`), `FeDialog`, `<cs-styles />`-equivalent
global CSS (`fill/_fill.scss` now `@use`s `kinds/pictureChoice/_picture-choice.scss`), and its own copy of the combinations editor
(or the drag helper moved into this lib).

## Group "pair" (2026-11-12)
- `sidePair` ("Left and right", `kinds/sidePair`): the field's one child asked once per side; answer `{right,left}`. Fill = two `fe-row` cards (columns from 480 px, stacked below), "Same on both sides" copies the answered side. Studio panel chooses the inner kind and what it needs.
- `shorthand` ("Clinical shorthand", `kinds/shorthand`): five presets (obstetric score, periods, vision, glasses power, muscle power). `shorthand-math.ts` mirrors the server's `ShorthandMath` and is held to `docs/vectors/casesheet-pair.json` (identical copy in prefrontal-mw).
