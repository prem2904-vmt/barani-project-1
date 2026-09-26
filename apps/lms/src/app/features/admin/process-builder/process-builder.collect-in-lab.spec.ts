import { renderBandPage } from '../admin-band.spec-helpers';
import { ProcessBuilderComponent } from './process-builder.component';

/**
 * Owner (2026-09-26): putting Sample collection in the Lab as well must NOT
 * collapse Dispatch + Lab Intake — the patient may give the sample at the lab
 * while the front desk still collects and dispatches. The real rules stay:
 * dispatch needs SOME enabled collection; dispatch ⇄ lab intake are coupled.
 */
describe('Process builder — collection in the Lab keeps dispatch + intake', () => {
  const cat = (id: string, name: string, order: number) => ({ id, name, icon: 'folder', color: '#7c3aed', order });
  const act = (id: string, type: string, categoryId: string, enabled = true, order = 0) =>
    ({ id, type, categoryId, enabled, order });
  /** The owner's "Without Collection Center": collection in Frontdesk AND Lab. */
  const cfg = {
    categories: [cat('frontdesk', 'Frontdesk', 0), cat('lab', 'Lab', 1), cat('validate', 'Validate', 2), cat('results', 'Results', 3)],
    actions: [
      act('a1', 'patient_registration', 'frontdesk'), act('a2', 'sample_collection', 'frontdesk', true, 1),
      act('a3', 'dispatch', 'frontdesk', true, 2),
      act('b1', 'lab_intake', 'lab'), act('b2', 'sample_collection', 'lab', true, 1), act('b3', 'result_entry', 'lab', true, 2),
      act('c1', 'validate', 'validate'), act('d1', 'results', 'results'),
    ],
  };
  const make = (c = cfg) => {
    const wfs = [{ id: 'w1', name: 'Without Collection Center', isActive: true, branchId: null, configJson: JSON.stringify(c) }];
    const p = renderBandPage(ProcessBuilderComponent, { getFor: (u) => (u.startsWith('/api/process-workflows') ? wfs : []) });
    p.f.detectChanges();
    return p;
  };
  const lanes = (p: any) => p.cmp.lanes() as { cat: { id: string }; items: { id: string; type: string; enabled: boolean }[] }[];
  const lane = (p: any, id: string) => lanes(p).find(l => l.cat.id === id)!;
  const idx = (p: any, id: string) => lanes(p).findIndex(l => l.cat.id === id);
  const item = (p: any, area: string, type: string) => lane(p, area).items.find(i => i.type === type)!;

  it('loads with collection in Lab AND dispatch + lab intake still on', () => {
    const p = make();
    expect(item(p, 'lab', 'sample_collection').enabled).toBe(true);
    expect(item(p, 'frontdesk', 'dispatch').enabled).toBe(true);
    expect(item(p, 'lab', 'lab_intake').enabled).toBe(true);
  });

  it('dropping a collection copy into the Lab leaves dispatch + intake alone', () => {
    const noLabCopy = { ...cfg, actions: cfg.actions.filter(a => a.id !== 'b2') };
    const p = make(noLabCopy);
    const c = p.cmp as any;
    const at = c.palette().findIndex((e: any) => e.type === 'sample_collection');
    c.dropToLane({ previousContainer: { id: 'palette', data: c.palette() }, container: { id: 'lane-lab', data: lane(p, 'lab').items },
                   previousIndex: at, currentIndex: 0 }, idx(p, 'lab'));
    expect(item(p, 'lab', 'sample_collection').enabled).toBe(true);
    expect(item(p, 'frontdesk', 'dispatch').enabled).toBe(true);
    expect(item(p, 'lab', 'lab_intake').enabled).toBe(true);
  });

  it('dispatch + intake toggle freely (still coupled to each other)', () => {
    const p = make();
    const c = p.cmp as any;
    const fd = lane(p, 'frontdesk').items.findIndex(i => i.type === 'dispatch');
    c.toggleAction(idx(p, 'frontdesk'), fd);
    expect(item(p, 'frontdesk', 'dispatch').enabled).toBe(false);
    expect(item(p, 'lab', 'lab_intake').enabled).toBe(false);          // coupled
    c.toggleAction(idx(p, 'frontdesk'), fd);
    expect(item(p, 'frontdesk', 'dispatch').enabled).toBe(true);
    expect(item(p, 'lab', 'lab_intake').enabled).toBe(true);           // coupled back on, not collapsed
    expect(item(p, 'lab', 'sample_collection').enabled).toBe(true);
  });

  it('dispatch stays on while collection exists (the Collect home copy is always on)', () => {
    const p = make();
    const c = p.cmp as any;
    for (const area of ['collect', 'frontdesk', 'lab']) {
      const at = lane(p, area).items.findIndex(i => i.type === 'sample_collection');
      c.toggleAction(idx(p, area), at);
    }
    expect(lane(p, 'collect').items.find(i => i.type === 'sample_collection')!.enabled).toBe(true);
    expect(item(p, 'frontdesk', 'dispatch').enabled).toBe(true);
    expect(item(p, 'lab', 'lab_intake').enabled).toBe(true);
  });

  it('saves the admin\'s dispatch/intake state untouched', () => {
    const p = make();
    (p.cmp as any).save();
    const put = p.api.put.mock.calls[0] as unknown[];
    const saved = JSON.parse((put[1] as { configJson: string }).configJson);
    expect(saved.actions.find((a: any) => a.type === 'dispatch').enabled).toBe(true);
    expect(saved.actions.find((a: any) => a.type === 'lab_intake').enabled).toBe(true);
    expect(saved.actions.some((a: any) => a.type === 'sample_collection' && a.categoryId === 'lab' && a.enabled)).toBe(true);
  });
});
