import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { ApiError } from '../../../../shared/models/api-response.model';
import { CatalogProposal, Test } from '../../../../shared/models/test.model';
import {
  proposalPath, proposalTest, proposalBranchLabel, proposalKindLabel, proposalDatesLine, proposalDiffRows,
} from '../../../../shared/utils/catalog-proposals';

/**
 * Test Master updates waiting for this lab (copy-on-write, phase 5).
 *
 * A master edit goes live instantly for every test the lab has NOT changed.
 * For a test the lab (or one of its branches) HAS its own copy of, the change
 * arrives here as a proposal — one per copy, so a branch's copy shows with
 * its branch. The lab accepts or dismisses each one, or all at once.
 *
 * A quiet strip above the Test Master grid; "Review" expands into the per-row
 * list — each request with its dates ("Master updated 24 Sep, after your change
 * on 20 Sep") and the side-by-side difference (Field · Yours · Master). Accept =
 * the copy takes the master's current version (it then reads the master again);
 * Dismiss = keep yours until the master changes again. Hidden when nothing waits.
 */
@Component({
  selector: 'pf-catalog-proposals-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (proposals().length > 0) {
      <section class="pf-cp" aria-label="Test Master updates">
        <div class="pf-cp__bar">
          <svg class="pf-cp__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>
          </svg>
          <span class="pf-cp__title">
            {{ proposals().length }} Test Master update{{ proposals().length === 1 ? '' : 's' }}
            for tests you changed
          </span>
          <span class="pf-cp__spacer"></span>
          <button type="button" class="pf-cp__btn" (click)="open.set(!open())" [attr.aria-expanded]="open()">
            {{ open() ? 'Hide' : 'Review' }}
          </button>
          <button type="button" class="pf-cp__btn" [disabled]="busy()" (click)="dismissAll()">Dismiss all</button>
          <button type="button" class="pf-cp__btn pf-cp__btn--primary" [disabled]="busy()" (click)="acceptAll()">Accept all</button>
        </div>
        @if (open()) {
          <ul class="pf-cp__list">
            @for (p of rows(); track p.id) {
              <li class="pf-cp__row">
                <div class="pf-cp__head">
                  <div class="pf-cp__what">
                    <span class="pf-cp__name">{{ p.name }}</span>
                    @if (p.code) { <span class="pf-cp__code">{{ p.code }}</span> }
                  </div>
                  <span class="pf-cp__tag">{{ p.kind }}</span>
                  <span class="pf-cp__tag pf-cp__tag--branch">{{ p.branch }}</span>
                  <span class="pf-cp__spacer"></span>
                  <button type="button" class="pf-cp__btn" [disabled]="busy()" (click)="dismiss(p.id)"
                          title="Keep your version. A later master change will ask again.">Dismiss</button>
                  <button type="button" class="pf-cp__btn pf-cp__btn--primary" [disabled]="busy()" (click)="accept(p.id)"
                          title="Take the master's current version of this test. Prices stay as they are.">Accept</button>
                </div>
                @if (p.dates) { <p class="pf-cp__dates">{{ p.dates }}</p> }
                @if (p.diff.length > 0) {
                  <div class="pf-cp__diffwrap">
                    <table class="pf-cp__diff">
                      <thead><tr><th scope="col">Field</th><th scope="col">Yours</th><th scope="col">Master</th></tr></thead>
                      <tbody>
                        @for (d of p.diff; track d.field) {
                          <tr>
                            <th scope="row">{{ d.label }}</th>
                            <td class="pf-cp__yours">{{ d.yours }}</td>
                            <td class="pf-cp__master">{{ d.master }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-cp { margin-bottom: 12px; border-radius: 12px; background: var(--bg-card, transparent);
      box-shadow: inset 0 0 0 1px rgba(139, 92, 246, 0.24); overflow: hidden; }
    .pf-cp__bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; flex-wrap: wrap; }
    .pf-cp__icon { color: var(--violet-text); flex: 0 0 auto; }
    .pf-cp__title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-cp__spacer { flex: 1 1 auto; }
    .pf-cp__btn { height: 30px; padding: 0 12px; border-radius: 8px; font-size: 12.5px; font-weight: 500;
      border: 1px solid rgba(148, 163, 184, 0.3); background: transparent; color: var(--text-secondary); cursor: pointer; }
    .pf-cp__btn:disabled { opacity: 0.5; cursor: default; }
    .pf-cp__btn--primary { border-color: transparent; background: rgba(139, 92, 246, 0.14); color: var(--violet-text); }
    .pf-cp__list { list-style: none; margin: 0; padding: 0 12px 10px; display: flex; flex-direction: column; gap: 6px; }
    .pf-cp__row { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 10px;
      background: rgba(148, 163, 184, 0.06); }
    .pf-cp__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-cp__dates { margin: 0; font-size: 12px; color: var(--text-secondary); }
    .pf-cp__diffwrap { overflow-x: auto; }
    .pf-cp__diff { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .pf-cp__diff th, .pf-cp__diff td { text-align: left; padding: 5px 8px; vertical-align: top;
      border-top: 1px solid rgba(148, 163, 184, 0.16); }
    .pf-cp__diff thead th { border-top: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
      text-transform: uppercase; color: var(--text-tertiary); }
    .pf-cp__diff tbody th { font-weight: 500; color: var(--text-secondary); white-space: nowrap; width: 1%; }
    .pf-cp__yours { color: var(--text-primary); }
    .pf-cp__master { color: var(--violet-text); font-weight: 500; }
    .pf-cp__what { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .pf-cp__name { font-size: 13px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-cp__code { font-size: 11.5px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-cp__tag { font-size: 11px; padding: 2px 7px; border-radius: 999px; color: var(--text-secondary);
      background: rgba(148, 163, 184, 0.12); white-space: nowrap; }
    .pf-cp__tag--branch { color: var(--sky-text); background: rgba(14, 165, 233, 0.10); }
    @media (max-width: 640px) { .pf-cp__head .pf-cp__spacer { display: none; } }
  `],
})
export class CatalogProposalsPanelComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);

  /** Pending proposals for this lab. */
  readonly proposals = input<CatalogProposal[]>([]);
  /** The loaded catalogue — names the test each proposal is about. */
  readonly tests = input<Test[]>([]);
  /** Something was accepted/dismissed: the host reloads tests + proposals. */
  readonly changed = output<void>();

  readonly open = signal(false);
  readonly busy = signal(false);

  private readonly branchNames = computed(() =>
    new Map((this.auth.user?.()?.branches ?? []).map(b => [b.id, b.name] as const)));

  readonly rows = computed(() => this.proposals().map(p => {
    const t = proposalTest(p, this.tests());
    return {
      id: p.id,
      name: t?.name ?? p.testName ?? p.catalogKey,
      code: t?.testCode ?? p.testCode ?? '',
      kind: proposalKindLabel(p),
      branch: proposalBranchLabel(p, this.branchNames()),
      dates: proposalDatesLine(p),
      diff: proposalDiffRows(p),
    };
  }));

  accept(id: string) { this.run(this.api.post(proposalPath(id, 'accept'), {}), 'Update accepted'); }
  dismiss(id: string) { this.run(this.api.post(proposalPath(id, 'dismiss'), {}), 'Update dismissed'); }

  async acceptAll() {
    const n = this.proposals().length;
    const ok = await this.dialog.confirm({
      title: `Accept all ${n} Test Master update${n === 1 ? '' : 's'}?`,
      message: 'Each of your changed tests takes the Admin Test Master\'s current version and follows the master again. Your own edits to those tests are replaced. Prices are not affected.',
      confirmLabel: 'Accept all',
      cancelLabel: 'Not now',
      tone: 'primary',
    });
    if (!ok) return;
    this.run(this.api.post(proposalPath(null, 'accept-all'), {}), 'All updates accepted');
  }

  async dismissAll() {
    const n = this.proposals().length;
    const ok = await this.dialog.confirm({
      title: `Dismiss all ${n} Test Master update${n === 1 ? '' : 's'}?`,
      message: 'Your changed tests stay exactly as they are. If the master changes them again you will be asked again; you can also revert any of them to the master later.',
      confirmLabel: 'Dismiss all',
      cancelLabel: 'Not now',
      tone: 'danger',
    });
    if (!ok) return;
    this.run(this.api.post(proposalPath(null, 'dismiss-all'), {}), 'All updates dismissed');
  }

  private run(call: Observable<unknown>, done: string) {
    if (this.busy()) return;
    this.busy.set(true);
    call.subscribe({
      next: () => { this.busy.set(false); this.toasts.success(done); this.changed.emit(); },
      error: e => { this.busy.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
