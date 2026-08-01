import { Injectable, computed, inject, signal } from '@angular/core';
import { BillingMode, BranchLabConfig, CollectionMode } from '../../shared/models/branch-lab-config.model';
import { ApiService } from './api.service';
import { ProcessWorkflowService } from './process-workflow.service';
import { deriveModes, collectionLocations, collectsAtFrontdesk, hasDedicatedCollection } from '../../shared/models/process-workflow.model';

/**
 * Singleton for the current branch's lab config. Nav items, reception
 * screens, and the admin Lab Settings page all read `collectionMode` from
 * here. Loaded lazily on first access; refreshed after admin updates.
 */
@Injectable({ providedIn: 'root' })
export class BranchLabConfigService {
  private readonly api = inject(ApiService);
  private readonly process = inject(ProcessWorkflowService);

  private readonly _config = signal<BranchLabConfig | null>(null);
  private readonly _loaded = signal(false);
  private _loading = false;

  readonly config = this._config.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  // The active workflow is the SOURCE OF TRUTH for these modes (a billing/
  // collection action in its own menu = a separate counter). Falls back to the
  // stored config until the workflow loads.
  readonly collectionMode = computed<CollectionMode>(
    () => deriveModes(this.process.active())?.collectionMode ?? this._config()?.collectionMode ?? 'front_desk'
  );
  readonly billingMode = computed<BillingMode>(
    () => deriveModes(this.process.active())?.billingMode ?? this._config()?.billingMode ?? 'front_desk'
  );
  /** Multi-placement collection: which menus collection sits in, and whether it
   *  includes the frontdesk and/or a dedicated (non-frontdesk) location. When no
   *  workflow has loaded yet, fall back to the legacy single mode. */
  readonly collectionLocations = computed<string[]>(() => collectionLocations(this.process.active()));
  readonly collectsAtFrontdesk = computed<boolean>(() => {
    const cfg = this.process.active();
    return cfg ? collectsAtFrontdesk(cfg) : (this._config()?.collectionMode ?? 'front_desk') === 'front_desk';
  });
  readonly hasDedicatedCollection = computed<boolean>(() => {
    const cfg = this.process.active();
    return cfg ? hasDedicatedCollection(cfg) : (this._config()?.collectionMode ?? 'front_desk') === 'dedicated_counter';
  });
  /** Per-branch master switch for the inventory/Stores work area. The Stores
   *  nav entry only renders when this is true (and the user holds an inventory
   *  permission). Defaults to false until the config loads / if absent. */
  readonly inventoryEnabled = computed<boolean>(() => this._config()?.inventoryEnabled ?? false);
  /** Server-resolved queue focus for this branch. Queue screens (My Work,
   *  Receive, result-entry list) read this to group by patient vs sample.
   *  Defaults to 'patient' until the config loads. */
  readonly queueFocus = computed<'patient' | 'sample'>(() => this._config()?.effectiveQueueFocus ?? 'patient');
  /** True when this branch's queues are sample-focused (rows keyed by Sample ID). */
  readonly sampleFocused = computed<boolean>(() => this.queueFocus() === 'sample');

  ensureLoaded(): void {
    if (this._loaded() || this._loading) return;
    this._loading = true;
    this.api.get<BranchLabConfig>('/api/tenants/branch-lab-config').subscribe({
      next: cfg => {
        if (cfg) this._config.set(cfg);
        this._loaded.set(true);
        this._loading = false;
      },
      error: () => { this._loading = false; }
    });
  }

  update(next: BranchLabConfig): void { this._config.set(next); }

  reset(): void {
    this._config.set(null);
    this._loaded.set(false);
    this._loading = false;
  }
}
