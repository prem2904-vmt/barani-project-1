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
  - **Specimen of an ordered line:** `order_tests` (code + name), decided by the Test Master's specimen mode + allowed list (`SpecimenRules` / `micro-specimen.ts`); every report path prints the ORDERED specimen, never the Test Master text. Every NEW caller of `OrderService.CreateAsync` (OPD consult Complete, OPD desk Checkout, any future one) MUST thread its picked specimens into `CreateOrderInput.Specimens` — omitting it isn't a no-op, it makes `PlanSpecimensAsync` throw `specimen_required` for every choose-mode test and fail the WHOLE order; catch `CodedValidationException` ahead of any generic `ArgumentException` handler so that coded error reaches the UI instead of a flattened message.
  - **Paid (patient release):** `PatientReleaseGate`.
  - **Counter collections (cash drawer, day closing, daily statement, dashboard):** `CashDrawer.CollectionsAsync` — lab payments / refunds AND OPD + pharmacy `opd_payments` / `opd_refunds`, merged per mode; never a second payments query in a controller.
  - **Procedure price in the consult:** `OpdFeeRules.ResolvePrice` (the rule) + `ProcedureRules.CheckPrice` under the OPD setting `procedurePricing` (doctor change off by default; optional ± % cap); every doctor price change is audit-logged.
  - **Daily patient number (#12 before the name on lab screens):** `daily_patient_numbers` via `DailyPatientNumbers` (branch × IST day, row-locked, reused by the patient's later orders that day), stamped once on `orders.DailyNo` / `DailyNoDay`; the UI shows it only through `pf-daily-no` / `utils/daily-no.ts`. An on-screen aid ONLY — never printed (labels, slips, bills, reports, messages, exports).
  - **Front-desk work list with no status chip:** ONE list, each order once (deduped by order id; `work-merge.ts` holds the status precedence and the business-day → #N sort); a row keeps every action of every status it belongs to, using the SAME action components as the single-status views, never a re-implementation.
  - **Which tube / pot a line is drawn into:** ONE key, `OutsourcingRules.VialKey` + `ColourKey` (`TubeType`: blank container = sterile pot) — destination + space + tube type, and for a non-blood pot the line's specimen (fixed / chosen, else the Test Master text). Create, add-tests and outsourcing reconcile all use it, in-house and outsourced alike: same specimen + same container = one pot, never one pot per test.
  - **Partner report in the patient's PDF:** the `attachToReport` flag on the line's `external_report` attachment; the combined PDF is DERIVED on read (`CombinedReportPdf`, content-addressed cache) from the immutable stored report — never written into the stored report, never a second copy of the flag.
  - **Outsourced or in-house:** the tube's `OutsourcedVendorId`, frozen at order time from the lab's effective test; every lab surface filters through `OutsourcingRules` (`InHouseTube` for tubes, `InHouseWork` for lines), never a bare status check.
  - **Technician report notes (all four levels — line, profile, department, order):** `orders.ReportNotesJson`, written only through `ReportNotesService` (row-locked, audited); the report snapshot copies them on a FINAL / amended final ONLY (never a preliminary / partial — `ReportNoteRules.PrintsOn`, the one home); the Lab-settings switch (`techReportNotes`, per branch) gates new text only — saved notes always print.
  - **Analytics / Lab Insights calculations (patients new-vs-returning, test counting, revenue, outsourced %, median TAT, IST period resolution):** `Services/Analytics/AnalyticsService.cs` + `AnalyticsDefinitions.cs` on the backend, mirrored on the frontend ONLY for the period-preset → IST range math (`shared/utils/analytics-period.ts`, a tested TS mirror); both halves of Insights (charts/KPIs and the Operations Insights lists) read the SAME filter band and backend queries so a chart total and its list total can never drift apart — never recompute a KPI inline in a component.
- Never match by name or code when an ID / key exists.
- User files live only in Spaces via the storage service — never on the container disk (wiped on every deploy).
- Patient files (reports, partner PDFs, attachments, plate photos, chat / voice, documents, bills, signature scans) are served ONLY through the authenticated, tenant-checked API — never a bearer / presigned URL that works without the session (the verified public report link keeps its own model). Make that path fast instead: stream from storage (never buffer the whole file first), ETag + `Cache-Control: private` (+ `Vary: Authorization`) so a revalidation is a 304 with no storage trip, remember a missing file, and fetch each file ONCE per session in the UI (no HEAD pre-check, no refetch per render, no read-back when nothing changed).
- A tenant's storage folder has ONE home: `tenants.StoragePrefix`, set once by `TenantStorageKeys` (handle, else `<name>-<id8>`) — every storage key is built through it; authorization is always by tenant ID, never by folder name.
- A storage write failure is never a bare 500: `UploadStore.SaveAsync` wraps it as `StorageWriteException` and the API answers 503 `storage_error` (the global handler maps any `AmazonServiceException` the same way); log the S3 error code + request id, never keys, never SDK text in the UI.
- Every storage path is covered by the MinIO end-to-end suite (`Prefrontal.Tests.Integration/StorageE2E`: the real Spaces client against MinIO, with injected S3 faults); a new storage call site needs a test there — the in-memory fake alone is not coverage.
- A feature switch has ONE resolver (UI lab-features / server LabFeatureGate); never gate a surface on the workflow or the entitlement alone.
- Never inline binary (base64 images, files) into a field the server size-caps: an analyzer's HL7 `ED` segments (histogram/scattergram BMPs) blew mw's `raw` cap at ~300KB — redact the base64 to a placeholder in `raw` and carry the bytes in an additive, optional field (`message.images[]`) instead, which also buys free backward compatibility since an un-upgraded server just ignores the field it doesn't know while `raw` stays small either way.
- A re-processed run of the same sample (re-run, retransmit, or an Attach after Unmatched) must REPLACE its own derived artifacts, never append another copy: an instrument's idempotency key is hashed from the raw message bytes, so a real analyzer resending a value-identical result under a fresh message timestamp is NOT an idempotency replay — it is a genuinely new row that reprocesses and re-routes. Anything that attaches per-run output (instrument histogram/scattergram images onto `OrderTestEntity.AttachmentsJson`) tags its own entries with a namespaced, stable key (sample/line + source code) and removes the old tagged entry before adding the new one — latest wins, dedupe by that key, never a bare append keyed by a fresh GUID each time.
- Two independently-built changes can fix the same gap two different ways without ever conflicting in git (different files, or additive edits that 3-way-merge clean): reconciling two branches is not just "resolve the conflicts git flags" — diff each branch against the OTHER's merge-base to find same-purpose code neither branch's diff alone reveals (here: two M51 CBC code-map presets, and two raw-cap fixes, that merged without a single git conflict marker). Before merging two feature branches that touch the same area, diff both against their common base and read the full diff, not just `git status`.

## 2. Tenant and branch isolation
- Every query is tenant-scoped; branch-scoped when the tenant is strict. Rely on the EF global filters; never `IgnoreQueryFilters()` without a comment and a test.
- Never trust an ID from the client without checking that it belongs to the caller's tenant / branch (IDOR).
- Never write into tenant catalogues on deploy / boot. Clone once at provisioning.
- Seeders run ONCE (a run marker). Never re-grant or re-create on every boot.

## 3. Database and queries
- **Queries:**
  - No unbounded lists: page or cap every list endpoint, and clamp page size.
  - A list whose row status is computed (JSON / per-row rules) filters and pages on a LEAN projection first, then builds the rich rows for that page only; chip totals come from the lean pass (`OutsourcingService.ListPageAsync` / `CountsAsync`), never from the rich fetch.
  - No N+1: project in one query (`Select` to a DTO), `AsNoTracking` for reads, summary projections for grids.
  - Every new filter / sort / FK column gets an index. Check with `EXPLAIN` on realistic data.
  - A new raw-SQL index gets a plan test that drops the table's OTHER indexes inside a rolled-back transaction (`IndexAudit3IndexTests`) — never a "which index does the planner prefer on an empty table" assertion (flaky). A batch / sweep query never sorts what it doesn't need sorted (an ORDER BY over an OR no index serves reads every match), and a background sweep never re-evaluates the same unresolved rows every tick — stamp a re-check time.
  - Patient text search (name / MRN / phone / ABHA `LIKE '%…%'`) is served by `pg_trgm` GIN indexes on the EXACT expressions EF emits (`lower("FirstName")`, the normalised phone, …; `PatientSearchTrigram`); a newly searched column gets its trigram index in the same change. The extension is created inside a guarded `DO` block: a missing extension / privilege skips the indexes, never fails boot.
- **Concurrency:**
  - Counters / numbers (MRN, sample ID, invoice) use atomic `INSERT … ON CONFLICT … RETURNING`, never `MAX+1`.
  - Check-then-insert needs a unique index. Money / stock changes run in one transaction under a row lock.
  - An autosave sends only the DIRTY sections (`PATCH …/draft`: omitted = untouched, present = replace), checks the client's last-seen `UpdatedAt` under the row lock (`stale_draft`), returns a slim result, and shares every validate / write helper with the full save — never a second validation path for the partial save.
  - A money helper called from inside a caller's transaction JOINS it (`CurrentTransaction != null`), never nests one; the caller's totals and the helper's rows commit together, and the bells go out after the commit.
  - Never fire side effects inside a batch transaction (auto-report / anything that opens its own transaction, bells, device pushes): the batch runs through `AfterCommit.InTransactionAsync` and side effects go through `AfterCommit.RunOrDeferAsync` — they run after the commit, never on a rollback or a retried attempt, keyed so one batch fires them once (a nested report transaction threw, was swallowed, and a submitted tube got no final report).
  - `ExecuteUpdate` / `ExecuteDelete` bypass the audit interceptor: an audited entity written set-based writes its own rows (`Auditing.AuditTrail`) in the same transaction.
  - Money, clinical results / reports, outboxes (WhatsApp, chat, notifications), idempotency keys, attempt limits and the audit log live only in Postgres — never in Redis, a static dictionary or any cache.
  - Background services take a Postgres advisory leader lock per tick (`LeaderGate`) AND are idempotent on their own (once-ever unique keys, stamp-then-send, conditional updates); a tick never runs unguarded.
- **Time windows:**
  - Day windows are IST days converted to UTC ranges. Never `DateTime.UtcNow.Date`.
  - Tests too: a business date comes from `LabClock.BusinessDate()` / `labDaysAgo(n)`, never `DateTime.UtcNow.Date` or a literal near "today" (appointment tests failed every night 00:00–05:30 IST; a spec failed on 1 Oct when its literal equalled the 30-day default).
  - A token is issued for the day of ARRIVAL and must be unique where the unique index says (per doctor), whatever pool it is drawn from (OPD department pool, an off-day appointment checked in today).
  - Store UTC; display IST.
- **Migrations and data fixes:**
  - Migrations AUTO-APPLY on boot: they must be safe, idempotent, reversible, and never destructive without the owner's approval.
  - Data fixes: back up → preview (read-only) → the owner approves → apply. Never run writes on dev / stage without approval.
  - Dropping columns / tables happens in a separate, later cleanup, after testing.

## 4. Clinical safety
- A signed report never changes. Stored PDFs are immutable; only Regenerate creates a new version (supersede the old one in the same transaction).
- One live final report per order. "Delivered" comes from the live final report.
- Print ranges / units from the saved result snapshot, not the live Test Master.
- A value flagged CRITICAL always prints (a line whose overall result is critical with no single value flagged — a Conditions-engine critical — prints every value): it is never in the hidden set, whatever the print picker's "start with", auto-tick or a saved hide-list says (abnormal-not-critical stays the tech's choice). One enforcement point: `PrintPickerRules.EffectiveHidden` and its TS mirror `effectiveHidden()`.
- Safety acknowledgements (allergy / pregnancy) belong to ONE line of ONE patient: never copied onto a new line (usual set, repeat, swap); safety gates read the tenant's EFFECTIVE drug (`DrugCatalogResolver`), never the master row.
- Walk-in sale of a scheduled drug: H needs the prescriber's name AND registration number (while the pharmacy setting `enforceSchedules` is on — the default); H1 and X always need them plus an UPLOADED prescription before payment. Checked in one fixed order (buyer, prescriber, reg no, address, upload) by `PharmacyDispenseService.EnforceSchedules` / `PharmacyRules.EnsurePrescriptionUploaded` and the UI mirror `counterGate()`, kept in lockstep.
- Critical-value acknowledgements live in `critical_result_events` (written with the result version, audit-logged); an explicit Acknowledge action, never "viewed".
- Patient-facing report links: identity verification is checked on the SERVER before any patient detail or PDF is returned. No patient data before verification.
- A derived delivery file (the combined report + partner PDF) is served from the bytes just built, never only via a storage round-trip; a cache probe treats ANY storage error as a miss (S3-compatible stores may answer a missing key with 403); staff screens say what the SERVED file contains (`GET /api/reports/{id}/pdf-parts`), never infer it from a flag. Test storage failures with the fake store's fault knobs.

## 5. Auth and security
- The server decides access; the UI only reflects it (guards + a not-authorised screen, no screen without access).
- Money powers are the same wherever money moves: a desk fee override follows the role discount cap (`BillingService.DiscountCapFor`), a refund needs `process_refund`; only the consult's Complete finishes an OPD visit.
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
- A report block that signs off BELOW another marker ("****End of Report****" + a deferred signature block) is ONE pagination decision, reserved together before either is drawn — never two separate page-break checks in sequence, which can let the first marker draw fine while the second block alone jumps to a near-empty next page (owner's report 2026-10-01, `report-pdf.ts`).
- A money/PII field the backend withholds for a missing permission is OMITTED from the JSON entirely (the app's global `JsonIgnoreCondition.WhenWritingNull`, Program.cs on the mw side) — a template/spec must check the key is ABSENT (`!('billedNet' in data)` / `TryGetProperty`), never assume it arrives as a visible `null`.
- Adding a new nav entry / route updates the full-nav snapshot specs deliberately (e.g. `opd-dark.routes-nav.spec.ts`'s `toMatchSnapshot()` of the reachable id/path list) — a new "Insights"-style work area failing that snapshot is the harness WORKING (it caught the new surface), not a regression; insert the new id/path at its real position and move on, never regenerate the whole snapshot blind.

## 7. Process: definition of done
1. Fetch and merge the latest remote before starting.
2. Write tests for the change (and one that pins the single source).
   - Test helpers that need "a test to order / enter" go through `StableTestCatalog.OrderableIndividuals` (deterministic code order; never outsourced or specimen-required) — never `OrderBy(t => t.Id).First()` (another class's row can sort first and flip the scenario). A negative SignalR assertion sleeps only when the absence isn't already proven by an awaited rejection. Two full runs on one DB wait for the first process to EXIT, not just its summary line.
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
