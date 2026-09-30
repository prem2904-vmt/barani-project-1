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
