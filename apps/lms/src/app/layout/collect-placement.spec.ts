import { menusFromWorkflow, withLegacyCollect, PRIMARY_NAV, NavItem, WorkflowNavCtx } from './nav-items';
import {
  ProcessWorkflowConfig,
  collectionPlacement,
  collectActionSurfaces,
  collectsAtBillingCounter,
  collectsAtFrontdesk,
  collectsInLab,
  hasCollectionNavPage,
} from '../shared/models/process-workflow.model';
import { listBackTarget } from '../features/lab/sample-collection/collect-back';

/**
 * Owner rule (2026-09-26): the Process builder decides where sample collection
 * lives. Placed INSIDE a work area → that area gets a "Collect sample" action
 * and there is NO Collect nav item. Only a separate collection work area is a
 * nav page. Not in the workflow → nowhere. No workflow → legacy behaviour.
 */

const cat = (id: string, name: string, order: number) => ({ id, name, order, icon: 'folder', color: '#000' });
let seq = 0;
const act = (type: string, categoryId: string, order = 0, enabled = true) =>
  ({ id: `${type}-${categoryId}-${seq++}`, type, categoryId, order, enabled });

/** A full-access front-desk + lab + collector user (super-admin semantics). */
const superCtx: WorkflowNavCtx = { roles: ['Lab Admin'], hasAnyPermission: () => true, isSuper: true };
/** A pure Sample Collector (collect_sample only). */
const collectorCtx: WorkflowNavCtx = {
  roles: ['Sample Collector'], isSuper: false,
  hasAnyPermission: (p) => p.includes('collect_sample'),
};

const baseAreas = [
  cat('frontdesk', 'Frontdesk', 0), cat('lab', 'Lab', 1),
  cat('validate', 'Validate', 2), cat('results', 'Results', 3),
];
const baseActions = [
  act('patient_registration', 'frontdesk', 0), act('walk_in_order', 'frontdesk', 1),
  act('billing', 'frontdesk', 2), act('queue', 'frontdesk', 5),
  act('result_entry', 'lab', 1), act('validate', 'validate'), act('results', 'results'),
];
const wf = (extraCats: ReturnType<typeof cat>[], extraActions: ReturnType<typeof act>[], actions = baseActions): ProcessWorkflowConfig =>
  ({ categories: [...baseAreas, ...extraCats], actions: [...actions, ...extraActions] });

const labels = (items: NavItem[] | null) => (items ?? []).map(i => i.label);
const hasCollectNav = (items: NavItem[] | null) =>
  (items ?? []).some(i => i.id === 'sample-collection' || i.href === '/sample-collection' || i.label === 'Collect');

describe('Collect placement → nav + integrated Collect sample action', () => {
  it("owner's live Micro World flow (collection in Frontdesk AND Lab): no Collect nav item", () => {
    // Dev DB, tenant Micro World, active "Without Collection Center" (v87):
    // sample_collection sits in `frontdesk` and in `lab`, no own work area.
    const cfg: ProcessWorkflowConfig = {
      categories: [...baseAreas, cat('msg', 'Messages', 4)],
      actions: [
        ...baseActions, act('appointment', 'frontdesk'), act('sample_collection', 'frontdesk', 4),
        act('dispatch', 'frontdesk', 6, false), act('lab_intake', 'lab', 0, false),
        act('sample_collection', 'lab', 2), act('messages', 'msg'),
      ],
    };
    const nav = menusFromWorkflow(cfg, superCtx);
    expect(labels(nav)).toEqual(['Frontdesk', 'Lab', 'Validate', 'Results', 'Messages']);
    expect(hasCollectNav(nav)).toBe(false);
    expect(collectActionSurfaces(cfg)).toEqual(['frontdesk-worklist', 'order-payments', 'lab-my-work']);
    expect(hasCollectionNavPage(cfg)).toBe(false);
  });

  it('front desk: Collect sample on the work list + after payment; no nav item', () => {
    const cfg = wf([], [act('sample_collection', 'frontdesk', 3)]);
    expect(hasCollectNav(menusFromWorkflow(cfg, superCtx))).toBe(false);
    expect(collectsAtFrontdesk(cfg)).toBe(true);
    expect(collectsInLab(cfg)).toBe(false);
    expect(collectActionSurfaces(cfg)).toEqual(['frontdesk-worklist', 'order-payments']);
  });

  it('lab: Collect sample in Lab My Work; no nav item', () => {
    const cfg = wf([], [act('sample_collection', 'lab', 0)]);
    const nav = menusFromWorkflow(cfg, superCtx);
    expect(labels(nav)).toEqual(['Frontdesk', 'Lab', 'Validate', 'Results']);
    expect(hasCollectNav(nav)).toBe(false);
    expect(collectsInLab(cfg)).toBe(true);
    expect(collectActionSurfaces(cfg)).toEqual(['lab-my-work']);
  });

  it('billing counter: Collect sample after payment there; nav shows Billing, not Collect', () => {
    const actions = baseActions.filter(a => a.type !== 'billing');
    const cfg = wf([cat('bc', 'Billing', 1)], [act('billing', 'bc', 0), act('sample_collection', 'bc', 1)], actions);
    const nav = menusFromWorkflow(cfg, superCtx);
    expect(labels(nav)).toContain('Billing');
    expect(hasCollectNav(nav)).toBe(false);
    expect(collectsAtBillingCounter(cfg)).toBe(true);
    expect(collectActionSurfaces(cfg)).toEqual(['billing-after-payment']);
  });

  it('custom menu hosting collection among other actions: launcher on /w/:id; no nav item', () => {
    const cfg = wf([cat('desk2', 'Reception 2', 1)], [act('queue', 'desk2', 0), act('sample_collection', 'desk2', 1)]);
    const nav = menusFromWorkflow(cfg, superCtx);
    expect(nav!.find(i => i.id === 'desk2')!.href).toBe('/w/desk2');
    expect(hasCollectNav(nav)).toBe(false);
    expect(collectActionSurfaces(cfg)).toEqual(['/w/desk2']);
  });

  it('SEPARATE collection work area (only action): its own nav page → /sample-collection', () => {
    const cfg = wf([cat('cc', 'Collection Center', 1)], [act('sample_collection', 'cc', 0)]);
    const nav = menusFromWorkflow(cfg, superCtx);
    const cc = nav!.find(i => i.id === 'cc')!;
    expect(cc.label).toBe('Collection Center');
    expect(cc.href).toBe('/sample-collection');
    // Exactly one collection entry — no injected duplicate.
    expect(nav!.filter(i => i.href === '/sample-collection' || i.id === 'sample-collection').length).toBe(1);
    expect(hasCollectionNavPage(cfg)).toBe(true);
    expect(collectActionSurfaces(cfg)).toEqual(['counter:cc']);
  });

  it('separate collection work area where collection is PRIMARY (+ helpers) is still its own page', () => {
    const cfg = wf([cat('cc', 'Collection', 1)], [act('sample_collection', 'cc', 0), act('dispatch', 'cc', 1)]);
    const p = collectionPlacement(cfg)!;
    expect(p.dedicatedMenus).toEqual(['cc']);
    expect(labels(menusFromWorkflow(cfg, superCtx))).toContain('Collection');
  });

  it('not in the workflow: no Collect action anywhere and no nav item', () => {
    const cfg = wf([], []);
    expect(hasCollectNav(menusFromWorkflow(cfg, superCtx))).toBe(false);
    expect(collectActionSurfaces(cfg)).toEqual([]);
    expect(collectsAtFrontdesk(cfg) || collectsInLab(cfg) || collectsAtBillingCounter(cfg)).toBe(false);
  });

  it('a pure Sample Collector is not handed a Collect nav item for an integrated placement', () => {
    const cfg = wf([], [act('sample_collection', 'frontdesk', 3)]);
    expect(hasCollectNav(menusFromWorkflow(cfg, collectorCtx))).toBe(false);
  });

  describe('shell fallback (top strip, bottom nav, More)', () => {
    const collect = PRIMARY_NAV.find(i => i.id === 'sample-collection')!;
    it('workflow active → never appends Collect, whatever the permissions', () => {
      const items = menusFromWorkflow(wf([], [act('sample_collection', 'lab', 0)]), superCtx)!;
      expect(withLegacyCollect(items, { fromWorkflow: true, canCollect: true, collectionEnabled: true })).toBe(items);
    });
    it('no workflow (legacy) → keeps the old guaranteed Collect entry', () => {
      const legacy = PRIMARY_NAV.filter(i => i.id === 'lab');
      const out = withLegacyCollect(legacy, { fromWorkflow: false, canCollect: true, collectionEnabled: true });
      expect(out).toContain(collect);
      expect(withLegacyCollect(legacy, { fromWorkflow: false, canCollect: false, collectionEnabled: true })).toBe(legacy);
    });
    it('legacy is idempotent when a collection surface is already visible', () => {
      const legacy = [collect];
      expect(withLegacyCollect(legacy, { fromWorkflow: false, canCollect: true, collectionEnabled: true })).toBe(legacy);
    });
  });

  it('no workflow configured → placement is null (callers keep legacy)', () => {
    expect(collectionPlacement(null)).toBeNull();
    expect(collectActionSurfaces(undefined)).toBeNull();
    expect(menusFromWorkflow(null, superCtx)).toBeNull();
  });
});

describe('collect page back target (listBackTarget)', () => {
  it('returns to the work area that opened it', () => {
    expect(listBackTarget('/lab/collect', '/lab/my-work')).toBe('/lab/my-work');
    expect(listBackTarget('/lab/collect', '/w/desk2')).toBe('/w/desk2');
  });
  it('a direct /lab/collect falls back to the Lab', () => {
    expect(listBackTarget('/lab/collect', null)).toBe('/lab/my-work');
  });
  it('the dedicated /sample-collection page is a root (no back); unsafe `from` is ignored', () => {
    expect(listBackTarget('/sample-collection', null)).toBeNull();
    expect(listBackTarget('/sample-collection', '//evil.example')).toBeNull();
  });
});
