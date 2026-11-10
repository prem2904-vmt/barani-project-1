/**
 * Permission codes that belong to case sheets (part of IPD; plan §2). The backend seeds them (WP0-mw
 * PermissionSeeder + RoleDefinitionHistory: Lab Admin all three, doctor-kind roles fill + view). While the case-sheet
 * gate is closed the role editor hides them (grants are preserved on save) — same pattern as opd-permissions.ts.
 */
export const CASESHEET_FILL = 'casesheet_fill';
export const CASESHEET_VIEW = 'casesheet_view';
export const CASESHEET_FORMS_MANAGE = 'casesheet_forms_manage';

export const CASESHEET_PERMISSION_CODES: ReadonlySet<string> = new Set([
  CASESHEET_FILL, CASESHEET_VIEW, CASESHEET_FORMS_MANAGE,
]);
