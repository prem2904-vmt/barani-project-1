import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ProcessWorkflowService } from '../services/process-workflow.service';

/**
 * Route guard tied to the admin process workflow. Each workflow ACTION is a
 * placeable component/feature; this guard admits the route only when that
 * action is enabled in the tenant's active workflow. Turning the action OFF in
 * /admin/process therefore removes the whole feature — its screen and any deep
 * link to it — not just a button in the UI.
 *
 * Fail-open: when there's no active workflow, or the workflow doesn't mention
 * this action, access is allowed. Only an action that is present AND explicitly
 * disabled is blocked, so a silent/partial workflow can never lock anyone out.
 */
export type WorkflowGuardFn = CanActivateFn & { readonly workflowActions: readonly string[] };

export const workflowGuard = (actionType: string): WorkflowGuardFn => {
  const guard: CanActivateFn = async () => {
    const process = inject(ProcessWorkflowService);
    const router = inject(Router);
    await process.ensureLoaded();
    if (process.isEnabled(actionType)) return true;
    // Feature switched off for this tenant — send them back to the landing.
    return router.createUrlTree(['/']);
  };
  return Object.assign(guard, { workflowActions: [actionType] });
};

/**
 * OR-variant: admits the route when ANY of the listed actions is enabled.
 * Needed where one screen serves several workflow actions — e.g. order-create
 * is the target of BOTH walk-in orders and appointment→order conversion, so
 * disabling walk_in_order alone must not break converting an appointment.
 */
export const workflowGuardAny = (...actionTypes: string[]): WorkflowGuardFn => {
  const guard: CanActivateFn = async () => {
    const process = inject(ProcessWorkflowService);
    const router = inject(Router);
    await process.ensureLoaded();
    if (actionTypes.some(t => process.isEnabled(t))) return true;
    return router.createUrlTree(['/']);
  };
  return Object.assign(guard, { workflowActions: [...actionTypes] });
};
