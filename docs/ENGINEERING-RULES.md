# Prefrontal engineering rules

Rules learned from real incidents. Every change (human or AI agent) follows them.
If a rule blocks you, ask the owner. Don't work around it.

## 1. One source of truth
- Every fact has ONE home. Before adding a field, search for an existing one. Before reading a value, find its home.
- Allowed second copies only: copy-on-write overrides, historical snapshots (bill / report at the time of issue), caches with invalidation, tested TS mirrors of server logic.
- Known homes:
  - **GST:** branch GST config (the bill snapshots it).
  - **Age:** DOB.
  - **Registration number:** `users.RegistrationId`.
  - **Business day:** IST via `LabClock`, UI `labToday()`.
  - **Phone:** `+91` + 10 digits.
  - **Priority:** Urgent / Normal only.
  - **Departments:** admin master only, mapped by CatalogKey.
  - **Vendor balance:** the ledger.
  - **Notifications:** `NotificationCatalog`.
  - **Licensing:** the platform entitlement.
  - **Reference ranges:** the single sex + age resolver.
  - **Paid (patient release):** `PatientReleaseGate`.
- Never match by name or code when an ID / key exists.

## 2. Tenant and branch isolation
- Every query is tenant-scoped; branch-scoped when the tenant is strict. Rely on the EF global filters; never `IgnoreQueryFilters()` without a comment and a test.
- Never trust an ID from the client without checking that it belongs to the caller's tenant / branch (IDOR).
- Never write into tenant catalogues on deploy / boot. Clone once at provisioning.
- Seeders run ONCE (a run marker). Never re-grant or re-create on every boot.

## 3. Database and queries
- **Queries:**
  - No unbounded lists: page or cap every list endpoint, and clamp page size.
  - No N+1: project in one query (`Select` to a DTO), `AsNoTracking` for reads, summary projections for grids.
  - Every new filter / sort / FK column gets an index. Check with `EXPLAIN` on realistic data.
- **Concurrency:**
  - Counters / numbers (MRN, sample ID, invoice) use atomic `INSERT … ON CONFLICT … RETURNING`, never `MAX+1`.
  - Check-then-insert needs a unique index. Money / stock changes run in one transaction under a row lock.
- **Time windows:**
  - Day windows are IST days converted to UTC ranges. Never `DateTime.UtcNow.Date`.
  - Store UTC; display IST.
- **Migrations and data fixes:**
  - Migrations AUTO-APPLY on boot: they must be safe, idempotent, reversible, and never destructive without the owner's approval.
  - Data fixes: back up → preview (read-only) → the owner approves → apply. Never run writes on dev / stage without approval.
  - Dropping columns / tables happens in a separate, later cleanup, after testing.

## 4. Clinical safety
- A signed report never changes. Stored PDFs are immutable; only Regenerate creates a new version (supersede the old one in the same transaction).
- One live final report per order. "Delivered" comes from the live final report.
- Print ranges / units from the saved result snapshot, not the live Test Master.
- Critical-value acknowledgements live in the audit / result records.
- Patient-facing report links: identity verification is checked on the SERVER before any patient detail or PDF is returned. No patient data before verification.

## 5. Auth and security
- The server decides access; the UI only reflects it (guards + a not-authorised screen, no screen without access).
- Log out only on a definitive auth failure, never on a network blip. Refresh is single-flight.
- Notifications are alerts, not records: they have a retention period (read 7 days, unread 30 days). Nothing that must be kept lives only in a notification.
- Never print, log or commit secrets (DB URLs, tokens, keys) except owner-authorised dev keys. Rotate anything exposed.

## 6. UI
- Follow `docs/ND-PATTERN.md`: the new design, light / dark, phone-first, 44px targets, no truncation.
- No native browser controls (`select`, `datalist`, `window.confirm`): use pf-select and DialogService. SVG icons only, never emoji.
- Reuse the existing components (AG-Grid, pf-tile, pf-select). Never hand-roll bespoke UI.
- Report PDF tables (jspdf-autotable): a blank-then-repaint cell stash is keyed `section:row:col` and deleted when painted (the repeated head is row 0 too); rows never split across pages (`rowPageBreak: 'avoid'`); a panel band is glued to its first row and repeated as "— CONTINUED" on the next page.
- Touch devices: the keyboard must never cover the focused field; inputs are ≥ 16px.

## 7. Process: definition of done
1. Fetch and merge the latest remote before starting.
2. Write tests for the change (and one that pins the single source).
3. Run the FULL suites after the last commit:
   - backend unit + integration;
   - `NODE_OPTIONS=--max-old-space-size=6144 npx nx test lms` + build.
4. `graphify update .`
5. Never push unsolicited. The owner clicks through on dev first. Stage is frozen until the owner reopens it.
6. Additive and production-safe: never regress the live lab flows (order → collect → result → validate → report → bill).

## 8. Keeping these rules alive
- When a bug or audit finding shows a new kind of mistake, add ONE line here in the same change that fixes it.
- Every agent brief says: "read `docs/ENGINEERING-RULES.md` first and check your change against it before handing back."
- The same file lives in all four repositories (LMS app, LMS backend, admin console, admin backend). Change them together.
