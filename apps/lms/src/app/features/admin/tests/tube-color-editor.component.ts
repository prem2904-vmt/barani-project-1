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
    .pf-tce {
      max-height: 260px; overflow-y: auto; min-width: 190px;
      padding: 4px; border-radius: 10px;
      background: var(--bg-elevated, #0f172a);
      border: 1px solid var(--glass-border, rgba(148,163,184,0.28));
      box-shadow: 0 14px 36px rgba(0,0,0,0.45);
    }
    .pf-tce__opt {
      display: flex; align-items: center; gap: 9px; width: 100%;
      padding: 7px 9px; border: 0; border-radius: 7px;
      background: transparent; cursor: pointer; text-align: left;
    }
    .pf-tce__opt:hover { background: rgba(255,255,255,0.07); }
    .pf-tce__opt--on { background: rgba(139, 92, 246, 0.18); }
    .pf-tce__dot {
      width: 11px; height: 11px; border-radius: 50%; flex: 0 0 auto;
      border: 1px solid rgba(255,255,255,0.28);
    }
    .pf-tce__lbl { font-size: 13px; color: var(--text-primary, #e2e8f0); }
    :host-context([data-theme="light"]) .pf-tce {
      background: #fff; border-color: rgba(15,23,42,0.12);
      box-shadow: 0 14px 36px rgba(15,23,42,0.16);
    }
    :host-context([data-theme="light"]) .pf-tce__opt:hover { background: rgba(15,23,42,0.05); }
    :host-context([data-theme="light"]) .pf-tce__lbl { color: #0f172a; }
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
