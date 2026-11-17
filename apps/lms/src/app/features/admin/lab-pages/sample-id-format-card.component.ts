import { SettingRowComponent } from '../../../shared/components/setting-row/setting-row.component';
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
  imports: [SettingRowComponent, FormsModule, SelectComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-sf" data-testid="sample-id-format">
      <!-- One setting per row (owner): title left, control right. SPACE-DATE-NUMBER, restarting each month per space. -->
      <pf-setting-row data-testid="sid-format-row" label="Date" hint="SPACE-DATE-NUMBER. Numbers restart each month per space.">
        <pf-select class="pf-sf__sel" [options]="dateOptions" [value]="date()" (valueChange)="date.set($any($event))" aria-label="Date"></pf-select>
      </pf-setting-row>
      <pf-setting-row label="Separator" hint="Blank = none.">
        <input class="pf-input pf-num pf-sf__in" maxlength="3" [ngModel]="sep()" (ngModelChange)="sep.set($event)" placeholder="none" aria-label="Separator" />
      </pf-setting-row>
      <pf-setting-row [label]="serial() === 'alpha' ? 'Minimum digits' : 'Digits'">
        <input class="pf-input pf-num pf-sf__in" type="number" min="1" [attr.max]="serial() === 'alpha' ? 6 : 10" [ngModel]="pad()"
               (ngModelChange)="pad.set(clamp($event))" (keydown)="preventMinus($event)" aria-label="Number digits" />
      </pf-setting-row>
      <pf-setting-row label="Letters" hint="Alphanumeric (AA001 …). Off = plain numbers.">
        @if (serial() === 'alpha') {
          <pf-select class="pf-sf__sel pf-sf__letters" [options]="letterOptions" [value]="letters()" (valueChange)="letters.set(+$any($event))" aria-label="Letters"></pf-select>
        }
        <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="serial() === 'alpha'" aria-label="Include letters"
                (click)="serial.set(serial() === 'alpha' ? 'numeric' : 'alpha')"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span></button>
      </pf-setting-row>
      <pf-setting-row label="Preview">
        <strong class="pf-fmt__value pf-num" data-testid="sample-id-preview">{{ preview() }}</strong>
      </pf-setting-row>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pf-sf__sel { width: 160px; }
    .pf-sf__in { width: 96px; height: 34px; min-height: 34px; }
    .pf-sf__scope { padding: 1px 7px; border-radius: 999px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg); font-size: 10.5px; font-weight: 600; color: var(--text-tertiary); white-space: nowrap; }
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
