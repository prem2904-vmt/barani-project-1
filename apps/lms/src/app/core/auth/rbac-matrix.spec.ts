import { Route } from '@angular/router';
import { appRoutes } from '../../app.routes';
import { ADMIN_NAV, MORE_NAV, NavItem, NavVisibilityCtx, PRIMARY_NAV, WorkflowNavCtx, menusFromWorkflow, navItemVisible } from '../../layout/nav-items';
import { ProcessWorkflowConfig } from '../../shared/models/process-workflow.model';
import { isOpdOnly, pickLanding } from './landing.guard';
import { ROUTE_ACCESS, RouteAccessCtx, canOpenRoute } from './route-access';

/**
 * RBAC MATRIX — role × route, for every seeded role.
 *
 *   nav visible  ⇔  the REAL route guards (read off appRoutes, parents included)
 *                   admit the user.
 *
 * The guard side is evaluated from the guard functions' own metadata
 * (permissionGuard.requiredPerms / .effective, workflowGuard.workflowActions) on
 * the live appRoutes tree — NOT from ROUTE_ACCESS — so this catches the nav and
 * the guards drifting apart in either direction.
 *
 * Role → permission sets are the dev-DB seeded roles (RoleSeeder) as of
 * 2026-09-27.
 */
const ROLES: Record<string, string[]> = {
  'Receptionist': ['collect_payment', 'collect_sample', 'create_bill', 'create_order', 'deliver_report', 'dispatch_sample', 'edit_patient', 'give_discount', 'lms.report_ready.notify', 'lms.sample_rejection.notify', 'print_barcode', 'register_patient', 'reject_sample', 'view_bill', 'view_order', 'view_patient', 'view_report', 'view_test'],
  'Billing Counter': ['collect_payment', 'create_bill', 'give_discount', 'print_barcode', 'view_bill', 'view_order', 'view_patient'],
  'Sample Collector': ['collect_sample', 'print_barcode', 'reject_sample', 'view_order', 'view_patient'],
  'Home Collection Agent': ['collect_sample', 'print_barcode', 'reject_sample', 'view_order', 'view_patient'],
  'Lab Technician': ['collect_sample', 'edit_result', 'enter_result', 'print_barcode', 'receive_sample', 'reject_sample', 'view_order', 'view_patient', 'view_report', 'view_test'],
  'Microbiology Technician': ['culture_workbench', 'edit_result', 'enter_result', 'print_barcode', 'receive_sample', 'view_order', 'view_patient', 'view_report', 'view_test'],
  'Pathologist': ['deliver_report', 'edit_result', 'lms.critical_value.notify', 'reassign_result', 'reject_result', 'validate_result', 'view_order', 'view_patient', 'view_report', 'view_test'],
  'Microbiologist': ['culture_workbench', 'deliver_report', 'edit_result', 'lms.critical_value.notify', 'reassign_result', 'reject_result', 'validate_result', 'view_order', 'view_patient', 'view_report', 'view_test'],
  'Branch Manager': ['lms.critical_value.escalate', 'lms.tat_breach.notify', 'manage_branch', 'manage_branches', 'manage_home_collection', 'view_audit_log', 'view_bill', 'view_dashboard', 'view_order', 'view_patient', 'view_report', 'view_tat_dashboard', 'view_test'],
  'Quality Manager': ['lms.critical_value.escalate', 'lms.tat_breach.notify', 'view_audit_log', 'view_bill', 'view_dashboard', 'view_order', 'view_patient', 'view_report', 'view_tat_dashboard', 'view_test'],
  'Store Keeper': ['inventory_count', 'inventory_issue', 'inventory_receive', 'print_barcode', 'view_test'],
  'Inventory Manager': ['inventory_count', 'inventory_issue', 'inventory_receive', 'inventory_transfer', 'manage_inventory', 'print_barcode', 'view_dashboard', 'view_test'],
  'Lab Admin': ['admit_patient', 'approve_discount', 'cancel_order', 'collect_payment', 'collect_sample', 'create_bill', 'create_order', 'culture_workbench', 'deliver_report', 'design_mode', 'dispatch_sample', 'dispense_drug', 'edit_patient', 'edit_result', 'enter_result', 'give_discount', 'inventory_count', 'inventory_issue', 'inventory_receive', 'inventory_transfer', 'manage_billing_config', 'manage_branch', 'manage_branches', 'manage_departments', 'manage_home_collection', 'manage_inventory', 'manage_ipd', 'manage_lab_settings', 'manage_notifications', 'manage_opd', 'manage_pharmacy', 'manage_report_template', 'manage_roles', 'manage_tenant', 'manage_tests', 'manage_users', 'manage_workflows', 'modify_order', 'opd_consult', 'override_discount', 'print_barcode', 'process_refund', 'reassign_result', 'receive_sample', 'register_patient', 'reject_result', 'reject_sample', 'validate_own_result', 'validate_result', 'view_audit_log', 'view_bill', 'view_dashboard', 'view_order', 'view_patient', 'view_report', 'view_tat_dashboard', 'view_test'],
  // Seeded 2026-09-30 (RoleSeeder.LabAdminTechnical): Test Master + prices +
  // lab settings + bench, no money / users / org.
  'Lab Admin (Technical)': ['collect_sample', 'culture_workbench', 'dispatch_sample', 'edit_result', 'enter_result', 'lms.critical_value.notify', 'lms.sample_rejection.notify', 'lms.tat_breach.notify', 'manage_departments', 'manage_lab_settings', 'manage_report_template', 'manage_test_master', 'manage_test_pricing', 'print_barcode', 'reassign_result', 'receive_sample', 'reject_result', 'reject_sample', 'view_audit_log', 'view_order', 'view_patient', 'view_report', 'view_tat_dashboard', 'view_test'],
  'super-admin': ['*'],
};

/** A user holding one OR MORE seeded roles; perms = the union (what the backend
 *  puts in the token). `dedicated` only sets the branch's collection MODE (which
 *  nav items are eligible) — it no longer changes anyone's permissions. */
interface Who { roles: string[]; perms: string[]; dedicated: boolean }

const has = (w: Who) => (codes: readonly string[]) => w.perms.includes('*') || codes.some(c => w.perms.includes(c));
/** Mirrors AuthService.hasEffectivePermission, which is now plain hasPermission:
 *  collection is purely collect_sample (owner 2026-09-27) — the old
 *  "Receptionist loses collect_sample at a dedicated counter" rule is gone. */
const hasEffective = has;

// ── Guard evaluation straight off appRoutes ──────────────────────────────
type Meta = { requiredPerms?: string[]; effective?: boolean; workflowActions?: string[] };

/** The guard chain (outermost → leaf) for an absolute path, or null if no route. */
function guardChain(href: string): Meta[][] | null {
  const segs = href.split('?')[0].split('/').filter(Boolean);
  const walk = (routes: Route[], rest: string[], acc: Meta[][]): Meta[][] | null => {
    for (const r of routes) {
      const parts = (r.path ?? '').split('/').filter(Boolean);
      if (parts.length > rest.length) continue;
      if (!parts.every((p, i) => p.startsWith(':') || p === rest[i])) continue;
      const remaining = rest.slice(parts.length);
      const here = [...acc, (r.canActivate ?? []) as Meta[]];
      if (!remaining.length) {
        if (r.redirectTo !== undefined) continue;
        if (r.loadComponent || r.component) return here;
        const leaf = r.children && walk(r.children, [], here);
        if (leaf) return leaf;
        continue;
      }
      if (r.children) {
        const hit = walk(r.children, remaining, here);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(appRoutes, segs, []);
}

function guardAllows(href: string, w: Who, isEnabled: (a: string) => boolean = () => true): boolean {
  const chain = guardChain(href);
  if (!chain) throw new Error(`no route for ${href}`);
  return chain.flat().every(g => {
    if (g.requiredPerms) return (g.effective ? hasEffective(w) : has(w))(g.requiredPerms);
    if (g.workflowActions) return g.workflowActions.some(isEnabled);
    return true;   // authGuard / moduleGuard (all modules on) / redirects
  });
}

function navCtx(w: Who, over: Partial<NavVisibilityCtx> = {}): NavVisibilityCtx {
  return {
    hasAny: p => has(w)(p),
    hasAnyEffective: p => hasEffective(w)(p),
    isEnabled: () => true,
    isSuper: w.perms.includes('*'),
    collectionMode: w.dedicated ? 'dedicated_counter' : 'front_desk',
    billingMode: 'separate_counter',
    inventoryEnabled: true,
    moduleEnabled: () => true,
    ...over,
  };
}

const wfCtx = (w: Who): WorkflowNavCtx => ({
  roles: w.roles,
  hasAnyPermission: p => hasEffective(w)(p),
  hasAnyRawPermission: p => has(w)(p),
  isSuper: w.perms.includes('*'),
});

const who = (role: string, dedicated = false): Who => ({ roles: [role], perms: ROLES[role], dedicated });
/** A multi-role user: permissions are the UNION of every role's set. */
const whoMulti = (roles: string[], dedicated = false): Who => ({
  roles,
  perms: [...new Set(roles.flatMap(r => ROLES[r]))],
  dedicated,
});

/** Realistic multi-role combinations seen on tenants (small labs double-hat). */
const COMBOS: string[][] = [
  ['Billing Counter', 'Receptionist'],            // QA #1: Micro World "frontdesk"
  ['Receptionist', 'Sample Collector'],
  ['Billing Counter', 'Sample Collector'],
  ['Billing Counter', 'Receptionist', 'Sample Collector'],
  ['Receptionist', 'Home Collection Agent'],
  ['Receptionist', 'Lab Technician'],
  ['Sample Collector', 'Lab Technician'],
  ['Lab Technician', 'Pathologist'],
  ['Receptionist', 'Pathologist'],
  ['Receptionist', 'Branch Manager'],
  ['Receptionist', 'Store Keeper'],
  ['Billing Counter', 'Quality Manager'],
];

// Nav items with a mode gate only show in their mode; the matrix sets the modes
// so every item is eligible (dedicated_counter for Collect, separate_counter for
// Billing), then compares visibility with the guards.
const ALL_NAV: NavItem[] = [ADMIN_NAV, ...PRIMARY_NAV, ...MORE_NAV];

/** The owner's live Micro World workflow ("Without Collection Center",
 *  2026-09-27) — note the Sample-collection copy placed in the LAB area. */
const MICRO_WORLD: ProcessWorkflowConfig = {
  categories: [
    { id: 'frontdesk', icon: 'reception', name: 'Frontdesk', color: '#7c3aed', order: 0, roles: ['Receptionist', 'Branch Manager', 'Lab Admin'] },
    { id: 'collect', icon: 'tube', name: 'Collect', color: '#7c3aed', order: 1, roles: ['Sample Collector', 'Lab Admin', 'Branch Manager'] },
    { id: 'lab', icon: 'microscope', name: 'Lab', color: '#10b981', order: 2, roles: ['Lab Technician', 'Lab Admin'] },
    { id: 'validate', icon: 'check', name: 'Validate', color: '#f59e0b', order: 3, roles: ['Pathologist', 'Lab Admin'] },
    { id: 'results', icon: 'report', name: 'Results', color: '#ec4899', order: 4, roles: ['Receptionist', 'Branch Manager', 'Lab Admin'] },
    { id: 'msgs', icon: 'chat', name: 'Messages', color: '#64748b', order: 5 },
  ],
  actions: [
    { id: 'b', type: 'billing', order: 0, enabled: true, categoryId: 'frontdesk' },
    { id: 'a1', type: 'appointment', order: 1, enabled: true, categoryId: 'frontdesk' },
    { id: 'c-fd', type: 'sample_collection', order: 2, enabled: true, categoryId: 'frontdesk' },
    { id: 'd', type: 'dispatch', order: 3, enabled: true, categoryId: 'frontdesk' },
    { id: 'a2', type: 'patient_registration', order: 4, enabled: true, categoryId: 'frontdesk' },
    { id: 'a3', type: 'walk_in_order', order: 5, enabled: true, categoryId: 'frontdesk' },
    { id: 'a6', type: 'queue', order: 6, enabled: true, categoryId: 'frontdesk' },
    { id: 'collect-home', type: 'sample_collection', order: 0, enabled: true, categoryId: 'collect' },
    { id: 'a9', type: 'lab_intake', order: 0, enabled: true, categoryId: 'lab' },
    { id: 'a10', type: 'result_entry', order: 1, enabled: true, categoryId: 'lab' },
    { id: 'c-lab', type: 'sample_collection', order: 2, enabled: true, categoryId: 'lab' },
    { id: 'a11', type: 'validate', order: 0, enabled: true, categoryId: 'validate' },
    { id: 'a12', type: 'results', order: 0, enabled: true, categoryId: 'results' },
    { id: 'm', type: 'messages', order: 0, enabled: true, categoryId: 'msgs' },
  ],
};

describe('RBAC matrix — ROUTE_ACCESS is what the route guards actually enforce', () => {
  for (const [route, acc] of Object.entries(ROUTE_ACCESS)) {
    it(`${route}: guard metadata on appRoutes == ROUTE_ACCESS`, () => {
      const chain = guardChain(route);
      expect(chain, `appRoutes has no route for ${route}`).not.toBeNull();
      const own = chain![chain!.length - 1];
      const perm = own.find(g => g.requiredPerms);
      expect([...(perm?.requiredPerms ?? [])].sort()).toEqual([...(acc.perms ?? [])].sort());
      expect(!!perm?.effective).toBe(!!acc.effective);
      const wf = own.find(g => g.workflowActions);
      expect([...(wf?.workflowActions ?? [])].sort()).toEqual([...(acc.workflow ?? [])].sort());
    });
  }
});

describe('RBAC matrix — nav visible ⇔ guard allows (every seeded role × every nav entry)', () => {
  for (const role of Object.keys(ROLES)) {
    for (const dedicated of [false, true]) {
      const w = who(role, dedicated);
      it(`${role}${dedicated ? ' (dedicated collection counter)' : ''}`, () => {
        const ctx = navCtx(w);
        // A MODE-gated item (Collect only as a dedicated counter, Billing only as
        // a separate counter) is legitimately hidden outside its mode — there the
        // screen is reached from the host area instead — so for those only
        // "nav ⇒ guard" must hold.
        const modeHidden = (i: NavItem) =>
          (!!i.collectionModes && !i.collectionModes.includes(ctx.collectionMode)) ||
          (!!i.billingModes && !i.billingModes.includes(ctx.billingMode));
        const mismatches = ALL_NAV
          .map(i => ({ href: i.href, nav: navItemVisible(i, ctx), guard: guardAllows(i.href, w), modeHidden: modeHidden(i) }))
          .filter(r => r.modeHidden ? (r.nav && !r.guard) : r.nav !== r.guard);
        expect(mismatches).toEqual([]);
      });
    }
  }
});

describe('RBAC matrix — workflow work areas (the owner\'s live Micro World workflow)', () => {
  const areasFor = (role: string, dedicated = false) =>
    (menusFromWorkflow(MICRO_WORLD, wfCtx(who(role, dedicated))) ?? []).map(i => i.id);

  it('REPORTED CASE: a Receptionist does NOT see "Lab" (its only Lab-area action is a Sample-collection copy)', () => {
    const areas = areasFor('Receptionist');
    expect(areas).not.toContain('lab');
    expect(guardAllows('/lab/my-work', who('Receptionist'))).toBe(false);
    // …and still collects through the Collect area and the Frontdesk.
    expect(areas).toEqual(expect.arrayContaining(['frontdesk', 'collect', 'results']));
  });

  it('a Sample Collector sees Collect only (not Lab, not Frontdesk)', () => {
    const areas = areasFor('Sample Collector');
    expect(areas).toContain('collect');
    expect(areas).not.toContain('lab');
    expect(areas).not.toContain('frontdesk');
  });

  it('a Lab Technician sees Lab; a Pathologist sees Validate + Results; Billing Counter sees Frontdesk', () => {
    expect(areasFor('Lab Technician')).toContain('lab');
    expect(areasFor('Lab Technician')).toContain('results');        // view_report → view-only Results
    expect(areasFor('Pathologist')).toEqual(expect.arrayContaining(['validate', 'results']));
    expect(areasFor('Billing Counter')).toContain('frontdesk');
    expect(areasFor('Branch Manager')).toContain('results');
  });

  for (const role of Object.keys(ROLES)) {
    for (const dedicated of [false, true]) {
      it(`${role}${dedicated ? ' (dedicated)' : ''}: every work area it sees opens (guard allows)`, () => {
        const w = who(role, dedicated);
        const items = menusFromWorkflow(MICRO_WORLD, wfCtx(w)) ?? [];
        const blocked = items.filter(i => i.href.startsWith('/w/') ? false : !guardAllows(i.href, w)).map(i => i.href);
        expect(blocked).toEqual([]);
        // …and the shells' shared filter keeps every one of them.
        expect(items.filter(i => !navItemVisible(i, navCtx(w)))).toEqual([]);
      });
    }
  }

  it('a Lab area whose result_entry is switched off is hidden (the /lab/my-work workflow guard would bounce)', () => {
    const cfg: ProcessWorkflowConfig = {
      ...MICRO_WORLD,
      actions: MICRO_WORLD.actions.map(a => a.type === 'result_entry' ? { ...a, enabled: false } : a),
    };
    const ids = (menusFromWorkflow(cfg, wfCtx(who('Lab Technician'))) ?? []).map(i => i.id);
    expect(ids).not.toContain('lab');
  });
});

describe('RBAC matrix — landing after login', () => {
  for (const role of Object.keys(ROLES)) {
    it(`${role} lands on a screen its guards admit (never /403)`, () => {
      const w = who(role);
      const ctx: RouteAccessCtx = { hasAny: p => has(w)(p), hasAnyEffective: p => hasEffective(w)(p), isEnabled: () => true, isSuper: w.perms.includes('*') };
      const landing = pickLanding(ctx);
      expect(landing).not.toBe('/403');
      expect(guardAllows(landing, w)).toBe(true);
    });
  }

  it('Billing Counter lands on /frontdesk (used to fall through to /403)', () => {
    const w = who('Billing Counter');
    expect(pickLanding({ hasAny: p => has(w)(p), isEnabled: () => true })).toBe('/frontdesk');
  });
});

describe('RBAC matrix — OPD-only doctor lands on the queue first', () => {
  const ctxFor = (perms: string[]): RouteAccessCtx => ({ hasAny: p => p.some(c => perms.includes(c)), isEnabled: () => true });
  it('an OPD-only doctor lands on /opd/consult even with a lab read permission', () => {
    const ctx = ctxFor(['view_report', 'view_order', 'view_test']);
    expect(pickLanding(ctx)).not.toBe('/opd/consult');
    expect(pickLanding({ ...ctx, opdDoctor: true, opdOnlyDoctor: true })).toBe('/opd/consult');
  });
  it('opdOnlyDoctor alone (OPD hidden / not a doctor) changes nothing', () => {
    const ctx = ctxFor(['view_report']);
    expect(pickLanding({ ...ctx, opdOnlyDoctor: true })).toBe(pickLanding(ctx));
  });
  it('isOpdOnly: only when every role is OPD-scoped', () => {
    expect(isOpdOnly(['opd'])).toBe(true);
    expect(isOpdOnly(['lab', 'opd'])).toBe(false);
    expect(isOpdOnly(['lab'])).toBe(false);
    expect(isOpdOnly([])).toBe(false);
    expect(isOpdOnly(undefined)).toBe(false);
  });
});

describe('RBAC matrix — OPD doctor landing (opdDoctor)', () => {
  // A user with NO permission that matches any LANDINGS row — the exact case
  // that used to fall through to '/403'.
  const NO_LANDING: RouteAccessCtx = { hasAny: () => false, isEnabled: () => true };

  it('a doctor with no other landing lands on /opd/consult when opdDoctor is set', () => {
    expect(pickLanding({ ...NO_LANDING, opdDoctor: true })).toBe('/opd/consult');
  });

  it('lab behaviour is IDENTICAL when opdDoctor is false or omitted (still /403)', () => {
    expect(pickLanding({ ...NO_LANDING, opdDoctor: false })).toBe('/403');
    expect(pickLanding(NO_LANDING)).toBe('/403');
  });

  for (const role of Object.keys(ROLES)) {
    it(`${role}: opdDoctor never changes an already-admitted landing (an admin who is also a doctor keeps /admin)`, () => {
      const w = who(role);
      const ctx: RouteAccessCtx = { hasAny: p => has(w)(p), hasAnyEffective: p => hasEffective(w)(p), isEnabled: () => true, isSuper: w.perms.includes('*') };
      expect(pickLanding({ ...ctx, opdDoctor: true })).toBe(pickLanding(ctx));
    });
  }
});

describe('canOpenRoute', () => {
  const ctx = (perms: string[]): RouteAccessCtx => ({ hasAny: p => p.some(c => perms.includes(c)), isEnabled: () => true });
  it('ANDs a guarded parent with the child (queue needs a front-desk perm too)', () => {
    expect(canOpenRoute('/frontdesk/queue', ctx(['collect_sample']))).toBe(false);
    expect(canOpenRoute('/frontdesk/queue', ctx(['collect_sample', 'register_patient']))).toBe(true);
  });
  it('ignores query strings and honours workflow + module gates', () => {
    expect(canOpenRoute('/admin/manage?cat=org', ctx(['manage_tests']))).toBe(true);
    expect(canOpenRoute('/lab/my-work', { ...ctx(['enter_result']), isEnabled: a => a !== 'result_entry' })).toBe(false);
    expect(canOpenRoute('/stores', { ...ctx(['inventory_issue']), moduleEnabled: () => false })).toBe(false);
  });
  it('super-admin passes every permission gate', () => {
    expect(Object.keys(ROUTE_ACCESS).every(r => canOpenRoute(r, { hasAny: () => false, isSuper: true }))).toBe(true);
  });
});

describe('RBAC matrix — MULTI-role users (permission union + live Micro World workflow)', () => {
  const areasFor = (w: Who) => (menusFromWorkflow(MICRO_WORLD, wfCtx(w)) ?? []).map(i => i.id);

  it('QA #1: Billing Counter + Receptionist does NOT see "Lab" (union has no enter_result/receive_sample)', () => {
    for (const dedicated of [false, true]) {
      const w = whoMulti(['Billing Counter', 'Receptionist'], dedicated);
      const areas = areasFor(w);
      expect(areas).not.toContain('lab');
      expect(guardAllows('/lab/my-work', w)).toBe(false);
      expect(areas).toEqual(expect.arrayContaining(['frontdesk', 'results']));
      // The no-workflow fallback nav must not show Lab either.
      expect(PRIMARY_NAV.filter(i => navItemVisible(i, navCtx(w))).map(i => i.href)).not.toContain('/lab/my-work');
    }
  });

  it('Receptionist + Sample Collector keeps Collect (even at a dedicated counter) but not Lab', () => {
    for (const dedicated of [false, true]) {
      const areas = areasFor(whoMulti(['Receptionist', 'Sample Collector'], dedicated));
      expect(areas).toContain('collect');
      expect(areas).not.toContain('lab');
    }
  });

  it('Receptionist + Lab Technician DOES see Lab (enter_result/receive_sample via Lab Tech)', () => {
    expect(areasFor(whoMulti(['Receptionist', 'Lab Technician']))).toEqual(expect.arrayContaining(['frontdesk', 'lab']));
  });

  for (const combo of COMBOS) {
    for (const dedicated of [false, true]) {
      const label = `${combo.join(' + ')}${dedicated ? ' (dedicated)' : ''}`;
      it(`${label}: nav visible ⇔ guard allows`, () => {
        const w = whoMulti(combo, dedicated);
        const ctx = navCtx(w);
        const modeHidden = (i: NavItem) =>
          (!!i.collectionModes && !i.collectionModes.includes(ctx.collectionMode)) ||
          (!!i.billingModes && !i.billingModes.includes(ctx.billingMode));
        const mismatches = ALL_NAV
          .map(i => ({ href: i.href, nav: navItemVisible(i, ctx), guard: guardAllows(i.href, w), modeHidden: modeHidden(i) }))
          .filter(r => r.modeHidden ? (r.nav && !r.guard) : r.nav !== r.guard);
        expect(mismatches).toEqual([]);
      });
      it(`${label}: every workflow work area it sees opens`, () => {
        const w = whoMulti(combo, dedicated);
        const items = menusFromWorkflow(MICRO_WORLD, wfCtx(w)) ?? [];
        expect(items.filter(i => !i.href.startsWith('/w/') && !guardAllows(i.href, w)).map(i => i.href)).toEqual([]);
        expect(items.filter(i => !navItemVisible(i, navCtx(w)))).toEqual([]);
      });
    }
    it(`${combo.join(' + ')}: lands on a screen its guards admit`, () => {
      const w = whoMulti(combo);
      const landing = pickLanding({ hasAny: p => has(w)(p), hasAnyEffective: p => hasEffective(w)(p), isEnabled: () => true });
      expect(landing).not.toBe('/403');
      expect(guardAllows(landing, w)).toBe(true);
    });
  }
});

describe('RBAC matrix — owner decisions 2026-09-27', () => {
  const areasFor = (w: Who) => (menusFromWorkflow(MICRO_WORLD, wfCtx(w)) ?? []).map(i => i.id);
  const custom = (roles: string[], perms: string[], dedicated = false): Who => ({ roles, perms, dedicated });
  const RECEPTION_NO_COLLECT = ROLES['Receptionist'].filter(p => p !== 'collect_sample');

  describe('view-only Results (view_report without deliver_report)', () => {
    for (const role of ['Lab Technician', 'Branch Manager', 'Quality Manager']) {
      it(`${role} sees Results in the nav and can open the list + a report`, () => {
        const w = who(role);
        expect(ROLES[role]).toContain('view_report');
        expect(ROLES[role]).not.toContain('deliver_report');
        expect(guardAllows('/reports', w)).toBe(true);
        expect(guardAllows('/reports/view/abc', w)).toBe(true);
        expect(canOpenRoute('/reports', { hasAny: p => has(w)(p), isEnabled: () => true })).toBe(true);
        expect(areasFor(w)).toContain('results');
      });
    }

    it('no report permission at all → no Results (Sample Collector, Billing Counter)', () => {
      for (const role of ['Sample Collector', 'Billing Counter']) {
        expect(guardAllows('/reports', who(role))).toBe(false);
        expect(areasFor(who(role))).not.toContain('results');
      }
    });

    it('the Results catalog action and the route take the same permissions', () => {
      expect([...(ROUTE_ACCESS['/reports'].perms ?? [])].sort()).toEqual(['deliver_report', 'view_report']);
    });
  });

  describe('Receptionist collection = collect_sample (no dedicated-counter rule)', () => {
    for (const dedicated of [false, true]) {
      const mode = dedicated ? 'dedicated counter' : 'front desk';
      it(`WITH collect_sample (${mode}): sees Collect and opens every collection screen`, () => {
        const w = who('Receptionist', dedicated);
        expect(w.perms).toContain('collect_sample');
        for (const r of ['/sample-collection', '/lab/collect', '/home-collections']) expect(guardAllows(r, w)).toBe(true);
        expect(areasFor(w)).toContain('collect');
        const nav = ALL_NAV.filter(i => navItemVisible(i, navCtx(w))).map(i => i.href);
        if (dedicated) expect(nav).toContain('/sample-collection');
      });

      it(`WITHOUT collect_sample (${mode}): no Collect area, every collection screen bounces`, () => {
        const w = custom(['Receptionist'], RECEPTION_NO_COLLECT, dedicated);
        for (const r of ['/sample-collection', '/lab/collect', '/home-collections']) expect(guardAllows(r, w)).toBe(false);
        expect(areasFor(w)).not.toContain('collect');
        const nav = ALL_NAV.filter(i => navItemVisible(i, navCtx(w))).map(i => i.href);
        expect(nav).not.toContain('/sample-collection');
      });
    }

    it('no route relies on a mode-aware (effective) guard any more', () => {
      expect(Object.entries(ROUTE_ACCESS).filter(([, a]) => a.effective).map(([r]) => r)).toEqual([]);
    });
  });
});
