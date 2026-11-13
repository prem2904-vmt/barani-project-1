import { readFileSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ProcessWorkflowConfig } from '../../shared/models/process-workflow.model';
import { ModuleKey } from '../services/tenant-entitlements.service';
import { ProcessWorkflowService } from '../services/process-workflow.service';
import { TenantEntitlementsService } from '../services/tenant-entitlements.service';
import { LabFeaturesService } from '../services/lab-features.service';
import { appointmentsOn, homeCollectionOn, workflowActionOn } from './lab-features';
import { canOpenRoute } from '../auth/route-access';
import { pickLanding } from '../auth/landing.guard';
import { MORE_NAV, NavItem, PRIMARY_NAV, menusFromWorkflow, navItemVisible, workflowActionEnabled } from '../../layout/nav-items';

/**
 * Owner bug (2026-09-30): "Home collection has been disabled (and appointments
 * disabled), yet users still see the Home collection tab." Root cause: the
 * front desk read ONLY the workflow's Home Visits action (never the tenant
 * entitlement), and a workflow that no longer placed Home Visits (its area
 * deleted / the action dragged out) read as ON (fail-open when silent) — while
 * the same workflow hid Appointments. One rule now decides every surface.
 */

const ALL: ModuleKey[] = ['homeCollection'];
const entitled = (on: boolean) => (m: ModuleKey) => (ALL.includes(m) ? on : true);

function wf(actions: Array<{ type: string; enabled: boolean; categoryId?: string }>): ProcessWorkflowConfig {
  return {
    categories: [
      { id: 'frontdesk', name: 'Frontdesk', icon: 'reception', color: '#000', order: 0 },
      { id: 'homecoll', name: 'Home Visits', icon: 'home', color: '#000', order: 1 },
      { id: 'field', name: 'Field', icon: 'home', color: '#000', order: 2 },
    ],
    actions: actions.map((a, i) => ({ id: `a${i}`, type: a.type, categoryId: a.categoryId ?? 'homecoll', order: i, enabled: a.enabled })),
  };
}

const HOME_ON = wf([{ type: 'home_visits', enabled: true }, { type: 'appointment', enabled: true, categoryId: 'frontdesk' },
  { type: 'patient_registration', enabled: true, categoryId: 'frontdesk' }]);
const HOME_TOGGLED_OFF = wf([{ type: 'home_visits', enabled: false }, { type: 'appointment', enabled: false, categoryId: 'frontdesk' }]);
const HOME_REMOVED = wf([{ type: 'patient_registration', enabled: true, categoryId: 'frontdesk' }]);

describe('lab-features — THE Home collection / Appointments rule', () => {
  it('both switches on ⇒ home collection on; either off ⇒ off', () => {
    expect(homeCollectionOn({ workflow: HOME_ON, moduleEnabled: entitled(true) })).toBe(true);
    expect(homeCollectionOn({ workflow: HOME_ON, moduleEnabled: entitled(false) })).toBe(false);      // entitlement off
    expect(homeCollectionOn({ workflow: HOME_TOGGLED_OFF, moduleEnabled: entitled(true) })).toBe(false); // toggled off
    expect(homeCollectionOn({ workflow: HOME_REMOVED, moduleEnabled: entitled(true) })).toBe(false);    // area deleted
  });

  it('no workflow = classic flow: on while entitled', () => {
    expect(homeCollectionOn({ workflow: null, moduleEnabled: entitled(true) })).toBe(true);
    expect(homeCollectionOn({ workflow: null, moduleEnabled: entitled(false) })).toBe(false);
    expect(appointmentsOn({ workflow: null, moduleEnabled: entitled(false) })).toBe(true);
  });

  it('appointment + home_visits are opt-in once a workflow exists; other actions stay fail-open', () => {
    expect(workflowActionOn(HOME_REMOVED, 'appointment')).toBe(false);
    expect(workflowActionOn(HOME_REMOVED, 'home_visits')).toBe(false);
    expect(workflowActionOn(HOME_REMOVED, 'lost_and_found')).toBe(true);
    // nav-items + ProcessWorkflowService read the SAME rule.
    expect(workflowActionEnabled(HOME_REMOVED, 'home_visits')).toBe(false);
    expect(workflowActionEnabled(HOME_REMOVED, 'lost_and_found')).toBe(true);
  });
});

describe('lab-features — every surface follows the rule', () => {
  const HOME_ROUTES = ['/frontdesk/home-collection', '/home-collections', '/admin/home-collection'];
  const ctx = (w: ProcessWorkflowConfig | null, entitledOn: boolean) => ({
    hasAny: () => true, isSuper: true,
    isEnabled: (a: string) => workflowActionOn(w, a),
    moduleEnabled: entitled(entitledOn),
  });
  const cases: Array<[string, ProcessWorkflowConfig | null, boolean, boolean]> = [
    ['both on', HOME_ON, true, true],
    ['entitlement off', HOME_ON, false, false],
    ['workflow toggled off', HOME_TOGGLED_OFF, true, false],
    ['workflow area removed', HOME_REMOVED, true, false],
  ];

  it.each(cases)('routes (guards): %s', (_n, w, ent, visible) => {
    for (const r of HOME_ROUTES) expect(canOpenRoute(r, ctx(w, ent))).toBe(visible);
  });

  it.each(cases)('nav items (top strip / bottom nav / More): %s', (_n, w, ent, visible) => {
    const items = [...PRIMARY_NAV, ...MORE_NAV].filter((i: NavItem) => HOME_ROUTES.includes(i.href));
    expect(items.length).toBeGreaterThan(0);
    const navCtx = { ...ctx(w, ent), collectionMode: 'front_desk' as const, billingMode: 'front_desk' as const, inventoryEnabled: true };
    for (const i of items) expect(navItemVisible(i, navCtx)).toBe(visible);
  });

  it('workflow nav: an area holding only Home Visits is not a work area while the entitlement is off', () => {
    const w = wf([{ type: 'home_visits', enabled: true, categoryId: 'field' }, { type: 'messages', enabled: true, categoryId: 'field' }]);
    const base = { roles: [], hasAnyPermission: () => true, isSuper: true };
    const on = menusFromWorkflow(w, { ...base, moduleEnabled: entitled(true) }) ?? [];
    const off = menusFromWorkflow({ ...w, actions: w.actions.filter(a => a.type === 'home_visits') }, { ...base, moduleEnabled: entitled(false) }) ?? [];
    expect(on.some(i => i.id === 'field')).toBe(true);
    expect(off.some(i => i.id === 'field')).toBe(false);
  });

  it.each(cases)('landing never sends a collector to Home Visits when off: %s', (_n, w, ent, visible) => {
    const landing = pickLanding({
      hasAny: p => p.includes('collect_sample'), isSuper: false,
      isEnabled: a => workflowActionOn(w, a) && a !== 'sample_collection', moduleEnabled: entitled(ent),
    });
    expect(landing === '/home-collections').toBe(visible);
  });

  it('front desk, settings hub, booking form, queue modes, hubs and admin search all read LabFeaturesService', () => {
    const src = (p: string) => readFileSync(`apps/lms/src/app/${p}`, 'utf8');
    const fd = src('features/frontdesk/frontdesk-landing/frontdesk-landing.component.ts');
    expect(fd).toMatch(/showHome = computed\(\(\) => this\.features\.homeCollectionEnabled\(\)\)/);
    expect(fd).toMatch(/if \(!this\.features\.appointmentsEnabled\(\)\) return false;/);
    // The Home collection list isn't fetched while off (its API 403s).
    expect(fd).toMatch(/if \(this\.showHome\(\)\) \{\s*this\.api\.get<Appointment\[\]>\('\/api\/home-collection\/all'\)/);
    const fdHtml = src('features/frontdesk/frontdesk-landing/frontdesk-landing.component.html');
    // Every Home collection tab (phone, classic desktop, and the ND segmented switch) sits behind showHome().
    const homeTabs = fdHtml.split('setLeftTab(\'home\')').length - 1 + (fdHtml.split('setMobileList(\'home\')').length - 1);
    expect(homeTabs).toBe(2);
    expect(fdHtml.match(/@if \(showHome\(\)\) \{/g)?.length).toBe(3);
    expect(src('features/lab/lab-settings-hub/lab-settings-hub.component.ts')).toMatch(/feature !== 'homeCollection' \|\| this\.features\.homeCollectionEnabled\(\)/);
    expect(src('features/frontdesk/book-appointment/book-appointment.component.ts').match(/@if \(features\.homeCollectionEnabled\(\)\) \{/g)?.length).toBe(2);
    expect(src('features/admin/appointments-config/appointments-config.component.ts')).toMatch(/this\.features\.homeCollectionEnabled\(\)/);
    for (const f of ['features/menu-hub/menu-hub.component.ts', 'features/work-area-host/work-area-host.component.ts'])
      expect(src(f)).toMatch(/this\.features\.actionAvailable\(a\.type\)/);
    expect(src('features/admin/admin-overview.component.ts')).toMatch(/moduleEnabled: \(m\) => this\.entitlements\.moduleEnabled\(m\)/);
    for (const f of ['features/frontdesk/patient-profile/patient-profile.component.html',
      'features/frontdesk/patient-register/patient-register.component.ts',
      'features/frontdesk/advanced-patient-search/advanced-patient-search.component.ts'])
      expect(src(f)).toMatch(/@if \(features\.appointmentsEnabled\(\)\) \{/);
  });
});

describe('LabFeaturesService — signals over both sources', () => {
  function setup(w: ProcessWorkflowConfig | null, homeEntitled: boolean) {
    const active = signal<ProcessWorkflowConfig | null>(w);
    const ent = signal(homeEntitled);
    TestBed.configureTestingModule({
      providers: [
        { provide: ProcessWorkflowService, useValue: { active, ensureLoaded: () => Promise.resolve() } },
        { provide: TenantEntitlementsService, useValue: {
          ensureLoaded: () => Promise.resolve(),
          moduleEnabled: (m: ModuleKey) => (m === 'homeCollection' ? ent() : true),
        } },
      ],
    });
    return { svc: TestBed.inject(LabFeaturesService), active, ent };
  }

  it('reacts when either switch flips (and back)', () => {
    const { svc, active, ent } = setup(HOME_ON, true);
    expect(svc.homeCollectionEnabled()).toBe(true);
    expect(svc.appointmentsEnabled()).toBe(true);
    ent.set(false);
    expect(svc.homeCollectionEnabled()).toBe(false);
    ent.set(true);
    active.set(HOME_REMOVED);
    expect(svc.homeCollectionEnabled()).toBe(false);
    expect(svc.appointmentsEnabled()).toBe(false);
    expect(svc.actionAvailable('home_visits')).toBe(false);
    active.set(HOME_ON);
    expect(svc.homeCollectionEnabled()).toBe(true);
  });
});
