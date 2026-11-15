import { Injectable, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { FilesAccessService } from '../files/files-access.service';
import { FILES_APPS, FilesApp, filesApp } from '../files/files-registry';

/** What a screen hands the editor. Exactly one of `bytes` / `fileId` / `insert` (or none = a blank file). */
export interface SheetOpenRequest {
  /** Which app (default Neuron, the sheet editor). */
  app?: string;
  /** Where the bytes came from when it is a file on this device (save goes back there). */
  target?: import('../files/files-device.service').FileTarget;
  /** A built-in template to build in the engine (`file.new` + params). */
  template?: { cmd: string; params: Record<string, unknown> };
  /** A new file made from this stored one (a lab template, a Save as): the server copies its patient-data flag. */
  copyOf?: string;
  /** Prefrontal put patient data into the bytes (results, patient, report, partner_report, image): the file is flagged when it is first saved. */
  phi?: string;
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
 * THE way into the Files editors: any screen calls `open(...)` and the editor opens as a full in-app view (`/files/<kind>/<id|new>`); the back
 * chevron returns to the screen it came from (router history). Behind the `neuron` beta and the lab's per-app switch: off, or without a role that
 * may read the app's files, `open` does nothing and `available()` is false, so a screen simply never shows its "Open in sheet / Open in Myelin"
 * action. A lab without Full Files still gets the editor (View only): that is the editor's job, not a reason to hide the action.
 */
@Injectable({ providedIn: 'root' })
export class SheetEditorService {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly access = inject(FilesAccessService);

  private readonly _pending = signal<SheetOpenRequest | null>(null);
  private _cameFrom: string | null = null;

  /** The beta is on and this role may open files of the app (default Neuron). Screens show "Open in …" only while this is true. */
  available(app: string = 'neuron'): boolean {
    void this.access.ensureLoaded();
    return this.access.canRead(app);
  }

  async open(req: SheetOpenRequest): Promise<boolean> {
    const app: FilesApp = filesApp(req.app ?? 'neuron') ?? FILES_APPS[0];
    if (!this.available(app.id)) return false;
    this._pending.set(req);
    this._cameFrom = this.router.url;
    return this.router.navigateByUrl(`/files/${app.route}/${req.fileId ?? 'new'}`);
  }

  /** The editor takes the request once (a reload shows the file again by its id, or a blank one). */
  take(): SheetOpenRequest | null {
    const r = this._pending();
    this._pending.set(null);
    return r;
  }
  /** True when a screen opened the editor (back goes to it), false when it was opened from Files itself. */
  get openedFromScreen(): boolean { return this._cameFrom !== null; }
  /** The screen the editor was opened from (its section stays lit in the nav). */
  get originUrl(): string | null { return this._cameFrom; }
  /** The URL the nav should treat as current: while an editor is open, the screen it came from. */
  navUrl(url: string): string {
    return /^\/files\/[a-z]+\/[^/]+$/.test(url.split('?')[0]) && this._cameFrom ? this._cameFrom.split('?')[0] : url;
  }

  /** Back to the exact screen it came from (router history keeps its URL, so its filters come back with it). */
  back(): void {
    const from = this._cameFrom;
    this._cameFrom = null;
    if (from && typeof history !== 'undefined' && history.length > 1) this.location.back();
    else void this.router.navigateByUrl(from ?? '/files');
  }
  clearOrigin(): void { this._cameFrom = null; }
}
