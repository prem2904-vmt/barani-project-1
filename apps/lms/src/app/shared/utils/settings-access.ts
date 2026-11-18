/**
 * SETTINGS ACCESS (owner 2026-11-18) — the tested TS mirror of prefrontal-mw `SettingsAccessRules`.
 *
 * Per area (Organization, Lab, Test Master, OPD, IPD) a person is None / Contributor / Admin ON TOP of their job role.
 * The SERVER decides (grants add permission codes to /me; contributor reads and the approval routes are enforced
 * there); the UI only reads the level back from the same codes to hide what the person cannot open and to word the
 * band Save ("Send for approval"). Pure data + pure helpers (no Angular DI).
 */
export type SettingsArea = 'org' | 'lab' | 'test_master' | 'opd' | 'ipd';
export type SettingsLevel = 'none' | 'contributor' | 'admin';

export const SETTINGS_AREAS: readonly SettingsArea[] = ['org', 'lab', 'test_master', 'opd', 'ipd'];
export const SETTINGS_LEVELS: readonly SettingsLevel[] = ['none', 'contributor', 'admin'];

/** People and access → the person panel: one row per area, in this order. */
export const SETTINGS_AREA_LABEL: Readonly<Record<SettingsArea, string>> = {
  org: 'Organization',
  lab: 'Lab',
  test_master: 'Test Master',
  opd: 'OPD',
  ipd: 'IPD',
};
/** One plain line under each row. */
export const SETTINGS_AREA_HINT: Readonly<Record<SettingsArea, string>> = {
  org: 'Everything in Settings, with People and access and billing.',
  lab: 'Lab settings, Test Master included.',
  test_master: 'Tests, profiles, packages and prices.',
  opd: 'OPD and Pharmacy settings.',
  ipd: 'IPD departments and case sheets.',
};
export const SETTINGS_LEVEL_LABEL: Readonly<Record<SettingsLevel, string>> = {
  none: 'None',
  contributor: 'Contributor',
  admin: 'Admin',
};

/** Synthetic codes a Contributor grant adds (never in a role). */
export const CONTRIBUTE_CODE: Readonly<Record<SettingsArea, string>> = {
  org: 'contribute_org_settings',
  lab: 'contribute_lab_settings',
  test_master: 'contribute_test_master',
  opd: 'contribute_opd_settings',
  ipd: 'contribute_ipd_settings',
};
export const ALL_CONTRIBUTE_CODES: readonly string[] = SETTINGS_AREAS.map((a) => CONTRIBUTE_CODE[a]);

/** The area an area sits inside (Test Master ⇒ Lab ⇒ Organization). */
export function parentArea(a: SettingsArea): SettingsArea | null {
  return a === 'test_master' ? 'lab' : a === 'org' ? null : 'org';
}

/**
 * The person's level in an area from their EFFECTIVE codes — same rule as the server's `SettingsAccessRules.LevelOf`:
 * Org admin = `*` or (manage_tenant AND manage_users); Lab admin = Org admin or (manage_lab_settings AND a Test Master
 * code); Test Master admin = Lab admin or manage_tests / manage_test_master; OPD admin = Org admin or manage_opd /
 * manage_users / manage_billing_config; IPD admin = Org admin or casesheet_forms_manage / manage_ipd. Contributor = the
 * area's contribute code, or a parent area's.
 */
export function settingsLevel(perms: readonly string[], area: SettingsArea): SettingsLevel {
  const has = (c: string) => perms.includes(c);
  const orgAdmin = has('*') || (has('manage_tenant') && has('manage_users'));
  const tmCode = has('manage_tests') || has('manage_test_master');
  const labAdmin = orgAdmin || (has('manage_lab_settings') && tmCode);
  const admin = area === 'org' ? orgAdmin
    : area === 'lab' ? labAdmin
    : area === 'test_master' ? labAdmin || tmCode
    : area === 'opd' ? orgAdmin || has('manage_opd') || has('manage_users') || has('manage_billing_config')
    : orgAdmin || has('casesheet_forms_manage') || has('manage_ipd');
  if (admin) return 'admin';
  for (let a: SettingsArea | null = area; a; a = parentArea(a)) if (has(CONTRIBUTE_CODE[a])) return 'contributor';
  return 'none';
}

/** Which area a Settings section (settings-map `SETTINGS_SECTIONS[].id`) belongs to. */
export function areaOfSection(sectionId: string): SettingsArea {
  switch (sectionId) {
    case 'lab': return 'lab';
    case 'opd': case 'pharmacy': return 'opd';
    case 'ipd': return 'ipd';
    default: return 'org';    // the Organization group + Inventory
  }
}

/** Test Master pages (the editor, pricing, option groups …) are their own area inside Lab. */
export function isTestMasterPath(path: string): boolean {
  const p = (path ?? '').split(/[?#]/)[0];
  return p === '/admin/tests' || p.startsWith('/admin/tests/');
}

/**
 * Pages whose changes have a draft / approval model, so a contributor's Save is "Send for approval". Everything else a
 * contributor can open is VIEW ONLY (no Save) until it gets one. Test Master (pending changes) and IPD case sheets
 * (the form draft; an admin publishes) today.
 */
export function hasApprovalModel(path: string): boolean {
  const p = (path ?? '').split(/[?#]/)[0];
  return isTestMasterPath(p) || p.startsWith('/admin/ipd/myprefrontal');
}

/** The band Save of a settings page: a normal Save, "Send for approval", or nothing (view only). */
export type SettingsSaveMode = 'save' | 'approval' | 'view';
export function saveModeFor(level: SettingsLevel, path: string): SettingsSaveMode {
  if (level !== 'contributor') return 'save';
  return hasApprovalModel(path) ? 'approval' : 'view';
}

/** Can this person open the Settings access panel at all (Org admin or admin of any area)? */
export function canManageSettingsAccess(perms: readonly string[]): boolean {
  return SETTINGS_AREAS.some((a) => settingsLevel(perms, a) === 'admin');
}
