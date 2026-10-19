import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { VitalsInput } from '../frontdesk/desk.models';
import { VITAL_FIELDS, bmi, bmiBand, parseReading, validateVitals, vitalFlags, type VitalFieldDef, type VitalKey } from './vitals-rules';

/**
 * The ONE vitals entry form (Agent B): the vitals station's capture screen and
 * the front desk's "Take vitals here" step both render it. Kit fields
 * (.pf-field / .pf-input, 44px + 16px text on phones), numeric text boxes with
 * the unit inside (no spinners), BMI derived as you type, out-of-range flags as
 * neutral chips with a small red mark. Field errors appear once the host asks
 * (`reveal()`), never while typing a first value.
 */
@Component({
  selector: 'pf-opd-vitals-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-vf" [class.pf-vf--compact]="compact()">
      <div class="pf-vf__grid">
        @for (f of fields(); track f.key) {
          <label class="pf-field pf-vf__f">
            <span class="pf-field__lbl">{{ f.label }}</span>
            <span class="pf-vf__box">
              <input class="pf-input pf-num pf-vf__in" type="text" autocomplete="off"
                     [attr.inputmode]="f.decimals ? 'decimal' : 'numeric'"
                     [attr.data-vital]="f.key"
                     [class.pf-input--error]="shown() && !!errors()[f.key]"
                     [attr.aria-invalid]="shown() && !!errors()[f.key]"
                     [attr.aria-describedby]="shown() && errors()[f.key] ? 'pf-vf-err-' + f.key : null"
                     [value]="raw()[f.key] ?? ''"
                     (input)="set(f, $any($event.target).value)" />
              <span class="pf-vf__unit" aria-hidden="true">{{ f.unit }}</span>
            </span>
            @if (shown() && errors()[f.key]) {
              <span class="pf-vf__err" [id]="'pf-vf-err-' + f.key">{{ errors()[f.key] }}</span>
            }
          </label>
        }
      </div>

      <div class="pf-vf__bmi" aria-live="polite">
        <div class="pf-vf__bmi-v">
          <span class="pf-vf__bmi-k">BMI · calculated</span>
          <span class="pf-vf__bmi-n pf-num">{{ bmiValue() ?? '—' }}</span>
        </div>
        <div class="pf-vf__bmi-t">
          <span class="pf-vf__bmi-band">{{ band() ?? 'Enter weight and height' }}</span>
          <span class="pf-vf__bmi-h">weight ÷ (height in m)² · updates as you type</span>
        </div>
        <div class="pf-vf__scale" aria-hidden="true">
          <span class="pf-vf__seg"></span><span class="pf-vf__seg pf-vf__seg--n"></span><span class="pf-vf__seg"></span><span class="pf-vf__seg"></span>
          @if (bmiValue() != null) { <span class="pf-vf__mark" [style.left.%]="bmiPos()"></span> }
        </div>
      </div>

      @if (flags().length) {
        <div class="pf-vf__flags" role="status">
          @for (fl of flags(); track fl.key) {
            <span class="pf-chip pf-chip--static pf-vf__flag"><span class="pf-vf__flagdot" aria-hidden="true"></span>{{ fl.label }}</span>
          }
        </div>
      }

      @if (withNote()) {
        <label class="pf-field">
          <span class="pf-field__lbl">Nurse's note <span class="pf-vf__opt">· optional</span></span>
          <input class="pf-input" type="text" maxlength="500" [value]="note()" (input)="note.set($any($event.target).value)"
                 placeholder="e.g. Complains of nasal block for 10 days" />
        </label>
      }
      @if (shown() && errors().form) { <p class="pf-vf__err pf-vf__err--form" role="alert">{{ errors().form }}</p> }
    </div>
  `,
  styles: [`
    .pf-vf { display: flex; flex-direction: column; gap: 14px; }
    .pf-vf__grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px 12px; }
    .pf-vf--compact .pf-vf__grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    @media (max-width: 1180px) { .pf-vf__grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .pf-vf__grid, .pf-vf--compact .pf-vf__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .pf-vf__f { min-width: 0; }
    .pf-vf__box { position: relative; display: block; }
    .pf-vf__in { width: 100%; padding-right: 52px; }
    .pf-vf__unit { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-size: 12px; color: var(--text-tertiary); pointer-events: none; }
    .pf-vf__err { font-size: 12px; color: var(--red-text, #dc2626); }
    .pf-vf__err--form { margin: 0; }
    .pf-vf__opt { color: var(--text-tertiary); font-weight: 400; }
    .pf-vf__bmi {
      display: grid; grid-template-columns: auto auto 1fr; align-items: center; gap: 12px 20px;
      padding: 12px 14px; border: 1px dashed var(--pf-line); border-radius: var(--pf-radius-sm, 10px); background: var(--pf-chip-bg);
    }
    .pf-vf__bmi-v { display: flex; flex-direction: column; gap: 2px; }
    .pf-vf__bmi-k { font-size: 12px; color: var(--text-secondary); }
    .pf-vf__bmi-n { font-size: 26px; font-weight: 600; color: var(--text-primary); line-height: 1.1; }
    .pf-vf__bmi-t { display: flex; flex-direction: column; gap: 2px; }
    .pf-vf__bmi-band { font-size: 13px; color: var(--text-primary); }
    .pf-vf__bmi-h { font-size: 12px; color: var(--text-tertiary); }
    .pf-vf__scale { position: relative; display: grid; grid-template-columns: 18.5fr 6.5fr 5fr 10fr; gap: 2px; height: 6px; }
    .pf-vf__seg { border-radius: 3px; background: color-mix(in srgb, var(--color-primary, #7c3aed) 22%, transparent); }
    .pf-vf__seg--n { background: color-mix(in srgb, var(--color-primary, #7c3aed) 55%, transparent); }
    .pf-vf__mark { position: absolute; top: -5px; width: 3px; height: 16px; border-radius: 2px; background: var(--text-primary); transform: translateX(-50%); }
    @media (max-width: 760px) { .pf-vf__bmi { grid-template-columns: auto 1fr; } .pf-vf__scale { grid-column: 1 / -1; } }
    .pf-vf__flags { display: flex; flex-wrap: wrap; gap: 6px; }
    .pf-vf__flag { gap: 6px; }
    .pf-vf__flagdot { width: 7px; height: 7px; border-radius: 50%; background: var(--red-text, #dc2626); flex: none; }
    @media (max-width: 640px) { .pf-vf__in { height: 44px; font-size: 16px; } }
  `],
})
export class OpdVitalsFormComponent {
  /** Desk step: 4 columns, no note. */
  readonly compact = input(false);
  readonly withNote = input(true);
  readonly changed = output<VitalsInput>();

  readonly fields = computed<VitalFieldDef[]>(() =>
    this.compact() ? VITAL_FIELDS.filter(f => f.key !== 'grbs' && f.key !== 'painScore') : VITAL_FIELDS);
  readonly raw = signal<Partial<Record<VitalKey, string>>>({});
  readonly note = signal('');
  readonly shown = signal(false);

  readonly vitals = computed<VitalsInput>(() => {
    const out: VitalsInput = {};
    for (const f of VITAL_FIELDS) {
      const r = this.raw()[f.key];
      if (r == null || r === '') continue;
      out[f.key] = parseReading(r, f.decimals);
    }
    const n = this.note().trim();
    if (n) out.note = n;
    return out;
  });
  readonly errors = computed(() => validateVitals(this.vitals()));
  readonly valid = computed(() => Object.keys(this.errors()).length === 0);
  readonly bmiValue = computed(() => bmi(this.vitals().weightKg, this.vitals().heightCm));
  readonly band = computed(() => bmiBand(this.bmiValue()));
  /** Marker position on the 12–40 scale. */
  readonly bmiPos = computed(() => {
    const b = this.bmiValue() ?? 0;
    return Math.max(0, Math.min(100, ((b - 0) / 40) * 100));
  });
  readonly flags = computed(() => vitalFlags(this.vitals()));
  readonly empty = computed(() => Object.keys(this.vitals()).length === 0);

  set(f: VitalFieldDef, v: string) {
    const clean = f.decimals ? v.replace(/[^\d.]/g, '') : v.replace(/\D/g, '');
    this.raw.update(r => ({ ...r, [f.key]: clean }));
    this.changed.emit(this.vitals());
  }
  /** Show field errors (the host calls this on submit). */
  reveal(): void { this.shown.set(true); }
  /** Fill from a previous capture (edit / re-take). */
  load(v: VitalsInput | null | undefined): void {
    const r: Partial<Record<VitalKey, string>> = {};
    for (const f of VITAL_FIELDS) if (v?.[f.key] != null) r[f.key] = String(v[f.key]);
    this.raw.set(r);
    this.note.set(v?.note ?? '');
  }
  reset(): void { this.raw.set({}); this.note.set(''); this.shown.set(false); }
}
