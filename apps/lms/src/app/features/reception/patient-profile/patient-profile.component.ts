import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { Order, OrderTest } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface ProfilePayload {
  patient: Patient;
  history: Order[];
}

@Component({
  selector: 'pf-patient-profile',
  standalone: true,
  imports: [
    DatePipe,
    AvatarComponent,
    ChipComponent,
    ScreenHeaderComponent,
    SkeletonComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">

      <pf-screen-header
        eyebrow="Reception · Patient profile"
        [title]="patient()?.name ?? 'Patient profile'"
        subtitle="Contact details, identifiers, and past visits.">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
      </pf-screen-header>

      @if (patient(); as p) {
        <div class="space-y-5">
          <!-- Hero card -->
          <pf-tile tone="violet" padding="lg" class="block">
            <div class="flex items-center gap-4">
              <pf-avatar [name]="p.name" [size]="64"></pf-avatar>
              <div class="min-w-0 flex-1">
                <p class="text-[20px] font-semibold leading-tight truncate"
                   style="color: var(--text-primary);">{{ p.name }}</p>
                <p class="text-[12.5px] font-mono mt-1"
                   style="color: var(--text-tertiary);">
                  {{ p.sex ?? '—' }} · {{ p.age ?? '—' }}y
                  @if (p.phone) { · {{ p.phone }} }
                </p>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 mt-4">
              @if (p.abhaId) {
                <pf-chip tone="sky" size="sm">ABHA · {{ p.abhaId }}</pf-chip>
              }
              @if (p.isMinor) {
                <pf-chip tone="amber" size="sm">Minor</pf-chip>
              }
              @if (p.hasKnownAllergies) {
                <pf-chip tone="rose" size="sm">Allergies</pf-chip>
              }
              @if (p.email) {
                <pf-chip tone="default" size="sm">{{ p.email }}</pf-chip>
              }
            </div>
          </pf-tile>

          <!-- Primary actions -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <pf-touch-btn variant="primary" size="md" [full]="true" (pressed)="startOrder(p)">
              <span icon-left aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 5v14"/>
                  <path d="M5 12h14"/>
                </svg>
              </span>
              New order
            </pf-touch-btn>
            <pf-touch-btn variant="secondary" size="md" [full]="true" (pressed)="bookAppointment(p)">
              <span icon-left aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <path d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
              </span>
              Book appointment
            </pf-touch-btn>
          </div>

          <!-- Visit history -->
          <div>
            <div class="flex items-center gap-2 mb-3 px-1">
              <span class="text-[11px] font-mono uppercase tracking-[0.16em]"
                    style="color: var(--text-muted);">Visit history</span>
              <span class="text-[11px] font-mono"
                    style="color: var(--text-muted);">· {{ history().length }}</span>
            </div>

            @if (loading()) {
              <div class="space-y-2">
                @for (i of [0,1,2]; track i) {
                  <pf-tile tone="default" padding="md">
                    <pf-skeleton variant="line" width="55%"></pf-skeleton>
                    <div class="mt-2"><pf-skeleton variant="line" width="80%" height="10px"></pf-skeleton></div>
                  </pf-tile>
                }
              </div>
            } @else if (history().length === 0) {
              <pf-tile tone="default" padding="lg">
                <p class="text-center text-[13px]" style="color: var(--text-tertiary);">
                  No previous visits.
                </p>
              </pf-tile>
            } @else {
              <div class="space-y-2">
                @for (o of history(); track o.id) {
                  <pf-tile tone="default" padding="md">
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <p class="text-[13.5px] font-semibold"
                           style="color: var(--text-primary);">
                          {{ o.createdAt | date:'MMM d, y' }}
                        </p>
                        <p class="text-[11.5px] font-mono mt-0.5"
                           style="color: var(--text-tertiary);">
                          {{ o.priority }} · {{ o.collectionType }}
                          @if (o.id) { · #{{ o.id.slice(0, 8) }} }
                        </p>
                      </div>
                      <pf-chip [tone]="statusTone(o.status)" size="sm">{{ o.status }}</pf-chip>
                    </div>

                    @if (orderTests(o); as tests) {
                      @if (tests.length > 0) {
                        <div class="mt-3 pt-3 space-y-1.5"
                             style="border-top: 1px solid var(--border-muted);">
                          @for (t of tests; track t.id) {
                            <div class="flex items-center justify-between gap-2">
                              <p class="text-[12.5px] truncate"
                                 style="color: var(--text-secondary);">
                                {{ t.test?.name ?? 'Unknown test' }}
                              </p>
                              <pf-chip [tone]="testStatusTone(t.status)" size="sm">{{ t.status }}</pf-chip>
                            </div>
                          }
                        </div>
                      }
                    }
                  </pf-tile>
                }
              </div>
            }
          </div>
        </div>
      } @else if (loading()) {
        <pf-tile tone="default" padding="lg">
          <div class="flex items-center gap-3">
            <pf-skeleton variant="circle" width="64px" height="64px"></pf-skeleton>
            <div class="flex-1 space-y-2">
              <pf-skeleton variant="line" width="40%"></pf-skeleton>
              <pf-skeleton variant="line" width="70%" height="10px"></pf-skeleton>
            </div>
          </div>
        </pf-tile>
      } @else {
        <pf-tile tone="default" padding="lg">
          <p class="text-center text-[13px]" style="color: var(--text-tertiary);">
            Patient not found.
          </p>
        </pf-tile>
      }
    </section>
  `
})
export class PatientProfileComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _patient = signal<Patient | null>(null);
  private readonly _history = signal<Order[]>([]);
  private readonly _loading = signal(false);
  readonly patient = this._patient.asReadonly();
  readonly history = this._history.asReadonly();
  readonly loading = this._loading.asReadonly();

  ngOnInit() {
    this.route.paramMap.subscribe(map => {
      const id = map.get('id');
      if (id) this.load(id);
    });
  }

  statusTone(status: string): ChipTone {
    switch (status) {
      case 'completed':   return 'emerald';
      case 'cancelled':   return 'rose';
      case 'in_progress': return 'violet';
      default:            return 'amber';
    }
  }

  testStatusTone(status: string): ChipTone {
    switch (status) {
      case 'validated':
      case 'completed': return 'emerald';
      case 'rejected':  return 'rose';
      case 'in_progress':
      case 'resulted':  return 'violet';
      default:          return 'amber';
    }
  }

  orderTests(o: Order): OrderTest[] {
    const tests: OrderTest[] = [];
    for (const s of o.samples ?? []) {
      for (const t of s.tests ?? []) tests.push(t);
    }
    return tests;
  }

  back() { this.router.navigateByUrl('/reception'); }

  startOrder(p: Patient) {
    this.router.navigate(['/reception/order-create'], { queryParams: { patientId: p.id } });
  }

  bookAppointment(p: Patient) {
    this.router.navigate(['/reception/appointments/new'], { queryParams: { patientId: p.id } });
  }

  private load(id: string) {
    this._loading.set(true);
    this.api.get<ProfilePayload>(`/api/patients/${id}`).subscribe({
      next: res => {
        this._patient.set(res.patient);
        this._history.set(res.history ?? []);
        this._loading.set(false);
      },
      error: () => this._loading.set(false)
    });
  }
}
