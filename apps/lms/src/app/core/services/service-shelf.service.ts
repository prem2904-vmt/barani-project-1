import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { AuthService } from '../auth/auth.service';
import { TenantEntitlementsService } from './tenant-entitlements.service';
import { OpdGateService } from '../../features/opd/shared/opd-gate.service';
import { opdAreasFor } from '../../features/opd/shared/opd-nav';
import {
  EMPTY_TALLY, ServiceChip, ServiceDef, ServiceFilter, ServiceTally, availableServices, effectiveService, serviceChips,
  showServiceShelf,
} from './service-shelf';

/**
 * Frontdesk "Services" shelf state (bottom bar, owner 2026-11-19). ONE home for:
 *  - which services the user has (service-shelf.ts `availableServices` over the existing gates),
 *  - the chosen service — remembered per user in localStorage (`pf-lms.frontdesk.service.<userId>`, try/catch) and
 *    falling back to All when that service is not (or no longer) granted,
 *  - the counts the Frontdesk landing publishes (it owns the rows; the shelf never fetches),
 *  - whether the shelf shows: only inside the Frontdesk area and only for 2+ services. Lab keeps its Drafts shelf and
 *    never shows Services.
 * The selection UX will be refined later — keep every rule here, never in the landing or the bar.
 */
@Injectable({ providedIn: 'root' })
export class ServiceShelfService {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly opdGate = inject(OpdGateService);

  private readonly url = signal<string>(this.router.url ?? '');
  private readonly _saved = signal<string | null>(null);
  private readonly _savedFor = signal<string | null>(null);
  private readonly _tally = signal<ServiceTally>(EMPTY_TALLY);

  /** The services the user has, in shelf order. */
  readonly services = computed<ServiceDef[]>(() => {
    this.auth.user();                    // permissions / opdEntitled live on the profile
    this.entitlements.modules();         // re-read once the tenant's modules load
    return availableServices({
      moduleOn: id => this.entitlements.moduleOn(id),
      opdVisible: this.opdGate.visible(),
      opdDesk: opdAreasFor(p => this.auth.hasAnyPermission(p)).some(a => a.id === 'desk'),
    });
  });

  /** Inside the Frontdesk work area (/frontdesk and its screens). */
  readonly inArea = computed(() => ServiceShelfService.isFrontdesk(this.url()));

  /** The shelf renders: Frontdesk area AND 2+ services. */
  readonly visible = computed(() => this.inArea() && showServiceShelf(this.services()));

  /** The filter in force: the remembered choice when still granted, else All. A single service never filters. */
  readonly selected = computed<ServiceFilter>(() => {
    if (!showServiceShelf(this.services())) return 'all';
    return effectiveService(this.savedChoice(), this.services());
  });

  readonly chips = computed<ServiceChip[]>(() => serviceChips(this.services(), this._tally(), this.selected()));

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(e => this.url.set(e.urlAfterRedirects || e.url));
  }

  /** The landing publishes what its two panels hold (before the service filter). */
  publish(tally: ServiceTally): void { this._tally.set(tally); }

  select(id: ServiceFilter): void {
    const key = this.storageKey();
    this._saved.set(id);
    this._savedFor.set(key);
    if (!key) return;
    try { localStorage.setItem(key, id); } catch { /* private mode: not remembered */ }
  }

  /** Per user: the key carries the signed-in user's id. */
  private storageKey(): string | null {
    const id = this.auth.user()?.id;
    return id ? `pf-lms.frontdesk.service.${id}` : null;
  }

  private savedChoice(): string | null {
    const key = this.storageKey();
    if (this._savedFor() === key && this._saved() !== null) return this._saved();
    if (!key) return null;
    try { return localStorage.getItem(key); } catch { return null; }
  }

  static isFrontdesk(url: string): boolean {
    return url === '/frontdesk' || url.startsWith('/frontdesk/') || url.startsWith('/frontdesk?') || url.startsWith('/frontdesk#');
  }
}
