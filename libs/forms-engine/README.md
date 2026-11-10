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
