import {
  EXPENSE_PERMS, ExpenseEntry, cashVariance, expectedCash, expenseAbilities, expenseTabs, expenseHaystack, expenseKindLabel, expenseModeLabel, validExpenseAmount,
} from './expense.model';
import { ROUTE_ACCESS, canOpenRoute } from '../../core/auth/route-access';

/** The UI mirror of the server's ExpenseRules: abilities per permission,
 *  paise-exact amounts, labels, search haystack, and the route gate. */
describe('expense model', () => {
  const has = (...codes: string[]) => (c: string) => codes.includes(c);

  it('reads the three permissions like the server', () => {
    expect(expenseAbilities(has())).toEqual({ canOpen: false, seesAll: false, canAdd: false, isAdmin: false });
    expect(expenseAbilities(has('expense_viewer'))).toEqual({ canOpen: true, seesAll: true, canAdd: false, isAdmin: false });
    expect(expenseAbilities(has('expense_modifier'))).toEqual({ canOpen: true, seesAll: false, canAdd: true, isAdmin: false });
    expect(expenseAbilities(has('expense_admin'))).toEqual({ canOpen: true, seesAll: true, canAdd: true, isAdmin: true });
  });

  it('accepts only positive rupee amounts to the paisa, up to ₹1 crore', () => {
    for (const ok of [0.01, 1, 10.5, 99.99, 10_000_000]) expect(validExpenseAmount(ok)).toBe(true);
    for (const bad of [0, -1, 10.005, 10_000_000.01, NaN, null, undefined]) expect(validExpenseAmount(bad as number)).toBe(false);
  });

  it('labels modes and kinds', () => {
    expect(expenseModeLabel('upi')).toBe('UPI');
    expect(expenseModeLabel('bank')).toBe('Bank transfer');
    expect(expenseModeLabel('weird')).toBe('weird');
    expect(expenseKindLabel('cash_in')).toBe('Cash in');
    expect(expenseKindLabel('expense')).toBe('Expense');
  });

  it('searches item, category, vendor, notes, who and amount', () => {
    const e = { description: 'Toner', categoryName: 'Stationery', paidTo: 'Ravi Stores', notes: 'HP 88A', createdByName: 'Anand',
      paymentMode: 'upi', kind: 'expense', amount: 1250, date: '2026-09-30' } as ExpenseEntry;
    const hay = expenseHaystack(e).join(' ');
    for (const w of ['Toner', 'Stationery', 'Ravi Stores', 'HP 88A', 'Anand', 'UPI', '1250']) expect(hay).toContain(w);
  });

  it('opens /expenses for any of the three permissions only', () => {
    expect(ROUTE_ACCESS['/expenses'].perms).toEqual(EXPENSE_PERMS);
    for (const p of EXPENSE_PERMS) expect(canOpenRoute('/expenses', { hasAny: (list: string[]) => list.includes(p) })).toBe(true);
    expect(canOpenRoute('/expenses', { hasAny: (list: string[]) => list.includes('collect_payment') })).toBe(false);
  });

  it('tabs by permission: My expenses (enters), All expenses (sees all), Day closing (cashier)', () => {
    expect(expenseTabs(expenseAbilities(has('expense_modifier')))).toEqual(['mine']);
    expect(expenseTabs(expenseAbilities(has('expense_viewer')))).toEqual(['all']);
    expect(expenseTabs(expenseAbilities(has('expense_admin')))).toEqual(['mine', 'all', 'closing']);
    expect(expenseTabs(expenseAbilities(has('expense_viewer', 'expense_modifier')))).toEqual(['mine', 'all']);
    expect(expenseTabs(expenseAbilities(has()))).toEqual([]);
    expect(ROUTE_ACCESS['/expenses'].perms).toEqual(EXPENSE_PERMS);
  });

  it('mirrors the server drawer math: opening + cash in − refunds − cash expenses + top-ups; counted − expected', () => {
    expect(expectedCash(0, 500, 20, 70, 100)).toBe(510);
    expect(expectedCash(1000, 500, 20)).toBe(1480);
    expect(expectedCash(0.1, 0.2, 0)).toBe(0.3);
    expect(cashVariance(500, 510)).toBe(-10);
    expect(cashVariance(510.05, 510)).toBe(0.05);
  });
});
