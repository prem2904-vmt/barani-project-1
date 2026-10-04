import { EXPENSES_NAV, MORE_NAV, NavItem, NavVisibilityCtx, PRIMARY_NAV, navItemVisible, withExpenses } from './nav-items';
import { ROUTE_ACCESS, canOpenRoute } from '../core/auth/route-access';
import { LANDINGS, pickLanding } from '../core/auth/landing.guard';
import { appRoutes as routes } from '../app.routes';
import { pageSkeletonFor } from '../core/navigation/page-skeleton';
import { PERMISSION_INFO, PERMISSION_GROUPS } from '../features/admin/users-access/permission-catalog';

/**
 * Expenses is a PRIMARY everyday screen (owner 2026-09-30): in the main nav —
 * top strip / sidebar, bottom nav on phone / tablet / desktop, the
 * workflow-driven work areas — for anyone holding an expense_* permission, and
 * for nobody else. nav == guard: the item carries the route's own gate.
 */
const EXPENSE_CODES = ['expense_viewer', 'expense_modifier', 'expense_admin'];

const ctx = (...perms: string[]): NavVisibilityCtx => ({
  hasAny: p => p.some(c => perms.includes(c)),
  isEnabled: () => true,
  isSuper: false,
  collectionMode: 'front_desk',
  billingMode: 'front_desk',
  inventoryEnabled: false,
  moduleEnabled: () => true,
});
const ids = (items: NavItem[], c: NavVisibilityCtx) => items.filter(i => navItemVisible(i, c)).map(i => i.id);

describe('Expenses in the primary nav', () => {
  it.each(EXPENSE_CODES)('shows Expenses to a user holding only %s', code => {
    expect(ids(PRIMARY_NAV, ctx(code))).toContain('expenses');
  });

  it('hides it from a user with no expense permission (front desk, bench, doctor, admin config)', () => {
    for (const perms of [['register_patient', 'create_bill', 'collect_payment'], ['enter_result', 'receive_sample'],
                         ['validate_result', 'view_report'], ['manage_tests', 'manage_users'], []]) {
      expect(ids(PRIMARY_NAV, ctx(...perms))).not.toContain('expenses');
    }
  });

  it('sits after the lab work items and before Stores / Messages; Settings is the separate admin icon', () => {
    const order = PRIMARY_NAV.map(i => i.id);
    expect(order.indexOf('expenses')).toBe(order.indexOf('results') + 1);
    expect(order.indexOf('expenses')).toBeLessThan(order.indexOf('messages'));
    expect(EXPENSES_NAV).toMatchObject({ id: 'expenses', label: 'Expenses', href: '/expenses' });
  });

  it('carries the route guard\'s own permissions (nav == guard) and a stroked SVG icon', () => {
    expect(EXPENSES_NAV.permissions).toEqual(ROUTE_ACCESS['/expenses'].perms);
    expect([...EXPENSES_NAV.permissions!].sort()).toEqual([...EXPENSE_CODES].sort());
    for (const code of EXPENSE_CODES) expect(canOpenRoute('/expenses', { hasAny: p => p.includes(code) })).toBe(true);
    expect(canOpenRoute('/expenses', { hasAny: () => false })).toBe(false);
    expect(EXPENSES_NAV.iconPath.length).toBeGreaterThan(0);
    for (const d of EXPENSES_NAV.iconPath) expect(d).toMatch(/^M[\d\s.,MLHVCSQTAZmlhvcsqtaz-]+$/);
  });

  it('is not duplicated in More', () => {
    expect(MORE_NAV.some(i => i.id === 'expenses' || i.href === '/expenses' || i.href === '/finance/expenses')).toBe(false);
    const all = [...PRIMARY_NAV, ...MORE_NAV].filter(i => i.href === '/expenses');
    expect(all.length).toBe(1);
  });
});

describe('withExpenses — the workflow-driven nav', () => {
  const area = (id: string, href: string): NavItem => ({ id, label: id, href, iconPath: ['M0 0h1'] });
  const wf = [area('frontdesk', '/frontdesk'), area('lab', '/lab/my-work'), area('results', '/reports'), area('messages', '/messages')];

  it('inserts Expenses right after the last lab work item when the user may open it', () => {
    expect(withExpenses(wf, () => true).map(i => i.id)).toEqual(['frontdesk', 'lab', 'results', 'expenses', 'messages']);
    expect(withExpenses([area('frontdesk', '/frontdesk'), area('m', '/messages')], () => true).map(i => i.id))
      .toEqual(['frontdesk', 'expenses', 'm']);
    expect(withExpenses([area('x', '/w/x')], () => true).map(i => i.id)).toEqual(['x', 'expenses']);
  });

  it('never adds it without permission, and never twice', () => {
    expect(withExpenses(wf, () => false)).toBe(wf);
    const once = withExpenses(wf, () => true);
    expect(withExpenses(once, () => true)).toBe(once);
    expect(withExpenses(PRIMARY_NAV, () => true)).toBe(PRIMARY_NAV);   // the fallback already has it
  });

  it('uses the shells\' visibility rule: each expense code admits it, none hides it', () => {
    for (const code of EXPENSE_CODES) {
      const c = ctx(code);
      expect(withExpenses(wf, i => navItemVisible(i, c)).some(i => i.id === 'expenses')).toBe(true);
    }
    const none = ctx('enter_result');
    expect(withExpenses(wf, i => navItemVisible(i, none)).some(i => i.id === 'expenses')).toBe(false);
  });
});

describe('Expenses route', () => {
  const shell = routes.find(r => (r.children ?? []).some(c => c.path === 'expenses'))!;
  const child = (path: string) => shell.children!.find(c => c.path === path)!;

  it('/expenses is the screen (guarded by its ROUTE_ACCESS entry); /finance/expenses redirects to it', () => {
    expect(child('expenses').loadComponent).toBeDefined();
    expect(child('expenses').canActivate?.length).toBeGreaterThan(0);
    expect(child('finance/expenses')).toMatchObject({ redirectTo: 'expenses', pathMatch: 'full' });
  });

  it('has a page skeleton and a landing for expense-only staff', () => {
    expect(pageSkeletonFor('/expenses')?.label).toBe('Opening Expenses…');
    expect(pageSkeletonFor('/finance/expenses')?.label).toBe('Opening Expenses…');
    expect(LANDINGS.some(l => l.path === '/expenses')).toBe(true);
    expect(pickLanding({ hasAny: p => p.includes('expense_modifier') })).toBe('/expenses');
    // Anyone with real lab work still lands on their work screen first.
    expect(pickLanding({ hasAny: p => p.includes('enter_result') || p.includes('expense_modifier'), isEnabled: () => true })).toBe('/lab/my-work');
  });
});

describe('role editor — the Expenses group', () => {
  it('groups the three codes under "Expenses" with plain descriptions', () => {
    expect(PERMISSION_GROUPS.find(g => g.key === 'expenses')?.label).toBe('Expenses');
    expect(PERMISSION_INFO['expense_modifier']).toMatchObject({ group: 'expenses', title: 'Enter my own expenses' });
    expect(PERMISSION_INFO['expense_viewer']).toMatchObject({ group: 'expenses', title: 'See everyone’s expenses' });
    expect(PERMISSION_INFO['expense_admin']).toMatchObject({ group: 'expenses', title: 'Cashier — day closing', sensitive: true });
  });
});
