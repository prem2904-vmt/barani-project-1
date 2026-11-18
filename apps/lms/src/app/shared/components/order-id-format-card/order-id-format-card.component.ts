import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../models/api-response.model';
import { PfSelectOption, SelectComponent } from '../../primitives/select.component';
import { SettingRowComponent } from '../setting-row/setting-row.component';
import { SettingsSavebarComponent } from '../setting-row/settings-savebar.component';

/** The modules that own an order-number series (mirrors the server's OrderModules). */
export type OrderIdModule = 'lab' | 'opd' | 'pharmacy';

export const ORDER_ID_DATE_OPTIONS: PfSelectOption[] = [
  { value: 'yymmdd', label: 'YYMMDD' }, { value: 'ddmmyy', label: 'DDMMYY' },
  { value: 'mmdd', label: 'MMDD' }, { value: 'yymm', label: 'YYMM' },
  { value: 'mmyy', label: 'MMYY' }, { value: 'yy', label: 'YY' },
  { value: 'dd', label: 'DD' }, { value: 'none', label: 'None' },
];
const LETTER_OPTIONS: PfSelectOption<number>[] = [
  { value: 1, label: 'A' }, { value: 2, label: 'AA' }, { value: 3, label: 'AAA' }, { value: 4, label: 'AAAA' },
];

/** What each module prints when no prefix is chosen (the server's OrderModules.DefaultPrefix). */
export const ORDER_ID_DEFAULT_PREFIX: Readonly<Record<OrderIdModule, string>> = { lab: 'LAB', opd: 'OPD', pharmacy: 'PD' };

/** Clamp the number width: 1–10 digits, or 1–6 when letters lead the number. */
export function sanitizeOrderPad(val: unknown, isAlpha: boolean): number {
  const maxPad = isAlpha ? 6 : 10;
  const num = Math.abs(parseInt(String(val), 10));
  if (isNaN(num) || num < 1) return 1;
  return Math.min(num, maxPad);
}

/** The prefix as the server keeps it: letters and digits only, upper-case, at most 16. */
export function cleanOrderPrefix(v: unknown): string {
  return String(v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16);
}

/** What the first number looks like with today's date; a separator sits between every non-empty part (server mirror). */
export function orderIdPreview(prefix: string, date: string, sep: string, pad: number, serial: 'numeric' | 'alpha', letters: number, now = new Date()): string {
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
  const cleanPad = sanitizeOrderPad(pad, serial === 'alpha');
  const ser = serial === 'alpha'
    ? 'A'.repeat(Math.min(Math.max(letters, 1), 4)) + '1'.padStart(cleanPad, '0')
    : '1'.padStart(cleanPad, '0');
  return [prefix, d, ser].filter(p => p.length).join(sep ?? '');
}

/**
 * The number format of one module's orders (Order IDs per module, 2026-11-18): Lab's order ID, OPD's visit number,
 * Pharmacy's dispense number. One card, three homes; the API is `/api/config/order-id?module=`.
 *
 * Lab is always on (its row is the existing Order ID setting). OPD and Pharmacy are opt-in: with "Custom format" off
 * the fixed OPD-2611-000123 / PD-2611-000123 keeps printing and nothing is stored until the first Save.
 * Rows: one per setting (label left / control right), a live Preview, ONE Save in the band corner (savebar registers).
 */
@Component({
  selector: 'pf-order-id-format-card',
  standalone: true,
  imports: [SettingRowComponent, SettingsSavebarComponent, FormsModule, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-oid" [attr.data-testid]="'order-id-format-' + module()">
      @if (optIn()) {
        <pf-setting-row data-testid="oid-custom-row" label="Custom format"
                        [hint]="enabled() ? 'The number restarts when the printed date changes; numbers already issued never change.' : 'Built-in format (e.g. ' + builtIn() + ').'">
          <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="enabled()" [attr.aria-label]="'Custom ' + noun() + ' format'"
                  (click)="enabled.set(!enabled())"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span></button>
        </pf-setting-row>
      }
      @if (!optIn() || enabled()) {
        <pf-setting-row data-testid="oid-prefix-row" label="Prefix" [hint]="'Blank = ' + defaultPrefix() + '. A new prefix starts a fresh series.'">
          <input class="pf-input pf-num pf-oid__in" maxlength="16" [ngModel]="prefix()" (ngModelChange)="prefix.set(clean($event))"
                 [placeholder]="defaultPrefix()" aria-label="Prefix" autocapitalize="characters" autocomplete="off" spellcheck="false" />
        </pf-setting-row>
        <pf-setting-row data-testid="oid-format-row" label="Date" hint="The number restarts when the printed date changes.">
          <pf-select class="pf-oid__sel" [options]="dateOptions" [value]="date()" (valueChange)="date.set($any($event))" aria-label="Date"></pf-select>
        </pf-setting-row>
        <pf-setting-row label="Separator" hint="Blank = none.">
          <input class="pf-input pf-num pf-oid__in" maxlength="3" [ngModel]="sep()" (ngModelChange)="sep.set($event)" placeholder="none" aria-label="Separator" />
        </pf-setting-row>
        <pf-setting-row [label]="serial() === 'alpha' ? 'Minimum digits' : 'Digits'">
          <input class="pf-input pf-num pf-oid__in" type="number" min="1" [attr.max]="serial() === 'alpha' ? 6 : 10" [ngModel]="pad()"
                 (ngModelChange)="pad.set(clamp($event))" (keydown)="preventMinus($event)" aria-label="Number digits" />
        </pf-setting-row>
        <pf-setting-row label="Letters" hint="Alphanumeric (AA001 …). Off = plain numbers.">
          @if (serial() === 'alpha') {
            <pf-select class="pf-oid__sel pf-oid__letters" [options]="letterOptions" [value]="letters()" (valueChange)="letters.set(+$any($event))" aria-label="Letters"></pf-select>
          }
          <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="serial() === 'alpha'" aria-label="Include letters"
                  (click)="serial.set(serial() === 'alpha' ? 'numeric' : 'alpha')"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span></button>
        </pf-setting-row>
      }
      <pf-setting-row label="Preview">
        <strong class="pf-fmt__value pf-num" data-testid="order-id-preview">{{ preview() }}</strong>
      </pf-setting-row>
      <pf-settings-savebar [label]="noun() + ' format changed'" [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discard()"></pf-settings-savebar>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pf-oid__sel { width: 160px; }
    .pf-oid__in { width: 110px; height: 34px; min-height: 34px; }
    .pf-oid__letters { max-width: 220px; }
  `],
})
export class OrderIdFormatCardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  /** Which module's number this card edits. */
  readonly module = input.required<OrderIdModule>();

  readonly dateOptions = ORDER_ID_DATE_OPTIONS;
  readonly letterOptions = LETTER_OPTIONS;
  protected readonly defaultPrefix = computed(() => ORDER_ID_DEFAULT_PREFIX[this.module()]);
  /** Lab is always custom (its row is the existing Order ID setting); OPD / Pharmacy opt in. */
  protected readonly optIn = computed(() => this.module() !== 'lab');
  protected readonly noun = computed(() => ({ lab: 'Order ID', opd: 'Visit number', pharmacy: 'Dispense number' })[this.module()]);

  readonly enabled = signal(false);
  readonly prefix = signal('');
  readonly date = signal('yymm');
  readonly sep = signal('-');
  readonly pad = signal(6);
  readonly serial = signal<'numeric' | 'alpha'>('numeric');
  readonly letters = signal(2);
  readonly saving = signal(false);

  /** The fixed format a tenant without a custom one keeps getting. */
  protected readonly builtIn = computed(() => orderIdPreview(this.defaultPrefix(), 'yymm', '-', 6, 'numeric', 2));
  readonly preview = computed(() => this.optIn() && !this.enabled()
    ? this.builtIn()
    : orderIdPreview(this.prefix() || this.defaultPrefix(), this.date(), this.sep(), this.pad(), this.serial(), this.letters()));

  protected clean(v: unknown): string { return cleanOrderPrefix(v); }
  protected clamp(v: unknown): number { return sanitizeOrderPad(v, this.serial() === 'alpha'); }
  protected preventMinus(e: KeyboardEvent) {
    if (e.key === '-' || e.key === '+' || e.key === 'e') e.preventDefault();
  }

  private url(): string { return `/api/config/order-id?module=${this.module()}`; }

  ngOnInit() {
    this.api.get<any>(this.url()).subscribe({
      next: c => {
        if (!c) { this.baseline.set(this.snapshot()); return; }
        this.enabled.set(this.optIn() ? !!c.enabled : true);
        this.prefix.set(cleanOrderPrefix(c.prefix));
        this.date.set(c.datePrefix ?? this.date());
        this.sep.set(c.separator ?? '-');
        this.pad.set(sanitizeOrderPad(c.padding ?? this.pad(), c.serialMode === 'alpha'));
        this.serial.set(c.serialMode === 'alpha' ? 'alpha' : 'numeric');
        this.letters.set(Math.min(Math.max(c.letterCount ?? 2, 1), 4));
        this.baseline.set(this.snapshot());
      },
      error: () => this.baseline.set(this.snapshot()),
    });
  }

  // ── Unsaved changes: the band Save lights up only while the format differs from what was loaded / saved ──
  private snapshot(): string { return JSON.stringify([this.optIn() ? this.enabled() : true, this.prefix(), this.date(), this.sep(), this.pad(), this.serial(), this.letters()]); }
  private readonly baseline = signal('');
  readonly dirty = computed(() => !!this.baseline() && this.snapshot() !== this.baseline());
  discard(): void {
    const b = this.baseline();
    if (!b) return;
    const [e, p, d, s, pad, ser, l] = JSON.parse(b);
    this.enabled.set(e); this.prefix.set(p); this.date.set(d); this.sep.set(s); this.pad.set(pad); this.serial.set(ser); this.letters.set(l);
  }

  save() {
    const cleanPad = sanitizeOrderPad(this.pad(), this.serial() === 'alpha');
    this.pad.set(cleanPad);
    this.saving.set(true);
    this.api.post(this.url(), {
      enabled: this.optIn() ? this.enabled() : true,
      datePrefix: this.date(),
      separator: this.sep() ?? '',
      padding: cleanPad,
      serialMode: this.serial(),
      letterCount: this.letters(),
      prefix: this.prefix().trim() || null,
    }).subscribe({
      next: () => { this.saving.set(false); this.baseline.set(this.snapshot()); this.toasts.success(`${this.noun()} format saved`); },
      error: e => { this.saving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
