import { inject } from '@angular/core';
import { CanActivateFn, Route, Router, Routes } from '@angular/router';
import { betaGuard } from '../../../core/services/beta-features.service';
import { routeGuards } from '../../../core/auth/route-guards';
import { OPD_ADMIN_ROUTES } from '../../opd/opd.routes';
import { CASESHEET_SHELL_ROUTES } from '../../casesheets/casesheets.routes';
import { casesheetGuard } from '../../casesheets/shared/casesheet.guard';
import { LEGACY_SECTION, SETTINGS_PATHS as P, rehome } from './settings-map';

/**
 * THE Settings route table. Every screen that opens INSIDE the Settings shell (the two-panel frame with the
 * setting's categories on the left) is one row here: its path, the component behind it and its guards.
 *
 * Repointing a path to a finished page is a one-line change in this file (swap its `load`); the map in
 * settings-map.ts and the shell never change. New paths whose real page is not built yet render the closest
 * existing screen (marked `placeholder`), so nothing 404s while the other pieces land.
 *
 * Detail screens (a test, a user, an instrument, a form editor …) are NOT hosted: they keep their own full-screen
 * routes in app.routes.ts and climb back to their list.
 */

const strip = (p: string) => p.replace(/^\//, '');

interface PageOpts {
  /** ROUTE_ACCESS key the guards read (defaults to the path itself). */
  access?: string;
  /** Guards that run BEFORE the ROUTE_ACCESS ones (beta, OPD gate, case-sheet gate). */
  before?: CanActivateFn[];
  /** Unsaved changes ask first. */
  leave?: boolean;
  data?: Route['data'];
}

function page(path: string, load: Route['loadComponent'], o: PageOpts = {}): Route {
  const route: Route = {
    path: strip(path),
    canActivate: [...(o.before ?? []), ...routeGuards(o.access ?? path)],
    loadComponent: load,
  };
  if (o.leave) route.canDeactivate = [(c: { canLeave?: () => Promise<boolean> }) => (c?.canLeave ? c.canLeave() : true)];
  if (o.data) route.data = o.data;
  return route;
}

/** A setting's own path when it only forwards to its first category (the shell does the hop). */
const blank = () => import('./settings-blank.component').then((m) => m.SettingsBlankComponent);
const alias = (path: string): Route => page(path, blank);

// ── The pages behind the paths ──
// Lab merged pages (features/admin/lab-pages); their categories are LAB_PAGES in shared/utils/lab-settings-pages.ts.
const labSampleNumbers = () => import('../lab-pages/sample-numbers.page').then((m) => m.LabSampleNumbersPage);
const labCollection = () => import('../lab-pages/collection.page').then((m) => m.LabCollectionPage);
const labResults = () => import('../lab-pages/results.page').then((m) => m.LabResultsPage);
const labHomeCollection = () => import('../lab-pages/home-collection.page').then((m) => m.LabHomeCollectionPage);
const labFrontDesk = () => import('../lab-pages/front-desk.page').then((m) => m.LabFrontDeskPage);
const labAlerts = () => import('../lab-pages/alerts.page').then((m) => m.LabAlertsPage);
const labNumbers = () => import('../lab-pages/numbers.page').then((m) => m.LabNumbersPage);
const labReportOptions = () => import('../lab-pages/report-options.page').then((m) => m.LabReportOptionsPage);
const labDepartments = () => import('../lab-departments/lab-departments.component').then((m) => m.LabDepartmentsComponent);
const branches = () => import('../branches/branches.component').then((m) => m.BranchesComponent);
const organization = () => import('../organization/organization-settings.component').then((m) => m.OrganizationSettingsComponent);
const tests = () => import('../tests/tests/tests.component').then((m) => m.TestsComponent);
const reportTemplate = () => import('../report-template/report-template.component').then((m) => m.ReportTemplateComponent);
const referralLabs = () => import('../referral-labs/referral-labs.component').then((m) => m.ReferralLabsComponent);
const partnerPrices = () => import('../partner-test-prices/partner-test-prices.component').then((m) => m.PartnerTestPricesComponent);
const instruments = () => import('../../lab/instruments/instruments-list.component').then((m) => m.InstrumentsListComponent);
const bridges = () => import('../bridges/bridges-list.component').then((m) => m.BridgesListComponent);
const notifications = () => import('../notifications-config/notifications-config.component').then((m) => m.NotificationsConfigComponent);
const processBuilder = () => import('../process-builder/process-builder.component').then((m) => m.ProcessBuilderComponent);
const workflowBuilder = () => import('../workflow-builder/workflow-builder.component').then((m) => m.WorkflowBuilderComponent);
const inventory = () => import('../inventory/inventory.component').then((m) => m.InventoryComponent);
const orgProfile = () => import('../org/org-profile.page').then((m) => m.OrgProfilePage);
const users = () => import('../users-access/users-access.component').then((m) => m.UsersAccessComponent);
const billing = () => import('../billing-config/billing-settings.page').then((m) => m.BillingSettingsPage);
const aiConnectors = () => import('../../ai-connector/ai-connectors-settings.page').then((m) => m.AiConnectorsSettingsPage);
const channels = () => import('../communication/communication-settings.page').then((m) => m.CommunicationSettingsPage);
const files = () => import('../../files/files-settings.page').then((m) => m.FilesSettingsPage);

/** A case-sheet admin route (casesheetGuard + its ROUTE_ACCESS guards), unchanged. */
function sheetRoute(path: string): Route {
  const r = CASESHEET_SHELL_ROUTES.find((x) => x.path === strip(path));
  if (!r) throw new Error(`settings.routes: no case-sheet admin route ${path}`);
  return r;
}
/** The case-sheet admin routes the shell hosts (the others — the form editor, its history — stay full screen). */
export const SHELL_HOSTED_SHEET_PATHS = [P.ipdCaseSheets, P.ipdPending, P.ipdDepartments].map(strip);
/** OPD admin editors that stay full screen; every other OPD / Pharmacy admin route is hosted by the shell. */
export const OPD_FULL_SCREEN_ADMIN: ReadonlySet<string> = new Set(['admin/opd/services/:id', 'admin/opd/forms/:id']);

/** Children of the Settings shell. ORDER does not matter (every path is exact). */
export const SETTINGS_SHELL_CHILDREN: Routes = [
  // ── Lab ──
  page(P.labDepartments, labDepartments),
  page(P.labSampleNumbers, labSampleNumbers),
  page(P.tests, tests),
  page(P.reports, reportTemplate, { leave: true }),
  page(P.reportOptions, labReportOptions),
  page(P.labCollection, labCollection),
  page(P.labResults, labResults),
  alias(P.labOutsourcing),
  page(P.referralLabs, referralLabs),
  page(P.partnerPrices, partnerPrices),
  alias(P.labAnalyzers),
  page(P.instruments, instruments),
  page(P.bridges, bridges),
  page(P.labFrontDesk, labFrontDesk),
  page(P.labAlerts, labAlerts),
  page(P.labNumbers, labNumbers),
  alias(P.labWorkSteps),
  page(P.process, processBuilder),
  page(P.workflows, workflowBuilder),
  page(P.labHomeCollection, labHomeCollection),

  // ── OPD + Pharmacy (adminGuard + opdGuard; defined once in features/opd/opd.routes.ts) ──
  ...OPD_ADMIN_ROUTES.filter((r) => !OPD_FULL_SCREEN_ADMIN.has(r.path ?? '')),

  // ── IPD ──
  ...SHELL_HOSTED_SHEET_PATHS.map((p) => sheetRoute(p)),
  { path: strip(P.ipdAlerts), canActivate: [casesheetGuard, ...routeGuards(P.ipdAlerts)], data: { department: 'ipd' }, loadComponent: notifications },

  // ── Inventory ──
  page(P.inventory, inventory),

  // ── Organization ──
  page(P.orgProfile, orgProfile),
  page(P.branches, branches),
  page(P.orgNumbers, organization, { data: { orgTabs: ['patient', 'order'] } }),
  page(P.users, users),
  page(P.billing, billing),
  page(P.aiConnectors, aiConnectors, { before: [betaGuard('mcp')] }),
  page(P.orgChannels, channels),
  page(P.files, files, { before: [betaGuard('neuron')] }),
];

/** Every path hosted by the shell (without the leading slash) — app.routes.ts removes these from the old flat table. */
export const SETTINGS_HOSTED_PATHS: ReadonlySet<string> = new Set(
  SETTINGS_SHELL_CHILDREN.map((r) => r.path ?? ''),
);

/** The shell route itself: a pathless parent, so every hosted path keeps its own URL. */
export const SETTINGS_SHELL_ROUTE: Route = {
  path: '',
  loadComponent: () => import('./settings-shell.component').then((m) => m.SettingsShellComponent),
  children: SETTINGS_SHELL_CHILDREN,
};

// ── Old links → their new home (every one keeps working) ──

/** A redirect that rewrites an old path (and its ?tab=) with settings-map's `rehome`. */
function moved(path: string): Route {
  return {
    path: strip(path),
    pathMatch: 'full',
    redirectTo: ({ queryParams }) => {
      const to = rehome(path, queryParams as Record<string, string>);
      return inject(Router).createUrlTree([to?.path ?? '/admin'], { queryParams: to?.query ?? {} });
    },
  };
}
const toOverview = (path: string, section: string): Route => ({
  path: strip(path), pathMatch: 'full',
  redirectTo: () => inject(Router).createUrlTree(['/admin'], { queryParams: { section } }),
});
const toAdmin = (path: string): Route => ({
  path: strip(path), pathMatch: 'full',
  redirectTo: () => inject(Router).createUrlTree(['/admin']),
});

/** Paths that no longer hold a page of their own. */
export const SETTINGS_REDIRECTS: Routes = [
  moved('/admin/lab-settings'),
  moved('/admin/organization'),
  moved('/admin/communication'),
  moved('/admin/appointments'),
  moved('/admin/referring-network'),
  moved('/admin/lab/front-desk/referring'),
  moved('/admin/microbiology'),
  moved('/admin/notifications'),
  moved('/admin/kpis'),
  moved('/admin/home-collection'),
  moved('/admin/partners'),
  moved('/setup'),
  moved('/admin/org/profile/branding'),
  moved('/admin/vendors'),
  moved('/admin/opd/pharmacy'),
  moved('/admin/opd/drugs'),
  toOverview('/admin/opd', 'opd'),
  toOverview('/admin/ipd', 'ipd'),
  toAdmin('/admin/modules'),
  {
    // The old settings hub: `?cat=<id>` opens the section that holds it now.
    path: 'admin/manage', pathMatch: 'full',
    redirectTo: ({ queryParams }) => {
      const cat = (queryParams as Record<string, string>)['cat'] ?? null;
      const section = sectionForLegacy(cat) ?? cat;
      return inject(Router).createUrlTree(['/admin'], { queryParams: section ? { section } : {} });
    },
  },
  toOverview('/lab/settings', 'lab'),
  // "Coming soon" departments are hidden until the lab has them.
  toAdmin('/admin/radiology'),
  toAdmin('/admin/payroll'),
  toAdmin('/admin/insurance'),
  toAdmin('/admin/emergency'),
  toAdmin('/admin/blood-bank'),
];

/** `/admin/manage?cat=<old id>` and the old `/admin?section=<old id>` land on the section that holds them now. */
export function sectionForLegacy(id: string | null | undefined): string | null {
  return id ? (LEGACY_SECTION[id] ?? null) : null;
}
