import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

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
    /* Owner 2026-11-17 (final): the label on the LEFT (never narrower than ~300px), the value / control flush RIGHT; when
       the controls do not fit beside the label they wrap onto a second line, still right-aligned. */
    :host {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 24px;
      min-height: 56px; padding: 10px 0; border-bottom: 1px solid var(--pf-line, var(--glass-border));
    }
    :host(:last-child) { border-bottom: 0; }
    :host(.pf-srow--stack) { flex-direction: column; align-items: stretch; }
    .pf-srow__text { display: flex; flex-direction: column; gap: 2px; flex: 1 1 300px; min-width: min(300px, 100%); }
    .pf-srow__label { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; font-weight: 500; color: var(--text-primary); line-height: 1.35; }
    .pf-srow__hint { font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); }
    :host(.pf-srow--off) .pf-srow__label, :host(.pf-srow--off) .pf-srow__hint { opacity: .6; }
    .pf-srow__ctl { display: flex; align-items: center; justify-content: flex-end; gap: 8px 10px; flex-wrap: wrap; flex: 0 1 auto; margin-left: auto; min-width: 0; max-width: 100%; }
    :host(.pf-srow--stack) .pf-srow__ctl { justify-content: flex-start; margin-left: 0; }
    :host(.pf-srow--stack) .pf-srow__text { flex: none; }   /* the 300px basis is a width beside the control, never a height */
    @media (max-width: 767px) { .pf-srow__ctl { margin-left: 0; justify-content: flex-start; } }
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
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pf-sgroup',
    '[class.pf-sgroup--plain]': '!label()',
    '[class.pf-sgroup--wide]': 'wide()',
    '[attr.data-group]': 'id()',
  },
  template: `
    <ng-template #rows><ng-content></ng-content></ng-template>
    @if (label()) {
      <section class="pf-sgroup__sec" [attr.aria-label]="label()">
        <header class="pf-sgroup__head">
          <h3 class="pf-sgroup__label">{{ label() }}</h3>
          @if (scope()) { <span class="pf-sgroup__scope">{{ scope() }}</span> }
          <span class="pf-sgroup__tools"><ng-content select="[group-tools]"></ng-content></span>
        </header>
        @if (hint()) { <p class="pf-sgroup__hint">{{ hint() }}</p> }
        <div class="pf-sgroup__rows"><ng-container *ngTemplateOutlet="rows"></ng-container></div>
      </section>
    } @else {
      <ng-container *ngTemplateOutlet="rows"></ng-container>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; scroll-margin-top: 8px; }
    :host(.pf-sgroup--plain) { display: contents; }
    :host + :host:not(.pf-sgroup--plain) .pf-sgroup__sec { margin-top: 14px; padding-top: 4px; border-top: 1px solid var(--pf-line, var(--glass-border)); }
    .pf-sgroup__head { display: flex; align-items: center; gap: 10px; min-height: 36px; padding-top: 8px; }
    .pf-sgroup__label { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-sgroup__scope { font-size: 12px; color: var(--text-tertiary); opacity: .85; }
    .pf-sgroup__tools { margin-left: auto; display: inline-flex; gap: 8px; align-items: center; flex: none; }
    .pf-sgroup__tools:empty { display: none; }
    .pf-sgroup__hint { margin: 2px 0 2px; font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); }
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
