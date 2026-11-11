import { NavItem } from '../nav-items';
import {
  NAV_CAPACITY_LAPTOP, NAV_CAPACITY_PHONE, NAV_CAPACITY_TABLET, NAV_CAPACITY_WIDE,
  computeNavLayout, mergeRoleDefaults, movePinned, navCapacity, normalizeRoleNav, togglePinned,
} from './nav-pins';

const item = (id: string, href = `/${id}`): NavItem => ({ id, label: id.toUpperCase(), href, iconPath: ['M0 0'] });
const WORK = ['frontdesk', 'lab', 'validate', 'results', 'expenses'].map(i => item(i));
const ADMIN = item('admin', '/admin');
const ALL = [...WORK, ADMIN];
const MORE = [item('m-opd', '/opd'), item('lab-settings', '/lab/settings'), item('admin-overview', '/admin')];
const ids = (l: NavItem[]) => l.map(i => i.id);
const base = { all: ALL, more: MORE, roleDefaults: null, userPins: null, capacity: 10 };

describe('navCapacity', () => {
  it('follows the viewport width', () => {
    expect(navCapacity(390, false)).toBe(NAV_CAPACITY_PHONE);
    expect(navCapacity(639, false)).toBe(4);
    expect(navCapacity(640, false)).toBe(NAV_CAPACITY_TABLET);
    expect(navCapacity(1023, false)).toBe(6);
    expect(navCapacity(1024, false)).toBe(NAV_CAPACITY_LAPTOP);
    expect(navCapacity(1439, false)).toBe(8);
    expect(navCapacity(1440, false)).toBe(NAV_CAPACITY_WIDE);
    expect(navCapacity(1920, false)).toBe(10);
  });
  it('icons only fits about half as many again, rounded down', () => {
    expect(navCapacity(390, true)).toBe(6);
    expect(navCapacity(800, true)).toBe(9);
    expect(navCapacity(1200, true)).toBe(12);
    expect(navCapacity(1600, true)).toBe(15);
  });
});

describe('mergeRoleDefaults', () => {
  it('is null when the person holds no role that has defaults', () => {
    expect(mergeRoleDefaults(null, ['Admin'])).toBeNull();
    expect(mergeRoleDefaults({ Nurse: { pinned: ['lab'], locked: [] } }, ['Admin'])).toBeNull();
    expect(mergeRoleDefaults({ Admin: { pinned: [], locked: [] } }, ['Admin'])).toBeNull();
  });
  it('unions pinned (first role first, no duplicates) and locked', () => {
    const m = mergeRoleDefaults({
      A: { pinned: ['lab', 'validate'], locked: ['lab'] },
      B: { pinned: ['validate', 'results'], locked: ['results'] },
    }, ['A', 'B']);
    expect(m).toEqual({ pinned: ['lab', 'validate', 'results'], locked: ['lab', 'results'] });
  });
  it('always pins what is locked', () => {
    expect(mergeRoleDefaults({ A: { pinned: ['lab'], locked: ['results'] } }, ['A'])!.pinned).toEqual(['lab', 'results']);
  });
});

describe('computeNavLayout', () => {
  it('no config at all = today\'s order, trimmed to what fits; the rest lists under Work', () => {
    const l = computeNavLayout({ ...base, capacity: 3 });
    expect(l.configured).toBe(false);
    expect(ids(l.bar)).toEqual(['frontdesk', 'lab', 'validate']);
    expect(ids(l.menu.pinned)).toEqual(['frontdesk', 'lab', 'validate']);
    expect(ids(l.menu.work)).toEqual(['results', 'expenses']);
    expect(ids(l.menu.settings)).toEqual(['admin']);
    expect(ids(computeNavLayout({ ...base, capacity: 10 }).bar)).toEqual(['frontdesk', 'lab', 'validate', 'results', 'expenses', 'admin']);
  });

  it('never customised = the role defaults', () => {
    const l = computeNavLayout({ ...base, roleDefaults: { pinned: ['results', 'frontdesk'], locked: [] } });
    expect(ids(l.bar)).toEqual(['results', 'frontdesk']);
    expect(l.configured).toBe(true);
  });

  it('personal pins replace the defaults', () => {
    const l = computeNavLayout({ ...base, roleDefaults: { pinned: ['results'], locked: [] }, userPins: ['lab', 'admin'] });
    expect(ids(l.bar)).toEqual(['lab', 'admin']);
  });

  it('an empty personal list is a real choice (nothing pinned), not "never customised"', () => {
    expect(computeNavLayout({ ...base, userPins: [] }).bar).toEqual([]);
  });

  it('locked screens are always on the bar, first, even when the person unpinned them', () => {
    const l = computeNavLayout({
      ...base,
      roleDefaults: { pinned: ['frontdesk', 'validate', 'lab'], locked: ['validate', 'frontdesk'] },
      userPins: ['lab', 'results'],
    });
    expect(ids(l.bar)).toEqual(['frontdesk', 'validate', 'lab', 'results']);
    expect([...l.lockedIds].sort()).toEqual(['frontdesk', 'validate']);
  });

  it('locked screens survive the capacity cut', () => {
    const l = computeNavLayout({
      ...base,
      capacity: 2,
      roleDefaults: { pinned: ['lab'], locked: ['lab'] },
      userPins: ['frontdesk', 'validate', 'results'],
    });
    expect(ids(l.bar)).toEqual(['lab', 'frontdesk']);
    expect(ids(l.pinned)).toEqual(['lab', 'frontdesk', 'validate', 'results']);
  });

  it('pins never grant access: ids the person cannot open are dropped silently', () => {
    const l = computeNavLayout({
      ...base,
      roleDefaults: { pinned: ['payroll-secret', 'lab'], locked: ['payroll-secret'] },
      userPins: ['finance', 'results'],
    });
    expect(ids(l.bar)).toEqual(['results']);
    expect(l.lockedIds.has('payroll-secret')).toBe(false);
    expect(ids([...l.menu.pinned, ...l.menu.work, ...l.menu.more, ...l.menu.settings])).not.toContain('payroll-secret');
  });

  it('truncates to the capacity; the rest stays reachable in the menu', () => {
    const l = computeNavLayout({ ...base, capacity: 2, userPins: ['lab', 'validate', 'results'] });
    expect(ids(l.bar)).toEqual(['lab', 'validate']);
    expect(ids(l.menu.pinned)).toEqual(['lab', 'validate', 'results']);
  });

  it('icons-only capacity lets more of the pins show', () => {
    const pins = ['frontdesk', 'lab', 'validate', 'results', 'expenses', 'admin'];
    expect(computeNavLayout({ ...base, userPins: pins, capacity: navCapacity(390, false) }).bar).toHaveLength(4);
    expect(computeNavLayout({ ...base, userPins: pins, capacity: navCapacity(390, true) }).bar).toHaveLength(6);
  });

  it('a screen that comes and goes (Prepare, OPD) shows at its pinned position when it is available', () => {
    const pins = ['frontdesk', 'prepare', 'lab'];
    const without = computeNavLayout({ ...base, userPins: pins });
    expect(ids(without.bar)).toEqual(['frontdesk', 'lab']);
    const prepare = item('prepare');
    const withIt = computeNavLayout({ ...base, all: [WORK[0], prepare, ...WORK.slice(1), ADMIN], userPins: pins });
    expect(ids(withIt.bar)).toEqual(['frontdesk', 'prepare', 'lab']);
  });

  it('menu groups: pinned, then work, more, settings; each screen once', () => {
    const l = computeNavLayout({ ...base, userPins: ['lab', 'lab-settings'] });
    expect(ids(l.menu.pinned)).toEqual(['lab', 'lab-settings']);
    expect(ids(l.menu.work)).toEqual(['frontdesk', 'validate', 'results', 'expenses']);
    // m-opd (same href as nothing in work here) stays; admin-overview shares /admin with Settings so it is not repeated
    expect(ids(l.menu.more)).toEqual(['m-opd']);
    expect(ids(l.menu.settings)).toEqual(['admin']);
  });

  it('a menu-only screen that points at a screen already in the list is not repeated', () => {
    const l = computeNavLayout({ ...base, all: [...WORK, item('opd', '/opd'), ADMIN] });
    expect(ids(l.menu.more)).toEqual(['lab-settings']);
  });

  it('a menu-only screen can be pinned and then rides the bar', () => {
    const l = computeNavLayout({ ...base, userPins: ['lab-settings', 'lab'] });
    expect(ids(l.bar)).toEqual(['lab-settings', 'lab']);
  });

  it('does not mutate its input', () => {
    const all = [...ALL];
    const pins = ['lab'];
    computeNavLayout({ ...base, all, userPins: pins });
    expect(all).toEqual(ALL);
    expect(pins).toEqual(['lab']);
  });
});

describe('togglePinned / movePinned / normalizeRoleNav', () => {
  it('pins at the end and unpins', () => {
    expect(togglePinned(['a'], 'b', new Set())).toEqual(['a', 'b']);
    expect(togglePinned(['a', 'b'], 'a', new Set())).toEqual(['b']);
  });
  it('a locked screen never unpins', () => {
    expect(togglePinned(['a', 'b'], 'a', new Set(['a']))).toEqual(['a', 'b']);
  });
  it('moves one place and ignores the ends', () => {
    expect(movePinned(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(movePinned(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(movePinned(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(movePinned(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
    expect(movePinned(['a'], 'zz', 1)).toEqual(['a']);
  });
  it('normalizes for the server: valid ids, unique, max 40, locked inside pinned', () => {
    const many = Array.from({ length: 50 }, (_, i) => `id${i}`);
    const n = normalizeRoleNav(['a', 'a', 'bad id!', ...many], ['a', 'ghost', 'id45']);
    expect(n.pinned).toHaveLength(40);
    expect(n.pinned).not.toContain('bad id!');
    expect(n.locked).toEqual(['a']);
    n.locked.forEach(l => expect(n.pinned).toContain(l));
  });
});
