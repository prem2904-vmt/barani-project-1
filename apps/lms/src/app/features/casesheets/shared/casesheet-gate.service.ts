import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { isDevEnvironment } from '../../../core/beta/beta-gate';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { environment } from '../../../../environments/environment';
import { installPfCortexImport } from './cortex-import-gate';
import { casesheetsVisible, installPfCasesheets, ipdExplicitlyOn, readCasesheetsFlag, safeLocalStorage } from './casesheet-gate';

/**
 * THE case-sheet gate for the UI (case sheets are part of IPD). Every case-sheet surface — routes
 * (casesheetGuard), the /admin/ipd MyPrefrontal tile, the patient-profile "Case sheet" button, the role editor's
 * casesheet_* permissions — asks {@link visible}. Nothing else may decide case-sheet visibility.
 *
 * Inputs: the dev environment (read lazily — runtime config merges first), the tenant's STORED module map
 * (TenantEntitlementsService.modules(): ipd must be explicitly on), `/me.tenantKind`, and the console flag
 * (localStorage `pf.casesheets`, set by `pf.casesheets()`). Rule in ./casesheet-gate.ts (pure, unit-tested).
 */
@Injectable({ providedIn: 'root' })
export class CasesheetGateService {
  private readonly auth = inject(AuthService);
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly storage = safeLocalStorage();
  /** Read once per page load: `pf.casesheets()` reloads the page to apply. */
  private readonly flag = signal(readCasesheetsFlag(this.storage));

  private readonly inputs = computed(() => ({
    isDev: this.isDev(),
    consoleFlag: this.flag(),
    ipdExplicit: ipdExplicitlyOn(this.storedModules()),
    personalTenant: this.auth.user()?.tenantKind === 'personal',
  }));

  /** Show case sheets anywhere in the UI. */
  readonly visible = computed(() => casesheetsVisible(this.inputs()));


  /** The tenant's STORED module map; anything unreadable (not loaded, a partial service) ⇒ null ⇒ closed. */
  private storedModules(): ReturnType<TenantEntitlementsService['modules']> {
    try { return typeof this.entitlements.modules === 'function' ? this.entitlements.modules() : null; } catch { return null; }
  }

  /** Dev build / runtime? Reads `environment` lazily (overridable in specs). */
  protected isDev(): boolean { return isDevEnvironment(environment); }

  /**
   * Everything the gate reads is loaded (signed-in user + the tenant module map). Never throws. A personal space opens
   * the gate by its KIND and has no lab module map: the server fences every lab endpoint (`/api/tenants/modules`
   * included) to an empty 404 for it, so the map is never asked for.
   */
  async ready(): Promise<void> {
    await this.auth.waitForAuth();
    const u = this.auth.user();
    if (u && u.tenantKind !== 'personal') await this.entitlements.ensureLoaded?.();
  }

  /** Install `window.pf.casesheets()` silently. Called once at app start. */
  install(): void {
    if (typeof window === 'undefined' || !this.storage) return;
    installPfCasesheets(window as unknown as { pf?: Record<string, unknown> } & Record<string, unknown>,
      this.storage, () => { try { window.location.reload(); } catch { /* noop */ } });
    installPfCortexImport(window as unknown as { pf?: Record<string, unknown> } & Record<string, unknown>,
      this.storage, () => { try { window.location.reload(); } catch { /* noop */ } });
  }
}
