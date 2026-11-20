import { TestBed } from '@angular/core/testing';
import { pillFitState, pillFitSummary, PILL_FIT_SLACK } from '@prefrontal/shared';
import { SegmentedComponent, type SegmentedOption } from './segmented.component';

/**
 * Pill fit (owner 2026-11-20): a pill group that does not fit its slot first tightens, then collapses into ONE pill
 * (selected option + count + chevron) whose menu holds the options — never a wrapped head, a cut label or a sideways
 * scroll. The decision is pure (`pillFitState`); the component measures (its natural width with and without the
 * tight padding, and the slot it is given) and applies it.
 */
describe('pillFitState', () => {
  it('keeps the full pill when the natural width fits (with sub-pixel slack)', () => {
    expect(pillFitState(400, 380, 320)).toBe('full');
    expect(pillFitState(380, 380, 320)).toBe('full');
    expect(pillFitState(380 - PILL_FIT_SLACK, 380, 320)).toBe('full');
  });

  it('tightens before it collapses', () => {
    expect(pillFitState(379, 380, 320)).toBe('tight');
    expect(pillFitState(320, 380, 320)).toBe('tight');
  });

  it('collapses to the selected-pill menu when even the tight pill does not fit', () => {
    expect(pillFitState(319, 380, 320)).toBe('menu');
    expect(pillFitState(120, 380, 320)).toBe('menu');
  });

  it('goes straight to the menu when tightening cannot help (tight >= full, or unknown)', () => {
    expect(pillFitState(379, 380, 380)).toBe('menu');
    expect(pillFitState(379, 380, 0)).toBe('menu');
    expect(pillFitState(379, 380, 999)).toBe('menu');
  });

  it('never collapses on a missing measurement (hidden, not laid out, a test DOM)', () => {
    expect(pillFitState(0, 380, 320)).toBe('full');
    expect(pillFitState(200, 0, 0)).toBe('full');
    expect(pillFitState(NaN, 380, 320)).toBe('full');
  });

  it('the decision depends only on the slot and the natural widths — the same inputs give the same state', () => {
    // The component keeps its box at the natural width in every state, so `avail` does not move with the state:
    // re-deciding with the same numbers can never flip-flop.
    const a = pillFitState(300, 380, 320);
    expect(pillFitState(300, 380, 320)).toBe(a);
  });

  it('summary text reads label + count', () => {
    expect(pillFitSummary('Completed', 17)).toBe('Completed, 17');
    expect(pillFitSummary('All')).toBe('All');
    expect(pillFitSummary(' Partial ', 0)).toBe('Partial, 0');
  });
});

describe('SegmentedComponent fit', () => {
  const OPTS: SegmentedOption<string>[] = [
    { value: 'all', label: 'All', count: 21 },
    { value: 'completed', label: 'Completed', count: 17, dot: 'var(--violet-text)' },
    { value: 'partial', label: 'Partial', count: 2 },
    { value: 'delivered', label: 'Delivered', count: 3, disabled: true, hint: 'Not yet' },
  ];

  /** Fake layout: the bar is `full` px wide (`tight` px with the tight class), the slot gives `slot` px. */
  function make(o: { full: number; tight: number; slot: number; allowDeselect?: boolean; value?: string | null }) {
    const fixture = TestBed.createComponent(SegmentedComponent<string>);
    const c = fixture.componentInstance;
    c.options = OPTS;
    c.value = (o.value === undefined ? 'completed' : o.value) as string;
    c.ariaLabel = 'Filter by status';
    c.allowDeselect = !!o.allowDeselect;
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const bar = host.querySelector('.bar') as HTMLElement;
    const layout = { ...o };
    bar.getBoundingClientRect = () => ({ width: host.classList.contains('is-tight') ? layout.tight : layout.full } as DOMRect);
    host.getBoundingClientRect = () => ({ width: Math.min(layout.slot, layout.full) } as DOMRect);
    const emitted: unknown[] = [];
    const clicks: { value: unknown; target: HTMLElement }[] = [];
    c.valueChange.subscribe(v => emitted.push(v));
    c.optionClick.subscribe(e => clicks.push({ value: e.value, target: e.target }));
    return { fixture, c, host, layout, emitted, clicks };
  }
  const compact = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-seg-compact]');

  it('fits: no class, no pinned width, no collapsed pill — today\'s pill exactly', () => {
    const { c, host } = make({ full: 380, tight: 320, slot: 500 });
    c.refit();
    expect(c.fit()).toBe('full');
    expect(host.classList.contains('is-tight') || host.classList.contains('is-menu')).toBe(false);
    expect(host.style.width).toBe('');
    expect(compact(host)).toBeNull();
    expect(host.querySelectorAll('[role="radio"]').length).toBe(4);
  });

  it('a little short: tight (labels + counts kept), the box pinned to the natural width', () => {
    const { c, host } = make({ full: 380, tight: 320, slot: 350 });
    c.refit();
    expect(c.fit()).toBe('tight');
    expect(host.classList.contains('is-tight')).toBe(true);
    expect(host.style.width).toBe('380px');
    expect(compact(host)).toBeNull();
    expect(Array.from(host.querySelectorAll('.seg-lbl')).map(e => e.textContent?.trim())).toEqual(['All', 'Completed', 'Partial', 'Delivered']);
  });

  it('too short: ONE pill = selected option + count + chevron; the bar is hidden; grows back when room returns', () => {
    const { c, host, layout, fixture } = make({ full: 380, tight: 320, slot: 200 });
    c.refit();
    fixture.detectChanges();
    expect(c.fit()).toBe('menu');
    expect(host.classList.contains('is-menu')).toBe(true);
    const btn = compact(host)!;
    expect(btn).not.toBeNull();
    expect(btn.querySelector('.seg-lbl')?.textContent?.trim()).toBe('Completed');
    expect(btn.querySelector('.seg-count')?.textContent?.trim()).toBe('17');
    expect(btn.getAttribute('aria-label')).toBe('Filter by status: Completed, 17');
    expect(btn.querySelector('.seg-dot')).not.toBeNull();
    expect(btn.querySelector('svg.seg-chev')).not.toBeNull();
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    // Room again → back to the full pill.
    layout.slot = 600;
    c.refit();
    fixture.detectChanges();
    expect(c.fit()).toBe('full');
    expect(host.style.width).toBe('');
    expect(compact(host)).toBeNull();
  });

  it('the menu lists every option (dot + count; disabled stays disabled; the selected one is current)', () => {
    const { c } = make({ full: 380, tight: 320, slot: 200 });
    const rows = c.menuActions();
    expect(rows.map(r => [r.label, r.count, r.current, !!r.disabled])).toEqual([
      ['All', 21, false, false], ['Completed', 17, true, false], ['Partial', 2, false, false], ['Delivered', 3, false, true],
    ]);
    expect(rows[1].dot).toBe('var(--violet-text)');
    expect(rows[3].hint).toBe('Not yet');
  });

  it('a menu pick selects that option and emits valueChange + optionClick anchored on the collapsed pill', () => {
    const { c, host, fixture, emitted, clicks } = make({ full: 380, tight: 320, slot: 200 });
    c.refit();
    fixture.detectChanges();
    c.pickFromMenu('o2');
    expect(emitted).toEqual(['partial']);
    expect(c.value).toBe('partial');
    expect(clicks[0].value).toBe('partial');
    expect(clicks[0].target).toBe(compact(host));
    fixture.detectChanges();
    expect(compact(host)!.querySelector('.seg-lbl')?.textContent?.trim()).toBe('Partial');
    expect(compact(host)!.querySelector('.seg-count')?.textContent?.trim()).toBe('2');
  });

  it('allowDeselect: the menu starts with "All" (every option); re-picking the current option keeps it', () => {
    const { c, emitted } = make({ full: 380, tight: 320, slot: 200, allowDeselect: true });
    c.allLabel = 'All statuses';
    expect(c.menuActions()[0]).toEqual(expect.objectContaining({ id: 'all', label: 'All statuses', dot: 'ring', current: false }));
    c.pickFromMenu('o1');            // the current one → no deselect
    expect(emitted).toEqual([]);
    c.pickFromMenu('all');
    expect(emitted).toEqual([null]);
    expect(c.menuActions()[0].current).toBe(true);
    expect(c.compactSummary()).toBe('All statuses');
  });

  it('fitMode="off" keeps the full pill whatever the slot', () => {
    const { c, host } = make({ full: 380, tight: 320, slot: 100 });
    c.fitMode = 'off';
    c.refit();
    expect(c.fit()).toBe('full');
    expect(host.classList.contains('is-menu')).toBe(false);
  });

  it('a hidden pill (nothing laid out) never collapses', () => {
    const { c } = make({ full: 0, tight: 0, slot: 0 });
    c.refit();
    expect(c.fit()).toBe('full');
  });
});
