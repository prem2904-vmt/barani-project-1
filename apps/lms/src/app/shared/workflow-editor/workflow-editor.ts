import { computed, signal } from '@angular/core';
import {
  ACTION_CATALOG, ACTION_POLICY, ActionCatalogEntry, ProcessCategory, ProcessWorkflowConfig,
  actionHome, catalogFor, coupledTypes, dependentsOf, isAllowedPlacement, isFixedSlotAction, isLockedItem,
  isMandatoryItem, normalizeWorkflow, requiresOf,
} from './wf-model';

/**
 * The workflow editor's ENGINE (owner-approved redesign 2026-11-19: work areas → actions → roles). Pure TypeScript +
 * signals, no Angular DI, so the LMS "Work steps" page and the admin console's "Master workflow" share it file for
 * file. Every rule of the old builder is kept as it was: the lock policy (ACTION_POLICY), Sample Collection's fixed
 * slots, couplings (dispatch ↔ lab intake) and prerequisites cascade exactly as before; only the screen changed.
 * The saved payload is the same ProcessWorkflowConfig.
 */

export interface LaneItem { id: string; type: string; label?: string; enabled: boolean; }
export interface Lane { cat: ProcessCategory; items: LaneItem[]; }

/** Lanes are palette-only (owner, 2026-09-25): a new work area still carries the model's `color` field (stored values
 *  are untouched for existing areas) — always the one primary. The list's dots never read the stored colour. */
export const LANE_COLOR = '#7c3aed';

/** The side list's colour dots: palette only, by position (never the stored colour, never yellow / green / sky). */
export const AREA_DOTS = ['#8b5cf6', '#6366f1', '#a855f7', '#d946ef', '#3b82f6', '#64748b', '#ec4899'];
export const areaDot = (index: number): string => AREA_DOTS[((index % AREA_DOTS.length) + AREA_DOTS.length) % AREA_DOTS.length];

const uid = (): string =>
  (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? globalThis.crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

const cloneLanes = (lanes: Lane[]): Lane[] =>
  lanes.map(l => ({ cat: { ...l.cat, roles: l.cat.roles ? [...l.cat.roles] : l.cat.roles }, items: l.items.map(i => ({ ...i })) }));

// ── Config ⇄ lanes ──────────────────────────────────────────────────

/** A saved config → the editor's lanes: the shared normaliser (Collect area + collection slots), then the lock and
 *  dependency repairs the builder always ran on load. */
export function lanesFromConfig(input: ProcessWorkflowConfig | null | undefined): Lane[] {
  const cfg = normalizeWorkflow(input ?? { categories: [], actions: [] }) ?? { categories: [], actions: [] };
  const cats = [...(cfg.categories ?? [])].sort((a, b) => a.order - b.order);
  const lanes: Lane[] = cats.map(cat => ({
    cat: { ...cat, roles: cat.roles ? [...cat.roles] : cat.roles },
    items: (cfg.actions ?? []).filter(a => a.categoryId === cat.id).sort((a, b) => a.order - b.order)
      .map(a => ({ id: a.id, type: a.type, label: a.label, enabled: a.enabled })),
  }));
  healLocks(lanes);
  healDeps(lanes);
  return lanes;
}

export function parseConfig(json: string | null | undefined): ProcessWorkflowConfig {
  try {
    const c = JSON.parse(json || '{}') as ProcessWorkflowConfig;
    return { categories: Array.isArray(c?.categories) ? c.categories : [], actions: Array.isArray(c?.actions) ? c.actions : [] };
  } catch { return { categories: [], actions: [] }; }
}

/** The lanes as the SAME payload the builder always saved (run through the shared normaliser, so a save can never
 *  carry Sample Collection outside its fixed slots). */
export function configFromLanes(lanes: Lane[]): ProcessWorkflowConfig {
  const cfg: ProcessWorkflowConfig = {
    categories: lanes.map((l, i) => ({ ...l.cat, order: i })),
    actions: lanes.flatMap(l => l.items.map((it, i) => ({ id: it.id, type: it.type, label: it.label, categoryId: l.cat.id, order: i, enabled: it.enabled }))),
  };
  return normalizeWorkflow(cfg) ?? cfg;
}

/** Enforce the lock policy: every locked action sits exactly once in its home area, mandatory ones are on.
 *  Fixed-slot actions (sample_collection) are owned by normalizeWorkflow. Mutates. */
export function healLocks(lanes: Lane[]): void {
  for (const [type, pol] of Object.entries(ACTION_POLICY)) {
    if (!pol.locked || isFixedSlotAction(type)) continue;
    const home = lanes.find(l => l.cat.id === pol.home);
    let stray: LaneItem | undefined;
    for (const ln of lanes) {
      if (home && ln.cat.id === pol.home) continue;
      for (let k = ln.items.length - 1; k >= 0; k--) {
        if (ln.items[k].type === type) { stray = stray ?? ln.items[k]; ln.items.splice(k, 1); }
      }
    }
    if (!home) continue;
    const inHome = home.items.find(it => it.type === type);
    if (inHome) { if (pol.mandatory) inHome.enabled = true; }
    else {
      const it = stray ?? { id: uid(), type, enabled: true };
      if (pol.mandatory) it.enabled = true;
      home.items.push(it);
    }
  }
}

/** Couplings + prerequisites: an enabled action whose partner or a prerequisite is off / missing is switched off too
 *  (fixed point). Mutates. */
export function healDeps(lanes: Lane[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    const on = new Set(lanes.flatMap(l => l.items).filter(i => i.enabled).map(i => i.type));
    for (const ln of lanes) for (const it of ln.items) {
      if (!it.enabled || isMandatoryItem(it.type, ln.cat.id)) continue;
      const partnerOff = coupledTypes(it.type).some(p => !on.has(p));
      const reqOff = requiresOf(it.type).some(r => !on.has(r));
      if (partnerOff || reqOff) { it.enabled = false; changed = true; }
    }
  }
}

/** Every action type to flip when `type` becomes `enabled` (couplings both ways, prerequisites when enabling,
 *  dependents when disabling) + prerequisites that are not placed anywhere. Fixed-slot types are satisfied by ANY
 *  enabled copy (`itemId` = the copy being changed). */
export function cascade(lanes: Lane[], type: string, enabled: boolean, itemId?: string): { desired: Map<string, boolean>; missing: string[] } {
  const desired = new Map<string, boolean>();
  const missing: string[] = [];
  const placed = new Set(lanes.flatMap(l => l.items.map(i => i.type)));
  const otherCopyOn = (t: string) => lanes.some(l => l.items.some(i => i.type === t && i.enabled && !(t === type && i.id === itemId)));
  const visit = (t: string, en: boolean) => {
    if (desired.get(t) === en) return;
    if (isFixedSlotAction(t) && otherCopyOn(t)) { if (t === type) desired.set(t, en); return; }
    desired.set(t, en);
    for (const p of coupledTypes(t)) visit(p, en);
    if (en) {
      for (const req of requiresOf(t)) {
        if (placed.has(req)) visit(req, true);
        else if (!missing.includes(req)) missing.push(req);
      }
    } else {
      for (const dep of dependentsOf(t)) if (placed.has(dep)) visit(dep, false);
    }
  };
  visit(type, enabled);
  return { desired, missing };
}

/** Apply a cascade (mandatory actions stay on). Returns new lanes + the missing prerequisites. */
export function applyEnabled(lanes: Lane[], type: string, enabled: boolean, itemId?: string): { lanes: Lane[]; missing: string[] } {
  const { desired, missing } = cascade(lanes, type, enabled, itemId);
  const pick = new Map<string, string>();
  for (const [t, d] of desired) {
    if (!d || !isFixedSlotAction(t) || (t === type && itemId)) continue;
    const copies = lanes.flatMap(l => l.items.filter(i => i.type === t).map(i => ({ i, area: l.cat.id })));
    const chosen = copies.find(c => c.area === actionHome(t)) ?? copies[0];
    if (chosen) pick.set(t, chosen.i.id);
  }
  const next = lanes.map(ln => ({
    ...ln,
    items: ln.items.map(it => {
      const d = desired.get(it.type);
      if (d === undefined) return it;
      if (isFixedSlotAction(it.type)) {
        if (it.type === type && itemId) return it.id === itemId ? { ...it, enabled: d } : it;
        if (d && pick.get(it.type) !== it.id) return it;
      }
      return { ...it, enabled: isMandatoryItem(it.type, ln.cat.id) ? true : d };
    }),
  }));
  healDeps(next);
  return { lanes: next, missing };
}

// ── Display helpers ────────────────────────────────────────────────

export const labelOf = (it: { type: string; label?: string }): string => it.label || catalogFor(it.type)?.label || it.type;
export const hintOf = (type: string): string => catalogFor(type)?.hint ?? '';
export const iconOf = (type: string): string[] => catalogFor(type)?.iconPath ?? ['M12 2v20M2 12h20'];

/** The lock pill: "Stays in <area>: <reason>". The real reason where the code has one (Sample Collection's fixed
 *  slots, owner 2026-09-27); otherwise the plain rule. */
export function lockReason(type: string, areaName: string): string {
  if (isFixedSlotAction(type)) return `Stays in ${areaName}: collection lives only in Collect, Frontdesk and Lab`;
  return `Stays in ${areaName}: can’t move to another area`;
}

/** The switch's plain-words tooltip. */
export function switchTip(type: string, areaId: string, enabled: boolean): string {
  if (isMandatoryItem(type, areaId)) return 'Always on — every lab needs it';
  return enabled ? 'On — shown in this area' : 'Off — hidden, still in this area';
}

// ── Who sees an area ──────────────────────────────────────────────

/** Role name → permission codes (null = not known on this surface). */
export type RolePerms = Record<string, string[]> | null;

/**
 * Can people with `role` see this area in the navigation? The live navigation is PERMISSION-driven (layout/nav-items:
 * an area shows when the person may open at least one of its switched-on actions), so with the role's permissions this
 * answers exactly that. Without them (a surface that can't read role permissions) it falls back to the roles chosen
 * for the area (none chosen = everyone).
 */
export function areaVisibleTo(lane: Lane, role: string, perms: RolePerms): boolean {
  const on = lane.items.filter(i => i.enabled);
  if (!on.length) return false;
  const codes = perms?.[role];
  if (codes) {
    if (codes.includes('*')) return true;
    return on.some(i => {
      const need = catalogFor(i.type)?.permissions ?? [];
      return !need.length || need.some(p => codes.includes(p));
    });
  }
  const roles = lane.cat.roles ?? [];
  return !roles.length || roles.includes(role);
}

// ── Warnings ──────────────────────────────────────────────────────

export type WarningKind = 'unreachable' | 'empty' | 'no-roles' | 'role-no-area';
export interface WfWarning {
  id: string;
  kind: WarningKind;
  areaId: string | null;
  itemId?: string;
  title: string;
  detail: string;
}

/** Plain-words checks, computed live (like Report design's Warnings). Each one says where to go ("Show me"). */
export function computeWarnings(lanes: Lane[], roles: string[], perms: RolePerms): WfWarning[] {
  const out: WfWarning[] = [];
  // An action that is placed but switched off in every work area: nobody can reach it.
  const byType = new Map<string, { lane: Lane; it: LaneItem }[]>();
  for (const l of lanes) for (const it of l.items) {
    const arr = byType.get(it.type) ?? [];
    arr.push({ lane: l, it });
    byType.set(it.type, arr);
  }
  for (const [type, copies] of byType) {
    if (copies.some(c => c.it.enabled)) continue;
    const first = copies[0];
    const label = labelOf(first.it);
    out.push({
      id: `unreachable:${type}`, kind: 'unreachable', areaId: first.lane.cat.id, itemId: first.it.id,
      title: `Nobody can reach ${label}`,
      detail: copies.length > 1
        ? `It is switched off in every work area it sits in. Turn it on where it is used.`
        : `It is switched off in ${first.lane.cat.name} and is in no other work area. Turn it on, or move it where it is used.`,
    });
  }
  for (const l of lanes) {
    const on = l.items.filter(i => i.enabled);
    if (!on.length) {
      out.push({
        id: `empty:${l.cat.id}`, kind: 'empty', areaId: l.cat.id,
        title: `${l.cat.name || 'A work area'} is empty`,
        detail: l.items.length
          ? 'All its actions are switched off, so it does not show in the navigation.'
          : 'It has no actions, so it does not show in the navigation. Add an action or remove the area.',
      });
      continue;
    }
    // Who can see it (by permissions where known, else by the roles chosen for it).
    const gated = on.some(i => (catalogFor(i.type)?.permissions ?? []).length > 0);
    if (!gated) continue;
    if (perms) {
      if (roles.length && !roles.some(r => areaVisibleTo(l, r, perms))) {
        out.push({ id: `no-roles:${l.cat.id}`, kind: 'no-roles', areaId: l.cat.id,
          title: `No role can open ${l.cat.name}`,
          detail: 'None of the roles has a permission for its switched-on actions, so nobody sees it.' });
      }
    } else if (!(l.cat.roles ?? []).length) {
      out.push({ id: `no-roles:${l.cat.id}`, kind: 'no-roles', areaId: l.cat.id,
        title: `No role chosen for ${l.cat.name}`,
        detail: 'Add the roles that work here.' });
    }
  }
  for (const r of roles) {
    const sees = perms
      ? lanes.some(l => areaVisibleTo(l, r, perms))
      : lanes.some(l => (l.cat.roles ?? []).includes(r));
    if (sees) continue;
    out.push({
      id: `role:${r}`, kind: 'role-no-area', areaId: null,
      title: `${r} has no work area`,
      detail: perms
        ? 'This role can open none of the switched-on actions, so its navigation is empty.'
        : 'No work area lists this role. Add it under “Who works here”.',
    });
  }
  return out;
}

// ── Branch differences ────────────────────────────────────────────

const areaSig = (l: Lane): string => JSON.stringify({
  n: l.cat.name, i: l.cat.icon, r: [...(l.cat.roles ?? [])].sort(),
  a: l.items.map(i => [i.type, !!i.enabled, i.label ?? '']),
});

export interface AreaDiff { changed: Set<string>; removed: string[]; reordered: boolean; count: number; }

/** Which areas of `lanes` differ from the default `base` (content, not position); removed areas and a changed area
 *  order count too. */
export function diffAreas(base: Lane[], lanes: Lane[]): AreaDiff {
  const baseById = new Map(base.map(l => [l.cat.id, l]));
  const changed = new Set<string>();
  for (const l of lanes) {
    const b = baseById.get(l.cat.id);
    if (!b || areaSig(b) !== areaSig(l)) changed.add(l.cat.id);
  }
  const ids = new Set(lanes.map(l => l.cat.id));
  const removed = base.filter(b => !ids.has(b.cat.id)).map(b => b.cat.name);
  const common = lanes.map(l => l.cat.id).filter(id => baseById.has(id));
  const baseOrder = base.map(b => b.cat.id).filter(id => ids.has(id));
  const reordered = common.join('|') !== baseOrder.join('|');
  return { changed, removed, reordered, count: changed.size + removed.length + (reordered ? 1 : 0) };
}

// ── Search ────────────────────────────────────────────────────────

export interface SearchHit { areaId: string | null; itemId?: string; type?: string; label: string; where: string; }

/** Actions (name / hint / type) and work areas (name) matching `q`; unused actions answer "not used yet". */
export function searchHits(q: string, lanes: Lane[], unused: ActionCatalogEntry[]): SearchHit[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const hit = (...s: (string | undefined)[]) => s.some(x => (x ?? '').toLowerCase().includes(t));
  const out: SearchHit[] = [];
  for (const l of lanes) {
    if (hit(l.cat.name)) out.push({ areaId: l.cat.id, label: l.cat.name, where: l.cat.name });
    for (const it of l.items) {
      if (hit(labelOf(it), hintOf(it.type), it.type.replace(/_/g, ' '))) {
        out.push({ areaId: l.cat.id, itemId: it.id, type: it.type, label: labelOf(it), where: l.cat.name });
      }
    }
  }
  for (const a of unused) if (hit(a.label, a.hint, a.type.replace(/_/g, ' '))) out.push({ areaId: null, type: a.type, label: a.label, where: 'not used yet' });
  return out;
}

// ── The editor ────────────────────────────────────────────────────

/**
 * The editable workflow: lanes + every operation the screen offers. Operations take ids (never list indices), apply
 * the lock policy and run the same cascades as the old builder. `notify` shows a plain-words reason when something
 * is refused (a locked action, a fixed slot).
 */
export class WorkflowEditor {
  readonly lanes = signal<Lane[]>([]);
  /** The config as last loaded / saved — `dirty` compares against it, so undoing a change clears it. */
  private readonly savedSig = signal('');
  readonly savedName = signal('');
  readonly name = signal('');

  constructor(private readonly notify: (msg: string) => void = () => {}) {}

  readonly config = computed(() => configFromLanes(this.lanes()));
  private readonly sig = computed(() => JSON.stringify(this.config()));
  readonly dirty = computed(() => this.sig() !== this.savedSig() || this.name().trim() !== this.savedName().trim());

  /** Actions the lab can still add: every catalogue action not placed anywhere (Lost & Found & co). Sample Collection
   *  is never offered (its copies sit in their fixed slots). */
  readonly unused = computed<ActionCatalogEntry[]>(() => {
    const placed = new Set(this.lanes().flatMap(l => l.items.map(i => i.type)));
    return ACTION_CATALOG.filter(a => !isFixedSlotAction(a.type) && !placed.has(a.type));
  });

  /** Load a config. `asSaved` false = the result starts as unsaved changes (a draft / a restored version). */
  load(cfg: ProcessWorkflowConfig | null | undefined, name: string, asSaved = true): void {
    const lanes = lanesFromConfig(cfg);
    this.lanes.set(lanes);
    this.name.set(name);
    if (asSaved) this.markSaved(name);
  }

  /** The current state becomes the saved baseline. */
  markSaved(name = this.name()): void {
    this.savedSig.set(JSON.stringify(configFromLanes(this.lanes())));
    this.savedName.set(name);
  }

  /** Nothing is saved yet (a new branch draft): everything on screen counts as unsaved. */
  markDraft(): void { this.savedSig.set('\u0000draft'); }

  lane(areaId: string | null | undefined): Lane | undefined { return this.lanes().find(l => l.cat.id === areaId); }
  areaOf(itemId: string): Lane | undefined { return this.lanes().find(l => l.items.some(i => i.id === itemId)); }

  private mutate(fn: (lanes: Lane[]) => Lane[] | void): void {
    const copy = cloneLanes(this.lanes());
    const res = fn(copy);
    this.lanes.set(res ?? copy);
  }

  // Areas
  addArea(name = 'New area'): string {
    const names = new Set(this.lanes().map(l => l.cat.name));
    let n = name; for (let i = 2; names.has(n); i++) n = `${name} ${i}`;
    const id = uid();
    this.mutate(l => { l.push({ cat: { id, name: n, icon: 'folder', color: LANE_COLOR, order: l.length, roles: [] }, items: [] }); });
    return id;
  }
  renameArea(areaId: string, name: string): void {
    const v = name.trim(); if (!v) return;
    this.mutate(l => { const a = l.find(x => x.cat.id === areaId); if (a) a.cat.name = v; });
  }
  setAreaIcon(areaId: string, icon: string): void {
    this.mutate(l => { const a = l.find(x => x.cat.id === areaId); if (a) a.cat.icon = icon; });
  }
  /** Same rule as before: an area holding a locked action can't be deleted. Its other actions become unused. */
  deleteArea(areaId: string): boolean {
    const lane = this.lane(areaId); if (!lane) return false;
    if (lane.items.some(it => isLockedItem(it.type, areaId))) {
      this.notify(`${lane.cat.name} holds actions that stay in it, so it can’t be removed`);
      return false;
    }
    const gone = lane.items.map(i => i.type);
    this.mutate(l => {
      let next = l.filter(x => x.cat.id !== areaId);
      for (const t of new Set(gone)) {
        if (next.some(x => x.items.some(i => i.type === t && i.enabled))) continue;
        next = applyEnabled(next, t, false).lanes;
      }
      return next;
    });
    return true;
  }
  moveArea(from: number, to: number): void {
    if (from === to) return;
    this.mutate(l => { const [m] = l.splice(from, 1); if (m) l.splice(Math.max(0, Math.min(to, l.length)), 0, m); });
  }
  addRole(areaId: string, role: string): void {
    this.mutate(l => { const a = l.find(x => x.cat.id === areaId); if (a && !(a.cat.roles ?? []).includes(role)) a.cat.roles = [...(a.cat.roles ?? []), role]; });
  }
  removeRole(areaId: string, role: string): void {
    this.mutate(l => { const a = l.find(x => x.cat.id === areaId); if (a) a.cat.roles = (a.cat.roles ?? []).filter(r => r !== role); });
  }

  /** "Show <area> in the navigation": an area shows while at least one of its actions is on. Off = every action that
   *  may be switched off goes off; on = they all come back on (with their prerequisites). */
  areaShown(areaId: string): boolean { return !!this.lane(areaId)?.items.some(i => i.enabled); }
  canHideArea(areaId: string): boolean { return !(this.lane(areaId)?.items.some(i => isMandatoryItem(i.type, areaId)) ?? false); }
  setAreaShown(areaId: string, on: boolean): void {
    const lane = this.lane(areaId); if (!lane) return;
    if (!on && !this.canHideArea(areaId)) { this.notify(`${lane.cat.name} holds an action that is always on`); return; }
    let lanes = cloneLanes(this.lanes());
    const missing: string[] = [];
    for (const it of lane.items) {
      if (it.enabled === on || isMandatoryItem(it.type, areaId)) continue;
      const r = applyEnabled(lanes, it.type, on, it.id);
      lanes = r.lanes; missing.push(...r.missing.filter(m => !missing.includes(m)));
    }
    this.lanes.set(lanes);
    this.warnMissing(missing);
  }

  // Actions
  toggleItem(areaId: string, itemId: string): void {
    const lane = this.lane(areaId);
    const cur = lane?.items.find(i => i.id === itemId);
    if (!lane || !cur || isMandatoryItem(cur.type, areaId)) return;
    const r = applyEnabled(this.lanes(), cur.type, !cur.enabled, cur.id);
    this.lanes.set(r.lanes);
    this.warnMissing(r.missing);
  }
  reorderItems(areaId: string, from: number, to: number): void {
    if (from === to) return;
    this.mutate(l => {
      const a = l.find(x => x.cat.id === areaId); if (!a) return;
      const [m] = a.items.splice(from, 1); if (m) a.items.splice(Math.max(0, Math.min(to, a.items.length)), 0, m);
    });
  }
  /** Place an unused action in an area (it starts on and pulls in its prerequisites). */
  addAction(areaId: string, type: string, index?: number): string | null {
    const entry = catalogFor(type);
    if (!entry || isFixedSlotAction(type) || !isAllowedPlacement(type, areaId)) {
      if (entry) this.notify(`${entry.label} stays in Collect, Frontdesk and Lab`);
      return null;
    }
    const pol = ACTION_POLICY[type];
    if (pol?.locked && pol.home !== areaId && this.lane(pol.home)) {
      this.notify(`${entry.label} stays in ${this.lane(pol.home)!.cat.name}`);
      return null;
    }
    const id = uid();
    this.mutate(l => {
      const a = l.find(x => x.cat.id === areaId); if (!a) return;
      a.items.splice(index == null ? a.items.length : Math.max(0, Math.min(index, a.items.length)), 0, { id, type, enabled: true });
    });
    const r = applyEnabled(this.lanes(), type, true, id);
    this.lanes.set(r.lanes);
    this.warnMissing(r.missing);
    return id;
  }
  /** Can this placed action leave its area (move / copy / remove)? */
  canMove(itemId: string): boolean {
    const lane = this.areaOf(itemId);
    const it = lane?.items.find(i => i.id === itemId);
    return !!it && !isLockedItem(it.type, lane!.cat.id);
  }
  /**
   * Move (or, with `copy`, copy) an action into another area at `index` (default: the end). A locked action never
   * leaves its area. Moving inside the same area reorders.
   */
  moveItem(itemId: string, toAreaId: string, index?: number, copy = false): boolean {
    const from = this.areaOf(itemId);
    const to = this.lane(toAreaId);
    const it = from?.items.find(i => i.id === itemId);
    if (!from || !to || !it) return false;
    if (from.cat.id === toAreaId && !copy) {
      const fi = from.items.indexOf(it);
      this.reorderItems(toAreaId, fi, index == null ? from.items.length - 1 : (index > fi ? index - 1 : index));
      return true;
    }
    if (isLockedItem(it.type, from.cat.id)) {
      this.notify(isFixedSlotAction(it.type)
        ? `${labelOf(it)} is fixed here — switch it on or off instead`
        : `${labelOf(it)} stays in ${from.cat.name}`);
      return false;
    }
    this.mutate(l => {
      const src = l.find(x => x.cat.id === from.cat.id)!;
      const dst = l.find(x => x.cat.id === toAreaId)!;
      const k = src.items.findIndex(i => i.id === itemId);
      const moving = copy ? { ...src.items[k], id: uid() } : src.items.splice(k, 1)[0];
      dst.items.splice(index == null ? dst.items.length : Math.max(0, Math.min(index, dst.items.length)), 0, moving);
      healDeps(l);
    });
    return true;
  }
  /** Take an action out of the navigation (it waits in "Add action"). Locked actions can't. */
  removeItem(itemId: string): boolean {
    const lane = this.areaOf(itemId);
    const it = lane?.items.find(i => i.id === itemId);
    if (!lane || !it) return false;
    if (isLockedItem(it.type, lane.cat.id)) { this.notify(`${labelOf(it)} stays in ${lane.cat.name}`); return false; }
    let lanes = cloneLanes(this.lanes());
    const src = lanes.find(x => x.cat.id === lane.cat.id)!;
    src.items = src.items.filter(i => i.id !== itemId);
    const stillOn = lanes.some(l => l.items.some(i => i.type === it.type && i.enabled));
    if (!stillOn) {
      const { desired } = cascade(lanes, it.type, false);
      lanes = lanes.map(ln => ({ ...ln, items: ln.items.map(x => {
        const d = desired.get(x.type);
        return d === undefined || isMandatoryItem(x.type, ln.cat.id) ? x : { ...x, enabled: d };
      }) }));
    }
    healDeps(lanes);
    this.lanes.set(lanes);
    return true;
  }

  /**
   * Branch "Reset to default": the area becomes exactly the default's (name, icon, roles, actions). An area the
   * default doesn't have is removed (when it can be). Actions the default keeps in this area leave the areas they
   * were moved to here.
   */
  resetArea(areaId: string, base: Lane[]): boolean {
    const b = base.find(l => l.cat.id === areaId);
    if (!b) return this.deleteArea(areaId);
    const types = new Set(b.items.map(i => i.type));
    this.mutate(l => {
      const a = l.find(x => x.cat.id === areaId); if (!a) return;
      a.cat = { ...b.cat, order: a.cat.order, roles: [...(b.cat.roles ?? [])] };
      a.items = b.items.map(i => ({ ...i }));
      for (const other of l) {
        if (other === a) continue;
        const baseOther = base.find(x => x.cat.id === other.cat.id);
        other.items = other.items.filter(i => !types.has(i.type) || isFixedSlotAction(i.type) || !!baseOther?.items.some(x => x.type === i.type));
      }
      healLocks(l);
      healDeps(l);
    });
    return true;
  }

  private warnMissing(missing: string[]): void {
    if (missing.length) this.notify(`Also needs ${missing.map(m => catalogFor(m)?.label ?? m).join(', ')} — add it to a work area`);
  }
}
