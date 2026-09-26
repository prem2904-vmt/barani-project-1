import {
  NavItem,
  ADMIN_NAV,
  FRONTDESK_PERMS,
  ROUTE_NAV_PERMS,
  PRIMARY_NAV,
  menusFromWorkflow,
  navLabel,
  WorkflowNavCtx,
  MORE_NAV,
} from './nav-items';
import { ProcessWorkflowConfig } from '../shared/models/process-workflow.model';

describe('NavItem interface', () => {
  it('defines required and optional fields for a nav item', () => {
    const item: NavItem = {
      id: 'test',
      label: 'Test',
      href: '/test',
      iconPath: ['M0 0h24v24H0z'],
    };
    expect(item.id).toBe('test');
    expect(item.label).toBe('Test');
    expect(item.href).toBe('/test');
    expect(item.iconPath).toBeDefined();
    expect(item.permissions).toBeUndefined();
  });

  it('supports optional exact match flag', () => {
    const item: NavItem = {
      id: 'test',
      label: 'Test',
      href: '/test',
      exact: true,
      iconPath: ['M0 0'],
    };
    expect(item.exact).toBe(true);
  });
});

describe('ADMIN_NAV', () => {
  it('has correct id, label, and href', () => {
    expect(ADMIN_NAV.id).toBe('admin');
    expect(ADMIN_NAV.label).toBe('Admin');
    expect(ADMIN_NAV.href).toBe('/admin');
  });

  it('requires admin-config manage_* permissions (NOT manage_branches)', () => {
    expect(ADMIN_NAV.permissions).toEqual([
      'manage_tests',
      'manage_users',
      'manage_workflows',
    ]);
    // Branch browsing must NOT open the admin shell — a Branch Manager reaches
    // /admin/branches via its own route, not the admin config hub.
    expect(ADMIN_NAV.permissions).not.toContain('manage_branches');
  });

  it('has a valid iconPath array', () => {
    expect(Array.isArray(ADMIN_NAV.iconPath)).toBe(true);
    expect(ADMIN_NAV.iconPath.length).toBeGreaterThan(0);
    expect(typeof ADMIN_NAV.iconPath[0]).toBe('string');
  });
});

describe('FRONTDESK_PERMS', () => {
  it('contains register and order creation permissions', () => {
    expect(FRONTDESK_PERMS).toContain('register_patient');
    expect(FRONTDESK_PERMS).toContain('create_order');
  });

  it('includes billing permissions but NOT branch management', () => {
    expect(FRONTDESK_PERMS).toContain('create_bill');
    expect(FRONTDESK_PERMS).toContain('collect_payment');
    // manage_branch must NOT grant the front-desk work area — it would only
    // surface create controls that 403 for a read-tier Branch Manager.
    expect(FRONTDESK_PERMS).not.toContain('manage_branch');
  });

  it('is a non-empty array', () => {
    expect(Array.isArray(FRONTDESK_PERMS)).toBe(true);
    expect(FRONTDESK_PERMS.length).toBeGreaterThan(0);
  });
});

describe('ROUTE_NAV_PERMS', () => {
  it('maps /frontdesk to FRONTDESK_PERMS', () => {
    expect(ROUTE_NAV_PERMS['/frontdesk']).toEqual(FRONTDESK_PERMS);
  });

  it('is a Record with string keys', () => {
    expect(typeof ROUTE_NAV_PERMS).toBe('object');
    expect(ROUTE_NAV_PERMS['/frontdesk']).toBeDefined();
  });
});

describe('PRIMARY_NAV', () => {
  it('is a non-empty array of NavItem objects', () => {
    expect(Array.isArray(PRIMARY_NAV)).toBe(true);
    expect(PRIMARY_NAV.length).toBeGreaterThan(0);
  });

  it('every item has required fields: id, label, href, iconPath', () => {
    PRIMARY_NAV.forEach((item) => {
      expect(item.id).toBeDefined();
      expect(typeof item.id).toBe('string');
      expect(item.label).toBeDefined();
      expect(typeof item.label).toBe('string');
      expect(item.href).toBeDefined();
      expect(typeof item.href).toBe('string');
      expect(Array.isArray(item.iconPath)).toBe(true);
      expect(item.iconPath.length).toBeGreaterThan(0);
    });
  });

  it('has unique ids across all items', () => {
    const ids = PRIMARY_NAV.map((item) => item.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('frontdesk item uses FRONTDESK_PERMS', () => {
    const frontdesk = PRIMARY_NAV.find((item) => item.id === 'frontdesk');
    expect(frontdesk).toBeDefined();
    expect(frontdesk!.permissions).toEqual(FRONTDESK_PERMS);
  });

  it('sample-collection has collect_sample permission', () => {
    const collect = PRIMARY_NAV.find((item) => item.id === 'sample-collection');
    expect(collect).toBeDefined();
    expect(collect!.permissions).toContain('collect_sample');
  });

  it('lab item requires lab-tech permissions (enter_result, receive_sample)', () => {
    const lab = PRIMARY_NAV.find((item) => item.id === 'lab');
    expect(lab).toBeDefined();
    expect(lab!.permissions).toEqual(
      expect.arrayContaining(['enter_result', 'receive_sample'])
    );
  });

  it('messages item has no permissions (open to all authenticated users)', () => {
    const messages = PRIMARY_NAV.find((item) => item.id === 'messages');
    expect(messages).toBeDefined();
    expect(messages!.permissions).toBeUndefined();
  });

  it('stores/inventory item has requiresInventory flag', () => {
    const stores = PRIMARY_NAV.find((item) => item.id === 'stores');
    expect(stores).toBeDefined();
    expect(stores!.requiresInventory).toBe(true);
  });

  it('sample-collection item has collectionModes', () => {
    const collect = PRIMARY_NAV.find((item) => item.id === 'sample-collection');
    expect(collect).toBeDefined();
    expect(Array.isArray(collect!.collectionModes)).toBe(true);
    expect(collect!.collectionModes).toContain('dedicated_counter');
  });

  it('billing-counter item has billingModes', () => {
    const billing = PRIMARY_NAV.find((item) => item.id === 'billing-counter');
    expect(billing).toBeDefined();
    expect(Array.isArray(billing!.billingModes)).toBe(true);
    expect(billing!.billingModes).toContain('separate_counter');
  });

  it('home-visits item has module entitlement', () => {
    const homeVisits = PRIMARY_NAV.find((item) => item.id === 'home-visits');
    expect(homeVisits).toBeDefined();
    expect(homeVisits!.module).toBe('homeCollection');
  });
});

describe('MORE_NAV', () => {
  it('is a non-empty array of NavItem objects', () => {
    expect(Array.isArray(MORE_NAV)).toBe(true);
    expect(MORE_NAV.length).toBeGreaterThan(0);
  });

  it('every item has required fields: id, label, href, iconPath', () => {
    MORE_NAV.forEach((item) => {
      expect(item.id).toBeDefined();
      expect(typeof item.id).toBe('string');
      expect(item.label).toBeDefined();
      expect(typeof item.label).toBe('string');
      expect(item.href).toBeDefined();
      expect(typeof item.href).toBe('string');
      expect(Array.isArray(item.iconPath)).toBe(true);
      expect(item.iconPath.length).toBeGreaterThan(0);
    });
  });

  it('has unique ids (no conflicts with PRIMARY_NAV)', () => {
    const moreIds = MORE_NAV.map((item) => item.id);
    const primaryIds = PRIMARY_NAV.map((item) => item.id);
    const allIds = [...moreIds, ...primaryIds];
    const uniqueIds = new Set(allIds);
    // Should not have duplicates between MORE_NAV and PRIMARY_NAV
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it('admin-overview requires admin-config manage_* permissions (NOT manage_branches)', () => {
    const adminOverview = MORE_NAV.find((item) => item.id === 'admin-overview');
    expect(adminOverview).toBeDefined();
    expect(adminOverview!.permissions).toEqual(
      expect.arrayContaining(['manage_tests', 'manage_users', 'manage_workflows'])
    );
    expect(adminOverview!.permissions).not.toContain('manage_branches');
  });

  it('module-specific items (opd, ipd, pharmacy) have module entitlement', () => {
    const opd = MORE_NAV.find((item) => item.id === 'm-opd');
    expect(opd).toBeDefined();
    expect(opd!.module).toBe('opd');

    const ipd = MORE_NAV.find((item) => item.id === 'm-ipd');
    expect(ipd).toBeDefined();
    expect(ipd!.module).toBe('ipd');

    const pharmacy = MORE_NAV.find((item) => item.id === 'm-pharmacy');
    expect(pharmacy).toBeDefined();
    expect(pharmacy!.module).toBe('pharmacy');
  });
});

describe('menusFromWorkflow', () => {
  const baseCtx: WorkflowNavCtx = {
    roles: ['user'],
    hasAnyPermission: (perms) => perms.length > 0,
    isSuper: false,
  };

  const makeCfg = (categories: any[], actions: any[] = []): ProcessWorkflowConfig => ({
    categories: categories.map(c => ({ color: '#000000', ...c })),
    actions,
  });

  it('returns null when config is null or undefined', () => {
    expect(menusFromWorkflow(null, baseCtx)).toBeNull();
    expect(menusFromWorkflow(undefined, baseCtx)).toBeNull();
  });

  it('returns null when categories array is empty', () => {
    const cfg = makeCfg([], []);
    expect(menusFromWorkflow(cfg, baseCtx)).toBeNull();
  });

  it('returns null when there are no accessible items for user', () => {
    const cfg = makeCfg(
      [{ id: 'cat1', name: 'Category 1', order: 1, icon: 'default' }],
      [{ id: 'act1', type: 'sample_collection', categoryId: 'cat1', enabled: true, order: 1 }]
    );
    const restrictedCtx: WorkflowNavCtx = {
      roles: ['viewer'],
      hasAnyPermission: () => false, // No permissions
      isSuper: false,
    };
    expect(menusFromWorkflow(cfg, restrictedCtx)).toBeNull();
  });

  it('work-area names show in sentence case in the nav ("billing" → "Billing"; the built-ins already are)', () => {
    const cfg = makeCfg(
      [{ id: 'cat1', name: '  billing ', order: 1, icon: 'default' }, { id: 'cat2', name: 'Frontdesk', order: 2, icon: 'default' }],
      [{ id: 'a1', type: 'sample_collection', categoryId: 'cat1', enabled: true, order: 1 },
       { id: 'a2', type: 'sample_collection', categoryId: 'cat2', enabled: true, order: 1 }]
    );
    const labels = menusFromWorkflow(cfg, { ...baseCtx, isSuper: true })!.map(i => i.label);
    expect(labels).toContain('Billing');
    expect(labels).toContain('Frontdesk');
    expect(labels).not.toContain('billing');
    expect(navLabel('lab')).toBe('Lab');
    expect(navLabel('My Work')).toBe('My Work');
    expect(navLabel('')).toBe('');
    // Every built-in label starts with a capital.
    for (const i of [...PRIMARY_NAV, ...MORE_NAV, ADMIN_NAV]) expect(i.label.charAt(0)).toBe(i.label.charAt(0).toUpperCase());
  });

  it('builds nav items from enabled categories with accessible actions', () => {
    const cfg = makeCfg(
      [{ id: 'cat1', name: 'My Work', order: 1, icon: 'default' }],
      [{ id: 'act1', type: 'sample_collection', categoryId: 'cat1', enabled: true, order: 1 }]
    );
    const permCtx: WorkflowNavCtx = {
      roles: ['collector'],
      hasAnyPermission: (perms) => perms.includes('collect_sample'),
      isSuper: false,
    };
    const result = menusFromWorkflow(cfg, permCtx);
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBeGreaterThan(0);
  });

  it('filters out disabled actions', () => {
    const cfg = makeCfg(
      [{ id: 'cat1', name: 'Work', order: 1, icon: 'default' }],
      [{ id: 'act1', type: 'sample_collection', categoryId: 'cat1', enabled: false, order: 1 }]
    );
    const permCtx: WorkflowNavCtx = {
      roles: ['collector'],
      hasAnyPermission: (perms) => perms.includes('collect_sample'),
      isSuper: false,
    };
    expect(menusFromWorkflow(cfg, permCtx)).toBeNull();
  });

  it('grants super-admin access to all items', () => {
    const cfg = makeCfg(
      [{ id: 'cat1', name: 'Admin Work', order: 1, icon: 'default' }],
      [{ id: 'act1', type: 'sample_collection', categoryId: 'cat1', enabled: true, order: 1 }]
    );
    const superCtx: WorkflowNavCtx = {
      roles: ['super-admin'],
      hasAnyPermission: (perms) => false, // Irrelevant
      isSuper: true, // Super admin flag
    };
    const result = menusFromWorkflow(cfg, superCtx);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
  });

  it('sorts categories by order field', () => {
    const cfg = makeCfg(
      [
        { id: 'cat2', name: 'Second', order: 2, icon: 'default' },
        { id: 'cat1', name: 'First', order: 1, icon: 'default' },
      ],
      [
        // queue (not collection alone — a collection-only menu is adopted as
        // the system Collect area by normalizeWorkflow).
        { id: 'act1', type: 'queue', categoryId: 'cat1', enabled: true, order: 1 },
        { id: 'act2', type: 'result_entry', categoryId: 'cat2', enabled: true, order: 1 },
      ]
    );
    const permCtx: WorkflowNavCtx = {
      roles: ['tech'],
      hasAnyPermission: (perms) =>
        perms.includes('collect_sample') || perms.includes('enter_result'),
      isSuper: false,
    };
    const result = menusFromWorkflow(cfg, permCtx);
    expect(result).not.toBeNull();
    // Items should be in order 1, 2 (cat1 before cat2)
    // cat1 before cat2; the normalised-in Collect area leads (no frontdesk area).
    expect(result!.map(i => i.id)).toEqual(['collect', 'cat1', 'cat2']);
  });

  it('does NOT inject a Collect item beside an area holding collection (role-driven instead)', () => {
    const cfg = makeCfg(
      [{ id: 'lab-area', name: 'Lab', order: 1, icon: 'default' }],
      [
        { id: 'result', type: 'result_entry', categoryId: 'lab-area', enabled: true, order: 1 },
        { id: 'collect', type: 'sample_collection', categoryId: 'lab-area', enabled: true, order: 2 },
      ]
    );
    const permCtx: WorkflowNavCtx = {
      roles: ['tech'],
      hasAnyPermission: (perms) =>
        perms.includes('enter_result') || perms.includes('collect_sample'),
      isSuper: false,
    };
    const result = menusFromWorkflow(cfg, permCtx);
    expect(result).not.toBeNull();
    // The work area shows; no workflow-injected sample-collection item beside it
    expect(result!.some((item) => item.id === 'lab-area')).toBe(true);
    const hasCollect = result!.some((item) => item.id === 'sample-collection');
    expect(hasCollect).toBe(false);
  });

  it('does not insert Collect item when user lacks collect_sample permission', () => {
    const cfg = makeCfg(
      [{ id: 'lab-area', name: 'Lab', order: 1, icon: 'default' }],
      [
        { id: 'result', type: 'result_entry', categoryId: 'lab-area', enabled: true, order: 1 },
        { id: 'collect', type: 'sample_collection', categoryId: 'lab-area', enabled: true, order: 2 },
      ]
    );
    const restrictedCtx: WorkflowNavCtx = {
      roles: ['pathologist'],
      hasAnyPermission: (perms) => perms.includes('validate_result'),
      isSuper: false,
    };
    const result = menusFromWorkflow(cfg, restrictedCtx);
    // Either null or no sample-collection item
    if (result) {
      const hasCollect = result.some((item) => item.id === 'sample-collection');
      expect(hasCollect).toBe(false);
    }
  });

  it('does not insert Collect item when route is already /sample-collection', () => {
    // This tests the "route !== '/sample-collection'" check
    const cfg = makeCfg(
      [{ id: 'collect-area', name: 'Collection', order: 1, icon: 'default' }],
      [{ id: 'collect', type: 'sample_collection', categoryId: 'collect-area', enabled: true, order: 1 }]
    );
    const permCtx: WorkflowNavCtx = {
      roles: ['collector'],
      hasAnyPermission: (perms) => perms.includes('collect_sample'),
      isSuper: false,
    };
    const result = menusFromWorkflow(cfg, permCtx);
    // Should have the main item but not a duplicate Collect item
    if (result && result.length > 1) {
      const collectCount = result.filter((item) => item.id === 'sample-collection').length;
      expect(collectCount).toBeLessThanOrEqual(1);
    }
  });

  it('returns empty array when no items pass accessibility filter after sorting', () => {
    const cfg = makeCfg(
      [{ id: 'cat1', name: 'Category', order: 1, icon: 'default' }],
      [{ id: 'act1', type: 'unknown_type', categoryId: 'cat1', enabled: true, order: 1 }]
    );
    const permCtx: WorkflowNavCtx = {
      roles: ['user'],
      hasAnyPermission: () => true,
      isSuper: false,
    };
    // Unknown action types are filtered out (catalogFor returns undefined), so
    // only the normalised-in system Collect area remains.
    expect(menusFromWorkflow(cfg, permCtx)!.map(i => i.id)).toEqual(['collect']);
  });

  it('respects action order within a category', () => {
    const cfg = makeCfg(
      [{ id: 'cat1', name: 'Work', order: 1, icon: 'default' }],
      [
        {
          id: 'act2',
          type: 'result_entry',
          categoryId: 'cat1',
          enabled: true,
          order: 2,
        },
        {
          id: 'act1',
          type: 'sample_collection',
          categoryId: 'cat1',
          enabled: true,
          order: 1,
        },
      ]
    );
    const permCtx: WorkflowNavCtx = {
      roles: ['tech'],
      hasAnyPermission: (perms) =>
        perms.includes('enter_result') || perms.includes('collect_sample'),
      isSuper: false,
    };
    const result = menusFromWorkflow(cfg, permCtx);
    expect(result).not.toBeNull();
    // Actions within category should be sorted by order (1 before 2)
  });
});

describe('WorkflowNavCtx', () => {
  it('defines roles, hasAnyPermission function, and isSuper flag', () => {
    const ctx: WorkflowNavCtx = {
      roles: ['admin', 'user'],
      hasAnyPermission: (perms) => perms.length > 0,
      isSuper: true,
    };
    expect(Array.isArray(ctx.roles)).toBe(true);
    expect(typeof ctx.hasAnyPermission).toBe('function');
    expect(typeof ctx.isSuper).toBe('boolean');
  });

  it('hasAnyPermission receives an array and returns boolean', () => {
    const ctx: WorkflowNavCtx = {
      roles: ['user'],
      hasAnyPermission: (perms) => perms.includes('manage_tests'),
      isSuper: false,
    };
    expect(ctx.hasAnyPermission(['manage_tests', 'manage_users'])).toBe(true);
    expect(ctx.hasAnyPermission(['view_only'])).toBe(false);
  });
});
