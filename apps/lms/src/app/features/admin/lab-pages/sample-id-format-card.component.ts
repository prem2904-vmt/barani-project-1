import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';

export const SAMPLE_ID_DATE_OPTIONS: PfSelectOption[] = [
  { value: 'yymmdd', label: 'YYMMDD' }, { value: 'ddmmyy', label: 'DDMMYY' },
  { value: 'mmdd', label: 'MMDD' }, { value: 'yymm', label: 'YYMM' },
  { value: 'mmyy', label: 'MMYY' }, { value: 'yy', label: 'YY' },
  { value: 'dd', label: 'DD' }, { value: 'none', label: 'None' },
];
const LETTER_OPTIONS: PfSelectOption<number>[] = [
  { value: 1, label: 'A' }, { value: 2, label: 'AA' }, { value: 3, label: 'AAA' }, { value: 4, label: 'AAAA' },
];

/** Clamp the number width: 1–10 digits, or 1–6 when letters lead the number. */
export function sanitizeSamplePad(val: unknown, isAlpha: boolean): number {
  const maxPad = isAlpha ? 6 : 10;
  const num = Math.abs(parseInt(String(val), 10));
  if (isNaN(num) || num < 1) return 1;
  return Math.min(num, maxPad);
}

/** What a first sample id looks like with today's date (stand-in space prefix). */
export function sampleIdPreview(prefix: string, date: string, sep: string, pad: number, serial: 'numeric' | 'alpha', letters: number, now = new Date()): string {
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  const d = date === 'yymmdd' ? yy + mm + dd
    : date === 'ddmmyy' ? dd + mm + yy
    : date === 'mmdd' ? mm + dd
    : date === 'yymm' ? yy + mm
    : date === 'mmyy' ? mm + yy
    : date === 'yy' ? yy
    : date === 'dd' ? dd : '';
  const cleanPad = sanitizeSamplePad(pad, serial === 'alpha');
  const ser = serial === 'alpha'
    ? 'A'.repeat(Math.min(Math.max(letters, 1), 4)) + '1'.padStart(cleanPad, '0')
    : '1'.padStart(cleanPad, '0');
  // A separator sits between EVERY non-empty part — mirrors the backend.
  return [prefix, d, ser].filter(p => p.length).join(sep ?? '');
}

/**
 * Sample ID format (date, separator, digits, letters). Moved here from
 * Organization › Sample ID: sample numbers are a LAB setting (the prefix is
 * each lab space's code). Same API as before: GET/POST /api/config/sample-id.
 */
@Component({
  selector: 'pf-sample-id-format-card',
  standalone: true,
  imports: [FormsModule, SelectComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-card pf-sf" data-testid="sample-id-format">
      <div class="pf-card__head">
        <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2v17a3 3 0 0 0 6 0V2"/><path d="M8 2h8M9 12h6"/></svg></span>
        <h3 class="pf-card__label pf-sf__title">Sample ID format</h3>
        <span class="pf-sf__scope" title="Applies to every branch">All branches</span>
      </div>
      <div class="pf-sf__body">
        <p class="pf-sf__hint">
          Every tube's ID is <strong>SPACE-DATE-NUMBER</strong> (e.g. <span class="pf-num">MIC-2607-00001</span>).
          The <strong>space code</strong> comes from <em>Prefix per lab space</em>. The number restarts <strong>each month per space</strong>.
          This is the one place the sample-ID format is set.
        </p>
        <div class="pf-sf__grid">
          <div class="pf-field">
            <span class="pf-field__lbl">Date</span>
            <pf-select [options]="dateOptions" [value]="date()" (valueChange)="date.set($any($event))"></pf-select>
          </div>
          <label class="pf-field">
            <span class="pf-field__lbl">Separator <span class="pf-sf__opt">(blank = none)</span></span>
            <input class="pf-input pf-num" maxlength="3" [ngModel]="sep()" (ngModelChange)="sep.set($event)" placeholder="none" aria-label="Separator" />
          </label>
          <label class="pf-field">
            <span class="pf-field__lbl">{{ serial() === 'alpha' ? 'Min number digits' : 'Number digits' }}</span>
            <input class="pf-input pf-num" type="number" min="1" [attr.max]="serial() === 'alpha' ? 6 : 10" [ngModel]="pad()"
                   (ngModelChange)="pad.set(clamp($event))" (keydown)="preventMinus($event)" aria-label="Number digits" />
          </label>
        </div>
        <div class="pf-sf__toggle">
          <span class="pf-sf__toggle-t"><strong>Include letters</strong> <span class="pf-sf__opt">— alphanumeric (AA001 …). Off = plain numbers.</span></span>
          <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="serial() === 'alpha'" aria-label="Include letters"
                  (click)="serial.set(serial() === 'alpha' ? 'numeric' : 'alpha')"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span></button>
        </div>
        @if (serial() === 'alpha') {
          <div class="pf-field pf-sf__letters">
            <span class="pf-field__lbl">Letters</span>
            <pf-select [options]="letterOptions" [value]="letters()" (valueChange)="letters.set(+$any($event))"></pf-select>
          </div>
        }
        <p class="pf-sf__preview" data-testid="sample-id-preview">Preview: <strong class="pf-num">{{ preview() }}</strong></p>
        <button type="button" class="pf-btn pf-btn--primary press pf-sf__save" [disabled]="saving()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">
          {{ saving() ? 'Saving…' : 'Save format' }}
        </button>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pf-sf { margin-bottom: 16px; overflow: visible; }
    .pf-sf__title { margin: 0; font-size: 13px; }
    .pf-sf__scope { margin-left: 8px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg); font-size: 11px; font-weight: 600; color: var(--text-tertiary); white-space: nowrap; }
    .pf-sf__body { display: flex; flex-direction: column; gap: 14px; padding: 14px 18px 18px; overflow: visible; }
    .pf-sf__hint { margin: 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-sf__opt { font-weight: 400; color: var(--text-tertiary); }
    .pf-sf__grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .pf-sf__toggle { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .pf-sf__toggle-t { font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
    .pf-sf__toggle-t strong { color: var(--text-primary); font-weight: 600; }
    .pf-sf__letters { max-width: 220px; }
    .pf-sf__preview { margin: 0; font-size: 13px; color: var(--text-secondary); }
    .pf-sf__preview strong { color: var(--text-primary); font-weight: 600; }
    .pf-sf__save { align-self: flex-start; }
    @media (max-width: 640px) {
      .pf-sf__grid { grid-template-columns: 1fr; }
      .pf-sf__toggle { align-items: flex-start; }
      :host input.pf-input { font-size: 16px; }
    }
  `],
})
export class SampleIdFormatCardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  readonly dateOptions = SAMPLE_ID_DATE_OPTIONS;
  readonly letterOptions = LETTER_OPTIONS;
  /** Stand-in prefix: the real one is each space's code. */
  private readonly samplePrefix = 'MIC';
  readonly date = signal('yymm');
  readonly sep = signal('-');
  readonly pad = signal(5);
  readonly serial = signal<'numeric' | 'alpha'>('numeric');
  readonly letters = signal(2);
  readonly saving = signal(false);
  readonly preview = computed(() => sampleIdPreview(this.samplePrefix, this.date(), this.sep(), this.pad(), this.serial(), this.letters()));

  protected clamp(v: unknown): number { return sanitizeSamplePad(v, this.serial() === 'alpha'); }
  protected preventMinus(e: KeyboardEvent) {
    if (e.key === '-' || e.key === '+' || e.key === 'e') e.preventDefault();
  }

  ngOnInit() {
    this.api.get<any>('/api/config/sample-id').subscribe({
      next: c => {
        if (!c) return;
        this.date.set(c.datePrefix ?? this.date());
        this.sep.set(c.separator ?? '-');
        this.pad.set(sanitizeSamplePad(c.padding ?? this.pad(), c.serialMode === 'alpha'));
        this.serial.set(c.serialMode === 'alpha' ? 'alpha' : 'numeric');
        this.letters.set(Math.min(Math.max(c.letterCount ?? 2, 1), 4));
      },
    });
  }

  save() {
    const cleanPad = sanitizeSamplePad(this.pad(), this.serial() === 'alpha');
    this.pad.set(cleanPad);
    this.saving.set(true);
    this.api.post('/api/config/sample-id', {
      enabled: true,
      datePrefix: this.date(),
      separator: this.sep() ?? '',
      padding: cleanPad,
      serialMode: this.serial(),
      letterCount: this.letters(),
    }).subscribe({
      next: () => { this.saving.set(false); this.toasts.success('Sample ID format saved'); },
      error: e => { this.saving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
