import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';

/**
 * Phones only (≤640px): a calm line that Studio is built for a computer.
 * Everything still works; nothing is blocked (owner, 2026-11-02: Studio is
 * desktop-first; only the case-sheet filling is for phones and tablets).
 */
@Component({
  selector: 'st-phone-note',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="pn" role="note" data-phone-note>
      <pf-icon name="monitor" [size]="18" />
      <span>Studio works best on a computer. Everything works here too; building a form is just easier on a bigger screen.</span>
    </p>
  `,
  styles: [
    `
      :host {
        display: none;
      }
      @media (max-width: 640px) {
        :host {
          display: block;
        }
      }
      .pn {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin: 0;
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--pf-chip-bg);
        color: var(--text-secondary);
        font-size: 14px;
        line-height: 1.4;
      }
      .pn pf-icon {
        flex: none;
        margin-top: 1px;
        color: var(--violet-text, #6d28d9);
      }
    `,
  ],
})
export class PhoneNoteComponent {}
