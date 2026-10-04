import { DestroyRef, Directive, ElementRef, computed, effect, inject, input, untracked } from '@angular/core';
import { DeviceClassService } from '../../../core/services/device-class.service';
import { NUMPAD_EVENT, NumpadService, PfKeysEnterTone, PfKeysField } from './numpad.service';
import { NumpadChar, isTypedKey } from './numpad-keys';
import { PfKeysKind, PfKeysLayout, PfKeysPrefix, deptPrefixes, parseKind } from './pf-keys-layouts';
import { PfKeysDepartmentsService } from './pf-keys-departments.service';

/** Default primary-key wording per kind (the field's own Enter). */
const ENTER_LABEL: Record<PfKeysKind, string> = { test: 'Add', patient: 'Search', sample: 'Go' };
const ENTER_ARIA: Record<PfKeysKind, string> = { test: 'Add selected test', patient: 'Open selected patient', sample: 'Look up sample' };

/**
 * `pfKeys` — PF Keys, the LMS's own keypad for SEARCH fields on TABLETS
 * (docs/ND-PATTERN.md → 8. Touch → "PF Keys").
 *
 *   <input pfKeys="test" pfKeysEnter="Add" [pfKeysArrows]="true" …>
 *   <input pfKeys="patient">        (number pad: phone / MRN)
 *   <input pfKeys="sample">         (code pad: department prefix + digits)
 *
 * The primary key follows what the field's Enter will DO: bind
 * `[pfKeysEnter]` / `[pfKeysEnterAria]` / `[pfKeysEnterTone]` to the
 * screen's own highlight state (order create: "Add" ⇄ "Remove" as the
 * highlighted test is / isn't in the order). Fields that don't bind them
 * keep their fixed label (Open / Select / Receive / Search).
 *
 * Only on the TABLET device class (html.device-tablet: iPad / Android
 * tablets, native or browser). Phones and desktops: nothing is touched —
 * system / physical keyboard as before. Search fields only: never put it on
 * remarks, report text, names or addresses.
 *
 * It is the result numpad generalised, not a fork: the same NumpadService
 * types into the field (every key replayed through the field's own keydown
 * listeners first, then a real `input` event — ngModel, (input) handlers and
 * debounced searches see normal typing), the same `inputmode="none"` trick
 * (set on pointerdown, before iOS focuses the field; never `readonly`), the
 * same hardware-keyboard step-aside and Hide key. The primary key sends the
 * field its own Enter; ↑/↓ (only with `pfKeysArrows`, where the screen
 * already moves a highlight) send ArrowUp / ArrowDown.
 *
 * Escape hatch: the keyboard key switches THIS field to the system keyboard
 * (paste, unusual input) until it loses focus.
 */
@Directive({
  selector: 'input[pfKeys]',
  standalone: true,
  host: {
    '[attr.data-pf-keys]': 'kindOrNull()',
    '(focus)': 'onFocus()',
    '(blur)': 'onBlur()',
    '(pointerdown)': 'onPointerDown($event)',
    '(keydown)': 'onKeydown($event)',
    '(input)': 'onInput()',
    '(change)': 'dirty = false',
  },
})
export class PfKeysDirective implements PfKeysField {
  /** The field kind ('test' | 'patient' | 'sample'); null / '' = off. */
  readonly pfKeys = input<PfKeysKind | '' | null | false | undefined>(null);
  /** Open with this layout instead of the kind's default (a remembered
   *  choice still wins). */
  readonly pfKeysLayout = input<PfKeysLayout | null>(null);
  /** Primary key wording (e.g. "Add", "Search", "Receive"). */
  readonly pfKeysEnter = input<string | null>(null);
  /** Primary key aria-label (e.g. "Add selected test"). */
  readonly pfKeysEnterAria = input<string | null>(null);
  /** Primary key look: 'primary' (default, the violet CTA) or 'remove'
   *  (Enter removes the highlighted item: neutral key, muted-red outline). */
  readonly pfKeysEnterTone = input<PfKeysEnterTone | null>(null);
  /** The screen moves a highlight with ↑/↓ → show arrow keys. */
  readonly pfKeysArrows = input(false, { transform: (v: boolean | '' | null | undefined) => v === '' || !!v });
  /** Department prefixes for the code pad; null = the lab's departments. */
  readonly pfKeysPrefixes = input<PfKeysPrefix[] | null>(null);
  readonly pfKeysLabel = input<string | null>(null);

  readonly kind = 'keys' as const;
  readonly scope = null;
  readonly el = inject(ElementRef).nativeElement as HTMLInputElement;
  private readonly svc = inject(NumpadService);
  private readonly device = inject(DeviceClassService);
  private readonly depts = inject(PfKeysDepartmentsService);

  readonly parsedKind = computed(() => parseKind(this.pfKeys()));
  protected readonly kindOrNull = computed(() => this.parsedKind());
  /** PF Keys mode: a search kind AND a tablet. */
  readonly active = computed(() => !!this.parsedKind() && this.device.deviceClass() === 'tablet');

  dirty = false;
  /** Escape hatch on: the system keyboard until blur. */
  private system = false;
  /** Mid-switch to the system keyboard (its own blur must not end it). */
  private switching = false;
  private saved: { inputmode: string | null; autocomplete: string | null; autocorrect: string | null; spellcheck: string | null; autocapitalize: string | null } | null = null;
  private lastKind: PfKeysKind | null = null;
  private destroyed = false;

  constructor() {
    effect(() => {
      const on = this.active();
      const k = this.parsedKind();
      untracked(() => {
        const changed = this.lastKind !== null && k !== null && k !== this.lastKind;
        this.lastKind = k;
        this.applyMode(on && !this.system);
        if (on && changed) this.svc.rekey(this);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.svc.released(this);
      this.applyMode(false);
    });
  }

  // ── PfKeysField ──────────────────────────────────────────────────────
  keysKind(): PfKeysKind { return this.parsedKind() ?? 'test'; }
  defaultLayout(): PfKeysLayout | null { return this.pfKeysLayout(); }
  enterLabel(): string { return this.pfKeysEnter() || ENTER_LABEL[this.keysKind()]; }
  enterAria(): string { return this.pfKeysEnterAria() || ENTER_ARIA[this.keysKind()]; }
  enterTone(): PfKeysEnterTone { return this.pfKeysEnterTone() === 'remove' ? 'remove' : 'primary'; }
  arrows(): boolean { return this.pfKeysArrows(); }
  prefixes(): PfKeysPrefix[] {
    const given = this.pfKeysPrefixes();
    if (given) return given;
    const kind = this.keysKind();
    if (kind === 'patient') return [];
    return deptPrefixes(this.depts.list(), kind);
  }
  keys(): ReadonlySet<NumpadChar> { return new Set(); }
  label(): string {
    return this.pfKeysLabel() || this.el.getAttribute('aria-label') || this.el.getAttribute('placeholder') || 'Search';
  }
  unit(): string | null { return null; }
  flag(): null { return null; }
  markDirty(): void { this.dirty = true; }
  flushChange(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Escape hatch: give THIS field the system keyboard until it blurs
   *  (inputmode restored, then re-focused so iOS / Android read it). */
  useSystemKeyboard(): void {
    this.system = true;
    this.applyMode(false);
    const el = this.el;
    this.switching = true;
    try {
      el.blur();
      el.focus({ preventScroll: true });
    } finally {
      this.switching = false;
    }
  }

  // ── Mode ─────────────────────────────────────────────────────────────
  private applyMode(on: boolean): void {
    const el = this.el;
    if (on && !this.saved) {
      this.saved = {
        inputmode: el.getAttribute('inputmode'),
        autocomplete: el.getAttribute('autocomplete'),
        autocorrect: el.getAttribute('autocorrect'),
        spellcheck: el.getAttribute('spellcheck'),
        autocapitalize: el.getAttribute('autocapitalize'),
      };
      el.setAttribute('inputmode', 'none');
      // A search box: no autocorrect / suggestions (also when the escape
      // hatch hands it to the system keyboard).
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('autocapitalize', 'off');
      el.setAttribute('spellcheck', 'false');
      // Lazy: the panel is its own chunk, loaded on the first tablet field.
      void import('./pf-keys-panel.component')
        .then(m => { if (!this.destroyed) this.svc.ensurePanel(m.PfKeysPanelComponent); })
        .catch(() => { /* chunk failed to load: the field still works as a normal input */ });
      if (this.parsedKind() !== 'patient' && !this.pfKeysPrefixes()) this.depts.ensure();
    } else if (!on && this.saved) {
      const s = this.saved;
      this.saved = null;
      if (s.inputmode == null) el.removeAttribute('inputmode');
      else el.setAttribute('inputmode', s.inputmode);
      if (!this.system) {
        // Fully off (not the escape hatch): the field is exactly as it was.
        const put = (n: string, v: string | null) => v == null ? el.removeAttribute(n) : el.setAttribute(n, v);
        put('autocomplete', s.autocomplete);
        put('autocorrect', s.autocorrect);
        put('autocapitalize', s.autocapitalize);
        put('spellcheck', s.spellcheck);
      }
      this.svc.released(this);
    }
  }

  onFocus(): void {
    if (this.active() && !this.system) this.svc.focused(this);
  }

  onBlur(): void {
    if (this.switching) return;
    if (this.system) {
      // The escape hatch lasts until blur: PF Keys is back next time.
      this.system = false;
      if (this.active()) this.applyMode(true);
      this.flushChange();
      return;
    }
    if (this.active()) this.svc.blurred(this);
    else this.flushChange();
  }

  onPointerDown(e: PointerEvent): void {
    if (!this.active() || this.system) return;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    // iOS reads inputmode when focus lands (right after this event).
    this.svc.markTouch();
    this.applyMode(true);
    this.svc.tapped(this);
  }

  onKeydown(e: KeyboardEvent): void {
    if ((e as unknown as Record<string, unknown>)[NUMPAD_EVENT]) return;
    // A real key typed on a hardware keyboard: PF Keys steps aside.
    if (this.active() && !this.system && isTypedKey(e)) this.svc.hardwareKey(this);
  }

  onInput(): void {
    if (this.active()) this.svc.sync(this);
  }
}
