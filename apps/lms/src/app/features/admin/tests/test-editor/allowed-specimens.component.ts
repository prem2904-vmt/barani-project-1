import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ApiError } from '../../../../shared/models/api-response.model';
import { PfSelectOption, SelectComponent } from '../../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../../shared/primitives/touch-button.component';
import { TUBE_COLORS } from '../../../../shared/utils/tube-colors';
import { type AllowedSpecimen, type SpecimenMode, type TestSpecimenMap } from '../../../../shared/utils/micro-specimen';

/** One editable row of the allowed-specimens grid. */
export interface AllowedRow {
  code: string;
  name: string;
  isDefault: boolean;
  /** Container KEY ('' = the test's own container). */
  container: string;
  volumeMl: number | null;
  transport: string;
  instruction: string;
  /** '' = the base price; a number = this specimen's own price. */
  price: number | '';
}

/** The PUT body row (`TestSpecimenWrite` on the server). */
export interface AllowedWrite {
  code: string;
  isDefault: boolean;
  container: string | null;
  volumeMl: number | null;
  transport: string | null;
  instruction: string | null;
  price: number | null;
}

/** Does this browser size a textarea to its content natively (`field-sizing: content`)? */
export function supportsFieldSizing(): boolean {
  try { return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content'); }
  catch { return false; }
}

/** Size a textarea to its content (ND rule: no truncation — the cell grows,
 *  the text never clips). Native (`field-sizing: content`): clear any inline
 *  height so the CSS sizes it — an inline height would pin it. Fallback:
 *  reset, then fit scrollHeight. Pure over the element. */
export function autoGrow(el: { style: { height: string }; scrollHeight: number } | null | undefined, native = supportsFieldSizing()): void {
  if (!el) return;
  if (native) { el.style.height = ''; return; }
  el.style.height = 'auto';
  if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
}

/** Server rows → grid rows (pure). */
export function rowsOf(specimens: AllowedSpecimen[]): AllowedRow[] {
  return specimens.map(s => ({
    code: s.code, name: s.name, isDefault: !!s.isDefault,
    container: s.container && TUBE_COLORS.some(t => t.key === s.container) ? s.container : '',
    volumeMl: s.volumeMl ?? null,
    transport: s.transport ?? '', instruction: s.instruction ?? '',
    price: s.price == null ? '' : Number(s.price),
  }));
}

/** Grid rows → the PUT body (pure): blank = null, at most one default. */
export function writesOf(rows: AllowedRow[]): AllowedWrite[] {
  return rows.map(r => ({
    code: r.code, isDefault: !!r.isDefault,
    container: r.container || null,
    volumeMl: r.volumeMl == null || r.volumeMl === ('' as unknown) ? null : Number(r.volumeMl),
    transport: r.transport.trim() || null,
    instruction: r.instruction.trim() || null,
    price: r.price === '' || r.price == null || !Number.isFinite(Number(r.price)) ? null : Math.max(0, Number(r.price)),
  }));
}

/**
 * The Test Master's "Allowed specimens" editor (owner 2026-09-29): which
 * specimens a test may be ordered on, each with its container (sets the
 * tube), volume, transport, instruction, the single default the desk
 * preselects, and a price per specimen (blank = the test's base price).
 *
 * Saves the whole list through `PUT /api/microbiology/test-specimens/{id}`
 * (copy-on-write for a tenant test that still reads the master's rows). The
 * admin console embeds the same component; its API shim routes the call to
 * the platform twin (the template carries no prices, so its price column
 * is hidden).
 */
@Component({
  selector: 'pf-allowed-specimens',
  standalone: true,
  imports: [FormsModule, SelectComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-as">
      <div class="pf-as__head">
        <div class="pf-as__add">
          <pf-select size="sm" [searchable]="true" [options]="addOptions()" [value]="''"
                     placeholder="Add a specimen from the master…" (valueChange)="add($event)"></pf-select>
        </div>
        <span class="pf-as__count"><span class="nd-num">{{ rows().length }}</span> allowed</span>
      </div>
      @if (inherited()) {
        <p class="pf-hint pf-as__note">Read from the Admin Test Master. Your first save copies this list to the lab; the master is never changed.</p>
      }
      @if (!rows().length) {
        <p class="pf-hint pf-as__note">
          @if (mode() === 'fixed') { Add the ONE specimen this test is always collected on. }
          @else { No allowed list yet: the desk may pick any specimen from the master. Add specimens to limit the choice. }
        </p>
      } @else {
        <table class="pf-as__table">
          <colgroup>
            <col class="pf-as__c-spec" /><col class="pf-as__c-cont" /><col class="pf-as__c-vol" /><col class="pf-as__c-text" />
            <col class="pf-as__c-instr" /><col class="pf-as__c-def" />
            @if (showPrice()) { <col class="pf-as__c-price" /> }
            <col class="pf-as__c-x" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Specimen</th>
              <th scope="col">Container</th>
              <th scope="col" class="pf-as__num">Vol. (ml)</th>
              <th scope="col">Transport</th>
              <th scope="col">Instruction</th>
              <th scope="col" class="pf-as__c">Default</th>
              @if (showPrice()) { <th scope="col" class="pf-as__num">Price (₹)</th> }
              <th scope="col"><span class="pf-as__sr">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.code) {
              <tr [attr.data-code]="r.code">
                <td class="pf-as__name">{{ r.name }}<span class="pf-as__code">{{ r.code }}</span></td>
                <td data-label="Container">
                  <pf-select size="sm" [options]="containerOptions" [value]="r.container"
                             placeholder="Test's own" (valueChange)="set(r.code, { container: $event })"></pf-select>
                </td>
                <td class="pf-as__num" data-label="Vol. (ml)">
                  <input type="number" class="nd-input nd-num pf-as__in" min="0" step="0.5" inputmode="decimal"
                         [attr.aria-label]="'Volume of ' + r.name" [ngModel]="r.volumeMl"
                         (ngModelChange)="set(r.code, { volumeMl: $event === '' || $event == null ? null : +$event })" />
                </td>
                <!-- Free text grows with its content (ND: no truncation): an
                     auto-sizing textarea, one line when short. -->
                <td data-label="Transport">
                  <textarea rows="1" class="nd-input pf-as__in pf-as__grow" [attr.aria-label]="'Transport for ' + r.name"
                            [ngModel]="r.transport" (ngModelChange)="set(r.code, { transport: $event })"
                            (input)="grow($event)" (focus)="grow($event)"></textarea>
                </td>
                <td data-label="Instruction">
                  <textarea rows="1" class="nd-input pf-as__in pf-as__grow" [attr.aria-label]="'Instruction for ' + r.name"
                            [ngModel]="r.instruction" (ngModelChange)="set(r.code, { instruction: $event })"
                            (input)="grow($event)" (focus)="grow($event)"></textarea>
                </td>
                <td class="pf-as__c" data-label="Default">
                  <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="r.isDefault"
                          [attr.aria-label]="'Default: ' + r.name" (click)="setDefault(r.code, !r.isDefault)">
                    <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
                  </button>
                </td>
                @if (showPrice()) {
                  <td class="pf-as__num" data-label="Price (₹)">
                    <input type="number" class="nd-input nd-num pf-as__in" min="0" step="0.01" inputmode="decimal"
                           [attr.aria-label]="'Price of ' + r.name" [placeholder]="basePriceText()"
                           [ngModel]="r.price" (ngModelChange)="set(r.code, { price: $event === '' || $event == null ? '' : +$event })" />
                  </td>
                }
                <td class="pf-as__acts">
                  <button type="button" class="pf-as__rm" [attr.aria-label]="'Remove ' + r.name" (click)="remove(r.code)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      @if (error()) { <p class="pf-field-error" role="alert">{{ error() }}</p> }
      <div class="pf-as__foot">
        <p class="pf-hint">
          @if (mode() === 'fixed') { Fixed: exactly one specimen — the server stamps it on every order, no picker. }
          @else { The desk picks only from this list; the default (at most one) is preselected. }
          The container sets the tube; a price makes the line bill at that price (blank = the base price).
        </p>
        <pf-touch-btn size="sm" variant="secondary" [disabled]="saving() || !dirty()" (pressed)="save()">
          @if (saving()) { Saving… } @else { Save allowed specimens }
        </pf-touch-btn>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pf-as__head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .pf-as__add { flex: 1 1 260px; max-width: 360px; }
    .pf-as__count { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
    .pf-as__note { margin: 4px 0 8px; }
    .pf-as__table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
    /* Free text gets the room: instruction is the widest column, transport
       next; the number inputs are as narrow as their values. */
    .pf-as__c-spec { width: 14%; } .pf-as__c-cont { width: 148px; } .pf-as__c-vol { width: 64px; }
    .pf-as__c-text { width: 15%; } .pf-as__c-instr { width: auto; } .pf-as__c-def { width: 56px; }
    .pf-as__c-price { width: 84px; } .pf-as__c-x { width: 32px; }
    .pf-as__table th { text-align: left; font-weight: 600; font-size: 11px; letter-spacing: .02em; text-transform: uppercase;
      color: var(--text-tertiary); padding: 4px 6px; border-bottom: 1px solid var(--border-subtle, rgba(0,0,0,.08)); }
    .pf-as__table td { padding: 6px; vertical-align: top; border-bottom: 1px solid var(--border-subtle, rgba(0,0,0,.06)); }
    .pf-as__name { font-weight: 600; }
    .pf-as__code { display: block; font-weight: 400; font-size: 11px; color: var(--text-tertiary); }
    .pf-as__num { text-align: right; }
    .pf-as__c { width: 64px; text-align: center; }
    .pf-as__in { width: 100%; min-width: 0; font-size: 16px; }
    /* Auto-growing text: never clips, never scrolls inside the cell. */
    .pf-as__grow { display: block; resize: none; overflow: hidden; line-height: 1.35; min-height: 40px; height: auto;
      white-space: pre-wrap; overflow-wrap: anywhere; field-sizing: content; }
    .pf-as__name { white-space: normal; overflow-wrap: anywhere; }
    .pf-as__acts { width: 36px; text-align: right; }
    .pf-as__rm { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px;
      color: var(--text-tertiary); background: transparent; border: 0; cursor: pointer; }
    .pf-as__rm:hover { color: var(--text-primary); background: var(--surface-hover, rgba(0,0,0,.05)); }
    .pf-as__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .pf-as__foot { display: flex; align-items: flex-start; gap: 12px; margin-top: 10px; }
    .pf-as__foot .pf-hint { flex: 1 1 auto; margin: 0; }
    @media (max-width: 720px) {
      /* One card per specimen: the name heads it, every field is labelled,
         the free text keeps growing. */
      .pf-as__table, .pf-as__table thead, .pf-as__table tbody, .pf-as__table tr, .pf-as__table td, .pf-as__table colgroup { display: block; }
      .pf-as__table thead, .pf-as__table colgroup { display: none; }
      .pf-as__table tr { position: relative; padding: 10px 0 8px; border-bottom: 1px solid var(--border-subtle, rgba(0,0,0,.08)); }
      .pf-as__table td { border: 0; padding: 4px 0; width: auto; text-align: left; }
      .pf-as__table td[data-label]::before { content: attr(data-label); display: block; font-size: 11px; font-weight: 600;
        letter-spacing: .02em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 2px; }
      .pf-as__name { font-size: 15px; padding-right: 44px; }
      .pf-as__acts { position: absolute; top: 6px; right: 0; width: auto; }
      .pf-as__num, .pf-as__c { text-align: left; }
      .pf-as__num .pf-as__in { max-width: 160px; }
      .pf-as__foot { flex-direction: column; }
    }
  `],
})
export class AllowedSpecimensComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Loaded / changed rows: size every growing textarea to its text once
   *  rendered (the CSS `field-sizing: content` does it natively where
   *  supported; this is the fallback for the rest). */
  private readonly fitGrowing = afterRenderEffect(() => {
    this.rows();
    if (supportsFieldSizing()) return;
    // [ngModel] writes the value in a microtask after render: fit after it.
    const host = this.host.nativeElement;
    setTimeout(() => host.querySelectorAll<HTMLTextAreaElement>('.pf-as__grow').forEach(t => autoGrow(t)), 0);
  });

  /** The Test Master test whose list this edits. */
  readonly testId = input.required<string>();
  /** The test's specimen mode (saved with the test). Fixed = one row. */
  readonly mode = input<SpecimenMode>('choose');
  /** The lab's Specimen master (code, name) — the "Add" picker's rows. */
  readonly master = input<Array<{ code: string; name: string; container?: string | null }>>([]);
  /** Emits the saved map (the desk-facing shape) after every successful save. */
  readonly saved = output<TestSpecimenMap>();

  readonly rows = signal<AllowedRow[]>([]);
  private readonly _orig = signal<string>('[]');
  readonly inherited = signal(false);
  readonly basePrice = signal<number | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  private loadedFor: string | null = null;

  readonly containerOptions: PfSelectOption<string>[] = [
    { value: '', label: "Test's own" },
    ...TUBE_COLORS.map(t => ({ value: t.key, label: t.label })),
  ];
  /** The template tenant carries no prices (basePrice null) → no price column. */
  readonly showPrice = computed(() => this.basePrice() != null);
  readonly basePriceText = computed(() => {
    const b = this.basePrice();
    return b == null ? 'base' : `base ₹${b}`;
  });
  readonly addOptions = computed<PfSelectOption<string>[]>(() => {
    const have = new Set(this.rows().map(r => r.code.toUpperCase()));
    return this.master().filter(m => !have.has(m.code.toUpperCase()))
      .map(m => ({ value: m.code, label: m.name, hint: m.container ?? undefined }));
  });
  readonly dirty = computed(() => JSON.stringify(writesOf(this.rows())) !== this._orig());

  private readonly load = effect(() => {
    const id = this.testId();
    if (!id || this.loadedFor === id) return;
    this.loadedFor = id;
    this.api.get<TestSpecimenMap[]>(`/api/microbiology/test-specimens?testIds=${id}`).subscribe({
      next: maps => this.apply(maps?.[0] ?? { testId: id, specimens: [] }),
      error: () => this.apply({ testId: id, specimens: [] }),
    });
  });

  private apply(m: TestSpecimenMap) {
    const rows = rowsOf(m.specimens ?? []);
    this.rows.set(rows);
    this._orig.set(JSON.stringify(writesOf(rows)));
    this.inherited.set(!!m.inherited);
    this.basePrice.set(m.basePrice ?? null);
    this.error.set(null);
  }

  /** Fit a growing textarea to its text (input / focus); see autoGrow. */
  grow(ev: Event) { autoGrow(ev.target as HTMLTextAreaElement | null); }
  /** Fallback engine (no `field-sizing`): scrollHeight, no `field-sizing` CSS. */
  readonly nativeSizing = supportsFieldSizing();

  add(code: string) {
    if (!code) return;
    const m = this.master().find(x => x.code === code);
    if (!m || this.rows().some(r => r.code === code)) return;
    this.rows.update(rs => [...rs, { code: m.code, name: m.name, isDefault: false, container: '', volumeMl: null, transport: '', instruction: '', price: '' }]);
    this.error.set(null);
  }
  remove(code: string) { this.rows.update(rs => rs.filter(r => r.code !== code)); }
  set(code: string, patch: Partial<AllowedRow>) {
    this.rows.update(rs => rs.map(r => (r.code === code ? { ...r, ...patch } : r)));
  }
  /** At most ONE default (owner 2026-09-27): switching one on clears the rest. */
  setDefault(code: string, on: boolean) {
    this.rows.update(rs => rs.map(r => ({ ...r, isDefault: r.code === code ? on : (on ? false : r.isDefault) })));
  }

  save() {
    const id = this.testId();
    if (!id || this.saving()) return;
    const writes = writesOf(this.rows());
    if (this.mode() === 'fixed' && writes.length !== 1) {
      this.error.set('A fixed specimen means exactly ONE allowed specimen.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api.put<TestSpecimenMap>(`/api/microbiology/test-specimens/${id}`, { specimens: writes }).subscribe({
      next: m => {
        this.saving.set(false);
        if (m) { this.apply(m); this.saved.emit(m); }
        this.toasts.success(`Allowed specimens saved (${writes.length})`);
      },
      error: e => {
        this.saving.set(false);
        const msg = ApiError.from(e).message || 'Could not save the allowed specimens';
        this.error.set(msg);
        this.toasts.error(msg);
      },
    });
  }
}
