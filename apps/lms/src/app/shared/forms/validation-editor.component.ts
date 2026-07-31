import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormFieldType, ValidationConfig } from './form-field.model';
import { isMultiSelectType, isNumericType, supportsLengthValidation, supportsPatternValidation } from './validate';

// Inline validation config editor. Shows bounds/length/pattern inputs
// filtered by the field's type so a checkbox never gets a "max length"
// control. Emits { isRequired, validation } so callers can patchField()
// in one shot.

export interface ValidationPatch {
  isRequired: boolean;
  validation: ValidationConfig | null;
}

@Component({
  selector: 'pf-validation-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-val-editor">
      @if (!open()) {
        <button type="button" class="pf-val-trigger"
                (click)="toggle()"
                [attr.aria-expanded]="false">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          Validation
          @if (summary(); as s) {
            <span class="pf-val-badge">{{ s }}</span>
          }
        </button>
      } @else {
        <div class="pf-val-body">
          <div class="pf-val-head">
            <span class="pf-val-head__title">Validation</span>
            <button type="button" class="pf-val-head__close" (click)="toggle()" aria-label="Collapse">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          </div>

          <label class="pf-val-check">
            <input type="checkbox"
                   [checked]="isRequiredValue()"
                   (change)="emitRequired($any($event.target).checked)" />
            <span>Required</span>
          </label>

          @if (numericBounds()) {
            <div class="pf-val-row">
              <div class="pf-val-cell">
                <label class="pf-val-label">{{ boundsLabel() }} min</label>
                <!-- [attr.value] writes the HTML attribute, which seeds .defaultValue
                     and (only on a fresh, undirtied input) .value too. Once the user
                     has typed, subsequent attribute writes don't touch .value, so
                     parent re-renders can't clobber in-progress edits. -->
                <input #minIn type="number" class="pf-input text-sm" step="any"
                       [attr.value]="validationValue()?.min ?? null"
                       (input)="patch({ min: toNum(minIn.value) })" />
              </div>
              <div class="pf-val-cell">
                <label class="pf-val-label">{{ boundsLabel() }} max</label>
                <input #maxIn type="number" class="pf-input text-sm" step="any"
                       [attr.value]="validationValue()?.max ?? null"
                       (input)="patch({ max: toNum(maxIn.value) })" />
              </div>
            </div>
          }

          @if (lengthBounds()) {
            <div class="pf-val-row">
              <div class="pf-val-cell">
                <label class="pf-val-label">Min length</label>
                <input #minLenIn type="number" class="pf-input text-sm" min="0" step="1"
                       [attr.value]="validationValue()?.minLength ?? null"
                       (input)="patch({ minLength: toNum(minLenIn.value) })" />
              </div>
              <div class="pf-val-cell">
                <label class="pf-val-label">Max length</label>
                <input #maxLenIn type="number" class="pf-input text-sm" min="0" step="1"
                       [attr.value]="validationValue()?.maxLength ?? null"
                       (input)="patch({ maxLength: toNum(maxLenIn.value) })" />
              </div>
            </div>
          }

          @if (patternBounds()) {
            <div class="pf-val-cell">
              <label class="pf-val-label">Pattern (regex)</label>
              <input #patIn type="text" class="pf-input text-sm"
                     [attr.value]="validationValue()?.pattern ?? null"
                     (input)="patch({ pattern: patIn.value || null })"
                     placeholder="e.g. ^[A-Z0-9-]+$" />
            </div>
          }

          <div class="pf-val-cell">
            <label class="pf-val-label">Error message (optional)</label>
            <input #errIn type="text" class="pf-input text-sm"
                   [attr.value]="validationValue()?.errorMessage ?? null"
                   (input)="patch({ errorMessage: errIn.value || null })"
                   placeholder="Shown in place of the default message" />
          </div>

          @if (hasAnyRule()) {
            <button type="button" class="pf-val-clear" (click)="clearAll()">
              Clear all validation
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .pf-val-editor { font-size: 12px; }

    .pf-val-trigger {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 9999px;
      background: rgba(124, 58, 237, 0.08);
      border: 1px dashed rgba(124, 58, 237, 0.35);
      color: var(--violet-text);
      cursor: pointer;
      font-weight: 500;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .pf-val-trigger:hover {
      background: rgba(124, 58, 237, 0.14);
      border-color: rgba(124, 58, 237, 0.55);
    }

    .pf-val-badge {
      display: inline-flex;
      align-items: center;
      padding: 0 6px;
      margin-left: 4px;
      height: 16px;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.2);
      color: var(--violet-text);
      font-size: 10px;
      font-weight: 600;
    }

    .pf-val-body {
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--bg-card-solid);
      border: 1px solid rgba(124, 58, 237, 0.25);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pf-val-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .pf-val-head__title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-val-head__close {
      width: 22px;
      height: 22px;
      border-radius: 9999px;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .pf-val-head__close:hover { background: var(--bg-hover); color: var(--text-primary); }

    .pf-val-check {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      color: var(--text-primary);
    }
    .pf-val-check input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: #a855f7;
    }

    .pf-val-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .pf-val-cell { display: flex; flex-direction: column; gap: 3px; }
    .pf-val-label {
      font-size: 11px;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }

    .pf-val-clear {
      background: none;
      border: none;
      color: var(--red-text);
      font-size: 12px;
      cursor: pointer;
      align-self: flex-start;
      padding: 2px 0;
    }
    .pf-val-clear:hover { text-decoration: underline; }
  `]
})
export class ValidationEditorComponent {
  @Input({ required: true }) set type(v: FormFieldType) { this._type.set(v); }
  @Input({ required: true }) set isRequired(v: boolean) {
    // Skip echoes of what we just emitted — prevents the parent's round-trip
    // from resetting the local signal while the user is still interacting.
    if (!!v === this._lastEmittedRequired && this._initialized) return;
    this._isRequired.set(!!v);
  }
  @Input() set validation(v: ValidationConfig | null | undefined) {
    const incoming = v ?? null;
    if (this._initialized && shallowEqualValidation(incoming, this._lastEmittedValidation)) return;
    this._validation.set(incoming);
    if (!this._initialized) {
      this._lastEmittedValidation = incoming;
      this._initialized = true;
    }
  }

  @Output() change = new EventEmitter<ValidationPatch>();

  private readonly _type = signal<FormFieldType>('text');
  private readonly _isRequired = signal(false);
  private readonly _validation = signal<ValidationConfig | null>(null);
  protected readonly open = signal(false);

  // Round-trip guard: last value we emitted to the parent. Used by the
  // @Input setters above to skip re-applying the same value back into the
  // local signal, which otherwise causes a visible flicker/clear on focus.
  private _lastEmittedValidation: ValidationConfig | null = null;
  private _lastEmittedRequired = false;
  private _initialized = false;

  readonly validationValue = this._validation.asReadonly();
  readonly isRequiredValue = this._isRequired.asReadonly();

  readonly numericBounds = computed(() => isNumericType(this._type()) || isMultiSelectType(this._type()));
  readonly lengthBounds  = computed(() => supportsLengthValidation(this._type()));
  readonly patternBounds = computed(() => supportsPatternValidation(this._type()));

  readonly boundsLabel = computed(() => isMultiSelectType(this._type()) ? 'Selections' : 'Value');

  readonly hasAnyRule = computed(() => {
    const v = this._validation();
    if (this._isRequired()) return true;
    if (!v) return false;
    return v.min != null || v.max != null || v.minLength != null || v.maxLength != null ||
           !!v.pattern || !!v.errorMessage;
  });

  // Short summary shown on the collapsed trigger pill (e.g. "Required", "≤ 1000").
  readonly summary = computed<string | null>(() => {
    const v = this._validation();
    const bits: string[] = [];
    if (this._isRequired()) bits.push('Required');
    if (v?.max != null) bits.push(`≤ ${v.max}`);
    else if (v?.min != null) bits.push(`≥ ${v.min}`);
    if (v?.maxLength != null) bits.push(`≤ ${v.maxLength} chars`);
    if (v?.pattern) bits.push('pattern');
    return bits.length ? bits.slice(0, 2).join(' · ') : null;
  });

  protected toggle() { this.open.update(v => !v); }

  protected toNum(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }

  protected emitRequired(required: boolean) {
    this._isRequired.set(required);
    this.emit(this._validation(), required);
  }

  protected patch(updates: Partial<ValidationConfig>) {
    const next: ValidationConfig = { ...(this._validation() ?? {}), ...updates };
    // Strip empty so JSON stays tidy.
    const cleaned: ValidationConfig = {};
    (Object.keys(next) as (keyof ValidationConfig)[]).forEach(k => {
      const val = next[k];
      if (val !== null && val !== undefined && val !== '') (cleaned as Record<string, unknown>)[k] = val;
    });
    const final = Object.keys(cleaned).length ? cleaned : null;
    this._validation.set(final);
    this.emit(final, this._isRequired());
  }

  protected clearAll() {
    this._isRequired.set(false);
    this._validation.set(null);
    this.emit(null, false);
  }

  private emit(validation: ValidationConfig | null, isRequired: boolean) {
    this._lastEmittedValidation = validation;
    this._lastEmittedRequired = isRequired;
    this.change.emit({ isRequired, validation });
  }
}

// Shallow equality on the subset of ValidationConfig keys that matter for
// the echo guard. Lets us treat parent's re-rendered copy of what we
// emitted as "no real change" and skip re-seeding the local signal.
function shallowEqualValidation(a: ValidationConfig | null, b: ValidationConfig | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys: (keyof ValidationConfig)[] = ['min', 'max', 'minLength', 'maxLength', 'pattern', 'errorMessage'];
  return keys.every(k => (a[k] ?? null) === (b[k] ?? null));
}
