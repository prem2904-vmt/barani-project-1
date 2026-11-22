import { ViewStateService } from '../../shared/services/view-state.service';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppointmentQueueService } from '../../core/services/appointment-queue.service';
import { ToastService } from '../../core/services/toast.service';
import { ThemeService } from '../../core/services/theme.service';
import { Appointment } from '../../shared/models/appointment.model';
import { Patient, formatPatientMeta } from '../../shared/models/patient.model';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../shared/primitives/touch-button.component';
import { ChipComponent } from '../../shared/primitives/chip.component';
import { AvatarComponent } from '../../shared/primitives/avatar.component';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../shared/primitives/segmented.component';
import { ApiError } from '../../shared/models/api-response.model';
import { SkeletonRowsComponent } from '../../shared/primitives/skeleton-kit.component';
import { busyIdWhile } from '../frontdesk/busy-id';

@Component({
  selector: 'pf-my-home-collections',
  standalone: true,
  imports: [
    SkeletonRowsComponent,
    DatePipe,
    ScreenHeaderComponent,
    TouchButtonComponent,
    ChipComponent,
    AvatarComponent,
    HeroBandComponent,
    SegmentedComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .pf-hc-page {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .pf-hc-content {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding-top: 16px;
      padding-bottom: 32px;
    }

    .pf-cards-skel {
      padding: 24px;
      border-radius: var(--pf-radius-card, 16px);
      border: 1px solid var(--pf-line, #e2e8f0);
      background: var(--pf-card-bg, #ffffff);
    }

    .pf-hc-card {
      transition: transform var(--pf-dur-fast, 0.15s) var(--pf-spring, ease),
                  box-shadow var(--pf-dur-fast, 0.15s) ease,
                  border-color var(--pf-dur-fast, 0.15s) ease;
      background: var(--pf-card-bg, #ffffff);
      border: 1px solid var(--pf-line, #e2e8f0);
      border-radius: var(--pf-radius-card, 16px);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
    }

    .pf-hc-card:hover {
      border-color: rgba(124, 58, 237, 0.35);
      box-shadow: 0 8px 24px rgba(124, 58, 237, 0.08);
    }

    .pf-hc-card .pf-card__head {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 3%, var(--pf-card-bg, #ffffff));
      border-bottom: 1px solid var(--pf-line, #e2e8f0);
    }

    .pf-hc-card .pf-card__body {
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 11px;
      flex: 1 1 auto;
    }

    .pf-hc-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .pf-hc-icon {
      width: 16px;
      height: 16px;
      color: var(--color-primary, #7c3aed);
      opacity: 0.9;
    }

    .pf-hc-card .pf-card__foot {
      padding: 12px 16px;
      background: var(--pf-card-bg, #ffffff);
      border-top: 1px solid var(--pf-line, #e2e8f0);
      margin-top: auto;
    }

    .pf-hc-wa-btn {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #10b981;
      background: color-mix(in srgb, #10b981 12%, transparent);
      border: 1px solid color-mix(in srgb, #10b981 25%, transparent);
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .pf-hc-wa-btn:hover {
      background: color-mix(in srgb, #10b981 22%, transparent);
      border-color: color-mix(in srgb, #10b981 40%, transparent);
    }

    .pf-hc-directions {
      color: var(--color-primary, #7c3aed);
      transition: opacity 0.15s ease;
    }
    .pf-hc-directions:hover {
      opacity: 0.85;
      text-decoration: underline;
    }

    .pf-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 64px 20px;
      text-align: center;
      border: 1px dashed var(--pf-line, #e2e8f0);
      border-radius: var(--pf-radius-card, 16px);
      background: var(--pf-card-bg, #ffffff);
    }
    .pf-empty__icon {
      color: var(--text-tertiary);
      margin-bottom: 14px;
    }
    .pf-empty__title {
      margin: 0 0 6px;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-empty__body {
      margin: 0;
      font-size: 13px;
      color: var(--text-tertiary);
      max-width: 380px;
    }

    @media (max-width: 640px) {
      .pf-hc-foot-inner {
        flex-direction: column;
        align-items: stretch !important;
      }
      .pf-hc-foot-actions {
        width: 100%;
        justify-content: flex-end;
      }
      .pf-hc-foot-actions > button {
        flex: 1 1 auto;
      }
    }
  `],
  template: `
    <section class="pf-band-page pf-hc-page">
      @if (theme.isNewDesign()) {
        <pf-hero-band
          [back]="true"
          placeholder="Search visits — patient, address, phone, pincode…"
          [value]="query()"
          (valueChange)="query.set($event)">
          <ng-container band-tools>
            <pf-segmented class="pf-hc-seg" size="sm" [options]="filterOptions()" [value]="statusFilter()"
                          (valueChange)="statusFilter.set($any($event))" aria-label="Filter visits" />
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="load()"
                    [disabled]="loading()" aria-label="Refresh visits" title="Refresh visits">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                   [class.animate-spin]="loading()">
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>
              </svg>
              <span>Refresh</span>
            </button>
          </ng-container>
        </pf-hero-band>
      } @else {
        <div class="pf-hc-head px-4 pt-4 md:px-6 md:pt-6 lg:px-8 lg:pt-8">
          <pf-screen-header
            eyebrow="Home collection"
            title="My visits"
            subtitle="Home-collection requests assigned to you. Check in on arrival, then collect the samples.">
            <pf-touch-btn actions size="sm" variant="ghost" [busy]="loading()" busyLabel="Refreshing…" (pressed)="load()">Refresh</pf-touch-btn>
          </pf-screen-header>
        </div>
      }

      <div class="pf-band-body pf-hc-content">
        @if (loading() && items().length === 0) {
          <div class="pf-cards-skel">
            <pf-skeleton-rows [rows]="3" label="Loading visits…"></pf-skeleton-rows>
          </div>
        } @else if (filteredItems().length === 0) {
          <div class="pf-empty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="pf-empty__icon" aria-hidden="true">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <p class="pf-empty__title">{{ query() || statusFilter() !== 'all' ? 'No matching visits' : 'No home visits assigned' }}</p>
            <p class="pf-empty__body">{{ query() || statusFilter() !== 'all' ? 'Try adjusting your search or status filter.' : 'Home-collection requests assigned to you will appear here.' }}</p>
          </div>
        } @else {
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            @for (a of filteredItems(); track a.id) {
              <div class="pf-card pf-hc-card">
                <!-- Header -->
                <div class="pf-card__head">
                  <pf-avatar [name]="a.patient?.displayName || 'Patient'" [size]="34"></pf-avatar>
                  <div class="min-w-0 flex-1">
                    <h3 class="font-bold text-[15px] leading-tight text-[var(--text-primary)] truncate"
                        [title]="a.patient?.displayName || 'Patient'">
                      {{ a.patient?.displayName || 'Patient' }}
                    </h3>
                    <p class="text-[12px] text-[var(--text-tertiary)] mt-0.5 truncate font-medium">
                      @if (patientMeta(a.patient); as meta) {
                        <span>{{ meta }}</span>
                      } @else {
                        <span>Scheduled visit</span>
                      }
                    </p>
                  </div>
                  <pf-chip [tone]="statusTone(a.status)" size="sm">
                    {{ statusLabel(a.status) }}
                  </pf-chip>
                </div>

                <!-- Body -->
                <div class="pf-card__body">
                  <!-- Date & Slot -->
                  <div class="pf-hc-row">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pf-hc-icon flex-shrink-0" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    <span class="text-[13px] font-medium text-[var(--text-secondary)]">
                      {{ a.appointmentDate | date:'dd MMM yyyy' }}
                      @if (a.slotTime) {
                        <span class="font-bold text-[var(--color-primary,#7c3aed)] ml-1 tabular-nums">· {{ a.slotTime }}</span>
                      }
                    </span>
                  </div>

                  <!-- Address -->
                  <div class="pf-hc-row items-start">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pf-hc-icon flex-shrink-0 mt-0.5" aria-hidden="true">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                      <circle cx="12" cy="10" r="3"/>
                    </svg>
                    <div class="min-w-0 flex-1 text-[13px] text-[var(--text-secondary)] leading-relaxed">
                      <span>{{ a.address || 'No address specified' }}</span>
                      @if (a.pincode) {
                        <span class="font-semibold text-[var(--text-primary)] ml-1 tabular-nums">({{ a.pincode }})</span>
                      }
                    </div>
                  </div>

                  <!-- Phone & Quick Contact -->
                  @if (a.patient?.phone; as phone) {
                    <div class="pf-hc-row">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pf-hc-icon flex-shrink-0" aria-hidden="true">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                      </svg>
                      <a [href]="'tel:' + phone" class="pf-hc-phone text-[13px] font-semibold text-[var(--color-primary,#7c3aed)] hover:underline tabular-nums">
                        {{ phone }}
                      </a>
                      <a [href]="'https://wa.me/' + cleanPhone(phone)" target="_blank" rel="noopener" class="pf-hc-wa-btn press ml-auto" title="WhatsApp" aria-label="WhatsApp">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M20 12a8 8 0 1 1-15.3-3.2L3 20l6.2-1.6A8 8 0 0 0 20 12Z"/>
                        </svg>
                      </a>
                    </div>
                  }
                </div>

                <!-- Footer Actions -->
                <div class="pf-card__foot">
                  <div class="pf-hc-foot-inner flex items-center justify-between w-full gap-2">
                    @if (mapUrl(a); as url) {
                      <a [href]="url" target="_blank" rel="noopener"
                         class="pf-btn pf-btn--quiet pf-hc-directions text-[12px] font-semibold inline-flex items-center gap-1.5"
                         aria-label="Directions to patient location">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <polygon points="3 11 22 2 13 21 11 13 3 11"/>
                        </svg>
                        <span>Directions</span>
                      </a>
                    } @else {
                      <span></span>
                    }

                    <div class="pf-hc-foot-actions flex items-center gap-2">
                      @if (a.status === 'booked') {
                        <button type="button" class="pf-btn pf-btn--primary press"
                                [disabled]="busyId() === a.id" (click)="checkInAndCollect(a)">
                          {{ busyId() === a.id ? 'Checking in…' : 'Check in & collect' }}
                        </button>
                      } @else {
                        <button type="button" class="pf-btn pf-btn--secondary press"
                                (click)="goCollect()">
                          Collect samples
                        </button>
                        @if (a.status === 'checked_in' || a.status === 'in_progress') {
                          <button type="button" class="pf-btn pf-btn--primary press"
                                  [disabled]="busyId() === a.id" (click)="completeVisit(a)">
                            {{ busyId() === a.id ? 'Completing…' : 'Complete visit' }}
                          </button>
                        }
                      }
                    </div>
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </section>
  `
})
export class MyHomeCollectionsComponent implements OnInit {
  private readonly svc = inject(AppointmentQueueService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);

  private readonly _items = signal<Appointment[]>([]);
  private readonly _loading = signal(false);
  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly query = signal('');
  readonly statusFilter = signal<'all' | 'scheduled' | 'active'>('all');

  readonly scheduledCount = computed(() => this._items().filter(a => a.status === 'booked').length);
  readonly activeCount = computed(() => this._items().filter(a => a.status === 'checked_in' || a.status === 'in_progress').length);

  readonly filterOptions = computed<SegmentedOption[]>(() => [
    { value: 'all', label: `All (${this._items().length})` },
    { value: 'scheduled', label: `Scheduled (${this.scheduledCount()})` },
    { value: 'active', label: `In progress (${this.activeCount()})` },
  ]);

  readonly filteredItems = computed(() => {
    let list = this._items();
    const f = this.statusFilter();
    if (f === 'scheduled') list = list.filter(a => a.status === 'booked');
    else if (f === 'active') list = list.filter(a => a.status === 'checked_in' || a.status === 'in_progress');
    const q = this.query().trim().toLowerCase();
    if (q) {
      list = list.filter(a => {
        const name = (a.patient?.displayName || a.patient?.firstName || '').toLowerCase();
        const phone = (a.patient?.phone || '').toLowerCase();
        const addr = (a.address || '').toLowerCase();
        const pin = (a.pincode || '').toLowerCase();
        const mrn = (a.patient?.mrn || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || addr.includes(q) || pin.includes(q) || mrn.includes(q);
      });
    }
    return list;
  });

  ngOnInit() { this.load(); }

  load() {
    this._loading.set(true);
    this.svc.myHomeCollections().subscribe({
      next: l => { this._items.set(l ?? []); this._loading.set(false); },
      error: e => { this._loading.set(false); this.toast.error(ApiError.from(e).message); }
    });
  }

  /** Visit whose Check-in / Complete request is in flight. */
  readonly busyId = signal<string | null>(null);

  checkInAndCollect(a: Appointment) {
    if (this.busyId() === a.id) return;
    this.svc.checkIn(a.id).pipe(busyIdWhile(this.busyId, a.id)).subscribe({
      next: () => { this.toast.success('Checked in — collect the samples.'); this.goCollect(); },
      error: e => { this.toast.error(ApiError.from(e).message); this.load(); }
    });
  }

  completeVisit(a: Appointment) {
    if (this.busyId() === a.id) return;
    this.svc.complete(a.id).pipe(busyIdWhile(this.busyId, a.id)).subscribe({
      next: () => { this.toast.success('Visit completed.'); this.load(); },
      error: e => { this.toast.error(ApiError.from(e).message); this.load(); }
    });
  }

  goCollect() { this.router.navigate(['/sample-collection']); }

  mapUrl(a: Appointment): string | null {
    if (a.latitude != null && a.longitude != null) {
      return `https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`;
    }
    if (a.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.address + ' ' + (a.pincode ?? ''))}`;
    return null;
  }

  patientMeta(p?: Patient | null): string {
    return p ? formatPatientMeta(p) : '';
  }

  cleanPhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  statusTone(s: string): 'default' | 'amber' | 'violet' | 'emerald' {
    if (s === 'checked_in') return 'amber';
    if (s === 'in_progress') return 'violet';
    if (s === 'completed') return 'emerald';
    return 'default';
  }

  statusLabel(s: string): string {
    if (s === 'booked') return 'Scheduled';
    if (s === 'checked_in') return 'Checked in';
    if (s === 'in_progress') return 'Collecting';
    if (s === 'completed') return 'Completed';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Screen view state (owner 2026-11-21): filters / tab / search come back as left after in-app navigation;
  // fresh on reload, sign-out and branch switch.
  private readonly _viewState = inject(ViewStateService).bind('home-collections', { query: this.query, status: this.statusFilter });
}
