import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LabSortService } from '../../../core/services/lab-sort.service';
import { SelectComponent, PfSelectOption } from '../../primitives/select.component';
import { LAB_SORT_OPTIONS, LabSortKey, LabSortScope } from '../../utils/lab-sort';

/** The small "Sort" picker the lab lists share (OPS-52). Plain pf-select; the
 *  choice is remembered per user by LabSortService. */
@Component({
  selector: 'pf-lab-sort',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-select class="pf-lab-sort" size="sm" [options]="options()" [value]="value()"
               (valueChange)="pick($event)" aria-label="Sort this list" placeholder="Sort"></pf-select>
  `,
  styles: [`:host { display: inline-block; min-width: 150px; }`],
})
export class LabSortComponent {
  private readonly sorts = inject(LabSortService);
  readonly scope = input.required<LabSortScope>();
  protected readonly options = computed<PfSelectOption<LabSortKey>[]>(() =>
    LAB_SORT_OPTIONS[this.scope()].map(o => ({ value: o.value, label: o.label })));
  protected readonly value = computed(() => this.sorts.keyFor(this.scope()));
  protected pick(v: unknown): void { this.sorts.set(this.scope(), v as LabSortKey); }
}
