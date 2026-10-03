import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { OrderTest } from '../models/order.model';
import { lineStatusLabel } from '../utils/line-status';

/**
 * Self-contained result-entry queue — the portable panel for `result_entry`.
 * Lets a single-person clinic do result entry right on the Frontdesk screen when
 * the admin drops Result Entry into the Frontdesk work-area. Fetches its own
 * queue and opens the same sample/result entry screens the Lab workbench uses.
 */
@Component({
  selector: 'pf-result-entry-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rp">
      @if (loading()) {
        <p class="rp__msg">Loading queue…</p>
      } @else if (rows().length === 0) {
        <p class="rp__msg">Nothing awaiting results.</p>
      } @else {
        <ul class="rp__list">
          @for (t of rows(); track t.id) {
            <li class="rp__row press" (click)="enter(t)">
              <span class="rp__test">{{ t.name }}</span>
              <span class="rp__pt">{{ t.subOrder?.order?.patient?.displayName ?? 'Patient' }}</span>
              <span class="rp__status" [attr.data-s]="t.status">{{ statusLabel(t.status) }}</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .rp { padding: 8px; }
    .rp__msg { font-size: 12.5px; color: var(--text-tertiary); text-align: center; padding: 18px 8px; }
    .rp__list { display: flex; flex-direction: column; gap: 6px; }
    .rp__row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px;
               padding: 9px 11px; border-radius: 9px; background: var(--bg-card-solid, rgba(255,255,255,0.04));
               border: 1px solid var(--glass-border); cursor: pointer; }
    .rp__row:hover { border-color: #7c3aed; }
    .rp__test { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rp__pt { font-size: 11.5px; color: var(--text-tertiary); }
    .rp__status { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
                  padding: 2px 7px; border-radius: 999px; color: var(--text-secondary); background: rgba(255,255,255,0.06); }
    .rp__status[data-s='in_progress'] { color: var(--violet-text); background: rgba(124,58,237,0.18); }
    .rp__status[data-s='entered'] { color: var(--green-text); background: rgba(16,185,129,0.15); }
    .rp__status[data-s='re_entry'] { color: var(--red-text); background: rgba(239,68,68,0.14); }
  `]
})
export class ResultEntryPanelComponent implements OnInit {
  readonly statusLabel = lineStatusLabel;
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly rows = signal<OrderTest[]>([]);
  readonly loading = signal(true);

  ngOnInit() {
    this.api.get<OrderTest[]>('/api/results/my-work').subscribe({
      next: l => { this.rows.set(l ?? []); this.loading.set(false); },
      error: () => { this.rows.set([]); this.loading.set(false); },
    });
  }

  enter(t: OrderTest) {
    const sid = t.subOrder?.id;
    if (sid) this.router.navigate(['/lab/sample', sid]);
    else this.router.navigate(['/lab/result', t.id]);
  }
}
