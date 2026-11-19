import { describe, expect, it, vi } from 'vitest';
import { STANDARD } from './workflow-editor.spec-helpers';
import {
  Lane, WorkflowEditor, areaDot, areaVisibleTo, computeWarnings, configFromLanes, diffAreas, lanesFromConfig, lockReason,
  searchHits, AREA_DOTS,
} from './workflow-editor';

const ROLES = ['Receptionist', 'Branch Manager', 'Lab Admin', 'Home Collection Agent', 'Sample Collector', 'Lab Technician', 'Pathologist'];

const make = (cfg: unknown = STANDARD) => {
  const notify = vi.fn();
  const ed = new WorkflowEditor(notify);
  ed.load(JSON.parse(JSON.stringify(cfg)), 'Standard flow');
  return { ed, notify };
};
const lane = (ed: WorkflowEditor, id: string) => ed.lane(id)!;
const item = (ed: WorkflowEditor, area: string, type: string) => lane(ed, area).items.find(i => i.type === type)!;

describe('Workflow editor engine — config in, same payload out', () => {
  it('loads through the shared normaliser: Collect after Frontdesk, collection in its three slots', () => {
    const { ed } = make();
    expect(ed.lanes().map(l => l.cat.id)).toEqual(['frontdesk', 'collect', 'homecoll', 'lab', 'validate', 'results', 'messages']);
    expect(item(ed, 'collect', 'sample_collection').enabled).toBe(true);
    expect(item(ed, 'lab', 'sample_collection').enabled).toBe(false);
    expect(ed.dirty()).toBe(false);
  });

  it('saves the SAME ProcessWorkflowConfig shape (ids, orders, categoryId, enabled) — stored colours untouched', () => {
    const { ed } = make();
    const cfg = configFromLanes(ed.lanes());
    expect(cfg.categories.map(c => c.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(cfg.categories.find(c => c.id === 'frontdesk')!.color).toBe('#f59e0b');
    const a4 = cfg.actions.find(a => a.id === 'a4')!;
    expect(a4).toEqual({ id: 'a4', type: 'billing', label: undefined, categoryId: 'frontdesk', order: 3, enabled: true });
    expect(Object.keys(cfg).sort()).toEqual(['actions', 'categories']);
  });

  it('dirty compares with the saved state: a change and its undo is clean again', () => {
    const { ed } = make();
    ed.toggleItem('frontdesk', 'a6');
    expect(ed.dirty()).toBe(true);
    ed.toggleItem('frontdesk', 'a6');
    expect(ed.dirty()).toBe(false);
    ed.name.set('Evening flow');
    expect(ed.dirty()).toBe(true);
    ed.markSaved();
    expect(ed.dirty()).toBe(false);
    ed.markDraft();
    expect(ed.dirty()).toBe(true);
  });
});

describe('Workflow editor engine — the old rules, unchanged', () => {
  it('dispatch ⇄ lab intake stay coupled; a mandatory action never switches off', () => {
    const { ed } = make();
    ed.toggleItem('frontdesk', 'a7');
    expect(item(ed, 'frontdesk', 'dispatch').enabled).toBe(false);
    expect(item(ed, 'lab', 'lab_intake').enabled).toBe(false);
    ed.toggleItem('frontdesk', 'a2');                       // patient_registration is mandatory
    expect(item(ed, 'frontdesk', 'patient_registration').enabled).toBe(true);
  });

  it('switching off a prerequisite cascades its dependents off (validate → results)', () => {
    const { ed } = make();
    ed.toggleItem('validate', 'a11');
    expect(item(ed, 'results', 'results').enabled).toBe(false);
  });

  it('a locked action never leaves its area (move / copy / remove) and says why', () => {
    const { ed, notify } = make();
    expect(ed.canMove('a3')).toBe(false);
    expect(ed.moveItem('a3', 'lab')).toBe(false);
    expect(ed.moveItem('a3', 'lab', 0, true)).toBe(false);
    expect(ed.removeItem('a3')).toBe(false);
    expect(item(ed, 'frontdesk', 'walk_in_order')).toBeTruthy();
    expect(notify).toHaveBeenCalledWith('New Order stays in Frontdesk');
    const sc = item(ed, 'frontdesk', 'sample_collection');
    expect(ed.moveItem(sc.id, 'homecoll')).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('Sample Collection is fixed here — switch it on or off instead');
  });

  it('an unlocked action moves to another area at a slot; Alt = copy keeps the original', () => {
    const { ed } = make();
    expect(ed.moveItem('a4', 'results', 0)).toBe(true);
    expect(lane(ed, 'results').items.map(i => i.type)).toEqual(['billing', 'results']);
    expect(lane(ed, 'frontdesk').items.some(i => i.type === 'billing')).toBe(false);
    expect(ed.moveItem('a6', 'lab', undefined, true)).toBe(true);
    expect(lane(ed, 'frontdesk').items.filter(i => i.type === 'queue').length).toBe(1);
    expect(lane(ed, 'lab').items.filter(i => i.type === 'queue').length).toBe(1);
    expect(lane(ed, 'lab').items.find(i => i.type === 'queue')!.id).not.toBe('a6');
  });

  it('moving inside the same area reorders (drop slot = before that row)', () => {
    const { ed } = make();
    ed.moveItem('a7', 'frontdesk', 0);
    expect(lane(ed, 'frontdesk').items[0].type).toBe('dispatch');
  });

  it('unused actions = Add action (Lost & Found, never Sample Collection); remove sends one back', () => {
    const { ed } = make();
    expect(ed.unused().map(a => a.type)).toEqual(['lost_and_found']);
    const id = ed.addAction('lab', 'lost_and_found')!;
    expect(lane(ed, 'lab').items.some(i => i.id === id && i.enabled)).toBe(true);
    expect(ed.unused()).toEqual([]);
    ed.removeItem(id);
    expect(ed.unused().map(a => a.type)).toEqual(['lost_and_found']);
    expect(ed.addAction('lab', 'sample_collection')).toBeNull();
  });

  it('an area holding a locked action can’t be removed; another can (its actions become unused)', () => {
    const { ed, notify } = make();
    expect(ed.deleteArea('frontdesk')).toBe(false);
    expect(notify).toHaveBeenCalled();
    expect(ed.deleteArea('homecoll')).toBe(true);
    expect(ed.unused().map(a => a.type)).toContain('home_visits');
  });

  it('"Show <area> in the navigation": off switches its actions off; an always-on action keeps the area shown', () => {
    const { ed, notify } = make();
    ed.setAreaShown('homecoll', false);
    expect(ed.areaShown('homecoll')).toBe(false);
    ed.setAreaShown('homecoll', true);
    expect(ed.areaShown('homecoll')).toBe(true);
    expect(ed.canHideArea('frontdesk')).toBe(false);
    ed.setAreaShown('frontdesk', false);
    expect(ed.areaShown('frontdesk')).toBe(true);
    expect(notify).toHaveBeenCalled();
  });

  it('areas: add (unique name), rename, icon, reorder, roles', () => {
    const { ed } = make();
    const id = ed.addArea('Counter');
    const id2 = ed.addArea('Counter');
    expect(lane(ed, id2).cat.name).toBe('Counter 2');
    expect(lane(ed, id).cat.color).toBe('#7c3aed');
    ed.renameArea(id, 'Billing counter');
    ed.setAreaIcon(id, 'billing');
    expect(lane(ed, id).cat).toMatchObject({ name: 'Billing counter', icon: 'billing' });
    ed.moveArea(ed.lanes().length - 2, 0);
    expect(ed.lanes()[0].cat.id).toBe(id);
    ed.addRole(id, 'Billing Counter'); ed.addRole(id, 'Billing Counter');
    expect(lane(ed, id).cat.roles).toEqual(['Billing Counter']);
    ed.removeRole(id, 'Billing Counter');
    expect(lane(ed, id).cat.roles).toEqual([]);
  });
});

describe('Workflow editor engine — lock reasons, dots, search', () => {
  it('the lock pill uses the real reason where the code has one, else the plain rule', () => {
    expect(lockReason('sample_collection', 'Frontdesk')).toBe('Stays in Frontdesk: collection lives only in Collect, Frontdesk and Lab');
    expect(lockReason('walk_in_order', 'Frontdesk')).toBe('Stays in Frontdesk: can’t move to another area');
  });

  it('dots are palette-only by position — never the stored colour, never yellow / green / sky', () => {
    expect(areaDot(0)).toBe(AREA_DOTS[0]);
    expect(areaDot(AREA_DOTS.length)).toBe(AREA_DOTS[0]);
    expect(AREA_DOTS.join(' ')).not.toMatch(/#f59e0b|#eab308|#facc15|#fbbf24|#10b981|#22c55e|#34d399|#0ea5e9|#38bdf8/i);
  });

  it('search finds actions (name / hint / type), areas, and unused actions', () => {
    const { ed } = make();
    const hits = searchHits('billing', ed.lanes(), ed.unused());
    expect(hits[0]).toMatchObject({ areaId: 'frontdesk', type: 'billing', where: 'Frontdesk' });
    expect(searchHits('lost', ed.lanes(), ed.unused())[0]).toMatchObject({ areaId: null, where: 'not used yet' });
    expect(searchHits('home visits', ed.lanes(), ed.unused())[0]).toMatchObject({ areaId: 'homecoll' });
    expect(searchHits('  ', ed.lanes(), ed.unused())).toEqual([]);
  });
});

describe('Workflow editor engine — who sees an area, warnings', () => {
  const perms = {
    Receptionist: ['register_patient', 'create_order', 'create_bill', 'collect_payment', 'deliver_report', 'view_report'],
    Pathologist: ['validate_result', 'view_report'],
    'Lab Admin': ['*'],
    'Billing Counter': ['create_bill', 'collect_payment'],
    Cleaner: [],
  };

  it('with role permissions it answers like the live (permission-driven) navigation', () => {
    const { ed } = make();
    const vis = (role: string) => ed.lanes().filter(l => areaVisibleTo(l, role, perms)).map(l => l.cat.id);
    expect(vis('Pathologist')).toEqual(['validate', 'results', 'messages']);
    expect(vis('Lab Admin').length).toBe(7);
    expect(vis('Cleaner')).toEqual(['messages']);   // Messages needs no permission
  });

  it('without them it falls back to the roles chosen per area (none chosen = everyone)', () => {
    const { ed } = make();
    const vis = ed.lanes().filter(l => areaVisibleTo(l, 'Pathologist', null)).map(l => l.cat.id);
    expect(vis).toEqual(['validate', 'messages']);
  });

  it('the Standard flow has no warnings for its own roles', () => {
    const { ed } = make();
    expect(computeWarnings(ed.lanes(), ROLES, null)).toEqual([]);
  });

  it('an action switched off everywhere → "Nobody can reach …", pointing at its row', () => {
    const { ed } = make();
    ed.toggleItem('frontdesk', 'a6');                      // queue off, in no other area
    const w = computeWarnings(ed.lanes(), ROLES, null).find(x => x.kind === 'unreachable')!;
    expect(w).toMatchObject({ title: 'Nobody can reach Queue', areaId: 'frontdesk', itemId: 'a6' });
    expect(w.detail).toContain('in no other work area');
  });

  it('an empty area, an area with no role and a role with no area are warned in plain words', () => {
    const { ed } = make();
    const id = ed.addArea('Spare');
    ed.addAction(id, 'lost_and_found');
    const id2 = ed.addArea('Empty');
    const ws = computeWarnings(ed.lanes(), [...ROLES, 'Billing Counter'], null);
    expect(ws.find(w => w.id === `empty:${id2}`)?.title).toBe('Empty is empty');
    expect(ws.find(w => w.id === `no-roles:${id}`)?.title).toBe('No role chosen for Spare');
    expect(ws.find(w => w.kind === 'role-no-area')?.title).toBe('Billing Counter has no work area');
  });

  it('with permissions: a role that can open nothing has no work area', () => {
    const { ed } = make();
    const roleWarn = (ws: ReturnType<typeof computeWarnings>) => ws.filter(w => w.kind === 'role-no-area');
    const ws = computeWarnings(ed.lanes(), ['Receptionist', 'Cleaner'], perms);
    expect(roleWarn(ws)).toEqual([]);                      // Cleaner still sees Messages
    // Lab needs receive_sample / enter_result: neither role holds one → nobody can open it.
    expect(ws.find(w => w.id === 'no-roles:lab')?.title).toBe('No role can open Lab');
    ed.setAreaShown('messages', false);
    const ws2 = computeWarnings(ed.lanes(), ['Receptionist', 'Cleaner'], perms);
    expect(roleWarn(ws2).map(w => w.title)).toEqual(['Cleaner has no work area']);
  });
});

describe('Workflow editor engine — branch differences', () => {
  const base = (): Lane[] => lanesFromConfig(JSON.parse(JSON.stringify(STANDARD)));

  it('marks the areas that differ, counts removed areas and a changed order', () => {
    const { ed } = make();
    expect(diffAreas(base(), ed.lanes()).count).toBe(0);
    ed.toggleItem('frontdesk', 'a6');
    ed.deleteArea('homecoll');
    const d = diffAreas(base(), ed.lanes());
    expect([...d.changed]).toEqual(['frontdesk']);
    expect(d.removed).toEqual(['Home Visits']);
    expect(d.count).toBe(2);
    ed.moveArea(ed.lanes().findIndex(l => l.cat.id === 'messages'), 0);
    expect(diffAreas(base(), ed.lanes()).reordered).toBe(true);
  });

  it('Reset to default makes the area exactly the default again (and pulls back actions moved elsewhere)', () => {
    const { ed } = make();
    ed.moveItem('a4', 'results');
    ed.removeRole('frontdesk', 'Lab Admin');
    ed.resetArea('frontdesk', base());
    const d = diffAreas(base(), ed.lanes());
    expect(d.changed.has('frontdesk')).toBe(false);
    expect(lane(ed, 'results').items.some(i => i.type === 'billing')).toBe(false);
    expect(d.count).toBe(0);
  });

  it('an area the default does not have is removed by Reset', () => {
    const { ed } = make();
    const id = ed.addArea('Branch only');
    expect(ed.resetArea(id, base())).toBe(true);
    expect(ed.lane(id)).toBeUndefined();
  });
});
