import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CellValueChangedEvent, ColDef, ICellRendererParams } from 'ag-grid-community';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ModalPortalDirective } from '../../../shared/directives/modal-portal.directive';
import { statusValuesCol } from '../../../shared/components/status-words/status-words.component';
import { numberCol, textCol } from '../../../shared/utils/work-grid';
import { SG_ICON, sgActions, sgActionsCol } from '../../../shared/settings-grid/settings-grid';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import type { Doctor, Hospital } from './referring-network.model';
import {
  CheckedRow, PasteCheck, PasteMode, PasteRow, STATE_RANK, blankRow, checkDoctorRows, checkHospitalRows, doctorBody,
  hospitalBody, hospitalKey, parseSheetText, pasteRows, saveLabel,
} from './referring-paste';

/**
 * Paste from a sheet — the doctors (or hospitals) list as an editable sheet in Settings (owner 2026-11-21). Copy rows in
 * Excel / Google Sheets / Neuron, paste them here (Ctrl/⌘ V anywhere in the panel, or into the paste box on a phone),
 * see each row checked (name required, duplicates flagged, unknown hospitals offered for creation), fix a cell in place,
 * then Save. Saving uses the screen's EXISTING endpoints (POST /api/referring-network/hospitals then /doctors), one row
 * at a time, and shows the result on each row (Saved / Not saved + the server's reason) — a failed row stays to fix.
 * Pure rules: referring-paste.ts.
 */
@Component({
  selector: 'pf-referring-paste',
  standalone: true,
  imports: [DataGridComponent, BusyDirective, ModalPortalDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- On document.body (pfModalPortal): the Settings card's glass / slide-in would otherwise trap position: fixed. -->
    <div pfModalPortal class="pf-rnp-layer" (paste)="onPaste($event)">
    <div class="pf-rn-modal-bd" (click)="close()"></div>
    <div class="pf-rn-modal pf-rnp pf-card" role="dialog" aria-modal="true" [attr.aria-label]="title()" data-testid="rn-paste">
      <span class="pf-sheet__handle" aria-hidden="true"></span>
      <header class="pf-card__head pf-rn-modal__hdr">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>
        </span>
        <h3 class="pf-card__label">{{ title() }}</h3>
        <span class="pf-card__spacer"></span>
        <span class="pf-sg-count pf-num" data-testid="rn-paste-count">{{ countText() }}</span>
        <button type="button" class="pf-btn pf-btn--secondary pf-sg-act press" (click)="addRow()" data-testid="rn-paste-add-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          Add row
        </button>
        <button type="button" class="pf-btn pf-btn--icon pf-rn-modal__close press" (click)="close()" aria-label="Close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </header>
      <div class="pf-rnp__body">
        <label class="pf-rnp__drop">
          <span class="pf-rnp__drop-t">Copy the rows in Excel, Google Sheets or Neuron, then paste them here (Ctrl V / ⌘ V).</span>
          <span class="pf-rnp__drop-s">{{ columnsHint() }}{{ mode() === 'doctors' ? ' A doctor at several hospitals: separate them with ; or ,' : '' }}</span>
          <textarea #box class="pf-input pf-rnp__box" rows="2" data-testid="rn-paste-box" aria-label="Paste rows here"
                    placeholder="Paste rows here" (input)="onBoxInput()"></textarea>
        </label>
        @if (check().newHospitals.length) {
          <p class="pf-rnp__note" data-testid="rn-paste-new-hospitals">
            New {{ check().newHospitals.length === 1 ? 'hospital' : 'hospitals' }} to create on Save: <b>{{ check().newHospitals.join(', ') }}</b>
          </p>
        }
        <div class="pf-rnp__grid">
          <pf-data-grid [rowData]="checked()" [columnDefs]="colDefs()" [getRowId]="rowId" [singleClickEdit]="true"
                        [suppressCellFocus]="false" [suppressColumnVirtualisation]="true"
                        emptyTitle="Nothing pasted yet" emptyBody="Paste rows from a sheet, or use Add row to type one."
                        (cellValueChanged)="onCell($event)"></pf-data-grid>
        </div>
      </div>
      <footer class="pf-rn-modal__ftr">
        @if (ask(); as q) {
          <!-- The question is asked IN the panel (the panel sits on document.body, above the app's dialog layer). -->
          <span class="pf-rnp__ask" role="alert" data-testid="rn-paste-ask">{{ q === 'create' ? createQuestion() : 'Discard the rows that are not saved yet?' }}</span>
          <span class="flex-1"></span>
          <button type="button" class="pf-btn pf-btn--secondary press" (click)="ask.set(null)">{{ q === 'create' ? 'Back' : 'Keep editing' }}</button>
          <button type="button" class="pf-btn pf-btn--primary press" (click)="answer(q)">{{ q === 'create' ? 'Create and save' : 'Discard' }}</button>
        } @else {
        <span class="pf-rnp__sum">{{ summary() }}</span>
        <span class="flex-1"></span>
        <button type="button" class="pf-btn pf-btn--secondary press" (click)="close()">{{ anySaved() && !pending() ? 'Done' : 'Cancel' }}</button>
        <button type="button" class="pf-btn pf-btn--primary press" data-testid="rn-paste-save"
                [disabled]="!check().saveable.length || saving()" [pfBusyInactive]="!check().saveable.length || saving()"
                [attr.title]="check().saveable.length || saving() ? null : 'Nothing to save yet'"
                [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">
          @if (saving()) { Saving… } @else { {{ saveText() }} }
        </button>
        }
      </footer>
    </div>
    </div>
  `,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  styles: [`
    .pf-rn-modal-bd { position: fixed; top: 0; left: 0; right: 0; bottom: var(--pf-nav-h, 0px); background: rgba(0,0,0,0.45); z-index: 79; }
    .pf-rn-modal {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 80;
      width: calc(100% - 32px); max-width: 1080px; height: min(720px, calc(100dvh - var(--pf-nav-h, 0px) - 32px));
      display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(15, 23, 42, 0.28);
    }
    .pf-rn-modal__hdr { flex: none; gap: 8px; flex-wrap: wrap; }
    .pf-rn-modal__close { width: 36px; height: 36px; min-height: 36px; }
    .pf-rnp__body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
    .pf-rnp__drop { display: flex; flex-direction: column; gap: 4px; }
    .pf-rnp__drop-t { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-rnp__drop-s { font-size: 12px; color: var(--text-secondary); }
    .pf-rnp__box { min-height: 44px; resize: vertical; font-variant-numeric: tabular-nums; }
    .pf-rnp__note { margin: 0; font-size: 12.5px; color: var(--text-secondary); }
    .pf-rnp__grid { flex: 1 1 auto; min-height: 220px; display: flex; flex-direction: column; overflow: hidden; }
    /* The shared grid stretches itself to the Settings frame it lives in (an inline min-height); inside this panel it
       fills the panel's own box instead, so the footer is never covered. */
    .pf-rnp__grid pf-data-grid { flex: 1 1 auto; min-height: 0 !important; }
    .pf-rn-modal__ftr { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--pf-line); flex: none; }
    .pf-rn-modal__ftr .pf-btn { height: 40px; min-height: 40px; }
    .pf-rnp__sum { font-size: 12.5px; color: var(--text-secondary); }
    .pf-rnp__ask { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    @media (pointer: coarse) { .pf-rn-modal__close { width: 44px; height: 44px; } .pf-rn-modal__ftr .pf-btn { min-height: 44px; } }
    @media (max-width: 640px) {
      .pf-rn-modal { top: auto; bottom: var(--pf-nav-h, 0px); left: 0; transform: none; width: 100%; max-width: none; height: calc(100dvh - var(--pf-nav-h, 0px) - 24px); border-radius: 18px 18px 0 0; }
      .pf-rn-modal__ftr { flex-wrap: wrap; }
    }
  `],
})
export class ReferringPasteComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly web = webPointerSignal();

  readonly mode = input<PasteMode>('doctors');
  readonly doctors = input<Doctor[]>([]);
  readonly hospitals = input<Hospital[]>([]);
  /** Something was saved: the host reloads its lists. */
  readonly saved = output<void>();
  readonly closed = output<void>();

  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');
  readonly rows = signal<PasteRow[]>([]);
  readonly saving = signal(false);

  readonly title = computed(() => (this.mode() === 'doctors' ? 'Paste doctors from a sheet' : 'Paste hospitals from a sheet'));
  readonly columnsHint = computed(() => (this.mode() === 'doctors'
    ? 'Columns: Name · Qualification · Hospital(s) · Department · Phone (or a header row in any order).'
    : 'Columns: Name · Code · Phone · Address · Email (or a header row in any order).'));
  readonly check = computed<PasteCheck>(() => (this.mode() === 'doctors'
    ? checkDoctorRows(this.rows(), this.doctors(), this.hospitals())
    : checkHospitalRows(this.rows(), this.hospitals())));
  readonly checked = computed<CheckedRow[]>(() => this.check().rows);
  readonly pending = computed(() => this.check().saveable.length > 0);
  readonly anySaved = computed(() => this.check().counts.saved > 0);
  readonly saveText = computed(() => saveLabel(this.mode(), this.check().saveable.length));
  readonly countText = computed(() => { const n = this.checked().length; return `${n} ${n === 1 ? 'row' : 'rows'}`; });
  readonly summary = computed(() => {
    const c = this.check().counts;
    const parts: string[] = [];
    if (c.ready + c['new-hospital']) parts.push(`${c.ready + c['new-hospital']} ready`);
    if (c.duplicate) parts.push(`${c.duplicate} duplicate${c.duplicate === 1 ? '' : 's'}`);
    if (c.invalid) parts.push(`${c.invalid} to fix`);
    if (c.saved) parts.push(`${c.saved} saved`);
    if (c.failed) parts.push(`${c.failed} not saved`);
    return parts.join(' · ');
  });

  readonly rowId = (p: { data: CheckedRow }) => p.data.row.key;

  readonly colDefs = computed<ColDef<CheckedRow>[]>(() => {
    const web = this.web();
    const edit = (c: CheckedRow) => !c.row.result?.ok;
    const ed = { editable: (p: { data?: CheckedRow }) => !!p.data && edit(p.data), cellClass: 'pf-rnp-ed' };
    const txt = (colId: keyof PasteRow, headerName: string, extra: ColDef<CheckedRow> = {}) =>
      textCol<CheckedRow>({ colId, headerName, field: `row.${colId}` as never, flex: 1, minWidth: 130, ...ed, ...extra }, r => String(r.row[colId] ?? ''));
    const lead: ColDef<CheckedRow>[] = [
      numberCol<CheckedRow>({ colId: 'n', headerName: '#', width: 72, flex: 0, minWidth: 72 }, r => r.row.n),
    ];
    const check = statusValuesCol<CheckedRow>({ colId: 'check', headerName: 'Check', flex: 1.2, minWidth: 190 }, r => r.words, r => STATE_RANK[r.state]);
    const acts = sgActionsCol<CheckedRow>(web, [], 1, (p: ICellRendererParams<CheckedRow>) => (p.data
      ? sgActions(web, [{ label: 'Remove', aria: `Remove row ${p.data.row.n}`, path: SG_ICON.trash, icon: true, run: () => this.removeRow(p.data!.row.key) }])
      : document.createElement('span')), false);
    if (this.mode() === 'doctors') {
      return [...lead,
        txt('name', 'Name', { flex: 1.3, minWidth: 170 }), txt('qualification', 'Qualification'),
        txt('hospitals', 'Hospital(s)', { flex: 1.4, minWidth: 170 }), txt('department', 'Department'),
        txt('phone', 'Phone', { minWidth: 140 }), check, acts];
    }
    return [...lead,
      txt('name', 'Name', { flex: 1.4, minWidth: 180 }), txt('code', 'Code', { minWidth: 100, flex: 0.6 }),
      txt('phone', 'Phone', { minWidth: 140 }), txt('address', 'Address', { flex: 1.4, minWidth: 180 }),
      txt('email', 'Email', { minWidth: 160 }), check, acts];
  });

  // ── Input ──────────────────────────────────────────────────────
  /** Ctrl/⌘ V anywhere in the panel: a multi-cell / multi-line paste becomes rows; a single value goes to the cell
   *  being edited as usual. */
  onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const target = e.target as HTMLElement | null;
    const inBox = target === this.box()?.nativeElement;
    if (!inBox && !/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    this.addText(text);
  }
  /** Phones / tablets paste through the box (long-press Paste): its text becomes rows. */
  onBoxInput(): void {
    const el = this.box()?.nativeElement;
    if (!el || !el.value.trim()) return;
    // A typed single line stays in the box until a tab / line break arrives (a pasted sheet always has one).
    if (!/[\t\n]/.test(el.value)) return;
    this.addText(el.value);
    el.value = '';
  }
  /** Add parsed rows after the current ones (an empty starter row is replaced). */
  addText(text: string): void {
    const cells = parseSheetText(text);
    if (!cells.length) return;
    const keep = this.rows().filter(r => !this.isBlank(r));
    const from = keep.reduce((m, r) => Math.max(m, r.n), 0) + 1;
    const added = pasteRows(this.mode(), cells, from);
    if (!added.length) return;
    this.rows.set([...keep, ...added]);
    const el = this.box()?.nativeElement;
    if (el) el.value = '';
  }
  addRow(): void {
    const from = this.rows().reduce((m, r) => Math.max(m, r.n), 0) + 1;
    this.rows.update(list => [...list, blankRow(from)]);
  }
  removeRow(key: string): void { this.rows.update(list => list.filter(r => r.key !== key)); }
  private isBlank(r: PasteRow): boolean { return !r.result && !r.name && !r.qualification && !r.hospitals && !r.department && !r.phone && !r.code && !r.address && !r.email; }

  /** A cell edit writes into the row (field `row.<x>`) — rebuild so the checks run again. */
  onCell(e: CellValueChangedEvent<CheckedRow>): void {
    const key = e.data?.row.key;
    if (!key) return;
    const col = e.colDef.colId as keyof PasteRow;
    const v = String(e.newValue ?? '').replace(/\s+/g, ' ').trim();
    this.rows.update(list => list.map(r => (r.key === key ? { ...r, [col]: v, result: undefined } : r)));
  }

  // ── Save ───────────────────────────────────────────────────────
  /** The question shown in the footer: 'create' (new hospitals) or 'discard' (close with unsaved rows). */
  readonly ask = signal<'create' | 'discard' | null>(null);
  readonly createQuestion = computed(() => {
    const n = this.check().newHospitals;
    return `Create ${n.length === 1 ? '1 new hospital' : `${n.length} new hospitals`} (${n.join(', ')}) and link the pasted doctors?`;
  });
  answer(q: 'create' | 'discard'): void {
    this.ask.set(null);
    if (q === 'create') void this.save(true); else this.closed.emit();
  }

  async save(confirmed = false): Promise<void> {
    const c = this.check();
    if (!c.saveable.length || this.saving()) return;
    // New hospitals are created only on confirm (asked in the footer).
    if (c.newHospitals.length && !confirmed) { this.ask.set('create'); return; }
    this.saving.set(true);
    let done = 0;
    try {
      // 1. New hospitals (doctors mode): one POST each; their ids join the rows that named them.
      const created = new Map<string, string>();
      for (const name of c.newHospitals) {
        try {
          const h = await firstValueFrom(this.api.post<Hospital>('/api/referring-network/hospitals', { ...hospitalBody({ name }), doctorIds: null }));
          if (h?.id) created.set(hospitalKey(name), h.id);
        } catch (err) {
          this.toasts.error(`Could not create ${name}: ${ApiError.from(err).message}`);
        }
      }
      // 2. The rows, one at a time (the result shows on each row).
      for (const cr of c.saveable) {
        const r = cr.row;
        let result: PasteRow['result'];
        try {
          if (this.mode() === 'doctors') {
            const missing = cr.newHospitals.filter(n => !created.has(hospitalKey(n)));
            if (missing.length) throw new Error(`${missing.join(', ')} could not be created`);
            const ids = [...cr.hospitalIds, ...cr.newHospitals.map(n => created.get(hospitalKey(n))!)];
            const d = await firstValueFrom(this.api.post<Doctor>('/api/referring-network/doctors', doctorBody(r, ids)));
            result = { ok: true, message: 'Saved', id: d?.id };
          } else {
            const h = await firstValueFrom(this.api.post<Hospital>('/api/referring-network/hospitals', { ...hospitalBody(r), doctorIds: null }));
            result = { ok: true, message: 'Saved', id: h?.id };
          }
          done++;
        } catch (err) {
          result = { ok: false, message: err instanceof Error && !(err as { status?: number }).status ? err.message : ApiError.from(err).message };
        }
        this.rows.update(list => list.map(x => (x.key === r.key ? { ...x, result } : x)));
      }
    } finally {
      this.saving.set(false);
    }
    if (done || c.newHospitals.length) this.saved.emit();
    const failed = c.saveable.length - done;
    if (done) this.toasts.success(`${done} ${this.mode() === 'doctors' ? (done === 1 ? 'doctor' : 'doctors') : (done === 1 ? 'hospital' : 'hospitals')} saved`);
    if (failed) this.toasts.error(`${failed} ${failed === 1 ? 'row was' : 'rows were'} not saved — see Check`);
  }

  close(): void {
    if (this.saving()) return;
    if (this.pending()) { this.ask.set('discard'); return; }
    this.closed.emit();
  }
}
