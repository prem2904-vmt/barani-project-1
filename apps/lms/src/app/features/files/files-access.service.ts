import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { DeviceClassService } from '../../core/services/device-class.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { FILES_APPS, FilesApp, filesApp } from './files-registry';
import { OfficeAccess, OfficeService, OfficeSettings } from './office.service';

/** The sheet permissions (mirror of the server's sets): without one of these there is no Neuron at all. Other apps need only a sign-in. */
const SHEET_READ = ['view_report', 'validate_result', 'enter_result', 'view_analytics'];
const SHEET_WRITE = ['validate_result', 'enter_result', 'view_analytics'];

/**
 * THE one answer, in the UI, to "may this person see / open / change files of this app here?". Beta gate (dev) and a sign-in come first;
 * the lab's per-app switches and edit roles come from the server (GET /api/office/settings → access); the PLATFORM level (View only vs
 * Full) comes from the tenant entitlement. Everything fails SAFE while loading: nothing writable, nothing flashing in.
 * The server enforces the same rules; this only decides what to show.
 */
@Injectable({ providedIn: 'root' })
export class FilesAccessService {
  private readonly office = inject(OfficeService);
  private readonly beta = inject(BetaFeaturesService);
  private readonly auth = inject(AuthService);
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly device = inject(DeviceClassService);

  private readonly _access = signal<OfficeAccess | null>(null);
  private readonly _settings = signal<OfficeSettings | null>(null);
  private readonly _loaded = signal(false);
  private inflight: Promise<void> | null = null;

  readonly loaded = this._loaded.asReadonly();
  readonly settings = this._settings.asReadonly();
  readonly access = this._access.asReadonly();

  /** The beta is on (dev + console switch + server flag) AND someone is signed in. Files is invisible without it. */
  readonly available = computed(() => this.beta.enabled('neuron') && !!this.auth.user());
  /** Full Files (the platform admin entitled this lab). false = VIEW ONLY, also while this is still loading. */
  readonly full = computed(() => this.entitlements.filesFull());
  readonly viewOnly = computed(() => !this.full());
  readonly phone = computed(() => this.device.deviceClass() === 'phone');
  /** Phones view and copy only, unless the lab allowed editing on phones. */
  readonly phoneCanEdit = computed(() => !this.phone() || this._access()?.editOnPhones === true);

  private has(codes: string[]): boolean { return this.auth.hasAnyPermission(codes); }

  /** App switched on for the lab and this person's role may open its files. Before the answer: only what the permissions already allow. */
  canRead(app: FilesApp | string): boolean {
    const a = typeof app === 'string' ? filesApp(app) : app;
    if (!a || !this.available()) return false;
    const acc = this._access()?.apps[a.kind];
    if (acc) return acc.enabled && acc.canRead;
    return a.kind === 'sheet' ? this.has(SHEET_READ) : true;
  }
  /** May change files of this app: Full Files, the app on, the role allowed, and (phones) the lab allows editing there. */
  canWrite(app: FilesApp | string): boolean {
    const a = typeof app === 'string' ? filesApp(app) : app;
    if (!a || !this.full() || !this.phoneCanEdit()) return false;
    const acc = this._access()?.apps[a.kind];
    if (!acc) return false;                                     // fail-safe: read-only until the server has answered
    return acc.enabled && acc.canWrite && (a.kind !== 'sheet' || this.has(SHEET_WRITE));
  }
  /** The apps this person may open (Start menu tiles, tabs, pins). */
  readonly apps = computed<FilesApp[]>(() => { this._access(); return FILES_APPS.filter(a => this.canRead(a)); });
  /** Files home itself is worth showing when at least one app opens. */
  readonly anyApp = computed(() => this.apps().length > 0);

  /** Load once (the nav primes it); a failure leaves the permission-only answers, never write rights. */
  ensureLoaded(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!this.available()) return Promise.resolve();
    this.inflight = this.office.settings().then(r => { this._access.set(r.access); this._settings.set(r.settings); this._loaded.set(true); })
      .catch(() => { this._loaded.set(true); });
    return this.inflight;
  }
  refresh(): Promise<void> { this.inflight = null; return this.ensureLoaded(); }
  reset(): void { this._access.set(null); this._settings.set(null); this._loaded.set(false); this.inflight = null; }
}
