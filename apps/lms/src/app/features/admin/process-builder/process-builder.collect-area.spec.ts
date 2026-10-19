import { renderBandPage } from '../admin-band.spec-helpers';
import { ProcessBuilderComponent } from './process-builder.component';

/**
 * Process builder — Sample Collection's FIXED SLOTS (owner's final rule,
 * 2026-09-27): "Sample collection cannot be dragged around … Front desk can
 * enable and disable it, and in Lab they can enable and disable it. That's the
 * only thing." Collect's copy is always on; Frontdesk + Lab copies toggle but
 * never move or leave; it isn't in the palette; strays elsewhere are dropped.
 */
describe('Process builder — Sample Collection fixed slots', () => {
  const cat = (id: string, name: string, order: number) => ({ id, name, icon: 'folder', color: '#7c3aed', order });
  const act = (id: string, type: string, categoryId: string, enabled = true, order = 0) =>
    ({ id, type, categoryId, enabled, order });
  /** An older workflow: a copy in Frontdesk, a STRAY copy at the billing
   *  counter, none in the Lab, no Collect area yet. */
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
  const sc = (p: any, id: string) => lane(p, id).items.filter(i => i.type === 'sample_collection');
  const scAt = (p: any, id: string) => lane(p, id).items.findIndex(i => i.type === 'sample_collection');
  const drag = (from: string, fromData: unknown[], i: number, to: string, toData: unknown[]) => ({
    previousContainer: { id: from, data: fromData }, container: { id: to, data: toData }, previousIndex: i, currentIndex: 0,
  });

  it('loads with exactly the three slots: Collect (on), Frontdesk (kept on), Lab (added off); the stray is dropped', async () => {
    const p = make();
    await p.f.whenStable();
    p.f.detectChanges();
    expect(lanes(p).map(l => l.cat.id)).toEqual(['frontdesk', 'collect', 'billdesk', 'lab', 'validate', 'results']);
    expect(lane(p, 'collect').cat.roles).toEqual(['Sample Collector', 'Lab Admin', 'Branch Manager']);
    expect(sc(p, 'collect').map(i => i.enabled)).toEqual([true]);
    expect(sc(p, 'frontdesk').map(i => i.enabled)).toEqual([true]);
    expect(sc(p, 'lab').map(i => i.enabled)).toEqual([false]);
    expect(sc(p, 'billdesk')).toEqual([]);
    expect(p.el.querySelector('.pb-preview')!.textContent).toContain('Collect');
  });

  it('the palette has no Sample Collection', () => {
    const p = make();
    expect((p.cmp as any).palette().some((e: any) => e.type === 'sample_collection')).toBe(false);
    expect(p.el.querySelector('.pb-palette')!.textContent).not.toContain('Sample Collection');
  });

  it('every copy shows the lock; Frontdesk / Lab toggles work, Collect\'s is disabled "always on"', () => {
    const p = make();
    const laneEls = [...p.el.querySelectorAll('.pb-lane')] as HTMLElement[];
    const row = (areaId: string) => {
      const el = laneEls[idx(p, areaId)];
      return [...el.querySelectorAll('.pb-action')].find(e => /Sample Collection/.test(e.textContent ?? '')) as HTMLElement;
    };
    for (const a of ['collect', 'frontdesk', 'lab']) {
      expect(row(a).classList.contains('pb-action--locked')).toBe(true);
      expect(row(a).querySelector('.pb-lock')).not.toBeNull();
      expect(row(a).querySelector('.pb-grip')).toBeNull();
    }
    const t = (a: string) => row(a).querySelector('.pb-toggle') as HTMLButtonElement;
    expect(t('collect').disabled).toBe(true);
    expect(t('collect').title).toBe('Required — always on');
    for (const a of ['frontdesk', 'lab']) {
      expect(t(a).disabled).toBe(false);
      expect(t(a).title).toBe('Fixed here — switch on or off');
    }
  });

  it('Frontdesk / Lab copies toggle on and off; the Collect copy stays on', () => {
    const p = make();
    const c = p.cmp as any;
    c.toggleAction(idx(p, 'collect'), scAt(p, 'collect'));
    expect(sc(p, 'collect')[0].enabled).toBe(true);
    c.toggleAction(idx(p, 'frontdesk'), scAt(p, 'frontdesk'));
    expect(sc(p, 'frontdesk')[0].enabled).toBe(false);
    c.toggleAction(idx(p, 'lab'), scAt(p, 'lab'));
    expect(sc(p, 'lab')[0].enabled).toBe(true);
    c.toggleAction(idx(p, 'lab'), scAt(p, 'lab'));
    expect(sc(p, 'lab')[0].enabled).toBe(false);
    // Switching the FD/Lab copies off never cascades: Collect still satisfies dispatch.
    expect(lane(p, 'frontdesk').items.find(i => i.type === 'dispatch')!.enabled).toBe(true);
    expect(lane(p, 'lab').items.find(i => i.type === 'lab_intake')!.enabled).toBe(true);
  });

  it('no copy can be dragged to another area or removed; slot areas can\'t be deleted', () => {
    const p = make();
    const c = p.cmp as any;
    c.addCategory();
    const customIdx = lanes(p).length - 1;
    const customId = lanes(p)[customIdx].cat.id;
    for (const [from, to] of [['frontdesk', 'billdesk'], ['lab', customId], ['frontdesk', 'collect'], ['collect', 'lab'], ['lab', 'validate']]) {
      const src = lane(p, from);
      const dst = lanes(p).find(l => l.cat.id === to)!;
      c.dropToLane(drag('lane-' + from, src.items, scAt(p, from), 'lane-' + to, dst.items), lanes(p).indexOf(dst));
    }
    for (const a of ['collect', 'frontdesk', 'lab']) {
      expect(sc(p, a).length).toBe(1);
      c.dropToPalette(drag('lane-' + a, lane(p, a).items, scAt(p, a), 'palette', []));
      expect(sc(p, a).length).toBe(1);
    }
    expect(sc(p, 'billdesk').length + sc(p, 'validate').length + lanes(p)[customIdx].items.length).toBe(0);
    expect(c.palette().some((e: any) => e.type === 'sample_collection')).toBe(false);
    c.deleteCategory(idx(p, 'collect'));
    expect(lanes(p).some(l => l.cat.id === 'collect')).toBe(true);
    expect(p.toasts.info).toHaveBeenCalled();
  });

  it('a (forged) palette drop of Sample Collection into another area is refused', () => {
    const p = make();
    const c = p.cmp as any;
    const fake = [{ type: 'sample_collection', label: 'Sample Collection', route: '/sample-collection', iconPath: [] }];
    c.palette.set(fake);
    c.dropToLane(drag('palette', fake, 0, 'lane-billdesk', lane(p, 'billdesk').items), idx(p, 'billdesk'));
    expect(sc(p, 'billdesk')).toEqual([]);
    expect(p.toasts.info).toHaveBeenCalled();
  });

  it('saving persists the normalised shape (three slots, no stray)', () => {
    const p = make();
    (p.cmp as any).save();
    const put = p.api.put.mock.calls[0] as unknown[];
    const saved = JSON.parse((put[1] as { configJson: string }).configJson);
    const copies = saved.actions.filter((a: any) => a.type === 'sample_collection')
      .map((a: any) => [a.categoryId, a.enabled]).sort();
    expect(copies).toEqual([['collect', true], ['frontdesk', true], ['lab', false]]);
  });
});
