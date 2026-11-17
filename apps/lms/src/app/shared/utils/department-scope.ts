/**
 * Which department an embedded Settings screen (alerts, number cards) is
 * scoped to. Settings re-home (2026-11-17): anything that belongs to ONE
 * department lives inside that department, so the shared Notifications and
 * KPI screens take a `department` input and show only that department's rows.
 * No input = every row (the old single page).
 */
export type SettingsDepartment = 'lab' | 'opd' | 'ipd' | 'pharmacy';

/**
 * Notification catalogue modules (backend `NotificationCatalog.cs` is the one
 * source of the rows; this only says which module belongs to which department).
 * Lab keeps every module the catalogue has today; OPD / IPD / Pharmacy modules
 * appear here the day the catalogue emits them.
 */
export const ALERT_MODULES: Readonly<Record<SettingsDepartment, readonly string[]>> = {
  lab: ['frontdesk', 'billing', 'lab', 'results', 'reports', 'whatsapp', 'inventory', 'appointments', 'team'],
  opd: ['opd'],
  ipd: ['ipd'],
  pharmacy: ['pharmacy'],
};

/** KPI screens (the `screen` of a KPI assignment) that belong to the lab. */
export const LAB_KPI_SCREENS: readonly string[] = [
  'frontdesk_landing', 'lab_my_work', 'sample_collection', 'receive_samples',
  'pathologist', 'report_queue', 'billing_counter', 'tat_board',
];

/** Does an alert module belong to the department (null = no scoping)? */
export function alertModuleInDepartment(module: string, dept: SettingsDepartment | null | undefined): boolean {
  return !dept || ALERT_MODULES[dept].includes(module);
}

/** Does a KPI screen id belong to the department (null = no scoping)? */
export function kpiScreenInDepartment(screen: string, dept: SettingsDepartment | null | undefined): boolean {
  if (!dept) return true;
  if (dept === 'lab') return LAB_KPI_SCREENS.includes(screen);
  return screen.startsWith(`${dept}_`);
}
