import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * ONE minimal settings row (owner 2026-11-17, DESIGN-V2 rule 5): label (+ at most one muted hint line) on the left,
 * the control on the right, a divider between rows. Controls: pf-segmented for 2–4 choices, `pf-setting-toggle` for
 * on / off, compact inputs inline; a multi-field format sits in ONE row (fields → preview at the end).
 *
 *   <pf-setting-row label="Barcode on labels" hint="What the label printer prints.">
 *     <pf-segmented size="sm" [options]="…" [value]="…" (valueChange)="…"></pf-segmented>
 *   </pf-setting-row>
 *
 * `stack` puts a wide control (a list, a board) under the label instead of beside it.
 */
@Component({
  selector: 'pf-setting-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-srow', '[class.pf-srow--stack]': 'stack()', '[class.pf-srow--off]': 'muted()' },
  template: `
    <div class="pf-srow__text">
      <span class="pf-srow__label">{{ label() }}<ng-content select="[row-badge]"></ng-content></span>
      @if (hint()) { <span class="pf-srow__hint">{{ hint() }}</span> }
      <ng-content select="[row-hint]"></ng-content>
    </div>
    <div class="pf-srow__ctl"><ng-content></ng-content></div>
  `,
  styles: [`
    /* Two columns (owner 2026-11-17): a fixed label column, the control column starts right after it and is
       LEFT-aligned, so every control on the card lines up on one vertical edge. Equal row rhythm. */
    :host {
      display: grid; grid-template-columns: minmax(150px, 2fr) minmax(0, 3fr); align-items: center; gap: 6px 20px;
      min-height: 56px; padding: 10px 0; border-bottom: 1px solid var(--pf-line, var(--glass-border));
    }
    :host(:last-child) { border-bottom: 0; }
    :host(.pf-srow--stack) { grid-template-columns: minmax(0, 1fr); }
    .pf-srow__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-srow__label { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; font-weight: 500; color: var(--text-primary); line-height: 1.35; }
    .pf-srow__hint { font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); }
    :host(.pf-srow--off) .pf-srow__label, :host(.pf-srow--off) .pf-srow__hint { opacity: .6; }
    .pf-srow__ctl { display: flex; align-items: center; justify-content: flex-start; gap: 8px 10px; flex-wrap: wrap; min-width: 0; }
    :host(.pf-srow--stack) .pf-srow__ctl { justify-content: flex-start; }
    @media (max-width: 767px) { :host { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class SettingRowComponent {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly stack = input(false);
  readonly muted = input(false);
}

/** Default icon of a group card (sliders). */
export const SETTING_GROUP_ICON = 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4';

/**
 * ONE group of rows = ONE compact Test Master card (owner 2026-11-17): `pf-card__head` (icon + uppercase label +
 * the scope note once, e.g. "all branches") and the rows. A card-style setting lays its group cards out in the
 * `.pf-sgrid` grid that fills the width (1 → 2 → 3 → 4 columns). `wide` spans the whole grid row (a format line,
 * a per-department table). Without a label it is a plain anchor (`?tab=` target) around rows.
 */
@Component({
  selector: 'pf-setting-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pf-sgroup',
    '[class.pf-sgroup--plain]': '!label()',
    '[class.pf-sgroup--wide]': 'wide()',
    '[attr.data-group]': 'id()',
  },
  template: `
    @if (label()) {
      <section class="pf-card pf-sgroup__card" [attr.aria-label]="label()">
        <header class="pf-card__head pf-sgroup__head">
          <span class="pf-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icon() || defaultIcon"/></svg>
          </span>
          <h3 class="pf-card__label pf-sgroup__label">{{ label() }}</h3>
          @if (scope()) { <span class="pf-card__note pf-sgroup__scope">{{ scope() }}</span> }
          <span class="pf-sgroup__tools"><ng-content select="[group-tools]"></ng-content></span>
        </header>
        <div class="pf-sgroup__rows">
          @if (hint()) { <p class="pf-sgroup__hint">{{ hint() }}</p> }
          <ng-content></ng-content>
        </div>
      </section>
    } @else {
      <ng-content></ng-content>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; scroll-margin-top: 8px; }
    :host(.pf-sgroup--wide) { grid-column: 1 / -1; }
    :host(.pf-sgroup--plain) { display: contents; }
    .pf-sgroup__card { overflow: visible; }
    .pf-sgroup__head { flex-wrap: nowrap; }
    .pf-sgroup__label { margin: 0; flex: none; }
    .pf-sgroup__scope { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-sgroup__tools { margin-left: auto; display: inline-flex; gap: 8px; align-items: center; flex: none; }
    .pf-sgroup__tools:empty { display: none; }
    .pf-sgroup__rows { padding: 2px 16px 4px; }
    .pf-sgroup__hint { margin: 10px 0 0; font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); }
  `],
})
export class SettingGroupComponent {
  readonly label = input<string>('');
  readonly id = input<string | null>(null);
  /** Where the group applies, once (e.g. "per branch", "all branches") — never a pill on every row. */
  readonly scope = input<string | null>(null);
  /** One line under the head. */
  readonly hint = input<string | null>(null);
  /** Head icon (stroked path, 24-unit box). */
  readonly icon = input<string | null>(null);
  /** Span the whole grid row. */
  readonly wide = input(false);
  protected readonly defaultIcon = SETTING_GROUP_ICON;
}

/** The on / off switch for a row (the kit's `.pf-toggle`, a real `role="switch"` button). */
@Component({
  selector: 'pf-setting-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="value()" [attr.aria-label]="label()"
            [disabled]="disabled()" (click)="value.set(!value())">
      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
    </button>
  `,
  styles: [`:host { display: inline-flex; } .pf-toggle { min-height: 32px; }`],
})
export class SettingToggleComponent {
  readonly value = model(false);
  readonly label = input.required<string>();
  readonly disabled = input(false);
}
