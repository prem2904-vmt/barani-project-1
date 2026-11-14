import { Injectable, inject } from '@angular/core';
import { DialogService } from '../../core/services/dialog.service';
import { OfficeConflictError, OfficeFile, OfficeService, toApiError } from './office.service';
import { SavedFile } from './neuron-bridge';

/** Which stored file the open sheet is (`id` null = never stored yet). */
export interface StoredRef { id: string | null; name: string; version: number | string | null }

export type SaveOutcome =
  | { kind: 'saved'; file: OfficeFile }
  | { kind: 'copy'; file: OfficeFile }
  | { kind: 'reload'; file: StoredRef }
  | { kind: 'kept' }
  | { kind: 'failed'; message: string };

/** "Budget.xlsx" → "Budget (copy).xlsx". */
export function copyName(name: string): string {
  const m = /^(.*?)(\.xlsx)?$/i.exec(name.trim() || 'Sheet');
  return `${(m?.[1] || 'Sheet')} (copy)${m?.[2] ?? '.xlsx'}`;
}

export const CONFLICT_TITLE = 'Someone else saved this file';
export const CONFLICT_MESSAGE = 'They saved a newer version while you were working. Nothing was overwritten. Reload their version (your changes in the sheet are dropped), or keep yours as a separate copy.';

/**
 * Stores what the app hands over: POST when the sheet is new, PUT with If-Match when it is stored. A 409 NEVER overwrites:
 * the person chooses "Reload their version" or "Save mine as a copy" (or closes the dialog to keep editing). Never throws.
 */
@Injectable({ providedIn: 'root' })
export class NeuronSaver {
  private readonly office = inject(OfficeService);
  private readonly dialog = inject(DialogService);

  async store(cur: StoredRef, f: SavedFile): Promise<SaveOutcome> {
    try {
      if (cur.id === null || cur.version === null) return { kind: 'saved', file: await this.office.create(cur.name, f.bytes) };
      return { kind: 'saved', file: await this.office.update(cur.id, cur.name, f.bytes, cur.version) };
    } catch (e) {
      if (e instanceof OfficeConflictError) return this.resolveConflict(cur, f);
      return { kind: 'failed', message: toApiError(e).message };
    }
  }

  private async resolveConflict(cur: StoredRef, f: SavedFile): Promise<SaveOutcome> {
    const r = await this.dialog.actions({
      title: CONFLICT_TITLE,
      message: CONFLICT_MESSAGE,
      actions: [
        { value: 'reload', label: 'Reload their version', variant: 'secondary' },
        { value: 'copy', label: 'Save mine as a copy', variant: 'primary' },
      ],
    });
    if (r.action === 'copy') {
      try { return { kind: 'copy', file: await this.office.create(copyName(cur.name), f.bytes) }; }
      catch (e) { return { kind: 'failed', message: toApiError(e).message }; }
    }
    if (r.action === 'reload') return { kind: 'reload', file: cur };
    return { kind: 'kept' };
  }
}
