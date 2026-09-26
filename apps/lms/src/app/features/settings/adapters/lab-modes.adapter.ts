import { Injectable, inject } from '@angular/core';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { SettingAdapter } from './adapter';

/**
 * Read-only: where billing and collection happen. The Workflow (Process
 * builder) is the source of truth, so Settings only shows it and links there.
 * It reflects the ACTIVE branch (the workflow the app has loaded).
 */
@Injectable({ providedIn: 'root' })
export class LabModesAdapter implements SettingAdapter {
  private readonly cfg = inject(BranchLabConfigService);

  ensure(): void { this.cfg.ensureLoaded(); }
  loaded(): boolean { return true; }
  read(key: string): unknown {
    if (key === 'counters') {
      const bill = this.cfg.billingMode() === 'separate_counter' ? 'Bill at a counter' : 'Bill at front desk';
      const collect = this.cfg.collectsAtFrontdesk() ? 'Collect at front desk' : 'Collect at a counter';
      return `${bill} · ${collect}`;
    }
    return undefined;
  }
  write(): Promise<void> { return Promise.reject(new Error('Change this in Workflow.')); }
}
