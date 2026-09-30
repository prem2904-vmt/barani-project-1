# OPD — the dark build

OPD (outpatient: front desk, vitals, token queue, doctor consult, pharmacy) is
being built **dark**. It exists in the code and database but is invisible to
every tenant and user until the owner opens it. The lab must behave exactly as
before while OPD is hidden.

- UI branch: `prefrontal-ui` `feat/opd-dark` (foundation) → **`feat/opd-integrated`** (foundation + A + B + C + D, integrated; see §8)
- Backend branch: `prefrontal-mw` `feat/opd-dark` → **`feat/opd-integrated`**
- UX source of truth: the clickable mockup (`opd-mockup/index.html`; screens
  hub, opd-master, service-editor, form-builder, workflow, drug-master,
  frontdesk, vitals, doctor-queue, consult, pharmacy, patient).

Read `docs/ENGINEERING-RULES.md` first. Every rule there applies to OPD.

---

## 1. Inventory: what OPD existed on dev before the dark build

This is `origin/dev` at UI `0d4db6df` / mw `0e5ec2c`, as a normal user saw it
before this branch.

### UI

| Surface | Where | Gate before | Visible or reachable by a normal user? |
|---|---|---|---|
| OPD admin hub `/admin/opd`, `/admin/opd/doctors` (fee grid), `/admin/opd/settings` (follow-up policy) | `features/opd/admin/*` | `adminGuard` only | **Yes, for every admin.** Reachable by URL, and the Admin overview had an **"OPD — coming soon" card** linking to it. |
| Admin → Modules: the "OPD (Outpatient)" row with a working toggle | `features/admin/modules` | none | **Yes, for admins.** A tenant admin could switch OPD on for their own tenant. |
| `/opd` module placeholder + More → "OPD" | `app.routes.ts`, `MORE_NAV` `m-opd` | `moduleGuard('opd')` | Hidden by default (the UI's catalogue default for OPD is off). Shown once a tenant admin switched OPD on in Modules. |
| Desk consult page `/frontdesk/consult` | `features/opd/consult-page` | frontdesk parent only | **Reachable by URL** for front-desk users. |
| Doctor Consult Room `/doctor`, `/doctor/consult/:id` | `features/opd/doctor/*` | **none** | **Reachable by URL** for anyone signed in. The backend refused non-doctor, non-staff callers. |
| Bottom-nav / top-strip "Consults" (`DOCTOR_NAV`) | `layout/*` | `isDoctor && opdUsable()` | Hidden in practice: it needed tenant entitlement plus an OPD-tagged role. |
| New-order fork (lab / consult / choose) | `OrderEntryService`, `ModuleScopeService` | `opdUsable()` | Hidden (mode `lab`). The `pf.opdPreview` flag worked only in `isDevMode()`. |
| Role editor "Role type: General / Doctor" | `role-editor.component.ts` | none | **Yes**, on every New role screen. |
| Create user "Doctor details": reg. no, department, specialisation(s), procedures | `user-invite.component.ts` | shown when a doctor-kind role is ticked | **Yes.** The seeded Pathologist, Microbiologist, Biochemist and Haematologist roles are doctor-kind. |
| Finance hub "OPD — soon" segment | `finance-hub.component.ts` | none | **Yes.** |
| Admin search keyword "opd" (Modules tile) | `admin-overview.component.ts` | none | Yes (a keyword only). |
| Role editor "Other" group: `manage_opd`, `opd_consult`, `dispense_drug`, `manage_pharmacy` | `/api/permissions` (DB rows) | none | **Yes on dev.** These are dead Phase-0 rows in the dev database. The current backend does not seed them. |
| Patient timeline OPD filter | `patient-timeline.*` | shown only when OPD data exists | No (always empty). |
| Notifications, work search | – | – | No OPD entries exist. |

### Backend

| Surface | Gate before | Reachable? |
|---|---|---|
| `GET/PUT /api/opd/settings` | permission only | **Yes**, for users with the permission, in any tenant |
| `POST/GET /api/opd/consultations`, `GET/PATCH /api/opd/consultations/{id}` | permission or doctor profile | **Yes** |
| `GET /api/doctors`, `PATCH /api/doctors/{id}` | permission only | **Yes** |
| `/api/auth/me` `isDoctor`, `modules` | – | Yes (flags only) |
| `POST /api/users` `doctorProfile`, `PUT /api/users/{id}/doctor-profile` | `manage_users` | Yes. Lab-adjacent: the reg. no. prints on reports, so this stays. |
| Roles `Kind` = doctor, `Module` = opd tags | `manage_roles` | Yes (tags only) |
| WorkEvents `ConsultCreated` / `ConsultUpdated` | – | Fired only by the consult endpoints |
| Tables `doctor_profiles`, `opd_settings`, `opd_consults`; `roles.Module`, `roles.Kind` | – | – |
| Dev-DB relics from Phase-0: `opd_consultations`, `prescriptions`, `prescription_lines`, `dispenses`, `dispense_lines`, `encounters`, `admissions`, `beds`, `wards`, … | – | Not mapped by the current code. **Never reuse these names.** |
| Module entitlement | `TenantModuleConfig`: no row means every module is on (legacy). `RequireModuleAttribute` does not know `opd`. | – |
| Admin console (`prefrontal-admin-mw`) | Its `ModuleKeys` include `opd` and default to all-true. The LMS `PUT /api/platform/tenants/{id}/features` **ignores** `opd`. | The admin console cannot switch OPD on in the LMS today. |

The old `hospital-modules` branch (Encounter, converged billing, IPD) is
superseded. Do not merge it.

---

## 2. The gate: the only source of truth for OPD visibility

**Rule:** OPD is visible when **(a)** the tenant EXPLICITLY has OPD on, or **(b)**
the person typed `pf.opd()` in the browser console **and** the server confirms
they are allowed.

"Explicitly on" means the tenant's `ModulesJson` has `opd.enabled === true`.
Having no module-config row, which means "every module on" for legacy
reasons, does not count. Neither does a row without an `opd` key or with
`enabled` set to false.

### Server: `prefrontal-mw`

- `Services/Opd/OpdAccess.cs`: `ResolveAsync()` returns
  `{ Entitled, Allowlisted }`, cached per request, and
  `Allowed = Entitled || Allowlisted`. The pure rules live in `OpdAccessRules`.
- Allowlist config: `OpdPreview:AllowedUserIds` (app `users.Id` GUIDs) and
  `OpdPreview:AllowedEmails` (`users.Email` or `users.AuthEmail`,
  case-insensitive) in `appsettings.json`. It currently lists the owner's
  email. **TODO(owner):** add your `users.Id` if you sign in with a different
  email or a username-only account.
- `[RequireOpd]` together with `OpdGateMiddleware` runs **before** the
  permission check. Anyone not allowed gets an empty **404**, never a 403.
  Every controller in `Controllers/Opd/*` carries it, as do the legacy
  `OpdSettingsController`, `OpdConsultationsController` and
  `DoctorsController`. A unit test fails if an OPD controller is missing it,
  or if a lab controller has it.
- `/api/auth/me` returns `opdAccess` (Allowed) and `opdEntitled`.
- `PUT /api/tenants/modules` (the in-tenant Modules page): a caller who is not
  OPD-allowed **cannot change the `opd` node**. The stored node is kept.

### UI: `prefrontal-ui`

- `features/opd/shared/opd-gate.ts` holds the pure rule:
  `visible = (entitled && access) || (flag && access)`.
- `features/opd/shared/opd-gate.service.ts`: `OpdGateService.visible()` and
  `consolePreview()`. It reads `localStorage['pf.opd']` once per page load
  (production builds included) and the `/me` flags.
- `window.pf.opd(on = true)` is installed silently at app start. It merges
  into any existing `window.pf`, prints nothing, sets or clears the flag, and
  reloads. `pf.opd(false)` hides OPD again.
- Surfaces that read the gate (nothing else decides OPD visibility):
  - `opdGuard` on **every** OPD route. When OPD is not visible, the user goes
    to `/`, the same as an unknown URL.
  - `TenantEntitlementsService.moduleOn('opd')`, which drives More → OPD, the
    route-access `module` checks and the old `moduleGuard('opd')`.
  - `ModuleScopeService.opdUsable()`, which drives the new-order fork.
  - The doctor "Consults" nav item.
  - The Admin overview OPD card, the Modules page OPD row and the Finance OPD
    segment.
  - Role editor: the Doctor role type and the OPD permission codes
    (`features/opd/shared/opd-permissions.ts`). Hidden codes stay granted,
    because a save sends every granted id.
  - Create user: the department, specialisation(s) and procedures fields. The
    **Medical Registration No. stays**, because it is a lab fact that prints
    under report signatures.
- The dev-only `pf.opdPreview` flag has been removed.

### How the owner turns OPD on

1. Sign in with the allowlisted account and type `pf.opd()` in the console.
   The page reloads with OPD visible for you only. `pf.opd(false)` hides it.
2. To show OPD to a whole tenant, switch OPD on for that tenant explicitly. The
   allowlisted owner can flip it on the tenant's Admin → Modules page. The
   server accepts the change only from an OPD-allowed caller, and it sets
   `ModulesJson.opd.enabled = true`. After that the tenant's users see OPD
   without the console flag.
3. **Open question:** the admin console (`prefrontal-admin-ui`/`-mw`) sends
   `opd` in its features map, but the LMS ignores it on purpose today. The
   admin-mw plan default is "all true", so honouring the key as-is would
   switch OPD on for every tenant on its next save. Wiring it needs an explicit
   per-tenant OPD toggle that defaults to off in the admin console, and an LMS
   `SetFeatures` change that writes only an explicit `opd: true`.

Unit, integration and UI specs cover the flag × server × entitlement matrix,
the 404 matrix (no-row, `{}`, `opd:false`, explicit, allowlisted, low
permission, Modules page), route gating, a snapshot of the non-OPD routes and
nav, and "new order with OPD hidden = `/frontdesk/order`, no dialog".

---

## 3. Entity map (one migration: `20260930120000_OpdFoundation`)

The migration is strictly additive: 27 new tables and three nullable `jsonb`
columns on the OPD-owned `opd_settings`. No lab table is touched. All tables
are declared in `Prefrontal/Data/AppDbContext.Opd.cs`, and every one has a
tenant filter. Rows with a BranchId also get the per-tenant branch-isolation
filter. The C# entities are in `Prefrontal/Models/Opd/*` and the vocabularies
in `OpdConstants.cs`.

| Area | Table | Notes |
|---|---|---|
| A master | `opd_departments` | Default consult form. Unique (tenant, code). Not lab departments. |
| A | `opd_services` | Consultation or procedure; price `common` or `per_doctor`; GST/SAC; follow-up window and fee; form override |
| A | `opd_service_doctor_prices` | Unique (service, doctor) |
| A | `opd_form_definitions`, `opd_form_versions` | One shared versioned library. Published versions are immutable. Unique (form, version). |
| A | `opd_doctor_form_addons` | Add-only fields per doctor × form |
| A/B/D | `opd_settings` (+`WorkflowJson`, `QueueJson`, `PharmacyJson`) | Existing table, now with the JSON configs (contracts in `opd.models.ts`) |
| B | `opd_visits` | Status flow booked → vitals → waiting → in_consult → completed (plus cancelled / no_show), token, quoted fee plus exact desk override, `BillId`, `LabOrderId`, follow-up link, reassignment |
| B | `opd_token_counters`, `opd_sequences` | Atomic `ON CONFLICT … RETURNING` counters via `Services/Opd/OpdTokenService` |
| B | `opd_vitals` | Many per visit |
| B/D | `opd_bills`, `opd_bill_lines`, `opd_payments` | OPD and pharmacy bills, **separate from lab `bills`**. Use `BillMath.Compute` (discount before GST, rupee round-off). |
| C | `opd_consult_records` | 1:1 with the visit; `FormVersionId` plus answers; diagnoses; private notes with visibility (`doctor` by default); follow-up |
| C | `opd_rx_lines` | `ScheduleJson` is the shared Rx model; the server computes `Quantity` |
| C | `opd_investigations` | Stores `LabOrderId`, an ordinary lab order created by `OrderService.CreateAsync` |
| C | `opd_patient_allergies` | The patient row only has `HasKnownAllergies` |
| D | `pharmacy_drugs` | **Copy-on-write master:** `TenantId` null is the Prefrontal master row, readable by every tenant; a tenant row with the same `CatalogKey` overrides it; `local-…` keys are tenant-only. Unique (tenant, key) with nulls not distinct. |
| D | `pharmacy_batches`, `pharmacy_stock_moves`, `pharmacy_reorder_levels` | Stock per branch by batch, expiry and MRP, with a signed ledger |
| D | `pharmacy_suppliers`, `pharmacy_purchase_orders`, `pharmacy_purchase_order_lines` | |
| D | `pharmacy_dispenses`, `pharmacy_dispense_lines` | Kind `rx` or `walk_in` (the design's "WalkInSale") |
| D | `pharmacy_h1_register` | The legal H1 register; never deleted. `Schedule` (H1 / X) snapshotted at sale (integration) |
| Integration | `opd_refunds` | Credit notes (`CN-yyMM-000000`) for a cancelled paid visit / a pharmacy return; Σ ≤ bill `TotalPaid`; the bill is never rewritten |

The legacy `opd_consults` (`OpdConsultationEntity`) is left untouched. It is
superseded by `opd_visits` plus `opd_consult_records`.

**Billing decision:** dev has no converged OPD billing path. Lab bills are tied
to `orders` and their items need a `TestId`. Putting OPD fees into lab orders
would show them in lab lists and the day statement. So OPD bills live in
`opd_bills`, use the same `BillMath` calculator, and number from
`opd_sequences`. Rolling them into Finance and day closure is a later
integrator task.

**Permissions:** OPD has no permission codes of its own yet. Seeding new codes
would show them in every lab's role editor. The stubs use existing codes
(front desk: `create_order` / `register_patient` / `view_order`; admin:
`manage_users` / `manage_billing_config`; pharmacy reads: `manage_inventory`).
The integrator adds OPD codes when OPD goes live, in the seeder and in
`opd-permissions.ts`, hidden while OPD is dark.

---

## 4. API map (all `[RequireOpd]`)

| Prefix | Controller | Owner | Foundation stub |
|---|---|---|---|
| `/api/opd/admin` | `Controllers/Opd/OpdAdminController.cs` | A | `GET departments` |
| `/api/opd/settings` | `OpdSettingsController.cs` (existing) | A | follow-up GET/PUT |
| `/api/doctors` | `DoctorsController.cs` (existing) | A | list, PATCH fee / reg. no. |
| `/api/opd/visits` | `Controllers/Opd/OpdVisitsController.cs` | B | `GET ?date=` |
| `/api/opd/vitals` | `Controllers/Opd/OpdVitalsController.cs` | B | `GET {visitId}` |
| `/api/opd/queue` | `Controllers/Opd/OpdQueueController.cs` | B | `GET ?doctorId=` |
| `/api/opd/consult` | `Controllers/Opd/OpdConsultController.cs` | C | `GET {visitId}` |
| `/api/opd/pharmacy` | `Controllers/Opd/PharmacyController.cs` (D may add `Pharmacy*Controller.cs` siblings) | D | `GET drugs?q=` |
| `/api/opd/consultations` | legacy `OpdConsultationsController.cs` | C retires it | – |

The UI list is in `features/opd/shared/opd-api.ts` (`OPD_API`). Always call
through `ApiService`.

---

## 5. Folders and ownership

UI (`apps/lms/src/app/features/opd/`):

| Folder | Owner | Routes (already wired, all `opdGuard`) |
|---|---|---|
| `admin/**` | **A**: OPD Master | `/admin/opd` (hub), `/departments`, `/services/:id`, `/doctors`, `/forms`, `/forms/:id`, `/workflow`, `/settings`, `/drugs` |
| `frontdesk/**`, `queue/**`, `vitals/**` (+ legacy `consult-page/**`) | **B** | `/opd/desk`, `/opd/visit/new?patientId=` (the new-order fork lands here), `/opd/visit/:id`, `/opd/queue`, `/opd/vitals`, `/opd/vitals/:visitId`, legacy `/frontdesk/consult` |
| `consult/**` (+ legacy `doctor/**`) | **C** | `/opd/consult` (doctor "Consults" nav), `/opd/consult/:visitId` (full screen: toggle `html.pf-opd-immersive`, which the shell and bottom-nav already honour), `/opd/patient/:patientId`, legacy `/doctor`, `/doctor/consult/:id` |
| `pharmacy/**` | **D** | `/opd/pharmacy`, `/opd/pharmacy/dispense/:visitId`, `/counter`, `/stock`, `/suppliers`, `/purchase-orders`, `/returns`, `/h1-register`, `/admin/opd/pharmacy` (settings) |
| `home/**`, `shared/**`, `opd.routes.ts` | foundation / integrator | `/opd` hub (tiles = `OPD_AREAS` in `shared/opd-nav.ts`) |

Each stub page (`*.page.ts`) keeps its class name and path. Replace its body.

Backend (`prefrontal-mw/Prefrontal/`): `Controllers/Opd/<your controller>`,
`Services/Opd/<Area>/**` (create your subfolder: `Admin`, `Frontdesk`,
`Consult`, `Pharmacy`), and your tests under `Prefrontal.Tests/Opd/<Area>*`
and `Prefrontal.Tests.Integration/Opd<Area>*`. Integration tests must call
`fx.EnableOpdAsync(tenantId)` for their tenant. Every other tenant gets 404.

---

## 6. Shared contracts

- **Rx schedule model:** `features/opd/shared/rx-schedule.ts` is the single
  source. It has the union types, `totalDays`, `perDaySched`, `dayInfo`,
  `rxQty`, `sayRx` (L10N table keyed `en`), `shortSched`, `whenShort`,
  `stripDays` (the 14-day strip), `parseRx` shorthand, `FORMS` and `SITES`.
  The C# mirror is `Services/Opd/RxSchedule.cs` (`RxScheduleMath.Quantity`).
  Both specs share the same quantity fixtures. C (consult) and D (pharmacy)
  both use it. **Never re-implement it.**
- **Models:** `features/opd/shared/opd.models.ts` is the TS mirror of the
  entities and the JSON configs (`OpdWorkflowConfig`, `OpdQueueConfig`,
  `PharmacyConfig`), plus `canMoveVisit` (which mirrors C#
  `OpdVisitStatus.CanMove`). The consult-form contract is **schema v2**
  (`OpdFormDoc`, A's `admin/forms/form-schema.ts`, re-exported here); the
  foundation's v1 `OpdFormSchema` / `OpdFormField` are gone (the renderer and
  the server still read a v1 schema).
- **Counters:** `OpdTokenService.NextTokenAsync` and `NextSequenceAsync`.
- **Money:** `BillMath.Compute` (C#) and its TS mirror. Discount comes before
  GST, round-off is to the rupee (below .50 rounds down), and there is no
  discount below the amount paid.
- **Lab orders from OPD** (desk tests, investigations): `OrderService.CreateAsync`.
  The lab sees an ordinary order; never add an OPD flag to lab rows.

---

## 7. Rules for feature agents

1. `git fetch` and merge the latest `feat/opd-dark` before you start. Read
   `docs/ENGINEERING-RULES.md` (both repos) and this file.
2. **Do not edit** `app.routes.ts`, `features/opd/opd.routes.ts`,
   `layout/nav-items.ts`, the shell, top-strip, bottom-nav,
   `features/opd/shared/**`, `features/opd/home/**`, `AppDbContext*.cs`,
   migrations, `Program.cs`, `OpdAccess` / `RequireOpd`, or another agent's
   folder.
3. **No schema changes and no new migrations.** If you need a column or table,
   stop and report it to the integrator.
4. Every OPD endpoint carries `[RequireOpd]` (a unit test enforces it). Lab
   controllers never do.
5. No lab behaviour change. Lab screens, nav, routes, order creation, billing
   math, reports and notifications stay byte-for-byte the same with OPD hidden.
   OPD reaches the lab only through `OrderService` (normal lab orders).
6. UI rules: reuse the app's components (AG-Grid like the Test Master,
   `pf-tile`, `pf-select`, `pf-screen-header`, `pf-hero-band`, CSS variables).
   Follow the ND screen pattern (band, work card, side action card, one
   primary). No native `select` / `datalist` / `window.confirm` (use
   `DialogService`). SVG icons only. Light and dark. Phone-first.
7. Tests: your specs plus the full suites (`nx test lms`, `nx build lms`, mw
   unit and integration on a throwaway local DB). Run `graphify update .` at
   the end. Do not push.
8. Out of scope for this phase: consent and the other outputs (procedure note,
   referral, IPD admission, certificate). Show them as "not built yet".

---

## 8. Integration (`feat/opd-integrated`, 2026-09-30)

`feat/opd-integrated` = latest `origin/dev` + `feat/opd-dark` + A (admin) + B
(desk) + C (consult) + D (pharmacy), `--no-ff`. Still **dark**: every surface
behind `OpdAccess` / `[RequireOpd]` (server) and `OpdGateService` /
`pf.opd()` (UI). No lab table, lab endpoint or lab behaviour changed.

### Merges

- Foundation × dev: `AppDbContext.cs` (dev's expense-tracker config + the
  `ConfigureOpd(b)` call — both kept) and `admin-overview.component.ts` (dev's
  workflow / entitlement route-access + the OPD gate on `/admin/opd` cards —
  both kept). `20260930120000_OpdFoundation` sorts between dev's instruments
  (110000) and referral / expense (140000 / 150000); the model snapshot
  merged cleanly and `has-pending-model-changes` is clean.
- A, B, C, D merged without conflicts (disjoint folders by design).
- The lab route / nav snapshot (`opd-dark.routes-nav.spec.ts.snap`) was updated
  **only** for dev's new lab routes (instruments, analyzer results, expenses).

### Single sources after integration

| Fact | One home |
|---|---|
| Consult / procedure fee (price, follow-up window, per-doctor fee, `FollowUpPercent`, tenant tiers, desk override kept beside the quote) | `Services/Opd/Admin/OpdFeeRules.Quote` + `OpdFeeInputs` (index visit, tenant tiers). Callers: `GET /api/opd/admin/quote`, the desk's `GET /api/opd/visits/quote` + checkout, the consult's follow-up booking. B's own fee rule was removed (`OpdDeskFees` keeps only the exact override + bill-line text). |
| Visit token + number | `OpdTokenService.IssueVisitAsync` (token from the queue's counter key, `OPD-yyMM-000000`). Desk checkout and the consult's follow-up use it. |
| Settings JSON (workflow / queue / pharmacy) | `Admin/OpdSettingsJson` — the desk's `OpdDeskWorkflow` / `OpdDeskQueue` parse through it (per_room, per-doctor token prefix). |
| Private-notes default | `WorkflowJson.privateNotesVisibility` (A's editor writes it, C reads it; A's draft key `privateNotes` is read once and migrated). |
| Drug catalogue (tenant view) | D's `DrugCatalogResolver` — the consult's drug search delegates to it (stable ids, aliases). |
| Drug master screen | D's `<pf-pharmacy-drug-master>` at `/admin/opd/pharmacy?tab=drugs`; `/admin/opd/drugs` forwards there. |
| Consult form rendering | A's `<pf-opd-form-renderer>` (C's `form-slot/` deleted). The consult drops questions it owns (`chief_complaints`). |
| Refunds | `opd_refunds` via `OpdRefunds.AddAsync` inside the caller's transaction, bill row-locked. |

### Integration additions

- Migration **`20260930200000_OpdIntegration`** (additive, OPD tables only):
  `opd_refunds`; `pharmacy_drugs.SiteKind`, `UsualJson`;
  `pharmacy_dispenses.PrescriptionStorageKey / FileName / ContentType`;
  `pharmacy_h1_register.Schedule`; `opd_services.FollowUpPercent`.
  `opd_refunds` is tenant + strict-branch filtered.
- Uploads on the private storage pipeline (`IStorageService`, `OpdMediaStore`):
  consult media `POST/GET /api/opd/consult/{visitId}/media` (any format ≤ 50 MB;
  known types sniffed; keys `tenants/{t}/opd/consult/{visit}/…`; URLs re-signed on
  every read) and a walk-in's paper prescription
  `POST/GET /api/opd/pharmacy/counter/{id}/prescription` (photo / PDF ≤ 15 MB).
- Desk cancel of a paid visit: refund cash / UPI / card or keep → credit note.
  Pharmacy patient return → credit note (refund mode), capped to what was paid.
- H1 register: `?schedule=H1|X` (UI: All / H1 / Schedule X).
- `PharmacyStarterMaster` (fictional drug master, platform rows) seeds on boot
  **only** when `ASPNETCORE_ENVIRONMENT=Development` **and**
  `OpdDev:SeedPharmacyStarter=true` (no appsettings sets it) — never on a deploy.
- A's starter forms no longer ask the chief complaint (the consult owns it).
- Shell: `html.pf-opd-immersive` also hides the chrome under the bottom-navbar
  experiment (OPD-only selector). NOTE for the lab: `pf-collect-immersive` has
  the same specificity gap under `nav-bottom` on dev — not changed here.

### Decisions / notes

- **Doctor → department:** A's Doctors screen has no explicit department link
  (room, token prefix, days and fees only), so the desk keeps B's derivation:
  a doctor belongs to a department through their per-doctor prices, else by
  matching `DoctorProfile.Department` text to an OPD department name / code.
  Go-live: add an explicit `departmentId` (QueueJson `doctors{}` or a column).
- **Permissions:** OPD still reuses lab codes (front desk `create_order` /
  `register_patient` / `view_order` / `collect_payment`; admin `manage_users` /
  `manage_billing_config`; pharmacy `manage_inventory` / `create_bill`). New
  OPD codes were NOT added: seeding them writes `permissions` rows on deploy
  and the admin console's role editors (prefrontal-admin-ui) would list them
  with no OPD gate. Add them at go-live (seeder + `opd-permissions.ts` + the
  admin console).
- **Consult form resolution** stays C's (`service form ?? department default`,
  active forms only) — the same rule as A's `forms/resolve`.

### Verification (on the integrated branch)

- mw: unit + integration (throwaway local DB, dropped after); OPD integration
  suite incl. `OpdIntegrationTests` (one resolver, credit notes, H1/X snapshot,
  resolver drug search, numbering, notes key, uploads).
- UI: all OPD specs incl. C's never-run `rx-model`, `rx-editor`,
  `consult-workspace`; full `nx test lms`; production `nx build lms`.
- Lab non-regression: nav / route snapshot (gate closed), new-order-with-OPD-hidden,
  `RequireOpd` coverage (no lab controller carries it).
- Screenshots: `OpdIntegratedE2EHost` (local Kestrel, fictional clinic, throwaway
  DB) → `scratchpad/shots/opdint-*` at 1440 light / dark and 390.

## 9. Go-live checklist (remaining)

1. Owner click-through on the integrated branch (desk → vitals → queue →
   consult → complete → pharmacy) with `pf.opd()`; then merge to dev.
2. OPD permission codes (seeder, `opd-permissions.ts`, admin console role
   editor) — replace the reused lab codes.
3. Explicit doctor → OPD department link (replace the text derivation).
4. Admin console per-tenant OPD toggle (defaults off) + LMS `SetFeatures`
   writing only an explicit `opd: true` (§2 open question).
5. Finance: roll `opd_bills` / `opd_payments` / `opd_refunds` into the Finance
   hub and day closure (today they are separate from lab bills by design).
6. Refund UI polish: a credit-note PDF / print; partial refunds at the desk.
7. Consult: use `pharmacy_drugs.UsualJson` for doctor favourites in the Rx
   picker and `SiteKind` for the site picker (the data + API are in place).
8. Waiting-room token screen (`QueueJson.showOnScreen`) — not built.
9. Out of scope so far: consent, procedure note, referral, IPD admission,
   certificate ("not built yet" in the complete sheet).
10. Legacy `opd_consults` / `OpdConsultationsController` retirement (C's
    workspace supersedes them) in a later cleanup migration.
