import { Route, Routes } from '@angular/router';
import { appModeMatch } from '../../core/app-mode';
import { routeGuards } from '../../core/auth/route-guards';
import { casesheetGuard } from './shared/casesheet.guard';

/**
 * EVERY case-sheet route, defined ONCE (plan §4.4 / §8 WP0-ui). Case sheets are PART OF IPD (§11 Q1).
 *
 *  - CASESHEET_SHELL_ROUTES — children of the signed-in LMS shell (app.routes.ts spreads them once): the lab's
 *    sheets and Admin → IPD → MyPrefrontal (form authoring). Each carries `casesheetGuard` FIRST (gate closed ⇒ the
 *    unknown-URL bounce, never a 403) and then its ROUTE_ACCESS permission guard (core/auth/route-access.ts).
 *  - CASESHEETS_PUBLIC_GROUP — the public case-sheet site (prepare.prefrontal.health): a top-level group that can
 *    match ONLY in `casesheets` mode (core/app-mode.ts). In LMS mode these routes do not exist.
 *  - withAppModes() — app.routes.ts wraps its whole table with it: the public group first, then every LMS top-level
 *    route behind `canMatch: appModeMatch('lms')`, so in casesheets mode no LMS URL can match.
 *
 * Work packages fill the pages: WP5 (lab sheets), WP6 (MyPrefrontal studio), WP7 (public). They replace a route's
 * `loadComponent`; adding / removing a route here updates casesheets.routes.spec.ts deliberately.
 */

/** Route paths (no leading slash), one home. Links: {@link casesheetLinks}. */
export const CASESHEET_PATHS = {
  /** Admin → IPD → MyPrefrontal (case-sheet form authoring, grouped by department). */
  admin: {
    home: 'admin/ipd/myprefrontal',
    form: 'admin/ipd/myprefrontal/forms/:id',
    formHistory: 'admin/ipd/myprefrontal/forms/:id/history',
    import: 'admin/ipd/myprefrontal/import',
  },
  /** In-lab sheets (from the patient profile). */
  lab: {
    patientSheets: 'casesheets/patient/:patientId',
    start: 'casesheets/new',
    sheet: 'casesheets/:id',
  },
  /** The public case-sheet site (casesheets mode only; plan §4.4). */
  public: {
    signIn: 'sign-in',
    authCallback: 'auth/callback',
    departments: '',
    cases: 'cases',
    case: 'cases/:id',
    settings: 'settings',
  },
} as const;

const enc = encodeURIComponent;
/** Absolute in-app links to the routes above (the only place URLs are spelled). */
export const casesheetLinks = {
  adminHome: (): string => '/admin/ipd/myprefrontal',
  adminForm: (id: string): string => `/admin/ipd/myprefrontal/forms/${enc(id)}`,
  adminFormHistory: (id: string): string => `/admin/ipd/myprefrontal/forms/${enc(id)}/history`,
  adminImport: (): string => '/admin/ipd/myprefrontal/import',
  patientSheets: (patientId: string): string => `/casesheets/patient/${enc(patientId)}`,
  start: (): string => '/casesheets/new',
  sheet: (id: string): string => `/casesheets/${enc(id)}`,
};

const placeholder = () => import('./shared/casesheet-placeholder.page').then(m => m.CasesheetPlaceholderPage);
// WP5: the doctor's screens (Departments, the filler, the sheet list). WP7 wraps the public ones in its shell.
const departmentsPage = () => import('./departments/forms.page').then(m => m.FormsPage);
const casePage = () => import('./fill/case.page').then(m => m.CasePage);
const casesPage = () => import('./sheets/cases.page').then(m => m.CasesPage);

/** One gated in-shell route: casesheetGuard, then the ROUTE_ACCESS guards of `/${path}`. */
function gated(path: string, title: string, loadComponent: Route['loadComponent'] = placeholder): Route {
  return {
    path,
    canActivate: [casesheetGuard, ...routeGuards(`/${path}`)],
    data: { title },
    loadComponent,
  };
}

/** WP6 — MyPrefrontal Studio (Admin > IPD > MyPrefrontal). */
const studioHome = () => import('./studio/studio.page').then(m => m.StudioPage);
const studioEditor = () => import('./studio/editor/editor.page').then(m => m.StudioEditorPage);
const studioHistory = () => import('./studio/history/history.page').then(m => m.StudioHistoryPage);
const studioImport = () => import('./studio/import/import.page').then(m => m.StudioImportPage);

/** Children of the signed-in shell (app.routes.ts spreads them once). Specific paths before `:id`. */
export const CASESHEET_SHELL_ROUTES: Routes = [
  gated(CASESHEET_PATHS.admin.home, 'MyPrefrontal', studioHome),
  gated(CASESHEET_PATHS.admin.form, 'Edit case sheet form', studioEditor),
  gated(CASESHEET_PATHS.admin.formHistory, 'Form version history', studioHistory),
  gated(CASESHEET_PATHS.admin.import, 'Bring in an old form', studioImport),
  gated(CASESHEET_PATHS.lab.patientSheets, 'Case sheets', casesPage),
  gated(CASESHEET_PATHS.lab.start, 'New case sheet', departmentsPage),
  gated(CASESHEET_PATHS.lab.sheet, 'Case sheet', casePage),
];

/** The public case-sheet site: only these can match in casesheets mode. Sign-in + shell arrive in WP7. */
export const CASESHEETS_PUBLIC_ROUTES: Routes = [
  { path: CASESHEET_PATHS.public.signIn, data: { title: 'Sign in' }, loadComponent: placeholder },
  { path: CASESHEET_PATHS.public.authCallback, data: { title: 'Signing in' }, loadComponent: placeholder },
  { path: CASESHEET_PATHS.public.departments, pathMatch: 'full', data: { title: 'Departments' }, loadComponent: departmentsPage },
  { path: CASESHEET_PATHS.public.cases, data: { title: 'Cases' }, loadComponent: casesPage },
  { path: CASESHEET_PATHS.public.case, data: { title: 'Case sheet' }, loadComponent: casePage },
  { path: CASESHEET_PATHS.public.settings, data: { title: 'Settings' }, loadComponent: placeholder },
  // Anything else on the case-sheet site → Departments (never an LMS screen).
  { path: '**', redirectTo: '' },
];

export const CASESHEETS_PUBLIC_GROUP: Route = {
  path: '',
  canMatch: [appModeMatch('casesheets')],
  children: CASESHEETS_PUBLIC_ROUTES,
};

/**
 * The whole app table: the public case-sheet group (casesheets mode only) + every LMS top-level route made
 * unmatchable outside LMS mode. Route objects below the top level are untouched (same references).
 */
export function withAppModes(lmsRoutes: Routes): Routes {
  const lms = appModeMatch('lms');
  return [
    CASESHEETS_PUBLIC_GROUP,
    ...lmsRoutes.map(r => ({ ...r, canMatch: [lms, ...(r.canMatch ?? [])] })),
  ];
}
