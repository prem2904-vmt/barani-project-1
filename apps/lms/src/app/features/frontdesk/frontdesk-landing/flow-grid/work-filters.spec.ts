import { TestBed } from '@angular/core/testing';
import type { FlowRow } from './flow-row';
import { MoreFiltersComponent } from './more-filters.component';
import {
  NO_WORK_FILTERS, WorkFilters, activeWorkFilterCount, branchChoices, doctorChoices, filterFlowRows, sortFlowRows,
} from './work-filters';

/** Work card "More filters" (owner mock CurrentFilter, 2026-11-19). */
const row = (id: string, o: Partial<FlowRow> & { doctor?: string; branch?: string } = {}): FlowRow => ({
  id, kind: 'order', order: { id, refDoctorName: o.doctor, branchId: o.branch ?? 'b1' } as FlowRow['order'],
  draft: null, merged: null, status: 'ip', service: 'lab', urgent: false, name: id, meta: '', tags: ['LAB'],
  where: '', whereSub: '', tone: 'violet', journey: [], journeyLabel: '', waitMin: 10, wait: '10m', late: false,
  pay: 'Paid', payDue: false, due: 0, createdMs: 0, dailyNo: null, dailyNoDay: '2026-11-19', next: null, more: [], tubes: [],
  ...o,
});

describe('More filters — rules', () => {
  const rows = [
    row('a', { doctor: 'Dr. Rao', late: true, waitMin: 45, createdMs: 1, dailyNo: 3 }),
    row('b', { doctor: 'Dr. Menon', payDue: true, waitMin: 5, createdMs: 3, dailyNo: 1 }),
    row('c', { branch: 'b2', waitMin: null, createdMs: 2, dailyNo: 2 }),
  ];

  it('Doctor / Branch choices come only from what the rows carry', () => {
    expect(doctorChoices(rows)).toEqual(['Dr. Menon', 'Dr. Rao']);
    expect(branchChoices(rows)).toEqual(['b1', 'b2']);
    expect(branchChoices([rows[0], rows[1]])).toEqual(['b1']);      // one branch → the filter is not offered
  });

  it('doctor · branch · only late · only with dues narrow the list; sort is not a filter', () => {
    const f = (p: Partial<WorkFilters>) => filterFlowRows(rows, { ...NO_WORK_FILTERS, ...p }).map(r => r.id);
    expect(f({})).toEqual(['a', 'b', 'c']);
    expect(f({ doctor: 'Dr. Rao' })).toEqual(['a']);
    expect(f({ branch: 'b2' })).toEqual(['c']);
    expect(f({ onlyLate: true })).toEqual(['a']);
    expect(f({ onlyDues: true })).toEqual(['b']);
    expect(activeWorkFilterCount({ ...NO_WORK_FILTERS, sort: 'wait' })).toBe(0);
    expect(activeWorkFilterCount({ ...NO_WORK_FILTERS, doctor: 'x', onlyLate: true })).toBe(2);
  });

  it('Sort: Token (the day\'s #N, the default) · Longest wait · Newest; drafts stay on top', () => {
    const d = row('d', { kind: 'draft', createdMs: 9 });
    expect(sortFlowRows([...rows, d], 'token').map(r => r.id)).toEqual(['d', 'b', 'c', 'a']);
    expect(sortFlowRows(rows, 'wait').map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortFlowRows(rows, 'newest').map(r => r.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('pf-fd-more-filters', () => {
  // A wide screen (the popover, not the phone sheet): other specs in the same worker stub window.matchMedia and never
  // put it back, so pin it here instead of inheriting a "phone" answer.
  let realMm: typeof window.matchMedia;
  beforeEach(() => {
    realMm = window.matchMedia;
    (window as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    TestBed.configureTestingModule({ imports: [MoreFiltersComponent] });
  });
  afterEach(() => { (window as any).matchMedia = realMm; });

  const mount = (inputs: Record<string, unknown> = {}) => {
    const f = TestBed.createComponent(MoreFiltersComponent);
    f.componentRef.setInput('dateOptions', [{ value: 'yesterday', label: 'Yesterday' }, { value: 'today', label: 'Today' }, { value: 'custom', label: 'Custom' }]);
    for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  };

  it('shows Date (the existing range), the switches and Sort; Doctor / Branch only when the data has them', () => {
    const { el } = mount();
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('More filters');
    expect(el.querySelector('.pf-hdr-filter__pop')).not.toBeNull();
    const text = el.textContent ?? '';
    for (const t of ['Date', 'Yesterday', 'Today', 'Custom', 'Only late (over 30 min)', 'Only with dues', 'Sort', 'Token', 'Longest wait', 'Newest']) expect(text).toContain(t);
    expect(text).not.toContain('Doctor');
    expect(text).not.toContain('Branch');
    expect(el.querySelectorAll('select, datalist').length).toBe(0);

    const two = mount({ doctors: ['Dr. Rao'], branches: [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Annex' }] }).el;
    expect(two.textContent).toContain('Doctor');
    expect(two.textContent).toContain('Branch');
    expect(two.querySelectorAll('pf-select').length).toBe(2);
  });

  it('a switch / sort pick emits the new filters; Clear resets everything and asks for Today', () => {
    const { f, el } = mount();
    const out: WorkFilters[] = [];
    let cleared = 0;
    f.componentInstance.filtersChange.subscribe(v => out.push(v));
    f.componentInstance.cleared.subscribe(() => cleared++);
    (el.querySelector('[data-filter="late"]') as HTMLButtonElement).click();
    expect(out.at(-1)).toEqual({ ...NO_WORK_FILTERS, onlyLate: true });
    (el.querySelector('[data-filter="dues"]') as HTMLButtonElement).click();
    expect(out.at(-1)?.onlyDues).toBe(true);
    const wait = [...el.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find(b => b.textContent?.includes('Longest wait'))!;
    wait.click();
    expect(out.at(-1)?.sort).toBe('wait');

    f.componentRef.setInput('filters', { ...NO_WORK_FILTERS, onlyLate: true });
    f.detectChanges();
    const clear = [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'Clear')!;
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(out.at(-1)).toEqual(NO_WORK_FILTERS);
    expect(cleared).toBe(1);
  });

  it('the date pills emit the range; Esc and the backdrop close', () => {
    const { f, el } = mount();
    const dates: string[] = [];
    let closed = 0;
    f.componentInstance.dateChange.subscribe(v => dates.push(v));
    f.componentInstance.closed.subscribe(() => closed++);
    [...el.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find(b => b.textContent?.includes('Yesterday'))!.click();
    expect(dates).toEqual(['yesterday']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    (el.querySelector('.fd-mf__bd') as HTMLElement).click();
    expect(closed).toBe(2);
  });
});
