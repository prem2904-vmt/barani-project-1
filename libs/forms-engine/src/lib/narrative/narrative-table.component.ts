import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NarrativeTable } from './narrative-table';

/**
 * A grid's table in the live narrative (case sheet, Studio preview): the same table the PDF prints — merged heading
 * band, column headings, merged row labels, merged cells — in the narrative's type. Wraps, never scrolls sideways.
 */
@Component({
  selector: 'fe-narrative-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fe-ntable', '[attr.data-table]': 'table().fieldKey' },
  template: `
    @if (showLabel()) {
      <p class="fe-ntable__label">{{ table().label }}</p>
    }
    <table class="fe-ntable__t" [attr.aria-label]="table().label">
      <thead>
        @if (table().headerGroups; as band) {
          <tr>
            @if (hasLabels()) {
              <th class="fe-ntable__corner" scope="col"></th>
            }
            @for (g of band; track $index) {
              <th scope="colgroup" [attr.colspan]="g.span" class="fe-ntable__band">{{ g.label }}</th>
            }
          </tr>
        }
        <tr>
          @if (hasLabels()) {
            <th scope="col" class="fe-ntable__corner">{{ table().rowHeader }}</th>
          }
          @for (c of table().columns; track $index) {
            <th scope="col">{{ c }}</th>
          }
        </tr>
      </thead>
      <tbody>
        @for (r of table().rows; track $index) {
          <tr>
            @if (hasLabels() && r.label !== null) {
              <th scope="row" [attr.rowspan]="r.labelSpan > 1 ? r.labelSpan : null" class="fe-ntable__row">{{ r.label }}</th>
            }
            @for (c of r.cells; track $index) {
              <td [attr.colspan]="c.colSpan > 1 ? c.colSpan : null" [class.fe-ntable__empty]="c.text === '-'">{{ c.text }}</td>
            }
          </tr>
        }
      </tbody>
    </table>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .fe-ntable__label {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
      }
      .fe-ntable__t {
        width: 100%;
        border-collapse: collapse;
        table-layout: auto;
        font-size: 13px;
        line-height: 1.35;
        color: var(--text-primary);
      }
      th,
      td {
        border: 1px solid var(--pf-line);
        padding: 5px 4px;
        text-align: center;
        vertical-align: middle;
        /* whole words ("anywhere" split "Caries" into "Carie s"); a word longer than its column still wraps */
        overflow-wrap: break-word;
        word-break: normal;
        hyphens: auto;
        white-space: pre-line;
      }
      thead th,
      .fe-ntable__row {
        background: var(--pf-chip-bg);
        color: var(--text-secondary);
        font-weight: 600;
      }
      .fe-ntable__corner,
      .fe-ntable__row {
        text-align: left;
      }
      .fe-ntable__band {
        color: var(--text-primary);
      }
      .fe-ntable__empty {
        color: var(--text-tertiary);
      }
    `,
  ],
})
export class NarrativeTableComponent {
  readonly table = input.required<NarrativeTable>();
  /** The grid's name above its table, unless it is the section's title (the printout's rule). */
  readonly sectionTitle = input<string | null>(null);
  protected readonly showLabel = computed(() => {
    const l = this.table().label.trim();
    return !!l && l.toLowerCase() !== (this.sectionTitle() ?? '').trim().toLowerCase();
  });
  protected readonly hasLabels = computed(() => !!this.table().rowHeader.trim() || this.table().rows.some((r) => !!r.label?.trim()));
}
