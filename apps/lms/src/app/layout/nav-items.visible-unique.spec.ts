import { ADMIN_NAV, MORE_NAV, NavItem, NavVisibilityCtx, PRIMARY_NAV, navItemVisible } from './nav-items';

/**
 * Re-test 2026-11-13: the Start menu / bottom nav list what a USER sees, not the raw tables. For every kind of
 * user (each single permission, everyone, the super admin) and both collection/billing modes, the visible
 * entries must never repeat an id, a label or a route (the duplicate "Lab settings" regression).
 */
const ALL: NavItem[] = [ADMIN_NAV, ...PRIMARY_NAV, ...MORE_NAV];
const PERMS = Array.from(new Set(ALL.flatMap(i => i.permissions ?? []))).sort();

const ctxFor = (perms: string[], isSuper: boolean, mode: 'front_desk' | 'dedicated_counter', bill: 'front_desk' | 'separate_counter'): NavVisibilityCtx => ({
  hasAny: (p: string[]) => isSuper || p.some(x => perms.includes(x)),
  isSuper,
  collectionMode: mode,
  billingMode: bill,
  inventoryEnabled: true,
  moduleEnabled: () => true,
});

const dupes = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i);

describe('Start menu: what each user sees lists every entry once', () => {
  const who: Array<[string, string[], boolean]> = [
    ['super admin', [], true],
    ['holds every permission', PERMS, false],
    ...PERMS.map((p): [string, string[], boolean] => [`only ${p}`, [p], false]),
    ['nothing', [], false],
  ];
  for (const [mode, bill] of [['front_desk', 'front_desk'], ['dedicated_counter', 'separate_counter']] as const) {
    it(`no repeated id / label / route in mode ${mode}`, () => {
      for (const [name, perms, sup] of who) {
        const ctx = ctxFor(perms, sup, mode, bill);
        const visible = ALL.filter(i => navItemVisible(i, ctx));
        const d = {
          ids: dupes(visible.map(i => i.id)),
          // ADMIN_NAV is the admin shell entry and shares /admin with its overview tile by design.
          labels: dupes(visible.filter(i => i !== ADMIN_NAV).map(i => i.label.trim().toLowerCase())),
          routes: dupes(visible.filter(i => i !== ADMIN_NAV).map(i => i.href)),
        };
        expect({ name, ...d }).toEqual({ name, ids: [], labels: [], routes: [] });
      }
    });
  }

  it('Lab settings appears once for the lab admin and Inventory settings is named so', () => {
    const ctx = ctxFor(PERMS, true, 'front_desk', 'front_desk');
    const labels = ALL.filter(i => navItemVisible(i, ctx)).map(i => i.label);
    expect(labels.filter(l => /^lab settings$/i.test(l)).length).toBe(1);
    expect(labels).toContain('Inventory settings');
    expect(labels.filter(l => /^inventory config/i.test(l)).length).toBe(0);
  });
});
