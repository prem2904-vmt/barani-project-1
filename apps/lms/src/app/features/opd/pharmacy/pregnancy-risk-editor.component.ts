import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ICellEditorAngularComp } from 'ag-grid-angular';
import type { ICellEditorParams } from 'ag-grid-community';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import type { PregnancyRisk } from './pharmacy.api';

const OPTIONS: PfSelectOption<string>[] = [
  { value: '', label: 'Not assessed' },
  { value: 'safe', label: 'Safe' },
  { value: 'caution', label: 'Caution' },
  { value: 'avoid', label: 'Avoid' },
  { value: 'contraindicated', label: 'Contraindicated' },
];

/**
 * Drug-master "Pregnancy" cell editor (night/safety, critic P0 #1a) — a
 * `pf-select` popup, never the native `<select>` the grid's other dropdown
 * columns use (ND rule §10: no native controls). Follows the same
 * ICellEditorAngularComp contract as the Test Master's tube-color editor.
 */
@Component({
  selector: 'pf-pregnancy-risk-editor',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-pre">
      <pf-select [options]="options" [value]="value()" placeholder="Pregnancy risk" size="sm" (valueChange)="pick($event)"></pf-select>
    </div>
  `,
  styles: [`
    .pf-pre { min-width: 190px; padding: 3px; background: var(--pf-card-bg, #fff); border-radius: var(--pf-radius-sm, 10px); box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18); }
  `],
})
export class PregnancyRiskEditorComponent implements ICellEditorAngularComp {
  protected readonly options = OPTIONS;
  protected readonly value = signal('');
  private params!: ICellEditorParams;

  agInit(params: ICellEditorParams): void {
    this.params = params;
    this.value.set(String(params.value ?? ''));
  }

  /** AG Grid reads the committed value from here when editing stops. '' =
   *  "Not assessed" — sent to the server as-is (the clearing convention the
   *  drug master already uses for siteKind etc). */
  getValue(): PregnancyRisk | '' { return this.value() as PregnancyRisk | ''; }

  /** Render as an overlay so pf-select's own dropdown isn't clipped by the row. */
  isPopup(): boolean { return true; }

  protected pick(v: string): void {
    this.value.set(v);
    this.params.stopEditing();
  }
}
