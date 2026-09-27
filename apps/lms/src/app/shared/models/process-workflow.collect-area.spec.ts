import {
  ACTION_POLICY, COLLECT_AREA_ID, COLLECT_AREA_DEFAULT_ROLES, COLLECT_HOME_ACTION_ID,
  COLLECTION_SLOTS, ProcessWorkflowConfig, SYSTEM_AREA_SCREEN, areasWithCollection, collectionLocations,
  collectsAtBillingCounter, isAllowedPlacement, isFixedSlotAction, isLocked, isLockedItem,
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
  it('sample_collection is a fixed-slot action: home Collect (always on) + Frontdesk + Lab', () => {
    expect(ACTION_POLICY['sample_collection']).toEqual({ home: 'collect', locked: true, homeMandatory: true });
    expect(isLocked('sample_collection')).toBe(true);
    expect(isFixedSlotAction('sample_collection')).toBe(true);
    expect(isFixedSlotAction('billing')).toBe(false);
    expect(COLLECTION_SLOTS).toEqual(['collect', 'frontdesk', 'lab']);
  });

  it('every copy is pinned (no drag, no removal) — the three slots are the only placements', () => {
    expect(isLockedItem('sample_collection', 'collect')).toBe(true);
    expect(isLockedItem('sample_collection', 'frontdesk')).toBe(true);
    expect(isLockedItem('sample_collection', 'lab')).toBe(true);
    for (const a of ['collect', 'frontdesk', 'lab']) expect(isAllowedPlacement('sample_collection', a)).toBe(true);
    for (const a of ['billdesk', 'validate', 'results', 'custom-1', null]) expect(isAllowedPlacement('sample_collection', a)).toBe(false);
    expect(isAllowedPlacement('billing', 'billdesk')).toBe(true);
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
    expect(collectionLocations(out).sort()).toEqual(['collect', 'frontdesk', 'lab']);
    // The band Collect goes to the Frontdesk / Lab slots only (Collect IS the page).
    expect(areasWithCollection(out).sort()).toEqual(['frontdesk', 'lab']);
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
    // Home copy + the fixed Frontdesk / Lab copies (added OFF).
    expect(out.actions.filter(a => a.type === 'sample_collection').map(a => [a.categoryId, a.enabled]).sort())
      .toEqual([['collect', true], ['frontdesk', false], ['lab', false]]);
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
    expect(out.actions.find(a => a.type === 'sample_collection' && a.categoryId === 'frontdesk'))
      .toMatchObject({ id: 'collect-frontdesk', enabled: false });
  });

  it('never adopts a system area or a mixed menu', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [cat('frontdesk', 'Frontdesk', 0), cat('bill', 'Billing', 1), cat('lab', 'Lab', 2)],
      actions: [act('a1', 'patient_registration', 'frontdesk'), act('x1', 'billing', 'bill'),
                act('x2', 'sample_collection', 'bill', true, 1), act('l1', 'sample_collection', 'lab')],
    };
    const out = normalizeWorkflow(cfg);
    expect(out.categories.map(c => c.id).sort()).toEqual(['bill', 'collect', 'frontdesk', 'lab']);
    // …and the billing counter's copy is dropped (not a slot).
    expect(out.actions.some(a => a.categoryId === 'bill' && a.type === 'sample_collection')).toBe(false);
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

describe('Fixed slots — normalise (owner\'s final rule, 2026-09-27)', () => {
  const base = (): ProcessWorkflowConfig => ({
    categories: [cat('frontdesk', 'Frontdesk', 0), cat('collect', 'Collect', 1), cat('billdesk', 'Billing counter', 2),
                 cat('lab', 'Lab', 3), cat('validate', 'Validate', 4), cat('x', 'Custom', 5)],
    actions: [
      act('a1', 'patient_registration', 'frontdesk'), act('h', 'sample_collection', 'collect'),
      act('k1', 'billing', 'billdesk'), act('k2', 'sample_collection', 'billdesk', true, 1),
      act('v1', 'validate', 'validate'), act('v2', 'sample_collection', 'validate', true, 1),
      act('x1', 'sample_collection', 'x'), act('b1', 'result_entry', 'lab'),
    ],
  });

  it('drops stray copies (billing counter, Validate, custom) and adds missing Frontdesk / Lab copies DISABLED', () => {
    const out = normalizeWorkflow(base());
    const sc = out.actions.filter(a => a.type === 'sample_collection');
    expect(sc.map(a => [a.categoryId, a.enabled]).sort()).toEqual([['collect', true], ['frontdesk', false], ['lab', false]]);
    expect(sc.find(a => a.categoryId === 'lab')!.id).toBe('collect-lab');
    // Other actions survive untouched.
    expect(out.actions.find(a => a.id === 'k1')).toBeTruthy();
    expect(normalizeWorkflow(out)).toBe(out);
  });

  it('keeps an existing Frontdesk / Lab copy\'s enabled state', () => {
    const cfg = base();
    cfg.actions.push(act('f', 'sample_collection', 'frontdesk', true, 1), act('l', 'sample_collection', 'lab', false, 1));
    const out = normalizeWorkflow(cfg);
    expect(out.actions.find(a => a.id === 'f')!.enabled).toBe(true);
    expect(out.actions.find(a => a.id === 'l')!.enabled).toBe(false);
  });

  it('merges duplicate copies in one slot (on if any was on)', () => {
    const cfg = base();
    cfg.actions.push(act('f1', 'sample_collection', 'frontdesk', false, 1), act('f2', 'sample_collection', 'frontdesk', true, 2));
    const out = normalizeWorkflow(cfg);
    const fd = out.actions.filter(a => a.type === 'sample_collection' && a.categoryId === 'frontdesk');
    expect(fd).toEqual([expect.objectContaining({ id: 'f1', enabled: true })]);
  });

  it('skips a slot whose area the workflow lacks', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [cat('fd-custom', 'Frontdesk', 0), cat('validate', 'Validate', 1)],
      actions: [act('a1', 'patient_registration', 'fd-custom'), act('s', 'sample_collection', 'fd-custom')],
    };
    const out = normalizeWorkflow(cfg);
    expect(out.actions.filter(a => a.type === 'sample_collection').map(a => a.categoryId)).toEqual(['collect']);
  });

  it('the billing-counter collect helper is always false', () => {
    const raw = base();   // even un-normalised, with a copy next to billing
    expect(collectsAtBillingCounter(raw)).toBe(false);
    expect(collectsAtBillingCounter(normalizeWorkflow(raw))).toBe(false);
    expect(collectsAtBillingCounter(null)).toBe(false);
  });

  it('placement helpers ignore copies outside the slots on an un-normalised config', () => {
    const raw = base();
    expect(collectionLocations(raw)).toEqual(['collect']);
    expect(areasWithCollection(raw)).toEqual([]);
  });
});
