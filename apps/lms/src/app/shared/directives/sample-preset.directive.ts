import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';
import { SCAN_BURST, SCAN_BURST_EVENT } from '@prefrontal/shared';
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
 * - A hardware scanner never gets the preset glued in front of its code
 *   (an all-digit Sample ID would read "2610" + "261000123"): a scanner
 *   burst (HardwareScanService's `pf-scan-burst`) clears it, and so does a
 *   second key arriving scanner-fast (< SCAN_BURST.maxGapMs) right after it.
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
  /** First key typed after the untouched preset: when, and the field it left. */
  private afterPreset: { at: number; value: string } | null = null;
  /** The preset stripped for a scanner-fast burst (the scan capture may put
   *  the field back to it — then it must go too). */
  private stripped: string | null = null;

  constructor() {
    // Lazy: one small GET the first time any sample field exists.
    try { this.presets.ensure(); } catch { /* no DI in a test host */ }
    // CAPTURE phase: at the target, capture listeners run before the
    // screen's own (keydown.enter) / PF Keys handlers, so a swallowed Enter
    // or Backspace never reaches them.
    const onKey = (e: KeyboardEvent) => this.onKeydown(e);
    const onBurst = () => this.onScanBurst();
    this.el.addEventListener('keydown', onKey, true);
    this.el.addEventListener(SCAN_BURST_EVENT, onBurst);
    inject(DestroyRef).onDestroy(() => {
      this.el.removeEventListener('keydown', onKey, true);
      this.el.removeEventListener(SCAN_BURST_EVENT, onBurst);
    });
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
    this.afterPreset = null;
    this.stripped = null;
  }

  /** A hardware scan was typed into this field and routed as a scan: the
   *  field is back to the preset — drop it so nothing is left glued on. */
  onScanBurst(): void {
    this.afterPreset = null;
    const wasPreset = this.onlyPreset || (!!this.stripped && this.el.value === this.stripped);
    this.stripped = null;
    if (wasPreset) this.clear();
  }

  onKeydown(e: KeyboardEvent): void {
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // Scanner-fast second key right after the preset: it's a scanner typing a
    // whole Sample ID — strip the preset in front of the first character.
    const ap = this.afterPreset;
    this.afterPreset = null;
    if (ap && printable && this.applied && now - ap.at < SCAN_BURST.maxGapMs
        && this.el.value === ap.value && this.el.value.startsWith(this.applied)) {
      const tail = this.el.value.slice(this.applied.length);
      this.stripped = this.applied;
      this.applied = null;
      this.write(tail);
      return;
    }
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
      return;
    }
    // A digit continues the preset; remember it in case a scanner is typing.
    if (printable) {
      const value = this.el.value + e.key;
      this.afterPreset = { at: now, value };
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
