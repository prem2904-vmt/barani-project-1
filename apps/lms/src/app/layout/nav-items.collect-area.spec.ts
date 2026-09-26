import { NavItem, PRIMARY_NAV, WorkflowNavCtx, menusFromWorkflow, withCollectionFallback } from './nav-items';
import { ProcessWorkflowConfig } from '../shared/models/process-workflow.model';

/** Collect page = the system Collect WORK AREA when a workflow is active. */
const cat = (id: string, name: string, order: number) => ({ id, name, icon: 'folder', color: '#7c3aed', order });
const act = (id: string, type: string, categoryId: string, enabled = true, order = 0) =>
  ({ id, type, categoryId, enabled, order });

/** The owner's active "Without Collection Center" (pre-Collect-area, as stored). */
const stored = (): ProcessWorkflowConfig => ({
  categories: [cat('frontdesk', 'Frontdesk', 0), cat('lab', 'Lab', 1), cat('validate', 'Validate', 2),
               cat('results', 'Results', 3)],
  actions: [
    act('a1', 'patient_registration', 'frontdesk'), act('a2', 'sample_collection', 'frontdesk', true, 1),
    act('b1', 'lab_intake', 'lab'), act('b2', 'sample_collection', 'lab', true, 1), act('b3', 'result_entry', 'lab', true, 2),
    act('c1', 'validate', 'validate'), act('d1', 'results', 'results'),
  ],
});

const ctxWith = (...perms: string[]): WorkflowNavCtx =>
  ({ roles: [], hasAnyPermission: p => p.some(x => perms.includes(x)), isSuper: false });

const collectItems = (items: NavItem[] | null) =>
  (items ?? []).filter(i => i.href === '/sample-collection' || /collect/i.test(i.label));

describe('menusFromWorkflow — system Collect work area', () => {
  it('shows Collect (from the workflow, right after Frontdesk) for a collect_sample holder, once', () => {
    const items = menusFromWorkflow(stored(), ctxWith('register_patient', 'collect_sample', 'enter_result'))!;
    expect(items.map(i => i.id)).toEqual(['frontdesk', 'collect', 'lab']);
    const collect = items[1];
    expect(collect).toEqual(expect.objectContaining({ label: 'Collect', href: '/sample-collection', permissions: ['collect_sample'] }));
    expect(collectItems(items).length).toBe(1);
  });

  it('hides Collect from users without collect_sample', () => {
    const items = menusFromWorkflow(stored(), ctxWith('register_patient', 'enter_result'))!;
    expect(items.some(i => i.id === 'collect')).toBe(false);
    expect(collectItems(items).length).toBe(0);
  });

  it('the Collect area\'s home copy is always on — a saved "off" still shows Collect; roles/permission gate it', () => {
    const cfg = stored();
    cfg.categories.push(cat('collect', 'Collect', 1));
    cfg.actions.push(act('collect-home', 'sample_collection', 'collect', false));
    const items = menusFromWorkflow(cfg, ctxWith('collect_sample', 'register_patient'))!;
    expect(items.some(i => i.id === 'collect')).toBe(true);
    const noCollect = menusFromWorkflow(cfg, ctxWith('register_patient'))!;
    expect(noCollect.some(i => i.id === 'collect')).toBe(false);
  });

  it('the shells\' fallback adds nothing when a workflow is configured — no duplicate Collect', () => {
    const items = menusFromWorkflow(stored(), ctxWith('collect_sample', 'register_patient'))!;
    const out = withCollectionFallback(items, { hasWorkflow: true, canCollect: true, collectionEnabled: true });
    expect(out).toBe(items);
    expect(collectItems(out).length).toBe(1);
    // …even when the workflow grants no Collect area to this user.
    const none: NavItem[] = [];
    expect(withCollectionFallback(none, { hasWorkflow: true, canCollect: true, collectionEnabled: true })).toEqual([]);
  });
});

describe('withCollectionFallback — no workflow configured', () => {
  const lab = PRIMARY_NAV.find(i => i.id === 'lab')!;

  it('still appends the static Collect page for collect_sample holders', () => {
    const out = withCollectionFallback([lab], { hasWorkflow: false, canCollect: true, collectionEnabled: true });
    expect(out.map(i => i.id)).toEqual(['lab', 'sample-collection']);
    expect(out[1].href).toBe('/sample-collection');
  });

  it('not for users who can\'t collect, nor when collection is switched off', () => {
    expect(withCollectionFallback([lab], { hasWorkflow: false, canCollect: false, collectionEnabled: true })).toEqual([lab]);
    expect(withCollectionFallback([lab], { hasWorkflow: false, canCollect: true, collectionEnabled: false })).toEqual([lab]);
  });

  it('not when a collection surface is already visible', () => {
    const queue = PRIMARY_NAV.find(i => i.id === 'queue')!;
    expect(withCollectionFallback([lab, queue], { hasWorkflow: false, canCollect: true, collectionEnabled: true }).length).toBe(2);
  });
});
