import { Injectable, computed, inject } from '@angular/core';
import { ProcessWorkflowService } from './process-workflow.service';
import { TenantEntitlementsService } from './tenant-entitlements.service';
import { LabFeatureCtx, actionAvailable, appointmentsOn, homeCollectionOn } from '../modules/lab-features';

/**
 * Signal wrapper around the ONE lab-feature rule (`core/modules/lab-features`):
 * Home collection = tenant entitlement AND the workflow's Home Visits action;
 * Appointments = the workflow's Appointment action. Screens read these instead
 * of checking the workflow or the entitlement on their own.
 */
@Injectable({ providedIn: 'root' })
export class LabFeaturesService {
  private readonly process = inject(ProcessWorkflowService);
  private readonly entitlements = inject(TenantEntitlementsService);

  // No eager load here: the shell primes both sources (nav + guards), and the
  // route guards await them — reading before they land is fail-open to the
  // catalog defaults, the same as every other nav surface.

  private ctx(): LabFeatureCtx {
    return { workflow: this.process.active(), moduleEnabled: m => this.entitlements.moduleEnabled(m) };
  }

  readonly homeCollectionEnabled = computed(() => homeCollectionOn(this.ctx()));
  readonly appointmentsEnabled = computed(() => appointmentsOn(this.ctx()));

  /** A workflow action is on AND its module (if any) is entitled. */
  actionAvailable(type: string): boolean { return actionAvailable(this.ctx(), type); }

  /** Resolve once both the workflow and the entitlements have loaded. */
  ensureLoaded(): Promise<void> {
    return Promise.all([
      Promise.resolve(this.process.ensureLoaded?.()).catch(() => undefined),
      Promise.resolve(this.entitlements.ensureLoaded?.()).catch(() => undefined),
    ]).then(() => undefined);
  }
}
