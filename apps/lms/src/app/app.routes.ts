import { inject } from '@angular/core';
import { CanActivateFn, Route, Router } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { AuthService } from './core/auth/auth.service';
import { landingGuard } from './core/auth/landing.guard';
import { permissionGuard } from './core/auth/permission.guard';
import { workflowGuard } from './core/auth/workflow.guard';
import { ShellComponent } from './layout/shell/shell.component';

const ADMIN_PERMS = ['manage_tests', 'manage_users', 'manage_workflows', 'manage_branches'];
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
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      // Landing guard routes to /admin, /frontdesk, /lab/my-work, or /pathologist
      // based on the user's permissions — so a receptionist hitting '/' goes
      // to /frontdesk, not /admin (which would then 403).
      { path: '', pathMatch: 'full', canActivate: [landingGuard], children: [] },

      // Admin — gated: hidden from nav + blocked at route level if the user
      // doesn't hold any admin permission (manage_tests/users/workflows/branches).
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/admin-dashboard.component').then(m => m.AdminDashboardComponent)
      },
      {
        path: 'admin/users',
        canActivate: [permissionGuard('manage_users')],
        loadComponent: () => import('./features/admin/users-access/users-access.component').then(m => m.UsersAccessComponent)
      },
      {
        path: 'admin/users/invite',
        canActivate: [permissionGuard('manage_users')],
        loadComponent: () => import('./features/admin/users-access/user-invite.component').then(m => m.UserInviteComponent)
      },
      {
        path: 'admin/roles/new',
        canActivate: [permissionGuard('manage_users')],
        loadComponent: () => import('./features/admin/users-access/role-editor.component').then(m => m.RoleEditorComponent)
      },
      {
        path: 'admin/roles/:id/edit',
        canActivate: [permissionGuard('manage_users')],
        loadComponent: () => import('./features/admin/users-access/role-editor.component').then(m => m.RoleEditorComponent)
      },
      {
        path: 'admin/tests',
        canActivate: [permissionGuard('manage_tests')],
        loadComponent: () => import('./features/admin/tests/tests.component').then(m => m.TestsComponent)
      },
      {
        path: 'admin/tests/new',
        canActivate: [permissionGuard('manage_tests')],
        loadComponent: () => import('./features/admin/tests/test-editor.component').then(m => m.TestEditorComponent)
      },
      {
        path: 'admin/tests/:id/edit',
        canActivate: [permissionGuard('manage_tests')],
        loadComponent: () => import('./features/admin/tests/test-editor.component').then(m => m.TestEditorComponent)
      },
      {
        path: 'admin/branches',
        canActivate: [permissionGuard('manage_branches')],
        loadComponent: () => import('./features/admin/branches/branches.component').then(m => m.BranchesComponent)
      },
      {
        path: 'admin/vendors',
        canActivate: [permissionGuard('manage_tenant')],
        loadComponent: () => import('./features/admin/vendors/vendors.component').then(m => m.VendorsComponent)
      },
      {
        path: 'admin/lab-settings',
        canActivate: [permissionGuard(['manage_lab_settings', 'manage_branches'])],
        loadComponent: () => import('./features/admin/lab-settings/lab-settings.component').then(m => m.LabSettingsComponent)
      },
      {
        path: 'admin/billing',
        canActivate: [permissionGuard(['manage_tenant', 'manage_branches'])],
        loadComponent: () => import('./features/admin/billing-config/billing-config.component').then(m => m.BillingConfigComponent)
      },
      {
        path: 'admin/inventory',
        canActivate: [permissionGuard('manage_inventory')],
        loadComponent: () => import('./features/admin/inventory/inventory.component').then(m => m.InventoryComponent)
      },
      {
        path: 'admin/reports',
        canActivate: [permissionGuard(['manage_tenant', 'manage_tests'])],
        loadComponent: () => import('./features/admin/report-template/report-template.component').then(m => m.ReportTemplateComponent)
      },
      {
        path: 'admin/referring-network',
        canActivate: [permissionGuard(['manage_tenant', 'manage_admin'])],
        loadComponent: () => import('./features/admin/referring-network/referring-network.component').then(m => m.ReferringNetworkComponent)
      },
      {
        path: 'admin/notifications',
        canActivate: [permissionGuard(['manage_tenant', 'manage_branches'])],
        loadComponent: () => import('./features/admin/notifications-config/notifications-config.component').then(m => m.NotificationsConfigComponent)
      },
      {
        path: 'admin/workflows',
        canActivate: [permissionGuard('manage_workflows')],
        loadComponent: () => import('./features/admin/workflow-builder/workflow-builder.component').then(m => m.WorkflowBuilderComponent)
      },
      {
        path: 'admin/process',
        canActivate: [permissionGuard('manage_workflows')],
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
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/setup-wizard/setup-wizard.component').then(m => m.SetupWizardComponent)
      },
      {
        path: 'admin/kpis',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/kpis/kpi-config.component').then(m => m.KpiConfigComponent)
      },
      {
        path: 'admin/audit',
        canActivate: [permissionGuard('view_audit_log')],
        loadComponent: () => import('./features/admin/audit-log/audit-log.component').then(m => m.AuditLogComponent)
      },
      {
        path: 'admin/appointments',
        canActivate: [permissionGuard(['manage_branches', 'manage_tenant'])],
        loadComponent: () => import('./features/admin/appointments-config/appointments-config.component').then(m => m.AppointmentsConfigComponent)
      },
      {
        path: 'admin/home-collection',
        canActivate: [permissionGuard(['manage_home_collection', 'manage_branches'])],
        loadComponent: () => import('./features/admin/home-collection/home-collection-agents.component').then(m => m.HomeCollectionAgentsComponent)
      },
      {
        // Agent's own home-collection visit list.
        path: 'home-collections',
        canActivate: [permissionGuard('collect_sample'), workflowGuard('home_visits')],
        loadComponent: () => import('./features/home-collection/my-home-collections.component').then(m => m.MyHomeCollectionsComponent)
      },

      // Frontdesk — orders / appointments / billing under one sticky
      // shell. Children swap inside the shell's <router-outlet>. Parent is
      // gated; child routes inherit auth + add per-action perms.
      {
        path: 'frontdesk',
        canActivate: [permissionGuard(['register_patient', 'create_order', 'view_patient'])],
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
            canActivate: [permissionGuard('create_order'), workflowGuard('walk_in_order')],
            loadComponent: () => import('./features/frontdesk/order-create/order-create.component').then(m => m.OrderCreateComponent)
          },
          {
            path: 'billing',
            canActivate: [permissionGuard(['create_bill', 'collect_payment']), workflowGuard('billing')],
            loadComponent: () => import('./features/frontdesk/billing/billing.component').then(m => m.BillingComponent)
          },
          {
            path: 'appointments',
            canActivate: [permissionGuard(['register_patient', 'create_order', 'view_order']), workflowGuard('appointment')],
            loadComponent: () => import('./features/frontdesk/appointments-calendar/appointments-calendar.component').then(m => m.AppointmentsCalendarComponent)
          },
          {
            // Live collection queue (token / walk-up / home-collection per branch).
            path: 'queue',
            canActivate: [permissionGuard(['register_patient', 'create_order', 'view_order', 'collect_sample']), workflowGuard('queue')],
            loadComponent: () => import('./features/frontdesk/collection-queue/collection-queue.component').then(m => m.CollectionQueueComponent)
          },
          {
            // Reception: assign home collections no agent area covered.
            path: 'home-collection',
            canActivate: [permissionGuard(['manage_home_collection', 'register_patient', 'create_order']), workflowGuard('home_visits')],
            loadComponent: () => import('./features/frontdesk/home-collection-assign/home-collection-assign.component').then(m => m.HomeCollectionAssignComponent)
          },
          {
            path: 'appointments/new',
            canActivate: [permissionGuard(['register_patient', 'create_order']), workflowGuard('appointment')],
            loadComponent: () => import('./features/frontdesk/book-appointment/book-appointment.component').then(m => m.BookAppointmentComponent)
          },
          {
            path: 'patients/new',
            canActivate: [permissionGuard('register_patient'), workflowGuard('patient_registration')],
            loadComponent: () => import('./features/frontdesk/patient-register/patient-register.component').then(m => m.PatientRegisterComponent)
          },
          {
            path: 'patients/:id',
            canActivate: [permissionGuard(['view_patient', 'register_patient'])],
            loadComponent: () => import('./features/frontdesk/patient-profile/patient-profile.component').then(m => m.PatientProfileComponent)
          },
          {
            path: 'post-payment',
            canActivate: [permissionGuard(['collect_payment', 'create_bill'])],
            loadComponent: () => import('./features/frontdesk/post-payment/post-payment.component').then(m => m.PostPaymentComponent)
          }
        ]
      },
      // Legacy /reception redirects so existing bookmarks still work.
      { path: 'reception',                  redirectTo: 'frontdesk' },
      { path: 'reception/order-create',     redirectTo: 'frontdesk/order' },
      { path: 'reception/billing',          redirectTo: 'frontdesk/billing' },
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
        canActivate: [permissionGuard(['enter_result', 'receive_sample']), workflowGuard('result_entry')],
        loadComponent: () => import('./features/lab/my-work/my-work.component').then(m => m.MyWorkComponent)
      },
      {
        path: 'lab/service-queue',
        redirectTo: '/lab/my-work'
      },
      {
        path: 'lab/collect',
        canActivate: [permissionGuard('collect_sample'), workflowGuard('sample_collection')],
        loadComponent: () => import('./features/lab/sample-collection/sample-collection.component').then(m => m.SampleCollectionComponent)
      },
      // Dedicated-counter landing. Same component as /lab/collect — the
      // separate route exists so we can gate it on `collect_sample` and show
      // it in the top-level sidebar when collection_mode is dedicated_counter.
      {
        // Dedicated-counter route. `effective: true` honours mode-aware
        // suppression so a Receptionist (whose seeded role still includes
        // collect_sample) is bounced when collection_mode = dedicated_counter.
        path: 'sample-collection',
        canActivate: [permissionGuard('collect_sample', { effective: true }), workflowGuard('sample_collection')],
        loadComponent: () => import('./features/lab/sample-collection/sample-collection.component').then(m => m.SampleCollectionComponent)
      },
      {
        path: 'lab/receive',
        canActivate: [permissionGuard('receive_sample'), workflowGuard('lab_intake')],
        loadComponent: () => import('./features/lab/receive-samples/receive-samples.component').then(m => m.ReceiveSamplesComponent)
      },
      {
        path: 'lab/result/:id',
        canActivate: [permissionGuard(['enter_result', 'edit_result'])],
        loadComponent: () => import('./features/lab/result-entry/result-entry.component').then(m => m.ResultEntryComponent)
      },
      {
        // Sample-level result entry: ONE barcode scan loads ALL tests in
        // the tube. Replaces the old per-test scan-then-enter-then-scan
        // flow for labs that prefer the tube as the unit of work.
        path: 'lab/sample/:sampleId',
        canActivate: [permissionGuard(['enter_result', 'edit_result'])],
        loadComponent: () => import('./features/lab/sample-result-entry/sample-result-entry.component').then(m => m.SampleResultEntryComponent)
      },

      // Pathologist — only doctors with validate_result.
      {
        path: 'pathologist',
        canActivate: [permissionGuard('validate_result'), workflowGuard('validate')],
        loadComponent: () => import('./features/pathologist/pending-validation/pending-validation.component').then(m => m.PendingValidationComponent)
      },
      {
        path: 'pathologist/validate/:id',
        canActivate: [permissionGuard('validate_result')],
        loadComponent: () => import('./features/pathologist/validate-result/validate-result.component').then(m => m.ValidateResultComponent)
      },

      // Reports — only roles that actively deliver reports land here. Lab
      // techs hold view_report (so they can read a finalized result) but
      // shouldn't see the delivery queue. The viewer route stays slightly
      // looser since pathologists / admins reasonably preview reports.
      {
        path: 'reports',
        canActivate: [permissionGuard('deliver_report'), workflowGuard('results')],
        loadComponent: () => import('./features/reports/report-queue/report-queue.component').then(m => m.ReportQueueComponent)
      },
      {
        path: 'reports/view/:id',
        canActivate: [permissionGuard(['deliver_report', 'validate_result'])],
        loadComponent: () => import('./features/reports/report-viewer/report-viewer.component').then(m => m.ReportViewerComponent)
      },

      // Billing counter (separate-counter mode).
      {
        path: 'billing-counter',
        canActivate: [permissionGuard(['create_bill', 'collect_payment']), workflowGuard('billing')],
        loadComponent: () => import('./features/billing-counter/billing-counter.component').then(m => m.BillingCounterComponent)
      },

      // Messages — Teams-style chat + group calling.
      {
        path: 'messages',
        canActivate: [workflowGuard('messages')],
        loadComponent: () => import('./features/messages/messages-page.component').then(m => m.MessagesPageComponent)
      },

      // Ops
      {
        path: 'dashboard',
        canActivate: [permissionGuard(['view_tat_dashboard', 'view_dashboard'])],
        loadComponent: () => import('./features/dashboard/tat-board/tat-board.component').then(m => m.TatBoardComponent)
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
