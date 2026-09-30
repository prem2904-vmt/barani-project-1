/**
 * LAB FEATURE AVAILABILITY — the ONE rule for "is Home collection / are
 * Appointments on for this user's lab right now?". Every surface (nav, route
 * guards via ROUTE_ACCESS, front-desk tabs, the lab-settings hub, the admin
 * overview + its search, the booking form, work-area hubs) resolves through
 * here, so switching a feature off can never leave one surface behind.
 *
 * Two independent switches, BOTH must be on:
 *  1. the tenant MODULE ENTITLEMENT (control plane / Admin → Modules; a tenant
 *     with no config row has everything on) — `homeCollection` is a Lab feature;
 *  2. the branch's active PROCESS WORKFLOW action (`home_visits`,
 *     `appointment`) — switched off, dragged back to the palette, or its whole
 *     work area deleted in /admin/process.
 *
 * Workflow semantics: with no active workflow, every action is on (classic
 * flow). With a workflow, an action is on while ANY copy of it is placed and
 * enabled. `appointment` and `home_visits` are OPT-IN: absent from an active
 * workflow = off, because the admin removed them (they are in every shipped
 * default). Other actions stay fail-open when the workflow is silent (newer
 * catalog entries older workflows never mention). This matches the backend
 * (`LabFeatureGate`, which also reads "absent ⇒ off" for these two).
 *
 * Pure (no Angular DI) so nav builders, guards and specs share it.
 */
import type { ProcessWorkflowConfig } from '../../shared/models/process-workflow.model';
import type { ModuleKey } from '../services/tenant-entitlements.service';

/** Actions that are off when an active workflow does not place them. */
export const OPT_IN_WORKFLOW_ACTIONS: ReadonlySet<string> = new Set(['appointment', 'home_visits']);

/** The tenant module entitlement behind a workflow action (if any). */
export const ACTION_MODULE: Readonly<Record<string, ModuleKey>> = { home_visits: 'homeCollection' };

/** Is a process-workflow action on? (See the header for the semantics.) */
export function workflowActionOn(cfg: ProcessWorkflowConfig | null | undefined, type: string): boolean {
  if (!cfg) return true;
  const copies = (cfg.actions ?? []).filter(a => a.type === type);
  if (copies.length) return copies.some(a => a.enabled);
  return !OPT_IN_WORKFLOW_ACTIONS.has(type);
}

export interface LabFeatureCtx {
  /** The active (normalised) process workflow; null = none / not loaded. */
  workflow: ProcessWorkflowConfig | null | undefined;
  /** Tenant module entitlement (TenantEntitlementsService.moduleEnabled). */
  moduleEnabled: (m: ModuleKey) => boolean;
}

/** A workflow action is usable: the workflow has it on AND the tenant is
 *  entitled to the module behind it. */
export function actionAvailable(ctx: LabFeatureCtx, type: string): boolean {
  const mod = ACTION_MODULE[type];
  return workflowActionOn(ctx.workflow, type) && (!mod || ctx.moduleEnabled(mod));
}

/** Home collection (front-desk tab + assignment, agent visits, agents admin,
 *  the booking form's "Home collection" option). */
export function homeCollectionOn(ctx: LabFeatureCtx): boolean {
  return actionAvailable(ctx, 'home_visits');
}

/** Appointments (front-desk tab, calendar, booking entry points). */
export function appointmentsOn(ctx: LabFeatureCtx): boolean {
  return actionAvailable(ctx, 'appointment');
}
