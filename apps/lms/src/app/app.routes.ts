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
        path: 'admin/tests',
        loadComponent: () => import('./features/admin/tests/tests.component').then(m => m.TestsComponent)
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
        path: 'setup',
        loadComponent: () => import('./features/admin/setup-wizard/setup-wizard.component').then(m => m.SetupWizardComponent)
      },

      // Reception
      {
        path: 'reception',
        loadComponent: () => import('./features/reception/reception-landing/reception-landing.component').then(m => m.ReceptionLandingComponent)
      },
      {
        path: 'reception/order-create',
        loadComponent: () => import('./features/reception/order-create/order-create.component').then(m => m.OrderCreateComponent)
      },
      {
        path: 'reception/billing',
        loadComponent: () => import('./features/reception/billing/billing.component').then(m => m.BillingComponent)
      },
      {
        path: 'reception/post-payment',
        loadComponent: () => import('./features/reception/post-payment/post-payment.component').then(m => m.PostPaymentComponent)
      },

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
