/**
 * Test pricing, single source (Test Master plan, phase 2).
 *
 * A test's price lives ONLY in the per-tenant pricing table. The test DTOs
 * (lists, picker, single test) carry the EFFECTIVE price for the acting
 * branch in `price` / `discount` / `taxSlab`, plus:
 *   - `priceIsDefault`: nobody has priced this test yet, so it bills at the
 *     ₹1 default and the UI shows the quiet "₹1 · not priced yet" marker;
 *   - `isOffered`: false = hidden from ordering at this tenant/branch.
 *
 * Writes go ONLY through `PATCH /api/tests/prices/bulk` (see
 * {@link priceBulkBody}); a test create/update never carries a price.
 *
 * Pure helpers, no Angular: the admin console keeps a byte-identical copy.
 */

/** Every test bills at ₹1 until the tenant (or branch) prices it. */
export const DEFAULT_TEST_PRICE = 1;

/** The owner-approved wording of the "still at the default" marker. */
export const NOT_PRICED_LABEL = '₹1 · not priced yet';

/** The price-bearing slice of a test DTO. Loose on purpose: callers pass
 *  full `Test` rows, grid rows and picker rows alike. */
export interface PricedTestLike {
  price?: number | string | null;
  taxSlab?: number | string | null;
  priceIsDefault?: boolean | null;
  isOffered?: boolean | null;
}

/** One row of the bulk price write. Absent fields are left unchanged by the
 *  server (a row may carry only `isOffered`: hiding never prices a test). */
export interface PriceWriteItem {
  testId: string;
  price?: number;
  discount?: number;
  taxSlab?: number;
  isOffered?: boolean;
}

/** Body of `PATCH /api/tests/prices/bulk`. `branchId` is sent only when the
 *  tenant runs branch isolation and a specific branch is being priced; no
 *  `branchId` = the tenant price (isolation OFF: the one price for every
 *  branch; ON: the "All branches" default every branch inherits). */
export interface PriceBulkBody {
  updates: PriceWriteItem[];
  branchId?: string;
}

function hasNumber(v: unknown): boolean {
  if (v == null || v === '') return false;
  return Number.isFinite(Number(v));
}

/** True when this test still bills at the ₹1 default. The server's
 *  `priceIsDefault` is authoritative; a row with no price at all (an older
 *  payload) is treated as the default too. */
export function isPriceDefault(t: PricedTestLike | null | undefined): boolean {
  if (!t) return false;
  if (t.priceIsDefault === true) return true;
  if (t.priceIsDefault === false) return false;
  return !hasNumber(t.price);
}

/** The price to show and to total: the DTO price, or ₹1 when none is set. */
export function effectivePrice(t: PricedTestLike | null | undefined): number {
  if (!t) return 0;
  return hasNumber(t.price) ? Number(t.price) : DEFAULT_TEST_PRICE;
}

/** Orderable here? Only an explicit `isOffered: false` hides a test. */
export function isOffered(t: PricedTestLike | null | undefined): boolean {
  return !!t && t.isOffered !== false;
}

/** The test's GST slab in percent (0 when unset or garbage). */
export function taxSlabOf(t: PricedTestLike | null | undefined): number {
  const n = Number(t?.taxSlab);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Round to paise the way .NET's `decimal.Round(x, 2)` does (banker's:
 *  a midpoint goes to the even paisa), tolerant of float noise. */
export function roundPaiseHalfEven(n: number): number {
  const v = (Number(n) || 0) * 100;
  const f = Math.floor(v);
  const diff = v - f;
  let paise: number;
  if (Math.abs(diff - 0.5) < 1e-7) paise = f % 2 === 0 ? f : f + 1;
  else paise = Math.round(v);
  return paise / 100;
}

/** GST on one bill line, mirroring the backend's BillingCalculator for an
 *  intra-state bill: CGST and SGST are each half the slab and each rounded
 *  to paise (banker's rounding, as `decimal.Round`). */
export function lineGst(price: number, taxSlabPct: number): number {
  const taxable = roundPaiseHalfEven(Math.max(0, Number(price) || 0));
  const slab = Number(taxSlabPct) || 0;
  if (slab <= 0 || taxable <= 0) return 0;
  const half = roundPaiseHalfEven(taxable * (slab / 2) / 100);
  return round2(half * 2);
}

/** Build the bulk write body. Prices are rounded to paise and clamped at 0. */
export function priceBulkBody(items: PriceWriteItem[], branchId?: string | null): PriceBulkBody {
  const updates = items.map(i => {
    const row: PriceWriteItem = { testId: i.testId };
    if (i.price != null) row.price = round2(Math.max(0, Number(i.price) || 0));
    if (i.discount != null) row.discount = round2(Math.max(0, Number(i.discount) || 0));
    if (i.taxSlab != null) row.taxSlab = Math.max(0, Number(i.taxSlab) || 0);
    if (i.isOffered != null) row.isOffered = !!i.isOffered;
    return row;
  });
  return branchId ? { updates, branchId } : { updates };
}

/** The one bulk-write path. */
export const PRICE_BULK_PATH = '/api/tests/prices/bulk';

/** `branchId` query value that reads the TENANT price view ("All branches")
 *  instead of the acting branch's. */
export const TENANT_PRICE_SCOPE = '00000000-0000-0000-0000-000000000000';

/** The test-list URL for a pricing view: no scope = the acting branch
 *  (isolation OFF: the tenant price); a branch id = that branch;
 *  {@link TENANT_PRICE_SCOPE} = the tenant default. */
export function priceListUrl(scope?: string | null): string {
  return scope ? `/api/tests/?branchId=${encodeURIComponent(scope)}` : '/api/tests/';
}

/** Is this error the server refusing a test that isn't offered here
 *  (409 `not_offered`)? */
export function isNotOfferedError(e: unknown): boolean {
  const x = e as { code?: string; error?: unknown; status?: number } | null;
  if (!x) return false;
  if (x.code === 'not_offered' || x.error === 'not_offered') return true;
  const inner = x.error as { error?: string; code?: string } | undefined;
  return !!inner && typeof inner === 'object' && (inner.error === 'not_offered' || inner.code === 'not_offered');
}
