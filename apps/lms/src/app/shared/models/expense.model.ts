/**
 * Expense tracker (Finance → Expenses) — wire types + the UI mirror of the
 * server's ExpenseRules (prefrontal-mw Services/ExpenseBook.cs). The server
 * decides; these only shape the screen (which buttons show, labels, the
 * permission reading).
 */

export type ExpenseKind = 'expense' | 'cash_in';
export type ExpenseMode = 'cash' | 'upi' | 'card' | 'bank';

export const EXPENSE_VIEWER = 'expense_viewer';
export const EXPENSE_MODIFIER = 'expense_modifier';
export const EXPENSE_ADMIN = 'expense_admin';
export const EXPENSE_PERMS = [EXPENSE_VIEWER, EXPENSE_MODIFIER, EXPENSE_ADMIN];

export interface ExpenseAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  uploadedAt: string;
}

export interface ExpenseEntry {
  id: string;
  /** IST business date, yyyy-MM-dd. */
  date: string;
  kind: ExpenseKind;
  description: string;
  categoryId?: string | null;
  categoryName?: string | null;
  amount: number;
  paymentMode: ExpenseMode;
  paidTo?: string | null;
  notes?: string | null;
  branchName: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt?: string | null;
  /** The server's verdict for THIS user (owner / open day / permission). */
  canEdit: boolean;
  attachments: ExpenseAttachment[];
}

export interface ExpenseCategory {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface ExpenseDay {
  date: string;
  /** Absent for an own-entries-only view (no balances). */
  opening?: number | null;
  cashIn: number;
  expenses: number;
  closing?: number | null;
  isClosed: boolean;
  openingSet: boolean;
  entryCount: number;
  closedAt?: string | null;
  closedByName?: string | null;
  note?: string | null;
}

export interface ExpenseTotalRow { key: string; label: string; count: number; total: number; }

export interface ExpenseBook {
  from: string;
  to: string;
  today: string;
  /** 'all' = the whole branch book (viewer / admin); 'own' = the caller's entries only. */
  scope: 'all' | 'own';
  closedThrough?: string | null;
  days: ExpenseDay[];
  entries: ExpenseEntry[];
  truncated: boolean;
  totalExpenses: number;
  totalCashIn: number;
  opening?: number | null;
  closing?: number | null;
  byCategory: ExpenseTotalRow[];
  byMode: ExpenseTotalRow[];
}

export interface ExpenseFilter {
  from: string;
  to: string;
  categoryId?: string | null;
  kind?: ExpenseKind | null;
  mode?: ExpenseMode | null;
  /** "My expenses": only the caller's own entries, whatever else they may see. */
  mine?: boolean;
}

export interface ExpenseEntryInput {
  date: string;
  kind: ExpenseKind;
  description: string;
  categoryId: string | null;
  amount: number;
  paymentMode: ExpenseMode;
  paidTo: string | null;
  notes: string | null;
}

export const EXPENSE_MODES: ReadonlyArray<{ value: ExpenseMode; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
];

export function expenseModeLabel(mode: string | null | undefined): string {
  return EXPENSE_MODES.find(m => m.value === mode)?.label ?? (mode ?? '');
}

export function expenseKindLabel(kind: ExpenseKind): string {
  return kind === 'cash_in' ? 'Cash in' : 'Expense';
}

/** What the signed-in user may do in the tracker (mirrors the server gates). */
export interface ExpenseAbilities {
  canOpen: boolean;
  /** Whole branch book incl. balances (viewer or admin). */
  seesAll: boolean;
  canAdd: boolean;
  isAdmin: boolean;
}

export function expenseAbilities(has: (code: string) => boolean): ExpenseAbilities {
  const isAdmin = has(EXPENSE_ADMIN);
  const canAdd = isAdmin || has(EXPENSE_MODIFIER);
  const seesAll = isAdmin || has(EXPENSE_VIEWER);
  return { canOpen: canAdd || seesAll, seesAll, canAdd, isAdmin };
}

/** Rupees to the paisa, > 0, ≤ ₹1 crore — the server's NormaliseAmount. */
export function validExpenseAmount(n: number | null | undefined): boolean {
  if (n == null || !Number.isFinite(n) || n <= 0 || n > 10_000_000) return false;
  return Math.round(n * 100) / 100 === n;
}

/** Search haystack of an entry (item, category, vendor, notes, who, mode, amount). */
export function expenseHaystack(e: ExpenseEntry): Array<string | null | undefined> {
  return [e.description, e.categoryName, e.paidTo, e.notes, e.createdByName, expenseModeLabel(e.paymentMode),
    expenseKindLabel(e.kind), String(e.amount), e.date];
}

// ── Tabs: My expenses · All expenses · Day closing ─────────────────────────

/** mine = the caller's own entries (every expense_modifier / cashier);
 *  all = everyone's (viewer = read-only oversight, cashier edits);
 *  closing = the cashier's Day closing (expense_admin). */
export type ExpenseTab = 'mine' | 'all' | 'closing';

export function expenseTabs(a: ExpenseAbilities): ExpenseTab[] {
  const tabs: ExpenseTab[] = [];
  if (a.canAdd) tabs.push('mine');
  if (a.seesAll) tabs.push('all');
  if (a.isAdmin) tabs.push('closing');
  return tabs;
}

export const EXPENSE_TAB_LABEL: Record<ExpenseTab, string> = {
  mine: 'My expenses', all: 'All expenses', closing: 'Day closing',
};

// ── Day closing (the cashier) — wire types of GET /api/expenses/closing ────

export interface ModeTotalRow { mode: string; count: number; total: number; }

export interface DayClosingFigures {
  version: number;
  date: string;
  opening: number;
  /** previous_closure | entered | none | closure */
  openingSource: string;
  openingFrom?: string | null;
  collections: ModeTotalRow[];
  collectionBuckets: Record<'cash' | 'upi' | 'card' | 'other', number>;
  totalCollected: number;
  cashCollected: number;
  refunds: ModeTotalRow[];
  totalRefunded: number;
  cashRefunded: number;
  billed: { bills: number; grossBilled: number; discount: number; tax: number };
  activity: { patients: number; orders: number; tests: number };
  expenses: {
    count: number; expenses: number; cashIn: number; cashExpenses: number; cashTopUps: number;
    byMode: ModeTotalRow[];
    byPerson: Array<{ userId: string; name: string; count: number; expenses: number; cashIn: number; cashExpenses: number }>;
  };
  expectedCash: number;
}

export interface DayClosing {
  date: string;
  today: string;
  isClosed: boolean;
  canClose: boolean;
  canReopen: boolean;
  /** True when the figures are the snapshot frozen at close. */
  fromSnapshot: boolean;
  figures: DayClosingFigures;
  countedCash?: number | null;
  variance?: number | null;
  note?: string | null;
  closedAt?: string | null;
  closedByName?: string | null;
  lastClosed?: string | null;
}

export interface DayClosingCloseInput { countedCash: number; openingBalance?: number | null; note?: string | null; }

/** TS mirror of the server's CashDrawer.Expected: opening + cash collections −
 *  cash refunds − cash expenses + cash top-ups (only cash touches the drawer). */
export function expectedCash(opening: number, cashCollected: number, cashRefunded: number, cashExpenses = 0, cashTopUps = 0): number {
  return Math.round((opening + cashCollected - cashRefunded - cashExpenses + cashTopUps) * 100) / 100;
}

/** Counted − expected (negative = the drawer is short), to the paisa. */
export function cashVariance(counted: number, expected: number): number {
  return Math.round((counted - expected) * 100) / 100;
}

/** The expected cash of the figures, re-derived with an entered opening (a
 *  fresh cash box's first close) — the server applies the same rule. */
export function expectedWithOpening(f: DayClosingFigures, opening: number | null): number {
  const o = f.openingSource === 'none' && opening != null ? opening : f.opening;
  return expectedCash(o, f.cashCollected, f.cashRefunded, f.expenses.cashExpenses, f.expenses.cashTopUps);
}
