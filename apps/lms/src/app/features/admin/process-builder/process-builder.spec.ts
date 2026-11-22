import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DialogService } from '../../../core/services/dialog.service';
import { renderBandPage } from '../admin-band.spec-helpers';
import { ProcessBuilderComponent } from './process-builder.component';
import { of } from 'rxjs';
import { STANDARD } from '../../../shared/workflow-editor/workflow-editor.spec-helpers';

/**
 * Work steps — the owner-approved workflow redesign (2026-11-19, layout A in Test Master's frame). Replaces the old
 * board specs (nd / classic-select / collect-area / collect-in-lab): every rule they pinned is pinned here again on
 * the new screen (one band Save, pf-select only, the fixed collection slots, the dispatch ⇄ intake coupling, the
 * saved payload), plus the new features: side list = the navigation, main card = the selected area, peek, See it as,
 * Warnings, branch differences, search jump, History, unsaved prompt.
 */

const STD_ROLES = ['Receptionist', 'Branch Manager', 'Lab Admin', 'Home Collection Agent', 'Sample Collector', 'Lab Technician', 'Pathologist'];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const wf = (id: string, name: string, cfg: unknown, o: Record<string, unknown> = {}) =>
  ({ id, name, isActive: false, branchId: null, configJson: JSON.stringify(cfg), version: 1, updatedAt: '2026-11-18T10:00:00Z', ...o });

interface Opts { workflows?: unknown[]; branches?: unknown[]; history?: unknown[]; roles?: unknown[]; dialogActions?: string | null; narrow?: boolean }
async function make(o: Opts = {}) {
  const dialog = {
    confirm: vi.fn(async () => true),
    prompt: vi.fn(async () => 'Counter'),
    actions: vi.fn(async () => ({ action: o.dialogActions ?? null, checked: false })),
  };
  const workflows = o.workflows ?? [wf('w1', 'Standard flow', clone(STANDARD), { isActive: true })];
  const p = renderBandPage(ProcessBuilderComponent, {
    getFor: (u) => {
      if (u === '/api/process-workflows') return workflows;
      if (u.startsWith('/api/process-workflows/') && u.endsWith('/history')) return o.history ?? [];
      if (u === '/api/tenants/branches') return o.branches ?? [];
      if (u === '/api/roles') return o.roles ?? STD_ROLES.map(name => ({ id: 'r-' + name, name }));
      return [];
    },
    providers: [{ provide: DialogService, useValue: dialog }],
  });
  if (o.narrow) (window as any).matchMedia = (q: string) => ({ matches: q.includes('900px'), addEventListener() {}, removeEventListener() {} });
  // The page loads through promises (firstValueFrom of the stub API).
  for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 0)); await p.f.whenStable(); p.f.detectChanges(); }
  const page = (p.cmp as any).page;
  const ed = page.editor;
  const $ = <T extends Element = HTMLElement>(sel: string) => p.el.querySelector<T & HTMLElement>(sel);
  const $$ = (sel: string) => Array.from(p.el.querySelectorAll<HTMLElement>(sel));
  const tick = async () => { p.f.detectChanges(); await p.f.whenStable(); p.f.detectChanges(); };
  return { ...p, page, ed, dialog, $, $$, tick };
}
const areaNames = (t: Awaited<ReturnType<typeof make>>) => t.$$('[data-testid="wf-side"] .wf-area__name').map(e => e.textContent?.trim());
const rowTypes = (t: Awaited<ReturnType<typeof make>>) => t.$$('[data-testid="wf-actions"] .wf-act').map(e => e.dataset['type']);

describe('Work steps — frame, band, one Save', () => {
  it('band: ONE violet primary Save top-right (disabled until a change), the live status line, no corner New / Duplicate / Set active', async () => {
    const t = await make();
    expect(t.el.querySelectorAll('.pf-hb-btn--primary, .pf-btn--primary').length).toBe(1);
    const save = t.bandSave()!;
    expect(save).not.toBeNull();
    expect(save.disabled).toBe(true);
    expect(t.$('[data-testid="wf-status"]')!.textContent).toContain('Standard flow is live · Save changes the navigation for everyone at once');
    const corner = t.actions().map(b => b.textContent?.trim() ?? '');
    expect(corner.some(l => /^(New|Duplicate|Set active)$/.test(l))).toBe(false);
    t.ed.toggleItem('frontdesk', 'a6');
    await t.tick();
    expect(t.bandSave()!.disabled).toBe(false);
    expect(t.$('pf-hero-band [data-testid="unsaved-state"]')!.textContent).toContain('Unsaved changes');
    expect(t.$('pf-hero-band [data-testid="savebar-discard"]')).not.toBeNull();
  });

  it('pill: Branch (pf-select, "· n changes"), Workflow menu (New / Duplicate / Set active inside it), See it as (pf-select); no native select anywhere', async () => {
    const t = await make({ branches: [{ id: 'b1', name: 'Anna Nagar' }] });
    const tools = t.tools()!;
    expect(tools.querySelector('[data-testid="wf-branch"]')).not.toBeNull();
    expect(tools.querySelector('[data-testid="wf-workflow"]')!.textContent).toContain('Standard flow · Live');
    expect(tools.querySelector('[data-testid="wf-seeas-pick"]')).not.toBeNull();
    expect(t.el.querySelector('select, datalist')).toBeNull();
    (tools.querySelector('[data-testid="wf-workflow"]') as HTMLButtonElement).click();
    await t.tick();
    const menu = document.querySelector('[data-testid="wf-workflow-menu"]')!;
    const labels = Array.from(menu.querySelectorAll('.wfm-l')).map(e => e.textContent?.trim());
    expect(labels).toEqual(['Standard flow', 'New workflow', 'Duplicate', 'Set active']);
    expect((menu.querySelector('[data-id="activate"]') as HTMLButtonElement).disabled).toBe(true);   // already live
    (menu.querySelector('[data-id="wf:w1"]') as HTMLButtonElement).click();
    await t.tick();
  });

  it('LEFT side card = the navigation, in order, with counts; RIGHT = the selected area (Frontdesk first)', async () => {
    const t = await make();
    expect(areaNames(t)).toEqual(['Frontdesk', 'Collect', 'Home Visits', 'Lab', 'Validate', 'Results', 'Messages']);
    expect(t.$$('[data-testid="wf-side"] .wf-count').map(e => e.textContent?.trim())).toEqual(['7', '1', '1', '3', '1', '1', '1']);
    expect(t.$('[data-testid="wf-area-name"]')!.textContent).toBe('Frontdesk');
    expect(rowTypes(t)).toEqual(['appointment', 'patient_registration', 'walk_in_order', 'billing', 'sample_collection', 'queue', 'dispatch']);
    // Full names + a one-line hint; never the stored decorative colour; no yellow anywhere.
    expect(t.$('[data-type="walk_in_order"] .wf-act__name')!.textContent).toBe('New Order');
    expect(t.$('[data-type="walk_in_order"] .wf-act__hint')!.textContent).toBe('Walk-in / create an order');
    expect(t.el.innerHTML).not.toMatch(/#f59e0b|#eab308|#facc15|#fbbf24|rgb\(245, 158, 11\)/i);
  });

  it('who works here: role chips (+ Add role) label left, chips right; removing a chip is a change', async () => {
    const t = await make({ roles: [{ name: 'Receptionist' }, { name: 'Billing Counter' }] });
    const chips = t.$$('[data-testid="wf-who"] .wf-role[data-role]').map(e => e.dataset['role']);
    expect(chips).toEqual(['Receptionist', 'Branch Manager', 'Lab Admin']);
    expect(t.$('[data-testid="wf-add-role"]')).not.toBeNull();
    (t.$('[data-role="Lab Admin"] .wf-role__x') as HTMLButtonElement).click();
    await t.tick();
    expect(t.ed.lane('frontdesk').cat.roles).toEqual(['Receptionist', 'Branch Manager']);
    expect(t.page.dirty()).toBe(true);
  });

  it('rows: lock pill "Stays in <area>: <reason>" for locked actions; Move to + on/off switch for the rest', async () => {
    const t = await make();
    expect(t.$('[data-type="walk_in_order"] [data-testid="wf-lock"]')!.textContent?.trim()).toBe('Stays in Frontdesk: can’t move to another area');
    expect(t.$('[data-type="sample_collection"] [data-testid="wf-lock"]')!.textContent?.trim())
      .toBe('Stays in Frontdesk: collection lives only in Collect, Frontdesk and Lab');
    expect(t.$('[data-type="billing"] [data-testid="wf-move-billing"]')).not.toBeNull();
    expect(t.$('[data-type="walk_in_order"] [data-testid="wf-move-walk_in_order"]')).toBeNull();
    const sw = t.$<HTMLButtonElement>('[data-testid="wf-switch-patient_registration"]')!;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.disabled).toBe(true);                         // always on
    // No emoji / glyph icons.
    expect(/[⠿‹›×＋●🔒]/u.test(t.$('[data-testid="wf-main"]')!.textContent ?? '')).toBe(false);
  });

  it('Move to (keyboard equivalent of dragging) moves the action and lights the target area', async () => {
    const t = await make();
    (t.$('[data-testid="wf-move-billing"]') as HTMLButtonElement).click();
    await t.tick();
    const menu = document.querySelector('[data-testid="wf-move-menu"]')!;
    expect(Array.from(menu.querySelectorAll('.wfm-group')).map(e => e.textContent?.trim())).toEqual(['Move to', 'Copy to']);
    (menu.querySelector('[data-id="area:results"]') as HTMLButtonElement).click();
    await t.tick();
    expect(rowTypes(t)).not.toContain('billing');
    expect(t.ed.lane('results').items.map((i: any) => i.type)).toEqual(['results', 'billing']);
  });

  it('+ Add action offers the unused actions (Lost & Found) and places one in the selected area', async () => {
    const t = await make();
    (t.$('[data-testid="wf-add-action"] ') ?? t.$('button[data-testid="wf-add-action"]'))!.click();
    await t.tick();
    const menu = document.querySelector('[data-testid="wf-add-action-menu"]')!;
    expect(Array.from(menu.querySelectorAll('.wfm-l')).map(e => e.textContent)).toEqual(['Lost & Found']);
    (menu.querySelector('[data-id="lost_and_found"]') as HTMLButtonElement).click();
    await t.tick();
    expect(rowTypes(t)).toContain('lost_and_found');
  });

  it('selecting another area shows it on the right; New area via a DialogService prompt (never window.prompt)', async () => {
    const t = await make();
    const promptSpy = vi.spyOn(window, 'prompt');
    (t.$('[data-testid="wf-area-lab"]') as HTMLButtonElement).click();
    await t.tick();
    expect(t.$('[data-testid="wf-area-name"]')!.textContent).toBe('Lab');
    (t.$('[data-testid="wf-add-area"]') as HTMLButtonElement).click();
    await t.tick(); await t.tick();
    expect(t.dialog.prompt).toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
    expect(t.$('[data-testid="wf-area-name"]')!.textContent).toBe('Counter');
  });
});

describe('Work steps — the old rules on the new screen', () => {
  const cat = (id: string, name: string, order: number) => ({ id, name, icon: 'folder', color: '#7c3aed', order });
  const act = (id: string, type: string, categoryId: string, enabled = true, order = 0) => ({ id, type, categoryId, enabled, order });
  /** An older workflow: collection in Frontdesk, a STRAY copy at the billing counter, none in the Lab, no Collect. */
  const OLD = {
    categories: [cat('frontdesk', 'Frontdesk', 0), cat('billdesk', 'Billing counter', 1), cat('lab', 'Lab', 2), cat('validate', 'Validate', 3), cat('results', 'Results', 4)],
    actions: [
      act('a1', 'patient_registration', 'frontdesk'), act('a2', 'sample_collection', 'frontdesk', true, 1), act('a3', 'dispatch', 'frontdesk', true, 2),
      act('k1', 'billing', 'billdesk'), act('k2', 'sample_collection', 'billdesk', true, 1),
      act('b1', 'lab_intake', 'lab'), act('b3', 'result_entry', 'lab', true, 2), act('c1', 'validate', 'validate'), act('d1', 'results', 'results'),
    ],
  };
  const sc = (t: any, area: string) => t.ed.lane(area).items.filter((i: any) => i.type === 'sample_collection');

  it('collection sits in exactly its three slots (Collect on, Frontdesk kept, Lab added off); the stray is dropped; never offered in Add action', async () => {
    const t = await make({ workflows: [wf('w1', 'Without Collection Center', OLD, { isActive: true })] });
    expect(t.page.lanes().map((l: any) => l.cat.id)).toEqual(['frontdesk', 'collect', 'billdesk', 'lab', 'validate', 'results']);
    expect(sc(t, 'collect').map((i: any) => i.enabled)).toEqual([true]);
    expect(sc(t, 'frontdesk').map((i: any) => i.enabled)).toEqual([true]);
    expect(sc(t, 'lab').map((i: any) => i.enabled)).toEqual([false]);
    expect(sc(t, 'billdesk')).toEqual([]);
    expect(t.ed.unused().some((e: any) => e.type === 'sample_collection')).toBe(false);
  });

  it('the Collect copy is always on; Frontdesk / Lab copies toggle and never cascade dispatch off', async () => {
    const t = await make({ workflows: [wf('w1', 'W', OLD, { isActive: true })] });
    t.ed.toggleItem('collect', sc(t, 'collect')[0].id);
    expect(sc(t, 'collect')[0].enabled).toBe(true);
    t.ed.toggleItem('frontdesk', sc(t, 'frontdesk')[0].id);
    expect(sc(t, 'frontdesk')[0].enabled).toBe(false);
    t.ed.toggleItem('lab', sc(t, 'lab')[0].id);
    expect(sc(t, 'lab')[0].enabled).toBe(true);
    expect(t.ed.lane('frontdesk').items.find((i: any) => i.type === 'dispatch').enabled).toBe(true);
    expect(t.ed.lane('lab').items.find((i: any) => i.type === 'lab_intake').enabled).toBe(true);
  });

  it('dispatch ⇄ lab intake toggle together', async () => {
    const t = await make({ workflows: [wf('w1', 'W', OLD, { isActive: true })] });
    (t.$('[data-testid="wf-switch-dispatch"]') as HTMLButtonElement).click();
    await t.tick();
    expect(t.ed.lane('lab').items.find((i: any) => i.type === 'lab_intake').enabled).toBe(false);
  });

  it('Save PUTs the same payload (normalised: three slots, no stray) and the toast says Saved', async () => {
    const t = await make({ workflows: [wf('w1', 'W', OLD, { isActive: true })] });
    t.api.put.mockImplementation((() => of({ id: 'w1', name: 'W', isActive: true, configJson: '{}' })) as any);
    await t.page.save();
    const put = t.api.put.mock.calls[0] as unknown[];
    expect(put[0]).toBe('/api/process-workflows/w1');
    const body = put[1] as { name: string; configJson: string; branchId: string | null };
    expect(Object.keys(body).sort()).toEqual(['branchId', 'configJson', 'name']);
    const saved = JSON.parse(body.configJson);
    expect(saved.actions.filter((a: any) => a.type === 'sample_collection').map((a: any) => [a.categoryId, a.enabled]).sort())
      .toEqual([['collect', true], ['frontdesk', true], ['lab', false]]);
    expect(t.toasts.success).toHaveBeenCalledWith('Saved');
  });

  it('customising the shipped standard flow asks first (DialogService, never window.confirm)', async () => {
    const t = await make({ workflows: [wf('w1', 'Standard flow', clone(STANDARD), { isActive: true, isSystemDefault: true })] });
    const confirmSpy = vi.spyOn(window, 'confirm');
    t.dialog.confirm.mockResolvedValueOnce(false);
    expect(await t.page.save()).toBe(false);
    expect(t.dialog.confirm).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(t.api.put).not.toHaveBeenCalled();
  });
});

describe('Work steps — peek, See it as, Warnings, branches, search, History, unsaved', () => {
  it('hovering a work area opens the peek beside it: roles, actions with switches, "Show <area> in the navigation"; locked rows can’t be dragged', async () => {
    const t = await make();
    vi.useFakeTimers();
    try {
      const row = t.$('[data-testid="wf-area-lab"]')!;
      row.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(400);
      t.f.detectChanges();
      const peek = document.querySelector('[data-testid="wf-peek"]') as HTMLElement;
      expect(peek).not.toBeNull();
      expect(peek.textContent).toContain('Lab Technician, Lab Admin');
      expect(peek.textContent).toContain('Show Lab in the navigation');
      expect(Array.from(peek.querySelectorAll('.wf-peek__name')).map(e => e.textContent)).toEqual(['Lab Intake', 'Result Entry', 'Sample Collection']);
      expect(peek.querySelectorAll('.wf-peek__row--locked').length).toBe(3);
      (peek.querySelector('[data-testid="wf-peek-show"]') as HTMLButtonElement).click();
      t.f.detectChanges();
      expect(t.ed.areaShown('lab')).toBe(false);
      row.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(400);
      t.f.detectChanges();
      expect(document.querySelector('[data-testid="wf-peek"]')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('a drop from the peek into the list moves the action (Alt copies); dropped on an area row it moves there', async () => {
    const t = await make();
    const cmp = (t.f.debugElement.query((d: any) => d.name === 'pf-wf-editor').componentInstance) as any;
    t.page.selectedAreaId.set('results');
    await t.tick();
    const drop = (from: string, itemId: string, idx: number, alt = false, over = true) => ({
      previousContainer: { id: from }, container: { id: 'wf-main' }, previousIndex: 0, currentIndex: idx, isPointerOverContainer: over,
      item: { data: { itemId, from: from === 'wf-peek' ? 'peek' : 'main' } }, dropPoint: { x: 0, y: 0 }, event: { altKey: alt },
    });
    cmp.dropMain(drop('wf-peek', 'a6', 0));
    expect(t.ed.lane('results').items.map((i: any) => i.type)).toEqual(['queue', 'results']);
    expect(t.ed.lane('frontdesk').items.some((i: any) => i.type === 'queue')).toBe(false);
    cmp.dropMain(drop('wf-peek', 'a4', 1, true));
    expect(t.ed.lane('frontdesk').items.some((i: any) => i.type === 'billing')).toBe(true);   // copied
    expect(t.ed.lane('results').items.some((i: any) => i.type === 'billing')).toBe(true);
    // Locked: refused, stays.
    cmp.dropMain(drop('wf-peek', 'a3', 0));
    expect(t.ed.lane('frontdesk').items.some((i: any) => i.type === 'walk_in_order')).toBe(true);
    // Onto an area row in the left list (pointer outside the list): moves to the end of that area.
    const had = (document as any).elementFromPoint;
    (document as any).elementFromPoint = () => t.$('[data-testid="wf-area-messages"]');
    const resultsQueue = t.ed.lane('results').items.find((i: any) => i.type === 'queue').id;
    cmp.dropMain(drop('wf-main', resultsQueue, 0, false, false));
    expect(t.ed.lane('messages').items.map((i: any) => i.type)).toEqual(['messages', 'queue']);
    (document as any).elementFromPoint = had;
  });

  it('See it as <role>: dims the areas the role can’t see, banner "n of m areas · Stop", the role’s chip lit', async () => {
    const t = await make();
    t.page.seeAs.set('Receptionist');
    await t.tick();
    const banner = t.$('[data-testid="wf-seeas"]')!;
    expect(banner.textContent).toContain('Seeing as Receptionist: 4 of 7 areas');
    expect(t.$$('.wf-area.is-dim').map(e => e.querySelector('.wf-area__note')!.textContent)).toEqual(
      ['Hidden for Receptionist', 'Hidden for Receptionist', 'Hidden for Receptionist']);
    expect(t.$('[data-role="Receptionist"]')!.classList.contains('wf-role--seeas')).toBe(true);
    (t.$('[data-testid="wf-seeas-stop"]') as HTMLButtonElement).click();
    await t.tick();
    expect(t.$('[data-testid="wf-seeas"]')).toBeNull();
  });

  it('Warnings chip (soft rose): "Nobody can reach Queue" → Show me selects the area and lights the row', async () => {
    const t = await make();
    expect(t.$('[data-testid="wf-warnings"]')).toBeNull();
    t.ed.toggleItem('frontdesk', 'a6');
    t.page.selectedAreaId.set('lab');
    await t.tick();
    const chip = t.$<HTMLButtonElement>('[data-testid="wf-warnings"]')!;
    expect(chip.textContent).toMatch(/Warnings\s*1/);
    chip.click();
    await t.tick();
    expect(t.$('[data-testid="wf-warnlist"]')!.textContent).toContain('Nobody can reach Queue');
    (t.$('[data-testid="wf-showme-0"]') as HTMLButtonElement).click();
    await t.tick(); await new Promise(r => setTimeout(r, 0)); t.f.detectChanges();
    expect(t.$('[data-testid="wf-area-name"]')!.textContent).toBe('Frontdesk');
    expect(t.$('[data-type="queue"]')!.classList.contains('wf-flash')).toBe(true);
  });

  it('branches: "<branch> · n changes", "Changed for <branch>" (violet) on the area, Reset to default', async () => {
    const branchCfg = clone(STANDARD);
    branchCfg.actions = branchCfg.actions.filter(a => a.type !== 'queue');
    const t = await make({
      branches: [{ id: 'b1', name: 'Chennai Main' }, { id: 'b2', name: 'Anna Nagar' }],
      workflows: [wf('w1', 'Standard flow', clone(STANDARD), { isActive: true }), wf('w2', 'Chennai flow', branchCfg, { isActive: true, branchId: 'b1' })],
    });
    const tools = t.cmp as any;
    void tools;
    const band = t.f.debugElement.query((d: any) => d.name === 'pf-wf-band-tools').componentInstance as any;
    expect(band.branchOptions().map((o: any) => o.label)).toEqual(['All branches (default)', 'Chennai Main · 1 change', 'Anna Nagar']);
    await t.page.setScope('b1');
    await t.tick();
    expect(t.$('[data-testid="wf-changed"]')!.textContent).toBe('Changed for Chennai Main');
    expect(t.$('[data-testid="wf-area-frontdesk"] .wf-area__note')!.textContent).toBe('Changed for Chennai Main');
    (t.$('[data-testid="wf-reset"]') as HTMLButtonElement).click();
    await t.tick(); await t.tick();
    expect(t.$('[data-testid="wf-changed"]')).toBeNull();
    expect(t.page.diff().count).toBe(0);
    expect(t.page.dirty()).toBe(true);
  });

  it('search jumps: "billing" → "1 match — in Frontdesk", that area selected and the row lit', async () => {
    const t = await make();
    t.page.selectedAreaId.set('lab');
    t.type('billing');
    await t.tick();
    expect(t.$('[data-testid="wf-search-note"]')!.textContent).toBe('1 match — in Frontdesk');
    expect(t.$('[data-testid="wf-area-name"]')!.textContent).toBe('Frontdesk');
    expect(t.$('[data-type="billing"]')!.classList.contains('wf-flash')).toBe(true);
    t.type('lost');
    await t.tick();
    expect(t.$('[data-testid="wf-search-note"]')!.textContent).toBe('1 match — not used yet — in Add action');
  });

  it('History lists saved versions (who / when) and Restore loads one as unsaved changes', async () => {
    const old = clone(STANDARD); old.categories[0].name = 'Front office';
    const t = await make({ history: [
      { id: 'h2', version: 2, name: 'Standard flow', at: '2026-11-19T09:00:00Z', by: 'Asha Admin', kind: 'save', configJson: JSON.stringify(STANDARD) },
      { id: 'h1', version: 1, name: 'Standard flow', at: '2026-11-17T09:00:00Z', by: null, kind: 'baseline', configJson: JSON.stringify(old) },
    ] });
    (t.$('[data-testid="wf-history"]') as HTMLButtonElement).click();
    await t.tick(); await t.tick();
    expect(t.api.get).toHaveBeenCalledWith('/api/process-workflows/w1/history');
    const panel = document.querySelector('[data-testid="wf-history-panel"]') as HTMLElement;
    const rows = Array.from(panel.querySelectorAll('[data-testid="wf-version"]')).map(r => r.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('Version 2');
    expect(rows[0]).toContain('Asha Admin');
    expect(rows[1]).toContain('Before history was kept');
    (panel.querySelector('[data-testid="wf-restore-1"]') as HTMLButtonElement).click();
    await t.tick();
    expect(t.ed.lane('frontdesk').cat.name).toBe('Front office');
    expect(t.page.dirty()).toBe(true);
    expect(document.querySelector('[data-testid="wf-history-panel"]')).toBeNull();
  });

  it('switching workflow with unsaved changes asks "Save your changes?" — Stay keeps them', async () => {
    const t = await make({ dialogActions: null, workflows: [wf('w1', 'Standard flow', clone(STANDARD), { isActive: true }), wf('w2', 'Evening', clone(STANDARD))] });
    t.ed.toggleItem('frontdesk', 'a6');
    await t.page.selectWorkflow('w2');
    expect(t.dialog.actions).toHaveBeenCalled();
    expect((t.dialog.actions.mock.calls[0] as any)[0].title).toBe('Save your changes?');
    expect(t.page.currentId()).toBe('w1');
    expect(t.page.dirty()).toBe(true);
    expect((t.cmp as any).hasUnsavedChanges()).toBe(true);
  });

  it('Leave without saving switches; Discard puts the saved workflow back', async () => {
    const t = await make({ dialogActions: 'leave', workflows: [wf('w1', 'Standard flow', clone(STANDARD), { isActive: true }), wf('w2', 'Evening', clone(STANDARD))] });
    t.ed.toggleItem('frontdesk', 'a6');
    await t.page.selectWorkflow('w2');
    expect(t.page.currentId()).toBe('w2');
    expect(t.page.dirty()).toBe(false);
    t.ed.toggleItem('frontdesk', 'a6');
    t.page.discard();
    expect(t.page.dirty()).toBe(false);
  });
});

describe('Work steps — phone / tablet portrait', () => {
  it('the side list becomes a picker that opens a sheet of work areas', async () => {
    const t = await make({ narrow: true });
    const cmp = t.f.debugElement.query((d: any) => d.name === 'pf-wf-editor').componentInstance as any;
    cmp.narrow.set(true);
    await t.tick();
    expect(t.$('[data-testid="wf-side"]')).toBeNull();
    const pick = t.$<HTMLButtonElement>('[data-testid="wf-area-picker"]')!;
    expect(pick.textContent).toContain('Frontdesk');
    pick.click();
    await t.tick();
    const sheet = document.querySelector('[data-testid="wf-area-sheet"]') as HTMLElement;
    expect(sheet).not.toBeNull();
    (sheet.querySelector('[data-testid="wf-area-results"]') as HTMLButtonElement).click();
    await t.tick();
    expect(document.querySelector('[data-testid="wf-area-sheet"]')).toBeNull();
    expect(t.$('[data-testid="wf-area-name"]')!.textContent).toBe('Results');
  });
});

describe('Work steps — the style rules', () => {
  const scss = readFileSync(resolve(__dirname, '../../../shared/workflow-editor/workflow-editor.component.scss'), 'utf8')
    .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');   // rules only, not the comments that state them
  it('no yellow / amber anywhere; warnings are soft rose; the switch ON is violet', () => {
    expect(scss).not.toMatch(/#f59e0b|#eab308|#facc15|#fbbf24|#fde68a|#fef3c7|amber|yellow|--warning/i);
    expect(scss).toMatch(/--wf-rose-text: #be123c/);
    expect(scss).toMatch(/--wf-switch-on: var\(--pf-switch-on, #7c3aed\)/);
  });
});
