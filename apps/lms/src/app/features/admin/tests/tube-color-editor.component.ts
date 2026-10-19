import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ICellEditorAngularComp } from 'ag-grid-angular';
import { ICellEditorParams } from 'ag-grid-community';

export interface TubeChoice { key: string; label: string; hex: string; }

/**
 * Container picker for the Test Master grid.
 *
 * AG Grid's built-in `agSelectCellEditor` renders a native <select>, whose
 * options can't carry a colour swatch — so the dropdown would show bare names
 * while the cell beside it shows a coloured dot. This editor renders the same
 * swatch + label pairing as the cell, so the list reads exactly like the grid.
 */
@Component({
  selector: 'pf-tube-color-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-tce" role="listbox" aria-label="Container">
      @for (c of choices(); track c.key) {
        <button type="button" class="pf-tce__opt" role="option"
                [class.pf-tce__opt--on]="c.key === value()"
                [attr.aria-selected]="c.key === value()"
                (click)="pick(c.key)">
          <span class="pf-tce__dot" [style.background]="c.hex"></span>
          <span class="pf-tce__lbl">{{ c.label }}</span>
        </button>
      }
    </div>
  `,
  styles: [`
    /* Theme tokens (both themes), kit radius / line / shadow; the selected
       option is the neutral selected state. Tube caps are the functional colour. */
    .pf-tce {
      max-height: 260px; overflow-y: auto; min-width: 200px;
      padding: 4px; border-radius: var(--pf-radius-sm, 10px);
      background: var(--pf-card-bg, #fff);
      border: 1px solid var(--pf-line);
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18);
    }
    .pf-tce__opt {
      display: flex; align-items: center; gap: 9px; width: 100%; min-height: 36px;
      padding: 7px 9px; border: 0; border-radius: 8px;
      background: transparent; cursor: pointer; text-align: left; font: inherit;
    }
    .pf-tce__opt:hover { background: var(--pf-chip-bg); }
    .pf-tce__opt--on { background: var(--pf-sel-bg); box-shadow: inset 0 0 0 1px var(--pf-sel-border); }
    .pf-tce__dot {
      width: 11px; height: 11px; border-radius: 50%; flex: 0 0 auto;
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.2) inset;
    }
    .pf-tce__lbl { font-size: 13px; color: var(--text-primary); }
    @media (pointer: coarse) { .pf-tce__opt { min-height: 44px; } }
  `]
})
export class TubeColorEditorComponent implements ICellEditorAngularComp {
  protected readonly choices = signal<TubeChoice[]>([]);
  protected readonly value = signal<string>('');
  private params!: ICellEditorParams;

  agInit(params: ICellEditorParams & { choices?: TubeChoice[] }): void {
    this.params = params;
    this.choices.set(params.choices ?? []);
    this.value.set(String(params.value ?? ''));
  }

  /** AG Grid reads the committed value from here when editing stops. */
  getValue(): string { return this.value(); }

  /** Render as an overlay rather than inside the cell box, so the list isn't
   *  clipped by the row height. */
  isPopup(): boolean { return true; }

  protected pick(key: string): void {
    this.value.set(key);
    this.params.stopEditing();
  }
}
