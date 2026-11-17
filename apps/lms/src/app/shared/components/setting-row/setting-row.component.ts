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
      display: grid; grid-template-columns: 300px minmax(0, 1fr); align-items: center; gap: 6px 24px;
      min-height: 56px; padding: 10px 0; border-bottom: 1px solid var(--pf-line, var(--glass-border));
    }
    :host(:last-child), :host(:has(+ pf-setting-group)) { border-bottom: 0; }
    :host(.pf-srow--stack) { grid-template-columns: minmax(0, 1fr); }
    .pf-srow__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-srow__label { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; font-weight: 500; color: var(--text-primary); line-height: 1.35; }
    .pf-srow__hint { font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); }
    :host(.pf-srow--off) .pf-srow__label, :host(.pf-srow--off) .pf-srow__hint { opacity: .6; }
    .pf-srow__ctl { display: flex; align-items: center; justify-content: flex-start; gap: 8px 10px; flex-wrap: wrap; min-width: 0; }
    :host(.pf-srow--stack) .pf-srow__ctl { justify-content: flex-start; }
    @media (max-width: 900px) { :host { grid-template-columns: 220px minmax(0, 1fr); } }
    @media (max-width: 767px) { :host { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class SettingRowComponent {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly stack = input(false);
  readonly muted = input(false);
}

/** A small uppercase group label over a run of rows (a card's category when the setting is one card). */
@Component({
  selector: 'pf-setting-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-sgroup', '[class.pf-sgroup--plain]': '!label()', '[attr.data-group]': 'id()' },
  template: `
    @if (label()) {
      <div class="pf-sgroup__head">
        <span class="pf-sgroup__label">{{ label() }}@if (scope()) {<span class="pf-sgroup__scope"> · {{ scope() }}</span>}</span>
        <span class="pf-sgroup__tools"><ng-content select="[group-tools]"></ng-content></span>
      </div>
    }
    @if (hint()) { <p class="pf-sgroup__hint">{{ hint() }}</p> }
    <div class="pf-sgroup__rows"><ng-content></ng-content></div>
  `,
  styles: [`
    :host { display: block; scroll-margin-top: 8px; }
    :host + :host:not(.pf-sgroup--plain) { margin-top: 10px; border-top: 1px solid var(--pf-line, var(--glass-border)); }
    :host(.pf-sgroup--plain) { border-bottom: 1px solid var(--pf-line, var(--glass-border)); }
    .pf-sgroup__head { display: flex; align-items: center; gap: 10px; min-height: 36px; padding-top: 14px; }
    .pf-sgroup__scope { font-weight: 500; letter-spacing: .04em; text-transform: none; color: var(--text-tertiary); opacity: .85; }
    .pf-sgroup__hint { margin: 0 0 2px; font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); }
    .pf-sgroup__label { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-sgroup__tools { margin-left: auto; display: inline-flex; gap: 8px; align-items: center; }
    .pf-sgroup__tools:empty { display: none; }
  `],
})
export class SettingGroupComponent {
  /** Empty = no heading (an anchor for `?tab=` only — the row label already names it). */
  readonly label = input<string>('');
  readonly id = input<string | null>(null);
  /** Where the group applies, once (e.g. "per branch", "all branches") — never a pill on every row. */
  readonly scope = input<string | null>(null);
  /** One line under the group label. */
  readonly hint = input<string | null>(null);
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
