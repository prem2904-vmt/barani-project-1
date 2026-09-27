# LMS UI — end-to-end tests (Playwright)

Real Chromium against the served LMS app (`nx run lms:serve` on :4200). Two layers:

| Layer | Auth | Backend | What it proves |
|-------|------|---------|----------------|
| `*.smoke.spec.ts`  | none | no  | app boots, login surface renders |
| `*.authed.spec.ts` | org/user/pass | **yes** | member flows (register → order → collect → result → report) |

## Run the smoke layer (no setup)

```bash
# from repo root — chromium only (firefox/webkit browsers not installed)
./node_modules/.bin/playwright test --config=apps/lms-e2e/playwright.config.ts --project=chromium
```

The dev server auto-starts (or is reused) on :4200.

> Browser binary: this repo's Playwright wants a specific Chromium build. If a
> run reports "Executable doesn't exist", install with the **local** binary
> (not `npx`, which may resolve a different Playwright version):
> `./node_modules/.bin/playwright install chromium`.

## Run the authenticated layer

Two prerequisites — **only a human can provide these**:

1. **mw backend running on :5270** (the LMS dev `apiUrl`) with a **seeded test
   organization + user**. Don't point at real/production data.
2. **Credentials via env** (never committed):

```bash
export E2E_ORG='your-test-org'
export E2E_USERNAME='e2e-user'
export E2E_PASSWORD='...'
./node_modules/.bin/playwright test --config=apps/lms-e2e/playwright.config.ts --project=chromium
```

Without creds, the `*.authed.spec.ts` specs **skip** (via `requireCreds()`),
they do not fail.

### Specs that WRITE shared data are opt-in

`users-roles.rbac.spec.ts` creates users and roles, which cannot be deleted
through the API. Its create/edit tests skip unless `E2E_ALLOW_WRITES=1` —
set it **only** against a local backend + local DB. `lms:serve` points at the
shared dev backend by default, and earlier runs left `E2E Throwaway Role …` /
`e2euser…` rows in the Micro World Users & Roles screen.

## Layout

```
apps/lms-e2e/src/
  *.smoke.spec.ts     — unauthenticated (login surface, guard redirect)
  *.authed.spec.ts    — require creds + backend (skip otherwise)
  support/auth.ts     — login() helper + requireCreds() guard (env creds)
```

## Notes

- The API these flows exercise is already covered by the mw integration suite
  (real HTTP + real Postgres). This layer is about the **UI**: rendering,
  navigation, and the through-the-browser clinical flow.
- Selectors favor roles/placeholders over CSS classes to survive the LMS UI's
  frequent restyles. The high-churn multi-step flows are candidates for the
  planned Stagehand (AI-driven) layer.
