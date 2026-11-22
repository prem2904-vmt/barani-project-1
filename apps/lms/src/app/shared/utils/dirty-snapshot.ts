import { DestroyRef, Signal, computed, signal } from '@angular/core';
import type { AbstractControl } from '@angular/forms';

/**
 * SAVE ONLY WHEN SOMETHING CHANGED (owner 2026-11-19: "Only on any changes the save should be enabled. Until then the
 * save should be disabled — the user has to make a change, then only save gets enabled").
 *
 * "Changed" is ALWAYS a compare against the last SAVED snapshot — never a "touched" flag:
 *  - edit a value → dirty; put it back to what it was → clean again;
 *  - a successful save re-takes the snapshot (`mark()`) → clean;
 *  - a failed save leaves the snapshot alone → still dirty, Save stays enabled.
 * The compare is a STABLE deep-equal (`sameValue`): object key order never matters, `undefined` keys count as absent,
 * numbers / strings / booleans / null / arrays / Dates / Sets / Maps compare by value.
 */

/** JSON-ish canonical text of a value: sorted object keys, `undefined` / functions dropped, Sets / Maps as sorted pairs. */
export function stableJson(value: unknown): string {
  return JSON.stringify(canon(value, 0));
}

function canon(v: unknown, depth: number): unknown {
  if (depth > 64) return null;
  if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return undefined;
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString();
  if (Array.isArray(v)) return v.map(x => { const c = canon(x, depth + 1); return c === undefined ? null : c; });
  if (v instanceof Set) return { __set: [...v].map(x => stableJson(x)).sort() };
  if (v instanceof Map) return { __map: [...v.entries()].map(([k, x]) => [stableJson(k), canon(x, depth + 1)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) };
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const c = canon((v as Record<string, unknown>)[k], depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return null;
}

/** Deep, key-order-free equality (see stableJson). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return stableJson(a) === stableJson(b);
}

/** One screen's saved snapshot and its live dirty state. */
export interface DirtySnapshot<T> {
  /** True only while the live value differs from the last saved snapshot (false before the first `mark`). */
  readonly dirty: Signal<boolean>;
  /** A snapshot has been taken (the record is on screen). */
  readonly ready: Signal<boolean>;
  /** Take the snapshot — after the load and after every SUCCESSFUL save. Defaults to the live value. */
  mark(value?: T): void;
  /** A deep copy of the saved value (Discard puts it back), or undefined before the first `mark`. */
  saved(): T | undefined;
  /** Forget the snapshot (the record left the screen): dirty is false until the next `mark`. */
  clear(): void;
}

/**
 * The snapshot compare for a signal-backed model:
 *
 *   private readonly snap = dirtySnapshot(() => this.form());
 *   readonly dirty = this.snap.dirty;              // [disabled]="!dirty()" on Save
 *   load(r)  { this.form.set(r); this.snap.mark(); }
 *   save()   { api.put(...).subscribe({ next: () => this.snap.mark(), error: () => {} /* stays dirty *\/ }); }
 *   discard(){ this.form.set(this.snap.saved()!); }
 *
 * `current` is read inside a computed, so any signal it reads keeps `dirty` live.
 */
export function dirtySnapshot<T>(current: () => T): DirtySnapshot<T> {
  const savedText = signal<string | null>(null);
  let savedCopy: { v: T } | null = null;
  const ready = computed(() => savedText() !== null);
  const dirty = computed(() => {
    const s = savedText();
    return s !== null && stableJson(current()) !== s;
  });
  return {
    dirty,
    ready,
    mark: (value?: T) => {
      const v = value === undefined ? current() : value;
      savedCopy = { v: deepCopy(v) };
      savedText.set(stableJson(v));
    },
    saved: () => (savedCopy ? deepCopy(savedCopy.v) : undefined),
    clear: () => { savedCopy = null; savedText.set(null); },
  };
}

function deepCopy<T>(v: T): T {
  try { return structuredClone(v); } catch { /* not cloneable (functions inside) */ }
  try { return JSON.parse(JSON.stringify(v)) as T; } catch { return v; }
}

/**
 * The same compare for a reactive form: `dirty` = the form's raw value differs from the snapshot (Angular's own
 * `form.dirty` only says "touched" and stays true after a revert). Pass the DestroyRef that owns the form.
 */
export function formSnapshot(form: AbstractControl, destroyRef?: DestroyRef): DirtySnapshot<unknown> {
  const tick = signal(0);
  const read = () => { tick(); return rawValue(form); };
  const snap = dirtySnapshot<unknown>(read);
  const sub = form.valueChanges.subscribe(() => tick.update(n => n + 1));
  const statusSub = form.statusChanges.subscribe(() => tick.update(n => n + 1));
  destroyRef?.onDestroy(() => { sub.unsubscribe(); statusSub.unsubscribe(); });
  return {
    ...snap,
    mark: (value?: unknown) => {
      snap.mark(value === undefined ? rawValue(form) : value);
      // Angular's own flags follow the snapshot so `form.dirty` / `pristine` styling agrees with Save.
      form.markAsPristine();
    },
  };
}

function rawValue(form: AbstractControl): unknown {
  const f = form as AbstractControl & { getRawValue?: () => unknown };
  return typeof f.getRawValue === 'function' ? f.getRawValue() : form.value;
}

/**
 * Per-cell edits of a batch-save grid (Test Master): each cell remembers the value it had when first edited, and an
 * edit back to that value REMOVES the pending change (a row with none left is no longer counted).
 */
export class EditLedger<V = unknown> {
  private readonly _edits = signal<ReadonlyMap<string, Readonly<Record<string, V>>>>(new Map());
  private readonly originals = new Map<string, Record<string, V>>();
  /** Pending edits: row id → { field: new value }. */
  readonly edits = this._edits.asReadonly();
  /** Rows with at least one pending edit. */
  readonly count = computed(() => this._edits().size);
  readonly dirty = computed(() => this._edits().size > 0);

  /** Record an edit of `field` on `id`; `original` is the value the cell showed before this edit. */
  set(id: string, field: string, original: V, value: V): void {
    const orig = this.originals.get(id) ?? {};
    if (!(field in orig)) { orig[field] = original; this.originals.set(id, orig); }
    const base = orig[field];
    this._edits.update(prev => {
      const next = new Map(prev);
      const row = { ...(next.get(id) ?? {}) } as Record<string, V>;
      if (sameValue(value, base)) delete row[field];
      else row[field] = value;
      if (Object.keys(row).length === 0) next.delete(id);
      else next.set(id, row);
      return next;
    });
  }
  /** The value a row's field had before it was first edited (undefined when never edited). */
  original(id: string, field: string): V | undefined { return this.originals.get(id)?.[field]; }
  /** Drop one row's pending edits (e.g. the row was reverted on the server). */
  drop(id: string): void {
    this.originals.delete(id);
    this._edits.update(prev => { if (!prev.has(id)) return prev; const n = new Map(prev); n.delete(id); return n; });
  }
  /** After a successful save (or a discard): nothing is pending, originals forgotten. */
  clear(): void { this.originals.clear(); this._edits.set(new Map()); }
}
