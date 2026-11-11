import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { StudioApi } from '../data/studio-api';
import { DepartmentRow, plainError } from '../data/studio-models';

/**
 * "Add a department" in one line: a name and an Add button (Enter works too). It creates a department of the lab's own
 * through the Studio API and hands the new row back, so a picker can select it straight away. Shown wherever a
 * department is needed but none exists yet (the paper-sheet dialog, MyPrefrontal's new form).
 */
@Component({
  selector: 'st-dept-add',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="da">
      <input class="pf-input da__in" type="text" data-dept-name [attr.aria-label]="label()" [placeholder]="placeholder()" maxlength="80"
        [value]="name()" (input)="name.set($any($event.target).value)" (keydown.enter)="$event.preventDefault(); add()" />
      <button type="button" class="pf-btn pf-btn--secondary da__btn" data-act="add-dept" [disabled]="busy() || !name().trim()" [attr.aria-busy]="busy() ? 'true' : null" (click)="add()">
        <pf-icon name="plus" [size]="18" /> {{ busy() ? 'Adding…' : 'Add' }}
      </button>
    </div>
    @if (error()) { <p class="da__err" role="alert" data-dept-error>{{ error() }}</p> }
  `,
  styles: [`
    :host { display: block; width: 100%; }
    .da { display: flex; gap: 8px; align-items: center; }
    .da__in { flex: 1 1 auto; min-width: 0; }
    .da__btn { flex: none; }
    .da__err { margin: 6px 0 0; font-size: 13px; color: var(--danger, #d64545); }
    @media (max-width: 640px) { .da__in { font-size: 16px; } }
  `],
})
export class DepartmentAddComponent {
  private readonly api = inject(StudioApi);
  readonly placeholder = input('Department name, for example Cardiology');
  readonly label = input('New department name');
  readonly added = output<DepartmentRow>();

  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async add(): Promise<void> {
    const name = this.name().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const row = await this.api.createDepartment({ name });
      this.name.set('');
      this.added.emit(row);
    } catch (e) {
      this.error.set(plainError(e, "Couldn't add the department just now. Please try again."));
    } finally {
      this.busy.set(false);
    }
  }
}
