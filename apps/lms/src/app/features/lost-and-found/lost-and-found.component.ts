import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { OrderSample } from '../../shared/models/order.model';
import { ApiError } from '../../shared/models/api-response.model';
import { patientDisplayName } from '../../shared/models/patient.model';
import { AvatarComponent } from '../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../shared/primitives/touch-button.component';
import { SkeletonRowsComponent } from '../../shared/primitives/skeleton-kit.component';

/** GET /api/lost-and-found — one disabled workflow stage + its orphaned tubes. */
interface StrandedStage {
  key: string;
  label: string;
  samples: OrderSample[];
}

/**
 * Lost & Found — triage for records stranded when an admin disables a workflow
 * stage mid-flight. A tube waiting at a now-removed stage has no screen to show
 * it; here an operator can send it straight to the lab, mark it failed (reject),
 * or cancel the whole order. Access is granted by placing the `lost_and_found`
 * action in a work-area assigned to the roles that should triage.
 */
@Component({
  selector: 'pf-lost-and-found',
  standalone: true,
  imports: [SkeletonRowsComponent, DatePipe, AvatarComponent, ScreenHeaderComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">
      <div class="pf-page__top px-4 md:px-8 lg:px-10 pt-6">
        <pf-screen-header
          eyebrow="Recovery"
          title="Lost &amp; Found"
          subtitle="Records stranded when a workflow stage was switched off. Move them into the lab, mark failed, or cancel the order.">
          <pf-touch-btn actions size="sm" variant="ghost" [disabled]="loading()" [busy]="loading()" busyLabel="Refreshing…" (pressed)="load()">
            <span icon-left aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v6h-6"/>
              </svg>
            </span>
            Refresh
          </pf-touch-btn>
        </pf-screen-header>
      </div>

      <div class="pf-page__body px-4 md:px-8 lg:px-10 pb-10">
        @if (loading()) {
          <div class="flex justify-center py-10">
            <pf-skeleton-rows [rows]="5" label="Finding stranded records…"></pf-skeleton-rows>
          </div>
        } @else if (totalCount() === 0) {
          <div class="pf-empty">
            <svg class="pf-empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>
            </svg>
            <p class="pf-empty__title">Nothing lost</p>
            <p class="pf-empty__hint">Every record is on an active workflow stage. If you switch a stage off, any tubes stuck there will show up here to move on.</p>
          </div>
        } @else {
          @for (stage of stages(); track stage.key) {
            <h3 class="pf-section">{{ stage.label }} · {{ stage.samples.length }}</h3>
            <ul class="pf-list">
              @for (s of stage.samples; track s.id) {
                <li class="pf-lf">
                  <div class="pf-lf__main">
                    <pf-avatar [name]="patientName(s)" [size]="42"></pf-avatar>
                    <div class="min-w-0 flex-1">
                      <p class="pf-lf__name">{{ patientName(s) }}</p>
                      <p class="pf-lf__meta">#{{ s.orderId.slice(0, 8) }} · {{ deptName(s) }} · {{ testsLabel(s) }}</p>
                      <p class="pf-lf__code">{{ s.barcode ?? '—' }} · created {{ s.createdAt | date:'d MMM, shortTime' }}</p>
                    </div>
                    <span class="pf-lf__badge">{{ statusLabel(s.status) }}</span>
                  </div>
                  <div class="pf-lf__actions">
                    @if (canSendToLab()) {
                      <pf-touch-btn size="sm" variant="primary" [disabled]="isBusy(s.id)" [busy]="busyAs(s.id, 'send')" busyLabel="Sending…" (pressed)="sendToLab(s)">Send to lab →</pf-touch-btn>
                    }
                    @if (canReject()) {
                      <pf-touch-btn size="sm" variant="ghost" [disabled]="isBusy(s.id)" [busy]="busyAs(s.id, 'fail')" busyLabel="Updating…" (pressed)="markFailed(s)">Mark failed</pf-touch-btn>
                    }
                    @if (canCancel()) {
                      <pf-touch-btn size="sm" variant="ghost" [disabled]="isBusy(s.id)" [busy]="busyAs(s.id, 'cancel')" busyLabel="Cancelling…" (pressed)="cancelOrder(s)">Cancel order</pf-touch-btn>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .pf-page { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
    .pf-page__top { flex: 0 0 auto; }
    .pf-page__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-top: 8px; }

    .pf-section {
      margin: 16px 0 8px;
      font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted);
    }
    .pf-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }

    .pf-lf {
      display: flex; flex-direction: column; gap: 12px;
      padding: 14px 16px;
      background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 14px;
    }
    .pf-lf__main { display: flex; align-items: center; gap: 12px; }
    .pf-lf__main > pf-avatar, .pf-lf__badge { flex-shrink: 0; }
    .pf-lf__name {
      margin: 0; font-weight: 600; font-size: 14.5px; color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-lf__meta {
      margin: 2px 0 0; font-size: 11.5px; color: var(--text-tertiary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-lf__code {
      margin: 2px 0 0; font-size: 10.5px; color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.03em;
    }
    .pf-lf__badge {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px; font-weight: 700; color: var(--amber-text);
      padding: 5px 10px; border-radius: 999px;
      background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.28);
      white-space: nowrap;
    }
    .pf-lf__actions { display: flex; flex-wrap: wrap; gap: 8px; }
    /* Tablet+: pull the action buttons onto the same row as the info. */
    @media (min-width: 640px) {
      .pf-lf { flex-direction: row; align-items: center; }
      .pf-lf__main { flex: 1 1 auto; min-width: 0; }
      .pf-lf__actions { flex: 0 0 auto; }
    }

    .pf-empty {
      display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px;
      padding: 48px 20px; color: var(--text-tertiary);
    }
    .pf-empty__icon { width: 46px; height: 46px; color: var(--text-muted); opacity: 0.85; }
    .pf-empty__title { margin: 4px 0 0; font-size: 15px; font-weight: 600; color: var(--text-secondary); }
    .pf-empty__hint { margin: 0; font-size: 12.5px; max-width: 360px; line-height: 1.5; }
  `]
})
export class LostAndFoundComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);

  protected readonly loading = signal(true);
  private readonly _stages = signal<StrandedStage[]>([]);
  readonly stages = this._stages.asReadonly();
  readonly totalCount = computed(() => this._stages().reduce((n, g) => n + g.samples.length, 0));

  // Action permissions — mirror the endpoints' RequirePermission (OR manage_users).
  readonly canSendToLab = computed(() => this.auth.hasPermission('receive_sample') || this.auth.hasPermission('manage_users'));
  readonly canReject    = computed(() => this.auth.hasPermission('reject_sample')  || this.auth.hasPermission('manage_users'));
  readonly canCancel    = computed(() => this.auth.hasPermission('cancel_order')   || this.auth.hasPermission('manage_users'));

  private readonly _busy = signal<Set<string>>(new Set());
  isBusy(id: string): boolean { return this._busy().has(id); }
  /** Which action a busy row is running (that button shows the dots). */
  private readonly _busyKind = signal<ReadonlyMap<string, string>>(new Map());
  busyAs(id: string, kind: string): boolean { return this._busyKind().get(id) === kind; }
  private setBusy(id: string, on: boolean, kind?: string) {
    this._busy.update(s => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });
    this._busyKind.update(m => { const n = new Map(m); if (on && kind) n.set(id, kind); else n.delete(id); return n; });
  }

  constructor() { this.load(); }

  load() {
    this.loading.set(true);
    this.api.get<StrandedStage[]>('/api/lost-and-found').subscribe({
      next: res => { this._stages.set(res ?? []); this.loading.set(false); },
      error: () => { this._stages.set([]); this.loading.set(false); this.toasts.error('Could not load Lost & Found'); }
    });
  }

  patientName(s: OrderSample): string { return patientDisplayName(s.order?.patient); }
  deptName(s: OrderSample): string { return s.department?.name ?? 'Sample'; }
  testsLabel(s: OrderSample): string {
    const n = s.tests?.length ?? 0;
    if (n === 0) return 'No tests';
    const first = s.tests[0].test?.name ?? 'Test';
    return n === 1 ? first : `${first} +${n - 1}`;
  }
  statusLabel(status: string): string {
    switch (status) {
      case 'pending': return 'Uncollected';
      case 'collected': return 'Collected';
      case 'dispatched': return 'Dispatched';
      case 'in_transit': return 'In transit';
      default: return status;
    }
  }

  /** Move a stranded tube straight into the lab (status → received). */
  sendToLab(s: OrderSample) {
    this.setBusy(s.id, true, 'send');
    this.api.patch(`/api/lost-and-found/samples/${s.id}/send-to-lab`).subscribe({
      next: () => { this.setBusy(s.id, false); this.removeSample(s.id); this.toasts.success('Sent to the lab'); },
      error: e => { this.setBusy(s.id, false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  /** Reject the tube with a reason (reuses the standard sample-reject endpoint). */
  async markFailed(s: OrderSample) {
    const reason = await this.dialog.prompt({
      title: `Mark ${this.patientName(s)}'s tube failed?`,
      message: 'Rejects this tube with a reason. It leaves the queue and is recorded in the audit trail.',
      placeholder: 'Reason (e.g. sample lost, spoilt, wrong tube)…',
      multiline: true, required: true, tone: 'danger', confirmLabel: 'Mark failed'
    });
    if (!reason) return;
    this.setBusy(s.id, true, 'fail');
    this.api.patch(`/api/samples/${s.id}/reject`, { reason }).subscribe({
      next: () => { this.setBusy(s.id, false); this.removeSample(s.id); this.toasts.success('Marked failed'); },
      error: e => { this.setBusy(s.id, false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  /** Cancel the whole order (all its tubes). Reuses the order-cancel endpoint,
   *  which refunds any paid amount per the billing settings. */
  async cancelOrder(s: OrderSample) {
    const reason = await this.dialog.prompt({
      title: `Cancel order #${s.orderId.slice(0, 8)}?`,
      message: 'Cancels the whole order and every tube on it. Any amount already paid is refunded per your billing settings.',
      placeholder: 'Reason (optional)…',
      multiline: true, required: false, tone: 'danger', confirmLabel: 'Cancel order'
    });
    if (reason === null) return;   // dialog dismissed
    this.setBusy(s.id, true, 'cancel');
    this.api.patch(`/api/orders/${s.orderId}/cancel`, { reason: reason || undefined }).subscribe({
      next: () => { this.setBusy(s.id, false); this.removeOrder(s.orderId); this.toasts.success('Order cancelled'); },
      error: e => { this.setBusy(s.id, false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  private removeSample(id: string) {
    this._stages.update(stages => stages
      .map(g => ({ ...g, samples: g.samples.filter(x => x.id !== id) }))
      .filter(g => g.samples.length > 0));
  }
  private removeOrder(orderId: string) {
    this._stages.update(stages => stages
      .map(g => ({ ...g, samples: g.samples.filter(x => x.orderId !== orderId) }))
      .filter(g => g.samples.length > 0));
  }
}
