import { inject } from '@angular/core';
import { cultureResultRedirectGuard, cultureSampleRedirectGuard, cultureValidateRedirectGuard } from './core/navigation/culture-redirect.guard';
import { CanActivateFn, Route, Router } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { AuthService } from './core/auth/auth.service';
import { landingGuard } from './core/auth/landing.guard';
import { moduleGuard } from './core/auth/module.guard';
import { permissionGuard } from './core/auth/permission.guard';
import { routeGuards } from './core/auth/route-guards';
import { ADMIN_PERMS } from './core/auth/route-access';
import { loadTestEditor } from './features/admin/tests/test-editor/test-editor.loader';
import { loadRoleEditor, loadUserEdit, loadUserInvite } from './features/admin/users-access/user-editors.loader';

// Perms that open the ADMIN CONFIG shell (overview, manage hub, modules, setup,
// KPIs). Deliberately EXCLUDES manage_branch(es): those are read-tier branch
// browsing (see RoleSeeder) held by Branch Managers, who must NOT reach tenant
// config. Their legit destinations — /admin/branches, /admin/audit,
// home-collection — are separate routes gated on their own perms and surfaced
// via the "More" nav, so they need no admin-shell access.
const adminGuard = permissionGuard(ADMIN_PERMS);

// Gate for /set-password: must be signed in, and only relevant while a
// password change is actually owed. Bounces signed-out users to /login and
// already-settled users back to the app root (so the page can't be revisited).
const setPasswordGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitForAuth();
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);
  if (!auth.mustChangePassword()) return router.createUrlTree(['/']);
  return true;
};

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then(m => m.LoginComponent)
  },
  {
    // Forced-password-change gate — top-level (outside the shell) so the rest
    // of the app stays blocked until the temporary password is replaced.
    path: 'set-password',
    canActivate: [setPasswordGuard],
    loadComponent: () => import('./features/set-password/set-password.component').then(m => m.SetPasswordComponent)
  },
  {
    // Public, no-login result tracking reached from the invoice QR.
    path: 'track/:token',
    loadComponent: () => import('./features/track/track.component').then(m => m.TrackComponent)
  },
  {
    // Public, no-login report viewer reached from the WhatsApp/QR report link.
    // DOB/phone step-up only — must never bounce through the staff login.
    path: 'reports/public/:token',
    loadComponent: () => import('./features/reports/public-report/public-report.component').then(m => m.PublicReportComponent)
  },
  {
    path: '',
    // Lazy: the authed shell (sidebar, navbar, chat, calls…) stays OUT of the
    // initial bundle, so the public patient pages above (/reports/public,
    // /track) and /login boot without it. Signed-in users load it once.
    loadComponent: () => import('./layout/shell/shell.component').then(m => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      // Landing guard routes to /admin, /frontdesk, /lab/my-work, or /pathologist
      // based on the user's permissions — so a receptionist hitting '/' goes
      // to /frontdesk, not /admin (which would then 403).
      { path: '', pathMatch: 'full', canActivate: [landingGuard], children: [] },

      // In-app branch switch hop (BranchSwitchService): an empty, never-
      // shown stop so the current screen is re-created — and its guards re-
      // run — under the new branch without a page reload.
      { path: '_branch', children: [] },

      // Scanned order QR (`/o/:id`) → opens the order (collection drawer if the
      // user can collect, else the patient profile).
      {
        path: 'o/:id',
        loadComponent: () => import('./features/order-open/order-open.component').then(m => m.OrderOpenComponent)
      },
      {
        // Scanned patient ID-card QR (`/p/:id`) → opens the patient's profile.
        path: 'p/:id',
        loadComponent: () => import('./features/patient-open/patient-open.component').then(m => m.PatientOpenComponent)
      },

      // Admin — gated: hidden from nav + blocked at route level if the user
      // doesn't hold any admin-config permission (manage_tests/users/workflows).
      // Branch browsing (manage_branch/es) is NOT an admin-config perm.
      {
        path: 'admin',
        canActivate: [...routeGuards('/admin')],
        loadComponent: () => import('./features/admin/admin-overview.component').then(m => m.AdminOverviewComponent)
      },
      {
        // The settings hub (relevance-grouped tiles) — reached from the
        // overview's "Manage settings" + the sidebar "Manage" link.
        path: 'admin/manage',
        canActivate: [...routeGuards('/admin/manage')],
        loadComponent: () => import('./features/admin/admin-dashboard.component').then(m => m.AdminDashboardComponent)
      },
      {
        // Modules (Extensions) — enable/disable product modules + their features.
        path: 'admin/modules',
        canActivate: [...routeGuards('/admin/modules')],
        loadComponent: () => import('./features/admin/modules/modules.component').then(m => m.AdminModulesComponent)
      },
      {
        // Lab module settings hub — lab-SPECIFIC config lives inside the Lab
        // world (not the global admin): catalog, report template, lab settings,
        // referrals, notifications, KPIs. Gated on any lab-admin permission.
        path: 'lab/settings',
        canActivate: [...routeGuards('/lab/settings')],
        loadComponent: () => import('./features/lab/lab-settings-hub/lab-settings-hub.component').then(m => m.LabSettingsHubComponent)
      },
      {
        // Lab analyzers (instrument connector): list + setup wizard / status.
        // `new` opens the wizard for a new instrument.
        path: 'admin/instruments',
        canActivate: [...routeGuards('/admin/instruments')],
        loadComponent: () => import('./features/lab/instruments/instruments-list.component').then(m => m.InstrumentsListComponent)
      },
      {
        path: 'admin/instruments/:id',
        data: { recreateOn: ['id'] },
        canActivate: [...routeGuards('/admin/instruments')],
        loadComponent: () => import('./features/lab/instruments/instrument-editor.component').then(m => m.InstrumentEditorComponent)
      },
      {
        // Microbiology / Culture bench settings (lock timeout, TAT).
        path: 'admin/microbiology',
        canActivate: [...routeGuards('/admin/microbiology')],
        loadComponent: () => import('./features/lab/culture-settings/culture-settings.component').then(m => m.CultureSettingsComponent)
      },
      // Admin settings placeholders for not-yet-built modules — each opens a
      // "coming soon" hub listing that module's planned config, so the module-
      // first admin shows the full roadmap. adminGuard (not moduleGuard) so the
      // placeholder is visible regardless of entitlement.
      {
        path: 'admin/opd', canActivate: [adminGuard], data: { moduleId: 'opd' },
        loadComponent: () => import('./features/opd/admin/opd-admin.component').then(m => m.OpdAdminComponent)
      },
      {
        // OPD → Doctors: per-doctor consultation-fee grid.
        path: 'admin/opd/doctors', canActivate: [adminGuard],
        loadComponent: () => import('./features/opd/admin/doctors-admin.component').then(m => m.DoctorsAdminComponent)
      },
      {
        // OPD → Settings: the follow-up policy.
        path: 'admin/opd/settings', canActivate: [adminGuard],
        loadComponent: () => import('./features/opd/admin/opd-settings.component').then(m => m.OpdSettingsComponent)
      },
      {
        path: 'admin/ipd', canActivate: [adminGuard], data: { moduleId: 'ipd' },
        loadComponent: () => import('./features/modules/module-placeholder.component').then(m => m.ModulePlaceholderComponent)
      },
      {
        path: 'admin/pharmacy', canActivate: [adminGuard], data: { moduleId: 'pharmacy' },
        loadComponent: () => import('./features/modules/module-placeholder.component').then(m => m.ModulePlaceholderComponent)
      },
      {
        path: 'admin/payroll', canActivate: [adminGuard], data: { moduleId: 'payroll' },
        loadComponent: () => import('./features/modules/module-placeholder.component').then(m => m.ModulePlaceholderComponent)
      },
      {
        path: 'admin/insurance', canActivate: [adminGuard], data: { moduleId: 'insurance' },
        loadComponent: () => import('./features/modules/module-placeholder.component').then(m => m.ModulePlaceholderComponent)
      },
      {
        path: 'admin/radiology', canActivate: [adminGuard], data: { moduleId: 'radiology' },
        loadComponent: () => import('./features/modules/module-placeholder.component').then(m => m.ModulePlaceholderComponent)
      },
      {
        path: 'admin/emergency', canActivate: [adminGuard], data: { moduleId: 'emergency' },
        loadComponent: () => import('./features/modules/module-placeholder.component').then(m => m.ModulePlaceholderComponent)
      },
      {
        path: 'admin/blood-bank', canActivate: [adminGuard], data: { moduleId: 'bloodbank' },
        loadComponent: () => import('./features/modules/module-placeholder.component').then(m => m.ModulePlaceholderComponent)
      },
      {
        path: 'admin/users',
        canActivate: [...routeGuards('/admin/users')],
        loadComponent: () => import('./features/admin/users-access/users-access.component').then(m => m.UsersAccessComponent)
      },
      {
        path: 'admin/users/invite',
        canActivate: [...routeGuards('/admin/users/invite')],
        loadComponent: loadUserInvite
      },
      {
        path: 'admin/users/:id/edit',
        canActivate: [permissionGuard('manage_users')],
        loadComponent: loadUserEdit
      },
      {
        path: 'admin/roles/new',
        canActivate: [...routeGuards('/admin/roles/new')],
        loadComponent: loadRoleEditor
      },
      {
        path: 'admin/roles/:id/edit',
        canActivate: [permissionGuard('manage_users')],
        loadComponent: loadRoleEditor
      },
      {
        path: 'admin/tests',
        canActivate: [...routeGuards('/admin/tests')],
        loadComponent: () => import('./features/admin/tests/tests/tests.component').then(m => m.TestsComponent)
      },
      {
        path: 'admin/tests/new',
        canActivate: [...routeGuards('/admin/tests/new')],
        loadComponent: loadTestEditor
      },
      {
        path: 'admin/tests/:id/edit',
        canActivate: [permissionGuard('manage_tests')],
        loadComponent: loadTestEditor
      },
      {
        path: 'admin/branches',
        canActivate: [...routeGuards('/admin/branches')],
        loadComponent: () => import('./features/admin/branches/branches.component').then(m => m.BranchesComponent)
      },
      {
        path: 'admin/vendors',
        canActivate: [...routeGuards('/admin/vendors')],
        loadComponent: () => import('./features/admin/vendors/vendors.component').then(m => m.VendorsComponent)
      },
      {
        path: 'admin/referral-labs',
        canActivate: [...routeGuards('/admin/referral-labs')],
        loadComponent: () => import('./features/admin/referral-labs/referral-labs.component').then(m => m.ReferralLabsComponent)
      },
      {
        path: 'admin/lab-settings',
        canActivate: [...routeGuards('/admin/lab-settings')],
        loadComponent: () => import('./features/admin/lab-settings/lab-settings.component').then(m => m.LabSettingsComponent)
      },
      {
        // Per-station printing setup — available to any signed-in user (not
        // admin-only): the printer + label roll are physical to the station.
        path: 'printing',
        loadComponent: () => import('./features/admin/label-printer/label-printer.component').then(m => m.LabelPrinterComponent)
      },
      {
        // Per-user digital signature — available to any signed-in user; the
        // signature is saved to their account and drawn wherever they sign.
        path: 'signature',
        loadComponent: () => import('./features/user-signature/my-signature.component').then(m => m.MySignatureComponent)
      },
      {
        path: 'admin/organization',
        canActivate: [...routeGuards('/admin/organization')],
        loadComponent: () => import('./features/admin/organization/organization-settings.component').then(m => m.OrganizationSettingsComponent)
      },
      {
        path: 'admin/billing',
        canActivate: [...routeGuards('/admin/billing')],
        loadComponent: () => import('./features/admin/billing-config/billing-config.component').then(m => m.BillingConfigComponent)
      },
      {
        path: 'admin/inventory',
        canActivate: [...routeGuards('/admin/inventory')],
        loadComponent: () => import('./features/admin/inventory/inventory.component').then(m => m.InventoryComponent)
      },
      {
        path: 'admin/reports',
        canActivate: [...routeGuards('/admin/reports')],
        // Unsaved report-design changes ask before leaving (DialogService).
        canDeactivate: [(c: { canLeave?: () => Promise<boolean> }) => c?.canLeave ? c.canLeave() : true],
        loadComponent: () => import('./features/admin/report-template/report-template.component').then(m => m.ReportTemplateComponent)
      },
      {
        path: 'admin/referring-network',
        canActivate: [...routeGuards('/admin/referring-network')],
        loadComponent: () => import('./features/admin/referring-network/referring-network.component').then(m => m.ReferringNetworkComponent)
      },
      {
        // Partners hub — combined landing that surfaces Referral Labs, Vendor
        // Wallets and the Referring Network together (item 141). Each tile links
        // to its existing dedicated page; those routes above are unchanged.
        path: 'admin/partners',
        canActivate: [...routeGuards('/admin/partners')],
        loadComponent: () => import('./features/admin/partners/partners.component').then(m => m.PartnersComponent)
      },
      {
        path: 'admin/notifications',
        canActivate: [...routeGuards('/admin/notifications')],
        loadComponent: () => import('./features/admin/notifications-config/notifications-config.component').then(m => m.NotificationsConfigComponent)
      },
      {
        path: 'admin/workflows',
        canActivate: [...routeGuards('/admin/workflows')],
        loadComponent: () => import('./features/admin/workflow-builder/workflow-builder.component').then(m => m.WorkflowBuilderComponent)
      },
      {
        path: 'admin/process',
        canActivate: [...routeGuards('/admin/process')],
        loadComponent: () => import('./features/admin/process-builder/process-builder.component').then(m => m.ProcessBuilderComponent)
      },
      {
        // Generic host for a custom work-area — renders its placed actions as
        // panels (or launcher cards). System areas route to bespoke screens; this
        // is only hit for admin-created custom areas in the workflow-driven nav.
        path: 'w/:menuId',
        loadComponent: () => import('./features/work-area-host/work-area-host.component').then(m => m.WorkAreaHostComponent)
      },
      {
        path: 'admin/workflows/:screen',
        canActivate: [permissionGuard('manage_workflows')],
        loadComponent: () => import('./features/admin/workflow-builder/workflow-builder.component').then(m => m.WorkflowBuilderComponent)
      },
      {
        path: 'admin/workflows/:screen/steps/:stepId/fields/new',
        canActivate: [permissionGuard('manage_workflows')],
        loadComponent: () => import('./features/admin/workflow-builder/field-editor.component').then(m => m.FieldEditorComponent)
      },
      {
        path: 'admin/workflows/:screen/steps/:stepId/fields/:fieldId/edit',
        canActivate: [permissionGuard('manage_workflows')],
        loadComponent: () => import('./features/admin/workflow-builder/field-editor.component').then(m => m.FieldEditorComponent)
      },
      {
        path: 'setup',
        canActivate: [...routeGuards('/setup')],
        loadComponent: () => import('./features/admin/setup-wizard/setup-wizard.component').then(m => m.SetupWizardComponent)
      },
      {
        path: 'admin/kpis',
        canActivate: [...routeGuards('/admin/kpis')],
        loadComponent: () => import('./features/admin/kpis/kpi-config.component').then(m => m.KpiConfigComponent)
      },
      {
        path: 'admin/audit',
        canActivate: [...routeGuards('/admin/audit')],
        loadComponent: () => import('./features/admin/audit-log/audit-log.component').then(m => m.AuditLogComponent)
      },
      {
        path: 'admin/appointments',
        canActivate: [...routeGuards('/admin/appointments')],
        loadComponent: () => import('./features/admin/appointments-config/appointments-config.component').then(m => m.AppointmentsConfigComponent)
      },
      {
        path: 'admin/home-collection',
        canActivate: [...routeGuards('/admin/home-collection')],
        loadComponent: () => import('./features/admin/home-collection/home-collection-agents.component').then(m => m.HomeCollectionAgentsComponent)
      },
      {
        // Agent's own home-collection visit list.
        path: 'home-collections',
        canActivate: [...routeGuards('/home-collections')],
        loadComponent: () => import('./features/home-collection/my-home-collections.component').then(m => m.MyHomeCollectionsComponent)
      },

      // Frontdesk — orders / appointments / billing under one sticky
      // shell. Children swap inside the shell's <router-outlet>. Parent is
      // gated; child routes inherit auth + add per-action perms.
      {
        path: 'frontdesk',
        // Canonical front-desk gate (register/create) — same set the nav item
        // uses, so "sees Front Desk" == "can open it". Deliberately NOT
        // view_patient (a read cap lab techs hold, which used to leak them in).
        canActivate: [...routeGuards('/frontdesk')],
        loadComponent: () => import('./features/frontdesk/frontdesk-shell.component').then(m => m.FrontdeskShellComponent),
        children: [
          // Default = insights landing.
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () => import('./features/frontdesk/frontdesk-landing/frontdesk-landing.component').then(m => m.FrontdeskLandingComponent)
          },
          {
            path: 'order',
            // Order-create serves walk-ins AND appointment→order conversion —
            // appointment-only tenants (walk_in_order off) must still reach it.
            canActivate: [...routeGuards('/frontdesk/order')],
            loadComponent: () => import('./features/frontdesk/order-create/order-create.component').then(m => m.OrderCreateComponent)
          },
          {
            // OPD consult screen (separate from lab order-create). Reached only
            // via the module-scope fork; dormant until OPD is enabled + scoped.
            path: 'consult',
            loadComponent: () => import('./features/opd/consult-page/consult-page.component').then(m => m.ConsultPageComponent)
          },
          {
            path: 'billing',
            redirectTo: 'order'
          },
          {
            path: 'appointments',
            canActivate: [...routeGuards('/frontdesk/appointments')],
            loadComponent: () => import('./features/frontdesk/appointments-calendar/appointments-calendar.component').then(m => m.AppointmentsCalendarComponent)
          },
          {
            // Live collection queue (token / walk-up / home-collection per branch).
            path: 'queue',
            canActivate: [...routeGuards('/frontdesk/queue')],
            loadComponent: () => import('./features/frontdesk/collection-queue/collection-queue.component').then(m => m.CollectionQueueComponent)
          },
          {
            // Reception: assign home collections no agent area covered.
            path: 'home-collection',
            canActivate: [...routeGuards('/frontdesk/home-collection')],
            loadComponent: () => import('./features/frontdesk/home-collection-assign/home-collection-assign.component').then(m => m.HomeCollectionAssignComponent)
          },
          {
            path: 'appointments/new',
            canActivate: [...routeGuards('/frontdesk/appointments/new')],
            loadComponent: () => import('./features/frontdesk/book-appointment/book-appointment.component').then(m => m.BookAppointmentComponent)
          },
          {
            path: 'patients/new',
            canActivate: [...routeGuards('/frontdesk/patients/new')],
            loadComponent: () => import('./features/frontdesk/patient-register/patient-register.component').then(m => m.PatientRegisterComponent)
          },
          {
            path: 'patients/:id',
            canActivate: [permissionGuard(['view_patient', 'register_patient'])],
            loadComponent: () => import('./features/frontdesk/patient-profile/patient-profile.component').then(m => m.PatientProfileComponent)
          },
          {
            path: 'post-payment',
            canActivate: [...routeGuards('/frontdesk/post-payment')],
            loadComponent: () => import('./features/frontdesk/post-payment/post-payment.component').then(m => m.PostPaymentComponent)
          }
        ]
      },
      // Legacy /reception redirects so existing bookmarks still work.
      { path: 'reception',                  redirectTo: 'frontdesk' },
      { path: 'reception/order-create',     redirectTo: 'frontdesk/order' },
      { path: 'reception/billing',          redirectTo: 'frontdesk/order' },
      { path: 'reception/appointments/new', redirectTo: 'frontdesk/appointments/new' },
      { path: 'reception/patients/new',     redirectTo: 'frontdesk/patients/new' },
      { path: 'reception/patients/:id',     redirectTo: 'frontdesk/patients/:id' },
      { path: 'reception/post-payment',     redirectTo: 'frontdesk/post-payment' },

      // Lab — every route gated by the relevant lab perm.
      {
        path: 'lab/my-work',
        // enter_result for the result-entry tabs; receive_sample so lab
        // counter / intake-only staff can land on the page and use the
        // embedded "Lab Intake" tab.
        canActivate: [...routeGuards('/lab/my-work')],
        loadComponent: () => import('./features/lab/my-work/my-work.component').then(m => m.MyWorkComponent)
      },
      {
        path: 'lab/service-queue',
        redirectTo: '/lab/my-work'
      },
      {
        path: 'lab/collect',
        canActivate: [...routeGuards('/lab/collect')],
        loadComponent: () => import('./features/lab/sample-collection/sample-collection.component').then(m => m.SampleCollectionComponent)
      },
      // Dedicated-counter landing. Same component as /lab/collect — the
      // separate route exists so we can gate it on `collect_sample` and show
      // it in the top-level sidebar when collection_mode is dedicated_counter.
      {
        // Dedicated-counter route. Purely collect_sample + the workflow's
        // sample_collection action — a Receptionist who holds collect_sample
        // collects here too (no role-name suppression).
        path: 'sample-collection',
        canActivate: [...routeGuards('/sample-collection')],
        loadComponent: () => import('./features/lab/sample-collection/sample-collection.component').then(m => m.SampleCollectionComponent)
      },
      {
        // Lost & Found — triage records stranded when a workflow stage is
        // disabled mid-flight. Gated by the workflow action + any of the
        // action permissions (send-to-lab / reject / cancel).
        path: 'lost-and-found',
        canActivate: [...routeGuards('/lost-and-found')],
        loadComponent: () => import('./features/lost-and-found/lost-and-found.component').then(m => m.LostAndFoundComponent)
      },
      {
        path: 'lab/receive',
        canActivate: [...routeGuards('/lab/receive')],
        loadComponent: () => import('./features/lab/receive-samples/receive-samples.component').then(m => m.ReceiveSamplesComponent)
      },
      {
        path: 'lab/result/:id',
        // Another test on the same route = a fresh screen (the id is read once).
        data: { recreateOn: ['id'] },
        // A culture test opens the Culture case page instead (one route).
        canActivate: [permissionGuard(['enter_result', 'edit_result']), cultureResultRedirectGuard],
        loadComponent: () => import('./features/lab/result-entry/result-entry.component').then(m => m.ResultEntryComponent)
      },
      {
        // Sample-level result entry: ONE barcode scan loads ALL tests in
        // the tube. Replaces the old per-test scan-then-enter-then-scan
        // flow for labs that prefer the tube as the unit of work.
        path: 'lab/sample/:sampleId',
        // validate_result: the pathologist reviews the tube on this SAME
        // screen (?validate=1) — read-only + Reject/Validate footer.
        // A culture-only tube opens the Culture case page (/lab/culture/:id) —
        // search, scan, notifications, deep links and bookmarks alike.
        canActivate: [permissionGuard(['enter_result', 'edit_result', 'validate_result']), cultureSampleRedirectGuard],
        loadComponent: () => import('./features/lab/sample-result-entry/sample-result-entry.component').then(m => m.SampleResultEntryComponent)
      },
      {
        // Microbiology culture bench: the staged workspace for one culture case
        // (Gram → Growth → Identification → AST). Micro-tech only.
        path: 'lab/culture/:orderTestId',
        // Another case (or focus stage) = a fresh bench: the draft shelf can
        // hop case → case (a culture tube's draft redirects here).
        data: { recreateOn: ['orderTestId', '?stage'] },
        // Pathologists open it too: culture sign-out lives here (owner).
        canActivate: [permissionGuard(['culture_workbench', 'validate_result']), moduleGuard('lab')],
        loadComponent: () => import('./features/lab/culture-workbench/culture-workbench.component').then(m => m.CultureWorkbenchComponent)
      },

      // OPD Consult Room — the doctor's day (token queue + room). Access is
      // profile-based (auth.me.isDoctor) — the backend Forbids non-doctors,
      // so the route carries no permission guard.
      {
        path: 'doctor',
        loadComponent: () => import('./features/opd/doctor/doctor-queue.component').then(m => m.DoctorQueueComponent)
      },
      {
        path: 'doctor/consult/:id',
        loadComponent: () => import('./features/opd/doctor/consult-room.component').then(m => m.ConsultRoomComponent)
      },

      // Critical results — the NABL acknowledgement register (lab + pathologist
      // + quality). Reads: enter_result / validate_result / view_audit_log.
      {
        // Analyzer runs that matched no tube (attach to a sample) + QC runs.
        path: 'lab/analyzer-results',
        canActivate: [...routeGuards('/lab/analyzer-results')],
        loadComponent: () => import('./features/lab/analyzer-results/analyzer-results.component').then(m => m.AnalyzerResultsComponent)
      },
      {
        path: 'lab/critical-results',
        canActivate: [...routeGuards('/lab/critical-results')],
        loadComponent: () => import('./features/lab/critical-results/critical-results.component').then(m => m.CriticalResultsComponent)
      },

      // Pathologist — only doctors with validate_result.
      {
        path: 'pathologist',
        canActivate: [...routeGuards('/pathologist')],
        loadComponent: () => import('./features/pathologist/pending-validation/pending-validation.component').then(m => m.PendingValidationComponent)
      },
      {
        path: 'pathologist/validate/:id',
        canActivate: [permissionGuard('validate_result'), cultureValidateRedirectGuard],
        loadComponent: () => import('./features/pathologist/validate-result/validate-result.component').then(m => m.ValidateResultComponent)
      },

      // Stores — the inventory operator work area (scan-first receive / issue /
      // count). Gated on any inventory permission.
      {
        path: 'stores',
        canActivate: [...routeGuards('/stores')],
        loadComponent: () => import('./features/stores/stores.component').then(m => m.StoresComponent)
      },

      // Clinical modules (OPD / IPD / Pharmacy / Payroll) — placeholder shells
      // gated purely on tenant entitlement. When a module is off the guard
      // bounces to landing; when on, its "coming soon" shell renders until the
      // real screens ship. Each supplies its catalog id via route data.
      {
        path: 'opd',
        canActivate: [moduleGuard('opd')],
        data: { moduleId: 'opd' },
        loadComponent: () => import('./features/modules/module-placeholder.component').then(m => m.ModulePlaceholderComponent)
      },
      {
        path: 'ipd',
        canActivate: [moduleGuard('ipd')],
        data: { moduleId: 'ipd' },
        loadComponent: () => import('./features/modules/module-placeholder.component').then(m => m.ModulePlaceholderComponent)
      },
      {
        path: 'pharmacy',
        canActivate: [moduleGuard('pharmacy')],
        data: { moduleId: 'pharmacy' },
        loadComponent: () => import('./features/modules/module-placeholder.component').then(m => m.ModulePlaceholderComponent)
      },
      {
        path: 'payroll',
        canActivate: [moduleGuard('payroll')],
        data: { moduleId: 'payroll' },
        loadComponent: () => import('./features/modules/module-placeholder.component').then(m => m.ModulePlaceholderComponent)
      },

      // Results — deliver_report runs the delivery desk; view_report alone
      // (Lab Tech, Branch/Quality Manager) opens it view-only (see
      // ROUTE_ACCESS['/reports']). The viewer admits the same readers plus
      // validate_result (pathologists preview a report).
      {
        path: 'reports',
        canActivate: [...routeGuards('/reports')],
        loadComponent: () => import('./features/reports/report-queue/report-queue.component').then(m => m.ReportQueueComponent)
      },
      {
        path: 'reports/view/:id',
        canActivate: [permissionGuard(['deliver_report', 'view_report', 'validate_result'])],
        loadComponent: () => import('./features/reports/report-viewer/report-viewer.component').then(m => m.ReportViewerComponent)
      },

      // Billing counter (separate-counter mode).
      {
        path: 'billing-counter',
        canActivate: [...routeGuards('/billing-counter')],
        loadComponent: () => import('./features/billing-counter/billing-counter.component').then(m => m.BillingCounterComponent)
      },

      // Messages — Teams-style chat + group calling. No moduleGuard here on
      // purpose: when the module is off we want the page to render its locked
      // "upgrade" screen on direct access rather than silently redirect. The
      // component gates itself (moduleOff) and skips connecting the hubs.
      {
        path: 'messages',
        canActivate: [...routeGuards('/messages')],
        // New design → the nd-kit screen; classic → the original page.
        loadComponent: () => import('./features/messages/messages-route.component').then(m => m.MessagesRouteComponent)
      },

      // Ops
      {
        path: 'dashboard',
        canActivate: [...routeGuards('/dashboard')],
        loadComponent: () => import('./features/dashboard/tat-board/tat-board.component').then(m => m.TatBoardComponent)
      },

      // Finance — hub (end-to-end money in/out by product line) + daily statement.
      {
        path: 'finance',
        canActivate: [...routeGuards('/finance')],
        loadComponent: () => import('./features/finance/finance-hub.component').then(m => m.FinanceHubComponent)
      },
      {
        path: 'finance/daily',
        canActivate: [...routeGuards('/finance/daily')],
        loadComponent: () => import('./features/finance/daily-statement.component').then(m => m.DailyStatementComponent)
      },

      // 403
      {
        path: '403',
        loadComponent: () => import('./features/shared/placeholder.component').then(m => m.PlaceholderComponent),
        data: { title: 'Forbidden', description: 'You do not have permission for this action.' }
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
