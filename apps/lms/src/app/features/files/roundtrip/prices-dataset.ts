import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TestPricingService } from '../../../core/services/test-pricing.service';
import { TEST_PRICING_PERMS } from '../../../core/auth/route-access';
import { Test } from '../../../shared/models/test.model';
import { PriceWriteItem, TENANT_PRICE_SCOPE, effectivePrice, isOffered } from '../../../shared/utils/test-pricing';
import { isPackage, shownDepartmentName } from '../../../shared/utils/package-department';
import { testListUrl } from '../../../shared/utils/test-list-url';
import { SheetChange, SheetColumn, SheetDataset, SheetLoad } from './sheet-roundtrip';

/** One Test Master price row (the base price of a test / profile / package; specimen prices stay in the Pricing grid). */
export interface PriceSheetRow { id: string; code: string; name: string; department: string; type: 'Test' | 'Profile' | 'Package'; offered: boolean; price: number }

export const PRICES_DATASET_ID = 'tm-prices';

/** Rows of `GET /api/tests` (summary) → price rows. The key is the Test Master test code (`testCode`, unique per lab; older rows: `code`). A test with no code cannot be matched back, so it is left out. Same reading as the Pricing grid. */
export function priceRows(list: Test[]): PriceSheetRow[] {
  return (list ?? [])
    .map(t => ({ t, code: (t.testCode || t.code || '').trim() }))
    .filter(x => !!x.code)
    .map(({ t, code }) => ({
      id: t.id,
      code,
      name: t.name,
      department: shownDepartmentName(t) || (isPackage(t) ? 'Package' : 'No department'),
      type: isPackage(t) || t.type === 'package' ? 'Package' as const : t.type === 'profile' ? 'Profile' as const : 'Test' as const,
      offered: isOffered(t),
      price: effectivePrice(t),
    }))
    .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
}

/** The changes → the Pricing grid's batch rows (the SAME shape `PricingComponent.save` sends): price only when it changed, isOffered only when it changed. */
export function priceWrites(changes: SheetChange<PriceSheetRow>[]): PriceWriteItem[] {
  return changes.map(ch => {
    const u: PriceWriteItem = { testId: ch.row.id };
    for (const f of ch.fields) {
      if (f.key === 'price' && typeof f.after === 'number') u.price = f.after;
      if (f.key === 'offered' && typeof f.after === 'boolean') u.isOffered = f.after;
    }
    return u;
  }).filter(u => u.price !== undefined || u.isOffered !== undefined);
}

/** The branch the batch write names: the file's scope when it is a branch, none for the lab-wide price (same rule as the grid's `writeBranchId`). */
export function priceWriteBranch(scope: string): string | null {
  return scope && scope !== TENANT_PRICE_SCOPE ? scope : null;
}

/** Headline counts. */
export function priceSummary(changes: SheetChange<PriceSheetRow>[]): string[] {
  const n = (k: string, f?: (v: unknown) => boolean) => changes.filter(c => c.fields.some(x => x.key === k && (!f || f(x.after)))).length;
  const prices = n('price'), off = n('offered', v => v === false), on = n('offered', v => v === true);
  const out: string[] = [];
  if (prices) out.push(`${prices} price${prices === 1 ? '' : 's'} change${prices === 1 ? 's' : ''}`);
  if (off) out.push(`${off} test${off === 1 ? '' : 's'} switched off`);
  if (on) out.push(`${on} test${on === 1 ? '' : 's'} switched on`);
  return out;
}

export const PRICE_COLUMNS: SheetColumn<PriceSheetRow>[] = [
  { key: 'code', header: 'Code', type: 'text', width: 12, get: r => r.code },
  { key: 'name', header: 'Test', type: 'text', width: 40, get: r => r.name },
  { key: 'department', header: 'Department', type: 'text', width: 22, get: r => r.department },
  { key: 'type', header: 'Type', type: 'text', width: 10, get: r => r.type },
  { key: 'offered', header: 'Offered', type: 'yesno', editable: true, required: true, width: 10, get: r => r.offered },
  { key: 'price', header: 'Price (₹)', type: 'money', editable: true, required: true, width: 13, get: r => r.price },
];

/**
 * Test Master prices as a sheet round-trip dataset. Loads through the Pricing grid's list read (`GET /api/tests` summary with the
 * scope's `branchId`), applies through {@link TestPricingService.save} (`PATCH /api/tests/prices/bulk`, the grid's payload and
 * branch rule — the server checks the pricing permission and writes its usual audit row).
 */
@Injectable({ providedIn: 'root' })
export class PricesSheetDataset implements SheetDataset<PriceSheetRow> {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly pricing = inject(TestPricingService);

  readonly id = PRICES_DATASET_ID;
  readonly sheetName = 'Prices';
  readonly keyColumn = 'code';
  readonly columns = PRICE_COLUMNS;

  label(r: PriceSheetRow): string { return `${r.name} (${r.code})`; }
  canApply(): boolean { return typeof this.auth.hasAnyPermission === 'function' && this.auth.hasAnyPermission(TEST_PRICING_PERMS); }
  summary(changes: SheetChange<PriceSheetRow>[]): string[] { return priceSummary(changes); }
  fileName(scopeName: string, today: string): string { return `Prices – ${scopeName} – ${today}.xlsx`; }

  async load(scope: string): Promise<SheetLoad<PriceSheetRow>> {
    const list = await firstValueFrom(this.api.get<Test[]>(testListUrl({ branchId: scope || null })));
    return { rows: priceRows(list ?? []) };
  }

  async apply(scope: string, changes: SheetChange<PriceSheetRow>[]): Promise<void> {
    const items = priceWrites(changes);
    if (!items.length) return;
    await firstValueFrom(this.pricing.save(items, priceWriteBranch(scope)));
  }
}

/** One price a rate-card read suggested (from a Pending `price` proposal). */
export interface RateCardPrice { testId: string; price: number }

/**
 * Where rate-card prices go in an open price sheet: `values` = the engine's `sheet.read` of the Prices sheet (row 1 = headers, starting at A1),
 * `rows` = the dataset's current rows (test id → code). Returns the Price cells to write and how many prices found no row in the sheet.
 */
export function rateCardCells(values: unknown[][], rows: PriceSheetRow[], prices: RateCardPrice[]): { cells: { cell: string; input: string }[]; missing: number } {
  const head = (values[0] ?? []).map(h => String(h ?? '').trim().toLowerCase());
  const codeAt = head.indexOf('code'), priceAt = head.indexOf(PRICE_COLUMNS[5].header.toLowerCase());
  const codeOf = new Map(rows.map(r => [r.id, r.code.toUpperCase()]));
  const line = new Map<string, number>();
  if (codeAt >= 0) for (let i = 1; i < values.length; i++) {
    const c = String(values[i]?.[codeAt] ?? '').trim().toUpperCase();
    if (c && !line.has(c)) line.set(c, i + 1);
  }
  const cells: { cell: string; input: string }[] = [];
  let missing = 0;
  const done = new Set<number>();
  for (const p of prices) {
    const code = codeOf.get(p.testId);
    const at = code ? line.get(code) : undefined;
    if (priceAt < 0 || at === undefined || !Number.isFinite(p.price) || p.price < 0) { missing++; continue; }
    if (done.has(at)) continue;
    done.add(at);
    cells.push({ cell: `${String.fromCharCode(65 + priceAt)}${at}`, input: String(Math.round(p.price * 100) / 100) });
  }
  return { cells, missing };
}
