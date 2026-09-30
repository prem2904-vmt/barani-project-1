# OPD — the dark build

OPD (outpatient: front desk, vitals, token queue, doctor consult, pharmacy) is
being built **dark**. It exists in the code and database but is invisible to
every tenant and user until the owner opens it. The lab must behave exactly as
before while OPD is hidden.

- UI branch: `prefrontal-ui` `feat/opd-dark`
- Backend branch: `prefrontal-mw` `feat/opd-dark`
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
| D | `pharmacy_h1_register` | The legal H1 register; never deleted |

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
  `PharmacyConfig`, `OpdFormSchema`), plus `canMoveVisit` (which mirrors C#
  `OpdVisitStatus.CanMove`).
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
