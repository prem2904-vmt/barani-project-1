import {
  ACTION_POLICY, COLLECT_AREA_ID, COLLECT_AREA_DEFAULT_ROLES, COLLECT_HOME_ACTION_ID,
  ProcessWorkflowConfig, SYSTEM_AREA_SCREEN, areasWithCollection, isLocked, isLockedItem, isRepeatable,
  isMandatoryItem, normalizeWorkflow, workAreaRoute,
} from './process-workflow.model';

/** The system Collect work area + the shared normaliser (owner, 2026-09-26). */
const cat = (id: string, name: string, order: number, extra: Record<string, unknown> = {}) =>
  ({ id, name, icon: 'folder', color: '#7c3aed', order, ...extra });
const act = (id: string, type: string, categoryId: string, enabled = true, order = 0) =>
  ({ id, type, categoryId, enabled, order });

/** The owner's "Without Collection Center": collection copies in Frontdesk + Lab. */
const withoutCC = (): ProcessWorkflowConfig => ({
  categories: [cat('frontdesk', 'Frontdesk', 0), cat('lab', 'Lab', 1), cat('validate', 'Validate', 2),
               cat('results', 'Results', 3), cat('messages', 'Messages', 4)],
  actions: [
    act('a1', 'patient_registration', 'frontdesk'), act('a2', 'sample_collection', 'frontdesk', true, 1),
    act('a3', 'dispatch', 'frontdesk', true, 2), act('b1', 'lab_intake', 'lab'),
    act('b2', 'sample_collection', 'lab', true, 1), act('b3', 'result_entry', 'lab', true, 2),
    act('c1', 'validate', 'validate'), act('d1', 'results', 'results'), act('e1', 'messages', 'messages'),
  ],
});

/** "With CC": a dedicated Collection Center menu whose only action is collection. */
const withCC = (ccEnabled = true): ProcessWorkflowConfig => ({
  categories: [cat('frontdesk', 'Frontdesk', 0), cat('cc-123', 'Collection Center', 1, { icon: 'droplet', roles: ['Sample Collector'] }),
               cat('lab', 'Lab', 2)],
  actions: [act('a1', 'patient_registration', 'frontdesk'), act('cc1', 'sample_collection', 'cc-123', ccEnabled),
            act('b1', 'result_entry', 'lab')],
});

describe('Collect work area — policy', () => {
  it('sample_collection is locked to the Collect area, home copy always on, still repeatable', () => {
    expect(ACTION_POLICY['sample_collection']).toEqual({ home: 'collect', locked: true, homeMandatory: true });
    expect(isLocked('sample_collection')).toBe(true);
    expect(isRepeatable('sample_collection')).toBe(true);
  });

  it('only the home copy is pinned; copies elsewhere are free', () => {
    expect(isLockedItem('sample_collection', 'collect')).toBe(true);
    expect(isLockedItem('sample_collection', 'frontdesk')).toBe(false);
    expect(isLockedItem('sample_collection', 'lab')).toBe(false);
    expect(isLockedItem('sample_collection', 'custom-1')).toBe(false);
    // Non-repeatable locked actions stay pinned wherever they sit.
    expect(isLockedItem('result_entry', 'lab')).toBe(true);
    expect(isLockedItem('billing', 'frontdesk')).toBe(false);
  });

  it('the Collect area opens the Collect page', () => {
    expect(SYSTEM_AREA_SCREEN['collect']).toBe('/sample-collection');
    const cfg = normalizeWorkflow(withoutCC());
    expect(workAreaRoute(cfg.categories.find(c => c.id === 'collect')!, cfg)).toBe('/sample-collection');
  });
});

describe('normalizeWorkflow', () => {
  it('adds Collect exactly once, right after Frontdesk, enabled, with default roles + tube icon', () => {
    const out = normalizeWorkflow(withoutCC());
    const sorted = [...out.categories].sort((a, b) => a.order - b.order);
    expect(sorted.map(c => c.id)).toEqual(['frontdesk', 'collect', 'lab', 'validate', 'results', 'messages']);
    expect(sorted.map(c => c.order)).toEqual([0, 1, 2, 3, 4, 5]);
    const collect = sorted[1];
    expect(collect.name).toBe('Collect');
    expect(collect.icon).toBe('tube');
    expect(collect.roles).toEqual(COLLECT_AREA_DEFAULT_ROLES);
    const home = out.actions.filter(a => a.categoryId === COLLECT_AREA_ID);
    expect(home).toEqual([expect.objectContaining({ id: COLLECT_HOME_ACTION_ID, type: 'sample_collection', enabled: true })]);
    // Existing copies in Frontdesk + Lab are untouched.
    expect(out.actions.filter(a => a.type === 'sample_collection').map(a => a.categoryId).sort())
      .toEqual(['collect', 'frontdesk', 'lab']);
    expect(areasWithCollection(out).sort()).toEqual(['collect', 'frontdesk', 'lab']);
  });

  it('is idempotent (second pass returns the same object)', () => {
    const once = normalizeWorkflow(withoutCC());
    const twice = normalizeWorkflow(once);
    expect(twice).toBe(once);
    expect(twice.categories.filter(c => c.id === 'collect').length).toBe(1);
    expect(twice.actions.filter(a => a.categoryId === 'collect').length).toBe(1);
  });

  it('adopts a dedicated collection menu as the Collect area instead of adding a duplicate', () => {
    const out = normalizeWorkflow(withCC());
    expect(out.categories.length).toBe(3);
    const collect = out.categories.find(c => c.id === 'collect')!;
    expect(collect).toEqual(expect.objectContaining({ name: 'Collection Center', icon: 'droplet', order: 1, roles: ['Sample Collector'] }));
    expect(out.categories.some(c => c.id === 'cc-123')).toBe(false);
    expect(out.actions.find(a => a.id === 'cc1')!.categoryId).toBe('collect');
    expect(out.actions.filter(a => a.type === 'sample_collection').length).toBe(1);
    expect(normalizeWorkflow(out)).toBe(out);
  });

  it('an adopted menu\'s collection comes in ON (the home copy is always on)', () => {
    const out = normalizeWorkflow(withCC(false));
    expect(out.actions.find(a => a.categoryId === 'collect')!.enabled).toBe(true);
  });

  it('re-adds only the home copy when the Collect area exists without one', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [cat('frontdesk', 'Frontdesk', 0), cat('collect', 'Collect', 1)],
      actions: [act('a1', 'patient_registration', 'frontdesk')],
    };
    const out = normalizeWorkflow(cfg);
    expect(out.categories.length).toBe(2);
    expect(out.actions.filter(a => a.categoryId === 'collect').map(a => a.type)).toEqual(['sample_collection']);
  });

  it('never adopts a system area or a mixed menu', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [cat('frontdesk', 'Frontdesk', 0), cat('bill', 'Billing', 1), cat('lab', 'Lab', 2)],
      actions: [act('a1', 'patient_registration', 'frontdesk'), act('x1', 'billing', 'bill'),
                act('x2', 'sample_collection', 'bill', true, 1), act('l1', 'sample_collection', 'lab')],
    };
    const out = normalizeWorkflow(cfg);
    expect(out.categories.map(c => c.id).sort()).toEqual(['bill', 'collect', 'frontdesk', 'lab']);
  });

  it('leaves missing / empty configs alone (no workflow ⇒ fallback nav)', () => {
    expect(normalizeWorkflow(null)).toBeNull();
    expect(normalizeWorkflow(undefined)).toBeUndefined();
    const empty = { categories: [], actions: [] };
    expect(normalizeWorkflow(empty)).toBe(empty);
  });

  it('with no frontdesk area, Collect goes first', () => {
    const cfg: ProcessWorkflowConfig = { categories: [cat('lab', 'Lab', 0)], actions: [act('b1', 'result_entry', 'lab')] };
    const out = normalizeWorkflow(cfg);
    expect([...out.categories].sort((a, b) => a.order - b.order).map(c => c.id)).toEqual(['collect', 'lab']);
  });
});

describe('Collect home copy is always on (owner: only roles change)', () => {
  it('isMandatoryItem pins only the home copy', () => {
    expect(isMandatoryItem('sample_collection', 'collect')).toBe(true);
    expect(isMandatoryItem('sample_collection', 'frontdesk')).toBe(false);
    expect(isMandatoryItem('sample_collection', 'lab')).toBe(false);
    expect(isMandatoryItem('patient_registration', 'frontdesk')).toBe(true);
  });

  it('normaliser switches a saved-off home copy back on, leaves other copies alone', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [cat('frontdesk', 'Frontdesk', 0), cat('collect', 'Collect', 1), cat('lab', 'Lab', 2)],
      actions: [
        act('h', 'sample_collection', 'collect', false),
        act('l', 'sample_collection', 'lab', false),
      ],
    };
    const out = normalizeWorkflow(cfg);
    expect(out.actions.find(a => a.id === 'h')!.enabled).toBe(true);
    expect(out.actions.find(a => a.id === 'l')!.enabled).toBe(false);
    expect(normalizeWorkflow(out)).toBe(out);
  });

  it('an adopted dedicated menu comes in enabled', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [cat('frontdesk', 'Frontdesk', 0), cat('cc', 'Collection Center', 1)],
      actions: [act('c', 'sample_collection', 'cc', false)],
    };
    const out = normalizeWorkflow(cfg);
    expect(out.actions.find(a => a.id === 'c')).toMatchObject({ categoryId: 'collect', enabled: true });
  });
});
