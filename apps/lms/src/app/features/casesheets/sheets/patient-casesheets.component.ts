import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CaseSummary } from '../data/cases/case-models';
import { CasesApi } from '../data/cases/cases-api';
import { HttpCasesApi } from '../data/cases/http-cases-api';
import { CasesheetNav } from '../data/casesheet-nav';
import { whenText } from '../data/when';
import { CaseSheetLauncher } from '../shared/case-sheet-launcher';

/** How many of the patient's sheets the profile shows (the rest are one tap away: "All case sheets"). */
export const PROFILE_SHEETS = 5;

/**
 * The patient profile's "Case sheets" (plan §8 WP5): the patient's latest sheets, newest first, each one tap from its
 * page; "New case sheet" (casesheet_fill) and "All case sheets". Renders NOTHING unless the case-sheet gate is open and
 * the user has casesheet_view — the profile also defers loading it behind the same check, so a closed gate costs the
 * lab no request and no code.
 */
@Component({
  selector: 'pf-patient-casesheets',
  standalone: true,
  imports: [RouterLink],
  providers: [{ provide: CasesApi, useClass: HttpCasesApi }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (launcher.canView()) {
      <section class="pf-pcs" aria-labelledby="pf-pcs-h" data-casesheets>
        <header class="pf-pcs__head">
          <svg class="pf-pcs__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>
          </svg>
          <h3 class="pf-pcs__title" id="pf-pcs-h">Case sheets</h3>
          @if (items(); as xs) { <span class="pf-pcs__n pf-num">{{ total() }}</span> }
          <span class="pf-pcs__sp"></span>
          @if (launcher.canFill()) {
            <button type="button" class="pf-btn pf-btn--secondary pf-pcs__new" data-cs-new (click)="start()">New</button>
          }
        </header>
        @if (items() === null) {
          <p class="pf-pcs__note">Loading…</p>
        } @else if (failed()) {
          <p class="pf-pcs__note" role="status">Couldn't load the case sheets.
            <button type="button" class="pf-pcs__link" (click)="load(patientId())">Try again</button></p>
        } @else if (!items()!.length) {
          <p class="pf-pcs__note">No case sheets yet.</p>
        } @else {
          <ul class="pf-pcs__list" role="list">
            @for (c of items(); track c.id) {
              <li>
                <a class="pf-pcs__row" [routerLink]="nav.sheet(c.id)" [attr.data-cs]="c.id">
                  <span class="pf-pcs__form">{{ c.formTitle }}</span>
                  <span class="pf-pcs__meta">
                    <span class="pf-pcs__state" [attr.data-state]="c.state">{{ c.state === 'final' ? 'Finished' : 'Draft' }}</span>
                    {{ c.state === 'final' ? when(c.finalisedAt) : when(c.updatedAt) }}
                  </span>
                </a>
              </li>
            }
          </ul>
          @if (total() > items()!.length) {
            <a class="pf-pcs__link" [routerLink]="nav.list(patientId())" data-cs-all>All case sheets ({{ total() }})</a>
          } @else {
            <a class="pf-pcs__link" [routerLink]="nav.list(patientId())" data-cs-all>Open the list</a>
          }
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-pcs { display: flex; flex-direction: column; gap: 8px; padding: 12px 0 4px; border-top: 1px solid var(--pf-line, rgba(148,163,184,.35)); margin-top: 8px; }
    .pf-pcs__head { display: flex; align-items: center; gap: 8px; min-height: 36px; }
    .pf-pcs__icon { color: var(--text-tertiary); flex: none; }
    .pf-pcs__title { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-pcs__n { font-size: 12px; color: var(--text-tertiary); }
    .pf-pcs__sp { flex: 1 1 auto; }
    .pf-pcs__note { margin: 0; font-size: 13px; color: var(--text-tertiary); }
    .pf-pcs__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .pf-pcs__row { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 10px;
      border: 1px solid var(--pf-line, rgba(148,163,184,.35)); color: var(--text-primary); text-decoration: none; min-height: 44px; }
    .pf-pcs__row:hover { border-color: var(--glass-border-hover, rgba(124,58,237,.3)); }
    .pf-pcs__form { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
    .pf-pcs__meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-tertiary); }
    .pf-pcs__state { font-weight: 600; color: var(--text-secondary); }
    .pf-pcs__state[data-state='draft'] { color: var(--color-primary, #7c3aed); }
    .pf-pcs__link { align-self: flex-start; padding: 0; border: 0; background: none; font: inherit; font-size: 13px;
      font-weight: 600; color: var(--color-primary, #7c3aed); text-decoration: none; cursor: pointer; }
  `],
})
export class PatientCasesheetsComponent {
  readonly patientId = input.required<string>();
  protected readonly launcher = inject(CaseSheetLauncher);
  protected readonly nav = inject(CasesheetNav);
  private readonly api = inject(CasesApi);

  protected readonly items = signal<CaseSummary[] | null>(null);
  protected readonly total = signal(0);
  protected readonly failed = signal(false);
  protected readonly when = whenText;
  private readonly visible = computed(() => this.launcher.canView());

  constructor() {
    effect(() => {
      const id = this.patientId();
      if (!this.visible() || !id) return;
      untracked(() => void this.load(id));
    });
  }

  protected async load(id: string): Promise<void> {
    this.failed.set(false);
    this.items.set(null);
    try {
      const r = await this.api.listCases({ patientId: id, page: 1, pageSize: PROFILE_SHEETS });
      if (this.patientId() !== id) return;
      this.items.set(r.items);
      this.total.set(r.total);
    } catch {
      this.items.set([]);
      this.failed.set(true);
    }
  }

  protected start(): void {
    void this.launcher.open({ patientId: this.patientId(), context: { kind: 'patient' } });
  }
}
