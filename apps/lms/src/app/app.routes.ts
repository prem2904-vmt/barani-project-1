import { inject } from '@angular/core';
import { cultureResultRedirectGuard, cultureSampleRedirectGuard, cultureValidateRedirectGuard } from './core/navigation/culture-redirect.guard';
import { ORDER_PAY_RECREATE_ON } from './core/navigation/identity-reuse.strategy';
import { CanActivateFn, Route, Router } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { consentGuard } from './features/ai-connector/consent-redirect';
import { betaGuard } from './core/services/beta-features.service';
import { AuthService } from './core/auth/auth.service';
import { landingGuard } from './core/auth/landing.guard';
import { moduleGuard } from './core/auth/module.guard';
import { permissionGuard } from './core/auth/permission.guard';
import { routeGuards } from './core/auth/route-guards';
import { TEST_MASTER_PERMS } from './core/auth/route-access';
import { loadTestEditor } from './features/admin/tests/test-editor/test-editor.loader';
import { loadRoleEditor, loadUserEdit, loadUserInvite } from './features/admin/users-access/user-editors.loader';
import { OPD_ADMIN_ROUTES, OPD_FRONTDESK_CHILD_ROUTES, OPD_SHELL_ROUTES } from './features/opd/opd.routes';
import { OPD_FULL_SCREEN_ADMIN, SETTINGS_FULL_PAGE_ROUTES, SETTINGS_REDIRECTS, SETTINGS_SHELL_ROUTE, SHELL_HOSTED_SHEET_PATHS } from './features/admin/settings/settings.routes';
import { CASESHEET_SHELL_ROUTES, withAppModes } from './features/casesheets/casesheets.routes';

// Perms that open the ADMIN CONFIG shell (overview, manage hub, modules, setup,
// KPIs). Deliberately EXCLUDES manage_branch(es): those are read-tier branch
// browsing (see RoleSeeder) held by Branch Managers, who must NOT reach tenant
// config. Their legit destinations — /admin/branches, /admin/audit,
// home-collection — are separate routes gated on their own perms and surfaced
// via the "More" nav, so they need no admin-shell access.

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


// withAppModes (features/casesheets/casesheets.routes.ts, plan §4.4): the public case-sheet site's routes match
// ONLY in casesheets mode (core/app-mode.ts) and every route below ONLY in LMS mode.
export const appRoutes: Route[] = withAppModes([
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
    // AI connector (MCP) OAuth consent — Supabase's OAuth 2.1 server sends
    // the browser here with ?authorization_id=…. Outside the shell like
    // /login; consentGuard keeps this exact URL through login and the
    // temporary-password step.
    path: 'oauth/consent',
    // BETA: pf.mcp() in this browser + server flag + dev; off ⇒ the normal unknown-URL handling.
    canActivate: [betaGuard('mcp'), consentGuard],
    loadComponent: () => import('./features/ai-connector/oauth-consent.page').then(m => m.OAuthConsentPage)
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
    // Public, no-login landing of a Prefrontal Bridge QR (`/b#1.S.C.P.F`,
    // bridge-api v1 B.6): reads the fragment, hands it to /admin/bridges/add
    // through sessionStorage (login first if needed). No secret in a URL param.
    path: 'b',
    loadComponent: () => import('./features/bridges/bridge-link.page').then(m => m.BridgeLinkPage)
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
        // "Open in Prefrontal" link from an AI connector answer (`/r/P-K7Q2X`, `/r/T-3`): a plain server
        // lookup of the expiring code, then the patient / order / staff card. Beta-gated like the connector.
        path: 'r/:code',
        canActivate: [betaGuard('mcp')],
        loadComponent: () => import('./features/ai-connector/code-open.page').then(m => m.CodeOpenPage)
      },
      {
        // Scanned patient ID-card QR (`/p/:id`) → opens the patient's profile.
        path: 'p/:id',
        loadComponent: () => import('./features/patient-open/patient-open.component').then(m => m.PatientOpenComponent)
      },
      {
        // READ-ONLY patient profile outside the front desk (Share to Messages,
        // 2026-10-31): lab techs / pathologists hold view_patient but not the
        // front-desk set, so /frontdesk/patients/:id was a dead end for a shared
        // patient. Same screen; the API's own permissions stay the real gate
        // (its actions are permission-gated inside the screen).
        path: 'patients/:id',
        canActivate: [permissionGuard(['view_patient', 'register_patient'])],
        loadComponent: () => import('./features/frontdesk/patient-profile/patient-profile.component').then(m => m.PatientProfileComponent)
      },

      // Settings: card-style settings open INSIDE the shell (Test Master's frame: band, side card of categories, main
      // card of rows); full-screen pages (Test Master, Report design, Users, Analyzers …) are their own pages. The whole
      // table lives in features/admin/settings/settings.routes.ts. Old links redirect there.
      SETTINGS_SHELL_ROUTE,
      ...SETTINGS_FULL_PAGE_ROUTES,
      ...SETTINGS_REDIRECTS,

      // Admin — gated: hidden from nav + blocked at route level if the user
      // doesn't hold any admin-config permission (manage_tests/users/workflows).
      // Branch browsing (manage_branch/es) is NOT an admin-config perm.
      {
        path: 'admin',
        canActivate: [...routeGuards('/admin')],
        loadComponent: () => import('./features/admin/admin-overview.component').then(m => m.AdminOverviewComponent)
      },
      {
        // "Connect an analyzer" setup helper (desktop app; the web explains).
        path: 'admin/instruments/connect',
        canActivate: [...routeGuards('/admin/instruments')],
        loadComponent: () => import('./features/lab/instruments/connect-wizard/connect-wizard.component').then(m => m.ConnectWizardComponent)
      },
      {
        path: 'admin/instruments/:id',
        data: { recreateOn: ['id'] },
        canActivate: [...routeGuards('/admin/instruments')],
        loadComponent: () => import('./features/lab/instruments/instrument-editor.component').then(m => m.InstrumentEditorComponent)
      },
      {
        path: 'admin/bridges/add',
        canActivate: [...routeGuards('/admin/bridges')],
        loadComponent: () => import('./features/admin/bridges/bridge-add.component').then(m => m.BridgeAddComponent)
      },
      {
        path: 'admin/bridges/:id',
        data: { recreateOn: ['id'] },
        canActivate: [...routeGuards('/admin/bridges')],
        loadComponent: () => import('./features/admin/bridges/bridge-detail.component').then(m => m.BridgeDetailComponent)
      },
      // Admin settings placeholders for not-yet-built modules — each opens a
      // "coming soon" hub listing that module's planned config, so the module-
      // first admin shows the full roadmap. adminGuard (not moduleGuard) so the
      // placeholder is visible regardless of entitlement.
      // OPD admin (OPD dark build) — every route adminGuard + opdGuard; defined
      // ONCE in features/opd/opd.routes.ts (feature agents never edit here).
      // The ones the Settings shell hosts (departments, doctors, forms, workflow, settings) and the pharmacy pair are
      // listed ONCE in features/admin/settings/settings.routes.ts; only the full-screen editors stay here.
      ...OPD_ADMIN_ROUTES.filter(r => OPD_FULL_SCREEN_ADMIN.has(r.path ?? '')),
      // Case sheets (part of IPD): Admin → IPD → MyPrefrontal + the lab's sheets, each behind casesheetGuard;
      // defined ONCE in features/casesheets/casesheets.routes.ts.
      ...CASESHEET_SHELL_ROUTES.filter(r => !SHELL_HOSTED_SHEET_PATHS.includes(r.path ?? '')),
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
        path: 'admin/tests/new',
        canActivate: [...routeGuards('/admin/tests/new')],
        loadComponent: loadTestEditor
      },
      {
        path: 'admin/tests/:id/edit',
        canActivate: [permissionGuard(TEST_MASTER_PERMS)],
        loadComponent: loadTestEditor
      },
      { path: 'admin/whatsapp', redirectTo: '/admin/org/channels?tab=whatsapp', pathMatch: 'full' },
      { path: 'admin/lab-settings/whatsapp', redirectTo: '/admin/reports?tab=sending', pathMatch: 'full' },
      { path: 'admin/email', redirectTo: '/admin/org/channels?tab=email', pathMatch: 'full' },
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
        // Passkeys (beta, dev only) — any signed-in user manages their own.
        // Beta off ⇒ the same betaGuard as every beta route (redirect to '/');
        // the page still renders "not available" if reached otherwise.
        path: 'security',
        canActivate: [betaGuard('passkeys')],
        loadComponent: () => import('./features/account-security/passkeys.component').then(m => m.PasskeysComponent)
      },
      {
        // Files (beta `neuron`, dev only): one screen for every app's files, one editor for all of them. A screen opens an editor
        // (SheetEditorService.open) and the back chevron returns there; Files home lists everything. Beta off => betaGuard sends a visit to '/'.
        // Leaving an editor with unsaved changes asks first (DialogService). A lab without Full Files gets the same screens, read-only.
        path: 'files',
        canActivate: [betaGuard('neuron')],
        loadComponent: () => import('./features/files/files-home.page').then(m => m.FilesHomePage)
      },
      {
        // `/files/<kind>/start` is the app's OWN start screen (the editor opened without a file: New, templates, Recent, Open); the Start menu,
        // the bottom bar and pins open it. Any other second segment is a stored file's id or `new`.
        path: 'files/:kind/:id',
        canActivate: [betaGuard('neuron')],
        canDeactivate: [(c: { canLeave?: () => Promise<boolean> }) => c?.canLeave ? c.canLeave() : true],
        data: { recreateOn: ['kind', 'id'] },
        loadComponent: () => import('./features/files/files-editor.page').then(m => m.FilesEditorPage)
      },
      // The names the earlier builds used keep working.
      { path: 'sheet', redirectTo: () => inject(Router).parseUrl('/files?type=sheet') },
      { path: 'office', redirectTo: () => inject(Router).parseUrl('/files') },
      { path: 'admin/office', redirectTo: '/admin/files', pathMatch: 'full' },
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
      // Top-bar branding (name, logo, mode) is part of the ONE Organization profile now; the old URL keeps working.
      {
        path: 'admin/audit',
        canActivate: [...routeGuards('/admin/audit')],
        loadComponent: () => import('./features/admin/audit-log/audit-log.component').then(m => m.AuditLogComponent)
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
            // Modify → Save goes ?editOrderId=X → ?orderId=X on this same route:
            // rebuild so the pay step shows for the updated amount (OPS-113).
            data: { recreateOn: ORDER_PAY_RECREATE_ON },
            loadComponent: () => import('./features/frontdesk/order-create/order-create.component').then(m => m.OrderCreateComponent)
          },
          // Legacy OPD desk consult page — OPD-gated (OPD dark build).
          ...OPD_FRONTDESK_CHILD_ROUTES,
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

      // OPD (OPD dark build): every OPD work-area route incl. the legacy doctor
      // Consult Room, each behind opdGuard — see features/opd/opd.routes.ts.
      ...OPD_SHELL_ROUTES,

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
      // (OPD's /opd lives in OPD_SHELL_ROUTES above — gated by the OPD gate.)
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
        // New design → the pf-kit screen; classic → the original page.
        loadComponent: () => import('./features/messages/messages-route.component').then(m => m.MessagesRouteComponent)
      },

      // Ops
      {
        path: 'dashboard',
        canActivate: [...routeGuards('/dashboard')],
        loadComponent: () => import('./features/dashboard/tat-board/tat-board.component').then(m => m.TatBoardComponent)
      },
      {
        path: 'insights',
        canActivate: [...routeGuards('/insights')],
        loadComponent: () => import('./features/insights/insights.component').then(m => m.InsightsComponent)
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
      {
        // Credit accounts — the money actions (top up, record a payment, email a statement, history). The account
        // SETUP is in Settings › Billing and taxes › Credit accounts (`/admin/billing?tab=credit`).
        path: 'finance/credit-accounts',
        canActivate: [...routeGuards('/finance/credit-accounts')],
        data: { creditView: 'money' },
        loadComponent: () => import('./features/admin/vendors/vendors.component').then(m => m.VendorsComponent)
      },
      {
        // Expenses — a PRIMARY everyday screen (main nav): My expenses,
        // All expenses, the cashier's Day closing (expense_viewer / _modifier / _admin).
        path: 'expenses',
        canActivate: [...routeGuards('/expenses')],
        loadComponent: () => import('./features/finance/expenses/expense-tracker.component').then(m => m.ExpenseTrackerComponent)
      },
      // Old deep link (Finance → Expense tracker) keeps working.
      { path: 'finance/expenses', redirectTo: 'expenses', pathMatch: 'full' },

      // 403
      {
        path: '403',
        loadComponent: () => import('./features/shared/placeholder.component').then(m => m.PlaceholderComponent),
        data: { title: 'Forbidden', description: 'You do not have permission for this action.' }
      }
    ]
  },
  { path: '**', redirectTo: '' }
]);
