import { Injectable, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { AuthService } from '../../core/auth/auth.service';
import { neuronAccess } from './neuron-access';

/** What a screen hands the sheet editor. Exactly one of `bytes` / `fileId` / `insert` (or none = a blank sheet). */
export interface SheetOpenRequest {
  /** The screen it opens from ("Insights", "Reports"): only used in wording. */
  source: string;
  name?: string;
  bytes?: ArrayBuffer;
  /** A stored sheet. */
  fileId?: string;
  /** Open the editor with "Insert results" ready for these tests / dates; with `auto` it fetches them at once. */
  insert?: { testIds?: string[]; from?: string; to?: string; branchId?: string | null; auto?: boolean };
  readonly?: boolean;
}

/**
 * THE way into the sheet editor: any screen calls `open(...)` and the editor opens as a full in-app view (`/sheet`); the back
 * chevron returns to the screen it came from (router history). Behind the `neuron` beta: off, or without a role that may read
 * results, `open` does nothing and `available()` is false, so a screen simply never shows its "Open in sheet" action.
 */
@Injectable({ providedIn: 'root' })
export class SheetEditorService {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly beta = inject(BetaFeaturesService);
  private readonly auth = inject(AuthService);

  private readonly _pending = signal<SheetOpenRequest | null>(null);
  private _cameFrom: string | null = null;

  /** The beta is on and this role may open sheets. Screens show "Open in sheet" only while this is true. */
  available(): boolean {
    return this.beta.enabled('neuron') && neuronAccess(c => this.auth.hasAnyPermission(c)).read;
  }

  async open(req: SheetOpenRequest): Promise<boolean> {
    if (!this.available()) return false;
    this._pending.set(req);
    this._cameFrom = this.router.url;
    return this.router.navigateByUrl('/sheet');
  }

  /** The editor takes the request once (a reload of /sheet shows the Sheets list). */
  take(): SheetOpenRequest | null {
    const r = this._pending();
    this._pending.set(null);
    return r;
  }
  /** True when a screen opened the editor (back goes to it), false for the Sheets list. */
  get openedFromScreen(): boolean { return this._cameFrom !== null; }
  /** The screen the editor was opened from (its section stays lit in the nav). */
  get originUrl(): string | null { return this._cameFrom; }
  /** The URL the nav should treat as current: while the editor is open, the screen it came from. */
  navUrl(url: string): string {
    return url.split('?')[0] === '/sheet' && this._cameFrom ? this._cameFrom.split('?')[0] : url;
  }

  /** Back to the exact screen it came from (router history keeps its URL, so its filters come back with it). */
  back(): void {
    const from = this._cameFrom;
    this._cameFrom = null;
    if (from && typeof history !== 'undefined' && history.length > 1) this.location.back();
    else void this.router.navigateByUrl(from ?? '/');
  }
  clearOrigin(): void { this._cameFrom = null; }
}
