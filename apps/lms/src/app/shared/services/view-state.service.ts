import {
  DestroyRef, Injectable, Injector, WritableSignal, effect, inject, runInInjectionContext, untracked,
} from '@angular/core';
import type { AbstractControl } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { SessionScopeService } from '../../core/auth/session-scope.service';

/** One screen's remembered view: plain values keyed by field name. */
export type ViewStateBag = Record<string, unknown>;

/**
 * Screen view state (owner 2026-11-21): "set a filter, go to another screen and come back — it must be exactly as
 * I left it". ONE in-memory store, keyed per screen (+ tab), that every filter-bearing screen opts into.
 *
 *   Kept:   in-app navigation (the root singleton outlives the routed component).
 *   Fresh:  full page refresh / new tab (memory only — NEVER sessionStorage / localStorage), sign-out, user / tenant
 *           switch (SessionScopeService change), branch switch (BranchSwitchService calls clear(); and every read
 *           re-checks the owner so a stale bag can never leak into another branch / account).
 *
 * Long-lived preferences that already live in localStorage (column order, section order, per-user sort) stay where
 * they are — this is only the "where was I" state of a visit.
 *
 * Opt in from a component's field initialisers / constructor:
 *
 *   private readonly vs = inject(ViewStateService);
 *   constructor() { this.vs.bind('lab.my-work', { tab: this.tab, search: this.search }); }
 *
 * `bind` restores the saved values into the signals immediately (before ngOnInit / the first load) and then keeps
 * the bag in step with them. Forms: `bindControl(key, field, control)`. Grids: `<pf-data-grid viewStateKey="…">`
 * keeps the column filters, sort and scroll the same way.
 */
@Injectable({ providedIn: 'root' })
export class ViewStateService {
  private readonly scope = inject(SessionScopeService);
  private readonly auth = inject(AuthService, { optional: true });
  private readonly bags = new Map<string, ViewStateBag>();
  /** Who the bags belong to: `<tenant>:<user>|<branch>`. */
  private owner: string | null = null;

  constructor() {
    // Sign-out / another account signed in without a reload: forget everything.
    this.scope.onChange(() => this.clear());
  }

  /** The current account + branch. A change means "fresh defaults". */
  private currentOwner(): string {
    const branch = untracked(() => this.auth?.activeBranchId?.() ?? '');
    return `${this.scope.scopeKey()}|${branch ?? ''}`;
  }

  /** Drop every bag when the owner changed since the last access. */
  private checkOwner(): void {
    const now = this.currentOwner();
    if (this.owner !== now) { this.bags.clear(); this.owner = now; }
  }

  /** The saved bag for `key`, or undefined (never saved / cleared). */
  get<T extends ViewStateBag = ViewStateBag>(key: string): Partial<T> | undefined {
    this.checkOwner();
    const b = this.bags.get(key);
    return b ? ({ ...b } as Partial<T>) : undefined;
  }

  /** One field of a bag. */
  value<V = unknown>(key: string, field: string): V | undefined {
    return this.get(key)?.[field] as V | undefined;
  }

  /** Merge fields into a bag. */
  patch(key: string, part: ViewStateBag): void {
    this.checkOwner();
    this.bags.set(key, { ...(this.bags.get(key) ?? {}), ...part });
  }

  /** Forget one screen (`key`), every screen under a prefix (`'lab.'`), or everything (no argument). */
  clear(key?: string): void {
    if (key === undefined) { this.bags.clear(); this.owner = null; return; }
    if (key.endsWith('.')) { for (const k of [...this.bags.keys()]) if (k.startsWith(key)) this.bags.delete(k); return; }
    this.bags.delete(key);
  }

  /** Has anything been saved for `key`? */
  has(key: string): boolean {
    this.checkOwner();
    return this.bags.has(key);
  }

  /**
   * Restore `signals` from the bag `key` (fields that were saved), then keep the bag in step with them.
   * Call from an injection context (field initialiser / constructor) or pass `injector`.
   * Returns true when something was restored.
   */
  bind(key: string, signals: Record<string, WritableSignal<any>>, opts: { injector?: Injector } = {}): boolean {
    const saved = this.get(key);
    let restored = false;
    if (saved) {
      for (const [field, s] of Object.entries(signals)) {
        if (field in saved) { s.set(saved[field]); restored = true; }
      }
    }
    const injector = opts.injector ?? inject(Injector);
    const owner = this.currentOwner();
    effect(() => {
      const snap: ViewStateBag = {};
      for (const [field, s] of Object.entries(signals)) snap[field] = s();
      // A screen torn down by a branch / account switch never writes into the new owner's state.
      untracked(() => { if (this.currentOwner() === owner) this.patch(key, snap); });
    }, { injector });
    return restored;
  }

  /** Restore + track one form control (value only). Returns true when restored. */
  bindControl(key: string, field: string, control: AbstractControl, opts: { injector?: Injector } = {}): boolean {
    const saved = this.get(key);
    const restored = !!saved && field in saved;
    if (restored) control.setValue(saved![field], { emitEvent: true });
    const injector = opts.injector ?? inject(Injector);
    const owner = this.currentOwner();
    const sub = control.valueChanges.subscribe(v => { if (this.currentOwner() === owner) this.patch(key, { [field]: v }); });
    runInInjectionContext(injector, () => inject(DestroyRef).onDestroy(() => sub.unsubscribe()));
    return restored;
  }
}
