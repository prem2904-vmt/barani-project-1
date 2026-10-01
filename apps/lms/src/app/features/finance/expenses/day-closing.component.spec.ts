import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { DayClosingComponent, parseRupees } from './day-closing.component';
import { ExpenseService } from '../../../core/services/expense.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { DayClosing, DayClosingFigures } from '../../../shared/models/expense.model';

/**
 * Expenses → Day closing (the cashier). The DAY card shows the server's
 * figures (collections by cash / UPI / card / other, refunds, discounts,
 * bills / orders / tests, every staff member's expenses); the CASH IN HAND
 * card derives expected cash with the TS mirror, counted → variance, and the
 * ONE primary "Close day" (confirmed through DialogService). Closed days show
 * the snapshot + Reopen when the server allows it.
 */
const figures = (over: Partial<DayClosingFigures> = {}): DayClosingFigures => ({
  version: 2, date: '2026-09-30', opening: 1000, openingSource: 'previous_closure', openingFrom: '2026-09-29',
  collections: [{ mode: 'cash', count: 3, total: 500 }, { mode: 'upi', count: 1, total: 300 }],
  collectionBuckets: { cash: 500, upi: 300, card: 200, other: 100 }, totalCollected: 1100, cashCollected: 500,
  refunds: [{ mode: 'cash', count: 1, total: 20 }], totalRefunded: 20, cashRefunded: 20,
  billed: { bills: 2, grossBilled: 1100, discount: 50, tax: 0 }, activity: { patients: 2, orders: 2, tests: 5 },
  expenses: { count: 3, expenses: 100, cashIn: 100, cashExpenses: 70, cashTopUps: 100, byMode: [],
    byPerson: [{ userId: 'u1', name: 'Asha R', count: 2, expenses: 100, cashIn: 0, cashExpenses: 70 }] },
  expectedCash: 1510,
  ...over,
});
const day = (over: Partial<DayClosing> = {}): DayClosing => ({
  date: '2026-09-30', today: '2026-09-30', isClosed: false, canClose: true, canReopen: false, fromSnapshot: false,
  figures: figures(), ...over,
});

describe('DayClosingComponent', () => {
  let svc: Record<string, ReturnType<typeof vi.fn>>;
  let confirm: ReturnType<typeof vi.fn>;

  function render(d: DayClosing = day()) {
    svc = {
      closing: vi.fn(() => of(d)),
      closeClosing: vi.fn(() => of(day({ isClosed: true, fromSnapshot: true, countedCash: 1500, variance: -10, canReopen: true, closedByName: 'Cashier' }))),
      reopenClosing: vi.fn(() => of(day())),
    };
    confirm = vi.fn(async () => true);
    TestBed.configureTestingModule({
      imports: [DayClosingComponent],
      providers: [
        { provide: ExpenseService, useValue: svc },
        { provide: DialogService, useValue: { confirm } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(DayClosingComponent, { set: { imports: [BusyDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    const f = TestBed.createComponent(DayClosingComponent);
    f.componentRef.setInput('date', '2026-09-30');
    f.componentRef.setInput('today', '2026-09-30');
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as DayClosingComponent };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('parses rupees to the paisa', () => {
    expect(parseRupees('1,510.50')).toBe(1510.5);
    expect(parseRupees('₹ 20')).toBe(20);
    expect(parseRupees('')).toBeNull();
    expect(parseRupees('-5')).toBeNull();
    expect(parseRupees('1.005')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
  });

  it('shows the day: collections by mode, refunds / discounts / orders, each staff member, the drawer sum', () => {
    const { el } = render();
    expect(svc['closing']).toHaveBeenCalledWith('2026-09-30');
    const tiles = [...el.querySelectorAll('.pf-dc__tile .pf-dc__k')].map(t => t.textContent?.trim());
    expect(tiles).toEqual(['Cash', 'UPI', 'Card', 'Other', 'Total collected']);
    expect(el.textContent).toContain('Discounts given');
    expect(el.textContent).toContain('Asha R');
    expect(el.querySelector('.pf-dc__eq')?.textContent).toContain('1,510');
    // One primary, disabled until the counted cash is entered; no native controls.
    const primary = el.querySelectorAll('.nd-btn--primary');
    expect(primary.length).toBe(1);
    expect((primary[0] as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelectorAll('select, datalist, input[type="date"]').length).toBe(0);
    // Opening came from the previous closure → no opening field.
    expect(el.querySelector('#pf-dc-open')).toBeNull();
  });

  it('counted cash → live variance → Close day (confirmed) sends counted + note, then shows the snapshot', async () => {
    const { f, el, c } = render();
    c.countedText.set('1,500');
    c.note.set('₹10 short');
    f.detectChanges();
    expect(c.variance()).toBe(-10);
    expect(el.querySelector('.pf-dc__var')?.textContent).toContain('short');
    expect((el.querySelector('.nd-btn--primary') as HTMLButtonElement).disabled).toBe(false);
    await c.close();
    expect(confirm).toHaveBeenCalled();
    expect(svc['closeClosing']).toHaveBeenCalledWith('2026-09-30', { countedCash: 1500, openingBalance: null, note: '₹10 short' });
    f.detectChanges();
    expect(c.data()!.isClosed).toBe(true);
    expect(el.textContent).toContain('Closed by Cashier');
    expect(el.querySelector('.nd-btn--primary')).toBeNull();
    expect(el.querySelector('.nd-btn--secondary')?.textContent).toContain('Reopen day');
  });

  it('a fresh cash box asks for the opening float and derives expected from it', async () => {
    const { f, el, c } = render(day({ figures: figures({ opening: 0, openingSource: 'none', openingFrom: null, expectedCash: 510 }) }));
    expect(el.querySelector('#pf-dc-open')).not.toBeNull();
    c.openingText.set('200');
    c.countedText.set('710');
    f.detectChanges();
    expect(c.expected()).toBe(710);   // 200 + 500 − 20 − 70 + 100
    expect(c.variance()).toBe(0);
    await c.close();
    expect(svc['closeClosing']).toHaveBeenCalledWith('2026-09-30', { countedCash: 710, openingBalance: 200, note: null });
  });

  it('reopen is confirmed and only offered when the server allows it', async () => {
    const closed = day({ isClosed: true, fromSnapshot: true, countedCash: 1510, variance: 0, canReopen: false, lastClosed: '2026-10-01' });
    const a = render(closed);
    expect(a.el.textContent).toContain('A later day is closed');
    expect(a.el.querySelector('.nd-btn')).toBeNull();
    TestBed.resetTestingModule();

    const b = render({ ...closed, canReopen: true, lastClosed: '2026-09-30' });
    await b.c.reopen();
    expect(confirm).toHaveBeenCalled();
    expect(svc['reopenClosing']).toHaveBeenCalledWith('2026-09-30');
  });
});
