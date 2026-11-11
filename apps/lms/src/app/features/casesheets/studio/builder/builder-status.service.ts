import { InjectionToken, Injectable, computed, inject, signal } from '@angular/core';
import { cortexBuilderOn } from '../../shared/cortex-builder-gate';
import { CaseSheetBuilderApi } from './builder-api';
import { BuilderStatus } from './builder-models';

/** Is the console switch `pf.cortexBuilder()` on? A token so specs can flip it (Node's localStorage is inert on the Mac). */
export const CORTEX_BUILDER_ON = new InjectionToken<() => boolean>('CORTEX_BUILDER_ON', { providedIn: 'root', factory: () => () => cortexBuilderOn() });

/**
 * What the server says the builder offers this person (GET builder/status). Nothing is asked unless the console switch is
 * on, and a refusal / missing endpoint simply leaves the beta hidden. Studio's buttons and the lab switch read only this.
 */
@Injectable({ providedIn: 'root' })
export class BuilderStatusService {
  private readonly api = inject(CaseSheetBuilderApi);
  private readonly flag = inject(CORTEX_BUILDER_ON);
  private loading: Promise<void> | null = null;

  readonly status = signal<BuilderStatus | null>(null);
  /** Flag on AND the server answered: the Checks panel / lab switch may show. */
  readonly available = computed(() => this.flag() && this.status() !== null);
  /** The in-app Cortex chat may show. */
  readonly cortex = computed(() => this.available() && this.status()!.cortex);
  readonly canChangeSwitch = computed(() => this.available() && this.status()!.canChangeSwitch);

  /** Ask once (again with force). Never throws. */
  load(force = false): Promise<void> {
    if (!this.flag()) return Promise.resolve();
    if (this.loading && !force) return this.loading;
    if (this.status() && !force) return Promise.resolve();
    this.loading = this.api.status().then((s) => this.status.set(s), () => this.status.set(null)).finally(() => (this.loading = null));
    return this.loading;
  }

  /** The switch was flipped here: keep what's on screen in step without another round trip. */
  setSwitch(on: boolean): void {
    const s = this.status();
    if (s) this.status.set({ ...s, connector: on, connectorSwitch: on });
  }
}
