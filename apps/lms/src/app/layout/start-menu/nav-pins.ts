import type { NavItem } from '../nav-items';

/**
 * The ONE place that decides which screens sit on the bottom bar (Start menu, owner 2026-11-11).
 * Pure — no Angular, no storage, no network — so every rule is unit-tested.
 *
 * Rules: pins NEVER grant access (an id the person cannot open is dropped silently); a screen the
 * admin LOCKED for a role is always on the bar, first; nothing configured (no role defaults and no
 * personal pins) pins today's bar order; the bar ALWAYS shows only what fits the screen (owner: "show
 * only four" on a phone) and the rest is one click away in the Start menu. Both shells and the menu read this module — never re-derive the bar anywhere else.
 */

/** Screens that fit on the bar, by viewport width (px). */
export const NAV_CAPACITY_PHONE = 4;
export const NAV_CAPACITY_TABLET = 6;
export const NAV_CAPACITY_LAPTOP = 8;
export const NAV_CAPACITY_WIDE = 10;
export const NAV_BREAKPOINT_PHONE = 640;
export const NAV_BREAKPOINT_TABLET = 1024;
export const NAV_BREAKPOINT_LAPTOP = 1440;
/** "Icons only" frees the labels' room: about half as many screens again. */
export const NAV_ICONS_ONLY_FACTOR = 1.5;
/** Server limits (prefrontal-mw nav-defaults): ids and list length. */
export const NAV_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
export const NAV_MAX_PER_ROLE = 40;

export function navCapacity(width: number, iconsOnly: boolean): number {
  const base = width < NAV_BREAKPOINT_PHONE ? NAV_CAPACITY_PHONE
    : width < NAV_BREAKPOINT_TABLET ? NAV_CAPACITY_TABLET
    : width < NAV_BREAKPOINT_LAPTOP ? NAV_CAPACITY_LAPTOP
    : NAV_CAPACITY_WIDE;
  return iconsOnly ? Math.floor(base * NAV_ICONS_ONLY_FACTOR) : base;
}

/** One role's admin-set bar: pinned (in order) and the subset nobody may unpin. */
export interface RoleNav { pinned: string[]; locked: string[] }

function uniq(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** Merge the defaults of every role the person holds: pinned = union (first role's order first),
 *  locked = union. null when no role has any defaults (so nothing changes for labs that never set them). */
export function mergeRoleDefaults(
  map: Record<string, RoleNav> | null | undefined,
  roles: readonly string[],
): RoleNav | null {
  if (!map) return null;
  const pinned: string[] = [];
  const locked: string[] = [];
  for (const r of roles) {
    const d = map[r];
    if (!d) continue;
    pinned.push(...(d.pinned ?? []));
    locked.push(...(d.locked ?? []));
  }
  const p = uniq(pinned);
  const l = uniq(locked);
  for (const id of l) if (!p.includes(id)) p.push(id); // locked is always pinned
  return p.length ? { pinned: p, locked: l } : null;
}

export interface NavLayoutInput {
  /** Every work screen the person can open, in today's bar order (primary list, then Settings). */
  all: NavItem[];
  /** Menu-only candidates (MORE_NAV, already visibility-filtered); they can be pinned too. */
  more?: NavItem[];
  roleDefaults: RoleNav | null;
  /** null = never customised. */
  userPins: string[] | null;
  capacity: number;
}

export interface NavMenuGroups {
  pinned: NavItem[];
  work: NavItem[];
  more: NavItem[];
  settings: NavItem[];
}

export interface NavLayout {
  /** What the bar renders: the pinned screens that fit (capacity). */
  bar: NavItem[];
  /** Every pinned screen the person may open, in order (the bar is its first `capacity`). */
  pinned: NavItem[];
  /** Ids the admin locked (and the person can open): shown with a lock, no unpin. */
  lockedIds: ReadonlySet<string>;
  /** Everything openable, grouped for the Start menu (each screen appears once). */
  menu: NavMenuGroups;
  /** False when neither role defaults nor personal pins exist: today's bar, untouched. */
  configured: boolean;
}

/** The admin's Settings link is the only item in the Settings group. */
const SETTINGS_ID = 'admin';

export function computeNavLayout(input: NavLayoutInput): NavLayout {
  const cap = Math.max(0, Math.floor(input.capacity));
  const byId = new Map<string, NavItem>();
  const hrefs = new Set<string>();
  for (const i of input.all) {
    if (byId.has(i.id)) continue;
    byId.set(i.id, i);
    hrefs.add(i.href);
  }
  // Menu-only items that point at a screen already in the work list (m-opd vs opd, admin-overview vs admin)
  // are the same screen: show it once.
  const more: NavItem[] = [];
  for (const i of input.more ?? []) {
    if (byId.has(i.id) || hrefs.has(i.href)) continue;
    byId.set(i.id, i);
    hrefs.add(i.href);
    more.push(i);
  }

  const defaults = input.roleDefaults;
  const lockedIds = new Set<string>((defaults?.locked ?? []).filter(id => byId.has(id)));
  const configured = input.userPins !== null || !!defaults;

  let pinnedIds: string[];
  if (!configured) {
    pinnedIds = input.all.map(i => i.id).filter((id, ix, a) => a.indexOf(id) === ix);
  } else if (input.userPins === null) {
    pinnedIds = uniq(defaults!.pinned);
  } else {
    // Locked screens are always on the bar, first, in the admin's order; the person's own pins follow.
    const lockedInOrder = uniq([...(defaults?.pinned ?? []).filter(id => lockedIds.has(id)), ...lockedIds]);
    pinnedIds = uniq([...lockedInOrder, ...input.userPins]);
  }
  const allowed = pinnedIds.filter(id => byId.has(id)).map(id => byId.get(id)!);
  // Not configured: today's order, but only what fits counts as pinned (the rest lists under Work in the menu).
  const pinned = configured ? allowed : allowed.slice(0, cap);
  const bar = pinned.slice(0, cap);

  const pinnedSet = new Set(pinned.map(i => i.id));
  const rest = (list: NavItem[]) => list.filter(i => !pinnedSet.has(i.id));
  const allUnique = [...byId.values()].filter(i => input.all.includes(i));
  return {
    bar,
    pinned,
    lockedIds,
    menu: {
      pinned,
      work: rest(allUnique.filter(i => i.id !== SETTINGS_ID)),
      more: rest(more),
      settings: rest(allUnique.filter(i => i.id === SETTINGS_ID)),
    },
    configured,
  };
}

/** Pin or unpin `id` in the person's ordered pin list. A locked id never unpins. Pure. */
export function togglePinned(pins: readonly string[], id: string, lockedIds: ReadonlySet<string>): string[] {
  if (pins.includes(id)) return lockedIds.has(id) ? [...pins] : pins.filter(p => p !== id);
  return [...pins, id];
}

/** Move `id` one place up (-1) or down (+1) in `ids`. Out-of-range moves return the list unchanged. Pure. */
export function movePinned(ids: readonly string[], id: string, dir: -1 | 1): string[] {
  const out = [...ids];
  const at = out.indexOf(id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= out.length) return out;
  [out[at], out[to]] = [out[to], out[at]];
  return out;
}

/** Make one role's lists valid for the server: valid ids, no duplicates, max 40, locked ⊆ pinned. Pure. */
export function normalizeRoleNav(pinned: readonly string[], locked: readonly string[]): RoleNav {
  const p = uniq(pinned.filter(id => NAV_ID_PATTERN.test(id))).slice(0, NAV_MAX_PER_ROLE);
  const l = uniq(locked).filter(id => p.includes(id));
  return { pinned: p, locked: l };
}
