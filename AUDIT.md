# Prefrontal LMS — Codebase Audit

**Generated:** 2026-04-24
**Repos:**
- `prefrontal-mw` (.NET 10 ASP.NET Core API) → `C:\Users\Shuganth\Documents\GitHub\prefrontal-mw`
- `prefrontal-ui` (Nx + Angular 21 monorepo, app `apps/lms`) → `C:\Users\Shuganth\Documents\GitHub\prefrontal-ui`

**Live database:** Supabase Postgres at `aws-1-ap-northeast-1.pooler.supabase.com` (project `cottlnsbjnstsgknsgzu`). Schema and row counts in this document were queried directly from the database, not inferred from code.

> **Honesty disclaimer.** This is a working dev system, not a production one. The biggest single fact: **auth is fully bypassed on both ends.** Every backend request runs as a hardcoded mock admin with `Permissions = ["*"]`. Every frontend page assumes that user. Don't conflate "feature exists" with "feature is gated."

---

## 1. PROJECT STRUCTURE

### Backend — `prefrontal-mw`

Single .NET 10 web project, flat folder layout (no Modules slicing yet, per the README plan to add `Modules/Lms/`, `Modules/Hms/` later when it grows).

```
prefrontal-mw/
├── Prefrontal.slnx
├── README.md
└── Prefrontal/
    ├── Prefrontal.csproj
    ├── Program.cs
    ├── appsettings.json                  ← local Postgres conn + Supabase placeholders
    ├── appsettings.Development.json      ← logging-only override
    ├── Properties/launchSettings.json    ← http://localhost:5270, https://localhost:7271
    ├── Controllers/                      ← 16 [ApiController] classes
    ├── Models/                           ← 39 entity classes
    ├── Repositories/                     ← 12 EF-backed repos
    ├── Services/                         ← 12 business-logic services
    ├── Interfaces/                       ← IServices.cs + ApiResponse<T>
    ├── Middleware/
    │   ├── UserContextMiddleware.cs      ← ⚠️ HARDCODED MOCK USER
    │   ├── CurrentUser.cs
    │   ├── GlobalExceptionHandlerMiddleware.cs
    │   └── ErrorResponse.cs
    ├── Extensions/ServiceCollectionExtensions.cs
    ├── Data/
    │   ├── AppDbContext.cs
    │   ├── AppDbContextFactory.cs       ← for design-time tools
    │   └── Migrations/                  ← 6 migrations + snapshot
    └── Seed/
        ├── DataSeeder.cs                ← orchestrator
        ├── PermissionSeeder.cs
        ├── RoleSeeder.cs
        ├── TestSeeder.cs
        ├── WorkflowSeeder.cs
        ├── DemoSeeder.cs
        └── SeedIds.cs
```

### Frontend — `prefrontal-ui`

Nx workspace, single Angular 21 app at `apps/lms`. Tailwind 4. Zoneless signals throughout. No Material/PrimeNG — custom primitives.

```
prefrontal-ui/
├── nx.json
├── package.json                         ← npm engines: node ≥22.12, npm ≥11
├── tsconfig.base.json
├── apps/
│   ├── lms/
│   │   ├── project.json                 ← build/serve targets, budgets
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── styles.scss              ← teal/mint design tokens
│   │   │   ├── environments/            ← environment.ts (apiUrl=:5270, auth.bypass=true)
│   │   │   └── app/
│   │   │       ├── app.ts, app.config.ts, app.routes.ts
│   │   │       ├── core/
│   │   │       │   ├── auth/            ← auth.service, auth.guard (commented out), auth.interceptor, mock-user, permission.guard
│   │   │       │   └── services/        ← api, dialog, theme, toast, tenant-state, frontdesk-settings
│   │   │       ├── layout/              ← shell, header, navbar, sidebar, top-strip, bottom-nav, nav-items
│   │   │       ├── features/
│   │   │       │   ├── admin/           ← dashboard, users-access, tests, branches, lab-settings, billing-config, report-template, notifications-config, workflow-builder, setup-wizard
│   │   │       │   ├── frontdesk/       ← landing, order-create, billing, book-appointment, patient-register, patient-profile, post-payment + frontdesk-shell
│   │   │       │   ├── lab/             ← my-work, sample-collection, receive-samples, result-entry (+ delegate-modal)
│   │   │       │   ├── pathologist/     ← pending-validation, validate-result
│   │   │       │   ├── reports/         ← report-queue, report-viewer
│   │   │       │   ├── dashboard/       ← tat-board
│   │   │       │   └── shared/          ← placeholder.component (used only for /403)
│   │   │       └── shared/
│   │   │           ├── primitives/      ← 13 components (avatar, chip, clock, num-pad, screen-header, segmented, select, skeleton, tile, toggle, touch-button, logo-mark, number-input)
│   │   │           ├── components/      ← ambient-bg, barcode-display, barcode-scanner-modal, confirm-dialog, dialog-host, dynamic-input, loading-logo, notification-bell, patient-search, tat-indicator, workflow-renderer
│   │   │           ├── forms/           ← form-field.model, field-registry, condition-evaluator, condition-editor, validation-editor, field-type-picker, validate
│   │   │           ├── models/          ← api-response, patient, order, bill, test, report, result, appointment, tenant, user, workflow
│   │   │           └── pipes/           ← currency-inr, tat-color
│   └── lms-e2e/                         ← Playwright skeleton (only example.spec.ts)
└── packages/                            ← empty
```

---

## 2. DATABASE — what is live in Supabase right now

Queried directly from Supabase Postgres:

### Migrations applied (6, all from EF Core)

| Migration | What it does |
|---|---|
| `20260418172142_InitialCreate` | Bootstrap schema |
| `20260418183259_AddOrderBillMetadata` | Bill/order metadata columns |
| `20260419045319_AddMissingColumns` | Catch-up patches |
| `20260422142845_AddSubBranchSupport` | **Sub-branch arrival**: creates `sub_branches`, adds `SubBranchId` to 8 tables (orders, order_samples, patients, reports, bills, appointments, departments, user_roles) |
| `20260423073945_AddTenantBranding` | LogoUrl, BrandingName, BrandingMode on tenants |
| `20260423110617_AddDeptAutoAssignAndNoScanFlag` | `department_auto_assign_configs` + tenant `AllowNoScanClaim` flag |

### Tables that exist (40 total in `public` schema)

`__EFMigrationsHistory`, `appointment_reminders`, `appointments`, `bill_items`, `bills`, `branch_gst_configs`, `branch_lab_configs`, `branch_sample_configs`, `branches`, `department_auto_assign_configs`, `departments`, `doctor_tenants`, `doctors`, `escalation_configs`, `notification_configs`, `notifications`, `order_samples`, `order_sequences`, `order_test_results`, `order_tests`, `orders`, `patient_messages`, `patients`, `payments`, `permissions`, `refunds`, `regions`, `report_templates`, `reports`, `role_permissions`, `roles`, `sub_branches`, `tenant_billing_configs`, `tenant_products`, `tenants`, `tests`, `user_roles`, `users`, `workflow_config_history`, `workflow_configs`

### Row counts (live)

| Domain | Table | Rows |
|---|---|---|
| Tenant graph | tenants / branches / sub_branches / departments / regions | 1 / 1 / 1 / 5 / 0 |
| Auth | users / user_roles / roles / permissions / role_permissions | 1 / 0 / **5** / **37** / **74** |
| People | patients / doctors | 32 / 0 |
| Orders | orders / order_samples / order_tests / order_test_results | 32 / 57 / 157 / 13 |
| Catalog | tests | 23 |
| Billing | bills / bill_items / payments / refunds | 22 / 115 / 18 / 0 |
| Reports | reports / report_templates | 2 / 0 |
| Workflows | workflow_configs / workflow_config_history | **6** / 0 |
| Notifications | notifications / patient_messages / notification_configs / escalation_configs | 3 / 0 / 0 / 0 |
| Configs | branch_*_configs / tenant_billing_configs / department_auto_assign_configs | 0 / 0 / 0 |
| Other | appointments / appointment_reminders / order_sequences | 8 / 0 / 1 |

### Seeded data (verified live)

**Tenant:** `Apollo Diagnostics`, vendor `APL`, 1 branch (`Chennai Main`), 1 sub-branch, 5 departments.

**Roles seeded** (all `IsPreSeeded=true`, `Scope=tenant`, `TenantId=null`):
1. Receptionist
2. Lab Technician
3. Pathologist
4. Branch Manager
5. Lab Admin
> ❗ Backend seeder code references a 6th "Tenant Admin" role but the live DB does not contain it. Either the seeder is conditional or it was added after the last migrate.

**Permissions:** 37 permission codes in module `lms`. 74 role↔permission links.

**Workflow configs (6, all `published`, version 1):**
1. `sample_collection`
2. `order_creation`
3. `patient_registration`
4. `appointment_booking`
5. `result_entry`
6. `billing`

ConfigJson is stored as JSONB containing `{ id, name, steps: [...] }` — full step/field/condition trees. Validated end-to-end loading via `WorkflowBuilderComponent`.

**Tests:** 23 standard diagnostic tests seeded by `TestSeeder` (CBC, lipid panel, etc.). Includes some packages.

### FK / Unique / Index density (live counts)

The system is properly indexed. Heavy tables (orders, samples, user_roles) carry 5–7 indexes each; FK constraints are present on every relational table. Sub-branch FKs use `RESTRICT` (not cascade) — intentional, so deactivating a sub-branch doesn't silently nuke history.

---

## 3. BACKEND — .NET API

### 3.1 Entity classes (39)

Grouped:

- **Tenant graph (5):** `TenantEntity`, `RegionEntity`, `BranchEntity`, `SubBranchEntity`, `DepartmentEntity`
- **People (3):** `PatientEntity` (incl. ABHA + Aadhaar fields, NpgsqlTsVector for search), `DoctorEntity`, `DoctorTenantEntity`
- **Orders (5):** `OrderEntity`, `OrderSampleEntity`, `OrderTestEntity`, `OrderTestResultEntity`, `OrderSequenceEntity`
- **Catalog (1):** `TestEntity` (Type = "individual" | "package", Parameters jsonb, ChildPackageIds[], ChildTestIds[])
- **Billing (4):** `BillEntity`, `BillItemEntity`, `PaymentEntity`, `RefundEntity`
- **Reporting (2):** `ReportEntity` (with public Token), `ReportTemplateEntity`
- **Auth (5):** `UserEntity`, `UserRoleEntity` (carries `BranchId`, `SubBranchId`, `RegionId` scope), `RoleEntity`, `PermissionEntity`, `RolePermissionEntity`
- **Notifications (5):** `NotificationEntity`, `PatientMessageEntity`, `NotificationConfigEntity`, `EscalationConfigEntity`, `AppointmentReminderEntity`
- **Configuration (6):** `BranchSampleConfigEntity`, `BranchLabConfigEntity`, `TenantBillingConfigEntity`, `BranchGstConfigEntity`, `DepartmentAutoAssignConfigEntity`, plus tenant-level branding on `TenantEntity`
- **Workflow (2):** `WorkflowConfigEntity` (jsonb config), `WorkflowConfigHistoryEntity`
- **Misc (1):** `AppointmentEntity`

### 3.2 Repositories (12)

All inject `AppDbContext`; queries are filtered by `TenantId` (and `BranchId` / `SubBranchId` where applicable). Highlights:

- `OrderRepository.ListForResultEntryAsync(branchId, subBranchId?, assignedTo?)` — sub-branch-aware queue. Same shape exists for validation queue, in-transit, pending-collection.
- `TenantRepository.ListEligibleAssigneesAsync(tenantId, roleId, branchId?, subBranchId?)` — finds users with a role scoped to a sub-branch.
- `OrderSequenceRepository.NextSeqAsync(tenantId, year)` — atomic increment for barcode sequence per tenant per year.
- `PatientRepository.SearchAsync(tenantId, query, limit)` — name (case-insensitive contains), phone (exact), AbhaId (exact). Intentionally **no sub-branch filter** (patients are visible across the whole branch).

### 3.3 Services (12) — what business logic is real

| Service | What it actually does |
|---|---|
| **BarcodeService** | Format `PF-{VENDOR}-{YEAR}-{SEQ:D5}-{DEPT}` (e.g. `PF-APL-2026-00001-LAB`). Sequence is per-tenant-per-year via `OrderSequenceRepository`. |
| **ConditionsEngineService** | Evaluates JSON rule arrays. Operators `<`, `<=`, `>`, `>=`, `=`, `!=`. Actions `mark_critical` + arbitrary `notify_*`. Returns `(MarkCritical: bool, Notifications: List<string>)`. |
| **TatService** | Computes `(elapsedMin, remainingMin?, level)`. Level: `urgent` ≤ 0min, `high` ≤ 60min, `normal` > 60min. |
| **BillingCalculator** | GST split: intrastate → CGST + SGST (each `taxSlab/2`); interstate → full IGST. Rounded 2dp. |
| **BillingService** | Builds bill from order: package explosion → snapshot prices → fetch GST config → call BillingCalculator → persist Bill + BillItems. `CollectPaymentAsync` updates Balance + Status (`pending`/`partially_paid`/`paid`). ⚠️ **Hardcoded `patientState = "TN"`** (line ~58) — interstate detection is broken outside Tamil Nadu. |
| **OrderService** | Multi-step: fetch tests → **package explosion** (recursively expands package → child tests via Parameters JSON) → group by department → create order header with branch + sub-branch → for each dept group, generate barcode + create OrderSample (inheriting dept's SubBranchId so scoped staff see it) + create OrderTests (carries PackageTestId for traceability). |
| **PatientService** | Search via repo. Register coerces client-sent ISO datetime strings from `DateTimeKind.Unspecified` → `Utc` to satisfy Npgsql `timestamp with time zone`. Auto-computes `Age` from DOB; flags `IsMinor` if <18. |
| **SampleService** | Status mutations: `CollectAsync` (→ `collected`), `RejectAsync` (→ `rejected`, increments RejectionCount), `PickupAsync` (→ `in_transit`), `ReceiveAsync` (→ `received`). |
| **ResultService**, **ReportService**, **NotificationService**, **WorkflowService** | Less-explored — endpoints exist; assumed real per controller wiring. |

### 3.4 Controllers — every endpoint

| Controller | Endpoints |
|---|---|
| **AppointmentsController** | `POST /api/appointments`, `GET /api/appointments/{id}`, `PATCH /api/appointments/{id}` |
| **BillingController** | `POST /api/billing`, `POST /api/billing/{id}/pay`, `GET /api/billing/{id}`, `GET /api/billing/config`, `PATCH /api/billing/config` |
| **ConfigController** | `GET /api/config/branches`, `GET /api/config/tests`, `GET /api/config/doctors`, `POST /api/config/tests`, `PATCH /api/config/tests/{id}` |
| **DashboardController** | `GET /api/dashboard/summary`, `GET /api/dashboard/tat`, `GET /api/dashboard/queue` |
| **NotificationsController** | `GET /api/notifications`, `POST /api/notifications/{id}/read`, `GET /api/notifications/config`, `PATCH /api/notifications/config` |
| **OrdersController** | `POST /api/orders`, `GET /api/orders/{id}`, `GET /api/orders/today`, `PATCH /api/orders/{id}/cancel` |
| **PatientsController** | `GET /api/patients` (search), `POST /api/patients`, `GET /api/patients/{id}`, `PATCH /api/patients/{id}` |
| **ReportsController** | `POST /api/reports/{id}/deliver`, `GET /api/reports/{id}`, `GET /api/reports/queue`, `GET /api/reports/public/{token}` |
| **ResultsController** | `POST /api/results/{testId}/enter`, `PATCH /api/results/{testId}`, `POST /api/results/{testId}/validate`, `POST /api/results/{testId}/reassign`, `POST /api/results/{id}/claim-by-scan` |
| **RolesController** | `GET /api/roles`, `POST /api/roles`, `PATCH /api/roles/{id}` |
| **SamplesController** | `PATCH /api/samples/{id}/collect`, `PATCH /api/samples/{id}/reject`, `PATCH /api/samples/{id}/pickup`, `PATCH /api/samples/{id}/receive` |
| **TenantsController** | `GET /api/tenants/current`, `PATCH /api/tenants/current`, `POST /api/tenants/branches`, `POST /api/tenants/sub-branches`, `GET /api/tenants/sub-branches/{id}/departments`, `POST/DELETE /api/tenants/sub-branches/{id}/departments/{deptId}`, `GET /api/tenants/departments?branchId=&subBranchId=`, `POST /api/tenants/departments` |
| **TestsController** | `GET /api/tests`, `POST /api/tests`, `PATCH /api/tests/{id}`, `POST /api/tests/bulk-price` |
| **UsersController** | `GET /api/users`, `POST /api/users`, `PATCH /api/users/{id}`, `POST /api/users/{id}/roles` |
| **ValidationController** | `GET /api/validation/queue`, `POST /api/validation/{id}/approve` |
| **WorkflowsController** | `GET /api/workflows`, `POST /api/workflows`, `PATCH /api/workflows/{id}` |
| _(Other)_ | `GET /health`, `GET /`, `GET /api/_seed/summary` |

### 3.5 Middleware

- **`UserContextMiddleware`** — populates a scoped `CurrentUser` from JWT in theory, **bypassed in practice**. Lines 35–44:
  ```csharp
  current.Id = MockUserId;                              // 0001-0001
  current.TenantId = MockTenantId;                      // 0001-0010
  current.BranchId = MockBranchId;                      // 0001-0020
  current.SubBranchId = null;
  current.Permissions = new List<string> { "*" };
  ```
- **`GlobalExceptionHandlerMiddleware`** — catches unhandled exceptions, returns `ErrorResponse`.
- **JWT validator** is built (`Program.cs:101–114`) with Supabase-style HS256 against `Supabase:JwtSecret`, but config is `placeholder.supabase.co` / `replace-me` and `Features:BypassAuth = true`. Comment on line 97: *"JWT built but not enforced."*

### 3.6 Permission check logic (sub-branch priority)

The `UserRoleEntity` carries `RoleId` + scope (`BranchId?`, `SubBranchId?`, `RegionId?`) so the same user can have different roles in different scopes. The intended priority — sub-branch role > branch role > tenant role — is *implicit in the data model* but **not enforced in code anywhere**. There are no `hasPermission()` calls in any controller, no `[Authorize]` attributes, and the mock user has `*`. This is design-ready, runtime-unenforced.

---

## 4. FRONTEND — Angular LMS app

### 4.1 Routes (every one)

From `apps/lms/src/app/app.routes.ts`. `authGuard` is **commented out** on the shell.

| Path | Component |
|---|---|
| `/` | redirect → `/admin` |
| `/admin` | AdminDashboardComponent |
| `/admin/users` | UsersAccessComponent |
| `/admin/users/invite` | UserInviteComponent |
| `/admin/roles/new` & `/admin/roles/:id/edit` | RoleEditorComponent |
| `/admin/tests` | TestsComponent |
| `/admin/tests/new` & `/admin/tests/:id/edit` | TestEditorComponent |
| `/admin/branches` | BranchesComponent |
| `/admin/lab-settings` | LabSettingsComponent |
| `/admin/billing` | BillingConfigComponent |
| `/admin/reports` | ReportTemplateComponent |
| `/admin/notifications` | NotificationsConfigComponent |
| `/admin/workflows` & `/admin/workflows/:screen` | WorkflowBuilderComponent |
| `/admin/workflows/:screen/steps/:stepId/fields/new` & `…/:fieldId/edit` | FieldEditorComponent |
| `/setup` | SetupWizardComponent |
| `/frontdesk` | FrontdeskShellComponent + FrontdeskLandingComponent |
| `/frontdesk/order` | OrderCreateComponent |
| `/frontdesk/billing` | BillingComponent |
| `/frontdesk/appointments/new` | BookAppointmentComponent |
| `/frontdesk/patients/new` | PatientRegisterComponent |
| `/frontdesk/patients/:id` | PatientProfileComponent |
| `/frontdesk/post-payment` | PostPaymentComponent |
| `/reception/*` | redirect → `/frontdesk/*` (legacy) |
| `/lab/my-work` | MyWorkComponent |
| `/lab/service-queue` | redirect → `/lab/my-work` |
| `/lab/collect` | SampleCollectionComponent |
| `/lab/receive` | ReceiveSamplesComponent |
| `/lab/result/:id` | ResultEntryComponent |
| `/pathologist` | PendingValidationComponent |
| `/pathologist/validate/:id` | ValidateResultComponent |
| `/reports` | ReportQueueComponent |
| `/reports/view/:id` | ReportViewerComponent |
| `/dashboard` | TatBoardComponent |
| `/403` | PlaceholderComponent (only stub use) |
| `**` | redirect → `/admin` |

### 4.2 Components — what's real

**Real, working screens (verified):** all admin tiles, all frontdesk screens (landing/order/billing/booking/register/profile/post-payment), all lab screens (my-work/collect/receive/result-entry), pathologist (pending + validate), reports (queue + viewer), TAT dashboard. **None of these are stubs.**

**Only placeholder use:** `/403` page renders `PlaceholderComponent` ("Forbidden — coming soon"). No other placeholder use anywhere.

### 4.3 Services

- **Core:** `api.service` (HTTP wrapper expecting `ApiResponse<T>`), `dialog.service`, `theme.service`, `toast.service`, `tenant-state.service` (cached + cross-tab BroadcastChannel sync), `frontdesk-settings.service`.
- **Auth:** `auth.service` (Supabase + signals; **short-circuits to `MOCK_USER` when `environment.auth.bypass = true`**), `auth.interceptor` (Bearer token), `auth.guard` & `permission.guard` (defined but unused in routes), `mock-user.ts` (admin user with `permissions: ['*']`).
- **Feature-local:** `workflow-builder.service.ts` — full state machine.

### 4.4 WorkflowBuilderService

State (signals): `_workflow` (current config), `_record` (metadata), `_selectedStepId`, `_selectedFieldId`, `_isDirty`, `_isLoading`, `_error`, `_lastDeletedField`, `_lastDeletedStep` (5-second undo snapshots).

Computed: `selectedStep`, `selectedField`, `fieldIdToNameMap`, `allFields`.

Methods: `loadWorkflow()`, `addStep()`, `deleteStep()`, `reorderSteps()`, `addField()`, `updateField()`, `deleteField()`, `addConditionToField()`, `setFieldConditions()`, `saveDraft()`, `publish()`, `resetToDefault()`.

Persists via `GET/POST /api/workflows/{screenName}` and `POST /api/workflows/{screenName}/publish`.

### 4.5 DynamicInputComponent — types supported

Implements ~24 of the ~30 types declared in `field-registry.ts`:

**Implemented:** `text`, `number`, `numeric`, `numeric_with_range`, `critical_numeric`, `textarea`, `email`, `phone`, `date`, `datetime`, `time`, `select`, `multiselect`, `radio`, `button_select`, `multi_button_select`, `image_select`, `yesno`, `yes_no_na`, `toggle`, `checkbox`, `scan`, `patient_search`, `doctor_search`, `test_picker`, `dynamic_from_test`.

**Declared in registry but not yet rendered in DynamicInputComponent:** `voice-text`, duration variants, `section-header`, `info-text`, `imageGallery`, `scribblePad`, `signature`, `file-upload`, `size`, `measure`, `table`, `recursive`, `recursivePages`. These are in the registry (form-builder taxonomy merge), waiting for component support.

### 4.6 Forms framework (`shared/forms/`)

- **`field-registry.ts`** — central registry of 30+ types with `enabled` flags and category grouping.
- **`form-field.model.ts`** — type definitions (FormField, ShowWhen, ConditionRule, etc.).
- **`condition-evaluator.ts`** — pure evaluator. Operators: equals, notEquals, contains, notContains, isEmpty, isNotEmpty, gt/lt/gte/lte. Logic AND/OR. show/hide flip.
- **`condition-editor.component.ts`** — UI for building condition rules.
- **`validation-editor.component.ts`** — validation rule editor.
- **`field-type-picker.component.ts`** — categorized type chooser.
- **`validate.ts`** — validation execution.

---

## 5. WHAT WORKS END TO END

You can walk through these flows on the live system:

1. **Tenant onboarding** — `/setup` wizard → tenant + branding + branches + departments → persists.
2. **Branch & sub-branch management** — `/admin/branches` CRUD with department assignment per sub-branch.
3. **Patient register → search → profile** — `/frontdesk/patients/new` → search via `patient-search.component` → `/frontdesk/patients/:id`. 32 patients live.
4. **Order creation with package explosion + sub-branch routing** — `/frontdesk/order` → `OrderService.CreateAsync` recursively expands packages and routes samples to dept sub-branches. 32 orders, 57 samples, 157 order_tests live.
5. **Billing with GST math** — Bill auto-built from order, with CGST/SGST split (intrastate). 22 bills, 115 line items, 18 payments live.
6. **Lab intake & sample lifecycle** — `/lab/receive` (scan or **manual entry** — recently added) → `/lab/my-work` (queue with TAT indicators) → `/lab/result/:id`. Sample status `collected` → `in_transit` → `received`.
7. **Result entry → pathologist validation** — `/lab/result/:id` (dynamic input renderer) → `/pathologist/validate/:id`. 13 results live.
8. **TAT board** — `/dashboard` reads from `OrderRepository` queue methods + `TatService`.
9. **Workflow builder** — `/admin/workflows/:screen` for any of the 6 seeded screens (sample_collection, order_creation, patient_registration, appointment_booking, result_entry, billing). Step/field CRUD with undo + condition rules + save draft + publish.
10. **Reports** — `/reports` queue → `/reports/view/:id`. 2 reports live. Public `/api/reports/public/{token}` exists.

Partially built: appointment booking (UI + 8 rows live, but `appointment_reminders` empty and reminder dispatch not implemented).

---

## 6. WHAT IS INCOMPLETE OR MISSING

### Auth & permissions
- `UserContextMiddleware.cs:35–44` — hardcoded mock user. **Removes all tenant isolation and role gating.**
- `apps/lms/src/app/app.routes.ts:9` — `authGuard` commented out.
- `apps/lms/src/app/core/auth/auth.service.ts:22–28` — short-circuit to `MOCK_USER` when `environment.auth.bypass = true`.
- No `[Authorize]` or `hasPermission()` checks anywhere in backend code despite the data model supporting it.
- `Supabase:Url` and `Supabase:JwtSecret` are placeholders in `appsettings.json`.

### Billing
- `BillingService.cs` ~line 58: `var patientState = "TN"; // placeholder` — interstate GST detection always assumes Tamil Nadu base. Wrong for any non-TN deployment.
- No payment gateway integration. `PaymentEntity.Mode` field exists but no Razorpay/UPI hookup.

### Notifications & messaging
- `notification_configs`, `escalation_configs`, `appointment_reminders`, `patient_messages` tables are empty.
- No SMS / WhatsApp / email transport implemented. `NotificationConfigEntity.Channels` is jsonb-shaped for it but unwired.

### Identity verification
- `PatientEntity` has `AbhaId`, `AbhaVerified`, `AbhaVerifiedAt`, `AadhaarLast4`, `AadhaarToken`, `AadhaarVerified` — **fields exist, no API integration**.

### DynamicInputComponent gaps
- ~6 declared field types (`voice-text`, duration, layout, media, table, recursive variants) are in the registry but not rendered. Will silently render as "unknown" if a workflow includes them.

### Tests / quality
- Frontend e2e is just `example.spec.ts`. No real Playwright tests.
- No unit tests of substance.

### Other gaps
- No PWA / service worker.
- No i18n.
- No "Tenant Admin" role in DB (seeder code references it; mismatch with live data).
- Workflow execution engine: configs are stored & published, but the runtime that walks step→step→fields and applies conditions during data entry is part of `WorkflowRendererComponent` — depth not fully verified.
- `tenant_billing_configs`, `branch_gst_configs`, `branch_sample_configs`, `branch_lab_configs`, `dept_auto_assign_configs` are all 0-row in live DB → admin screens for these may not have been used yet, or the configs need explicit creation.

---

## 7. RECENT CHANGES (last few sessions)

### Sub-branch implementation — **DONE**
- Migration `20260422142845_AddSubBranchSupport` applied to live DB ✓
- Backend: `SubBranchEntity`, repos, controllers (`POST /api/tenants/sub-branches`, `GET .../departments`), `OrderService` routes samples to dept sub-branches.
- Frontend: `apps/lms/src/app/features/admin/branches/branches.component.ts` supports sub-branch CRUD + dept assignment. Sub-branch nav model is in `tenant.model.ts` (`SubBranch` interface).
- 1 sub-branch live in DB.

### Tenant branding — **DONE**
- Migration `20260423073945_AddTenantBranding` applied.
- `TenantEntity.LogoUrl`, `BrandingName`, `BrandingMode` columns. Top-strip uses them via `TenantStateService`.

### Department auto-assign + no-scan-claim — **DONE schema, NOT used**
- Migration `20260423110617_AddDeptAutoAssignAndNoScanFlag` applied.
- `department_auto_assign_configs` table exists, but 0 rows. No live config.
- `tenants.AllowNoScanClaim` boolean exists, default false. No UI yet.

### Workflow Builder — **stable**
- 6 workflows seeded and published. Builder loads/edits/publishes correctly (state machine in `workflow-builder.service.ts`).

### Patient search — **working**
- `shared/components/patient-search/patient-search.component.ts` is real: type-ahead, debounced, keyboard-navigable, hits `GET /api/patients?q=`. Used on frontdesk landing.

### Manual barcode entry — **just added (this session)**
Three places now support typing the barcode by hand instead of camera scan:

1. **`/lab/receive`** (`receive-samples.component.ts`) — segmented `PF · {vendor} · {year} · [seq] · {dept}` panel, dept dropdown (loaded from `/api/tenants/departments?branchId=`), 10 MB-style behaviour: 5-digit input, Confirm blocked until valid. NumPad shown only on touch (`(pointer: coarse)`).

2. **`/lab/my-work`** scan bar — same pattern, on submit composes the barcode and reuses the existing `scanSubmit()` (same `claim-by-scan` gate as camera/HID).

3. **`barcode-scanner-modal.component.ts`** — when the modal is opened with an `expectedBarcode` (per-row claim), an "Enter manually" toggle parses the expected barcode and locks vendor/year/dept; user only types the 5-digit seq. Submit goes through existing `handleScan()` so the same mismatch-flash protection applies.

Plus a related fix in **`result-entry.component.ts`**: bypass-the-rescan-modal logic now reads `history.state` as a fallback for `router.getCurrentNavigation()` (which returns null after navigation settles), so manual claims correctly skip the second scan prompt.

---

**End of audit.**
