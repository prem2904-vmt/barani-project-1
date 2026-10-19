import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type PfStatusChipTone = 'neutral' | 'violet' | 'urgent' | 'required';

/** Non-interactive status label; use buttons or segmented controls for actions. */
@Component({
  selector: 'pf-status-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span [class]="chipClasses()"><ng-content /></span>`,
  styles: [':host { display: inline-flex; }'],
})
export class PfStatusChipComponent {
  readonly tone = input<PfStatusChipTone>('neutral');

  protected chipClasses(): string {
    return `pf-chip pf-chip--static pf-chip--${this.tone()}`;
  }
}
