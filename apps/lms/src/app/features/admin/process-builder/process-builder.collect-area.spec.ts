import { renderBandPage } from '../admin-band.spec-helpers';
import { ProcessBuilderComponent } from './process-builder.component';

/**
 * Process builder — the system Collect work area: normalised into older
 * workflows, its home Sample Collection copy is locked (no drag-out, no
 * removal) while copies in other areas stay free (move / remove / toggle).
 */
describe('Process builder — Collect work area', () => {
  const cat = (id: string, name: string, order: number) => ({ id, name, icon: 'folder', color: '#7c3aed', order });
  const act = (id: string, type: string, categoryId: string, enabled = true, order = 0) =>
    ({ id, type, categoryId, enabled, order });
  const cfg = {
    categories: [cat('frontdesk', 'Frontdesk', 0), cat('billdesk', 'Billing counter', 1), cat('lab', 'Lab', 2),
                 cat('validate', 'Validate', 3), cat('results', 'Results', 4)],
    actions: [
      act('a1', 'patient_registration', 'frontdesk'), act('a2', 'sample_collection', 'frontdesk', true, 1),
      act('a3', 'dispatch', 'frontdesk', true, 2),
      act('k1', 'billing', 'billdesk'), act('k2', 'sample_collection', 'billdesk', true, 1),
      act('b1', 'lab_intake', 'lab'), act('b3', 'result_entry', 'lab', true, 2),
      act('c1', 'validate', 'validate'), act('d1', 'results', 'results'),
    ],
  };
  const wfs = [{ id: 'w1', name: 'Without Collection Center', isActive: true, branchId: null, configJson: JSON.stringify(cfg) }];
  const make = () => {
    const p = renderBandPage(ProcessBuilderComponent, { getFor: (u) => (u.startsWith('/api/process-workflows') ? wfs : []) });
    p.f.detectChanges();
    return p;
  };
  const lanes = (p: any) => p.cmp.lanes() as { cat: { id: string; name: string; roles?: string[] }; items: { id: string; type: string; enabled: boolean }[] }[];
  const lane = (p: any, id: string) => lanes(p).find(l => l.cat.id === id)!;
  const idx = (p: any, id: string) => lanes(p).findIndex(l => l.cat.id === id);
  const drag = (from: string, fromData: unknown[], i: number, to: string, toData: unknown[]) => ({
    previousContainer: { id: from, data: fromData }, container: { id: to, data: toData }, previousIndex: i, currentIndex: 0,
  });

  it('adds the Collect lane after Frontdesk with its locked home copy, default roles and a preview chip', async () => {
    const p = make();
    await p.f.whenStable();
    p.f.detectChanges();
    expect(lanes(p).map(l => l.cat.id)).toEqual(['frontdesk', 'collect', 'billdesk', 'lab', 'validate', 'results']);
    expect(lane(p, 'collect').cat.roles).toEqual(['Sample Collector', 'Lab Admin', 'Branch Manager']);
    expect(lane(p, 'collect').items.map(i => i.type)).toEqual(['sample_collection']);
    // Copies in Frontdesk + the billing counter are NOT pulled out by the lock repair.
    expect(lane(p, 'frontdesk').items.some(i => i.type === 'sample_collection')).toBe(true);
    expect(lane(p, 'billdesk').items.some(i => i.type === 'sample_collection')).toBe(true);
    const laneEls = p.el.querySelectorAll('.pb-lane');
    const collectEl = laneEls[1] as HTMLElement;
    expect((collectEl.querySelector('.pb-lane-name') as HTMLInputElement).value).toBe('Collect');
    expect(collectEl.querySelector('.pb-action--locked .pb-lock')).not.toBeNull();
    // The Frontdesk copy shows a grip, not a lock.
    const fdCopy = [...(laneEls[0] as HTMLElement).querySelectorAll('.pb-action')].find(e => /Sample Collection/.test(e.textContent ?? ''))!;
    expect(fdCopy.classList.contains('pb-action--locked')).toBe(false);
    expect(p.el.querySelector('.pb-preview')!.textContent).toContain('Collect');
  });

  it('the home copy can\'t be dragged out or removed; the Collect area can\'t be deleted', () => {
    const p = make();
    const c = p.cmp as any;
    expect(c.locked('sample_collection', 'collect')).toBe(true);
    const home = lane(p, 'collect');
    c.dropToLane(drag('lane-collect', home.items, 0, 'lane-lab', lane(p, 'lab').items), idx(p, 'lab'));
    expect(lane(p, 'collect').items.length).toBe(1);
    c.dropToPalette(drag('lane-collect', lane(p, 'collect').items, 0, 'palette', []));
    expect(lane(p, 'collect').items.length).toBe(1);
    c.deleteCategory(idx(p, 'collect'));
    expect(lanes(p).some(l => l.cat.id === 'collect')).toBe(true);
    expect(p.toasts.info).toHaveBeenCalled();
  });

  it('copies elsewhere move and remove freely', () => {
    const p = make();
    const c = p.cmp as any;
    expect(c.locked('sample_collection', 'frontdesk')).toBe(false);
    c.addCategory();
    const customIdx = lanes(p).length - 1;
    const custom = lanes(p)[customIdx];
    const fd = lane(p, 'frontdesk');
    const at = fd.items.findIndex(i => i.type === 'sample_collection');
    c.dropToLane(drag('lane-frontdesk', fd.items, at, 'lane-' + custom.cat.id, custom.items), customIdx);
    expect(lanes(p)[customIdx].items.map(i => i.type)).toEqual(['sample_collection']);
    expect(lane(p, 'frontdesk').items.some(i => i.type === 'sample_collection')).toBe(false);
    const bd = lane(p, 'billdesk');
    c.dropToPalette(drag('lane-billdesk', bd.items, bd.items.findIndex(i => i.type === 'sample_collection'), 'palette', []));
    expect(lane(p, 'billdesk').items.some(i => i.type === 'sample_collection')).toBe(false);
    // Never a second copy in the same area.
    const intoCollect = lanes(p)[customIdx];
    c.dropToLane(drag('lane-' + intoCollect.cat.id, intoCollect.items, 0, 'lane-collect', lane(p, 'collect').items), idx(p, 'collect'));
    expect(lane(p, 'collect').items.filter(i => i.type === 'sample_collection').length).toBe(1);
  });

  it('toggling the home copy off leaves the other copies (and dispatch) working', () => {
    const p = make();
    const c = p.cmp as any;
    c.toggleAction(idx(p, 'collect'), 0);
    expect(lane(p, 'collect').items[0].enabled).toBe(false);
    expect(lane(p, 'frontdesk').items.find(i => i.type === 'sample_collection')!.enabled).toBe(true);
    expect(lane(p, 'billdesk').items.find(i => i.type === 'sample_collection')!.enabled).toBe(true);
    expect(lane(p, 'frontdesk').items.find(i => i.type === 'dispatch')!.enabled).toBe(true);
    // Toggle it back on: only that copy flips.
    c.toggleAction(idx(p, 'collect'), 0);
    expect(lane(p, 'collect').items[0].enabled).toBe(true);
  });

  it('switching the LAST enabled copy off cascades dispatch (+ its coupled intake) off', () => {
    const p = make();
    const c = p.cmp as any;
    c.toggleAction(idx(p, 'collect'), 0);
    const fdAt = lane(p, 'frontdesk').items.findIndex(i => i.type === 'sample_collection');
    c.toggleAction(idx(p, 'frontdesk'), fdAt);
    expect(lane(p, 'frontdesk').items.find(i => i.type === 'dispatch')!.enabled).toBe(true);   // counter copy still on
    const bdAt = lane(p, 'billdesk').items.findIndex(i => i.type === 'sample_collection');
    c.toggleAction(idx(p, 'billdesk'), bdAt);
    expect(lane(p, 'frontdesk').items.find(i => i.type === 'dispatch')!.enabled).toBe(false);
    expect(lane(p, 'lab').items.find(i => i.type === 'lab_intake')!.enabled).toBe(false);
    // Re-enabling dispatch pulls collection back via ONE copy (the home copy).
    const dAt = lane(p, 'frontdesk').items.findIndex(i => i.type === 'dispatch');
    c.toggleAction(idx(p, 'frontdesk'), dAt);
    expect(lane(p, 'collect').items[0].enabled).toBe(true);
    expect(lane(p, 'frontdesk').items.find(i => i.type === 'sample_collection')!.enabled).toBe(false);
  });

  it('saving persists the Collect area', () => {
    const p = make();
    const cfgOut = (p.cmp as any).buildConfig();
    expect(cfgOut.categories.map((c: any) => c.id)).toContain('collect');
    expect(cfgOut.actions.filter((a: any) => a.categoryId === 'collect' && a.type === 'sample_collection').length).toBe(1);
  });
});
