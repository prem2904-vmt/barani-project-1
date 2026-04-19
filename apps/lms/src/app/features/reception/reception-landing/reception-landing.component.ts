import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { Appointment } from '../../../shared/models/appointment.model';
import { Order } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';

type Tab = 'appointments' | 'orders';

@Component({
  selector: 'pf-reception-landing',
  standalone: true,
  imports: [
    DatePipe,
    PatientSearchComponent,
    AvatarComponent, ChipComponent, ScreenHeaderComponent, SegmentedComponent,
    SkeletonComponent, TileComponent, TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-5 md:px-8 pt-5 pb-10 max-w-6xl mx-auto">

      <pf-screen-header eyebrow="Reception · Front desk"
                        [subtitle]="subtitle()">
        Good day, <span class="text-gradient">{{ firstName() }}</span>
        <div actions>
          <pf-touch-btn variant="secondary" size="md" (pressed)="searchFocus()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" icon-left>
              <rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h10M7 14h6"/>
            </svg>
            Scan QR
          </pf-touch-btn>
          <pf-touch-btn variant="primary" size="md" (pressed)="openRegister()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" icon-left>
              <path d="M12 5v14M5 12h14"/>
            </svg>
            New patient
          </pf-touch-btn>
        </div>
      </pf-screen-header>

      <!-- KPIs -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        @for (k of kpis(); track k.key) {
          <pf-tile [tone]="k.tone" padding="md">
            <p class="text-[10.5px] font-mono uppercase tracking-[0.14em]"
               style="color: var(--text-muted);">{{ k.key }}</p>
            <p class="mt-1 text-[28px] md:text-[32px] leading-none font-semibold tabular-nums"
               style="color: var(--text-primary);">{{ k.value }}</p>
            <p class="mt-0.5 text-[12px]" style="color: var(--text-tertiary);">{{ k.sub }}</p>
          </pf-tile>
        }
      </div>

      <!-- Search -->
      <div class="mb-5">
        <pf-patient-search placeholder="Search patient by name, phone, or ABHA…"
                           (picked)="openProfile($event)"></pf-patient-search>
      </div>

      <!-- Tabs -->
      <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
        <pf-segmented [options]="tabOptions" [value]="tab()" (valueChange)="setTab($event)"/>
        <p class="text-[11px] font-mono uppercase tracking-[0.14em]"
           style="color: var(--text-muted);">
          {{ tab() === 'appointments' ? appointments().length : orders().length }}
          {{ tab() === 'appointments' ? 'scheduled' : 'orders today' }}
        </p>
      </div>

      @if (loading() && appointments().length === 0 && orders().length === 0) {
        <ul class="grid grid-cols-1 md:grid-cols-2 gap-3">
          @for (i of [0,1,2,3]; track i) {
            <li>
              <pf-tile tone="default" padding="md">
                <div class="flex items-start gap-4">
                  <div class="shrink-0 w-16 space-y-1">
                    <pf-skeleton variant="line" width="40px" height="10px"></pf-skeleton>
                    <pf-skeleton variant="line" width="56px" height="22px"></pf-skeleton>
                  </div>
                  <div class="flex-1 flex items-center gap-3">
                    <pf-skeleton variant="circle" width="40px" height="40px"></pf-skeleton>
                    <div class="flex-1 space-y-2">
                      <pf-skeleton variant="line" width="60%"></pf-skeleton>
                      <pf-skeleton variant="line" width="80%" height="10px"></pf-skeleton>
                    </div>
                  </div>
                </div>
              </pf-tile>
            </li>
          }
        </ul>
      } @else if (tab() === 'appointments') {
        @if (appointments().length === 0) {
          <pf-tile tone="default" padding="xl">
            <p class="text-center text-sm" style="color: var(--text-tertiary);">No appointments today.</p>
          </pf-tile>
        } @else {
          <ul class="grid grid-cols-1 md:grid-cols-2 gap-3">
            @for (a of appointments(); track a.id) {
              <li>
                <pf-tile tone="default" padding="md" [clickable]="true" (tapped)="openProfileById(a.patientId)">
                  <div class="flex items-start gap-4">
                    <div class="text-center shrink-0 w-16">
                      <p class="text-[10.5px] font-mono uppercase tracking-[0.14em]"
                         style="color: var(--text-muted);">Slot</p>
                      <p class="text-[22px] font-semibold tabular-nums leading-tight"
                         style="color: var(--text-primary);">{{ a.slotTime || '—' }}</p>
                    </div>
                    <div class="w-px self-stretch" style="background: var(--border-muted);"></div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-3">
                        <pf-avatar [name]="a.patient?.name ?? 'Patient'" [size]="40"></pf-avatar>
                        <div class="min-w-0 flex-1">
                          <p class="text-[15px] font-semibold truncate"
                             style="color: var(--text-primary);">{{ a.patient?.name ?? 'Patient' }}</p>
                          <p class="text-[12px] font-mono"
                             style="color: var(--text-tertiary);">
                            {{ a.type }} · {{ a.refDoctorName || 'No doctor' }}
                          </p>
                        </div>
                        <pf-chip [tone]="apptTone(a)" size="sm">
                          {{ a.status.replaceAll('_', ' ') }}
                        </pf-chip>
                      </div>
                      @if (a.status === 'booked') {
                        <div class="mt-3 flex items-center gap-2">
                          <pf-touch-btn variant="secondary" size="sm"
                                        (pressed)="$event.stopPropagation(); checkIn(a)">
                            Check in
                          </pf-touch-btn>
                        </div>
                      }
                    </div>
                  </div>
                </pf-tile>
              </li>
            }
          </ul>
        }
      } @else {
        @if (orders().length === 0) {
          <pf-tile tone="default" padding="xl">
            <p class="text-center text-sm" style="color: var(--text-tertiary);">No orders today.</p>
          </pf-tile>
        } @else {
          <ul class="grid grid-cols-1 md:grid-cols-2 gap-3">
            @for (o of orders(); track o.id) {
              <li>
                <pf-tile tone="default" padding="md" [clickable]="true" (tapped)="openOrder(o)">
                  <div class="flex items-start gap-3">
                    <pf-avatar [name]="o.patient?.name ?? 'Patient'" [size]="40"></pf-avatar>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <p class="text-[15px] font-semibold truncate"
                           style="color: var(--text-primary);">{{ o.patient?.name ?? 'Patient' }}</p>
                        <pf-chip [tone]="orderTone(o)" size="sm">{{ o.status }}</pf-chip>
                      </div>
                      <p class="text-[12px] font-mono mt-0.5"
                         style="color: var(--text-tertiary);">
                        {{ o.createdAt | date:'shortTime' }}
                        · {{ o.priority }}
                        · {{ o.samples.length }} samples
                      </p>
                    </div>
                  </div>

                  <div class="pf-tl">
                    @for (step of pipeline(o); track step.label; let i = $index; let first = $first) {
                      @if (!first) {
                        <span class="pf-tl__line" [attr.data-state]="step.state"></span>
                      }
                      <span class="pf-tl__step" [attr.data-state]="step.state">
                        <span class="pf-tl__node">
                          @if (step.state === 'done') {
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <polyline points="2 5 4 7 8 3"/>
                            </svg>
                          }
                        </span>
                        <span class="pf-tl__label">{{ step.label }}</span>
                      </span>
                    }
                  </div>
                </pf-tile>
              </li>
            }
          </ul>
        }
      }
    </section>

    @if (selectedOrder(); as so) {
      <div class="pf-drawer-bd" (click)="closeOrder()"></div>
      <aside class="pf-drawer" role="dialog" aria-modal="true">
        <header class="pf-drawer__hdr">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <pf-avatar [name]="so.patient?.name ?? 'Patient'" [size]="44"></pf-avatar>
            <div class="min-w-0 flex-1">
              <p class="text-[10.5px] font-mono uppercase tracking-[0.16em]"
                 style="color: var(--text-muted);">Order · #{{ so.id.slice(0, 8) }}</p>
              <p class="text-[17px] font-semibold truncate"
                 style="color: var(--text-primary);">{{ so.patient?.name ?? 'Patient' }}</p>
            </div>
            <pf-chip [tone]="orderTone(so)" size="sm">{{ so.status }}</pf-chip>
          </div>
          <button type="button" class="pf-drawer__close" (click)="closeOrder()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </header>

        <div class="pf-drawer__body">
          <dl class="pf-drawer__meta">
            <div>
              <dt>Created</dt>
              <dd>{{ so.createdAt | date:'MMM d, h:mm a' }}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{{ so.priority }}</dd>
            </div>
            <div>
              <dt>Samples</dt>
              <dd>{{ so.samples.length }}</dd>
            </div>
            <div>
              <dt>Doctor</dt>
              <dd>{{ so.refDoctorName || '—' }}</dd>
            </div>
          </dl>

          <section>
            <p class="pf-drawer__eyebrow">Timeline</p>
            <ol class="pf-vtl">
              @for (step of pipeline(so); track step.label) {
                <li class="pf-vtl__row" [attr.data-state]="step.state">
                  <span class="pf-vtl__node">
                    @if (step.state === 'done') {
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="2 6 5 9 10 3"/>
                      </svg>
                    }
                  </span>
                  <div class="flex-1 min-w-0">
                    <p class="pf-vtl__label">{{ step.label }}</p>
                    <p class="pf-vtl__status">{{ stepCaption(so, step) }}</p>
                  </div>
                </li>
              }
            </ol>
          </section>

          <section>
            <p class="pf-drawer__eyebrow">Samples · Tests</p>
            @if (so.samples.length === 0) {
              <p class="pf-drawer__empty">No samples yet.</p>
            } @else {
              @for (s of so.samples; track s.id) {
                <div class="pf-sample-card">
                  <div class="pf-sample-card__hdr">
                    <span class="pf-sample-card__code">{{ s.barcode || s.id.slice(0, 8) }}</span>
                    <pf-chip [tone]="sampleTone(s.status)" size="sm">{{ s.status }}</pf-chip>
                  </div>
                  <ul class="pf-sample-card__tests">
                    @for (t of s.tests; track t.id) {
                      <li>
                        <span class="pf-sample-card__test-name">{{ t.test?.name ?? 'Test' }}</span>
                        <pf-chip [tone]="testTone(t.status)" size="sm">{{ t.status }}</pf-chip>
                      </li>
                    } @empty {
                      <li class="pf-sample-card__empty">No tests.</li>
                    }
                  </ul>
                </div>
              }
            }
          </section>
        </div>
      </aside>
    }
  `,
  styles: [`
    /* Inline timeline inside tile */
    .pf-tl {
      display: flex;
      align-items: center;
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px solid var(--border-muted);
      gap: 0;
    }
    .pf-tl__line {
      flex: 1;
      height: 2px;
      background: var(--border-muted);
      margin: 0 4px 12px;
      border-radius: 2px;
    }
    .pf-tl__line[data-state="done"]   { background: #10b981; }
    .pf-tl__line[data-state="active"] { background: linear-gradient(90deg, #10b981 50%, var(--border-muted) 50%); }
    .pf-tl__step {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      min-width: 0;
    }
    .pf-tl__node {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 9999px;
      background: var(--bg-card-solid);
      border: 2px solid var(--border-muted);
      color: #fff;
      flex-shrink: 0;
    }
    .pf-tl__step[data-state="done"]    .pf-tl__node { background: #10b981; border-color: #10b981; }
    .pf-tl__step[data-state="active"]  .pf-tl__node { background: #f59e0b; border-color: #f59e0b; animation: pf-tl-pulse 1.6s infinite; }
    .pf-tl__step[data-state="pending"] .pf-tl__node { background: var(--bg-card-solid); }
    .pf-tl__label {
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .pf-tl__step[data-state="done"]   .pf-tl__label,
    .pf-tl__step[data-state="active"] .pf-tl__label { color: var(--text-secondary); }

    @keyframes pf-tl-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.55); }
      50%      { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
    }

    /* Detail drawer (slide-over) */
    .pf-drawer-bd {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(6px);
      z-index: 60;
      animation: pf-fade .18s ease-out both;
    }
    .pf-drawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(520px, 100vw);
      background: var(--bg-card-solid);
      border-left: 1px solid var(--glass-border);
      box-shadow: -24px 0 60px rgba(0, 0, 0, 0.4);
      z-index: 61;
      display: flex;
      flex-direction: column;
      animation: pf-drawer-in .22s cubic-bezier(0.4, 0, 0.2, 1) both;
    }
    .pf-drawer__hdr {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--border-muted);
    }
    .pf-drawer__close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      background: transparent;
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      cursor: pointer;
      transition: background .12s ease, color .12s ease;
    }
    .pf-drawer__close:hover { background: var(--glass-bg-hover); color: var(--text-primary); }

    .pf-drawer__body {
      overflow-y: auto;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .pf-drawer__eyebrow {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 0 0 10px;
    }
    .pf-drawer__empty {
      font-size: 12.5px;
      color: var(--text-tertiary);
      margin: 0;
    }
    .pf-drawer__meta {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px 14px;
      padding: 12px 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      margin: 0;
    }
    .pf-drawer__meta dt {
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 2px;
    }
    .pf-drawer__meta dd {
      margin: 0;
      font-size: 13px;
      color: var(--text-primary);
    }

    /* Vertical timeline inside drawer */
    .pf-vtl {
      list-style: none;
      padding: 0;
      margin: 0;
      position: relative;
    }
    .pf-vtl::before {
      content: '';
      position: absolute;
      left: 10px;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: var(--border-muted);
      border-radius: 2px;
    }
    .pf-vtl__row {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 6px 0 14px;
    }
    .pf-vtl__row:last-child { padding-bottom: 0; }
    .pf-vtl__node {
      position: relative;
      z-index: 1;
      width: 22px;
      height: 22px;
      border-radius: 9999px;
      background: var(--bg-card-solid);
      border: 2px solid var(--border-muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      flex-shrink: 0;
    }
    .pf-vtl__row[data-state="done"]   .pf-vtl__node { background: #10b981; border-color: #10b981; }
    .pf-vtl__row[data-state="active"] .pf-vtl__node { background: #f59e0b; border-color: #f59e0b; animation: pf-tl-pulse 1.6s infinite; }

    .pf-vtl__label {
      margin: 2px 0 0;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-vtl__status {
      margin: 2px 0 0;
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
    }
    .pf-vtl__row[data-state="pending"] .pf-vtl__label { color: var(--text-secondary); }

    /* Sample card */
    .pf-sample-card {
      padding: 12px 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      margin-bottom: 10px;
    }
    .pf-sample-card:last-child { margin-bottom: 0; }
    .pf-sample-card__hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .pf-sample-card__code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .pf-sample-card__tests {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pf-sample-card__tests li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .pf-sample-card__test-name {
      font-size: 12.5px;
      color: var(--text-primary);
      min-width: 0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pf-sample-card__empty {
      font-size: 12px;
      color: var(--text-tertiary);
    }

    @keyframes pf-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pf-drawer-in { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  `]
})
export class ReceptionLandingComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly tabOptions = [
    { value: 'appointments' as Tab, label: "Today's Appointments" },
    { value: 'orders'       as Tab, label: "Today's Orders" }
  ];

  private readonly _tab = signal<Tab>('appointments');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) { this._tab.set(t); }

  readonly firstName = computed(() => (this.auth.user()?.name ?? 'there').split(' ')[0]);
  readonly subtitle = computed(() => {
    const a = this._appointments().length;
    const o = this._orders().length;
    return `${a} scheduled · ${o} orders · front desk live`;
  });

  readonly kpis = computed(() => {
    const appts = this._appointments();
    const orders = this._orders();
    const waiting = appts.filter(a => a.status === 'booked').length;
    const inLab = orders.filter(o => o.samples.some(s => s.status === 'received' || s.status === 'processing')).length;
    return [
      { key: 'Today',     value: appts.length.toString(),  sub: 'appointments', tone: 'violet'  as const },
      { key: 'Waiting',   value: waiting.toString(),       sub: 'front desk',   tone: 'amber'   as const },
      { key: 'In lab',    value: inLab.toString(),         sub: 'samples out',  tone: 'sky'     as const },
      { key: 'Orders',    value: orders.length.toString(), sub: 'today',        tone: 'emerald' as const }
    ];
  });

  private readonly _appointments = signal<Appointment[]>([]);
  private readonly _orders = signal<Order[]>([]);
  private readonly _selectedOrder = signal<Order | null>(null);
  readonly appointments = this._appointments.asReadonly();
  readonly orders = this._orders.asReadonly();
  readonly selectedOrder = this._selectedOrder.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  ngOnInit() { this.refresh(); }

  refresh() {
    this._loading.set(true);
    let remaining = 2;
    const done = () => { if (--remaining === 0) this._loading.set(false); };
    this.api.get<Appointment[]>('/api/appointments/today').subscribe({
      next: l => { this._appointments.set(l ?? []); done(); },
      error: () => done()
    });
    this.api.get<Order[]>('/api/orders/today').subscribe({
      next: l => { this._orders.set(l ?? []); done(); },
      error: () => done()
    });
  }

  openRegister() { this.router.navigate(['/reception/patients/new']); }
  searchFocus() { /* future: QR scanner */ }
  openProfile(p: Patient) { this.router.navigate(['/reception/patients', p.id]); }
  openProfileById(id: string) { this.router.navigate(['/reception/patients', id]); }

  apptTone(a: Appointment): ChipTone {
    switch (a.status) {
      case 'checked_in': return 'emerald';
      case 'booked':     return 'amber';
      case 'completed':  return 'teal';
      case 'cancelled':  return 'rose';
      case 'no_show':    return 'rose';
      default:           return 'default';
    }
  }
  orderTone(o: Order): ChipTone {
    switch (o.status) {
      case 'completed': return 'emerald';
      case 'cancelled': return 'rose';
      case 'in_progress': return 'violet';
      default:          return 'amber';
    }
  }

  checkIn(a: Appointment) {
    this.api.patch<Appointment>(`/api/appointments/${a.id}/checkin`).subscribe({
      next: () => { this.toasts.success('Checked in'); this.refresh(); }
    });
  }

  openOrder(o: Order) { this._selectedOrder.set(o); }
  closeOrder() { this._selectedOrder.set(null); }

  stepCaption(o: Order, step: { label: string; state: 'done' | 'active' | 'pending' }): string {
    if (step.state === 'pending') return 'Pending';
    switch (step.label) {
      case 'Billing':
        return step.state === 'done' ? 'Billed' : 'Billing in progress';
      case 'Sample': {
        const total = o.samples.length;
        const collected = o.samples.filter(s => s.status && s.status !== 'pending').length;
        const received = o.samples.filter(s => s.status === 'received' || s.status === 'processing').length;
        if (step.state === 'done') return `${received}/${total} received at lab`;
        return `${collected}/${total} collected`;
      }
      case 'Result': {
        const all = o.samples.flatMap(s => s.tests ?? []);
        const validated = all.filter(t => t.status === 'validated' || t.status === 'entered').length;
        return `${validated}/${all.length} tests resulted`;
      }
      case 'Report':
        return step.state === 'done' ? 'Report dispatched' : 'Awaiting validation';
      default:
        return '';
    }
  }

  sampleTone(status: string | undefined): ChipTone {
    switch (status) {
      case 'received':
      case 'processing': return 'violet';
      case 'collected':  return 'amber';
      case 'rejected':   return 'rose';
      default:           return 'default';
    }
  }

  testTone(status: string | undefined): ChipTone {
    switch (status) {
      case 'validated': return 'emerald';
      case 'entered':   return 'violet';
      case 'rejected':  return 'rose';
      default:          return 'amber';
    }
  }

  pipeline(o: Order): Array<{ label: string; state: 'done' | 'active' | 'pending' }> {
    const anySample = o.samples[0];
    const billDone  = o.status !== 'draft';
    const collected = o.samples.some(s => s.status && s.status !== 'pending');
    const received  = o.samples.some(s => s.status === 'received' || s.status === 'processing');
    const completed = o.status === 'completed';
    const anyResult = anySample?.tests?.some(t => t.status === 'validated' || t.status === 'entered') ?? false;

    return [
      { label: 'Billing', state: billDone ? 'done' : 'active' },
      { label: 'Sample',  state: received ? 'done' : collected ? 'active' : 'pending' },
      { label: 'Result',  state: anyResult ? 'done' : received ? 'active' : 'pending' },
      { label: 'Report',  state: completed ? 'done' : anyResult ? 'active' : 'pending' }
    ];
  }
}
