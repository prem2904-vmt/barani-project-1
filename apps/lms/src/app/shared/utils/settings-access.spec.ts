import {
  CONTRIBUTE_CODE, SETTINGS_AREAS, canManageSettingsAccess, hasApprovalModel, saveModeFor, settingsLevel,
} from './settings-access';

/**
 * Settings access mirror (owner 2026-11-18) — the SAME cases as prefrontal-mw SettingsAccessRulesTests, so the UI hides
 * exactly what the server refuses. Perm lists are the server's /me shapes (manage_tests already expanded).
 */
const LAB_ADMIN = ['manage_tests', 'manage_test_master', 'manage_test_pricing', 'manage_users', 'manage_roles', 'manage_tenant',
  'manage_billing_config', 'manage_lab_settings', 'casesheet_forms_manage'];
const LAB_ADMIN_TECH = ['view_test', 'manage_test_master', 'manage_test_pricing', 'manage_lab_settings', 'manage_departments', 'manage_report_template'];
const RECEPTIONIST = ['register_patient', 'create_order', 'create_bill', 'collect_payment', 'view_test', 'view_report'];
const BRANCH_MANAGER = ['view_test', 'manage_branch', 'manage_branches', 'manage_lab_settings', 'manage_home_collection'];

describe('settingsLevel (mirror of SettingsAccessRules.LevelOf)', () => {
  it('existing roles read as the level they already have', () => {
    for (const a of SETTINGS_AREAS) expect(settingsLevel(LAB_ADMIN, a), a).toBe('admin');
    expect(settingsLevel(LAB_ADMIN_TECH, 'lab')).toBe('admin');
    expect(settingsLevel(LAB_ADMIN_TECH, 'test_master')).toBe('admin');
    expect(settingsLevel(LAB_ADMIN_TECH, 'org')).toBe('none');
    for (const a of SETTINGS_AREAS) expect(settingsLevel(RECEPTIONIST, a), a).toBe('none');
    expect(settingsLevel(BRANCH_MANAGER, 'lab')).toBe('none');
  });

  it('super is admin everywhere; manage_tenant alone is not an Organization admin', () => {
    for (const a of SETTINGS_AREAS) expect(settingsLevel(['*'], a)).toBe('admin');
    expect(settingsLevel(['manage_tenant'], 'org')).toBe('none');
    expect(settingsLevel(['manage_tenant', 'manage_users'], 'org')).toBe('admin');
  });

  it("today's OPD write codes read as OPD admin", () => {
    for (const c of ['manage_opd', 'manage_users', 'manage_billing_config']) expect(settingsLevel([c], 'opd'), c).toBe('admin');
  });

  it('front desk + Test Master contributor: contributor there only', () => {
    const p = [...RECEPTIONIST, CONTRIBUTE_CODE.test_master];
    expect(settingsLevel(p, 'test_master')).toBe('contributor');
    for (const a of ['org', 'lab', 'opd', 'ipd'] as const) expect(settingsLevel(p, a), a).toBe('none');
  });

  it('Lab contributor is a Test Master contributor; Organization contributor one everywhere', () => {
    expect(settingsLevel([CONTRIBUTE_CODE.lab], 'test_master')).toBe('contributor');
    expect(settingsLevel([CONTRIBUTE_CODE.lab], 'opd')).toBe('none');
    for (const a of SETTINGS_AREAS) expect(settingsLevel([CONTRIBUTE_CODE.org], a), a).toBe('contributor');
  });

  it('a higher role level wins over a lower grant', () => {
    expect(settingsLevel([...LAB_ADMIN_TECH, CONTRIBUTE_CODE.test_master], 'test_master')).toBe('admin');
  });

  it('only admins open the Settings access panel', () => {
    expect(canManageSettingsAccess(LAB_ADMIN)).toBe(true);
    expect(canManageSettingsAccess(LAB_ADMIN_TECH)).toBe(true);
    expect(canManageSettingsAccess([...RECEPTIONIST, CONTRIBUTE_CODE.test_master])).toBe(false);
  });
});

describe('saveModeFor — the band Save of a contributor', () => {
  it('"Send for approval" where an approval model exists (Test Master, IPD case-sheet drafts)', () => {
    expect(saveModeFor('contributor', '/admin/tests')).toBe('approval');
    expect(saveModeFor('contributor', '/admin/tests/abc/edit')).toBe('approval');
    expect(saveModeFor('contributor', '/admin/ipd/myprefrontal/forms/x')).toBe('approval');
    expect(hasApprovalModel('/admin/tests?view=pricing')).toBe(true);
  });
  it('view only where there is none yet', () => {
    expect(saveModeFor('contributor', '/admin/lab/collection')).toBe('view');
    expect(saveModeFor('contributor', '/admin/org/profile')).toBe('view');
  });
  it('admins and everyone else: a normal Save', () => {
    expect(saveModeFor('admin', '/admin/tests')).toBe('save');
    expect(saveModeFor('none', '/admin/lab/collection')).toBe('save');
  });
});
