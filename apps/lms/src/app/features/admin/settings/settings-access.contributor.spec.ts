import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../../core/auth/auth.service';
import { canOpenRoute } from '../../../core/auth/route-access';
import { BetaFeaturesService } from '../../../core/services/beta-features.service';
import { LabFeaturesService } from '../../../core/services/lab-features.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { OpdGateService } from '../../opd/shared/opd-gate.service';
import { CasesheetGateService } from '../../casesheets/shared/casesheet-gate.service';
import { CONTRIBUTE_CODE, settingsLevel } from '../../../shared/utils/settings-access';
import { allSettingsPaths } from './settings-map';
import { SettingsAccessService } from './settings-access.service';

/**
 * Settings access (owner 2026-11-18): Settings shows ONLY what the person can open — a front-desk person given Test
 * Master contributor sees Test Master and nothing else (hidden, not greyed); their Save reads "Send for approval".
 */
const RECEPTIONIST = ['register_patient', 'edit_patient', 'view_patient', 'create_order', 'view_order', 'create_bill', 'collect_payment',
  'give_discount', 'view_bill', 'collect_sample', 'reject_sample', 'dispatch_sample', 'deliver_report', 'view_report', 'print_barcode',
  'view_test', 'expense_modifier'];

function accessFor(perms: string[], opts: { opd?: boolean; ipd?: boolean } = {}) {
  TestBed.resetTestingModule();
  const has = (c: string[]) => perms.includes('*') || c.some((x) => perms.includes(x));
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { hasAnyPermission: has, settingsLevel: (a: never) => settingsLevel(perms, a) } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, moduleOn: () => true } },
      // Settings access is dev-only behind its own beta (owner rule): on here, the assistant beta off.
      { provide: BetaFeaturesService, useValue: { enabled: (k: string) => k === 'settingsaccess' } },
      { provide: LabFeaturesService, useValue: { homeCollectionEnabled: () => true } },
      { provide: OpdGateService, useValue: { visible: () => !!opts.opd } },
      { provide: CasesheetGateService, useValue: { visible: () => !!opts.ipd } },
    ],
  });
  return TestBed.inject(SettingsAccessService);
}
const items = (a: SettingsAccessService) => a.visibleSections().flatMap((s) => s.items.map((i) => i.id));

describe('Settings access — hidden areas', () => {
  it('front desk alone: no Settings at all', () => {
    expect(items(accessFor(RECEPTIONIST))).toEqual([]);
  });

  it('front desk + Test Master contributor: exactly Test Master (one setting → Settings opens straight into it)', () => {
    const a = accessFor([...RECEPTIONIST, CONTRIBUTE_CODE.test_master]);
    expect(items(a)).toEqual(['lab-tests']);
    const tm = a.visibleSections()[0].items[0];
    const cats = a.visibleCategories(tm).map((c) => c.id);
    expect(cats).toContain('individual');
    expect(cats).toContain('pricing');    // prices go for approval too
    expect(cats).toContain('pending');    // their changes wait here (beta settingsaccess)
    expect(a.saveModeFor('/admin/tests')).toBe('approval');
    expect(a.saveModeFor('/admin/tests/t1/edit')).toBe('approval');
  });

  it('the route guards agree: only Test Master opens, People and access never', () => {
    const perms = [...RECEPTIONIST, CONTRIBUTE_CODE.test_master];
    const ctx = { hasAny: (c: string[]) => c.some((x) => perms.includes(x)) };
    const open = allSettingsPaths().filter((p) => canOpenRoute(p, ctx));
    expect(open).toContain('/admin/tests');
    for (const p of ['/admin/users', '/admin/billing', '/admin/org/profile', '/admin/lab/collection', '/admin/reports']) {
      expect(open, p).not.toContain(p);
    }
    expect(canOpenRoute('/admin', ctx)).toBe(true);
  });

  it('Lab contributor: the whole Lab section (view only outside Test Master), never Organization', () => {
    // The server adds the Test Master contributor code with a Lab grant (Lab includes Test Master).
    const a = accessFor(['view_test', CONTRIBUTE_CODE.lab, CONTRIBUTE_CODE.test_master]);
    const sections = a.visibleSections().map((s) => s.section.id);
    expect(sections).toEqual(['lab']);
    expect(items(a)).toContain('lab-tests');
    expect(items(a)).toContain('lab-collection');
    expect(items(a)).not.toContain('org-people');
    expect(a.saveModeFor('/admin/lab/collection')).toBe('view');
    expect(a.saveModeFor('/admin/tests')).toBe('approval');
  });

  it('OPD contributor sees OPD (when the lab has it) and nothing of Lab', () => {
    const a = accessFor(['view_patient', CONTRIBUTE_CODE.opd], { opd: true });
    expect(a.visibleSections().map((s) => s.section.id)).toEqual(['opd', 'pharmacy']);
    expect(a.saveModeFor('/admin/opd/settings')).toBe('view');
  });

  it('an admin keeps the normal Save everywhere', () => {
    const a = accessFor(['*']);
    expect(a.saveModeFor('/admin/tests')).toBe('save');
    expect(a.saveModeFor('/admin/lab/collection')).toBe('save');
  });

  it('beta settingsaccess off: no Pending changes category for a contributor', () => {
    TestBed.resetTestingModule();
    const perms = [...RECEPTIONIST, CONTRIBUTE_CODE.test_master];
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { hasAnyPermission: (c: string[]) => c.some((x) => perms.includes(x)), settingsLevel: (a: never) => settingsLevel(perms, a) } },
        { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
        { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, moduleOn: () => true } },
        { provide: BetaFeaturesService, useValue: { enabled: () => false } },
        { provide: LabFeaturesService, useValue: { homeCollectionEnabled: () => true } },
        { provide: OpdGateService, useValue: { visible: () => false } },
        { provide: CasesheetGateService, useValue: { visible: () => false } },
      ],
    });
    const a = TestBed.inject(SettingsAccessService);
    const tm = a.visibleSections()[0].items[0];
    expect(a.visibleCategories(tm).map((c) => c.id)).not.toContain('pending');
  });
});
