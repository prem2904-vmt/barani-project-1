/**
 * Modify order (?editOrderId=): the cart must hold what was ORDERED — the
 * tests, profiles and packages picked at the desk — never a bundle's member
 * lines. An order line (`order_tests`) is always a LEAF test; the item it was
 * ordered through rides on `packageTestId` (the top-level package OR profile —
 * OrderService.ExpandBundleAsync stamps every leaf with its top-level bundle).
 * So the ordered item of a line is `packageTestId ?? testId`
 * (server twin: OrderRepeatItems.TopLevelIds / DuplicateItemRules.FindOnOrder).
 *
 * The edit cart used to be seeded with the leaf `testId`s, and the collected
 * set carried the leaf ids PLUS the package id. On a collected package order
 * the save re-added that package beside its own members, so the server
 * (correctly) refused the PATCH with duplicate_item — "“Haemoglobin” is
 * already included in “MHC”" — whatever test the user had actually added
 * (the owner's "I added Calcium and it says repeated test"). On an uncollected
 * one the package silently turned into loose tests at loose prices.
 */

/** The order-line shape this reads (GET /api/orders/{id} → samples[].tests[]). */
export interface OrderLineLike {
  testId?: string | null;
  packageTestId?: string | null;
  status?: string | null;
  test?: { id?: string | null } | null;
}

export interface OrderSampleLike {
  status?: string | null;
  collectedAt?: string | null;
  collectedBy?: string | null;
  tests?: readonly OrderLineLike[] | null;
}

export interface OrderLike {
  samples?: readonly OrderSampleLike[] | null;
}

/** The item a line was ordered through: its package/profile, else itself. */
export function orderedItemId(line: OrderLineLike): string | null {
  const id = line.packageTestId || line.testId || line.test?.id || null;
  return id ? String(id) : null;
}

/** Every ordered (top-level) item of the order, first-seen order, de-duplicated. */
export function orderedItemIds(order: OrderLike | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of order?.samples ?? []) for (const t of s.tests ?? []) {
    const id = orderedItemId(t);
    if (id && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

const PENDING = new Set(['pending', 'requested']);

/** Ordered items with at least one line already collected (its tube drawn or
 *  the line past pending) — they can't be removed from the edit cart. Keyed by
 *  the ORDERED item (never a member leaf), so re-adding them on save can never
 *  put a bundle beside its own members. */
export function collectedItemIds(order: OrderLike | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const s of order?.samples ?? []) {
    const sampleCollected = (!!s.status && !PENDING.has(s.status)) || !!s.collectedAt || !!s.collectedBy;
    for (const t of s.tests ?? []) {
      const lineCollected = sampleCollected || (!!t.status && !PENDING.has(t.status));
      const id = lineCollected ? orderedItemId(t) : null;
      if (id) out.add(id);
    }
  }
  return out;
}
