import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { DelegateModalComponent } from './delegate-modal.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { OrderTest } from '../../../shared/models/order.model';

type Tab = 'my_work' | 'service_queue' | 'rejected';
type Level = 'urgent' | 'high' | 'normal';
type Bucket = { level: Level; items: Enriched[] };
type Enriched = OrderTest & { _level: Level; _remainingMin: number };

interface CounterSpec {
  id: 'pending' | 'critical' | 'in_progress' | 'done' | 'all';
  label: string;
  tone: 'amber' | 'rose' | 'violet' | 'emerald' | 'default';
}

const COUNTERS: CounterSpec[] = [
  { id: 'pending',     label: 'Pending',     tone: 'amber' },
  { id: 'critical',    label: 'Critical',    tone: 'rose' },
  { id: 'in_progress', label: 'In progress', tone: 'violet' },
  { id: 'done',        label: 'Done today',  tone: 'emerald' },
  { id: 'all',         label: 'All',         tone: 'default' }
];

@Component({
  selector: 'pf-my-work',
  standalone: true,
  imports: [
    DatePipe, BarcodeScannerModalComponent, DelegateModalComponent, TatIndicatorComponent,
    AvatarComponent, ScreenHeaderComponent, SegmentedComponent, SkeletonComponent, TileComponent, TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-5 md:px-8 lg:px-10 pt-5 pb-10">

      <pf-screen-header eyebrow="Lab workbench"
                        subtitle="Scan a barcode to jump straight to result entry, or pick from the queue below.">
        Lab <span class="text-gradient">my work</span>
        <div actions>
          <pf-touch-btn variant="secondary" size="md" (pressed)="refresh()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" icon-left>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
            Refresh
          </pf-touch-btn>
        </div>
      </pf-screen-header>

      <!-- Big scan bar -->
      <div class="pf-scan-row">
        <div class="pf-scan">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="pf-scan__icon" aria-hidden="true">
            <path d="M3 5v14M6 5v14M9 5v14M12 5v14M15 5v14M18 5v14M21 5v14"/>
          </svg>
          <input type="text"
                 [value]="scan()"
                 (input)="setScan(asInput($event))"
                 (keydown.enter)="scanSubmit()"
                 placeholder="Scan barcode or type PF-XXXX-XXXXX…"
                 class="pf-scan__input"/>
          <!-- Opens the camera viewfinder. Whatever it decodes is dropped
               into the scan input and submitted — hits the same
               claim-by-scan gate as keyboard/HID entry. -->
          <button type="button"
                  class="pf-scan__camera press"
                  (click)="openBarSearchScanner()"
                  aria-label="Scan with camera">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="7" width="18" height="13" rx="2"/>
              <path d="M8 7 10 4h4l2 3"/>
              <circle cx="12" cy="13" r="3.5"/>
            </svg>
          </button>
          <span class="pf-scan__live">
            <span class="pf-scan__dot"></span>
            SCANNER · READY
          </span>
        </div>
        <pf-touch-btn variant="primary" size="lg" (pressed)="scanSubmit()" [disabled]="!scan()">
          Open
          <span icon-right>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14m-5-6 6 6-6 6"/>
            </svg>
          </span>
        </pf-touch-btn>
      </div>

      <!-- Counter tiles -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        @for (c of counters; track c.id) {
          <button type="button"
                  class="pf-counter"
                  [class.pf-counter--on]="counter() === c.id"
                  [attr.data-tone]="c.tone"
                  (click)="setCounter(c.id)">
            <span class="pf-counter__label">{{ c.label }}</span>
            <span class="pf-counter__value">{{ counterValue(c.id) }}</span>
          </button>
        }
      </div>

      <!-- Secondary filter: my work / service queue / rejected -->
      <div class="flex items-center justify-between mb-5 flex-wrap gap-3">
        <pf-segmented [options]="tabOptions" [value]="tab()" (valueChange)="setTab($event)"/>
        <p class="text-[11px] font-mono uppercase tracking-[0.14em]"
           style="color: var(--text-muted);">
          {{ rows().length }} items · {{ countFor('my_work') }} mine · {{ countFor('service_queue') }} pool · {{ countFor('rejected') }} rejected
        </p>
      </div>

      @if (loading() && rows().length === 0) {
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          @for (i of [0,1,2,3]; track i) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-start gap-3">
                <pf-skeleton variant="circle" width="40px" height="40px"></pf-skeleton>
                <div class="flex-1 space-y-2">
                  <pf-skeleton variant="line" width="60%"></pf-skeleton>
                  <pf-skeleton variant="line" width="85%" height="10px"></pf-skeleton>
                </div>
              </div>
              <div class="mt-4 flex justify-end">
                <pf-skeleton variant="line" width="96px" height="28px"></pf-skeleton>
              </div>
            </pf-tile>
          }
        </div>
      }

      @for (bucket of buckets(); track bucket.level) {
        @if (bucket.items.length > 0) {
          <div class="mb-6">
            <div class="flex items-center gap-3 mb-3 px-1">
              <span class="pf-dot" [attr.data-level]="bucket.level"></span>
              <h3 class="text-[11px] font-mono uppercase tracking-[0.18em]"
                  style="color: var(--text-secondary);">
                {{ bucket.level }} · {{ bucket.items.length }}
              </h3>
            </div>

            <ul class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
              @for (t of bucket.items; track t.id) {
                <li>
                  <pf-tile [tone]="toneFor(bucket.level)" padding="md">
                    <div class="flex items-start gap-3">
                      <pf-avatar [name]="t.subOrder?.order?.patient?.name ?? 'Patient'" [size]="40"></pf-avatar>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <p class="text-[15px] font-semibold truncate"
                             style="color: var(--text-primary);">{{ t.test?.name ?? 'Test' }}</p>
                          <pf-tat-indicator [tatLevel]="t._level" [remainingMinutes]="t._remainingMin"/>
                        </div>
                        <p class="text-[12px] font-mono mt-0.5"
                           style="color: var(--text-tertiary);">
                          {{ t.subOrder?.order?.patient?.name ?? '—' }}
                          · {{ t.test?.department?.name ?? '—' }}
                          · rec'd {{ t.subOrder?.receivedAtLab ? (t.subOrder?.receivedAtLab | date:'shortTime') : '—' }}
                        </p>
                      </div>
                    </div>
                    <div class="mt-4 flex justify-end">
                      @switch (tab()) {
                        @case ('service_queue') {
                          <!-- Pool rows: click opens the scanner. Modal won't
                               accept the scan unless the decoded code matches
                               this row's barcode. Backend also re-verifies the
                               user is the assignee — so wrong-row clicks
                               still get rejected. -->
                          <button type="button" class="pf-scan-hint pf-scan-hint--btn press"
                                  (click)="startPick(t)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                              <rect x="3" y="5" width="18" height="14" rx="2"/>
                              <path d="M7 9v6M11 9v6M15 9v6"/>
                            </svg>
                            Scan vial to pick
                          </button>
                          <button type="button" class="pf-delegate-btn press" (click)="openDelegate(t)">
                            Delegate…
                          </button>
                        }
                        @case ('rejected') {
                          <pf-touch-btn variant="primary" size="sm" (pressed)="startPick(t)">Re-enter</pf-touch-btn>
                        }
                        @default {
                          @if (t.status === 'pending') {
                            <pf-touch-btn variant="secondary" size="sm" (pressed)="startPick(t)">Pick up · scan</pf-touch-btn>
                          } @else {
                            <pf-touch-btn variant="primary" size="sm" (pressed)="startPick(t)">Enter result</pf-touch-btn>
                          }
                        }
                      }
                    </div>
                  </pf-tile>
                </li>
              }
            </ul>
          </div>
        }
      }

      @if (!loading() && rows().length === 0) {
        <pf-tile tone="default" padding="xl">
          <p class="text-center text-sm" style="color: var(--text-tertiary);">Nothing in the queue.</p>
        </pf-tile>
      }
    </section>

    @if (scanTarget(); as t) {
      <pf-barcode-scanner-modal
        title="Scan vial to claim"
        [expectedBarcode]="scanExpected()"
        (matched)="onScanMatched($event)"
        (cancelled)="cancelScan()">
      </pf-barcode-scanner-modal>
    }

    @if (barScannerOpen()) {
      <!-- Search-bar camera mode: no expected code, any scan drops into
           the input and routes through the same claim-by-scan gate. -->
      <pf-barcode-scanner-modal
        title="Scan any vial barcode"
        (matched)="onBarSearchMatched($event)"
        (cancelled)="closeBarSearchScanner()">
      </pf-barcode-scanner-modal>
    }

    @if (delegateTarget(); as t) {
      <pf-delegate-modal
        [testName]="t.test?.name ?? 'Test'"
        (chose)="onDelegate($event)"
        (cancelled)="cancelDelegate()">
      </pf-delegate-modal>
    }
  `,
  styles: [`
    /* Delegate link on pool rows — supervisor action. */
    .pf-delegate-btn {
      margin-left: 8px;
      padding: 5px 10px;
      border-radius: 9999px;
      background: transparent;
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
    }
    .pf-delegate-btn:hover {
      background: var(--glass-bg-hover);
      color: var(--text-primary);
    }

    /* Scan-to-pick chip on pool rows. Opens the scanner modal; modal
     * still requires the decoded code to equal the row's barcode, so a
     * click here can't claim a wrong vial. */
    .pf-scan-hint {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 9999px;
      background: rgba(236, 72, 153, 0.08);
      border: 1px dashed rgba(236, 72, 153, 0.35);
      color: #f472b6;
      font-size: 11.5px;
      font-weight: 500;
    }
    .pf-scan-hint--btn {
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, transform 0.08s ease;
    }
    .pf-scan-hint--btn:hover {
      background: rgba(236, 72, 153, 0.16);
      border-color: rgba(236, 72, 153, 0.55);
    }
    .pf-scan-hint--btn:active { transform: scale(0.98); }

    /* Scan bar */
    .pf-scan-row {
      display: flex;
      align-items: stretch;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .pf-scan {
      position: relative;
      flex: 1;
      min-width: 280px;
    }
    .pf-scan__icon {
      position: absolute;
      left: 20px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-violet-400, #a78bfa);
    }
    .pf-scan__input {
      width: 100%;
      height: 64px;
      padding: 0 180px 0 58px;
      border-radius: 20px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 16px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      outline: none;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.2s;
    }
    .pf-scan__input::placeholder { color: var(--text-muted); }
    .pf-scan__input:focus {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.2);
    }
    /* Camera button inside the scan bar — sits next to the live-status
     * chip. Tap opens the scanner modal in no-expected-code mode. */
    .pf-scan__camera {
      position: absolute;
      right: 140px;
      top: 50%;
      transform: translateY(-50%);
      width: 34px;
      height: 34px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 80ms ease;
    }
    .pf-scan__camera:hover {
      background: var(--glass-bg-hover);
      color: #c4b5fd;
      border-color: rgba(168, 85, 247, 0.55);
    }
    .pf-scan__camera:active { transform: translateY(-50%) scale(0.95); }
    @media (max-width: 640px) {
      .pf-scan__camera { right: 14px; }
      .pf-scan__live { display: none; }
    }

    .pf-scan__live {
      position: absolute;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.12em;
      color: var(--text-muted);
      pointer-events: none;
    }
    .pf-scan__dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: #34d399;
      animation: pf-scan-pulse 1.6s ease-in-out infinite;
    }
    @keyframes pf-scan-pulse {
      0%, 100% { opacity: 0.5; transform: scale(1); }
      50%      { opacity: 1;   transform: scale(1.3); box-shadow: 0 0 10px rgba(52, 211, 153, 0.9); }
    }

    /* Counter tiles */
    .pf-counter {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 14px 16px;
      border-radius: 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      text-align: left;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.08s, box-shadow 0.25s;
    }
    .pf-counter:hover { background: var(--glass-bg-hover); }
    .pf-counter:active { transform: scale(0.98); }
    .pf-counter[data-tone='amber']   { background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.25); }
    .pf-counter[data-tone='rose']    { background: rgba(239, 68, 68, 0.1);  border-color: rgba(239, 68, 68, 0.25); }
    .pf-counter[data-tone='violet']  { background: rgba(124, 58, 237, 0.1); border-color: rgba(168, 85, 247, 0.28); }
    .pf-counter[data-tone='emerald'] { background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.25); }
    .pf-counter[data-tone='default'] { background: var(--glass-bg); border-color: var(--glass-border); }

    .pf-counter__label {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--text-muted);
    }
    .pf-counter__value {
      font-size: 30px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.01em;
      margin-top: 2px;
    }
    .pf-counter--on {
      background: #ffffff !important;
      border-color: #ffffff !important;
      color: #0f172a !important;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
    }
    .pf-counter--on .pf-counter__label { color: rgba(15, 23, 42, 0.6); }

    /* Urgency dot (kept from prior) */
    .pf-dot {
      width: 10px;
      height: 10px;
      border-radius: 9999px;
      flex-shrink: 0;
    }
    .pf-dot[data-level='urgent'] { background: #ef4444; box-shadow: 0 0 12px rgba(239, 68, 68, 0.7); }
    .pf-dot[data-level='high']   { background: #f59e0b; box-shadow: 0 0 10px rgba(245, 158, 11, 0.65); }
    .pf-dot[data-level='normal'] { background: #10b981; box-shadow: 0 0 8px rgba(16, 185, 129, 0.55); }
  `]
})
export class MyWorkComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  readonly tabOptions = [
    { value: 'my_work'       as Tab, label: 'My Work' },
    { value: 'service_queue' as Tab, label: 'Service Queue' },
    { value: 'rejected'      as Tab, label: 'Rejected' }
  ];
  readonly counters = COUNTERS;

  private readonly _tab = signal<Tab>('my_work');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) { this._tab.set(t); this.refresh(); }

  private readonly _counter = signal<CounterSpec['id']>('all');
  readonly counter = this._counter.asReadonly();
  setCounter(c: CounterSpec['id']) { this._counter.set(c); }

  private readonly _scan = signal<string>('');
  readonly scan = this._scan.asReadonly();
  setScan(v: string) { this._scan.set(v); }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  private readonly _rows = signal<OrderTest[]>([]);
  readonly rows = this._rows.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  private readonly _counts = signal<Record<Tab, number>>({ my_work: 0, service_queue: 0, rejected: 0 });
  countFor(t: Tab): number { return this._counts()[t]; }

  readonly buckets = computed<Bucket[]>(() => {
    const enriched: Enriched[] = this.enrich(this._rows());
    const filtered = this.filterByCounter(enriched);
    return [
      { level: 'urgent' as const, items: filtered.filter(e => e._level === 'urgent') },
      { level: 'high'   as const, items: filtered.filter(e => e._level === 'high') },
      { level: 'normal' as const, items: filtered.filter(e => e._level === 'normal') }
    ];
  });

  private enrich(rows: OrderTest[]): Enriched[] {
    return rows.map(t => {
      const ral = t.subOrder?.receivedAtLab;
      const budget = (t.test?.tatHours ?? 0) * 60;
      const elapsed = ral ? (Date.now() - new Date(ral).getTime()) / 60000 : 0;
      const remaining = budget - elapsed;
      const level: Level = remaining <= 0 ? 'urgent' : remaining <= 60 ? 'high' : 'normal';
      return { ...t, _level: level, _remainingMin: remaining };
    });
  }

  /** Counter-tile filter runs on top of the segmented tab filter. */
  private filterByCounter(list: Enriched[]): Enriched[] {
    switch (this._counter()) {
      case 'pending':     return list.filter(t => t.status === 'pending' || t.status === 're_entry');
      case 'critical':    return list.filter(t => this.isCritical(t));
      case 'in_progress': return list.filter(t => t.status === 'in_progress' || t.status === 'entered');
      case 'done':        return list.filter(t => t.status === 'validated' || t.status === 'signed_off');
      default:            return list;
    }
  }

  counterValue(id: CounterSpec['id']): number {
    const enriched = this.enrich(this._rows());
    switch (id) {
      case 'pending':     return enriched.filter(t => t.status === 'pending' || t.status === 're_entry').length;
      case 'critical':    return enriched.filter(t => this.isCritical(t)).length;
      case 'in_progress': return enriched.filter(t => t.status === 'in_progress' || t.status === 'entered').length;
      case 'done':        return enriched.filter(t => t.status === 'validated' || t.status === 'signed_off').length;
      default:            return enriched.length;
    }
  }

  private isCritical(t: OrderTest): boolean {
    if (!t.currentResult) return false;
    try {
      const snap = JSON.parse(t.currentResult) as { flags?: { critical?: boolean } };
      return snap.flags?.critical === true;
    } catch { return false; }
  }

  toneFor(level: Level): TileTone {
    return level === 'urgent' ? 'rose' : level === 'high' ? 'amber' : 'default';
  }

  ngOnInit() { this.refresh(); this.refreshAllCounts(); }

  refresh() {
    const url = this.endpointFor(this._tab());
    this._loading.set(true);
    this.api.get<OrderTest[]>(url).subscribe({
      next: l => { this._rows.set((l ?? []).filter(t => this.matchesTab(t, this._tab()))); this._loading.set(false); },
      error: () => this._loading.set(false)
    });
  }

  private refreshAllCounts() {
    for (const t of ['my_work', 'service_queue', 'rejected'] as Tab[]) {
      this.api.get<OrderTest[]>(this.endpointFor(t)).subscribe({
        next: l => {
          const count = (l ?? []).filter(x => this.matchesTab(x, t)).length;
          this._counts.update(c => ({ ...c, [t]: count }));
        }
      });
    }
  }

  private endpointFor(t: Tab): string {
    if (t === 'service_queue') return '/api/results/service-queue';
    return '/api/results/my-work';
  }
  private matchesTab(t: OrderTest, tab: Tab): boolean {
    if (tab === 'rejected') return t.status === 're_entry';
    if (tab === 'my_work')  return t.status !== 're_entry';
    return true;
  }

  /** Try to resolve a scanned barcode/OrderTest id → jump to result entry. */
  scanSubmit() {
    const q = this._scan().trim();
    if (!q) return;
    // Look for a row whose barcode/id matches the scan. We route through
    // /claim-by-scan so the backend enforces (a) this user is the
    // assignee and (b) the scanned code actually matches the sample —
    // the scan bar is just a faster path to the same gate the modal uses.
    const hit = this._rows().find(r =>
      r.subOrder?.barcode === q ||
      r.id === q ||
      r.subOrder?.id === q
    );
    if (!hit) {
      this.toasts.warning('No match for scan');
      return;
    }
    const scannedBarcode = hit.subOrder?.barcode ?? q;
    this.api.post<OrderTest>(`/api/results/${hit.id}/claim-by-scan`, { barcode: scannedBarcode }).subscribe({
      next: () => { this._scan.set(''); this.enterJustScanned(hit); },
      error: e => this.toasts.error(e.message ?? 'Scan rejected')
    });
  }

  // ── Scan-gated pickup ─────────────────────────────────
  // Clicking the queue action opens the scanner modal with the row's
  // expected barcode. The modal only emits (matched) when the scanned
  // code equals the expected one. Backend /claim-by-scan then verifies
  // the user is actually the assignee (auto-assigned or delegated) —
  // which prevents cross-tech scanning.
  private readonly _scanTarget = signal<OrderTest | null>(null);
  readonly scanTarget = this._scanTarget.asReadonly();
  readonly scanExpected = computed(() => this._scanTarget()?.subOrder?.barcode ?? '');

  startPick(t: OrderTest) {
    if (!t.subOrder?.barcode) {
      this.toasts.warning('This sample has no barcode — ask supervisor to reprint.');
      return;
    }
    this._scanTarget.set(t);
  }

  cancelScan() { this._scanTarget.set(null); }

  // Top-bar camera mode: no expected code, relays decoded value into the
  // scan input and submits via scanSubmit → same claim-by-scan gate.
  private readonly _barScannerOpen = signal(false);
  readonly barScannerOpen = this._barScannerOpen.asReadonly();
  openBarSearchScanner() { this._barScannerOpen.set(true); }
  closeBarSearchScanner() { this._barScannerOpen.set(false); }
  onBarSearchMatched(code: string) {
    this._barScannerOpen.set(false);
    this._scan.set(code);
    this.scanSubmit();
  }

  onScanMatched(code: string) {
    const t = this._scanTarget();
    if (!t) return;
    this.api.post<OrderTest>(`/api/results/${t.id}/claim-by-scan`, { barcode: code }).subscribe({
      next: () => {
        this._scanTarget.set(null);
        this.enterJustScanned(t);
      },
      error: e => this.toasts.error(e.message ?? 'Scan rejected')
    });
  }

  enter(t: OrderTest) { this.router.navigate(['/lab/result', t.id]); }

  // Navigation variant that tells result-entry "don't prompt the re-scan
  // modal this time — the user literally just scanned two seconds ago".
  private enterJustScanned(t: OrderTest) {
    this.router.navigate(['/lab/result', t.id], { state: { justScanned: true } });
  }

  // ── Supervisor delegation ─────────────────────────────
  // Thin wrapper over POST /api/results/:id/delegate. The UI gate (who
  // sees the button) is visual-only for now; the backend endpoint is
  // open. Add role-based gating once permission infra lands.
  private readonly _delegateTarget = signal<OrderTest | null>(null);
  readonly delegateTarget = this._delegateTarget.asReadonly();

  openDelegate(t: OrderTest) { this._delegateTarget.set(t); }
  cancelDelegate() { this._delegateTarget.set(null); }

  onDelegate(toUserId: string) {
    const t = this._delegateTarget();
    if (!t) return;
    this.api.post(`/api/results/${t.id}/delegate`, { toUserId }).subscribe({
      next: () => {
        this._delegateTarget.set(null);
        this.toasts.success('Delegated — the new assignee must scan to pick up.');
        this.refresh();
      },
      error: e => this.toasts.error(e.message ?? 'Delegate failed')
    });
  }
}
