/**
 * One order may not carry the same test twice through a bundle (owner rule):
 * a package together with any test/profile inside it, or a profile together
 * with any of its member tests. The cart refuses such an add up front with a
 * message naming both — it never silently drops or zero-prices a line — and
 * the server refuses the order with 400 `duplicate_item` as the backstop
 * (Prefrontal/Services/DuplicateItemRules.cs). Sibling bundles that merely
 * share a member are not refused (containment only, as on the server).
 */

/** The catalogue shape this needs: id, name, type and the bundle's items JSON. */
export interface CartCatalogItem {
  id: string;
  name: string;
  type?: string | null;
  parameters?: string | null;
}

export interface CartOverlap {
  /** The bundle that already contains the other item. */
  container: CartCatalogItem;
  /** The item inside it. */
  member: CartCatalogItem;
}

/** A bundle's authored member ids ({ items: [{ testId }] }); [] when not a bundle. */
export function bundleMemberIds(parametersJson: string | null | undefined): string[] {
  if (!parametersJson) return [];
  try {
    const parsed = JSON.parse(parametersJson) as { items?: Array<{ testId?: string }> };
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items.map(it => String(it?.testId ?? '').trim()).filter(id => id.length > 0);
  } catch {
    return [];
  }
}

const isBundle = (t: CartCatalogItem | undefined) => !!t && !!t.type && t.type !== 'individual';

/** Every id inside a bundle — nested profiles/packages and their tests. */
export function descendantIds(bundle: CartCatalogItem, byId: ReadonlyMap<string, CartCatalogItem>): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>([bundle.id]);
  const queue: CartCatalogItem[] = [bundle];
  while (queue.length) {
    const b = queue.shift()!;
    for (const id of bundleMemberIds(b.parameters)) {
      out.add(id);
      const child = byId.get(id);
      if (isBundle(child) && !seen.has(id)) { seen.add(id); queue.push(child!); }
    }
  }
  return out;
}

const index = (catalog: readonly CartCatalogItem[]) => new Map(catalog.map(t => [t.id, t] as const));

/** Would adding `candidateId` to a cart holding `selectedIds` duplicate an
 *  item? Returns the first overlap (either direction), else null. */
export function overlapOnAdd(
  catalog: readonly CartCatalogItem[], selectedIds: readonly string[], candidateId: string,
): CartOverlap | null {
  const byId = index(catalog);
  const cand = byId.get(candidateId);
  if (!cand || selectedIds.includes(candidateId)) return null;
  // The candidate is a bundle holding something already in the cart…
  if (isBundle(cand)) {
    const inside = descendantIds(cand, byId);
    for (const id of selectedIds) {
      const m = byId.get(id);
      if (m && inside.has(id)) return { container: cand, member: m };
    }
  }
  // …or a bundle in the cart already holds the candidate.
  for (const id of selectedIds) {
    const c = byId.get(id);
    if (isBundle(c) && descendantIds(c!, byId).has(candidateId)) return { container: c!, member: cand };
  }
  return null;
}

/** Every overlap already present in a cart (a restored draft, a repeat, an
 *  appointment prefill) — flagged, never crashed on. */
export function cartOverlaps(catalog: readonly CartCatalogItem[], selectedIds: readonly string[]): CartOverlap[] {
  const byId = index(catalog);
  const out: CartOverlap[] = [];
  for (const cid of selectedIds) {
    const c = byId.get(cid);
    if (!isBundle(c)) continue;
    const inside = descendantIds(c!, byId);
    for (const mid of selectedIds) {
      const m = byId.get(mid);
      if (m && mid !== cid && inside.has(mid)) out.push({ container: c!, member: m });
    }
  }
  return out;
}

/** The one refusal message (cart toast / flag) — same wording as the server's. */
export function overlapMessage(o: CartOverlap): string {
  return `“${o.member.name}” is already included in “${o.container.name}” — the same test can't be ordered twice. Remove one of them.`;
}
