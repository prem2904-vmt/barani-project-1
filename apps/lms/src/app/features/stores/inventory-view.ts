/**
 * Pure view helpers shared by the Stores desk (`features/stores`) and Admin →
 * Inventory (`features/admin/inventory`). No API calls here — only how a
 * stock row, a ledger entry or a barcode link is SHOWN / shaped, so both
 * screens read one rule.
 */

export type StockLevel = 'ok' | 'low' | 'out';
/** `.nd-sdot` tones: '' neutral · done violet · warn amber · bad red. */
export type DotTone = '' | 'done' | 'warn' | 'bad';

export interface StockLike { onHand: number; reorderLevel: number; lowStock?: boolean }

/** Out = nothing on hand; Low = at / under the reorder level (or the server's
 *  lowStock flag); otherwise in stock.
 *
 *  Contract (Inventory Phase 1 fix 6/7): `onHand` is the SERVER's figure
 *  (`InventoryController.Items`/`Alerts`), which already excludes expired lots
 *  (IST end-of-day boundary — `InventoryService.ExpiryCutoffUtc`) before
 *  summing. An item whose only stock has expired therefore reports
 *  `onHand: 0` and reads 'out' here — never recompute on-hand client-side
 *  from the raw batches list (that would re-introduce a second, un-synced
 *  "is this lot usable" rule). */
export function stockLevel(it: StockLike): StockLevel {
  if (it.onHand <= 0) return 'out';
  if (it.lowStock || it.onHand <= it.reorderLevel) return 'low';
  return 'ok';
}

export const STOCK_LEVEL_LABEL: Record<StockLevel, string> = { ok: 'In stock', low: 'Low', out: 'Out of stock' };
export const STOCK_LEVEL_TONE: Record<StockLevel, DotTone> = { ok: '', low: 'warn', out: 'bad' };

/** Near-expiry alert line: expired lots read red, the rest amber. */
export function expiryView(daysLeft: number): { label: string; tone: DotTone } {
  if (daysLeft < 0) return { label: 'Expired', tone: 'bad' };
  if (daysLeft === 0) return { label: 'Expires today', tone: 'warn' };
  return { label: daysLeft === 1 ? '1 day left' : `${daysLeft} days left`, tone: 'warn' };
}

/** The server's inventory transaction types, in words. */
const LEDGER_WORDS: Record<string, string> = {
  receipt: 'Received', consumption: 'Used', adjustment: 'Adjusted', wastage: 'Written off', count: 'Counted',
};
export function ledgerWord(type: string | null | undefined): string {
  const t = (type ?? '').toLowerCase();
  return LEDGER_WORDS[t] ?? (t ? t[0].toUpperCase() + t.slice(1) : 'Change');
}

/** "+50" / "−2" (a real minus sign) for a ledger delta. */
export function signedQty(delta: number): string {
  const n = Math.round(delta * 100) / 100;
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

/** How many more tests this branch's stock covers at `qtyPerTest` each
 *  (null when it can't be said: no item / no quantity). */
export function testsCovered(onHand: number | null | undefined, qtyPerTest: number | null | undefined): number | null {
  if (onHand == null || !qtyPerTest || qtyPerTest <= 0) return null;
  return Math.max(0, Math.floor(onHand / qtyPerTest));
}

/** The code to LINK for an unknown scan: a GS1 scan's GTIN (what the server
 *  matches item barcodes against first), otherwise the raw code read. */
export function linkableCode(raw: string, parsed?: { gtin?: string | null } | null): string {
  const g = parsed?.gtin?.trim();
  return g ? g : raw.trim();
}

export interface InvItemFull {
  id: string; sku: string; barcode?: string | null; name: string; category?: string | null; uom: string;
  reorderLevel: number; nearExpiryDays?: number; isActive?: boolean;
}

/** `POST /api/inventory/items` body that keeps every field of `item` and sets
 *  its barcode to `code` (the server's SaveItem upsert; it rejects a barcode
 *  already on another item with `duplicate_barcode`). */
export function linkBarcodeBody(item: InvItemFull, code: string) {
  return {
    id: item.id, sku: item.sku, barcode: code, name: item.name, category: item.category ?? 'consumable',
    uom: item.uom, reorderLevel: item.reorderLevel, nearExpiryDays: item.nearExpiryDays ?? 30,
    isActive: item.isActive ?? true,
  };
}

/** A grid cell with the item name on top and a quiet meta line (SKU ·
 *  category) — built with textContent, never innerHTML. */
export function itemCell(name: string, meta: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'inv-cell';
  const n = document.createElement('span');
  n.className = 'inv-cell__name';
  n.textContent = name;
  wrap.appendChild(n);
  if (meta) {
    const m = document.createElement('span');
    m.className = 'inv-cell__meta nd-num';
    m.textContent = meta;
    wrap.appendChild(m);
  }
  return wrap;
}

/** A grid status cell: the kit's dot + neutral word. */
export function dotCell(label: string, tone: DotTone): HTMLElement {
  const s = document.createElement('span');
  s.className = 'nd-sdot';
  if (tone) s.setAttribute('data-tone', tone);
  s.textContent = label;
  return s;
}

/** Quantity with up to two decimals and no trailing zeros ("12.5", "3"). */
export function qty(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return (Math.round(v * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
