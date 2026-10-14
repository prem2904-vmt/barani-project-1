import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ApiError } from '../../../shared/models/api-response.model';
import { Test } from '../../../shared/models/test.model';
import { SelectComponent } from '../../../shared/primitives/select.component';
import { plural } from '../../../shared/utils/plural';
import { fmtIst } from '../../../shared/instruments/instrument-config';
import type { ParserType } from '../../../shared/instruments/instrument.models';
import { InstrumentsApiService } from '../../../shared/instruments/instruments-api.service';
import {
  HL7_ORDER_OPTIONS, HL7_QUERY_OPTIONS, OrderCodeRow, PreviewView, TWO_WAY_LIMITS, TWO_WAY_MODES, TwoWayForm, TwoWayMode,
  hasQuery, hasWorklist, orderCodeTestOptions, previewErrorText, previewView, showsHl7Options, validateTwoWay, withOrderCodeRowsFor,
} from '../../../shared/instruments/instrument-two-way';

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'result'; view: PreviewView };

/**
 * "Two-way with the analyzer" — the body of the instrument editor's Two-way
 * step (bidi CONTRACT §4). Edits the ConfigJson `bidirectional` block through
 * `value` / `valueChange` (the band Save writes it), and "Test a barcode"
 * asks the server what the analyzer would be told for one tube.
 */
@Component({
  selector: 'pf-instrument-two-way',
  standalone: true,
  imports: [SelectComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './instrument-two-way.component.html',
  styleUrl: './instrument-two-way.component.scss',
})
export class InstrumentTwoWayComponent {
  private readonly api = inject(InstrumentsApiService);

  readonly value = input.required<TwoWayForm>();
  readonly protocol = input<ParserType>('auto');
  /** Saved instrument id (null = not created yet → no barcode test). */
  readonly instrumentId = input<string | null>(null);
  readonly tests = input<Test[]>([]);
  /** Unsaved edits exist — the barcode test uses the SAVED settings. */
  readonly unsaved = input(false);
  readonly valueChange = output<TwoWayForm>();
  readonly openMapping = output<void>();

  protected readonly modes = TWO_WAY_MODES;
  protected readonly queryOptions = HL7_QUERY_OPTIONS;
  protected readonly orderOptions = HL7_ORDER_OPTIONS;
  protected readonly limits = TWO_WAY_LIMITS;
  protected readonly plural = plural;

  readonly on = computed(() => this.value().mode !== 'off');
  readonly asks = computed(() => hasQuery(this.value().mode));
  readonly worklist = computed(() => hasWorklist(this.value().mode));
  readonly hl7 = computed(() => showsHl7Options(this.protocol()));
  readonly issues = computed(() => validateTwoWay(this.value()));
  readonly testOptions = computed(() => orderCodeTestOptions(this.tests(), this.value().orderCodes));

  issue(field: 'window' | 'poll'): string | null {
    return this.issues().find((i) => i.field === field)?.message ?? null;
  }
  codeIssue(index: number): string | null {
    return this.issues().find((i) => i.field === 'code' && i.index === index)?.message ?? null;
  }

  // ── Edits ────────────────────────────────────────────────────────────
  set(p: Partial<TwoWayForm>) { this.valueChange.emit({ ...this.value(), ...p }); }
  setMode(m: TwoWayMode) { if (m !== this.value().mode) this.set({ mode: m }); }
  /** Radio-group arrows (←/→/↑/↓) move the choice, like a native radio set. */
  onModeKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = this.modes.findIndex((m) => m.value === this.value().mode);
    const next = this.modes[(i + step + this.modes.length) % this.modes.length];
    this.setMode(next.value);
    const group = (e.currentTarget as HTMLElement | null);
    queueMicrotask(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }
  setInt(field: 'worklistWindowHours' | 'worklistPollSeconds', raw: string) {
    const s = String(raw ?? '').trim();
    const n = s ? Number(s) : NaN;
    this.set({ [field]: Number.isFinite(n) ? n : null } as Partial<TwoWayForm>);
  }
  private setRows(rows: OrderCodeRow[]) { this.set({ orderCodes: rows }); }
  patchRow(i: number, p: Partial<OrderCodeRow>) {
    this.setRows(this.value().orderCodes.map((r, j) => (j === i ? { ...r, ...p } : r)));
  }
  addRow() { this.setRows([...this.value().orderCodes, { testCatalogKey: '', code: '' }]); }
  removeRow(i: number) { this.setRows(this.value().orderCodes.filter((_, j) => j !== i)); }
  testName(key: string): string { return this.testOptions().find((o) => o.value === key)?.label ?? key; }

  // ── Test a barcode ───────────────────────────────────────────────────
  readonly barcode = signal('');
  readonly preview = signal<PreviewState>({ kind: 'idle' });
  readonly previewResult = computed(() => { const p = this.preview(); return p.kind === 'result' ? p.view : null; });
  readonly previewError = computed(() => { const p = this.preview(); return p.kind === 'error' ? p.message : null; });

  async runPreview() {
    const id = this.instrumentId();
    const code = this.barcode().trim();
    if (!id || !code || this.preview().kind === 'loading') return;
    this.preview.set({ kind: 'loading' });
    try {
      const dto = await firstValueFrom(this.api.ordersPreview(id, code));
      this.preview.set({ kind: 'result', view: previewView(dto, this.value().sendPatient, (s) => fmtIst(s)) });
    } catch (e) {
      const err = ApiError.from(e);
      this.preview.set({ kind: 'error', message: previewErrorText(err.code, err.message) });
    }
  }
  /** Unmapped tests in the preview → blank order-code rows to fill in. */
  addCodesFor(keys: string[]) { this.setRows(withOrderCodeRowsFor(this.value().orderCodes, keys)); }
  unmappedKeys(v: PreviewView): string[] { return v.unmapped.map((u) => u.testCatalogKey); }
}
