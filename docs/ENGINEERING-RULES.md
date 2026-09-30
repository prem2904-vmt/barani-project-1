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
  - **Critical-value acknowledgement / communication:** `critical_result_events` (one row per critical result version), never the bell row.
  - **Licensing:** the platform entitlement.
  - **Reference ranges:** the single sex + age resolver.
  - **Specimen of an ordered line:** `order_tests` (code + name), decided by the Test Master's specimen mode + allowed list (`SpecimenRules` / `micro-specimen.ts`); every report path prints the ORDERED specimen, never the Test Master text.
  - **Paid (patient release):** `PatientReleaseGate`.
  - **Daily patient number (#12 before the name on lab screens):** `daily_patient_numbers` via `DailyPatientNumbers` (branch × IST day, row-locked, reused by the patient's later orders that day), stamped once on `orders.DailyNo` / `DailyNoDay`; the UI shows it only through `pf-daily-no` / `utils/daily-no.ts`. An on-screen aid ONLY — never printed (labels, slips, bills, reports, messages, exports).
  - **Which tube / pot a line is drawn into:** ONE key, `OutsourcingRules.VialKey` + `ColourKey` (`TubeType`: blank container = sterile pot) — destination + space + tube type, and for a non-blood pot the line's specimen (fixed / chosen, else the Test Master text). Create, add-tests and outsourcing reconcile all use it, in-house and outsourced alike: same specimen + same container = one pot, never one pot per test.
  - **Partner report in the patient's PDF:** the `attachToReport` flag on the line's `external_report` attachment; the combined PDF is DERIVED on read (`CombinedReportPdf`, content-addressed cache) from the immutable stored report — never written into the stored report, never a second copy of the flag.
  - **Outsourced or in-house:** the tube's `OutsourcedVendorId`, frozen at order time from the lab's effective test; every lab surface filters through `OutsourcingRules` (`InHouseTube` for tubes, `InHouseWork` for lines), never a bare status check.
  - **Technician report notes (all four levels — line, profile, department, order):** `orders.ReportNotesJson`, written only through `ReportNotesService` (row-locked, audited); the report snapshot copies them on a FINAL / amended final ONLY (never a preliminary / partial — `ReportNoteRules.PrintsOn`, the one home); the Lab-settings switch (`techReportNotes`, per branch) gates new text only — saved notes always print.
- Never match by name or code when an ID / key exists.
- User files live only in Spaces via the storage service — never on the container disk (wiped on every deploy).
- Patient files (reports, partner PDFs, attachments, plate photos, chat / voice, documents, bills, signature scans) are served ONLY through the authenticated, tenant-checked API — never a bearer / presigned URL that works without the session (the verified public report link keeps its own model). Make that path fast instead: stream from storage (never buffer the whole file first), ETag + `Cache-Control: private` (+ `Vary: Authorization`) so a revalidation is a 304 with no storage trip, remember a missing file, and fetch each file ONCE per session in the UI (no HEAD pre-check, no refetch per render, no read-back when nothing changed).
- A tenant's storage folder has ONE home: `tenants.StoragePrefix`, set once by `TenantStorageKeys` (handle, else `<name>-<id8>`) — every storage key is built through it; authorization is always by tenant ID, never by folder name.
- A feature switch has ONE resolver (UI lab-features / server LabFeatureGate); never gate a surface on the workflow or the entitlement alone.

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
  - A money helper called from inside a caller's transaction JOINS it (`CurrentTransaction != null`), never nests one; the caller's totals and the helper's rows commit together, and the bells go out after the commit.
  - Never fire side effects inside a batch transaction (auto-report / anything that opens its own transaction, bells, device pushes): the batch runs through `AfterCommit.InTransactionAsync` and side effects go through `AfterCommit.RunOrDeferAsync` — they run after the commit, never on a rollback or a retried attempt, keyed so one batch fires them once (a nested report transaction threw, was swallowed, and a submitted tube got no final report).
  - `ExecuteUpdate` / `ExecuteDelete` bypass the audit interceptor: an audited entity written set-based writes its own rows (`Auditing.AuditTrail`) in the same transaction.
  - Money, clinical results / reports, outboxes (WhatsApp, chat, notifications), idempotency keys, attempt limits and the audit log live only in Postgres — never in Redis, a static dictionary or any cache.
  - Background services take a Postgres advisory leader lock per tick (`LeaderGate`) AND are idempotent on their own (once-ever unique keys, stamp-then-send, conditional updates); a tick never runs unguarded.
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
- Critical-value acknowledgements live in `critical_result_events` (written with the result version, audit-logged); an explicit Acknowledge action, never "viewed".
- Patient-facing report links: identity verification is checked on the SERVER before any patient detail or PDF is returned. No patient data before verification.
- A derived delivery file (the combined report + partner PDF) is served from the bytes just built, never only via a storage round-trip; a cache probe treats ANY storage error as a miss (S3-compatible stores may answer a missing key with 403); staff screens say what the SERVED file contains (`GET /api/reports/{id}/pdf-parts`), never infer it from a flag. Test storage failures with the fake store's fault knobs.

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
- Desktop (Electron): the page ALWAYS reports `document.visibilityState === 'visible'` (background throttling is off so sockets live in the tray). "Is the user looking" comes from the main window's state (`pageShown()` / `desktopInFront()` in `desktop-notify.service.ts`), never from document visibility; native notification assets resolve via `path.join(__dirname, …)` in main, never a root-absolute URL.
- Report PDF typography: every text draw takes font / size / weight from the report-theme token table (`report-theme.ts`), never a literal size; the Classic table is pinned byte-for-byte by golden hashes (`report-theme-classic.spec.ts`, `report-header-legacy.spec.ts`). An embedded theme font loads lazily in `preloadReportImages`, never in the bundle.
- Report print order has ONE home: the template's `sequencing` (applyReportSequencing) — never re-sort report sections elsewhere.

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
