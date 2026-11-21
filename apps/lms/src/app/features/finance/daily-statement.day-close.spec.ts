import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DailyStatementComponent } from './daily-statement.component';
import { renderBandPage } from '../admin/admin-band.spec-helpers';
import { DialogService } from '../../core/services/dialog.service';
import { DayClosing, DayClosingFigures } from '../../shared/models/expense.model';
import { labToday } from '../../shared/utils/lab-clock';

/**
 * THE day-close (owner 2026-11-21: one day-close per branch per day). Finance → Daily statement and Expenses → Day
 * closing open this one screen on the one record: the whole day carries the shared day-close view (`dayClose`) —
 * cash expenses + top-ups in the expected cash, staff expenses, the first float, who closed it, Reopen (permission),
 * and a legacy expense-book close read for history.
 */
const TODAY = labToday();
const figures = (over: Partial<DayClosingFigures> = {}): DayClosingFigures => ({
  version: 2, date: TODAY, opening: 0, openingSource: 'none', openingFrom: null,
  collections: [{ mode: 'cash', count: 2, total: 500 }, { mode: 'upi', count: 1, total: 300 }],
  collectionBuckets: { cash: 500, upi: 300, card: 0, other: 0 }, totalCollected: 800, cashCollected: 500,
  refunds: [{ mode: 'cash', count: 1, total: 20 }], totalRefunded: 20, cashRefunded: 20,
  billed: { bills: 2, grossBilled: 850, discount: 50, tax: 0 }, activity: { patients: 2, orders: 2, tests: 5 },
  expenses: { count: 2, expenses: 100, cashIn: 30, cashExpenses: 70, cashTopUps: 30, byMode: [],
    byPerson: [{ userId: 'u1', name: 'Asha R', count: 2, expenses: 100, cashIn: 30, cashExpenses: 70 }] },
  expectedCash: 440,
  ...over,
});
const dayClose = (over: Partial<DayClosing> = {}): DayClosing => ({
  date: TODAY, today: TODAY, isClosed: false, canClose: true, canReopen: false, fromSnapshot: false, figures: figures(), source: null, ...over,
});
const stmt = (over: Record<string, unknown> = {}, dc: Partial<DayClosing> = {}) => ({
  date: TODAY, shift: null, openingBalance: 0, openingSource: 'none', openingFrom: null,
  payments: [{ mode: 'cash', count: 2, total: 500 }, { mode: 'upi', count: 1, total: 300 }], refunds: [{ mode: 'cash', count: 1, total: 20 }],
  totalCollected: 800, totalRefunded: 20, net: 780, cashCollected: 500, cashRefunded: 20, cashExpenses: 70, cashTopUps: 30,
  expectedCash: 440, closure: null, dayClose: dayClose(dc), ...over,
});
const closure = (o: Record<string, unknown> = {}) => ({
  id: 'c1', date: TODAY, shift: null, openingBalance: 0, expectedCash: 440, countedCash: 430, variance: -10, note: 'Coins short',
  closedBy: 'u9', closedAt: new Date().toISOString(), totalsJson: JSON.stringify({ payments: [], refunds: [] }), ...o,
});

function make(s: unknown, opts: { confirm?: boolean; query?: Record<string, string> } = {}) {
  const confirm = vi.fn(async () => opts.confirm ?? true);
  const providers: unknown[] = [{ provide: DialogService, useValue: { confirm, prompt: vi.fn(async () => null) } }];
  if (opts.query) providers.push({ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(opts.query) } } });
  const p = renderBandPage(DailyStatementComponent, { getFor: (url) => (url.startsWith('/api/finance/daily') ? s : []), providers });
  const input = (id: string) => p.el.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
  const type = (id: string, v: string) => { const i = input(id); i.value = v; i.dispatchEvent(new Event('input')); p.f.detectChanges(); };
  return { ...p, confirm, input, type };
}

describe('Daily statement — the one day-close', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('expected cash takes the staff cash expenses and top-ups; the cashier sees who spent what', () => {
    const p = make(stmt());
    expect(p.el.querySelector('[data-testid="closing-expected"]')!.textContent).toContain('₹440.00');   // 0 + 500 − 20 − 70 + 30
    const ex = p.el.querySelector('[data-testid="closing-expenses"]')!.textContent!;
    expect(ex).toContain('Asha R');
    expect(ex).toContain('− ₹70.00');
    expect(ex).toContain('+ ₹30.00');
    expect(p.el.textContent).toContain('Orders · tests');
  });

  it('a fresh cash box asks for the float; it feeds expected and is posted with the count', async () => {
    const p = make(stmt());
    expect(p.input('closing-opening')).not.toBeNull();
    p.type('closing-opening', '1,000');
    expect(p.cmp.expected()).toBe(1440);
    p.type('closing-count', '1440');
    expect(p.cmp.canClose()).toBe(true);
    p.api.post.mockReturnValueOnce(of(closure({ countedCash: 1440, variance: 0, openingBalance: 1000, expectedCash: 1440 })));
    await p.cmp.closeDay();
    expect(p.api.post).toHaveBeenCalledWith('/api/finance/close', expect.objectContaining({ date: TODAY, shift: null, openingBalance: 1000, countedCash: 1440 }));
  });

  it('a bad float keeps Close day off', () => {
    const q = make(stmt());
    q.type('closing-opening', 'abc');
    q.type('closing-count', '440');
    expect(q.cmp.canClose()).toBe(false);
  });

  it('no float field once an earlier closing carries the opening', () => {
    const p = make(stmt({ openingBalance: 975, openingSource: 'previous_closure', openingFrom: '2026-11-20', expectedCash: 1415 },
      { figures: figures({ opening: 975, openingSource: 'previous_closure', openingFrom: '2026-11-20' }) }));
    expect(p.input('closing-opening')).toBeNull();
    expect(p.el.textContent).toContain('From 20 Nov closing');
  });

  it('closed at Expenses → shown closed here with who closed it; Reopen (permission) posts the shared reopen', async () => {
    const p = make(stmt({ closure: closure() }, { isClosed: true, canReopen: true, canClose: false, source: 'day_close', closedByName: 'Kavya', countedCash: 430, variance: -10 }));
    expect(p.cmp.closed()).toBe(true);
    expect(p.el.querySelector('[data-testid="closing-state"]')!.textContent).toContain('Closed');
    expect(p.input('closing-count').disabled).toBe(true);
    expect(p.el.querySelector('[data-testid="closing-help"]')!.textContent).toContain('by Kavya');
    expect(p.el.querySelector('[data-testid="close-day"]')).toBeNull();
    const reopen = p.el.querySelector<HTMLButtonElement>('[data-testid="closing-reopen"]')!;
    expect(reopen).not.toBeNull();
    p.api.post.mockReturnValueOnce(of(stmt()));
    await p.cmp.reopenDay();
    expect(p.confirm).toHaveBeenCalled();
    expect(p.api.post).toHaveBeenCalledWith(`/api/finance/closures/${TODAY}/reopen`, {});
    p.f.detectChanges();
    expect(p.cmp.closed()).toBe(false);
  });

  it('no Reopen without the permission (the server says canReopen: false)', () => {
    const p = make(stmt({ closure: closure() }, { isClosed: true, canReopen: false, source: 'day_close' }));
    expect(p.el.querySelector('[data-testid="closing-reopen"]')).toBeNull();
  });

  it('cancelling the reopen confirm posts nothing', async () => {
    const q = make(stmt({ closure: closure() }, { isClosed: true, canReopen: true, source: 'day_close' }), { confirm: false });
    await q.cmp.reopenDay();
    expect(q.api.post).not.toHaveBeenCalled();
  });

  it('a legacy expense-book close is read for history: closed, no count, its note', () => {
    const p = make(stmt({ closure: null }, { isClosed: true, canReopen: true, source: 'expense_book', note: 'Old book close', closedByName: 'Admin' }));
    expect(p.cmp.closed()).toBe(true);
    expect(p.cmp.bookClosed()).toBe(true);
    expect(p.input('closing-count').value).toBe('');
    expect(p.el.querySelector('[data-testid="closing-summary"]')!.textContent).toContain('No cash count');
    expect(p.el.querySelector<HTMLTextAreaElement>('[data-testid="closing-note"]')!.value).toBe('Old book close');
    expect(p.el.querySelector('[data-testid="closing-help"]')!.textContent).toContain('expense book');
  });

  it('Expenses → Day closing opens it on the asked day (?date=)', () => {
    const day = '2026-11-02';
    const p = make(stmt({ date: day }, { date: day }), { query: { date: day } });
    expect(p.cmp.dateStr()).toBe(day);
    expect(p.api.get.mock.calls.some((c: unknown[]) => String(c[0]) === `/api/finance/daily?date=${day}`)).toBe(true);
  });

  it('a future ?date= is ignored', () => {
    const q = make(stmt(), { query: { date: '2999-01-01' } });
    expect(q.cmp.dateStr()).toBe(TODAY);
  });

  it('an older server (no dayClose) keeps the statement exactly as before', () => {
    const p = make(stmt({ dayClose: undefined, openingSource: undefined, openingBalance: 100, expectedCash: 580 }));
    expect(p.el.querySelector('[data-testid="closing-expenses"]')).toBeNull();
    expect(p.input('closing-opening')).toBeNull();
    expect(p.cmp.expected()).toBe(580);
  });
});
