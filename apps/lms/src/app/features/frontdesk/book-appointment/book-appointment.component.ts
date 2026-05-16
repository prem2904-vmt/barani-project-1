import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  WorkflowRendererComponent,
  splitByStep
} from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import { Appointment } from '../../../shared/models/appointment.model';
import { Patient, patientDisplayName } from '../../../shared/models/patient.model';
import { Test } from '../../../shared/models/test.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import {
  WorkflowConfig,
  WorkflowConfigRecord,
  WorkflowContext,
  WorkflowFormValues
} from '../../../shared/models/workflow.model';

@Component({
  selector: 'pf-book-appointment',
  standalone: true,
  imports: [
    FormsModule,
    WorkflowRendererComponent,
    AvatarComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">

      <pf-screen-header
        eyebrow="Frontdesk · Appointments"
        title="Book appointment"
        subtitle="Pick a date and slot. WhatsApp confirmation queues automatically.">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
      </pf-screen-header>

      <!-- Prefill patient card when patientId is in the URL -->
      @if (prefillPatient(); as p) {
        <pf-tile tone="violet" padding="md" class="block mb-4">
          <div class="flex items-center gap-3">
            <pf-avatar [name]="p.displayName" [size]="44"></pf-avatar>
            <div class="min-w-0 flex-1">
              <p class="text-[14px] font-semibold truncate"
                 style="color: var(--text-primary);">{{ p.displayName }}</p>
              <p class="text-[11.5px] font-mono mt-0.5"
                 style="color: var(--text-tertiary);">
                {{ p.sex ?? '—' }} · {{ p.age ?? '—' }}y
                @if (p.phone) { · {{ p.phone }} }
              </p>
            </div>
          </div>
        </pf-tile>
      }

      <pf-tile tone="default" padding="lg" class="block">
        @if (config(); as cfg) {
          <pf-workflow-renderer
            [config]="cfg"
            [context]="context()"
            [resources]="resources()"
            [submitting]="saving()"
            [finishLabel]="'Book + Send WhatsApp'"
            [initialValues]="initialValues()"
            (valuesChange)="values.set($event)"
            (workflowComplete)="onComplete($event)"></pf-workflow-renderer>
        } @else {
          <p class="text-[13px]" style="color: var(--text-tertiary);">Loading workflow…</p>
        }
      </pf-tile>

      <!-- Optional draft test list. Reception can stash the tests they
           expect the patient to need here; on check-in those tests get
           auto-attached to a new order. Skipping is fine — order page
           still lets them pick at the counter. -->
      <pf-tile tone="default" padding="lg" class="block mt-4">
        <header class="flex items-baseline justify-between mb-2">
          <h3 class="text-[14px] font-semibold" style="color: var(--text-primary);">
            Draft tests
            <span class="text-[11.5px] font-normal ml-2" style="color: var(--text-tertiary);">
              optional — attach now, auto-apply on check-in
            </span>
          </h3>
          @if (selectedTests().length > 0) {
            <span class="text-[11px] font-mono px-2 py-0.5 rounded-full"
                  style="background: rgba(168,85,247,0.15); color: #c4b5fd;">
              {{ selectedTests().length }} test{{ selectedTests().length === 1 ? '' : 's' }} ·
              ₹{{ selectedTestsTotal() }}
            </span>
          }
        </header>

        <input type="text"
               class="pf-input mb-3"
               placeholder="Search tests by name…"
               [ngModel]="testSearch()"
               (ngModelChange)="setTestSearch($event)" />

        @if (selectedTests().length > 0) {
          <div class="flex flex-wrap gap-2 mb-3">
            @for (t of selectedTests(); track t.id) {
              <span class="inline-flex items-center gap-2 px-2 py-1 rounded-full text-[11.5px]"
                    style="background: rgba(168,85,247,0.12); border: 1px solid rgba(168,85,247,0.30); color: #c4b5fd;">
                {{ t.name }}
                <span class="opacity-70 font-mono">₹{{ t.price }}</span>
                <button type="button" class="bg-transparent border-0 cursor-pointer"
                        style="color: inherit; padding: 0 2px;"
                        aria-label="Remove" (click)="toggleTest(t.id)">×</button>
              </span>
            }
          </div>
        }

        <div class="max-h-[280px] overflow-y-auto rounded-[10px]"
             style="border: 1px solid var(--glass-border); background: var(--glass-bg);">
          @if (filteredTests().length === 0) {
            <p class="text-[12px] text-center py-3" style="color: var(--text-tertiary);">
              No tests match "{{ testSearch() }}"
            </p>
          }
          @for (t of filteredTests(); track t.id) {
            <button type="button"
                    class="w-full grid items-center gap-[10px] py-2 px-3 bg-transparent border-0 cursor-pointer text-left"
                    style="grid-template-columns: 1fr auto 24px; color: var(--text-primary); border-bottom: 1px solid var(--glass-border);"
                    [style.background]="isSelected(t.id) ? 'rgba(168,85,247,0.10)' : 'transparent'"
                    (click)="toggleTest(t.id)">
              <span class="text-[13px]">{{ t.name }}</span>
              <span class="text-[11.5px] font-mono" style="color: var(--text-tertiary);">₹{{ t.price }}</span>
              <span class="inline-flex items-center justify-center rounded-full text-[14px] font-semibold"
                    style="width: 22px; height: 22px;"
                    [style.background]="isSelected(t.id) ? '#a855f7' : 'rgba(168,85,247,0.18)'"
                    [style.color]="isSelected(t.id) ? '#ffffff' : '#c4b5fd'">
                {{ isSelected(t.id) ? '✓' : '+' }}
              </span>
            </button>
          }
        </div>
      </pf-tile>

      <p class="text-[11px] font-mono mt-3 px-1" style="color: var(--text-muted);">
        Config: appointment_booking v{{ record()?.version ?? '—' }}
      </p>
    </section>
  `
})
export class BookAppointmentComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly locationSvc = inject(Location);

  // ── Draft tests stashed on the appointment ─────────────────
  // Reception adds tests during booking; they're stored on the
  // appointment as a CSV of GUIDs (TestIds field). On check-in the
  // backend auto-creates an order with these tests, so the patient
  // skips straight to billing.
  private readonly _selectedTestIds = signal<Set<string>>(new Set());
  private readonly _testSearch = signal('');
  readonly testSearch = this._testSearch.asReadonly();
  setTestSearch(v: string) { this._testSearch.set(v); }

  isSelected(id: string): boolean { return this._selectedTestIds().has(id); }
  toggleTest(id: string) {
    const next = new Set(this._selectedTestIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this._selectedTestIds.set(next);
  }
  readonly selectedTests = computed<Test[]>(() => {
    const ids = this._selectedTestIds();
    return this._tests().filter(t => ids.has(t.id));
  });
  readonly selectedTestsTotal = computed<number>(() =>
    this.selectedTests().reduce((s, t) => s + (Number(t.price) || 0), 0)
  );
  readonly filteredTests = computed<Test[]>(() => {
    const q = this._testSearch().trim().toLowerCase();
    const all = this._tests();
    if (!q) return all.slice(0, 50);
    return all.filter(t => (t.name ?? '').toLowerCase().includes(q)).slice(0, 50);
  });

  private readonly _record = signal<WorkflowConfigRecord | null>(null);
  private readonly _config = signal<WorkflowConfig | null>(null);
  private readonly _tests = signal<Test[]>([]);
  private readonly _prefillPatient = signal<Patient | null>(null);
  private readonly _saving = signal(false);
  protected readonly values = signal<WorkflowFormValues>({});

  readonly record = this._record.asReadonly();
  readonly config = this._config.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly prefillPatient = this._prefillPatient.asReadonly();

  readonly context = computed<WorkflowContext>(() => {
    const user = this.auth.user();
    const p = this._prefillPatient();
    return {
      userId: user?.id,
      tenantId: user?.tenantId,
      branchId: user?.branchId,
      patientId: p?.id,
      patientAge: p?.age,
      patientSex: p?.sex
    };
  });

  readonly resources = computed(() => {
    const p = this._prefillPatient();
    return {
      dataSources: {
        tests: this._tests().map(t => ({ value: t.id, label: `${t.name} — ₹${t.price}` })),
        patients: p ? [{ value: p.id, label: p.displayName ?? "" }] : [],
        doctors: [] as Array<{ value: string; label: string }>,
        // Full clinic day, 15-min granularity. Previously the dropdown
        // only had 9 AM – noon at 30-min steps which made anything
        // outside that window unbookable.
        available_slots: this.buildSlots('07:00', '21:00', 15).map(s => ({ value: s, label: s }))
      }
    };
  });

  readonly initialValues = computed<WorkflowFormValues>(() => {
    const today = new Date().toISOString().slice(0, 10);
    const p = this._prefillPatient();
    return {
      'patient::patient_id': p?.id ?? '',
      'schedule::appointment_date': today
    };
  });

  ngOnInit() {
    this.api.get<Test[]>('/api/tests/').subscribe({ next: l => this._tests.set(l ?? []) });
    this.api.get<WorkflowConfigRecord>('/api/workflows/appointment_booking').subscribe({
      next: r => {
        this._record.set(r);
         try { 
          this._config.set(JSON.parse(r.configJson)); 
        } 
        catch { /* ignore */ }
      }
    });

    // Prefill patient from ?patientId= query param.
    const pid = this.route.snapshot.queryParamMap.get('patientId');
    if (pid) {
      this.api.get<{ patient: Patient }>(`/api/patients/${pid}`).subscribe({
        next: res => this._prefillPatient.set(res.patient),
        error: () => { /* leave empty; user can pick via form */ }
      });
    }
  }

  /** Browser-history back, with the FD landing as the safe fallback when
   *  the user opened this page directly (no prior route). */
  back() {
    if (window.history.length > 1) this.locationSvc.back();
    else this.router.navigateByUrl('/frontdesk');
  }

  /** Generate "HH:MM" slot labels between `start` and `end` (inclusive)
   *  at `stepMin`-minute intervals. */
  private buildSlots(start: string, end: string, stepMin: number): string[] {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const out: string[] = [];
    for (let t = sh * 60 + sm; t <= eh * 60 + em; t += stepMin) {
      const h = Math.floor(t / 60), m = t % 60;
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
    return out;
  }

  onComplete(values: WorkflowFormValues): void {
    if (this._saving()) return;
    const bySteps = splitByStep(values);
    const patientId = (bySteps['patient']?.['patient_id'] as string) || this._prefillPatient()?.id || '';
    if (!patientId) { this.toasts.warning('Patient required'); return; }

    // Guard against past dates — the workflow form's <input type="date">
    // accepts anything by default.
    const apptDateStr = String(bySteps['schedule']?.['appointment_date'] ?? new Date().toISOString().slice(0, 10));
    const todayStr = new Date().toISOString().slice(0, 10);
    if (apptDateStr < todayStr) {
      this.toasts.error("Appointment date can't be in the past — pick today or a future date.");
      return;
    }

    const draftTestIds = Array.from(this._selectedTestIds());
    const body = {
      patientId,
      type: 'appointment',
      collectionType: 'walkin',
      appointmentDate: apptDateStr,
      slotTime: bySteps['schedule']?.['slot_time'] as string | undefined,
      consultationFee: 0,
      refDoctorId: bySteps['doctor']?.['ref_doctor_id'] as string | undefined,
      refDoctorName: bySteps['doctor']?.['ref_doctor_name'] as string | undefined,
      notes: bySteps['notes']?.['notes'] as string | undefined,
      // CSV of test GUIDs — backend stores verbatim on TestIds and
      // re-parses on check-in to spawn the order automatically.
      testIds: draftTestIds.length > 0 ? draftTestIds.join(',') : undefined,
    };

    this._saving.set(true);
    this.api.post<Appointment>('/api/appointments/', body).subscribe({
      next: () => {
        this._saving.set(false);
        this.toasts.success(`Booked for ${patientDisplayName(this._prefillPatient()) || 'patient'}`);
        this.router.navigateByUrl('/frontdesk');
      },
      error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Booking failed'); }
    });
  }
}
