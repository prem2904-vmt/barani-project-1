import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconName, MEDICAL_ICONS, PfIconComponent } from '@prefrontal/forms-engine';

/**
 * The medical icon picker (legacy "Medical Icon: Browse"), as a grid of stroked SVG line icons. Picking the chosen one
 * again, or "No icon", clears it. The value is the icon's short name ("heart"), what a page or a choice stores.
 */
@Component({
  selector: 'st-icon-picker',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ip" role="group" [attr.aria-label]="label()">
      <button type="button" class="ip-b ip-none" data-icon="" [attr.aria-pressed]="!value()" (click)="valueChange.emit(null)">
        <span class="ip-lbl">No icon</span>
      </button>
      @for (i of icons; track i.value) {
        <button type="button" class="ip-b" [attr.data-icon]="i.value" [attr.aria-pressed]="value() === i.value" [attr.aria-label]="i.label" [attr.title]="i.label" (click)="valueChange.emit(value() === i.value ? null : i.value)">
          <pf-icon [name]="glyph(i.icon)" [size]="22" />
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .ip {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
        gap: 6px;
      }
      .ip-b {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 44px;
        border: 1px solid var(--pf-line);
        border-radius: 10px;
        background: var(--pf-card-bg);
        color: var(--text-secondary);
        font: inherit;
        cursor: pointer;
      }
      .ip-b:hover {
        border-color: var(--color-primary, #7c3aed);
        color: var(--violet-text, #6d28d9);
      }
      .ip-b[aria-pressed='true'] {
        border-color: var(--color-primary, #7c3aed);
        background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, var(--pf-card-bg));
        color: var(--violet-text, #6d28d9);
      }
      .ip-none {
        grid-column: span 2;
      }
      .ip-lbl {
        font-size: 12px;
      }
    `,
  ],
})
export class IconPickerComponent {
  readonly value = input<string | null | undefined>(null);
  readonly label = input('Choose an icon');
  readonly valueChange = output<string | null>();
  protected readonly icons = MEDICAL_ICONS;
  protected glyph(n: string): IconName {
    return n as IconName;
  }
}
