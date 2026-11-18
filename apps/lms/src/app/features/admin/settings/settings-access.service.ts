import { Injectable, Injector, computed, effect, inject, untracked } from '@angular/core';
import { SettingsSaveService } from '../../../shared/utils/settings-save';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import {
  SettingsArea, SettingsLevel, SettingsSaveMode, areaOfSection, isTestMasterPath, saveModeFor,
} from '../../../shared/utils/settings-access';
import { AuthService } from '../../../core/auth/auth.service';
import { LAB_SETTINGS_HUB_PERMS, canOpenRoute, canPassAccess } from '../../../core/auth/route-access';
import { BetaFeaturesService } from '../../../core/services/beta-features.service';
import { LabFeaturesService } from '../../../core/services/lab-features.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { OpdGateService } from '../../opd/shared/opd-gate.service';
import { CasesheetGateService } from '../../casesheets/shared/casesheet-gate.service';
import {
  SETTINGS_SECTIONS, SettingsCategory, SettingsItem, SettingsRequires, SettingsSectionDef, categoryPath, normPath, settingForPath,
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

  private readonly router = inject(Router, { optional: true });

  // ── Settings access (owner 2026-11-18) ──

  /** Which Settings area a path belongs to (Test Master pages are their own area inside Lab), or null outside Settings. */
  areaOf(path: string): SettingsArea | null {
    const p = normPath(path);
    if (isTestMasterPath(p)) return 'test_master';
    const hit = settingForPath(p);
    if (hit) return areaOfSection(hit.section.id);
    if (p.startsWith('/admin/ipd/')) return 'ipd';
    if (p.startsWith('/admin/opd/') || p.startsWith('/admin/pharmacy')) return 'opd';
    return null;
  }
  levelOf(area: SettingsArea): SettingsLevel {
    return typeof this.auth.settingsLevel === 'function' ? this.auth.settingsLevel(area) : 'admin';
  }
  /** Save / "Send for approval" / view only, for a settings path. Outside Settings: a normal Save. */
  saveModeFor(path: string): SettingsSaveMode {
    const area = this.areaOf(path);
    return area ? saveModeFor(this.levelOf(area), normPath(path)) : 'save';
  }
  private readonly url = this.router
    ? toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router!.url), startWith(this.router.url)),
      { initialValue: this.router.url })
    : () => '';
  /** The band Save's mode on the current screen (read by pf-settings-save, the shell and Test Master). */
  readonly saveMode = computed<SettingsSaveMode>(() => this.saveModeFor(this.url()));
  /** The person is only a contributor on this screen and it has no approval model yet: it is view only. */
  readonly viewOnly = computed(() => this.saveMode() === 'view');

  private readonly injector = inject(Injector);
  private synced = false;
  /** Keep the band Save's mode (SettingsSaveService.mode) in step with the screen — started once by the app (app.config). */
  syncSaveMode(): void {
    if (this.synced) return;
    this.synced = true;
    const save = this.injector.get(SettingsSaveService);
    effect(() => { const m = this.saveMode(); untracked(() => save.mode.set(m)); }, { injector: this.injector });
  }

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
    if (cat.beta) {
      const keys = typeof cat.beta === 'string' ? [cat.beta] : cat.beta;
      if (!keys.some((k) => this.beta.enabled(k))) return false;
    }
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

  /** The gates a section kept from before the re-home: Lab = the old Lab settings hub's permissions, lab module on. */
  private sectionGate(section: SettingsSectionDef): boolean {
    if (section.gate !== 'lab') return true;
    return canPassAccess({ perms: LAB_SETTINGS_HUB_PERMS, module: 'lab' }, {
      hasAny: (p) => this.auth.hasAnyPermission(p),
      moduleEnabled: (m) => this.entitlements.moduleEnabled(m),
    });
  }

  visibleItems(section: SettingsSectionDef): SettingsItem[] {
    if (!this.hasDepartment(section.requires) || !this.sectionGate(section)) return [];
    return section.items.filter((i) => this.itemVisible(i));
  }

  /** Sections this person can open at least one setting in, in display order. */
  visibleSections(): Array<{ section: SettingsSectionDef; items: SettingsItem[] }> {
    return SETTINGS_SECTIONS
      .map((section) => ({ section, items: this.visibleItems(section) }))
      .filter((s) => s.items.length > 0);
  }
}
