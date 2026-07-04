# Prefrontal LMS — QA & Testing Guide

*Official test guide for the Prefrontal Laboratory Management System. Hand this to a testing team with no prior exposure to the product. Every flow script is numbered (e.g. `BIL-3`, `CHAT-7`) so failures can be reported by reference.*

---

## 1. Product overview

Prefrontal LMS is a multi-tenant, cloud-hosted platform that runs a diagnostic laboratory (or a hospital lab department) end to end: patient registration, test ordering, specimen collection, in-lab processing and validation, report delivery, and GST-compliant billing. It is sold as a subscription; each customer organization is an isolated **tenant**.

There are **two applications built from one codebase**:

- **Web / desktop app** — runs in modern desktop browsers and as an Electron desktop build. This is the full-featured staff console.
- **Mobile app ("Prefrontal")** — a phone-first iOS and Android build of the same screens, adding native navigation, push notifications, lock-screen inline reply, native share sheets, and CallKit voice calls.

A small, separate **admin control plane** (a web console used only by Prefrontal's own platform staff) provisions tenants, sets plans and module entitlements, toggles branch isolation, and suspends/reactivates organizations.

**Actors:**

| Actor | Where they work | What they do |
|---|---|---|
| Platform admin (superadmin / support) | Control plane | Provision tenants, set plans/modules/isolation, suspend, reset admin passwords, broadcast. Support role is read-only. |
| Tenant admin (Lab Admin) | LMS | Full control of one organization: catalog, users, roles, branches, workflow, billing config. |
| Lab staff roles | LMS | Receptionist, Billing Counter, Sample Collector, Lab Technician, Pathologist, Branch Manager, Store Keeper, Inventory Manager, Home Collection Agent — each permission-scoped. |
| Patients (subjects) | Public web links only | Anonymous, token-verified access to track an order and view their own report (DOB/phone step-up). Never log in. |

---

## 2. System architecture for testers

**Components**

- **UI** — the Angular app (web, Electron, iOS/Android). Enforces route guards, nav visibility, and optimistic UI. **UI gates are convenience only; the server is the real fence** — every negative test must also be run directly against the API.
- **Middleware API** (.NET) — all business logic, persistence, and permission enforcement. Uses OR-semantics permission codes per endpoint; a `*` (super admin) code bypasses all checks.
- **Admin control plane** — separate console + service. Owns canonical tenant identity and fans mutations to the LMS over a **service-token** channel (machine-to-machine; a tenant user token must never work there).
- **Realtime hubs** — SignalR channels for chat, presence, typing, and WebRTC call signaling.
- **Push** — APNs (iOS, incl. VoIP/CallKit), FCM (Android). Web push is not implemented.
- **Auth** — Supabase password grant. Staff sign in with **Organization + Username + Password**; the backend swaps these for a token using a hidden per-tenant "synthetic" email so the same real email can exist in many tenants.

**Multi-tenancy (conceptual).** Every request resolves to a user → tenant → active branch → permission list. All operational data is tenant-filtered at the ORM level. A foreign-tenant ID on any by-id read/write must read as **not found** — never success, never leaked data.

**Branch isolation (conceptual).** Each tenant runs in one of two modes, set from the control plane:
- **Shared / hub (default)** — only tenant scoping applies; all branches see each other's operational data (needed for central-lab dispatch).
- **Strict** — orders, bills, appointments, dispatch, inventory, home-collection, samples, tests and reports are *additionally* scoped to the caller's active branch. Patient records stay tenant-wide (findable in any branch), but each patient's order/bill/report history pane is branch-scoped.

**Module entitlements.** Per tenant, the control plane licenses modules (Inventory, Messages, Home Collection, Reports, plus OPD/IPD/Pharmacy/Lab). A disabled module vanishes from nav, blocks its routes, and returns **403 `module_disabled`** from the API. A tenant with no config row = all modules on (legacy fallback).

*Environments / hosts: the mobile build shows its configured API host on the login screen (native only) and points at the production backend by default; testers should confirm it names the deployed backend, not localhost.*

---

## 3. Test environment setup

### 3.1 Provision a test tenant (control plane)
1. Sign in to the admin console with a Google account registered as an **active platform admin** (a non-admin Google account gets `not_a_platform_admin` 403).
2. Open **Provision**. Fill Lab name, Admin email/name/phone (required); pick a plan (module checkboxes default from the plan); set the 8 module toggles; set Branch isolation ON/OFF (default OFF).
3. Create. The control plane creates the canonical tenant, generates a unique slug + a 14-char temp password, forwards to the LMS (which creates org + primary branch + 7 seeded departments + Lab Admin), and emails the admin an onboarding link with org/username pre-filled.

### 3.2 Temp-password first-login flow
1. Open the emailed sign-in link, log in with the temp password.
2. Expect immediate redirect to **Set Password**; every other route is blocked (and the API returns 403 `must_change_password` on non-auth endpoints) until a new password (8–64 chars, breached passwords rejected) is set.
3. After setting, land on the role landing. The old temp password must now fail.

### 3.3 Create users (in-app)
- As a `manage_users` admin, invite users (first name, father's name, email, roles, optional branch/sub-branch scope). Either set a password now (usable immediately, no email) or send a Supabase invite email.
- Deactivate a user → their next API call is rejected; they cannot log in.

### 3.4 Module entitlements
- From the control plane tenant detail, toggle modules and Save (full replace). Verify inside the LMS: disabled module hidden in nav, deep link redirects, API returns 403 `module_disabled`.

### 3.5 Device matrix
| Class | Targets |
|---|---|
| Desktop browsers | Latest Chrome, Safari, Firefox, Edge (≥1280px) + Electron build |
| Narrow web | 641–1279px (rail band), ≤640px (phone-web pill band) |
| iPhone app | Portrait only; lock-screen, VoIP/CallKit, inline reply |
| iPad app | All orientations; must show rail even at 12.9" (never desktop top-strip) |
| Android app | Push channel, hardware back, keyboard; CallKit not available (falls back to notifications) |

### 3.6 Seed test data (run once per fresh tenant)

A freshly provisioned tenant is empty; most downstream scripts assume this data exists. Create it in this order before starting any module pass:

1. **Test catalog** (Admin → Tests, as Lab Admin): at least 4 individual tests across 2 departments (e.g. BIO + MICRO), each with a price and an **18% GST tax slab** (E2E-1 asserts 18% GST). Give one test's parameters reference **and** critical ranges (needed for RPT-5 and CHAT-13).
2. **Package**: one package whose members fully cover 2 of the individual tests, priced below their sum (needed for PAT-7).
3. **Second branch ("Branch B") + one sub-branch** (Admin → Branches): needed for AUTH-15/16, ADM-14, E2E-5 and the branch-switcher tests.
4. **Referral lab**: one active referral lab handling MICRO (needed for REF-5, E2E-3).
5. **Role-scoped test accounts** (§3.3): one user per seeded role — Receptionist, Billing Counter, Sample Collector, Lab Technician, Pathologist, Branch Manager, Store Keeper, Inventory Manager, Home Collection Agent — plus the Lab Admin from provisioning (needed for AUTH-15/16, BIL-11, REF-10, SEC-8, E2E-2).
6. **Billing config** (Admin → Billing, as Lab Admin): GST master ON, invoice prefix set, discount caps set for at least two permission tiers (needed for PAT-9, BIL-1/2).

---

## 4. Module-by-module test plans

> Each module has a prefix. Report flow-script failures as `PREFIX-#`, business-rule assertion failures as `PREFIX-BR-#`, and edge-case failures as `PREFIX-EC-#`.

---

### 4.1 Authentication & Tenants — `AUTH`

**Feature.** The front door and the walls: tenant-scoped login, forced first-login password change, per-account lockout, branch switching, organization/branch/user administration, module entitlements, and tenant suspension.

| # | Step | Expected result |
|---|---|---|
| AUTH-1 | Open Login; inspect fields | Organization dropdown (last-used pre-filled, up to 8 remembered), Username, Password, show/hide toggle; native build shows API host |
| AUTH-2 | Log in using org slug, then org name (any case), then raw tenant GUID | All three resolve the same tenant |
| AUTH-3 | Log in using tenant username, then real email (trimmed, any case) | Both work |
| AUTH-4 | Submit with any field empty | Submit disabled / inline "Enter your organization, username and password"; no request |
| AUTH-5 | Submit wrong org, wrong user, wrong password, deactivated user (4 tries) | Same generic "Invalid organization, username or password" every time (no enumeration) |
| AUTH-6 | Log in valid, no returnUrl | Lands on role landing (manage_tests→Admin; register_patient→Frontdesk; enter_result→Lab; validate_result→Pathologist; collect_sample→Collection; inventory→Stores; else Dashboard) |
| AUTH-7 | Log in with `?returnUrl=/admin` as a non-admin | Ignored; falls back to role landing |
| AUTH-8 | Simulate a hung sign-in: delay the sign-in request >15s using browser DevTools (Network → custom throttling profile with very high latency) or a local proxy (Charles / mitmproxy) that holds the token response, then submit | Fails with "Sign-in timed out — check your connection" |
| AUTH-9 | Log in with a temp password | Forced redirect to Set Password; deep links elsewhere bounce back; API returns 403 `must_change_password` on non-auth endpoints |
| AUTH-10 | On Set Password, submit a breached password ("password123") | Rejected with breach message |
| AUTH-11 | Set a valid password (8–64) | Gate clears, lands on role landing; old temp password now fails |
| AUTH-12 | Fail login 5× same org+username, then attempt 6 | "Too many attempts. Try again shortly." (HTTP 200 locked, not 429) |
| AUTH-13 | Wait out the exponential backoff (2^fails s, cap 300s) then log in | Succeeds; counter reset |
| AUTH-14 | Fail against a *different* org+username | First account's lock unaffected (lock is per account) |
| AUTH-15 | As a tenant-wide user (manage_tenant / `*`), open the branch switcher | Sees every active branch even if role row is pinned to one |
| AUTH-16 | Switch branch; create an order | App reloads; lists show the new branch; order stamped with the switched branch |
| AUTH-17 | Log out / restart browser | Branch choice survives; if the stored branch is no longer permitted, silently resets to default |
| AUTH-18 | As manage_tenant, edit org profile | Branding name truncates at 10 chars; mode ∈ {logo,name,both}; sample width 1–9 only |
| AUTH-19 | As manage_departments, set a department sample code already used | Friendly error naming the clashing department |
| AUTH-20 | Invite the same real email into a second tenant (in-app invite) | Supabase conflict ("supabase_error") — real email collision |
| AUTH-21 | PATCH/DELETE/read-roles a user id from another tenant | "User not found" (never success, never data) |
| AUTH-22 | Disable a module from the control plane | Nav item disappears; deep link redirects to `/`; API returns 403 `module_disabled` |
| AUTH-23 | Suspend the tenant mid-session | Every API call returns 403 `tenant_suspended`; login shows "This organization is suspended"; UI degrades without retry loops |
| AUTH-24 | Reactivate the tenant | Access resumes with no user action |

**Business-rule assertions**
- [ ] `AUTH-BR-1` Org resolution = slug OR case-insensitive name OR GUID; username = tenant username OR email.
- [ ] `AUTH-BR-2` Auth uses a hidden per-tenant synthetic email for the Supabase grant (legacy users fall back to real email) — **not verifiable black-box**: requires backend/Supabase log access; skip unless log access is provided.
- [ ] `AUTH-BR-3` Password policy: length 8–64 only, no composition rules; Pwned k-anonymity check; endpoint rate-limited.
- [ ] `AUTH-BR-4` X-Active-Branch honored only if the branch belongs to the tenant AND (caller is tenant-wide OR pinned to it); else silently ignored.
- [ ] `AUTH-BR-5` No module config = all modules on; a present row is default-deny per key.
- [ ] `AUTH-BR-6` Disabling `reports` kills only the analytics dashboard; the per-order report pipeline stays on.

**Edge-case checklist**
- [ ] `AUTH-EC-1` Temp-password bypass: call operational APIs with the token via Postman → 403 `must_change_password`.
- [ ] `AUTH-EC-2` Stale stored branch removed → silent fallback to default, no error loop.
- [ ] `AUTH-EC-3` Concurrent token-refresh burst → exactly one refresh; user not signed out (single-use refresh token).
- [ ] `AUTH-EC-4` Module fail-open: deep-link a disabled module with config endpoint failing → UI shell may flash but every API call 403s; no mutation possible.
- [ ] `AUTH-EC-5` Cold-start offline settles to Login within ~4s (no infinite spinner); session survives cold start.
- [ ] `AUTH-EC-6` Breach-check outage → password change *succeeds* (fail-open) — documented risk.
- [ ] `AUTH-EC-7` Landing dead-end: user with no landing permission → `/403`; sign-out still reachable.
- [ ] `AUTH-EC-8` Provision idempotency: re-provision same tenant → "already onboarded"; DB kill mid-provision may orphan a Supabase user.

---

### 4.2 Patients & Orders — `PAT`

**Feature.** Front-desk registration and lifecycle: lifetime tenant-wide MRN, quick + advanced search, edit/merge/soft-delete, ABHA linking, documents, and raising orders that explode into per-department barcoded sample tubes and move through a derived lifecycle.

| # | Step | Expected result |
|---|---|---|
| PAT-1 | As Receptionist, register a walk-in patient (age only, no DOB) | Success toast; profile opens; MRN in tenant format (default `TTT-YYMM-NNNNNN-V`); DOB synthesized from age |
| PAT-2 | Register with DOB and a typed age | Age dropped, recomputed from DOB server-side |
| PAT-3 | Quick search "sam a" | Tokens AND together, each token ORs across first/father name/phone/ABHA/MRN; active only; newest first; ≤20 |
| PAT-4 | Advanced search with no filters | Rejected "At least one filter is required" (UI must never send it) |
| PAT-5 | Advanced search by phone with `+91`/spaces/dashes | Digit-normalized exact match; exact hits sort top |
| PAT-6 | Create a walk-in order: attach patient, add tests from Recent/Favourites/Packages/All | Search tolerates US↔UK spelling; starring persists a favourite |
| PAT-7 | Add individual tests all covered by a package | Package suggestion appears (cheapest first) with savings; Apply swaps them |
| PAT-8 | Type a referring hospital then doctor | Doctor suggestions filter to the hospital; changing hospital clears doctor; new names auto-created on order create |
| PAT-9 | Enter a discount above your tier cap | Confirm blocked with "exceeds your limit" |
| PAT-10 | Confirm order with front-desk payment | Order POSTs; bill creates with discount; payment records; draft clears; invoice with tracking + order QR shown |
| PAT-11 | Save a draft cart, reopen for same patient within 7 days | Cart + priority restore ("Draft restored"); after 7 days silently discarded |
| PAT-12 | Repeat an order whose tests were since deactivated | Opens with prior tests; deactivated ones dropped with a count toast |
| PAT-13 | Modify a billed order (add/remove tests) | Bill rebuilds server-side (positive = collect diff, negative = refund); routed to billing |
| PAT-14 | Try removing a validated/delivered test in edit | Rejected "Cannot remove already-validated test(s)" |
| PAT-15 | Cancel an order with reason + refund mode | Paid amount refunds first; order → cancelled; tubes → cancelled; unvalidated tests → rejected; validated kept; reason audited |
| PAT-16 | Mark Dispatched, then Undo dispatch | Collected tubes → dispatched (idempotent); undo works only before pickup/receipt |
| PAT-17 | Lab Arrive on a dispatched order | Dispatched tubes → received; TAT starts; techs auto-assigned (best-effort) |
| PAT-18 | Open a patient profile | Demographics, MRN QR card, cross-branch visit history, documents, clinical tabs |
| PAT-19 | Link ABHA (14 digits) | Non-14-digit rejected; duplicate within tenant → conflict; same ABHA in another tenant allowed |
| PAT-20 | Merge a duplicate patient | All orders/bills/appts/messages/docs/reports re-link atomically across branches; duplicate deactivates; self/inactive-target merge rejected |
| PAT-21 | Upload a document | Only png/jpeg/webp/heic/pdf, ≤20MB; 503 if storage unconfigured; reads return 1-hour URLs; delete is soft |
| PAT-22 | Soft-delete a patient (manage_tenant) | Vanishes from all searches; history/orders remain; direct profile URL still loads |
| PAT-23 | Scan an order QR (`/o/:id`) or resolve by GUID/token/invoice | Resolves within caller's tenant only; revoked tokens don't resolve; opens collection drawer or profile |
| PAT-24 | Configure custom MRN format (numeric/alpha) and register | Numeric = prefix+date+padded continuous number; alpha = fixed-width letter block odometer; existing MRNs unchanged |
| PAT-25 | Edit a patient: change the DOB, change the phone (entered with `+91`/spaces), and attempt to alter the MRN | Age recomputes from the new DOB; phone digit-normalized; MRN immutable (read-only in UI, a changed MRN rejected server-side). Known gap: no server-side demographic validation — log any nonsense value (future DOB, letters in phone) that the server accepts |
| PAT-26 | Open the public order-tracking link (from the PAT-10 invoice tracking QR) in a private/anonymous browser window | DOB/phone step-up required before anything shows; correct step-up → order stage timeline for that order only (masked identity, no other patient data); wrong 5× → lockout; a revoked/expired tracking token behaves as non-existent |

**Business-rule assertions**
- [ ] `PAT-BR-1` Default MRN carries a Verhoeff check digit — single-digit typos and adjacent transpositions must fail MRN validation.
- [ ] `PAT-BR-2` Custom MRN counter is continuous (never resets); serial increments run in a Serializable transaction (no duplicates under concurrency).
- [ ] `PAT-BR-3` Quick search returns active patients only; advanced search requires ≥1 filter, clamps page size 1–100, excludes demo orders.
- [ ] `PAT-BR-4` Order tests group into one tube per (referral-vendor, department); each tube gets a barcode.
- [ ] `PAT-BR-5` New orders start `created`; if the workflow has no collection step, tubes are born `received`.
- [ ] `PAT-BR-6` Order status is always recomputed from sample/test states; `cancelled` and `delivered` are terminal.

**Edge-case checklist**
- [ ] `PAT-EC-1` Concurrent registration (same tenant, same month, new month boundary) → distinct MRNs.
- [ ] `PAT-EC-2` Alpha-serial rollover at 999999 → `AB0001` with no dup/skip; absolute capacity → clean registration error.
- [ ] `PAT-EC-3` **Cross-tenant order creation probe** — POST an order with another tenant's patient id (creation is not obviously tenant-guarded — priority IDOR test).
- [ ] `PAT-EC-4` Priority drift: UI sends `Normal`/`Urgent`, backend defaults `routine`, widgets match `STAT`/lowercase — an "Urgent" order likely never surfaces as STAT.
- [ ] `PAT-EC-5` Draft carts are per-browser (leak on shared FD PCs); draft restore wins over the repeat-order deep link.
- [ ] `PAT-EC-6` Cancel has no stage guard (cancellable after report delivery — confirm desired).
- [ ] `PAT-EC-7` Patient documents endpoints have **no permission gate** (any tenant user can list/upload/delete) — flag.
- [ ] `PAT-EC-8` Null-MRN legacy patients: verify ID card and MRN search behavior.

---

### 4.3 Samples & Collection — `SMPL`

**Feature.** The specimen's life from order to lab receipt: tube grouping + barcodes, counter collection ("tap the tube"), rejection, dispatch/undispatch, lab receipt (scan/batch/arrive/package QR), home collection with agent auto-assignment, and Lost & Found rescue.

| # | Step | Expected result |
|---|---|---|
| SMPL-1 | Open Sample Collection as a collector | KPI strip, scan/search bar, pending-collection list grouped by order with coloured tube chips (outsourced = pink outline) |
| SMPL-2 | Create an order with tests from two departments | Patient appears with two vials; collectors get "ready to collect"; unpaid orders still appear (no payment gate) |
| SMPL-3 | Search by name/MRN/phone/order#/barcode + Enter | Single match opens the drawer; barcode-looking codes hit an exact lookup; unknown → "No matching order" |
| SMPL-4 | Tap a vial | Fills instantly (optimistic), green tick + time; progress advances; server records collector+timestamp |
| SMPL-5 | Tap a collected vial again (before pickup/receipt) | Reverts to pending; after pickup/receipt → error toast, stays collected |
| SMPL-6 | Print labels | Only tube labels (barcode + QR) print |
| SMPL-7 | Dispatch all collected tubes, then Undo dispatch | Tubes → dispatched; undo works only until lab receives |
| SMPL-8 | Tap "Can't collect", pick a reason (Other requires note) | Every pending vial rejected; "N tubes flagged for re-collection"; creator/collectors/assigned techs notified |
| SMPL-9 | As a lab user, scan a dispatched tube barcode | Tube → received; TAT starts; tests auto-assigned to least-loaded eligible tech (if auto-assign on) |
| SMPL-10 | Order-level "Mark arrived" | Every dispatched tube → received in one tap; auto-assign fans out |
| SMPL-11 | Batch-receive several tubes, one of them invalid | All-or-nothing rollback (no half-received rack) |
| SMPL-12 | Receive a still-pending tube | Refused (only collected/dispatched/in-transit receivable) |
| SMPL-13 | Add a home-collection agent (pincode list/range or geo radius, weight ≥1) | Agent appears; remove = soft-deactivate |
| SMPL-14 | Book a home visit with a covered pincode | Auto-assigned; multi-cover → lowest open-load ÷ weight wins, ties prefer higher weight |
| SMPL-15 | Book with uncovered/no pincode | Lands unassigned; appears on the unassigned queue for manual assign |
| SMPL-16 | Agent "Check in & collect" on a booked visit | Flips to checked-in, issues token, spawns order once (idempotent), routes to collection screen |
| SMPL-17 | Agent "Complete visit" | Appointment completed; drops off queue |
| SMPL-18 | Lost & Found "Send to lab" on a stranded tube | Jumps to received from any pre-lab state; back-fills audit; starts TAT; rejected tube refused ("re-collect it instead") |

**Business-rule assertions**
- [ ] `SMPL-BR-1` Barcode short format = 2-digit dept code + 2-digit year + running number (width 1–9); per tenant+dept+year, resets each year; serializable (no dup).
- [ ] `SMPL-BR-2` Legacy format `PF-{VENDOR}-{YYYY}-{seq}-{DEPT}` when the dept has no sample code.
- [ ] `SMPL-BR-3` State machine: illegal transitions refused (collect only from pending; uncollect refused after pickup/receipt; receive refused on pending/rejected; validated tube cannot be rejected).
- [ ] `SMPL-BR-4` Rejection cascades: non-validated tests on the tube → rejected and leave queues; rejection count increments.
- [ ] `SMPL-BR-5` Collection is never payment-gated; TAT starts at lab receipt (or at collection in collapsed workflows).
- [ ] `SMPL-BR-6` On collection, consumables FEFO-deducted (best-effort — a stock failure must not block collection).
- [ ] `SMPL-BR-7` Claim requires a scanned barcode match unless the "allow claim without scan" lab setting is on or the tube has no barcode.

**Edge-case checklist**
- [ ] `SMPL-EC-1` Stale-tab double collect → second PATCH fails, losing tab's optimistic UI rolls back.
- [ ] `SMPL-EC-2` Uncollect in a collapsed (auto-receive) workflow → locked, no undo.
- [ ] `SMPL-EC-3` Reject-then-receive → refused; Lost & Found on a rejected tube → refused.
- [ ] `SMPL-EC-4` Batch receive atomicity (one bad tube rolls back all).
- [ ] `SMPL-EC-5` Cross-tenant/cross-branch IDOR on collect/reject/receive/by-barcode → not found; confirm isolation flag flips behavior.
- [ ] `SMPL-EC-6` **Home Collection Agent role cannot check in** (check-in needs register_patient/create_order the seeded agent lacks) → expect 403, stuck flow.
- [ ] `SMPL-EC-7` Manual agent assignment is **unvalidated** (accepts any GUID, inactive/foreign-branch agent, completed appointment) — document actual behavior.
- [ ] `SMPL-EC-8` Weighted balancing: weight-2 agent gets ~2× load; completed visits don't count.
- [ ] `SMPL-EC-9` Pincode ranges (in/edge/out, "to", en-dash, reversed, whitespace, non-numeric).
- [ ] `SMPL-EC-10` Year-rollover barcodes restart with no collision; width change mid-year → scanners still match.
- [ ] `SMPL-EC-11` **No real re-collection mechanism** — rejected tubes are not re-queued automatically (manual today).

---

### 4.4 Processing & Reports — `RPT`

**Feature.** From "received" to "patient holds a report": tech claims tubes (scan-gated), enters/drafts results with auto-flagging + plausibility bands, pathologist validates/rejects/edits, auto final report on last validation, immutable PDF snapshots, delivery (print/download/WhatsApp/chat), and DOB/phone-verified public report links; amended + partial reports.

| # | Step | Expected result |
|---|---|---|
| RPT-1 | As Technician, open My Work | Intake, My Work, Service Queue; only "received" samples; outsourced tests never appear |
| RPT-2 | Scan a tube to claim from the Service Queue | Claims every free test on the tube (pending → in_progress); wrong barcode refused; no-scan claim only if setting on |
| RPT-3 | Try to claim a tube already owned | "Already claimed by {name}" — claim does not proceed |
| RPT-4 | Enter values, Save draft | "Draft saved"; server persists; plausibility + conditions skipped for drafts |
| RPT-5 | Submit All Results with an implausible value (outside validLow/High) | Blocked with per-parameter message; otherwise all writable tests → entered atomically; critical flags toast |
| RPT-6 | Reopen a submitted tube, tap "Undo submit & edit" | Entered tests → in_progress, values pre-filled, "reopened" audit; a validated tube refuses reopen |
| RPT-7 | As Pathologist, open Pending validation | Branch tests in "entered", oldest-resulted first; tabs all/mine |
| RPT-8 | Validate the last unvalidated test on an order | Test → validated; open threads auto-resolve; final report auto-generated |
| RPT-9 | Reject with a required reason | Test → re_entry; tech push-notified; reason mirrored as correction thread |
| RPT-10 | Validate an order while the Reports tab is closed, then open Reports; view Completed/Partial/Delivered/Failed filters | Orders validated while Reports was closed appear under Completed on open (self-healing backfill); superseded reports hidden; delivered >30 days drop off |
| RPT-11 | Generate a partial PDF (some depts validated) | Preliminary report of validated tubes only; older partials superseded; "PRELIMINARY" banner |
| RPT-12 | Download / View / WhatsApp / Print a report | PDF renders client-side + archives; WhatsApp opens wa.me with public verify link; recording delivery → report delivered, order terminal `delivered` |
| RPT-13 | Amend a released final | New final "AMENDED — supersedes…" + reason; old final + live partials superseded; amend without reason fails |
| RPT-14 | Open public report link, verify DOB/phone | Wrong 5× → exponential lockout; correct → masked name + 1-hour PDF URL; token >30 days = non-existent |
| RPT-15 | Open the analytics dashboard (Reports module) after completing E2E-1 on §3.6 seeded data | Dashboard loads; order counts / revenue / TAT figures match the known orders created (e.g. today's order count equals the orders you raised); under strict isolation the figures are branch-scoped |

**Business-rule assertions**
- [ ] `RPT-BR-1` Per-test state machine enforced (entering on validated/entered/rejected refused; validating/rejecting anything not "entered" refused).
- [ ] `RPT-BR-2` Outsourced tests: entry + validation refused server-side; report stamps "Tested at: {lab}".
- [ ] `RPT-BR-3` Flagging: critical (C) beats reference range (L/H); qualitative mismatch → A; one-sided ranges render `< max` / `> min`.
- [ ] `RPT-BR-4` Plausibility blocks real submits only; drafts exempt; parameters without a band never block.
- [ ] `RPT-BR-5` Final report refused while any non-rejected, non-outsourced test is unvalidated; partial requires a fully-validated tube.
- [ ] `RPT-BR-6` If "Require bill before collection" is on, report generation blocked while balance outstanding.
- [ ] `RPT-BR-7` Report snapshots freeze demographics/flags/ranges/units — later config changes must not alter an existing report.

**Edge-case checklist**
- [ ] `RPT-EC-1` **Draft-overwrites-submitted**: the single-test draft endpoint does not skip "entered" tests (overwrites in place); bulk draft skips them — test both.
- [ ] `RPT-EC-2` **Boundary mismatch**: validator screen uses `<=`/`>=` and first range only; backend uses `<`/`>` and resolves by patient — a value exactly at criticalHigh, or a sex-segmented range, can flag differently on screen vs PDF.
- [ ] `RPT-EC-3` Two techs racing on one tube; two pathologists validating same test (second fails cleanly).
- [ ] `RPT-EC-4` Duplicate live finals: manual Generate twice on a fully-validated order → two non-superseded finals.
- [ ] `RPT-EC-5` Public verify brute force → lockout (in-memory, per-process — resets on restart); phone match uses last-10-digits.
- [ ] `RPT-EC-6` Storage off → 503 on archive; public page still renders from snapshot.
- [ ] `RPT-EC-7` WhatsApp "delivery" marks delivered even if the message is never sent; deliver has no supersede guard.
- [ ] `RPT-EC-8` Validator "Edit" is broken for the seeded Pathologist role (calls enter_result it lacks → 403).
- [ ] `RPT-EC-9` Smuggle a foreign OrderTestId into a bulk submit → silently dropped.

---

### 4.5 Billing — `BIL`

**Feature.** Turns an order into a GST-compliant invoice, collects payment (UPI/card/cash/wallet/split/pay-later + advance) and refunds as ledger rows, derives paid/balance/status, enforces permission-tiered discounts, and provides day-end reconciliation. Encounter/converged billing is WIP-branch only, not mainline.

| # | Step | Expected result |
|---|---|---|
| BIL-1 | Front-desk order + inline payment: enter discount within cap, pick mode, Confirm | Order → bill (discount baked in) → payment(s); toast; order `billed`; bill paid/partially_paid/pending |
| BIL-2 | Enter a discount above your tier cap | Inline error; Confirm blocked (server rejects, not clamps) |
| BIL-3 | Open the standalone billing screen for an already-billed order | Same invoice number returned (no second bill); shows invoice, barcode, tracking QR, HSN/SAC lines, totals |
| BIL-4 | Cash mode: enter amount received | Shows change / "Short by"; Confirm disabled until received ≥ due |
| BIL-5 | Wallet mode: pick a vendor with insufficient balance | Confirm blocked; a failed charge leaves the bill unpaid |
| BIL-6 | Confirm payment | Discount saved first, then payment; button locks ("Payment received"); Print/WhatsApp/Done dialog |
| BIL-7 | Separate-counter mode: save order | Invoice generated immediately; order `billed`, bill `pending` ("send to billing counter") |
| BIL-8 | Billing Counter: find order by search/lookup/QR-scan | All resolve tenant-scoped; unknown/foreign code → "No order matches that code" |
| BIL-9 | Pay-later order, then settle from the Money pane | Balances-due lists the bill; collect the remainder → bill `paid` |
| BIL-10 | Modify a billed order (remove a test) | Bill rebuilds (invoice/discount/payments preserved); overpaid → amber "record a refund" block |
| BIL-11 | Record a refund without `process_refund` | Rejected; with it → refund recorded, balance settled |
| BIL-12 | Cancel a paid order | Full paid amount refunds first; bill `refunded` |
| BIL-13 | Day-end summary; change date | Per-mode payment + refund rows, Collected/Refunded/Net totals, branch-scoped (UTC window) |
| BIL-14 | Admin → Billing: toggle GST master off, save | New/rebuilt bills compute zero tax and become Bill of Supply |
| BIL-15 | Split payment: settle a single bill across two modes (e.g. ₹600 cash + ₹400 UPI) | One payment ledger row per mode; paid = sum of both; bill `paid`; day-end summary shows each mode's share separately |
| BIL-16 | Record an advance at order time, then settle the remaining balance later from the Money pane | Advance recorded as a payment against the bill (balance = total − advance, bill `partially_paid`); final settlement flips it to `paid`; cancelling before settlement refunds the advance via the normal refund path |

**Business-rule assertions**
- [ ] `BIL-BR-1` One bill per order (idempotent re-post returns the existing bill).
- [ ] `BIL-BR-2` GST math per line: intrastate = CGST=SGST=slab/2; interstate = IGST=slab; rounded 2dp per line. (Patient state hardcoded "TN" — only a non-TN branch GSTIN yields IGST.)
- [ ] `BIL-BR-3` Discount caps: Override% if `override_discount`, else Max% if `give_discount`, else 0; over-cap rejected not clamped.
- [ ] `BIL-BR-4` Invoice number allocated in a serializable transaction (`{prefix}-{6-digit counter}`), immutable, unique per (branch, number).
- [ ] `BIL-BR-5` paid = Σpayments − Σrefunds from DB aggregates; status derived; optimistic concurrency on bills.
- [ ] `BIL-BR-6` Refund amount must be > 0; **payment amounts are not server-validated**.

**Edge-case checklist**
- [ ] `BIL-EC-1` **Discount not reflected (suspected defect)**: standalone screen stores an override discount but posts the full pre-discount total — verify recorded payment is 900 vs 1000 on a ₹1000 bill with ₹100 off.
- [ ] `BIL-EC-2` **Settling a partial balance (suspected defect)**: screen shows remainder but Confirm posts full total → over-collection / phantom refund-owed.
- [ ] `BIL-EC-3` Pay-later + discount, no advance → discount silently dropped.
- [ ] `BIL-EC-4` Even discount split clamping (₹100+₹1000 with ₹300 off → ₹50 evaporates).
- [ ] `BIL-EC-5` Invoice counter rewind via stale config form → collision with unique index (hard 500).
- [ ] `BIL-EC-6` Duplicate bills under concurrent create-bill (no unique constraint on order).
- [ ] `BIL-EC-7` POST payment of 0 / negative / over-balance directly → all accepted; refund > paid accepted.
- [ ] `BIL-EC-8` UPI QR is a placeholder (`prefrontal@upi`, external image service) — offline/broken image; patient would pay wrong payee.
- [ ] `BIL-EC-9` UPI VPA lost on config update (only first save persists it).
- [ ] `BIL-EC-10` Reconcile day boundary is UTC (post-05:30pm IST lands in next day).
- [ ] `BIL-EC-11` Refund permission bypass: refund as Receptionist/Billing Counter → blocked; billing config POST as Branch Manager → 403.

---

### 4.6 Inventory — `INV`

**Feature.** Per-tenant consumables, per-branch batches, append-only ledger, FEFO auto-deduction at collection, order-time stock gating, low-stock/near-expiry alerts, Code128/GS1-128 scanning. Gated by both the tenant `inventory` module and a per-branch enable toggle.

| # | Step | Expected result |
|---|---|---|
| INV-1 | Enable Inventory for a branch (manage_lab_settings) | Toast; Stores nav appears immediately (no reload); OFF removes it and stops gating/deduction |
| INV-2 | Create an item (SKU* + Name*) | "Item saved"; 0 on hand; barcode auto-generated (ITM+10 hex) |
| INV-3 | Create a second item with the same SKU | Rejected (duplicate SKU per tenant; admin UI shows only generic "Save failed") |
| INV-4 | Receive stock (Qty 10) | On-hand +10; new batch under Batches (FEFO); LOT barcode shown; +10 receipt ledger row |
| INV-5 | Scan a GS1-128 supplier barcode on the Stores Receive tab | Parses GTIN/lot/expiry/qty; item resolves; form pre-filled |
| INV-6 | Scan an unknown code | Warning "No item… pick it below"; item picker stays |
| INV-7 | Issue more than available non-expired stock | Error naming shortfall; nothing deducted |
| INV-8 | Issue a valid qty | FEFO from earliest-expiring non-expired batch; one −consumption row per batch |
| INV-9 | Issue with only expired batches in stock | Blocked even though the table shows on-hand > 0 (expired counts in display, never in availability) |
| INV-10 | Cycle count different from system | "Adjusted by ±N"; batch set to counted; "count" variance ledger row; matching count writes nothing |
| INV-11 | Save per-test consumables (BOM) | Fully replaces prior BOM; lines with no item/qty≤0 dropped |
| INV-12 | With branch inventory ON, order a test whose BOM exceeds stock | Order fails "Out of stock, cannot order these tests: …(need X, have Y)" (demand summed across tests) |
| INV-13 | Stock up, order, then collect the sample | Collection succeeds; each BOM item FEFO-deducted; consumption rows carry order + sample id |

**Business-rule assertions**
- [ ] `INV-BR-1` SKU + Name required, SKU unique per tenant; item barcode unique per tenant.
- [ ] `INV-BR-2` Category coerced to "consumable" if invalid; near-expiry days ≤0 coerced to 30; reorder level + unit cost **not validated** (negatives accepted).
- [ ] `INV-BR-3` FEFO everywhere: dated batches (earliest first) then undated (oldest received date first); expired never drawn.
- [ ] `INV-BR-4` Low stock = on-hand ≤ reorder level (inclusive); near-expiry = expiry ≤ now + NearExpiryDays per batch with qty>0.
- [ ] `INV-BR-5` On-hand in lists sums ALL batches incl. expired; availability excludes expired — assert both.
- [ ] `INV-BR-6` Auto-consumption at collection is best-effort: never blocks collection; shortfall ledgered with null batch id.
- [ ] `INV-BR-7` Module OFF → 403 all endpoints; module ON + branch OFF → Stores hidden but /admin/inventory + API still work.

**Edge-case checklist**
- [ ] `INV-EC-1` **Cross-branch scoping holes**: adjust/count look up a batch by tenant only (not active branch); ledger is tenant-wide — a branch-A user can adjust/count/see branch-B data. Flag.
- [ ] `INV-EC-2` **BOM referential integrity**: saving a BOM does not validate item/test ids belong to the tenant — a foreign GUID is accepted and can permanently block ordering.
- [ ] `INV-EC-3` **No concurrency protection** — two simultaneous issues of the last units can both succeed (negative-ish deduction).
- [ ] `INV-EC-4` Uncollect/reject does **not** restock; re-collect deducts again (double consumption).
- [ ] `INV-EC-5` "Link the barcode" promise on unknown scan is not implemented (next identical scan fails again).
- [ ] `INV-EC-6` Validation errors return HTTP 200 success=false; admin page hides specific server messages.
- [ ] `INV-EC-7` Scanner robustness: 1–2 char bursts rejected; HID burst captured off-focus; slow typing (>400ms gaps) not accumulated.
- [ ] `INV-EC-8` Four-way matrix (module × branch toggle) all behave per spec.
- [ ] `INV-EC-9` `inventory_transfer` is a stub — no transfer endpoint/UI exists.

---

### 4.7 Referrals & Outsourcing — `REF`

**Feature.** Subcontract individual tests to external referral labs (own barcoded vial per referral-lab+dept, excluded from in-house queues, "Tested at: {lab}" on reports) and manage the inbound referring network (hospitals + doctors auto-created from order free-text).

| # | Step | Expected result |
|---|---|---|
| REF-1 | Create a referral lab (Name required; departments-handled chips) | Appears with code/contact/dept tags; blank name → Create disabled + server rejects |
| REF-2 | Deactivate / reactivate a referral lab | Soft delete only ("inactive" chip); existing tests/orders keep resolving the name |
| REF-3 | Mark an individual test outsourced (vendor + dept-at-vendor) | Violet "outsourced" chip; setting back to in-house clears both fields |
| REF-4 | Try to outsource a package | UI only outsources individual tests (packages always send "clear outsource") |
| REF-5 | Order 1 in-house (BIO) + 1 outsourced (MICRO) test | Two vials: in-house BIO, outsourced MICRO@lab; outsourced vial carries the referral lab id |
| REF-6 | Label + collection screens | Outsourced vial badged "⇗ {lab}" (falls back to "OUTSOURCED"); collection chip has pink outline |
| REF-7 | Receive samples; open in-house queues | Outsourced test never in Service Queue/My Work/validation |
| REF-8 | Try to enter/validate the outsourced test via API | Rejected ("outsourced — results received from them" / "signed by the referral lab") |
| REF-9 | Validate in-house tests, generate FINAL report | Report generates despite the outsourced test having no result; panel shows "Tested at: {lab}", blank values |
| REF-10 | Create a referring hospital + doctor (Admin → Referring network) | Doctor bound to a tenant-owned hospital; picking a foreign hospital → "Hospital not in your tenant". **Note: writes require `manage_admin` which no seeded role holds → expect 403 for everyone** |
| REF-11 | On New Order, type a brand-new hospital + doctor and create | Free-text stored; master records auto-created (case-insensitive dedupe) |

**Business-rule assertions**
- [ ] `REF-BR-1` Referral lab Name required; no uniqueness on name/code; delete always soft; labs are tenant-level (not branch-scoped).
- [ ] `REF-BR-2` Effective outsourced dept = dept-at-vendor if set else the test's own; a test with neither is refused at order create.
- [ ] `REF-BR-3` Outsourced tests excluded from result-entry, validation, and TAT-breach sweeps.
- [ ] `REF-BR-4` Final-report completeness gate counts only in-house tests; outsourced + rejected exempt.
- [ ] `REF-BR-5` Doctor commission columns exist but nothing reads/writes them — no commission ever appears.

**Edge-case checklist**
- [ ] `REF-EC-1` **Systemic**: an order with any outsourced test never reaches "validated/completed" (no result-receipt path) — verify dashboards/TAT tolerate permanently-open orders.
- [ ] `REF-EC-2` Cross-tenant IDOR: test save does not validate OutsourcedVendorId/DepartmentId — a foreign/random GUID is accepted.
- [ ] `REF-EC-3` **Hospital-less doctor tenant leak**: the doctor list includes ALL hospital-less doctors regardless of tenant; update/deactivate accept any such doctor — Tenant B can edit Tenant A's orphan doctor. High-priority isolation test.
- [ ] `REF-EC-4` Referring-network writes 403 for everyone (`manage_admin` unseeded) — verify and file.
- [ ] `REF-EC-5` Deactivated referral lab still referenced by tests → new orders keep creating vials for it with no warning.
- [ ] `REF-EC-6` Order with ONLY outsourced tests — verify collection/dispatch/billing/report behavior.

---

### 4.8 Chat, Calls & Notifications — `CHAT`

**Feature.** Real-time staff messaging (1:1; named groups with name ≤160 chars, at least one other member, and **no server-enforced member cap**; notes-to-self conversations; record-anchored threads), WebRTC audio calls (1:1 and group up to 5) with TURN fallback and duration caps, device push (APNs/FCM + VoIP CallKit), an in-app notification bell, and @mentions that override mute. Fully tenant-isolated; gated by the `messages` module.

| # | Step | Expected result |
|---|---|---|
| CHAT-1 | Open Messages, start a 1:1, send a message | Optimistic bubble reconciles; conversation jumps to top for both; permission asked once |
| CHAT-2 | Recipient has app closed on phone | Device push with sender + ≤140-char preview; tap opens the app |
| CHAT-3 | Recipient opens the thread | Their unread clears; sender sees "Seen"; typing indicator auto-clears ~3s |
| CHAT-4 | Create a group (name ≤160 chars, at least one other member); add/remove members | Real-time for all; system messages "X added/removed Y"; non-creator can only Leave (member-count upper bound covered by CHAT-16) |
| CHAT-5 | Reply / Edit / Delete / Pin / React / Forward | Reply quote frozen; edit only own; delete = in-place placeholder; pin strip live (≤20); reaction toggles; forward carries no reactions |
| CHAT-6 | Attach a 16MB file or .docx/.exe | Rejected; ≤15MB png/jpg/webp/gif/pdf/audio allowed; caption-less allowed |
| CHAT-7 | Mute a conversation, then get @mentioned in it | Ping + notification override mute for the mentioned user only; unread still increments |
| CHAT-8 | Share a patient/report into chat | Card bubble deep-links the record; a record-anchored thread is created separate from the general 1:1 |
| CHAT-9 | Start a 1:1 call; callee accepts on one device | Two-way audio; ring dismisses on callee's other devices; presence → in-a-call; quality dot shows TURN use |
| CHAT-10 | Callee declines / nobody answers | "Call declined" / auto-cancel 60s / callee ring dismiss 90s; "📞 …" line lands in the thread |
| CHAT-11 | Long 1:1 call | "Call ends in 60 seconds" toast at T-60; hard end at 10 min |
| CHAT-12 | Group call: members join; a 5th tries | Meshed pairwise; 5th rejected "Call is full (max 5)"; cap 30 min once ever ≥3 (never shrinks) |
| CHAT-13 | Trigger a business event: receive a tube at lab intake so tests auto-assign to a tech (per SMPL-9), then enter and submit a result beyond the critical band (per RPT-5) | Bell badge increments; a row appears for each event; device push routes to the right screen |
| CHAT-14 | Admin → Notifications config: disable an event type | Neither bell row nor push produced for that event |
| CHAT-15 | Set presence DND / "in surgery" | Calling that user refused immediately; chat pushes suppressed (bell still accumulates) |
| CHAT-16 | Create a group with a very large member list (add every active user in the tenant — 50+ where available) | Creation succeeds (no member cap is enforced server-side — confirm and document); messaging, read receipts and push fan-out still work; log any latency/failure as a finding |
| CHAT-17 | Create a notes-to-self conversation and send a message | Thread appears only in your own conversation list (never in any other user's); no push or bell notification is generated to yourself; messages persist across sessions |

**Business-rule assertions**
- [ ] `CHAT-BR-1` Message body ≤4000 (silently truncated); empty rejected unless attachment present.
- [ ] `CHAT-BR-2` Mentions = `@<guid>` matching active participants only; override mute for them.
- [ ] `CHAT-BR-3` Delete is soft (row kept, body/attachment blanked); reactions one row per (message,user,emoji).
- [ ] `CHAT-BR-4` Group create requires all members active in caller's tenant; 1:1 dedupes on the two participants; context threads dedupe on (pair+type+id).
- [ ] `CHAT-BR-5` Max 5 per call; one active session per user; ring reaper sweeps at 30s; disconnect grace 30s.
- [ ] `CHAT-BR-6` Terminal **1:1 only** calls write a summary message (never group); duration on answered calls.
- [ ] `CHAT-BR-7` Device registration upsert per (user, platform); logout deletes all device rows; chat push preview ≤140 chars, attachment-only → "📎 Attachment".

**Edge-case checklist**
- [ ] `CHAT-EC-1` Tenant isolation probes on every hub/REST endpoint (foreign conversation/patient/report/user id) → 403/404/HubException.
- [ ] `CHAT-EC-2` **Realtime hubs are NOT module-gated** — verify whether a crafted SignalR client of a messages-disabled tenant can still SendMessage/StartCall (known gap).
- [ ] `CHAT-EC-3` Removed member stops receiving messages/typing/reads and calls.
- [ ] `CHAT-EC-4` Optimistic-send races, offline send ("failed"), reconnect → no duplicates.
- [ ] `CHAT-EC-5` Multi-device echo + accept-on-one-dismisses-others + mute sync.
- [ ] `CHAT-EC-6` Reconnect <30s mid-call → call survives; >30s → ends.
- [ ] `CHAT-EC-7` Beacon abuse on the unauthenticated cleanup endpoint → rate limiter holds.
- [ ] `CHAT-EC-8` **PARKED**: locking the iPhone during a connected call still drops the WebRTC call — expected-fail.
- [ ] `CHAT-EC-9` Push deep-links dead-end (the open-conversation and accept-call deep-link parameters carried by pushes are not consumed on launch); web push not implemented.

---

### 4.9 Process Workflow — `FLOW`

**Feature.** A drag-and-drop builder where a Lab Admin composes work-area lanes (the live nav) from operational actions. One active workflow per scope (tenant-default or per-branch) drives navigation, route guards, and the backend order lifecycle (removing collection makes orders land "received"; removing dispatch/intake makes collection auto-receive). Lost & Found rescues tubes stranded at a disabled stage.

| # | Step | Expected result |
|---|---|---|
| FLOW-1 | Open Process builder (manage_workflows); drag Billing palette↔lane; Save | "Unsaved changes" badge; on Save active workflow re-renders nav immediately |
| FLOW-2 | Toggle "Queue" off, Save, reload | Queue nav gone; deep-link to `/frontdesk/queue` redirects to `/` (route guard, not just hidden) |
| FLOW-3 | Try to drag Register Patient / New Order out of Frontdesk | Refused "… is locked to its area" (padlock, no drag grip) |
| FLOW-4 | Try to toggle Register Patient off / delete a lane holding locked actions | Toggle disabled "Required — always on"; lane delete blocked |
| FLOW-5 | Toggle Sample Collection off | Dispatch + Lab Intake cascade off; result entry/validate/results stay on |
| FLOW-6 | Toggle Dispatch back on | Sample Collection + Lab Intake return; missing prereq → "Also needs … add it" |
| FLOW-7 | Pick a branch scope with no workflow, edit, Save | Draft cloned from tenant default; first in scope → auto-active |
| FLOW-8 | Duplicate, edit, Set active | Previous active in the SAME scope deactivates; nav updates; can't delete the active one |
| FLOW-9 | Role-gate a lane; log in as an excluded user | Lane hidden from nav; but a permission-holding user can still deep-link the inner screen (area roles gate nav only) |
| FLOW-10 | Collection-less lab: create an order | Every tube born "received"; order shows received_in_lab; result entry unblocked |
| FLOW-11 | Disable a stage mid-flight, open Lost & Found | Stranded tubes grouped by stage; send-to-lab flips to received; re-enable → nothing stranded |

**Business-rule assertions**
- [ ] `FLOW-BR-1` Exactly one active workflow per scope; first-in-scope auto-activated; resolution = branch-active → tenant-default → null (fail-open to hard-coded nav).
- [ ] `FLOW-BR-2` `patient_registration` mandatory (server rejects a config missing/disabling it).
- [ ] `FLOW-BR-3` Prerequisites: billing→registration; dispatch→collection; validate→result_entry; results→validate. dispatch⇄lab_intake share state. `sample_collection` is the only repeatable action.
- [ ] `FLOW-BR-4` Derived modes synced to branch lab config on save/activate (separate billing counter, dedicated collection counter); tenant-default sync writes EVERY branch.

**Edge-case checklist**
- [ ] `FLOW-EC-1` **Frontend/backend enabled-default mismatch**: absent `sample_collection` → frontend treats enabled (screen reachable), backend treats disabled (tubes born received) — test absent vs explicitly-disabled.
- [ ] `FLOW-EC-2` Shared-route trap: Dispatch's route is the Queue screen guarded by the `queue` action → disable Queue + keep Dispatch = dead tile.
- [ ] `FLOW-EC-3` A tenant-default workflow save overwrites each branch's derived billing/collection modes, clobbering a branch's own synced modes until that branch's workflow is re-saved.
- [ ] `FLOW-EC-4` Garbage config accepted: unparsable JSON / no `actions` property returns OK; empty `actions` array rejected (mandatory registration). Test all three via API.
- [ ] `FLOW-EC-5` Stale nav for other sessions (config cached per session until reload).
- [ ] `FLOW-EC-6` No optimistic concurrency on update (last write wins); PUT ignores BranchId (no re-scoping).
- [ ] `FLOW-EC-7` Cross-tenant workflow id → not_found; Create with a foreign branch id is accepted but never matches a real user.
- [ ] `FLOW-EC-8` The seeder overwrites any workflow still named "Standard flow" on a schema bump — admin customizations under that name lost.

---

### 4.10 Admin Configuration — `ADM`

**Feature.** The tenant admin control panel: test catalog (tests, packages, bulk pricing), users + custom roles/permissions, branches/sub-branches/departments, lab behaviour toggles, patient-ID + sample-barcode formats, billing/GST config, report template, notification channel toggles, and a danger-zone data wipe.

| # | Step | Expected result |
|---|---|---|
| ADM-1 | Reach `/admin` with none of manage_tests/users/workflows/branches | Blocked; typing `/admin` directly → 403 |
| ADM-2 | Create an individual test (Name required; dept/flow/price/tax/TAT/sample type) | Blank name → warning, no request; else "Created"; appears in order-create picker |
| ADM-3 | Create a package (member tests; no dept/sample/outsourcing) | Card shows member count + price; members round-trip on re-edit |
| ADM-4 | Bulk pricing: inline edit + bulk % on filtered rows, Save | Only filtered rows change (2dp, floored at 0); "Updated N prices"; Discard restores |
| ADM-5 | Invite a user (set password now, ≥6 chars) | No email sent; account usable; duplicate auth email → conflict toast |
| ADM-6 | Create a custom role granting a permission you don't hold | Rejected "You can't grant permissions you don't hold yourself" |
| ADM-7 | Edit a pre-seeded role's permissions | Backend rejects "Pre-seeded roles… cannot be modified" (UI copy wrongly implies editable) |
| ADM-8 | Deactivate a user | Chip → Inactive; loses Call/Deactivate; **no reactivate button in UI** |
| ADM-9 | Add a department + set a duplicate 2-digit sample code | Rejected "Code NN is already used by <dept>" |
| ADM-10 | Lab settings: patient-ID format, sample width, toggles, auto-assign | Live preview; each saves with a toast; on API failure the toggle visually reverts |
| ADM-11 | Danger zone → Wipe Patient Data (manage_tenant) | Danger confirm; success toast with cleared counts; config/branches/users/tests survive |
| ADM-12 | Billing config: GST on/off, discounts, invoice prefix, letterhead, save | Saves succeed only for manage_tenant; letterhead saves via its own button |
| ADM-13 | Edit the report template (note the `/admin/reports` route-guard drift edge case below), then generate a fresh final report and re-open a report generated **before** the change | The new report reflects the template change; the pre-existing report is byte-identical to before (snapshot freeze — ties to the RPT snapshot assertion) |
| ADM-14 | Create a new branch, then a sub-branch under it (manage_branches) | Both saved and listed; the branch appears in the branch switcher for tenant-wide users; users can be scoped to it; usable as "Branch B" for §3.6 / E2E-5 |

**Business-rule assertions**
- [ ] `ADM-BR-1` Write asymmetry: billing/GST/patient-ID/notification config reads allowed to manage_tenant/manage_branches, but **writes require manage_tenant only** — a branch manager opens the page yet every save 403s.
- [ ] `ADM-BR-2` Bulk price + tests fetched by id are tenant-scoped; a foreign test/user/role id reads as not found / role_locked.
- [ ] `ADM-BR-3` Branch-lab-config collection/billing modes are writable only when there is no active workflow (else workflow wins, manual writes ignored).
- [ ] `ADM-BR-4` Wipe deletes bills→orders→appts→messages→docs→notifications→patients across ALL branches of the caller's tenant only, in one transaction; echoes before-counts.

**Edge-case checklist**
- [ ] `ADM-EC-1` **Escalation via invite**: the invite endpoint does NOT run the role-escalation guard — a manage_users-only admin can assign the Lab Admin role (with `*`); roleIds not validated as tenant-owned. Priority security test.
- [ ] `ADM-EC-2` Backend accepts unvalidated test payloads (negative price, taxSlab >50, TAT 0, arbitrary flow/type).
- [ ] `ADM-EC-3` Patient-ID invalid date prefix silently becomes ddmmyy.
- [ ] `ADM-EC-4` Deactivated user's live session must actually stop on next request.
- [ ] `ADM-EC-5` **Wipe Patient Data isolation** — run on tenant A while tenant B has data; B untouched. (History of tenant-scoping bugs — re-verify every release.)
- [ ] `ADM-EC-6` Route-guard vs endpoint-permission drift (`/admin/reports` admits manage_tenant|manage_tests but endpoints demand manage_report_template).
- [ ] `ADM-EC-7` No optimistic concurrency anywhere (simultaneous edits last-write-win).

---

### 4.11 Mobile App — `MOB`

**Feature.** Phone-first iOS/Android build of the same screens with a floating bottom-nav pill (phone), left icon rail (tablet), native back chevron + edge-swipe, keyboard-aware chrome, safe-area padding, native share, push + CallKit. A strict **isolation invariant**: every phone/native change is additive and scoped, so desktop web + Electron must stay pixel-identical.

| # | Step | Expected result |
|---|---|---|
| MOB-1 | Cold-launch on iPhone | Native splash ~0.6s → in-app loading logo; no white flash under status bar; API host shown on Login (native) |
| MOB-2 | Log in; observe role landing | Same first-match landing as web; temp password → forced Set Password |
| MOB-3 | Kill and relaunch | Still signed in (session restored); expired token silently refreshed; restore stall >4s → boots to Login |
| MOB-4 | Phone bottom pill: tap tabs, drag along the pill, scroll a long page | Gradient indicator springs; drag = glass loupe snaps to nearest; pill shrinks on scroll down, restores up (tablet/desktop never minimize) |
| MOB-5 | Verify pill contents by role/mode | Collect only in dedicated-counter branches; Billing only separate-counter; Inventory only branch-on + plan-on; account button last |
| MOB-6 | iPad (native) at 12.9" | Left rail — never the desktop top-strip; desktop web at same width shows top-strip |
| MOB-7 | Drill into a secondary screen; back chevron / edge-swipe (28px, commit >40%) / Android hardware back | History back; cold-deep-linked screen falls back to root; vertical drag = scroll |
| MOB-8 | Open a chat thread, focus composer | WebView resizes above keyboard; nav hides on focus; returns on dismiss; never stuck hidden after leaving thread |
| MOB-9 | Share a report / invoice on native | System share sheet with the PDF; cancel is silent; web/desktop does a normal download; public link uses the https web origin |
| MOB-10 | Global QR scan | Camera permission prompt; full-screen viewfinder; valid order QR navigates; garbage silently ignored |
| MOB-11 | Push + CallKit: chat push tap, lock-screen inline reply, incoming call with app killed | Push opens the conversation; inline reply delivers (offline → "Message not sent" local notification); CallKit ringer; answer connects audio |
| MOB-12 | Airplane Mode mid-session; attempt a save; restore | Red top banner "No connection…"; save fails (no offline queue); banner clears + hubs reconnect (0/2/5/10/30s) |
| MOB-13 | Boot against an API whose minimum client version is newer | Blocking undismissable "Update required" overlay; an unreachable API must NOT trigger it (fail-open) |

**Business-rule assertions**
- [ ] `MOB-BR-1` Layout bands: ≤640 pill, 641–1279 rail, ≥1280 desktop top-strip (web only); native always keeps the rail.
- [ ] `MOB-BR-2` Native is always treated as touch (even a 1366pt iPad Pro).
- [ ] `MOB-BR-3` Boot waits ≤4s for session restore; concurrent refreshes coalesce into one; iPhone portrait-only, iPad all orientations.
- [ ] `MOB-BR-4` Sign-out must unregister the push token before clearing the session (both sign-out paths).

**Edge-case checklist**
- [ ] `MOB-EC-1` Desktop regression from any mobile change (verify one desktop screen ≥1280px stays byte-identical).
- [ ] `MOB-EC-2` Double safe-area inset / first-paint zero inset (header never under the notch).
- [ ] `MOB-EC-3` Keyboard-stuck-hidden nav; cold deep-link back-stranding; swipe-back vs horizontal scrollers.
- [ ] `MOB-EC-4` Concurrent 401 burst → one refresh, no logout.
- [ ] `MOB-EC-5` **Phone "Branch" row is a mock** — cycles hardcoded names, does NOT re-scope data (real switch is desktop top-strip). High-confusion.
- [ ] `MOB-EC-6` **Lock-during-call drops the call** — parked expected-fail.
- [ ] `MOB-EC-7` App version hardcoded "0.1.0"; Notifications popover route may not exist; Android is the less-exercised platform (push/back/keyboard need extra depth).
- [ ] `MOB-EC-8` No OAuth/social login exists (treat any OAuth case as N/A).

---

### 4.12 Admin Control Plane — `CTRL`

**Feature.** The platform-staff console (Google-login only) that provisions tenants, manages the plan catalog + module entitlements, flips branch isolation, suspends/reactivates/deletes tenants, resets tenant-admin passwords, and broadcasts. System of record for canonical tenant identity; fans mutations to the LMS over a service token; audits every mutation.

| # | Step | Expected result |
|---|---|---|
| CTRL-1 | Sign in with Google as an active platform admin | Redirect to dashboard; a non-registered account gets `not_a_platform_admin` 403 on every call |
| CTRL-2 | Provision a tenant (name/admin email/name/phone required; modules; isolation) | Canonical tenant + slug + 14-char temp password; forwarded to LMS; onboarding email sent; auto-redirect to Tenants |
| CTRL-3 | Open the emailed link, log in with temp password | Forced password change; only enabled modules visible in the LMS |
| CTRL-4 | Tenant detail → Change plan / Suspend (reason) / Reactivate | Plan saved; suspend blocks all tenant users at next request; reactivate immediate |
| CTRL-5 | Reset admin password | Green "temporary credentials emailed"; new temp password with forced change; never shown in browser |
| CTRL-6 | Modules card: toggle + Save modules (full replace) | Disabled module disappears from tenant LMS on next load |
| CTRL-7 | Branch isolation card: toggle + Save | ON = staff see own branch only; verify inside LMS with two branch users |
| CTRL-8 | Plans: create (key immutable), edit, delete | Delete does not touch tenants already on it (plan stored as text) |
| CTRL-9 | Broadcast to specific tenants / all (Subject + Body) | One email per recipient (no shared To); "email not configured" if SMTP off |
| CTRL-10 | Audit list | Newest-first mutations with actor/action/target/detail/IP; `take` clamped 1–500 |
| CTRL-11 | Delete a tenant that has never raised an order; then attempt to delete a tenant that has orders | The empty tenant deletes (drops off the tenant list; its users can no longer log in); the tenant with orders is **refused** with a clear error — hard-delete is blocked once operational data exists |

**Business-rule assertions**
- [ ] `CTRL-BR-1` Every call needs a Google JWT matching an active platform-admin row; no token → 401, non-admin → 403.
- [ ] `CTRL-BR-2` **support role is read-only** — every mutation endpoint returns 403 (UI does not hide the buttons; the API 403 is the real gate).
- [ ] `CTRL-BR-3` One org = one canonical tenant id; same name (case-insensitive) reuses it; provisioning idempotent per (tenant, product) → "already onboarded".
- [ ] `CTRL-BR-4` Product link created pending, activated only after LMS confirms; a failed forward stays pending so retry succeeds.
- [ ] `CTRL-BR-5` Module entitlements = fixed 8-key contract; writes are full replaces (missing/non-boolean → false); reads back-compat (null/corrupt → all on).
- [ ] `CTRL-BR-6` Business errors return HTTP 200 `success:false` — assert on the body, not the status.
- [ ] `CTRL-BR-7` Tenant hard-delete refused if the tenant has any orders; delete of an empty tenant succeeds (CTRL-11).

**Edge-case checklist**
- [ ] `CTRL-EC-1` Support-role bypass on every mutation (curl) + admin row flipped inactive mid-session.
- [ ] `CTRL-EC-2` Product service down → "upstream_error"; provision link stays pending; retry completes with no duplicate/dead-end.
- [ ] `CTRL-EC-3` Partial provision: LMS succeeds, email fails → tenant active, no credentials, email-failure audit row; recover via Reset admin password.
- [ ] `CTRL-EC-4` Features full-replace hazard: a partial `{"inventory":true}` silently turns every other module OFF.
- [ ] `CTRL-EC-5` Duplicate/near-duplicate names → distinct slugs; reserved names rejected; symbol-only name slugifies to `org`.
- [ ] `CTRL-EC-6` Plan free-text unvalidated; a plan *name* differing from its key silently falls back to all-on defaults.
- [ ] `CTRL-EC-7` Control-plane vs LMS state can diverge (suspend/plan/delete forwarded but local registry not updated; branch isolation never stored locally).
- [ ] `CTRL-EC-8` Dev bypasses (dev-admin email skips auth; UI guard skipped in dev) must be OFF in deployed environments.

---

## 5. Cross-module end-to-end scenarios — `E2E`

Full journeys spanning modules. Run each on both web and (where noted) the mobile app.

**E2E-1 — Walk-in: register → order → collect → result → validate → report → bill with GST → payment**
| # | Step | Expected result |
|---|---|---|
| E2E-1.1 | Register a walk-in patient | MRN issued (Verhoeff-checked) |
| E2E-1.2 | Create an order (2 depts) with front-desk payment + a within-cap discount | Bill with 18% GST, discount baked in; order `billed` |
| E2E-1.3 | Collect both vials, dispatch, arrive at lab | Tubes received; TAT starts; techs auto-assigned |
| E2E-1.4 | Tech enters results (plausibility passes), submits | Tests → entered; critical flags toast |
| E2E-1.5 | Pathologist validates the last test | Final report auto-generated |
| E2E-1.6 | Deliver the report PDF (WhatsApp/print) | Report delivered; order terminal `delivered` |
| E2E-1.7 | Verify the bill ledger + day-end reconciliation | Payment recorded; per-mode totals correct |

**E2E-2 — Home-collection journey**
| # | Step | Expected result |
|---|---|---|
| E2E-2.1 | Admin adds a home-collection agent (pincode range, weight 2) | Agent covers the range |
| E2E-2.2 | Front desk books a home visit with pre-selected tests in that pincode | Agent auto-assigned (weighted) |
| E2E-2.3 | Agent "Check in & collect" | Order spawned once (idempotent); routed to collection |
| E2E-2.4 | Agent draws tubes, "Complete visit" | Appointment completed; drops off queue |
| E2E-2.5 | Continue through receipt → result → report | Tubes received at lab (SMPL-9); results entered and submitted (RPT-5); validated (RPT-8); final report generated and delivered (RPT-12) — order terminal `delivered` |

*Note: also run the E2E-2.3 check-in as a **pure** seeded Home Collection Agent account — expect the known 403 stuck-flow gap (§4.3 edge cases).*

**E2E-3 — Referral / outsourcing journey**
| # | Step | Expected result |
|---|---|---|
| E2E-3.1 | Mark a test outsourced to a referral lab | Violet chip |
| E2E-3.2 | Order 1 in-house + 1 outsourced test | Two vials; outsourced badged, pink outline |
| E2E-3.3 | Collect, dispatch, receive all | Outsourced test absent from in-house queues |
| E2E-3.4 | Validate the in-house test, generate FINAL report | Report releases; outsourced panel "Tested at: {lab}", blank values |
| E2E-3.5 | Check the order status + dashboards | Order never reaches "validated/completed" (document permanently-open) |

**E2E-4 — Entitlement-toggle journey**
| # | Step | Expected result |
|---|---|---|
| E2E-4.1 | Control plane: disable Inventory for the tenant, Save | Full-replace persisted + forwarded |
| E2E-4.2 | In the LMS, reload | Stores nav gone; deep link redirects; API 403 `module_disabled` |
| E2E-4.3 | Attempt an inventory API call directly | 403 regardless of permission |
| E2E-4.4 | Re-enable Inventory | Nav + routes return after reload |
| E2E-4.5 | Disable Messages, reload | No chat/call/people/presence; hubs must not connect (verify via logs) |
| E2E-4.6 | Disable Reports, reload | Analytics dashboard gone from nav and its API 403s (`module_disabled`); the per-order report pipeline (RPT-11/12) keeps working |

**E2E-5 — Multi-branch isolation journey**
| # | Step | Expected result |
|---|---|---|
| E2E-5.1 | Control plane: set Branch isolation ON | Strict mode |
| E2E-5.2 | Create an order in Branch A | Stamped Branch A |
| E2E-5.3 | Switch to Branch B (created in §3.6 / ADM-14); open lists + scan the A order's QR + report-by-order | Order absent from lists and unreachable by id/barcode/report (fallback to home) |
| E2E-5.4 | Verify patient search still finds the patient tenant-wide | Search crosses branches; the history pane is branch-scoped |
| E2E-5.5 | Set isolation OFF; repeat E2E-5.3 | The A order is now visible cross-branch (central-lab model) |

**E2E-6 — Chat / call / notification journey (incl. lock-screen ring)**
| # | Step | Expected result |
|---|---|---|
| E2E-6.1 | User A shares a report into chat with User B | Card bubble; record-anchored thread created |
| E2E-6.2 | B mutes the thread; A @mentions B | B gets the ping/notification despite mute |
| E2E-6.3 | A calls B (1:1); B's iPhone is killed/locked | Native CallKit lock-screen ringer (VoIP push) |
| E2E-6.4 | B answers from the lock screen | App launches in background; audio connects |
| E2E-6.5 | B locks the phone mid-call | **Known parked defect** — call drops (expected-fail) |
| E2E-6.6 | Flag a critical value for a tech | Bell badge + push routing to Lab worklist |

**E2E-7 — Separate-counter billing + pay-later journey**
| # | Step | Expected result |
|---|---|---|
| E2E-7.1 | Configure billing mode = separate counter (via workflow) | Billing Counter nav appears |
| E2E-7.2 | Receptionist saves a pay-later order | Invoice generated; order `billed`, bill `pending` |
| E2E-7.3 | Sample collection proceeds unpaid | Collection not payment-gated |
| E2E-7.4 | Billing Counter finds the order (search/QR) and collects the balance | Bill → paid |
| E2E-7.5 | Verify report release if "require bill before collection" is on | Report blocked until balance clears |

---

## 6. Security & isolation test matrix — `SEC`

Run every row against the **API directly** (Postman/curl), not just the UI.

| # | Attack | Target | Expected |
|---|---|---|---|
| SEC-1 | Tenant IDOR: foreign-tenant user/order/bill/sample/report/test/department id on any by-id endpoint | All modules | "Not found" — never success, never data |
| SEC-2 | Order create with another tenant's patient id | Orders | Rejected (priority probe — creation may not be tenant-guarded) |
| SEC-3 | Foreign branch GUID in X-Active-Branch | All | Silently ignored; request proceeds on default branch; no foreign-branch data leaks |
| SEC-4 | Strict isolation: reach a Branch A order from Branch B (list/id/barcode/report) | Branch isolation | Blocked; shared mode → visible |
| SEC-5 | Temp-password bypass: operational APIs with a must-change token | Auth | 403 `must_change_password` everywhere except auth endpoints |
| SEC-6 | Module-disabled API access (Inventory/Messages/HomeCollection) | Entitlements | 403 `module_disabled` regardless of permission |
| SEC-7 | Realtime hub of a messages-disabled tenant: SendMessage/StartCall | Chat | Verify whether hubs enforce the module (known gap — likely not) |
| SEC-8 | Role bypass: Receptionist calls cancel/modify; refund as non-`process_refund`; billing config POST as branch manager | Various | 403 |
| SEC-9 | **Invite escalation**: manage_users-only admin assigns the Lab Admin role; unvalidated roleIds | Admin | Currently succeeds — priority finding |
| SEC-10 | Edit a pre-seeded (shared) role | Admin | Rejected `role_locked` |
| SEC-11 | Hospital-less doctor: Tenant B reads/edits/deactivates Tenant A's orphan doctor | Referrals | Currently leaks — priority isolation finding |
| SEC-12 | Cross-branch inventory: Branch A user adjusts/counts a Branch B batch; ledger tenant-wide | Inventory | Currently allowed — flag |
| SEC-13 | Control-plane mutation with a support-role token / tenant user JWT | Control plane | 403; tenant JWT must never reach the service-token API |
| SEC-14 | Public report token: brute-force verify, expired (>30 day) token, foreign token | Reports | Lockout after 5; expired = non-existent (no oracle) |
| SEC-15 | Overwrite a report's stored PDF cross-tenant | Reports | Cross-tenant report ids rejected; 25MB limit holds |
| SEC-16 | Wipe Patient Data on tenant A while tenant B has data | Admin | B untouched (re-verify every release) |
| SEC-17 | Concurrent token-refresh burst | Auth | Exactly one refresh; no forced logout |
| SEC-18 | Call cleanup beacon with random/guessed session ids | Chat | Rate limiter holds |

---

## 7. Mobile-specific test pass (on-device) — `ODV`

Run on a physical iPhone, a physical iPad, and a physical Android device.

- [ ] `ODV-1` Cold-launch: native splash → loading logo, no white flash, header never under the notch (repeat 5×; the gap must be identical each launch).
- [ ] `ODV-2` Login shows the configured API host (native) and it names the production backend.
- [ ] `ODV-3` Session survives kill/relaunch; expired token silently refreshes; restore stall >4s boots to Login.
- [ ] `ODV-4` Phone pill: spring indicator, drag-loupe snap, shrink-on-scroll; tablet rail and desktop never minimize.
- [ ] `ODV-5` iPad at 12.9" shows the rail, never the desktop top-strip; rotate (iPad only; iPhone is portrait-only).
- [ ] `ODV-6` Back chevron on secondary screens only; edge-swipe commits >40%, vertical drag = scroll; Android hardware back = one history step, exits at root.
- [ ] `ODV-7` Chat thread closes via chevron/swipe/Android back rather than leaving Messages.
- [ ] `ODV-8` Keyboard: composer above keyboard, nav hides on focus, returns on dismiss, never stuck hidden; 16px inputs (no iOS zoom); rotate with keyboard up.
- [ ] `ODV-9` Native share sheet for report + invoice PDFs; cancel silent; public link uses https web origin.
- [ ] `ODV-10` QR scan: rear camera, full-screen viewfinder, valid navigates, garbage silently ignored (log as UX debt).
- [ ] `ODV-11` Push: permission prompt; token registers post-login (airplane-at-boot then reconnect); foreground banner + toast; background tap opens conversation.
- [ ] `ODV-12` iOS lock-screen inline reply delivers (offline → "Message not sent" fallback).
- [ ] `ODV-13` iOS CallKit ringer with app killed/locked; answer connects audio (retry through reconnect); red button ends both.
- [ ] `ODV-14` Android pushes display with sound/vibration post-first-run; call pushes fall back to notifications (no CallKit).
- [ ] `ODV-15` Presence DND / "in surgery" blocks incoming calls and silences pushes.
- [ ] `ODV-16` Sign-out unregisters the push token (device stops receiving pushes).
- [ ] `ODV-17` Offline banner pins to top without shifting layout; no write pretends success; connectivity flapping does not stack duplicate chat handlers.
- [ ] `ODV-18` Idle >5 min then foreground → permissions re-fetch (revocation takes effect).
- [ ] `ODV-19` Version gate: undismissable overlay when API minimum is newer; unreachable API fails open.
- [ ] `ODV-20` **Phone Branch row is a mock** — confirm it does not re-scope data (known gap).
- [ ] `ODV-21` **Lock mid-call drops the call** — expected-fail, log only.
- [ ] `ODV-22` Restricted storage (private mode analog): login still works, session just won't persist.
- [ ] `ODV-23` Desktop isolation: after any mobile change, one desktop web screen (≥1280px) stays byte-identical.

---

## 8. Known issues & parked items

Honest list carried from the subsystem briefs. These are **expected behaviors today** — do not file as new bugs unless behavior differs from what is described.

| Area | Issue |
|---|---|
| Mobile calls | **PARKED**: locking the iPhone during a connected call drops the WebRTC call (WKWebView freezes the web process ~27s after lock). Native-audio fix deferred. |
| Mobile nav | Phone account-popover "Branch" row is UI-only — it does not re-scope data. |
| Mobile | App version hardcoded "0.1.0"; Notifications popover route may not exist; failed QR scans give no feedback; no offline queue; no OAuth/social login. |
| Chat | Realtime hubs are not module-gated; push deep-link parameters (open-conversation / accept-call) are not consumed; web push not implemented; HTTP inline-reply skips mentions/replies/attachments; group call-log rows show no name/call-back; live call/presence state is in-memory (lost on restart). |
| Reports | No correction path after full validation; validator "Edit" 403s for the seeded Pathologist; `reject_result` permission is dead; critical notification goes to the entering tech (not the referring doctor); WhatsApp is a wa.me stand-in; client-computed flags ignore age/sex segments; partial-report cards cover today's orders only. |
| Billing | Standalone-screen discount not reflected in server totals; settling a partial balance over-collects; pay-later discount dropped; UPI QR is a hardcoded placeholder payee; UPI VPA lost on config update; payment amounts unvalidated server-side; encounter/converged billing is WIP-branch only. |
| Samples | No real re-collection mechanism (rejected tubes not re-queued); seeded Home Collection Agent can't check in; manual agent assignment unvalidated; no agent live tracking; branch sample-config entity is vestigial. |
| Inventory | `inventory_transfer` is a stub; no ledger UI; unknown-scan "link the barcode" not implemented; no restock on uncollect/reject; no concurrency protection; adjust/count/ledger are tenant-scoped not branch-scoped; BOM save accepts unvalidated ids; weak input validation; generic admin error toasts. |
| Referrals | Receiving results from referral labs is not built (orders never complete); no send-out/dispatch tracking; commissions dormant; `manage_admin` unseeded (referring-network writes 403 for everyone); hospital-less doctor tenant-isolation hole; no warning when deactivating a referenced lab. |
| Patients/Orders | No server-side demographic validation; order create doesn't verify patient ownership; priority value inconsistency; patient documents endpoints ungated; cancel has no stage guard; order history is a fragile JSON blob; wipe-patient-data endpoint is destructive with a single confirm. |
| Auth/Admin | Login throttle is per-process/in-memory (no IP throttle); UI module gating is fail-open; duplicated role-landing/admin-permission constants must stay in sync; invite breaks the tenant contract (no synthetic email, admin-set password doesn't force change); no reactivate/edit-scope/resend-invite UI; pre-seeded role UI/backend mismatch; no optimistic concurrency in admin-config. |
| Workflow | Frontend/backend enabled-default mismatch; dead Dispatch tile when Queue disabled; tenant-default sync clobbers branch modes; garbage configs accepted; session-cached active config; seeder overwrites "Standard flow" customizations. |
| Control plane | Slug input dead; plan free-text unvalidated; MaxUsers/MaxBranches unenforced; control-plane vs LMS state can diverge; features forward has no rollback; dev bypasses exist; service tokens in config. |

---

## 9. Regression hot-spots

Re-test these every release — they are fragile, recently refactored, or high blast-radius.

1. **Branch resolution & isolation.** Every operational module trusts the resolved active branch. Re-run E2E-5 and SEC-3/SEC-4. Specifically re-test the fixed **branch-switch rejection for pinned admins** (AUTH-15/16) and the previously whole-database patient-data wipe now tenant-scoped (SEC-16 / ADM-11).
2. **Token refresh & session.** Concurrent 401 burst → single refresh, no logout (AUTH edge / MOB / SEC-17). Single-use refresh-token rotation has bitten before.
3. **Module entitlements, three layers.** Nav / route guard / API 403 must all agree; UI is fail-open by design (E2E-4, SEC-6, SEC-7).
4. **Order lifecycle projection.** Status is recomputed from sample/test states; collapsed workflows change where tubes are born and when TAT starts (PAT/SMPL/FLOW). Re-test FLOW-5/6/10 and the sample state machine.
5. **Billing money paths.** The suspected discount/partial-balance over-collection defects (BIL edge) and invoice-counter uniqueness (BIL) touch real money — regress every release.
6. **Report generation & delivery.** Auto-final on last validation, supersede chains, and the validator-vs-PDF flag boundary mismatch (RPT edge).
7. **Desktop isolation invariant.** Any mobile change must leave desktop web + Electron byte-identical (MOB / ODV-23) — the single most likely silent regression.
8. **Cross-tenant IDOR surfaces flagged as leaky.** Invite escalation (SEC-9), hospital-less doctors (SEC-11), cross-branch inventory (SEC-12), order-create patient ownership (SEC-2) — re-probe until fixed.
9. **Workflow builder self-heal + sync.** Tenant-default workflow saves overwriting each branch's derived billing/collection modes, and the seeder overwriting "Standard flow" (FLOW edge).
10. **Control-plane → LMS propagation.** Provision retry after upstream failure, module full-replace, suspension blocking at next request (CTRL edge / E2E-4).
