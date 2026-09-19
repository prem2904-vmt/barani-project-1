import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ICellEditorAngularComp } from 'ag-grid-angular';
import { ICellEditorParams } from 'ag-grid-community';

export interface RangeSelectOption { value: string; label: string }

/**
 * Styled popup editor for the reference-range grid's dropdown cells
 * (Who / Age group / Age in). One click on the cell opens this panel in
 * place; one click on an option picks it and closes — no native select,
 * no double-click dance.
 */
@Component({
  selector: 'pf-range-select-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-rsed" role="listbox">
      @for (o of options; track o.value) {
        <button type="button" class="pf-rsed__opt" role="option"
                [class.pf-rsed__opt--on]="o.value === value"
                [attr.aria-selected]="o.value === value"
                (click)="pick(o.value)">
          @if (o.value === value) {
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
          } @else { <span class="pf-rsed__spacer"></span> }
          {{ o.label }}
        </button>
      }
    </div>
  `,
  styles: [`
    .pf-rsed { min-width: 176px; max-height: 300px; overflow-y: auto; padding: 6px;
      border-radius: 12px; border: 1px solid var(--glass-border, rgba(148,163,184,.25));
      background: var(--bg-card-solid, #14161e); box-shadow: 0 12px 32px rgba(0,0,0,.45);
      display: flex; flex-direction: column; gap: 1px; }
    .pf-rsed__opt { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
      border: none; border-radius: 8px; background: transparent; cursor: pointer;
      font-size: 13px; font-weight: 600; color: var(--text-primary, #e2e8f0); text-align: left; }
    .pf-rsed__opt:hover { background: rgba(124,58,237,.14); }
    .pf-rsed__opt--on { color: var(--violet-text, #a78bfa); }
    .pf-rsed__spacer { width: 12px; flex-shrink: 0; }
  `],
})
export class RangeSelectEditorComponent implements ICellEditorAngularComp {
  options: RangeSelectOption[] = [];
  value = '';
  private params!: ICellEditorParams;

  agInit(params: ICellEditorParams & { options?: RangeSelectOption[] }): void {
    this.params = params;
    this.options = params.options ?? [];
    this.value = String(params.value ?? '');
  }
  getValue(): string { return this.value; }
  isPopup(): boolean { return true; }
  pick(v: string): void { this.value = v; this.params.stopEditing(); }
}
