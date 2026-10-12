import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';
import { SampleSearchPresetService } from '../../core/services/sample-search-preset.service';

/**
 * `pfSamplePreset` — pre-types the current sample-ID head into a sample
 * search box (e.g. "2609", or "HEM26" for a one-department user) so the tech
 * types only the tail number. docs/PF-PATTERN.md → "Sample search preset".
 *
 *   <input pfKeys="sample" pfSamplePreset …>
 *   <input [pfSamplePreset]="isSampleField">      (false = off)
 *
 * - On FOCUS of an EMPTY field: the preset is computed then (so it rolls to
 *   2610 on the 1st) and typed in with the caret at the end — typing simply
 *   continues after it.
 * - ONE Backspace (hardware or the PF Keys ⌫) while the field still holds
 *   just the preset clears it whole.
 * - Typing a letter first (a patient name on Collect) replaces the preset.
 * - Leaving the field with only the preset in it clears it again, so the
 *   list filter / placeholder return.
 * - Enter with only the preset does not submit a lookup.
 * Off when the lab turned the preset off, the config isn't loaded, or the
 * format has no head. The value is written like PF Keys writes it (value +
 * a real `input` event), so ngModel / (input) handlers see normal typing.
 */
@Directive({
  selector: 'input[pfSamplePreset]',
  standalone: true,
  host: {
    '(focus)': 'onFocus()',
    '(blur)': 'onBlur()',
  },
})
export class SamplePresetDirective {
  /** '' (bare attribute) / true = on; false / null = off. */
  readonly pfSamplePreset = input<boolean | '' | null | undefined>(true);

  private readonly el = inject(ElementRef).nativeElement as HTMLInputElement;
  private readonly presets = inject(SampleSearchPresetService);
  /** The preset this directive typed (null once cleared). */
  private applied: string | null = null;

  constructor() {
    // Lazy: one small GET the first time any sample field exists.
    try { this.presets.ensure(); } catch { /* no DI in a test host */ }
    // CAPTURE phase: at the target, capture listeners run before the
    // screen's own (keydown.enter) / PF Keys handlers, so a swallowed Enter
    // or Backspace never reaches them.
    const onKey = (e: KeyboardEvent) => this.onKeydown(e);
    this.el.addEventListener('keydown', onKey, true);
    inject(DestroyRef).onDestroy(() => this.el.removeEventListener('keydown', onKey, true));
  }

  private get on(): boolean {
    const v = this.pfSamplePreset();
    return v === '' || v === true || v === undefined;
  }

  /** True while the field holds exactly the untouched preset. */
  private get onlyPreset(): boolean {
    return !!this.applied && this.el.value === this.applied;
  }

  onFocus(): void {
    if (!this.on || this.el.value !== '') return;
    const preset = this.presets.current();
    if (!preset) return;
    this.applied = preset;
    this.write(preset);
  }

  onBlur(): void {
    if (this.onlyPreset) this.clear();
    this.applied = null;
  }

  onKeydown(e: KeyboardEvent): void {
    if (!this.onlyPreset) return;
    if (e.key === 'Backspace') {
      // Whole preset in one press (PF Keys replays its ⌫ here too; a
      // prevented keydown tells it not to delete a character itself).
      e.preventDefault();
      this.clear();
      return;
    }
    if (e.key === 'Enter') {
      // Only the preset — nothing to look up yet.
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    // A letter typed first: the user is searching something else (a name,
    // another prefix) — drop the preset and let the key land in an empty field.
    if (e.key.length === 1 && /[a-z]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.applied = null;
      this.el.value = '';
    }
  }

  private clear(): void {
    this.applied = null;
    this.write('');
  }

  private write(value: string): void {
    const el = this.el;
    el.value = value;
    try { el.setSelectionRange(value.length, value.length); } catch { /* no selection API */ }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
