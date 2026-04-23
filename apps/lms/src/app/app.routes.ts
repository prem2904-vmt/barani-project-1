import { Route } from '@angular/router';
// import { authGuard } from './core/auth/auth.guard';
import { ShellComponent } from './layout/shell/shell.component';

export const appRoutes: Route[] = [
  {
    path: '',
    component: ShellComponent,
    // canActivate: [authGuard], // bypassed — see core/auth/mock-user.ts
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'admin' },

      // Admin
      {
        path: 'admin',
        loadComponent: () => import('./features/admin/admin-dashboard.component').then(m => m.AdminDashboardComponent)
      },
      {
        path: 'admin/users',
        loadComponent: () => import('./features/admin/users-access/users-access.component').then(m => m.UsersAccessComponent)
      },
      {
        path: 'admin/users/invite',
        loadComponent: () => import('./features/admin/users-access/user-invite.component').then(m => m.UserInviteComponent)
      },
      {
        path: 'admin/roles/new',
        loadComponent: () => import('./features/admin/users-access/role-editor.component').then(m => m.RoleEditorComponent)
      },
      {
        path: 'admin/roles/:id/edit',
        loadComponent: () => import('./features/admin/users-access/role-editor.component').then(m => m.RoleEditorComponent)
      },
      {
        path: 'admin/tests',
        loadComponent: () => import('./features/admin/tests/tests.component').then(m => m.TestsComponent)
      },
      {
        path: 'admin/tests/new',
        loadComponent: () => import('./features/admin/tests/test-editor.component').then(m => m.TestEditorComponent)
      },
      {
        path: 'admin/tests/:id/edit',
        loadComponent: () => import('./features/admin/tests/test-editor.component').then(m => m.TestEditorComponent)
      },
      {
        path: 'admin/branches',
        loadComponent: () => import('./features/admin/branches/branches.component').then(m => m.BranchesComponent)
      },
      {
        path: 'admin/billing',
        loadComponent: () => import('./features/admin/billing-config/billing-config.component').then(m => m.BillingConfigComponent)
      },
      {
        path: 'admin/reports',
        loadComponent: () => import('./features/admin/report-template/report-template.component').then(m => m.ReportTemplateComponent)
      },
      {
        path: 'admin/notifications',
        loadComponent: () => import('./features/admin/notifications-config/notifications-config.component').then(m => m.NotificationsConfigComponent)
      },
      {
        path: 'admin/workflows',
        loadComponent: () => import('./features/admin/workflow-builder/workflow-builder.component').then(m => m.WorkflowBuilderComponent)
      },
      {
        path: 'admin/workflows/:screen',
        loadComponent: () => import('./features/admin/workflow-builder/workflow-builder.component').then(m => m.WorkflowBuilderComponent)
      },
      {
        path: 'admin/workflows/:screen/steps/:stepId/fields/new',
        loadComponent: () => import('./features/admin/workflow-builder/field-editor.component').then(m => m.FieldEditorComponent)
      },
      {
        path: 'admin/workflows/:screen/steps/:stepId/fields/:fieldId/edit',
        loadComponent: () => import('./features/admin/workflow-builder/field-editor.component').then(m => m.FieldEditorComponent)
      },
      {
        path: 'setup',
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
  { path: '**', redirectTo: 'admin' }
];
