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
import { BookAppointmentComponent } from '../book-appointment/book-appointment.component';
import { PatientProfileComponent } from '../patient-profile/patient-profile.component';
import { PatientRegisterComponent } from '../patient-register/patient-register.component';

type Tab = 'appointments' | 'orders';

@Component({
  selector: 'pf-reception-landing',
  standalone: true,
  imports: [
    DatePipe,
    PatientSearchComponent, PatientRegisterComponent, PatientProfileComponent, BookAppointmentComponent,
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
                <pf-tile tone="default" padding="md">
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
                  <div class="mt-4 grid grid-cols-4 gap-2 text-[11px] font-mono">
                    @for (step of pipeline(o); track step.label) {
                      <div class="flex items-center gap-1.5"
                           [style.opacity]="step.state === 'pending' ? 0.45 : 1">
                        <span class="h-1.5 w-1.5 rounded-full"
                              [class.pf-dot-done]="step.state === 'done'"
                              [class.pf-dot-active]="step.state === 'active'"
                              [class.pf-dot-pending]="step.state === 'pending'"></span>
                        <span class="uppercase tracking-wider"
                              [style.color]="step.state === 'pending' ? 'var(--text-muted)' : 'var(--text-secondary)'">
                          {{ step.label }}
                        </span>
                      </div>
                    }
                  </div>
                </pf-tile>
              </li>
            }
          </ul>
        }
      }
    </section>

    <pf-patient-register [open]="registerOpen()"
                        (closed)="registerOpen.set(false)"
                        (registered)="onRegistered($event)"></pf-patient-register>

    <pf-patient-profile [open]="profileOpen()"
                       [patientId]="profilePatientId()"
                       (closed)="profileOpen.set(false)"
                       (startOrder)="goOrder($event)"
                       (bookAppointment)="startAppointment($event)"></pf-patient-profile>

    <pf-book-appointment [open]="bookOpen()"
                        [prefillPatient]="bookPatient()"
                        (closed)="bookOpen.set(false)"
                        (booked)="onBooked()"></pf-book-appointment>
  `,
  styles: [`
    .pf-dot-done    { background: #10b981; box-shadow: 0 0 8px rgba(16, 185, 129, 0.55); }
    .pf-dot-active  { background: #f59e0b; box-shadow: 0 0 8px rgba(245, 158, 11, 0.55); }
    .pf-dot-pending { background: var(--border-muted); }
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
  readonly appointments = this._appointments.asReadonly();
  readonly orders = this._orders.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  protected readonly registerOpen = signal(false);
  protected readonly profileOpen = signal(false);
  protected readonly profilePatientId = signal<string | null>(null);
  protected readonly bookOpen = signal(false);
  private readonly _bookPatient = signal<Patient | null>(null);
  readonly bookPatient = this._bookPatient.asReadonly();

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

  openRegister() { this.registerOpen.set(true); }
  searchFocus() { /* future: QR scanner */ }
  openProfile(p: Patient) {
    this.profilePatientId.set(p.id);
    this.profileOpen.set(true);
  }
  openProfileById(id: string) {
    this.profilePatientId.set(id);
    this.profileOpen.set(true);
  }

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

  onRegistered(ev: { patient: Patient; createOrder: boolean }) {
    this.registerOpen.set(false);
    if (ev.createOrder) {
      this.router.navigate(['/reception/order-create'], { queryParams: { patientId: ev.patient.id } });
    } else {
      this.profilePatientId.set(ev.patient.id);
      this.profileOpen.set(true);
    }
  }

  goOrder(p: Patient) {
    this.profileOpen.set(false);
    this.router.navigate(['/reception/order-create'], { queryParams: { patientId: p.id } });
  }

  startAppointment(p: Patient) {
    this.profileOpen.set(false);
    this._bookPatient.set(p);
    this.bookOpen.set(true);
  }

  onBooked() {
    this.bookOpen.set(false);
    this._bookPatient.set(null);
    this.refresh();
  }

  checkIn(a: Appointment) {
    this.api.patch<Appointment>(`/api/appointments/${a.id}/checkin`).subscribe({
      next: () => { this.toasts.success('Checked in'); this.refresh(); }
    });
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
