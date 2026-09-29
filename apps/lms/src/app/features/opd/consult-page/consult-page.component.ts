import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { busyWhile } from '../../../shared/utils/busy';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';
import { Patient, formatPatientInfo } from '../../../shared/models/patient.model';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConsultDoctor, ConsultDraft } from '../../../shared/opd/consult';
import { NavBackService } from '../../../core/services/nav-back.service';

/**
 * OPD consult screen. The separate, non-lab screen the "new order" fork routes
 * to when the user is working in OPD. Deliberately MIRRORS the lab order-create
 * frame (screen header → patient + referring controls row → left work area →
 * right cart/fee rail) so it reads as the same app screen — but it imports
 * nothing from the lab feature and never touches order-create.
 *
 * The consultation content (doctor + fee) is the seam the owner is specifying;
 * persistence (as an Order with Module='opd') + the branch doctor list arrive
 * in later slices. Reuses the copied order-create stylesheet for an exact frame.
 */
@Component({
  selector: 'pf-consult-page',
  standalone: true,
  imports: [FormsModule, AvatarComponent, ScreenHeaderComponent, PatientSearchComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './consult-page.component.html',
  styleUrl: './consult-page.component.scss',
})
export class ConsultPageComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly toasts = inject(ToastService);

  protected readonly formatPatient = formatPatientInfo;

  private readonly _patient = signal<Patient | null>(null);
  readonly patient = this._patient.asReadonly();
  readonly isChangingPatient = signal(false);

  /** Doctors pickable at the current branch — empty until the doctor-onboarding
   *  slice lands. */
  readonly doctors = signal<ConsultDoctor[]>([]);
  readonly doctorId = signal<string | null>(null);
  readonly fee = signal<number>(0);

  readonly total = computed(() => this.fee());
  readonly canSubmit = computed(() => !!this._patient() && !!this.doctorId());
  /** Create-consultation request in flight (busy button, no double create). */
  readonly submitting = signal(false);

  constructor() {
    // Real doctors for the picker — users with a DoctorProfile (captured at user
    // creation with a doctor-type role).
    this.api.get<ConsultDoctor[]>('/api/doctors').subscribe({
      next: docs => this.doctors.set(docs ?? []),
      error: () => { /* silent — picker just shows "none onboarded" */ },
    });

    // Deep-link: ?patientId= (from the fork / a patient's "New order") pre-fills
    // the patient. Best-effort — the search still works if the fetch fails.
    const pid = this.route.snapshot.queryParamMap.get('patientId');
    if (pid) {
      this.api.get<Patient>(`/api/patients/${pid}`).subscribe({
        next: p => { if (p) this._patient.set(p); },
        error: () => { /* silent — user can search */ },
      });
    }
  }

  attachPatient(p: Patient) {
    if (!p) return;
    this._patient.set(p);
    this.isChangingPatient.set(false);
  }
  changePatient() { this.isChangingPatient.set(true); }
  cancelChangePatient() { this.isChangingPatient.set(false); }

  onDoctor(id: string) {
    this.doctorId.set(id || null);
    // Auto-fill the doctor's default fee (front desk can still override).
    const doc = this.doctors().find(d => d.id === id);
    if (doc && typeof doc.fee === 'number') this.fee.set(doc.fee);
  }
  onFee(raw: string) {
    const n = Number(raw);
    this.fee.set(Number.isFinite(n) && n >= 0 ? n : 0);
  }

  submit() {
    if (!this.canSubmit() || this.submitting()) return;
    const patient = this._patient();
    if (!patient) return;
    // Creates the consultation → the doctor's token queue. Billing (Order
    // Module='opd' + follow-up discount) attaches in the next slice.
    this.api.post<{ token: number }>('/api/opd/consultations', {
      patientId: patient.id,
      doctorUserId: this.doctorId(),
      fee: this.fee(),
    }).pipe(busyWhile(this.submitting)).subscribe({
      next: c => {
        this.toasts.success(c?.token ? `Consultation created — token ${c.token}` : 'Consultation created');
        this.back();
      },
      error: () => this.toasts.error('Could not create the consultation'),
    });
  }

  back() { this.navBack.backTo('/frontdesk'); }
}
