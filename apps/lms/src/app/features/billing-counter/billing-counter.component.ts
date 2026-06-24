import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { Order } from '../../shared/models/order.model';
import { Patient, patientDisplayName } from '../../shared/models/patient.model';
import { AvatarComponent } from '../../shared/primitives/avatar.component';
import { ChipComponent } from '../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { TileComponent } from '../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../shared/primitives/touch-button.component';
import { KpiStripComponent } from '../../shared/components/kpi-strip/kpi-strip.component';
import { LoadingLogoComponent } from '../../shared/components/loading-logo/loading-logo.component';

/**
 * Billing counter — for branches in `billing_mode = separate_counter`.
 * Workflow: search patient by name/phone/order id → see their unbilled orders →
 * tap one to open the standard /frontdesk/billing screen with that order id.
 *
 * The actual billing UI is reused from /frontdesk/billing rather than duplicated.
 */
@Component({
  selector: 'pf-billing-counter',
  standalone: true,
  imports: [
    FormsModule, DatePipe,
    AvatarComponent, ChipComponent,
    ScreenHeaderComponent, TileComponent, TouchButtonComponent, KpiStripComponent,
    LoadingLogoComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">
      <!-- Fixed (non-scrolling) top zone: KPIs, header, lookup + search. -->
      <div class="pf-page__top px-4 md:px-8 lg:px-10 pt-6">
        <pf-kpi-strip screen="billing_counter"></pf-kpi-strip>
        <pf-screen-header
          eyebrow="Billing · Counter"
          title="Billing counter"
          subtitle="Search by name, phone, or order ID. Pick an unbilled order to process payment.">
        </pf-screen-header>

        <!-- Scan the invoice QR or enter the invoice number / order id directly. -->
        <pf-tile tone="default" padding="lg" class="block mb-3">
          <label class="pf-label">Scan QR or enter invoice / order ID</label>
          <div class="pf-lookup">
            <input class="pf-input pf-lookup__input" type="search"
                   placeholder="Invoice number or order ID"
                   [ngModel]="lookupCode()" (ngModelChange)="lookupCode.set($event)"
                   (keydown.enter)="resolveLookup()" />
            <pf-touch-btn size="sm" variant="primary" [disabled]="resolving()" (pressed)="resolveLookup()">
              {{ resolving() ? 'Finding…' : 'Open' }}
            </pf-touch-btn>
            <pf-touch-btn size="sm" variant="ghost" (pressed)="startScan()">
              <span icon-left aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>
                </svg>
              </span>
              Scan QR
            </pf-touch-btn>
          </div>
        </pf-tile>

        <pf-tile tone="default" padding="lg" class="block">
          <label class="pf-label">Search patient</label>
          <input class="pf-input" type="search"
                 placeholder="Name · MRN · phone · order ID"
                 [ngModel]="query()" (ngModelChange)="onSearch($event)" />
        </pf-tile>
      </div>

      <!-- Scrollable content zone: results + selected patient orders. -->
      <div class="pf-page__body px-4 md:px-8 lg:px-10 pb-10">

      @if (scanning()) {
        <div class="pf-scan" role="dialog" aria-modal="true" aria-label="Scan invoice QR">
          <div class="pf-scan__bd" (click)="stopScan()"></div>
          <div class="pf-scan__panel">
            <video #scanVideo class="pf-scan__video" muted playsinline></video>
            <p class="pf-scan__hint">Point the camera at the invoice QR code</p>
            <pf-touch-btn size="sm" variant="ghost" (pressed)="stopScan()">Cancel</pf-touch-btn>
          </div>
        </div>
      }

      @if (results().length === 0) {
        @if (query().trim().length > 0 && !searching()) {
          <pf-tile tone="default" padding="xl">
            <p class="text-center text-[13px]" style="color: var(--text-tertiary);">
              No matching patient. Check the spelling, phone, or order ID.
            </p>
          </pf-tile>
        }
      } @else {
        <h3 class="pf-section">Patients</h3>
        <ul class="pf-list">
          @for (p of results(); track p.id) {
            <li>
              <button type="button" class="pf-row" (click)="selectPatient(p)">
                <pf-avatar [name]="display(p)" [size]="44"></pf-avatar>
                <div class="min-w-0 flex-1">
                  <p class="pf-row__name">{{ display(p) }}</p>
                  <p class="pf-row__meta">
                    {{ p.sex || '—' }}
                    @if (p.age != null) { · {{ p.age }}y }
                    @if (p.phone) { · {{ p.phone }} }
                  </p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </button>
            </li>
          }
        </ul>
      }

      @if (selectedPatient(); as p) {
        <h3 class="pf-section mt-6">{{ display(p) }} · unbilled orders</h3>
        @if (loadingOrders()) {
          <pf-tile tone="default" padding="lg" class="block">
            <div class="flex justify-center py-6">
              <pf-loading-logo size="lg" color="purple"
                               [showText]="true" text="Loading orders…"></pf-loading-logo>
            </div>
          </pf-tile>
        } @else if (unbilledOrders().length === 0) {
          <pf-tile tone="default" padding="lg" class="block">
            <p class="text-[13px]" style="color: var(--text-tertiary);">
              All orders for this patient are billed already.
            </p>
          </pf-tile>
        } @else {
          <ul class="pf-list">
            @for (o of unbilledOrders(); track o.id) {
              <li>
                <button type="button" class="pf-row" (click)="bill(o)">
                  <div class="pf-row__id">#{{ o.id.slice(0, 8) }}</div>
                  <div class="min-w-0 flex-1">
                    <p class="pf-row__name">
                      {{ totalTests(o) }} test<span [class.hidden]="totalTests(o) === 1">s</span>
                      <pf-chip [tone]="priorityTone(o)" size="sm" class="ml-2">{{ o.priority }}</pf-chip>
                    </p>
                    <p class="pf-row__meta">
                      Created {{ o.createdAt | date:'shortTime' }} · {{ o.collectionType }}
                    </p>
                  </div>
                  <pf-touch-btn size="sm" variant="primary">Process payment →</pf-touch-btn>
                </button>
              </li>
            }
          </ul>
        }
      }
      </div>
    </section>
  `,
  styles: [`
    /* ── WORK page: fill the shell's main area and scroll INSIDE the body
       panel only — no outer page scroll, no double scrollbars. Applies on
       every size (intentional, approved non-scroll app layout). ── */
    :host { display: block; height: 100%; }
    .pf-page {
      display: flex; flex-direction: column;
      height: 100%; min-height: 0; overflow: hidden;
    }
    /* Fixed top chrome: KPIs, header, lookup + search. */
    .pf-page__top { flex: 0 0 auto; min-height: 0; }
    /* Scrollable content: results + unbilled orders. */
    .pf-page__body {
      flex: 1 1 auto; min-height: 0;
      overflow-y: auto; -webkit-overflow-scrolling: touch;
      padding-top: 8px;
    }

    .pf-section {
      margin: 14px 0 8px;
      font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted);
    }
    .pf-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-row {
      all: unset; cursor: pointer;
      /* Mobile: stack the order summary and the Process button so the
         button is full-width and tappable. Tablet+ goes back to the
         single inline row layout. */
      display: flex; flex-direction: column; align-items: stretch; gap: 10px;
      width: 100%; padding: 12px 16px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 14px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    @media (min-width: 640px) {
      .pf-row { flex-direction: row; align-items: center; gap: 14px; }
    }
    /* Keep the row's leading avatar / trailing chevron + action from being
       squished by the flexible text column. */
    .pf-row > pf-avatar,
    .pf-row > svg,
    .pf-row > pf-touch-btn { flex-shrink: 0; }
    /* Hover affordance only on devices that truly hover (not touch). */
    @media (hover: hover) {
      .pf-row:hover { border-color: rgba(168, 85, 247, 0.45); background: rgba(168, 85, 247, 0.04); }
    }
    .pf-row__id {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px; font-weight: 700;
      color: #c4b5fd;
      padding: 6px 10px; border-radius: 999px;
      background: rgba(168, 85, 247, 0.12);
      border: 1px solid rgba(168, 85, 247, 0.28);
      flex-shrink: 0;
    }
    .pf-row__name {
      margin: 0; font-weight: 600; font-size: 14.5px; color: var(--text-primary); text-align: left;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-row__meta {
      margin: 2px 0 0; font-size: 11px; color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-align: left;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hidden { display: none; }

    .pf-lookup { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .pf-lookup__input { flex: 1; min-width: 180px; }

    .pf-scan { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .pf-scan__bd { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
    .pf-scan__panel {
      position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 12px;
      width: min(420px, 100%); padding: 16px;
      background: var(--bg-card-solid, #14141f);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.12));
      border-radius: 18px; box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    }
    .pf-scan__video {
      width: 100%; aspect-ratio: 1 / 1; object-fit: cover;
      border-radius: 14px; background: #000;
      border: 2px solid rgba(168, 85, 247, 0.5);
    }
    .pf-scan__hint { font-size: 12.5px; color: var(--text-tertiary); text-align: center; }

    /* ── Phone (<=640): make the scan dialog a full-bleed bottom sheet that
       scrolls within the viewport and keeps its actions reachable above the
       bottom-nav pill. Desktop layout untouched. ── */
    @media (max-width: 640px) {
      .pf-scan { align-items: flex-end; padding: 12px; }
      .pf-scan__panel {
        width: 100%;
        max-height: 88dvh; overflow-y: auto;
        border-radius: 18px 18px 14px 14px;
        padding-bottom: calc(16px + var(--tab-nav-total-height, 0px));
      }
    }

    /* ── Capacitor native: the scan dialog is this page's own full-bleed
       fixed chrome, so absorb the notch/status-bar + home-indicator insets
       (global body insets don't reach position:fixed children). ── */
    :host-context(html.cap-native) .pf-scan {
      padding-top: calc(20px + env(safe-area-inset-top));
      padding-bottom: calc(20px + env(safe-area-inset-bottom));
      padding-left: calc(20px + env(safe-area-inset-left));
      padding-right: calc(20px + env(safe-area-inset-right));
    }
  `]
})
export class BillingCounterComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  // ── Scan / lookup (invoice number · order id · tracking QR) ──
  protected readonly lookupCode = signal('');
  protected readonly resolving = signal(false);
  protected readonly scanning = signal(false);
  protected readonly scanSupported = typeof (window as any).BarcodeDetector !== 'undefined';
  private readonly scanVideo = viewChild<ElementRef<HTMLVideoElement>>('scanVideo');
  private mediaStream: MediaStream | null = null;
  private scanRaf = 0;

  /** Resolve a typed/scanned code → order → open the collect-payment screen. */
  resolveLookup(code?: string) {
    const raw = (code ?? this.lookupCode()).trim();
    if (!raw || this.resolving()) return;
    this.resolving.set(true);
    this.api.get<{ orderId: string }>(`/api/billing/lookup?code=${encodeURIComponent(raw)}`).subscribe({
      next: r => {
        this.resolving.set(false);
        if (r?.orderId) this.router.navigate(['/frontdesk/billing'], { queryParams: { orderId: r.orderId } });
        else this.toasts.error('No order matches that code');
      },
      error: () => { this.resolving.set(false); this.toasts.error('No order matches that code'); }
    });
  }

  async startScan() {
    if (!this.scanSupported) { this.toasts.warning('Camera scan is not supported on this browser — type the invoice number instead'); return; }
    this.scanning.set(true);
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      // Wait a tick for the <video> to render, then attach + start detecting.
      setTimeout(() => {
        const video = this.scanVideo()?.nativeElement;
        if (!video || !this.mediaStream) { this.stopScan(); return; }
        video.srcObject = this.mediaStream;
        video.play().catch(() => { /* autoplay quirks — user gesture already given */ });
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        const tick = async () => {
          if (!this.scanning()) return;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length && codes[0].rawValue) {
              const value = codes[0].rawValue as string;
              this.stopScan();
              this.resolveLookup(value);
              return;
            }
          } catch { /* transient frame error — keep scanning */ }
          this.scanRaf = requestAnimationFrame(tick);
        };
        this.scanRaf = requestAnimationFrame(tick);
      }, 0);
    } catch {
      this.stopScan();
      this.toasts.error('Could not access the camera');
    }
  }

  stopScan() {
    this.scanning.set(false);
    if (this.scanRaf) { cancelAnimationFrame(this.scanRaf); this.scanRaf = 0; }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null; }
  }

  ngOnDestroy() { this.stopScan(); }

  protected readonly query = signal('');
  private readonly _results = signal<Patient[]>([]);
  private readonly _searching = signal(false);
  private readonly _selectedPatient = signal<Patient | null>(null);
  private readonly _orders = signal<Order[]>([]);
  private readonly _loadingOrders = signal(false);

  readonly results = this._results.asReadonly();
  readonly searching = this._searching.asReadonly();
  readonly selectedPatient = this._selectedPatient.asReadonly();
  readonly loadingOrders = this._loadingOrders.asReadonly();
  readonly unbilledOrders = computed(() =>
    this._orders().filter(o => o.status === 'created' || o.status === 'pending'));

  display(p: Patient | null | undefined): string { return patientDisplayName(p); }

  onSearch(q: string) {
    this.query.set(q);
    if (q.trim().length === 0) { this._results.set([]); return; }
    this._searching.set(true);
    this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(q.trim())}`).subscribe({
      next: list => { this._results.set(list ?? []); this._searching.set(false); },
      error: () => { this._results.set([]); this._searching.set(false); }
    });
  }

  selectPatient(p: Patient) {
    this._selectedPatient.set(p);
    this._orders.set([]);
    this._loadingOrders.set(true);
    // Reuse the patient profile endpoint which returns orders.
    this.api.get<{ patient: Patient; history: Order[] }>(`/api/patients/${p.id}`).subscribe({
      next: res => {
        this._orders.set(res.history ?? []);
        this._loadingOrders.set(false);
      },
      error: () => {
        this._loadingOrders.set(false);
        this.toasts.error('Could not load orders for this patient');
      }
    });
  }

  bill(o: Order) {
    // Hand off to the existing billing screen with the order id pre-loaded.
    this.router.navigate(['/frontdesk/billing'], { queryParams: { orderId: o.id } });
  }

  totalTests(o: Order): number {
    return (o.samples ?? []).reduce((sum, s) => sum + (s.tests?.length ?? 0), 0);
  }

  priorityTone(o: Order): 'default' | 'amber' | 'rose' {
    if (o.priority === 'STAT' || o.priority === 'Urgent') return 'rose';
    if (o.priority === 'High') return 'amber';
    return 'default';
  }
}
