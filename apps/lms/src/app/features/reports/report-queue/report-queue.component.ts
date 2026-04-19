import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { Report } from '../../../shared/models/report.model';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

type Filter = 'all' | 'pending' | 'delivered' | 'failed';

@Component({
  selector: 'pf-report-queue',
  standalone: true,
  imports: [
    DatePipe,
    ChipComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SkeletonComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto">
      <pf-screen-header
        eyebrow="Delivery queue"
        title="Report queue"
        subtitle="Validated orders ready to deliver to patients and referring doctors.">
        <pf-touch-btn actions size="sm" variant="secondary" (pressed)="refresh()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
          </span>
          Refresh
        </pf-touch-btn>
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="promptGenerate()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14"/>
              <path d="M5 12h14"/>
            </svg>
          </span>
          Generate
        </pf-touch-btn>
      </pf-screen-header>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <pf-tile tone="violet" padding="md">
          <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1" style="color: var(--text-secondary);">Total</p>
          <p class="text-[28px] font-semibold leading-none" style="color: var(--text-primary);">{{ items().length }}</p>
        </pf-tile>
        <pf-tile tone="amber" padding="md">
          <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1" style="color: var(--text-secondary);">Pending</p>
          <p class="text-[28px] font-semibold leading-none" style="color: var(--text-primary);">{{ counts().pending }}</p>
        </pf-tile>
        <pf-tile tone="emerald" padding="md">
          <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1" style="color: var(--text-secondary);">Delivered</p>
          <p class="text-[28px] font-semibold leading-none" style="color: var(--text-primary);">{{ counts().delivered }}</p>
        </pf-tile>
        <pf-tile tone="rose" padding="md">
          <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1" style="color: var(--text-secondary);">Failed</p>
          <p class="text-[28px] font-semibold leading-none" style="color: var(--text-primary);">{{ counts().failed }}</p>
        </pf-tile>
      </div>

      <div class="mb-5">
        <pf-segmented
          [options]="filterOptions"
          [value]="filter()"
          size="md"
          (valueChange)="setFilter($event)">
        </pf-segmented>
      </div>

      @if (loading() && items().length === 0) {
        <div class="space-y-2.5">
          @for (i of [0,1,2,3]; track i) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-center gap-3">
                <pf-skeleton variant="block" width="40px" height="40px"></pf-skeleton>
                <div class="flex-1 space-y-2">
                  <pf-skeleton variant="line" width="45%"></pf-skeleton>
                  <pf-skeleton variant="line" width="70%" height="10px"></pf-skeleton>
                </div>
                <pf-skeleton variant="line" width="180px" height="28px"></pf-skeleton>
              </div>
            </pf-tile>
          }
        </div>
      } @else if (visible().length === 0) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[14px]" style="color: var(--text-secondary);">
              Queue is empty.
            </p>
          </div>
        </pf-tile>
      } @else {
        <div class="space-y-2.5">
          @for (r of visible(); track r.id) {
            <pf-tile [tone]="rowTone(r.deliveryStatus)" padding="md">
              <div class="flex items-center gap-3 flex-wrap md:flex-nowrap">
                <div class="pf-report-icon" [class]="'pf-report-' + r.deliveryStatus">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <path d="M14 2v6h6"/>
                    <path d="M16 13H8"/>
                    <path d="M16 17H8"/>
                    <path d="M10 9H8"/>
                  </svg>
                </div>

                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <p class="font-semibold text-[15px]" style="color: var(--text-primary);">
                      Report #{{ r.id.slice(0, 8) }}
                    </p>
                    <pf-chip [tone]="chipTone(r.deliveryStatus)" size="sm">{{ r.deliveryStatus }}</pf-chip>
                  </div>
                  <p class="text-[12px] mt-0.5 truncate" style="color: var(--text-tertiary);">
                    Order {{ r.orderId.slice(0, 8) }}
                    · {{ r.type }}
                    · generated {{ r.createdAt | date:'short' }}
                  </p>
                </div>

                <div class="flex items-center gap-1.5 ml-auto">
                  <pf-touch-btn size="sm" variant="ghost" (pressed)="view(r)">View</pf-touch-btn>
                  <pf-touch-btn size="sm" variant="secondary" (pressed)="deliver(r, 'whatsapp')">WhatsApp</pf-touch-btn>
                  <pf-touch-btn size="sm" variant="secondary" (pressed)="deliver(r, 'print')">Print</pf-touch-btn>
                </div>
              </div>
            </pf-tile>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .pf-report-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .pf-report-delivered {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(16, 185, 129, 0.08));
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .pf-report-pending {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(245, 158, 11, 0.08));
      color: #fcd34d;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .pf-report-failed {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(239, 68, 68, 0.08));
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
  `]
})
export class ReportQueueComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogService);

  readonly filterOptions: SegmentedOption<Filter>[] = [
    { value: 'all',       label: 'All' },
    { value: 'pending',   label: 'Pending' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'failed',    label: 'Failed' }
  ];

  private readonly _filter = signal<Filter>('all');
  readonly filter = this._filter.asReadonly();
  setFilter(f: Filter) { this._filter.set(f); }

  private readonly _items = signal<Report[]>([]);
  readonly items = this._items.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  readonly counts = computed(() => {
    const l = this._items();
    return {
      pending:   l.filter(r => r.deliveryStatus === 'pending').length,
      delivered: l.filter(r => r.deliveryStatus === 'delivered').length,
      failed:    l.filter(r => r.deliveryStatus === 'failed').length
    };
  });

  readonly visible = computed(() => {
    const f = this._filter();
    const l = this._items();
    return f === 'all' ? l : l.filter(r => r.deliveryStatus === f);
  });

  rowTone(status: string): TileTone {
    if (status === 'failed') return 'rose';
    if (status === 'pending') return 'amber';
    if (status === 'delivered') return 'emerald';
    return 'default';
  }

  chipTone(status: string): ChipTone {
    if (status === 'failed') return 'rose';
    if (status === 'pending') return 'amber';
    if (status === 'delivered') return 'emerald';
    return 'default';
  }

  ngOnInit() { this.refresh(); }

  refresh() {
    this._loading.set(true);
    this.api.get<Report[]>('/api/reports/queue').subscribe({
      next: l => { this._items.set(l ?? []); this._loading.set(false); },
      error: () => this._loading.set(false)
    });
  }

  view(r: Report) { this.router.navigate(['/reports/view', r.id]); }

  deliver(r: Report, via: string) {
    this.api.post(`/api/reports/${r.id}/deliver`, { via, note: null }).subscribe({
      next: () => { this.toasts.success(`Delivered via ${via}`); this.refresh(); }
    });
  }

  async promptGenerate() {
    const oid = await this.dialog.prompt({
      title: 'Generate report',
      message: 'Enter the order ID to generate a final report.',
      placeholder: 'order id',
      required: true,
      confirmLabel: 'Generate'
    });
    if (!oid) return;
    this.api.post<Report>('/api/reports/generate', { orderId: oid, type: 'final' }).subscribe({
      next: r => { this.toasts.success('Report generated'); this.router.navigate(['/reports/view', r.id]); },
      error: e => this.toasts.error(e.message ?? 'Generation failed')
    });
  }
}
