import { Route } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { landingGuard } from './core/auth/landing.guard';
import { permissionGuard } from './core/auth/permission.guard';
import { ShellComponent } from './layout/shell/shell.component';

const ADMIN_PERMS = ['manage_tests', 'manage_users', 'manage_workflows', 'manage_branches'];
const adminGuard = permissionGuard(ADMIN_PERMS);

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then(m => m.LoginComponent)
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
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/users-access/users-access.component').then(m => m.UsersAccessComponent)
      },
      {
        path: 'admin/users/invite',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/users-access/user-invite.component').then(m => m.UserInviteComponent)
      },
      {
        path: 'admin/roles/new',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/users-access/role-editor.component').then(m => m.RoleEditorComponent)
      },
      {
        path: 'admin/roles/:id/edit',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/users-access/role-editor.component').then(m => m.RoleEditorComponent)
      },
      {
        path: 'admin/tests',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/tests/tests.component').then(m => m.TestsComponent)
      },
      {
        path: 'admin/tests/new',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/tests/test-editor.component').then(m => m.TestEditorComponent)
      },
      {
        path: 'admin/tests/:id/edit',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/tests/test-editor.component').then(m => m.TestEditorComponent)
      },
      {
        path: 'admin/branches',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/branches/branches.component').then(m => m.BranchesComponent)
      },
      {
        path: 'admin/lab-settings',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/lab-settings/lab-settings.component').then(m => m.LabSettingsComponent)
      },
      {
        path: 'admin/billing',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/billing-config/billing-config.component').then(m => m.BillingConfigComponent)
      },
      {
        path: 'admin/reports',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/report-template/report-template.component').then(m => m.ReportTemplateComponent)
      },
      {
        path: 'admin/notifications',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/notifications-config/notifications-config.component').then(m => m.NotificationsConfigComponent)
      },
      {
        path: 'admin/workflows',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/workflow-builder/workflow-builder.component').then(m => m.WorkflowBuilderComponent)
      },
      {
        path: 'admin/workflows/:screen',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/workflow-builder/workflow-builder.component').then(m => m.WorkflowBuilderComponent)
      },
      {
        path: 'admin/workflows/:screen/steps/:stepId/fields/new',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/workflow-builder/field-editor.component').then(m => m.FieldEditorComponent)
      },
      {
        path: 'admin/workflows/:screen/steps/:stepId/fields/:fieldId/edit',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/workflow-builder/field-editor.component').then(m => m.FieldEditorComponent)
      },
      {
        path: 'setup',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/setup-wizard/setup-wizard.component').then(m => m.SetupWizardComponent)
      },

      // Frontdesk — orders / appointments / billing under one sticky
      // shell. Children swap inside the shell's <router-outlet>.
      {
        path: 'frontdesk',
        loadComponent: () => import('./features/frontdesk/frontdesk-shell.component').then(m => m.FrontdeskShellComponent),
        children: [
          // Default = insights landing (greeting, KPIs, stragglers, patient
          // search). Picking a patient from the search navigates to
          // patients/:id (history), from which "New order" jumps to /order.
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () => import('./features/frontdesk/frontdesk-landing/frontdesk-landing.component').then(m => m.FrontdeskLandingComponent)
          },
          {
            path: 'order',
            loadComponent: () => import('./features/frontdesk/order-create/order-create.component').then(m => m.OrderCreateComponent)
          },
          {
            path: 'billing',
            loadComponent: () => import('./features/frontdesk/billing/billing.component').then(m => m.BillingComponent)
          },
          {
            path: 'appointments/new',
            loadComponent: () => import('./features/frontdesk/book-appointment/book-appointment.component').then(m => m.BookAppointmentComponent)
          },
          {
            path: 'patients/new',
            loadComponent: () => import('./features/frontdesk/patient-register/patient-register.component').then(m => m.PatientRegisterComponent)
          },
          {
            path: 'patients/:id',
            loadComponent: () => import('./features/frontdesk/patient-profile/patient-profile.component').then(m => m.PatientProfileComponent)
          },
          {
            path: 'post-payment',
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

      // Lab
      {
        path: 'lab/my-work',
        loadComponent: () => import('./features/lab/my-work/my-work.component').then(m => m.MyWorkComponent)
      },
      {
        path: 'lab/service-queue',
        redirectTo: '/lab/my-work'
      },
      {
        path: 'lab/collect',
        loadComponent: () => import('./features/lab/sample-collection/sample-collection.component').then(m => m.SampleCollectionComponent)
      },
      // Dedicated-counter landing. Same component as /lab/collect — the
      // separate route exists so we can gate it on `collect_sample` and show
      // it in the top-level sidebar when collection_mode is dedicated_counter.
      {
        path: 'sample-collection',
        canActivate: [permissionGuard('collect_sample')],
        loadComponent: () => import('./features/lab/sample-collection/sample-collection.component').then(m => m.SampleCollectionComponent)
      },
      {
        path: 'lab/receive',
        loadComponent: () => import('./features/lab/receive-samples/receive-samples.component').then(m => m.ReceiveSamplesComponent)
      },
      {
        path: 'lab/result/:id',
        loadComponent: () => import('./features/lab/result-entry/result-entry.component').then(m => m.ResultEntryComponent)
      },

      // Pathologist
      {
        path: 'pathologist',
        loadComponent: () => import('./features/pathologist/pending-validation/pending-validation.component').then(m => m.PendingValidationComponent)
      },
      {
        path: 'pathologist/validate/:id',
        loadComponent: () => import('./features/pathologist/validate-result/validate-result.component').then(m => m.ValidateResultComponent)
      },

      // Reports
      {
        path: 'reports',
        loadComponent: () => import('./features/reports/report-queue/report-queue.component').then(m => m.ReportQueueComponent)
      },
      {
        path: 'reports/view/:id',
        loadComponent: () => import('./features/reports/report-viewer/report-viewer.component').then(m => m.ReportViewerComponent)
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
