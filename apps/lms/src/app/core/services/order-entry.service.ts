import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { consultTarget, labOrderTarget } from '../../shared/opd/order-entry';

/**
 * Single entry point for starting a new LAB order or a new OPD CONSULT from
 * anywhere (frontdesk landing, patient profile, search, post-register).
 *
 * OWNER DECISION (2026-09-30): the front-desk cart is LAB, always — never a
 * "choose" dialog. OPD gets its OWN icon next to the cart wherever the cart
 * exists (see OpdGateService.visible()); the two entry points are separate
 * buttons, not one button with a fork inside it.
 *
 * PRODUCTION-SAFETY: `startNewOrder` is byte-identical to the direct
 * `router.navigate(['/frontdesk/order'], …)` calls it replaces — it never
 * branches on OPD. `startConsult` is additive and only ever reached from a
 * button that is itself gated on `OpdGateService.visible()`.
 */
@Injectable({ providedIn: 'root' })
export class OrderEntryService {
  private readonly router = inject(Router);

  /** Navigate to the lab order screen. Returns the router's navigation
   *  result so callers that gate UI on it (e.g. the register button's settle
   *  logic, OPS-49) keep working. */
  async startNewOrder(patientId?: string | null): Promise<boolean> {
    const target = labOrderTarget(patientId);
    return this.router.navigate(target.commands, target.queryParams ? { queryParams: target.queryParams } : {});
  }

  /** Navigate to the OPD "book a visit" screen (OPD dark build). */
  async startConsult(patientId?: string | null): Promise<boolean> {
    const target = consultTarget(patientId);
    return this.router.navigate(target.commands, target.queryParams ? { queryParams: target.queryParams } : {});
  }
}
