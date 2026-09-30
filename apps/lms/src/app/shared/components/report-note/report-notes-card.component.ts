import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ReportNoteScope, ReportNotesStore } from './report-notes.store';
import { ReportNoteSlotComponent } from './report-note-slot.component';

interface Row { scope: ReportNoteScope; id: string | null; title: string; hint: string }

/**
 * "Report notes" card: the note slots of the lines on a screen, one row each
 * with where it prints — the lines themselves (optional), their profile
 * blocks, their department sections, and the whole report. Hidden when the
 * switch is off and no note exists. Uses the screen's {@link ReportNotesStore}.
 */
@Component({
  selector: 'pf-report-notes-card',
  standalone: true,
  imports: [ReportNoteSlotComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length > 0) {
      <section class="nd-card pf-rnc" aria-label="Report notes">
        <header class="nd-card__head">
          <span class="nd-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>
          </span>
          <h2 class="nd-card__label pf-rnc__label">Report notes</h2>
          <span class="nd-card__note pf-rnc__note">
            {{ store.enabled() ? 'Printed on the report where each belongs.' : 'Technician notes are off in Lab settings — saved notes still print.' }}
          </span>
        </header>
        <div class="nd-card__body pf-rnc__body">
          @for (r of rows(); track r.scope + ':' + r.id) {
            <div class="pf-rnc__row" [attr.data-rnc]="r.scope + ':' + (r.id ?? '')">
              <div class="pf-rnc__head">
                <span class="pf-rnc__title">{{ r.title }}</span>
                <span class="pf-rnc__hint">{{ r.hint }}</span>
              </div>
              <pf-report-note-slot [scope]="r.scope" [key]="r.id" [label]="r.title" [showAdd]="true"></pf-report-note-slot>
            </div>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-rnc__label { margin: 0; font-size: 13px; line-height: 1.3; }
    .pf-rnc__body { gap: 12px; overflow: visible; }
    .pf-rnc__row { display: flex; flex-direction: column; gap: 6px; padding-bottom: 12px; border-bottom: 1px solid var(--nd-line, var(--border-muted)); }
    .pf-rnc__row:last-child { padding-bottom: 0; border-bottom: 0; }
    .pf-rnc__head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .pf-rnc__title { font-size: 14px; font-weight: 500; color: var(--text-primary); }
    .pf-rnc__hint { font-size: 12px; color: var(--text-tertiary); }
    /* Beats the global phone h2 cap (ND §12 type scale). */
    @media (max-width: 640px) { .pf-rnc__label { font-size: 12px !important; line-height: 1.3 !important; letter-spacing: 0.06em; } }
  `],
})
export class ReportNotesCardComponent {
  protected readonly store = inject(ReportNotesStore);
  /** The ordered lines this screen shows (order-test ids). */
  readonly lineIds = input<readonly string[]>([]);
  /** Also list each line's own note (screens without per-row buttons). */
  readonly showLines = input<boolean>(false);
  /** Also list the lines' profile notes. */
  readonly showProfiles = input<boolean>(false);

  readonly rows = computed<Row[]>(() => {
    const v = this.store.view();
    if (!v) return [];
    const ids = this.lineIds();
    const out: Row[] = [];
    if (this.showLines()) {
      for (const id of ids) {
        const l = this.store.line(id);
        if (l) out.push({ scope: 'test', id: l.id, title: l.name, hint: 'Prints under this test' });
      }
    }
    if (this.showProfiles()) {
      for (const p of this.store.profilesOf(ids)) out.push({ scope: 'profile', id: p.id, title: p.name, hint: 'Prints under the profile' });
    }
    for (const d of this.store.departmentsOf(ids)) out.push({ scope: 'department', id: d.id, title: d.name, hint: 'Prints at the end of the section' });
    out.push({ scope: 'order', id: null, title: 'Whole report', hint: 'Prints at the end of the report' });
    return out.filter(r => this.store.shows(r.scope, r.id));
  });
}
