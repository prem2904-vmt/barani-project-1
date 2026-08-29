import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ModuleScopeService } from './module-scope.service';
import { DialogService } from './dialog.service';
import { NavTarget, consultTarget, labOrderTarget, newOrderTarget } from '../../shared/opd/order-entry';

/**
 * Single entry point for starting a NEW order from anywhere (frontdesk landing,
 * patient profile, search, post-register). Routes lab / OPD by the user's module
 * scope so every call site shares one rule.
 *
 * PRODUCTION-SAFETY: with OPD off/unscoped, {@link ModuleScopeService.mode} is
 * `'lab'`, so this navigates to the existing lab order screen exactly as the
 * direct `router.navigate(['/frontdesk/order'], …)` calls do today. Call sites
 * can swap to this with no behavioural change until OPD is switched on.
 */
@Injectable({ providedIn: 'root' })
export class OrderEntryService {
  private readonly router = inject(Router);
  private readonly scope = inject(ModuleScopeService);
  private readonly dialog = inject(DialogService);

  /** Navigate to the right "new order" screen. Returns the router's navigation
   *  result so callers that gate UI on it (e.g. the register button's settle
   *  logic, OPS-49) keep working. */
  async startNewOrder(patientId?: string | null): Promise<boolean> {
    let target: NavTarget | 'choose' = newOrderTarget(this.scope.mode(), patientId);
    if (target === 'choose') {
      // Both modules usable — ask. (Temporary two-option picker; becomes the
      // Test/Consultation dropdown when both-module tenants exist. Dormant today.)
      const consult = await this.dialog.confirm({
        title: 'New order',
        message: 'What would you like to create for this patient?',
        confirmLabel: 'Consultation',
        cancelLabel: 'Lab test order',
        tone: 'primary',
      });
      target = consult ? consultTarget(patientId) : labOrderTarget(patientId);
    }
    return this.router.navigate(target.commands, target.queryParams ? { queryParams: target.queryParams } : {});
  }
}
