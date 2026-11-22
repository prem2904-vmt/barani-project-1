import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ExpenseTrackerComponent, dayLabel, searchExpenses } from './expense-tracker.component';
import { ExpenseService } from '../../../core/services/expense.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ExpenseBook, ExpenseEntry, ExpenseFilter } from '../../../shared/models/expense.model';
import { labDaysAgo, labToday } from '../../../shared/utils/lab-clock';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { sortsAndFilters } from '../../../shared/utils/work-grid';
import { ND_GRID_PARAMS } from '../../../shared/utils/pf-grid-theme';

/**
 * /expenses (primary nav; /finance/expenses redirects) — tabs My expenses ·
 * All expenses · Day closing by permission; ND pattern: band (search pill; Filters when narrow,
 * Export CSV, ONE primary "Add expense" only for modifier / admin), FILTERS
 * companion LEFT (range, type, category, mode, category totals), the EXPENSE
 * BOOK main card (range opening · cash in · expenses · closing; Entries grid /
 * Day book grid). Filters reload from the server; the search narrows the
 * loaded entries; admin day actions go through DialogService. Child
 * components (AG-Grid, band, date, select, dialog) are unknown elements here.
 */
const entry = (over: Partial<ExpenseEntry> = {}): ExpenseEntry => ({
  id: 'x1', date: labToday(), kind: 'expense', description: 'Printer toner', categoryId: 'c1', categoryName: 'Stationery',
  amount: 1250, paymentMode: 'upi', paidTo: 'Ravi Stores', notes: null, branchName: 'Salem', createdBy: 'me', createdByName: 'Anand K',
  createdAt: '2026-09-30T05:00:00Z', canEdit: true, attachments: [], ...over,
});

const bookOf = (over: Partial<ExpenseBook> = {}): ExpenseBook => ({
  from: labDaysAgo(6), to: labToday(), today: labToday(), scope: 'all', closedThrough: labDaysAgo(2),
  days: [
    { date: labToday(), opening: 1000, cashIn: 500, expenses: 1250, closing: 250, isClosed: false, openingSet: false, entryCount: 2 },
    { date: labDaysAgo(2), opening: 1000, cashIn: 0, expenses: 0, closing: 1000, isClosed: true, openingSet: true, entryCount: 0, closedByName: 'Admin' },
  ],
  entries: [entry(), entry({ id: 'x2', kind: 'cash_in', description: 'Float from owner', categoryId: null, categoryName: null, amount: 500, paymentMode: 'cash', paidTo: 'Dr. Owner', canEdit: false })],
  truncated: false, totalExpenses: 1250, totalCashIn: 500, opening: 1000, closing: 250,
  byCategory: [{ key: 'c1', label: 'Stationery', count: 1, total: 1250 }],
  byMode: [{ key: 'upi', label: 'UPI', count: 1, total: 1250 }],
  ...over,
});

describe('ExpenseTrackerComponent', () => {
  let svc: Record<string, ReturnType<typeof vi.fn>>;
  let dialogs: { prompt: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };

  function render(opts: { perms?: string[]; book?: ExpenseBook; narrow?: boolean; classic?: boolean } = {}) {
    (window as any).matchMedia = (q: string) => ({ matches: q.includes('900px') ? !!opts.narrow : false, addEventListener() {}, removeEventListener() {} });
    const perms = opts.perms ?? ['expense_admin'];
    svc = {
      book: vi.fn((_f: ExpenseFilter) => of(opts.book ?? bookOf())),
      categories: vi.fn(() => of([{ id: 'c1', name: 'Stationery', isDefault: true, isActive: true, sortOrder: 1 }])),
      exportCsv: vi.fn(() => of(new Blob(['a,b'], { type: 'text/csv' }))),
      closeDay: vi.fn(() => of({})),
      reopenDay: vi.fn(() => of({})),
      setOpening: vi.fn(() => of({})),
      createCategory: vi.fn((name: string) => of({ id: 'c9', name, isDefault: false, isActive: true, sortOrder: 9 })),
      updateCategory: vi.fn((id: string, p: { isActive?: boolean }) => of({ id, name: 'Stationery', isDefault: true, isActive: !!p.isActive, sortOrder: 1 })),
    };
    dialogs = { prompt: vi.fn(async () => 'Tallied'), confirm: vi.fn(async () => true) };
    router = { navigate: vi.fn(async () => true) };
    TestBed.configureTestingModule({
      imports: [ExpenseTrackerComponent],
      providers: [
        { provide: ExpenseService, useValue: svc },
        { provide: DialogService, useValue: dialogs },
        { provide: Router, useValue: router },
        { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => !opts.classic } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
        { provide: AuthService, useValue: {
          user: () => ({ id: 'me', branches: [{ id: 'b1', name: 'Salem' }] }),
          hasPermission: (c: string) => perms.includes(c), hasAnyPermission: (l: string[]) => l.some(c => perms.includes(c)),
        } },
      ],
    });
    TestBed.overrideComponent(ExpenseTrackerComponent, { set: { imports: [NgTemplateOutlet, BusyDirective, CurrencyInrPipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    const f = TestBed.createComponent(ExpenseTrackerComponent);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('opens on the last 7 IST days: filters LEFT, book MAIN, one primary, kit controls only', () => {
    const { el, c } = render();
    // The cashier opens on MY expenses (own entries), with all three tabs.
    expect(svc['book']).toHaveBeenCalledWith({ from: labDaysAgo(6), to: labToday(), categoryId: null, kind: null, mode: null, mine: true });
    // The section switch rides the band pill (band-tools), not an orphan row above the cards. It is the shared
    // <pf-segmented> (stubbed as an unknown element in this spec, so its options/value are asserted on the component).
    const band = el.querySelector('pf-hero-band')!;
    expect(band.querySelector('pf-segmented.pf-xt__tabs')).not.toBeNull();
    expect(c.expenseTabOptions().map((o: any) => o.label)).toEqual(['My expenses', 'All expenses', 'Day closing']);
    expect(c.expenseTabOptions().find((o: any) => o.value === c.tab()).label).toBe('My expenses');
    expect(el.querySelector('.pf-xt__tabrow')).toBeNull();
    const panels = el.querySelector('.pf-xt__panels')!;
    expect(panels.children[0].classList.contains('pf-xt__side')).toBe(true);
    expect(panels.children[1].classList.contains('pf-xt__main')).toBe(true);
    expect(el.querySelector('.pf-xt__main ag-grid-angular')).not.toBeNull();
    expect(el.querySelectorAll('.pf-hb-btn--primary').length).toBe(1);
    expect(el.querySelector('.pf-hb-btn--primary')?.textContent).toContain('Add expense');
    expect(el.querySelectorAll('select, datalist, input[type="date"]').length).toBe(0);
    expect(el.querySelectorAll('.pf-xt__side pf-date').length).toBe(2);
    // Range totals: opening · cash in · expenses · closing.
    const stats = [...el.querySelectorAll('.pf-xt__statk')].map(s => s.textContent?.trim());
    expect(stats).toEqual(['Opening', 'Cash in', 'Expenses', 'Closing']);
    expect(el.querySelector('.pf-xt__count')?.textContent).toContain('2 entries');
    // Category totals list in the companion.
    expect(el.querySelector('.pf-xt__totals')?.textContent).toContain('Stationery');
    // Payment modes are aligned rows (name · count · amount), not loose text.
    const modes = el.querySelector('.pf-xt__totals--static')!;
    expect([...modes.querySelectorAll('.pf-xt__totname')].map(n => n.textContent?.trim())).toEqual(['UPI']);
    expect(modes.querySelector('.pf-xt__totv')?.textContent).toContain('1,250');
  });

  it('date presets: three equal options (no wrapping Custom button); picking dates reads as a custom range', () => {
    const { f, el, c } = render();
    const presets = [...el.querySelectorAll('.pf-xt__seg[aria-labelledby="pf-xt-range-lbl"] [role="radio"]')].map(b => b.textContent?.trim());
    expect(presets).toEqual(['Today', '7 days', 'This month']);
    expect(el.querySelector('.pf-xt__custom')).toBeNull();
    c.setFrom(labDaysAgo(3));
    f.detectChanges();
    expect(c.quick()).toBe('custom');
    expect(el.querySelectorAll('.pf-xt__seg[aria-labelledby="pf-xt-range-lbl"] [aria-checked="true"]').length).toBe(0);
    expect(el.querySelector('.pf-xt__custom')?.textContent).toContain('Custom range');
  });

  it('closing below zero is flagged quietly; the grid wears the ND card surface (tokens, not stock grey)', () => {
    const { el, c } = render({ book: bookOf({ closing: -20 }) });
    const result = el.querySelector('.pf-xt__stat--result')!;
    expect(result.getAttribute('data-neg')).toBe('true');
    expect(result.querySelector('.pf-xt__neg')).not.toBeNull();
    expect(result.querySelector('.pf-xt__stath')?.textContent).toContain('Below zero');
    expect(el.querySelectorAll('.pf-xt__op').length).toBe(3);   // + − =
    expect(ND_GRID_PARAMS.backgroundColor).toBe('var(--pf-card-bg)');
    expect(ND_GRID_PARAMS.borderColor).toBe('var(--pf-line)');
    expect(c.share(250, 1000)).toBe(25);
    expect(c.share(5, 0)).toBe(0);
  });

  it('classic design (no band) keeps the section switch on its own row', () => {
    const { el } = render({ classic: true });
    expect(el.querySelector('pf-hero-band')).toBeNull();
    expect(el.querySelectorAll('.pf-xt__tabrow pf-segmented.pf-xt__tabs').length).toBe(1);   // one shared switch, own row
    expect(el.querySelector('pf-hero-band pf-segmented.pf-xt__tabs')).toBeNull();
  });

  it('a viewer gets no Add button and no row edit; a modifier (own scope) sees no balances or day book', () => {
    const v = render({ perms: ['expense_viewer'] });
    expect(v.el.querySelectorAll('.pf-hb-btn--primary').length).toBe(0);
    expect(v.el.querySelector('.pf-bottombar')).toBeNull();
    expect(v.el.querySelector('.pf-xt__tabs')).toBeNull();          // one tab: All expenses (read-only)
    expect(v.c.tab()).toBe('all');
    expect(svc['book']).toHaveBeenCalledWith(expect.objectContaining({ mine: false }));
    expect(v.c.entryCols().some((c: any) => c.colId === 'actions')).toBe(false);
    TestBed.resetTestingModule();

    const m = render({ perms: ['expense_modifier'], book: bookOf({ scope: 'own', opening: null, closing: null }) });
    expect(m.el.querySelectorAll('.pf-hb-btn--primary').length).toBe(1);
    expect(m.c.tab()).toBe('mine');
    expect(m.el.querySelector('.pf-xt__tabs')).toBeNull();
    expect(m.el.querySelector('.pf-day-closing, pf-day-closing')).toBeNull();
    const stats = [...m.el.querySelectorAll('.pf-xt__statk')].map(s => s.textContent?.trim());
    expect(stats).toEqual(['Cash in', 'Expenses']);
    expect(m.el.querySelector('.pf-xt__view')).toBeNull();
    expect(m.el.querySelector('.pf-xt__managecats')).toBeNull();
  });

  it('filters reload from the server; the band search narrows the loaded entries', () => {
    const { f, c } = render();
    svc['book'].mockClear();
    c.kind.set('cash_in'); c.categoryId.set('c1'); c.mode.set('cash');
    f.detectChanges();
    expect(svc['book']).toHaveBeenLastCalledWith({ from: labDaysAgo(6), to: labToday(), categoryId: 'c1', kind: 'cash_in', mode: 'cash', mine: true });
    c.setQuick('today');
    f.detectChanges();
    expect(svc['book']).toHaveBeenLastCalledWith(expect.objectContaining({ from: labToday(), to: labToday() }));
    c.q.set('float');
    expect(c.visibleEntries().map((e: ExpenseEntry) => e.id)).toEqual(['x2']);
    expect(searchExpenses(bookOf().entries, 'ravi').map(e => e.id)).toEqual(['x1']);
  });

  it('day book: admin actions follow the lock; close / reopen go to Day closing', async () => {
    const { f, el, c } = render();
    c.setTab('all');
    f.detectChanges();
    c.view.set('days');
    const actions = c.dayCols().find((col: any) => col.colId === 'actions');
    const html = (d: any) => actions.cellRenderer({ data: d }) as string;
    const [today, closed] = bookOf().days;
    expect(html(today)).toContain('data-act="close"');
    expect(html(today)).toContain('data-act="opening"');
    expect(html(closed)).toContain('data-act="reopen"');
    expect(html(closed)).not.toContain('data-act="close"');
    expect(html(closed)).not.toContain('data-act="opening"');

    const btn = (act: string) => { const b = document.createElement('button'); b.dataset['act'] = act; return b; };
    // Close / Reopen open THE day-close (owner 2026-11-21: one day-close) — the same screen and record as
    // Finance → Daily statement — on that day; the expense-book-only close is never called.
    c.onDayClicked({ data: closed, event: { target: btn('reopen') } });
    f.detectChanges();
    expect(router.navigate).toHaveBeenLastCalledWith(['/finance/daily'], { queryParams: { date: closed.date } });
    expect(c.tab()).toBe('all');
    expect(c.closingDate()).toBe(closed.date);
    expect(el.querySelector('pf-day-closing')).toBeNull();
    expect(svc['closeDay']).not.toHaveBeenCalled();
    c.onDayClicked({ data: today, event: { target: btn('close') } });
    expect(router.navigate).toHaveBeenLastCalledWith(['/finance/daily'], { queryParams: { date: today.date } });
    expect(c.closingDate()).toBe(today.date);
    // The Day closing tab opens it too, and a restored 'closing' tab never strands the screen on an empty body.
    c.setTab('closing');
    expect(router.navigate).toHaveBeenCalledTimes(3);
    c['tabPick'].set('closing');
    expect(c.tab()).toBe('mine');
    dialogs.prompt.mockResolvedValueOnce('2500.50');
    await c.setOpening(today);
    expect(svc['setOpening']).toHaveBeenCalledWith(today.date, 2500.5);
    dialogs.prompt.mockResolvedValueOnce('');
    await c.setOpening(today);
    expect(svc['setOpening']).toHaveBeenLastCalledWith(today.date, null);
  });

  it('a viewer sees only the Entries jump in the day book', () => {
    const { c } = render({ perms: ['expense_viewer'] });
    const actions = c.dayCols().find((col: any) => col.colId === 'actions');
    const out = actions.cellRenderer({ data: bookOf().days[0] }) as string;
    expect(out).toContain('data-act="entries"');
    expect(out).not.toContain('data-act="close"');
  });

  it('rows: Edit only where the server says canEdit; bills open the bills sheet; add opens the dialog', () => {
    const { f, el, c } = render();
    const actions = c.entryCols().find((col: any) => col.colId === 'actions');
    expect(actions.cellRenderer({ data: entry() })).toContain('data-act="edit"');
    expect(actions.cellRenderer({ data: entry({ canEdit: false }) })).toBe('');
    const withBill = entry({ attachments: [{ id: 'a1', fileName: 'bill.jpg', contentType: 'image/jpeg', sizeBytes: 10, url: 'https://x/bill.jpg', uploadedAt: '' }] });
    const btn = document.createElement('button'); btn.dataset['act'] = 'bills';
    c.onEntryClicked({ data: withBill, event: { target: btn } });
    f.detectChanges();
    expect(document.body.textContent).toContain('bill.jpg');
    c.billsFor.set(null);
    (el.querySelector('.pf-hb-btn--primary') as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.dialog()).toEqual({ entry: null, kind: 'expense', date: null });
  });

  it('admin manages categories: add, switch off (confirmed)', async () => {
    const { c } = render();
    c.newCat.set('Generator diesel');
    await c.createCategory();
    expect(svc['createCategory']).toHaveBeenCalledWith('Generator diesel');
    expect(c.categories().some((x: any) => x.name === 'Generator diesel')).toBe(true);
    await c.toggleCategoryActive(c.categories()[0]);
    expect(dialogs.confirm).toHaveBeenCalled();
    expect(svc['updateCategory']).toHaveBeenCalledWith('c1', { isActive: false });
  });

  it('exports the filtered range as CSV', () => {
    const { c } = render();
    (URL as any).createObjectURL = vi.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = vi.fn();
    c.exportCsv();
    expect(svc['exportCsv']).toHaveBeenCalledWith({ from: labDaysAgo(6), to: labToday(), categoryId: null, kind: null, mode: null, mine: true });
  });

  it('tabs: All expenses reloads everyone\'s book; the phone bar carries the ONE primary + Snap bill', () => {
    const { f, el, c } = render();
    svc['book'].mockClear();
    c.setTab('all');
    f.detectChanges();
    expect(svc['book']).toHaveBeenLastCalledWith(expect.objectContaining({ mine: false }));
    // Phone bottom bar (ND .pf-bottombar): info + Snap bill (rear camera) + Add expense.
    const bar = el.querySelector('.pf-bottombar')!;
    expect(bar.querySelectorAll('.pf-btn--primary').length).toBe(1);
    expect(bar.querySelector('input[type="file"]')?.getAttribute('capture')).toBe('environment');
    expect(bar.textContent).toContain('7 days');
    const file = new File(['x'], 'bill.jpg', { type: 'image/jpeg' });
    c.snapBill({ target: { files: [file], value: 'C:/bill.jpg' } } as any);
    expect(c.dialog()).toEqual({ entry: null, kind: 'expense', date: null, files: [file] });
  });

  it('labels IST days', () => {
    expect(dayLabel('2026-09-29')).toBe('Tue, 29 Sep');
    expect(dayLabel('2026-09-29', false)).toBe('29 Sep');
  });

  it('every data column of the entries and day grids sorts and filters on its real value', () => {
    const { c } = render();
    const check = (cols: any[]) => {
      expect(cols.length).toBeGreaterThan(2);
      for (const col of cols) {
        if (col.colId === 'actions') { expect(col.sortable).toBe(false); continue; }
        expect(sortsAndFilters(col), col.colId).toBe(true);
      }
    };
    check(c.entryCols());
    check(c.dayCols());
    const amount = c.entryCols().find((col: any) => col.colId === 'amount');
    expect(amount.valueGetter({ data: { kind: 'expense', amount: 40 } })).toBe(-40);
    expect(amount.valueGetter({ data: { kind: 'cash_in', amount: 40 } })).toBe(40);
  });
});
