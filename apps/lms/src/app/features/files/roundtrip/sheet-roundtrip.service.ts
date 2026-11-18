import { Injectable, Injector, Type, inject, signal } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { labToday } from '../../../shared/utils/lab-clock';
import { SheetEditorService } from '../../neuron/sheet-editor.service';
import { FilesAccessService } from '../files-access.service';
import { OfficeService, toApiError } from '../office.service';
import { PRICES_DATASET_ID, PricesSheetDataset } from './prices-dataset';
import { SheetDataset, SheetMarker, datasetBook, diffSheet, reviewContent, sheetMarker } from './sheet-roundtrip';
import { readBook } from './xlsx-book';

/**
 * Every dataset that can make a sheet round-trip, by the id stored in the file. Adding a dataset = ONE entry here + its
 * definition file (columns, key, lists, load / apply over the screen's existing batch API). Nothing else branches on a dataset.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SHEET_DATASETS: Readonly<Record<string, Type<SheetDataset<any>>>> = {
  [PRICES_DATASET_ID]: PricesSheetDataset,
};

/** The `_pf` marker of an .xlsx when it holds a known dataset, else null (never throws: any other file is just a sheet). */
export async function detectRoundtrip(bytes: ArrayBuffer | Uint8Array | null | undefined): Promise<SheetMarker | null> {
  if (!bytes || bytes.byteLength === 0) return null;
  try {
    const m = sheetMarker(await readBook(bytes));
    return m && SHEET_DATASETS[m.dataset] ? m : null;
  } catch { return null; }
}

/**
 * The screens' way into a sheet round-trip: make the sheet (stored in Files, opened in Neuron) and send an edited one back
 * (read → review in a DialogService dialog → Apply through the dataset). Price sheets hold no patient data: they are created
 * WITHOUT a `phiSource`, so the server never flags them.
 */
@Injectable({ providedIn: 'root' })
export class SheetRoundtripService {
  private readonly injector = inject(Injector);
  private readonly office = inject(OfficeService);
  private readonly sheets = inject(SheetEditorService);
  private readonly files = inject(FilesAccessService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  /** Bumped after every Apply, per dataset id: an open screen of that dataset reloads. */
  readonly applied = signal<Record<string, number>>({});

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataset(id: string): SheetDataset<any> | null {
    const t = SHEET_DATASETS[id];
    return t ? this.injector.get(t) : null;
  }

  /** "Open in Neuron" may show: Files is on, Neuron files can be stored by this person, and the dataset's own edit permission. */
  canOpen(id: string): boolean {
    const ds = this.dataset(id);
    return !!ds && this.sheets.available('neuron') && this.files.canWrite('neuron') && ds.canApply();
  }

  /** Build the sheet, store it in Files and open it in Neuron. Returns false when it did not open (a toast said why). */
  async openInNeuron(id: string, scope: string, scopeName: string, source: string): Promise<boolean> {
    const ds = this.dataset(id);
    if (!ds) return false;
    try {
      const data = await ds.load(scope);
      const bytes = datasetBook(ds, scope, data);
      const file = await this.office.create(ds.fileName(scopeName, labToday()), bytes, 'sheet');
      return await this.sheets.open({ app: 'neuron', source, fileId: file.id });
    } catch (e) {
      this.toast.error(e instanceof ApiError ? e.message : toApiError(e).message);
      return false;
    }
  }

  /**
   * Read the edited workbook, diff it by key against the server NOW, show the review, and on Apply save through the dataset.
   * Resolves true when something was applied.
   */
  async send(marker: SheetMarker, bytes: Uint8Array | ArrayBuffer): Promise<boolean> {
    const ds = this.dataset(marker.dataset);
    if (!ds) return false;
    if (!ds.canApply()) { this.toast.error("Your role can't change these values in Prefrontal."); return false; }
    let content: ReturnType<typeof reviewContent>;
    let diff: ReturnType<typeof diffSheet>;
    try {
      const [book, current] = await Promise.all([readBook(bytes), ds.load(marker.scope)]);
      diff = diffSheet(ds, book, current);
      content = reviewContent(ds, diff);
    } catch (e) {
      this.toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'This sheet could not be read.');
      return false;
    }
    if (!content.canApply) {
      await this.dialog.alert({ title: 'Send to Prefrontal', message: content.message, items: content.items, confirmLabel: 'Close' });
      return false;
    }
    const ok = await this.dialog.confirm({
      title: 'Send to Prefrontal', message: content.message, items: content.items,
      confirmLabel: 'Apply', cancelLabel: 'Cancel',
    });
    if (!ok) return false;
    try {
      await ds.apply(marker.scope, diff.changes);
    } catch (e) {
      this.toast.error(ApiError.from(e).message);
      return false;
    }
    const n = diff.changes.length;
    this.toast.success(`Saved ${n} change${n === 1 ? '' : 's'} in Prefrontal`);
    this.applied.update(a => ({ ...a, [marker.dataset]: (a[marker.dataset] ?? 0) + 1 }));
    return true;
  }
}
