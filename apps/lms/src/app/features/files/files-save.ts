import { Injectable, inject } from '@angular/core';
import { DialogService } from '../../core/services/dialog.service';
import { FilesApp, withAppExtension } from './files-registry';
import { OfficeConflictError, OfficeFile, OfficeService, toApiError } from './office.service';
import { SavedFile } from './files-bridge';

/** Which stored file the open sheet is (`id` null = never stored yet). */
export interface StoredRef { id: string | null; name: string; version: number | string | null; copyOf?: string | null }

export type SaveOutcome =
  | { kind: 'saved'; file: OfficeFile }
  | { kind: 'copy'; file: OfficeFile }
  | { kind: 'reload'; file: StoredRef }
  | { kind: 'kept' }
  | { kind: 'failed'; message: string };

/** "Budget.xlsx" → "Budget (copy).xlsx" (the extension of the app's own type; "Photo.jpg" → "Photo (copy).jpg"). */
export function copyName(name: string, ext = 'xlsx'): string {
  const m = /^(.*?)(\.[A-Za-z0-9]{1,5})?$/.exec(name.trim() || 'File');
  const e = m?.[2] ?? `.${ext}`;
  return `${(m?.[1] || 'File')} (copy)${e}`;
}

export const CONFLICT_TITLE = 'Someone else saved this file';
export const CONFLICT_MESSAGE = 'They saved a newer version while you were working. Nothing was overwritten. Reload their version (your changes are dropped), or keep yours as a separate copy.';

/**
 * Stores what the app hands over: POST when the sheet is new, PUT with If-Match when it is stored. A 409 NEVER overwrites:
 * the person chooses "Reload their version" or "Save mine as a copy" (or closes the dialog to keep editing). Never throws.
 */
@Injectable({ providedIn: 'root' })
export class FilesSaver {
  private readonly office = inject(OfficeService);
  private readonly dialog = inject(DialogService);

  /** `app` decides the kind and extension; `phi` = the reason this file holds patient data (results inserted…), sent with the FIRST save. */
  async store(cur: StoredRef, f: SavedFile, app: FilesApp, phi?: string | null): Promise<SaveOutcome> {
    try {
      if (cur.id === null || cur.version === null) return { kind: 'saved', file: await this.office.create(withAppExtension(app, cur.name), f.bytes, app.kind, { phiSource: phi ?? undefined, copyOf: cur.copyOf ?? undefined }) };
      return { kind: 'saved', file: await this.office.update(cur.id, cur.name, f.bytes, cur.version) };
    } catch (e) {
      if (e instanceof OfficeConflictError) return this.resolveConflict(cur, f, app);
      return { kind: 'failed', message: toApiError(e).message };
    }
  }

  private async resolveConflict(cur: StoredRef, f: SavedFile, app: FilesApp): Promise<SaveOutcome> {
    const r = await this.dialog.actions({
      title: CONFLICT_TITLE,
      message: CONFLICT_MESSAGE,
      actions: [
        { value: 'reload', label: 'Reload their version', variant: 'secondary' },
        { value: 'copy', label: 'Save mine as a copy', variant: 'primary' },
      ],
    });
    if (r.action === 'copy') {
      // copyOf: the copy of a file that holds patient data holds patient data (the server copies the flag).
      try { return { kind: 'copy', file: await this.office.create(copyName(cur.name, app.exts[0]), f.bytes, app.kind, { copyOf: cur.id ?? undefined }) }; }
      catch (e) { return { kind: 'failed', message: toApiError(e).message }; }
    }
    if (r.action === 'reload') return { kind: 'reload', file: cur };
    return { kind: 'kept' };
  }
}
