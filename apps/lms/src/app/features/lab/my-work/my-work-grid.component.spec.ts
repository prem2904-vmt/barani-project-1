import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { ThemeService } from '../../../core/services/theme.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { MyWorkGridComponent, MwGridContext } from './my-work-grid.component';
import { MwRow, MwTube, patientRowsOf, sampleRowsOf } from './my-work.grid';

/**
 * My Work's grid, rendered (owner 2026-11-20): shared pf-data-grid rows, ONE primary at the row end + ⋯, the row tap
 * = the old tile tap, names never cut, touch sizing from the shared cells (≥44px, 8px apart), phones get card rows.
 */
const line = (id: string, status = 'pending') => ({ id, status, test: { name: id === 'a' ? 'Complete Blood Count' : 'ESR' },
  subOrder: { id: 's1', receivedAtLab: new Date(Date.now() - 40 * 60000).toISOString(), order: { id: 'o1', patient: { displayName: 'X' } } } });
const LONG = 'Mrs. Venkatalakshmi Subramaniam Ramachandran';
const tube = (o: Partial<MwTube> = {}) => ({
  sampleId: 's1', deptName: 'Haematology', barcode: '0126101', tests: [line('a'), line('b')] as never, allDone: false, hasDraft: false,
  assignedTo: 'me', rejections: [], remainingMin: 30, dueAt: Date.now() + 30 * 60000, patientName: LONG, patientMeta: '62/F · AA0007', ...o,
});

@Component({
  standalone: true,
  imports: [MyWorkGridComponent],
  template: `<div style="width: 1300px; height: 700px; display: flex"><pf-mw-grid [rows]="rows()" [mode]="mode()" [ctx]="ctx" [phone]="phone()" emptyTitle="Nothing in the queue." /></div>`,
})
class Host {
  rows = signal<MwRow[]>([]);
  mode = signal<'sample' | 'patient' | 'done'>('sample');
  phone = signal(false);
  tab = signal<'my_work' | 'service_queue'>('my_work');
  ctx: MwGridContext = {
    rules: () => ({ tab: this.tab(), myId: 'me', canReassign: true, canEdit: true }),
    ownerName: () => 'Ravi T',
    activate: vi.fn(), toggle: vi.fn(), delegate: vi.fn(), print: vi.fn(), edit: vi.fn(), view: vi.fn(),
    pending: () => false, printing: () => false, reopening: () => false,
    peekDown: vi.fn(), peekMove: vi.fn(), peekUp: vi.fn(),
  };
}

const realMatchMedia = (window as any).matchMedia;
const noMatch = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
afterEach(() => { TestBed.resetTestingModule(); (window as any).matchMedia = realMatchMedia ?? noMatch; });
const settle = async (f: { detectChanges(): void }) => { for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 40)); f.detectChanges(); } };

async function render(rows: MwRow[], o: { mode?: 'sample' | 'patient' | 'done'; phone?: boolean; touch?: boolean; tab?: 'my_work' | 'service_queue' } = {}) {
  (window as any).matchMedia = (q: string) => ({ matches: q.includes('hover') ? !o.touch : false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  TestBed.configureTestingModule({
    providers: [
      { provide: ThemeService, useValue: { isNewDesign: signal(true), isDark: signal(false) } },
      { provide: ZoomTransitionService, useValue: { holding: signal(false), tap: () => true, rearm() {}, attachSource() {}, detachSource() {} } },
    ],
  });
  const f = TestBed.createComponent(Host);
  f.componentInstance.rows.set(rows);
  f.componentInstance.mode.set(o.mode ?? 'sample');
  f.componentInstance.phone.set(!!o.phone);
  f.componentInstance.tab.set(o.tab ?? 'my_work');
  f.detectChanges();
  await f.whenStable();
  await settle(f);
  const grid = f.debugElement.query(By.directive(MyWorkGridComponent)).componentInstance as MyWorkGridComponent;
  /** A tap on a row (AG-Grid's rowClicked — jsdom's synthetic click doesn't reach AG-Grid's row listener). */
  const tapRow = (row: MwRow, target: Element) => grid.onRow({ data: row, event: { target } } as never);
  return { f, el: f.nativeElement as HTMLElement, ctx: f.componentInstance.ctx, grid, tapRow };
}
const css = () => ((MyWorkGridComponent as any).ɵcmp.styles as string[]).join('\n').replace(/\[_ng(content|host)-%COMP%\]/g, '');

describe('My Work grid (rendered)', () => {
  it('sample focus: shared pf-data-grid, one row per tube, the FULL name, ONE primary at the row end', async () => {
    const { el } = await render(sampleRowsOf([{ priority: 'urgent', tubes: [tube()] }, { priority: 'normal', tubes: [tube({ sampleId: 's2', barcode: '0126102' })] }]));
    expect(el.querySelector('pf-data-grid[data-testid="mw-grid"]')).not.toBeNull();
    const rows = [...el.querySelectorAll<HTMLElement>('.ag-row.mwg-row')];
    expect(rows.length).toBe(2);
    expect(rows[0].classList).toContain('wg-row--urgent');
    expect(rows[1].classList).not.toContain('wg-row--urgent');
    expect(rows[0].querySelector('.wg-who__name')!.textContent!.trim()).toBe(LONG);
    expect(rows[0].querySelectorAll('[data-action]').length).toBe(1);
    expect(rows[0].querySelector('[data-action="enter"]')!.textContent!.trim()).toBe('Enter results');
    expect(rows[0].querySelector('.wg-pill')!.textContent!.trim()).toBe('To enter');
  });

  it('the primary does the tube tap; ⋯ holds Delegate; a tap on the row = the old tile tap', async () => {
    const rows = sampleRowsOf([{ priority: 'normal', tubes: [tube()] }]);
    const { el, ctx, tapRow } = await render(rows);
    (el.querySelector('[data-action="enter"]') as HTMLElement).click();
    expect(ctx.activate).toHaveBeenCalledTimes(1);
    expect((ctx.activate as any).mock.calls[0][1]).toBe(LONG);
    tapRow(rows[0], el.querySelector('.ag-row .wg-who__name')!);
    expect(ctx.activate).toHaveBeenCalledTimes(2);
    // A tap on a control inside the row never also runs the row tap.
    tapRow(rows[0], el.querySelector('[data-action="enter"]')!);
    expect(ctx.activate).toHaveBeenCalledTimes(2);
    expect(el.querySelector('.ag-row pf-actions-menu')).not.toBeNull();
  });

  it('queue: Pick up on a free tube; someone else\'s claimed tube has no primary', async () => {
    const { el } = await render(sampleRowsOf([{ priority: 'normal', tubes: [tube({ assignedTo: null }), tube({ sampleId: 's3', barcode: '0126103', assignedTo: 't2' })] }]), { tab: 'service_queue' });
    const rows = [...el.querySelectorAll<HTMLElement>('.ag-row.mwg-row')];
    expect(rows.find(r => r.textContent!.includes('0126101'))!.querySelector('[data-action="pick"]')!.textContent!.trim()).toBe('Pick up');
    const other = rows.find(r => r.textContent!.includes('0126103'))!;
    expect(other.querySelector('[data-action]')).toBeNull();
    expect(other.querySelector('.wg-pill')!.textContent!.trim()).toBe('Claimed · Ravi T');
  });

  it('patient focus: row tap = show the patient\'s tubes; the inline tubes keep the tube tap', async () => {
    const g = { orderId: 'o1', patientName: LONG, patientMeta: '62/F', items: [line('a'), line('b')] as never, priority: 'normal' as const, remainingMin: 30, dueAt: null };
    const tubes = [tube(), tube({ sampleId: 's2', barcode: '0126102' })];
    const closedRows = patientRowsOf([{ priority: 'normal', groups: [{ group: g, tubes }] }], () => false);
    const closed = await render(closedRows, { mode: 'patient' });
    const btn = closed.el.querySelector('[data-action="tubes"]') as HTMLElement;
    expect(btn.textContent!.trim()).toBe('2 tubes');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    closed.tapRow(closedRows[0], closed.el.querySelector('.ag-row .wg-who__name')!);
    expect(closed.ctx.toggle).toHaveBeenCalledWith('o1');
    btn.click();
    expect(closed.ctx.toggle).toHaveBeenCalledTimes(2);
    TestBed.resetTestingModule();
    const open = await render(patientRowsOf([{ priority: 'normal', groups: [{ group: g, tubes }] }], () => true), { mode: 'patient' });
    const list = open.el.querySelectorAll('.mwg-tubes .mwg-tube');
    expect(list.length).toBe(2);
    (list[1] as HTMLElement).click();
    expect((open.ctx.activate as any).mock.calls[0][0].sampleId).toBe('s2');
  });

  it('touch: never icon-only, ≥44px faces 8px apart from the shared cells; nothing hover-only', async () => {
    const { el } = await render(sampleRowsOf([{ priority: 'normal', tubes: [tube()] }]), { touch: true });
    expect(el.querySelector('[data-action="enter"]')!.classList).not.toContain('pf-rowact--icon');
    expect(css()).toMatch(/not \(\(hover: hover\) and \(pointer: fine\)\)[^{]*\{[^}]*\.wg-act\s*\{[^}]*min-height:\s*44px/);
    expect(css()).toMatch(/\.wg-acts\s*\{[^}]*gap:\s*8px/);
    // The only hover rule is feedback (a border colour), never a reveal.
    expect(css()).not.toMatch(/:hover[^{]*\{[^}]*(display|opacity|visibility)/);
    // Names wrap, never an ellipsis.
    expect(css()).toMatch(/\.wg-who__name\s*\{[^}]*white-space:\s*normal/);
  });

  it('phones: card rows with the same actions, ≥44px', async () => {
    const { el, ctx } = await render(sampleRowsOf([{ priority: 'urgent', tubes: [tube()] }]), { phone: true, touch: true });
    expect(el.querySelector('pf-data-grid')).toBeNull();
    const card = el.querySelector('[data-testid="mw-cards"] .wg-card') as HTMLElement;
    expect(card.getAttribute('data-urgent')).toBe('true');
    expect(card.querySelector('.wg-who__name')!.textContent!.trim()).toBe(LONG);
    (card.querySelector('[data-action="enter"]') as HTMLElement).click();
    expect(ctx.activate).toHaveBeenCalledTimes(1);
    expect(css()).toMatch(/\.wg-card\s+\.wg-act[^{]*\{[^}]*min-height:\s*44px/);
  });

  it('empty keeps its copy', async () => {
    const { el } = await render([], { phone: true });
    expect(el.textContent).toContain('Nothing in the queue.');
  });
});
