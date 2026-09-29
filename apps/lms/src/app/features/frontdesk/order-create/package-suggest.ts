/**
 * Package / profile suggestions at the order desk — honest pricing
 * (owner 2026-09-29: "₹100 struck through, ₹1,000 shown" read as a saving
 * when it was a 10× dearer bundle).
 *
 * A bundle (package or profile) that contains something in the cart is
 * classified into exactly one of:
 *
 *  - SAVING   the bundle costs no more than the cart lines it would replace
 *             (same or more tests for less). The ONLY case shown with a
 *             strike-through: ~~what those lines cost now~~ → bundle price.
 *  - UPGRADE  the bundle costs more than those lines. Never struck through:
 *             "+₹900 · adds 12 more tests (worth ₹1,850 individually)" and
 *             "₹1,000 instead of ₹1,950 if ordered separately".
 *  - SUPPRESSED  not worth showing (see {@link SuppressReason}).
 *
 * Every amount comes from ONE price source — the cart's own billed unit per
 * test (`priceOf` + its GST slab) run through the BillMath mirror
 * (`computeBill(units, 0).gross`), so "Save ₹X" / "+₹X" is exactly how much
 * the cart's pre-discount total moves when the suggestion is applied.
 */
import { computeBill, type BillUnit } from '../../../shared/utils/bill-math';
import { bundleMemberIds, cartOverlaps, descendantIds, type CartCatalogItem } from './cart-duplicates';

/**
 * The thresholds, in one place.
 *
 * - `minBundleValuePct` (10): an UPGRADE is suggested only when the bundle is
 *   at least 10% cheaper than its members ordered one by one. A bundle that
 *   costs the same as (or more than) its members is never suggested at all,
 *   in either case — it is not good value.
 * - `upgradeExtraFloor` (₹1,000) / `upgradeExtraMultiple` (2): an UPGRADE may
 *   add at most max(₹1,000, 2 × what the replaced cart lines cost now). A
 *   ₹100 test → up to +₹1,000 (the owner's ₹1,000 package, +₹900, shows);
 *   a ₹100 test never gets a +₹4,900 full-body pitch; a ₹3,000 cart may be
 *   offered up to +₹6,000. Keeps the desk from upselling out of proportion.
 * - `maxSavings` (2) / `maxUpgrades` (1): at most two saving cards (largest
 *   saving first) and ONE quiet upgrade card (smallest extra cost first), so
 *   the cart is never buried under offers.
 */
export const PACKAGE_SUGGEST_RULES = Object.freeze({
  minBundleValuePct: 10,
  upgradeExtraFloor: 1000,
  upgradeExtraMultiple: 2,
  maxSavings: 2,
  maxUpgrades: 1,
});
export type PackageSuggestRules = typeof PACKAGE_SUGGEST_RULES;

/** The catalogue shape the suggester needs (a `Test` row fits). */
export interface SuggestCatalogItem extends CartCatalogItem {
  shortName?: string | null;
  isActive?: boolean | null;
}

export type SuggestionKind = 'saving' | 'upgrade';
export type SuppressReason =
  /** Costs the same as, or more than, its members one by one (or, for an
   *  upgrade, less than `minBundleValuePct` cheaper). */
  | 'not_good_value'
  /** Same price as the replaced lines and adds nothing. */
  | 'no_benefit'
  /** Upgrade whose extra cost is out of proportion to the cart. */
  | 'too_big_a_jump'
  /** Upgrade whose member value can't be shown (a member isn't orderable here). */
  | 'members_unpriced';

export interface SuggestionMember {
  id: string;
  name: string;
  /** Individual price (gross, as the cart would bill it alone). */
  amount: number;
  /** Already in the cart (ticked in "What's included"). */
  inCart: boolean;
}

export interface PackageSuggestion<T extends SuggestCatalogItem = SuggestCatalogItem> {
  kind: SuggestionKind;
  bundle: T;
  /** Cart ids the bundle replaces when applied. */
  coveredIds: string[];
  /** What the replaced cart lines cost now. */
  coveredAmount: number;
  /** The bundle's price. */
  bundleAmount: number;
  /** bundleAmount − coveredAmount: how the cart total moves on apply. */
  delta: number;
  /** −delta when saving, else 0. */
  savings: number;
  /** +delta when upgrading, else 0. */
  extraCost: number;
  /** Direct members, catalogue order. */
  members: SuggestionMember[];
  /** Members not in the cart yet. */
  extraCount: number;
  /** Those extra members' individual prices, summed. */
  extraMembersAmount: number;
  /** Every member at its individual price; null when a member isn't orderable here. */
  membersAmount: number | null;
}

export type BundleVerdict =
  | { kind: SuggestionKind }
  | { kind: 'suppressed'; reason: SuppressReason };

/** The numbers a verdict needs — pure, so each rule is testable in ₹. */
export interface BundleNumbers {
  bundleAmount: number;
  coveredAmount: number;
  membersAmount: number | null;
  extraCount: number;
}

const paise = (n: number) => Math.round(n * 100);

/** Classify one bundle against the cart lines it would replace. */
export function classifyBundle(n: BundleNumbers, rules: PackageSuggestRules = PACKAGE_SUGGEST_RULES): BundleVerdict {
  const bundle = paise(n.bundleAmount);
  const covered = paise(n.coveredAmount);
  const members = n.membersAmount == null ? null : paise(n.membersAmount);
  // Never good value: the bundle costs at least what its members cost apart.
  if (members != null && bundle >= members) return { kind: 'suppressed', reason: 'not_good_value' };
  if (bundle < covered) return { kind: 'saving' };
  if (bundle === covered) return n.extraCount > 0 ? { kind: 'saving' } : { kind: 'suppressed', reason: 'no_benefit' };
  // UPGRADE: the patient pays more — only when it is clearly good value and in proportion.
  if (members == null) return { kind: 'suppressed', reason: 'members_unpriced' };
  if (bundle * 100 > members * (100 - rules.minBundleValuePct)) return { kind: 'suppressed', reason: 'not_good_value' };
  const extra = bundle - covered;
  const cap = Math.max(paise(rules.upgradeExtraFloor), covered * rules.upgradeExtraMultiple);
  if (extra > cap) return { kind: 'suppressed', reason: 'too_big_a_jump' };
  return { kind: 'upgrade' };
}

const isBundleType = (t: SuggestCatalogItem | undefined): boolean =>
  !!t && (t.type === 'package' || t.type === 'profile');

/**
 * The suggestions for this cart: savings first (largest first), then the
 * quiet upgrade(s) (smallest extra first), capped by the rules.
 * `unitOf` is the cart's billed unit for a test (price + GST slab).
 */
export function suggestBundles<T extends SuggestCatalogItem>(
  catalog: readonly T[],
  selectedIds: readonly string[],
  unitOf: (t: T) => BillUnit,
  rules: PackageSuggestRules = PACKAGE_SUGGEST_RULES,
): PackageSuggestion<T>[] {
  if (selectedIds.length === 0) return [];
  const byId = new Map(catalog.map(t => [t.id, t] as const));
  const amountOf = (ts: readonly T[]) => (ts.length === 0 ? 0 : computeBill(ts.map(unitOf), 0).gross);
  const selected = new Set(selectedIds);
  // Members already covered by a bundle in the cart are billed at ₹0.
  const zeroRated = new Set<string>();
  for (const id of selectedIds) {
    const t = byId.get(id);
    if (isBundleType(t)) for (const d of descendantIds(t!, byId)) zeroRated.add(d);
  }

  const savings: PackageSuggestion<T>[] = [];
  const upgrades: PackageSuggestion<T>[] = [];
  for (const bundle of catalog) {
    if (!isBundleType(bundle) || bundle.isActive === false || selected.has(bundle.id)) continue;
    const memberIds = bundleMemberIds(bundle.parameters);
    if (memberIds.length === 0) continue;
    const inside = descendantIds(bundle, byId);
    const coveredIds = selectedIds.filter(id => inside.has(id));
    const billed = coveredIds.filter(id => !zeroRated.has(id)).map(id => byId.get(id)).filter((t): t is T => !!t);
    if (billed.length === 0) continue;
    // The swap must leave a valid cart (no test twice through a bundle).
    const after = [...selectedIds.filter(id => !inside.has(id)), bundle.id];
    if (cartOverlaps(catalog, after).some(o => o.container.id === bundle.id || o.member.id === bundle.id)) continue;

    // "In the cart" = a covered line, or anything inside a covered bundle.
    const inCart = new Set<string>(coveredIds);
    for (const id of coveredIds) {
      const t = byId.get(id);
      if (isBundleType(t)) for (const d of descendantIds(t!, byId)) inCart.add(d);
    }
    const resolved = memberIds.map(id => byId.get(id)).filter((t): t is T => !!t);
    const members: SuggestionMember[] = resolved.map(t => ({
      id: t.id, name: t.name, amount: amountOf([t]), inCart: inCart.has(t.id),
    }));
    const extras = resolved.filter(t => !inCart.has(t.id));
    const bundleAmount = amountOf([bundle]);
    const coveredAmount = amountOf(billed);
    const membersAmount = resolved.length === memberIds.length ? amountOf(resolved) : null;
    const extraCount = memberIds.filter(id => !inCart.has(id)).length;

    const verdict = classifyBundle({ bundleAmount, coveredAmount, membersAmount, extraCount }, rules);
    if (verdict.kind === 'suppressed') continue;
    const delta = (paise(bundleAmount) - paise(coveredAmount)) / 100;
    const s: PackageSuggestion<T> = {
      kind: verdict.kind, bundle, coveredIds, coveredAmount, bundleAmount, delta,
      savings: Math.max(0, -delta), extraCost: Math.max(0, delta),
      members, extraCount, extraMembersAmount: amountOf(extras), membersAmount,
    };
    (verdict.kind === 'saving' ? savings : upgrades).push(s);
  }
  savings.sort((a, b) => (b.savings - a.savings) || (b.extraCount - a.extraCount) || (a.bundleAmount - b.bundleAmount));
  upgrades.sort((a, b) => (a.extraCost - b.extraCost)
    || (((b.membersAmount ?? 0) - b.bundleAmount) - ((a.membersAmount ?? 0) - a.bundleAmount)));
  return [...savings.slice(0, rules.maxSavings), ...upgrades.slice(0, rules.maxUpgrades)];
}
