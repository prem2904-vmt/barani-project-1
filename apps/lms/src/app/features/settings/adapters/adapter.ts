import { WritableSignal, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiRequestOptions } from '../../../core/services/api.service';

/**
 * One backing store for Settings rows. Every method is keyed by the branch
 * the row edits (`null` for tenant / device / user stores), so a
 * branch-scoped row can edit a branch other than the active one.
 *
 * `read` is reactive (call it inside a computed / template); `write`
 * resolves once the server accepted the change and rejects with the server's
 * message, which the row shows as its one-line error after reverting.
 */
export interface SettingAdapter {
  ensure(branchId: string | null): void;
  loaded(branchId: string | null): boolean;
  read(key: string, branchId: string | null): unknown;
  write(key: string, value: unknown, branchId: string | null): Promise<void>;
}

/** X-Active-Branch for ONE call (the interceptor keeps a header we set). */
export function branchHeader(branchId: string | null): ApiRequestOptions | undefined {
  return branchId ? { headers: { 'X-Active-Branch': branchId } } : undefined;
}

/** A per-branch cache of signals: `null` key = tenant-wide. */
export class BranchCache<T> {
  private readonly map = new Map<string, WritableSignal<T | null>>();
  private readonly loading = new Set<string>();
  private readonly _tick = signal(0);

  private k(b: string | null): string { return b ?? '~'; }

  slot(b: string | null): WritableSignal<T | null> {
    const k = this.k(b);
    let s = this.map.get(k);
    if (!s) { s = signal<T | null>(null); this.map.set(k, s); this._tick.update((n) => n + 1); }
    return s;
  }
  /** Reactive: the cached value (null until loaded). Never creates a slot
   *  (reads happen inside computeds, where writing a signal is not allowed);
   *  `_tick` re-runs readers when a new branch's slot appears. */
  get(b: string | null): T | null {
    this._tick();
    return this.map.get(this.k(b))?.() ?? null;
  }
  set(b: string | null, v: T | null): void { this.slot(b).set(v); }
  isLoading(b: string | null): boolean { return this.loading.has(this.k(b)); }
  /** Start a load once; `done` stores the result. */
  load(b: string | null, src: () => Observable<T>, fallback: () => T): void {
    const k = this.k(b);
    if (this.loading.has(k) || (this.map.get(k)?.() ?? null) !== null) return;
    this.loading.add(k);
    src().subscribe({
      next: (v) => { this.loading.delete(k); this.slot(b).set(v ?? fallback()); },
      error: () => { this.loading.delete(k); this.slot(b).set(fallback()); },
    });
  }
  clear(): void { this.map.clear(); this.loading.clear(); this._tick.update((n) => n + 1); }
}

/**
 * Whole-object stores (billing, invoice template, appointments, culture, OPD,
 * ID formats): the endpoint only takes the full object. Each change queues a
 * mutator; after `debounceMs` the adapter RE-FETCHES the object (so another
 * admin's change isn't lost), applies every queued mutator in order, then
 * writes the whole thing once. All callers of that batch share the result.
 */
export abstract class WholeObjectStore<T extends object> {
  protected readonly cache = new BranchCache<T>();
  protected debounceMs = 600;
  private readonly pending = new Map<string, {
    muts: Array<(o: T) => T>;
    waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }>;
    timer: ReturnType<typeof setTimeout> | null;
  }>();

  protected abstract fetch(branchId: string | null): Observable<T>;
  protected abstract save(obj: T, branchId: string | null): Observable<unknown>;
  protected abstract defaults(): T;

  ensure(branchId: string | null): void {
    this.cache.load(branchId, () => this.fetch(branchId), () => this.defaults());
  }
  loaded(branchId: string | null): boolean { return this.cache.get(branchId) !== null; }
  obj(branchId: string | null): T { return this.cache.get(branchId) ?? this.defaults(); }

  /** Queue `mut` for this branch's object; resolves when the batch saved. */
  mutate(branchId: string | null, mut: (o: T) => T): Promise<void> {
    const k = branchId ?? '~';
    let p = this.pending.get(k);
    if (!p) { p = { muts: [], waiters: [], timer: null }; this.pending.set(k, p); }
    p.muts.push(mut);
    // Show the change at once (the row is optimistic anyway).
    this.cache.set(branchId, mut(this.obj(branchId)));
    const promise = new Promise<void>((resolve, reject) => p!.waiters.push({ resolve, reject }));
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => void this.flush(branchId), this.debounceMs);
    return promise;
  }

  private async flush(branchId: string | null): Promise<void> {
    const k = branchId ?? '~';
    const batch = this.pending.get(k);
    if (!batch) return;
    this.pending.delete(k);
    try {
      let fresh: T;
      try { fresh = { ...this.defaults(), ...((await firstValueFrom(this.fetch(branchId))) ?? {}) } as T; }
      catch { fresh = this.obj(branchId); }
      const next = batch.muts.reduce((o, m) => m(o), fresh);
      const saved = await firstValueFrom(this.save(next, branchId));
      this.cache.set(branchId, this.afterSave(next, saved));
      batch.waiters.forEach((w) => w.resolve());
    } catch (e) {
      // Put the server's truth back; each row reverts its own value.
      try { this.cache.set(branchId, { ...this.defaults(), ...((await firstValueFrom(this.fetch(branchId))) ?? {}) } as T); }
      catch { /* keep what we had */ }
      batch.waiters.forEach((w) => w.reject(e));
    }
  }

  /** What to cache after a save (the response when it is the object). */
  protected afterSave(sent: T, _response: unknown): T { return sent; }

  /** Tests: flush now instead of waiting for the debounce. */
  flushNow(branchId: string | null): Promise<void> {
    const p = this.pending.get(branchId ?? '~');
    if (p?.timer) clearTimeout(p.timer);
    return this.flush(branchId);
  }
}
