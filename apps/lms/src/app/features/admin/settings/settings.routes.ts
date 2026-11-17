import { inject } from '@angular/core';
import { CanActivateFn, Route, Router, Routes } from '@angular/router';
import { betaGuard } from '../../../core/services/beta-features.service';
import { permissionGuard } from '../../../core/auth/permission.guard';
import { routeGuards } from '../../../core/auth/route-guards';
import { ADMIN_PERMS } from '../../../core/auth/route-access';
import { opdGuard } from '../../opd/shared/opd.guard';
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

const adminGuard = permissionGuard(ADMIN_PERMS);
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
const branches = () => import('../branches/branches.component').then((m) => m.BranchesComponent);
const organization = () => import('../organization/organization-settings.component').then((m) => m.OrganizationSettingsComponent);
const labSettings = () => import('../lab-settings/lab-settings.component').then((m) => m.LabSettingsComponent);
const tests = () => import('../tests/tests/tests.component').then((m) => m.TestsComponent);
const reportTemplate = () => import('../report-template/report-template.component').then((m) => m.ReportTemplateComponent);
const culture = () => import('../../lab/culture-settings/culture-settings.component').then((m) => m.CultureSettingsComponent);
const referralLabs = () => import('../referral-labs/referral-labs.component').then((m) => m.ReferralLabsComponent);
const partnerPrices = () => import('../partner-test-prices/partner-test-prices.component').then((m) => m.PartnerTestPricesComponent);
const instruments = () => import('../../lab/instruments/instruments-list.component').then((m) => m.InstrumentsListComponent);
const bridges = () => import('../bridges/bridges-list.component').then((m) => m.BridgesListComponent);
const appointments = () => import('../appointments-config/appointments-config.component').then((m) => m.AppointmentsConfigComponent);
const referringNetwork = () => import('../referring-network/referring-network.component').then((m) => m.ReferringNetworkComponent);
const notifications = () => import('../notifications-config/notifications-config.component').then((m) => m.NotificationsConfigComponent);
const kpis = () => import('../kpis/kpi-config.component').then((m) => m.KpiConfigComponent);
const processBuilder = () => import('../process-builder/process-builder.component').then((m) => m.ProcessBuilderComponent);
const workflowBuilder = () => import('../workflow-builder/workflow-builder.component').then((m) => m.WorkflowBuilderComponent);
const homeCollection = () => import('../home-collection/home-collection-agents.component').then((m) => m.HomeCollectionAgentsComponent);
const inventory = () => import('../inventory/inventory.component').then((m) => m.InventoryComponent);
const setup = () => import('../setup-wizard/setup-wizard.component').then((m) => m.SetupWizardComponent);
const users = () => import('../users-access/users-access.component').then((m) => m.UsersAccessComponent);
const billing = () => import('../billing-config/billing-config.component').then((m) => m.BillingConfigComponent);
const vendors = () => import('../vendors/vendors.component').then((m) => m.VendorsComponent);
const aiConnectors = () => import('../../ai-connector/ai-connectors-settings.page').then((m) => m.AiConnectorsSettingsPage);
const channels = () => import('../communication/communication-settings.page').then((m) => m.CommunicationSettingsPage);
const files = () => import('../../files/files-settings.page').then((m) => m.FilesSettingsPage);

/** An OPD admin route (adminGuard + opdGuard) re-used under a new path. */
function opdRoute(oldPath: string, newPath?: string): Route {
  const r = OPD_ADMIN_ROUTES.find((x) => x.path === strip(oldPath));
  if (!r) throw new Error(`settings.routes: no OPD admin route ${oldPath}`);
  return newPath ? { ...r, path: strip(newPath) } : r;
}
/** A case-sheet admin route (casesheetGuard + its ROUTE_ACCESS guards), unchanged. */
function sheetRoute(path: string): Route {
  const r = CASESHEET_SHELL_ROUTES.find((x) => x.path === strip(path));
  if (!r) throw new Error(`settings.routes: no case-sheet admin route ${path}`);
  return r;
}
const opdPage = (path: string, load: Route['loadComponent'], access: string): Route => ({
  path: strip(path), canActivate: [adminGuard, opdGuard, ...routeGuards(access)], loadComponent: load,
});

/** The case-sheet admin routes the shell hosts (the others — the form editor, its history — stay full screen). */
export const SHELL_HOSTED_SHEET_PATHS = [P.ipdCaseSheets, P.ipdPending, P.ipdDepartments].map(strip);
/** OPD admin routes the shell hosts (service editor and form builder stay full screen). */
const SHELL_HOSTED_OPD_PATHS = ['/admin/opd/departments', '/admin/opd/doctors', '/admin/opd/forms', '/admin/opd/workflow', '/admin/opd/settings'];

/** Children of the Settings shell. ORDER does not matter (every path is exact). */
export const SETTINGS_SHELL_CHILDREN: Routes = [
  // ── Lab ──
  page(P.labDepartments, branches),                                   // placeholder: Branches › departments board
  page(P.labSampleNumbers, organization),                             // placeholder: Organization › Sample ID tab
  page(P.tests, tests),
  page(P.reports, reportTemplate, { leave: true }),
  page(P.reportNotes, labSettings),                                   // placeholder: Lab settings › Report tab
  page(P.labCollection, labSettings),                                 // placeholder: Lab settings › Collection / Queues tabs
  page(P.labResults, labSettings),                                    // placeholder: Lab settings › Rules tab
  page(P.microbiology, culture),
  alias(P.labOutsourcing),
  page(P.referralLabs, referralLabs),
  page(P.partnerPrices, partnerPrices),
  alias(P.labAnalyzers),
  page(P.instruments, instruments),
  page(P.bridges, bridges),
  page(P.labFrontDesk, appointments),                                 // placeholder: Appointments & queue
  page(P.labReferring, referringNetwork),
  page(P.labAlerts, notifications),                                   // placeholder: shared Notifications page
  page(P.labNumbers, kpis),
  alias(P.labWorkSteps),
  page(P.process, processBuilder),
  page(P.workflows, workflowBuilder),
  page(P.labHomeCollection, homeCollection),

  // ── OPD ──
  ...SHELL_HOSTED_OPD_PATHS.map((p) => opdRoute(p)),
  opdPage(P.opdFrontDesk, appointments, P.opdFrontDesk),              // placeholder: Appointments & queue
  opdPage(P.opdReferring, referringNetwork, P.opdReferring),
  opdPage(P.opdAlerts, notifications, P.opdAlerts),                   // placeholder: shared Notifications page
  opdPage(P.opdNumbers, kpis, P.opdNumbers),                          // placeholder: KPI cards page

  // ── Pharmacy (the real settings; they live in OPD today) ──
  opdRoute('/admin/opd/pharmacy', P.pharmacy),
  opdRoute('/admin/opd/drugs', P.pharmacyDrugs),

  // ── IPD ──
  ...SHELL_HOSTED_SHEET_PATHS.map((p) => sheetRoute(p)),
  { path: strip(P.ipdAlerts), canActivate: [casesheetGuard, ...routeGuards(P.ipdAlerts)], loadComponent: notifications },

  // ── Inventory ──
  page(P.inventory, inventory),

  // ── Organization ──
  page(P.orgProfile, organization),                                   // placeholder: Organization › Identity tab
  page(P.orgBranding, setup),                                         // Logo + top-bar name (was /setup)
  page(P.branches, branches),
  page(P.orgNumbers, organization),                                   // placeholder: Organization › Patient / Order ID tabs
  page(P.users, users),
  page(P.billing, billing),
  page(P.vendors, vendors),
  page(P.aiConnectors, aiConnectors, { before: [betaGuard('mcp')] }),
  page(P.orgChannels, channels),                                      // placeholder: Communication
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
  moved('/admin/notifications'),
  moved('/admin/kpis'),
  moved('/admin/home-collection'),
  moved('/admin/partners'),
  moved('/setup'),
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
