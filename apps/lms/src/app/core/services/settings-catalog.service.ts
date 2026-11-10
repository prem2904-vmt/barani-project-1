import { Injectable, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { canOpenRoute } from '../auth/route-access';
import { BetaFeaturesService } from './beta-features.service';
import { LabFeaturesService } from './lab-features.service';
import { ProcessWorkflowService } from './process-workflow.service';
import { TenantEntitlementsService } from './tenant-entitlements.service';
import { CasesheetGateService } from '../../features/casesheets/shared/casesheet-gate.service';
import { SETTINGS_CATALOG, SettingsEntry } from '../../shared/utils/settings-catalog';
import { searchSettings } from '../../shared/utils/settings-search';

/**
 * The settings catalog as THIS person sees it: only entries whose page they can
 * open (the same ROUTE_ACCESS table the guards use — permissions, workflow
 * actions, module entitlements), whose card permission they hold, and whose
 * beta / lab feature / module is on. Read live on every call (the session,
 * workflow and entitlements can load after a page is built).
 */
@Injectable({ providedIn: 'root' })
export class SettingsCatalogService {
  private readonly auth = inject(AuthService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly beta = inject(BetaFeaturesService);
  private readonly features = inject(LabFeaturesService);
  private readonly casesheetGate = inject(CasesheetGateService);

  canSee(e: SettingsEntry): boolean {
    const hasAny = (p: string[]) => this.auth.hasAnyPermission(p);
    if (!canOpenRoute(e.href, {
      hasAny,
      isEnabled: (a) => this.process.isEnabled(a),
      moduleEnabled: (m) => this.entitlements.moduleEnabled(m),
    })) return false;
    if (e.perms?.length && !hasAny([...e.perms])) return false;
    if (e.beta && !this.beta.enabled(e.beta)) return false;
    if (e.feature === 'homeCollection' && !this.features.homeCollectionEnabled()) return false;
    if (e.casesheets && !this.casesheetGate.visible()) return false;
    if (e.module && !this.entitlements.moduleEnabled(e.module)) return false;
    return true;
  }

  visible(): SettingsEntry[] {
    return SETTINGS_CATALOG.filter((e) => this.canSee(e));
  }

  /** Ranked, precise search over what this person can open. */
  search(query: string | null | undefined): SettingsEntry[] {
    return searchSettings(this.visible(), query, (e) => e.title, (e) => e.keywords ?? []);
  }
}
