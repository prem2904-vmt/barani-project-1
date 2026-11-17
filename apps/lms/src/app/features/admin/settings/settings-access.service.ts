import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { canOpenRoute } from '../../../core/auth/route-access';
import { BetaFeaturesService } from '../../../core/services/beta-features.service';
import { LabFeaturesService } from '../../../core/services/lab-features.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { OpdGateService } from '../../opd/shared/opd-gate.service';
import { CasesheetGateService } from '../../casesheets/shared/casesheet-gate.service';
import {
  SETTINGS_SECTIONS, SettingsCategory, SettingsItem, SettingsRequires, SettingsSectionDef, categoryPath,
} from './settings-map';

/**
 * Who sees what in Settings — ONE answer for the overview, the shell and the settings search. A tile / category
 * shows only while the person can open its screen (the same ROUTE_ACCESS table the route guards read: permissions,
 * workflow actions, module entitlements), its beta is on, and the lab has the department it belongs to
 * (OPD, Pharmacy, IPD, Home collection). A tile hidden before stays hidden. Read live on every call.
 */
@Injectable({ providedIn: 'root' })
export class SettingsAccessService {
  private readonly auth = inject(AuthService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly beta = inject(BetaFeaturesService);
  private readonly labFeatures = inject(LabFeaturesService);
  private readonly opdGate = inject(OpdGateService);
  private readonly casesheetGate = inject(CasesheetGateService);

  canOpenHref(href: string): boolean {
    return canOpenRoute(href, {
      hasAny: (p) => this.auth.hasAnyPermission(p),
      isEnabled: (a) => this.process.isEnabled(a),
      moduleEnabled: (m) => this.entitlements.moduleEnabled(m),
    });
  }

  hasDepartment(r: SettingsRequires | undefined): boolean {
    switch (r) {
      case undefined: return true;
      case 'opd': return this.opdGate.visible();
      case 'pharmacy': return this.opdGate.visible() && this.entitlements.moduleOn('pharmacy');
      case 'ipd': return this.casesheetGate.visible();
      case 'homeCollection': return this.labFeatures.homeCollectionEnabled();
    }
  }

  categoryVisible(item: SettingsItem, cat: SettingsCategory): boolean {
    if (cat.beta && !this.beta.enabled(cat.beta)) return false;
    if (cat.perms?.length && !this.auth.hasAnyPermission([...cat.perms])) return false;
    return this.canOpenHref(categoryPath(item, cat));
  }

  visibleCategories(item: SettingsItem): SettingsCategory[] {
    if (!this.itemAllowed(item)) return [];
    return item.categories.filter((c) => this.categoryVisible(item, c));
  }

  private itemAllowed(item: SettingsItem): boolean {
    if (item.beta && !this.beta.enabled(item.beta)) return false;
    return this.hasDepartment(item.requires);
  }

  itemVisible(item: SettingsItem): boolean {
    return this.visibleCategories(item).length > 0;
  }

  visibleItems(section: SettingsSectionDef): SettingsItem[] {
    if (!this.hasDepartment(section.requires)) return [];
    return section.items.filter((i) => this.itemVisible(i));
  }

  /** Sections this person can open at least one setting in, in display order. */
  visibleSections(): Array<{ section: SettingsSectionDef; items: SettingsItem[] }> {
    return SETTINGS_SECTIONS
      .map((section) => ({ section, items: this.visibleItems(section) }))
      .filter((s) => s.items.length > 0);
  }
}
