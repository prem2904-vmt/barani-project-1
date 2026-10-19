import type { OrderTest } from '../../../shared/models/order.model';

/**
 * Result entry on an OLD shared tube: a test that is outsourced (its Test
 * Master flag, or the tube itself routed to a partner lab) is never entered
 * here — it is shown read-only with an "Outsourced · <partner>" chip. The
 * backend refuses entry and skips it on a tube submit anyway.
 */
export function isOutsourcedLine(t: OrderTest, sampleVendorId?: string | null): boolean {
  return !!sampleVendorId || !!(t.test as { outsourcedVendorId?: string | null } | undefined)?.outsourcedVendorId;
}

export function splitOutsourced(tests: readonly OrderTest[], sampleVendorId?: string | null):
  { inHouse: OrderTest[]; outsourced: OrderTest[] } {
  const inHouse: OrderTest[] = [];
  const outsourced: OrderTest[] = [];
  for (const t of tests) (isOutsourcedLine(t, sampleVendorId) ? outsourced : inHouse).push(t);
  return { inHouse, outsourced };
}

export function outsourcedChip(t: OrderTest, names: Readonly<Record<string, string>>, sampleVendorId?: string | null): string {
  const id = (t.test as { outsourcedVendorId?: string | null } | undefined)?.outsourcedVendorId ?? sampleVendorId ?? null;
  const n = id ? names[id]?.trim() : '';
  return n ? `Outsourced · ${n}` : 'Outsourced';
}
