import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { OpdFormField, OpdFormSchema } from '../../shared/opd.models';
import { PfSelectOption, SelectComponent } from '../../../../shared/primitives/select.component';
import { ToggleComponent } from '../../../../shared/primitives/toggle.component';
import { NdDateComponent } from '../../../../shared/components/nd-date/nd-date.component';

/** Renderer mode — the same union Agent A's `<pf-opd-form-renderer>` exports. */
export type OpdFormMode = 'edit' | 'view';

/**
 * THE FORM-RENDERER SEAM (Agent C ⇄ Agent A).
 *
 * Agent A builds the real, reusable `<pf-opd-form-renderer>` in admin/**. The
 * consult was built in parallel, so Step 1 renders the service's consult form
 * through THIS minimal adapter, whose public API matches A's renderer:
 *
 *   inputs : schema: OpdFormSchema · answers: Record<string, unknown> · mode: 'edit' | 'view'
 *            (+ addonFields: OpdFormField[] — the doctor's add-only fields, rendered
 *             as a trailing "My fields" section; A's renderer takes the merged schema)
 *   output : answersChange(Record<string, unknown>)
 *
 * INTEGRATOR: swap `<pf-opd-form-slot>` for `<pf-opd-form-renderer>` in
 * consult-workspace.page.ts + patient-history.page.ts (merge addonFields into
 * the schema with `mergeAddons()` below) and delete this folder. Nothing else
 * in the consult depends on it.
 */
export function mergeAddons(schema: OpdFormSchema | null | undefined, addons: readonly OpdFormField[] = []): OpdFormSchema {
  const sections = [...(schema?.sections ?? [])];
  if (addons.length) sections.push({ key: '__doctor_addons', title: 'My fields', fields: [...addons] });
  return { sections };
}

@Component({
  selector: 'pf-opd-form-slot',
  standalone: true,
  imports: [SelectComponent, ToggleComponent, NdDateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (s of merged().sections; track s.key) {
      @if (s.fields.length) {
        <section class="fs">
          @if (merged().sections.length > 1 || s.key === '__doctor_addons') { <h4 class="fs__t">{{ s.title }}</h4> }
          <div class="fs__grid">
            @for (f of s.fields; track f.key) {
              <div class="nd-field fs__f" [class.fs__f--wide]="f.type === 'textarea' || f.type === 'multiselect'">
                <span class="nd-field__lbl">{{ f.label }}@if (f.required && mode() === 'edit') { <span class="fs__req" aria-hidden="true"> *</span> }</span>
                @if (mode() === 'view') {
                  <span class="fs__v">{{ display(f) || '—' }}</span>
                } @else {
                  @switch (f.type) {
                    @case ('textarea') {
                      <textarea class="nd-input" rows="3" [attr.aria-label]="f.label" [value]="str(f)" (input)="set(f, $any($event.target).value)" [placeholder]="f.hint || ''"></textarea>
                    }
                    @case ('number') {
                      <span class="fs__unit">
                        <input class="nd-input nd-num" type="number" inputmode="decimal" [attr.aria-label]="f.label" [attr.min]="f.min ?? null" [attr.max]="f.max ?? null"
                               [value]="str(f)" (input)="setNum(f, $any($event.target).value)" [placeholder]="f.hint || ''" />
                        @if (f.unit) { <em>{{ f.unit }}</em> }
                      </span>
                    }
                    @case ('select') {
                      <pf-select [options]="opts(f)" [value]="str(f)" [searchable]="(f.options?.length ?? 0) > 8" placeholder="Choose…"
                                 (valueChange)="set(f, $event)"></pf-select>
                    }
                    @case ('multiselect') {
                      <pf-select [options]="opts(f)" [multiple]="true" [values]="arr(f)" [searchable]="(f.options?.length ?? 0) > 8" placeholder="Choose…"
                                 (valuesChange)="set(f, $event)"></pf-select>
                    }
                    @case ('boolean') {
                      <span class="fs__bool"><pf-toggle [checked]="!!answers()[f.key]" (checkedChange)="set(f, $event)"></pf-toggle>{{ answers()[f.key] ? 'Yes' : 'No' }}</span>
                    }
                    @case ('date') {
                      <pf-nd-date [value]="str(f) || null" [label]="f.label" (valueChange)="set(f, $event)"></pf-nd-date>
                    }
                    @case ('scale') {
                      <span class="fs__scale" role="radiogroup" [attr.aria-label]="f.label">
                        @for (n of scale(f); track n) {
                          <button type="button" role="radio" [attr.aria-checked]="answers()[f.key] === n" [class.on]="answers()[f.key] === n" (click)="set(f, n)">{{ n }}</button>
                        }
                      </span>
                    }
                    @default {
                      <input class="nd-input" type="text" [attr.aria-label]="f.label" [value]="str(f)" (input)="set(f, $any($event.target).value)" [placeholder]="f.hint || ''" />
                    }
                  }
                }
              </div>
            }
          </div>
        </section>
      }
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 16px; }
    .fs__t { margin: 0 0 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
    .fs__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; }
    .fs__f--wide { grid-column: 1 / -1; }
    .fs__req { color: var(--red-text, #dc2626); }
    .fs__v { font-size: 14px; color: var(--text-primary); line-height: 1.45; white-space: pre-wrap; }
    .fs__unit { position: relative; display: block; }
    .fs__unit em { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-style: normal; font-size: 12.5px; color: var(--text-tertiary); pointer-events: none; }
    .fs__bool { display: inline-flex; align-items: center; gap: 10px; min-height: 40px; font-size: 13.5px; color: var(--text-secondary); }
    .fs__scale { display: flex; flex-wrap: wrap; gap: 6px; }
    .fs__scale button { min-width: 40px; min-height: 40px; border-radius: 10px; border: 1px solid var(--nd-line); background: var(--nd-card-bg); color: var(--text-primary); font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; }
    .fs__scale button.on { background: var(--nd-in-tint); border-color: var(--nd-sel-border); color: var(--violet-text, #6d28d9); font-weight: 600; }
    textarea.nd-input { min-height: 88px; }
    @media (max-width: 760px) { .fs__grid { grid-template-columns: 1fr; } .nd-input { font-size: 16px; } }
  `],
})
export class OpdFormSlotComponent {
  readonly schema = input<OpdFormSchema | null>(null);
  readonly answers = input<Record<string, unknown>>({});
  readonly mode = input<OpdFormMode>('edit');
  readonly addonFields = input<OpdFormField[]>([]);
  readonly answersChange = output<Record<string, unknown>>();

  readonly merged = computed(() => mergeAddons(this.schema(), this.addonFields()));

  str(f: OpdFormField): string { const v = this.answers()[f.key]; return v == null ? '' : String(v); }
  arr(f: OpdFormField): string[] { const v = this.answers()[f.key]; return Array.isArray(v) ? v.map(String) : []; }
  opts(f: OpdFormField): PfSelectOption[] { return (f.options ?? []).map(o => ({ value: o, label: o })); }
  scale(f: OpdFormField): number[] {
    const lo = f.min ?? 0, hi = f.max ?? 10;
    return Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);
  }
  display(f: OpdFormField): string {
    const v = this.answers()[f.key];
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v) + (f.unit ? ' ' + f.unit : '');
  }
  set(f: OpdFormField, v: unknown) { this.answersChange.emit({ ...this.answers(), [f.key]: v }); }
  setNum(f: OpdFormField, raw: string) { this.set(f, raw === '' ? null : Number(raw)); }
}
