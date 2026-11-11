import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Answers, FieldDef, FieldHostComponent, FormDefinition, isShown } from '@prefrontal/forms-engine';

/** Which keys a change list touches, per side: what was added / changed shows on the suggested side, removed on the current one. */
export function changedKeys(changes: { type: string; fieldKey: string | null }[], side: 'before' | 'after'): Set<string> {
  const out = new Set<string>();
  for (const c of changes) {
    if (!c.fieldKey) continue;
    const removed = /remov/.test(c.type);
    const added = /add/.test(c.type);
    if (side === 'before' ? !added : !removed) out.add(c.fieldKey);
  }
  return out;
}

/**
 * One side of the before / after: the case sheet drawn by the REAL forms engine (`fe-field`, the controls doctors fill), every
 * page one under the other. Both sides share ONE set of scratch answers (the parent's), so tapping an option on either side
 * opens its follow-ups on both. Nothing is saved. Questions the change list touches are marked.
 */
@Component({
  selector: 'st-sheet-render',
  standalone: true,
  imports: [FieldHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of pages(); track p.key) {
      <section class="sr-page" [attr.data-page]="p.key" [attr.aria-label]="p.title">
        <h4 class="sr-page__t">{{ p.title }}</h4>
        <div class="fe-grid sr-fields">
          @for (f of shownFields(p.fields); track f.key) {
            <div class="sr-f" [attr.data-changed]="marked().has(f.key) ? side() : null">
              <fe-field [field]="f" [scope]="answers()" [lookup]="lookup()" [setValue]="setValue()" />
            </div>
          } @empty {
            <p class="sr-empty">No questions on this page.</p>
          }
        </div>
      </section>
    } @empty {
      <p class="sr-empty">This case sheet has no pages yet.</p>
    }
  `,
  styles: [`
    :host { display: grid; gap: 14px; align-content: start; min-width: 0; }
    .sr-page { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--pf-line); border-radius: 14px; background: var(--pf-card-bg); min-width: 0; }
    .sr-page__t { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .sr-fields { min-width: 0; }
    .sr-f { position: relative; min-width: 0; grid-column: 1 / -1; }
    .sr-f[data-changed] { border-radius: 10px; padding: 4px 6px 4px 10px; background: var(--pf-done-tint, rgba(124, 58, 237, .07)); }
    .sr-f[data-changed]::before { content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px; border-radius: 3px; background: var(--color-primary, #7c3aed); }
    .sr-f[data-changed='before']::before { background: var(--text-tertiary); }
    .sr-empty { margin: 0; font-size: 13px; color: var(--text-tertiary); }
  `],
})
export class SheetRenderComponent {
  readonly definition = input.required<FormDefinition>();
  readonly answers = input.required<Answers>();
  readonly setValue = input.required<(key: string, value: unknown) => void>();
  readonly side = input<'before' | 'after'>('after');
  /** Field keys to mark as changed on this side. */
  readonly marked = input<ReadonlySet<string>>(new Set());

  protected readonly pages = computed(() => this.definition()?.pages ?? []);
  protected readonly lookup = computed(() => {
    const a = this.answers();
    return (k: string) => a[k];
  });
  protected shownFields(fields: FieldDef[] | undefined): FieldDef[] {
    const get = this.lookup();
    return (fields ?? []).filter((f) => isShown(f.showWhen, get));
  }
}
