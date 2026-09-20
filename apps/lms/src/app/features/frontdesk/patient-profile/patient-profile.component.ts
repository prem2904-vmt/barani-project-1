import { DatePipe, Location, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ChatService } from '../../../core/services/chat.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderEntryService } from '../../../core/services/order-entry.service';
import { AuthService } from '../../../core/auth/auth.service';
import { Order, OrderTest } from '../../../shared/models/order.model';
import { Patient, patientDisplayName, formatPatientInfo } from '../../../shared/models/patient.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { PatientDocumentsComponent } from './patient-documents.component';
import { PatientIdCardComponent } from './patient-id-card.component';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { LabTrendsComponent } from './lab-trends.component';
import { PatientTimelineService } from './patient-timeline.service';
import { LabOrdersComponent } from './lab-orders.component';
import { AbhaWizardComponent } from '../../../shared/components/abha-wizard/abha-wizard.component';

interface DirectoryUser { id: string; displayName: string; email: string; isActive: boolean; }

interface ProfilePayload {
  patient: Patient;
  history: Order[];
}

/** POST /api/patients/{sourceId}/merge-into/{targetId} response. */
interface MergeResult {
  merged: {
    orders: number;
    bills: number;
    appointments: number;
    messages: number;
    documents: number;
    reports: number;
  };
  sourceDeactivated: boolean;
  targetId: string;
}

export interface Vitals {
  bloodPressure: string;
  pulseRate: number;
  temperature: number;
  spo2: number;
  respiratoryRate: number;
  weight: number;
  height: number;
  bmi: number;
}

export interface OPDRecord {
  id: string;
  date: string;
  doctorName: string;
  department: string;
  symptoms: string[];
  diagnosis: string;
  vitals: Vitals;
  notes: string;
  prescriptions: PrescribedMedicine[];
}

export interface IPDAdmission {
  id: string;
  admissionDate: string;
  dischargeDate: string;
  roomWard: string;
  admittingDoctor: string;
  diagnosis: string;
  reason: string;
  status: 'Admitted' | 'Discharged';
  dailyProgress: { date: string; note: string; doctor: string }[];
  vitalsHistory: { date: string; bp: string; pulse: number; temp: number }[];
}

export interface PrescribedMedicine {
  name: string;
  dosage: string;
  frequency: string;
  instructions: string;
  duration: string;
  status: 'Dispensed' | 'Pending';
  prescribedBy: string;
  date: string;
}

export interface PatientClinicalData {
  vitals: Vitals;
  vitalsHistory: { date: string; bp: string; pulse: number; temp: number; spo2: number }[];
  opdRecords: OPDRecord[];
  ipdAdmissions: IPDAdmission[];
  prescriptions: PrescribedMedicine[];
  bloodGroup: string;
  allergies: string[];
}

function getDeterministicRandom(seedStr: string) {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  let currentSeed = Math.abs(hash) || 1;
  return function() {
    currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
    return currentSeed / 4294967296;
  };
}

const DOCTORS = [
  { name: 'Dr. Sarah Alston', dept: 'Cardiology' },
  { name: 'Dr. Rajesh Kumar', dept: 'General Medicine' },
  { name: 'Dr. Emily Watson', dept: 'Pediatrics' },
  { name: 'Dr. David Miller', dept: 'Orthopedics' },
  { name: 'Dr. Priya Nair', dept: 'Pulmonology' },
  { name: 'Dr. Amit Patel', dept: 'Endocrinology' }
];

const SYMPTOMS_DIAGNOSES = [
  {
    symptoms: ['Dry Cough', 'Shortness of Breath', 'Wheezing', 'Mild Fever'],
    diagnosis: 'Acute Bronchitis & Reactive Airway',
    notes: 'Patient reports chest congestion and dry cough worsening at night. Normal oxygen saturation. Prescribed bronchodilators and a short course of antibiotics.',
    meds: [
      { name: 'Salbutamol Inhaler', dosage: '2 puffs', frequency: 'As needed / every 6h', instructions: 'Inhalation', duration: '10 Days' },
      { name: 'Azithromycin 500mg', dosage: '1-0-0', frequency: 'Once daily', instructions: 'Before food', duration: '3 Days' },
      { name: 'Levosalbutamol Syrup', dosage: '5 ml', frequency: 'Twice daily', instructions: 'After food', duration: '5 Days' }
    ]
  },
  {
    symptoms: ['Knee Joint Pain', 'Lower Back Stiffness', 'Muscle Fatigue'],
    diagnosis: 'Vitamin D Deficiency & Joint Strain',
    notes: 'Reports localized stiffness in knee joints, aggravated in mornings. Advised physiotherapy and Calcium + Vitamin D supplements.',
    meds: [
      { name: 'Vitamin D3 60K UI', dosage: 'Weekly', frequency: 'Once a week', instructions: 'With milk', duration: '8 Weeks' },
      { name: 'Calcium Carbonate 500mg', dosage: '0-0-1', frequency: 'Once daily', instructions: 'After food', duration: '30 Days' },
      { name: 'Aceclofenac 100mg', dosage: '1-0-1', frequency: 'Twice daily', instructions: 'After food (sos)', duration: '10 Days' }
    ]
  },
  {
    symptoms: ['Throbbing Head Pain', 'Sensitivity to Light', 'Nausea', 'Visual Aura'],
    diagnosis: 'Classic Migraine',
    notes: 'Triggered by sleep deprivation and stress. Advised rest in a dark quiet room during acute attacks.',
    meds: [
      { name: 'Naproxen 500mg', dosage: '1-0-1', frequency: 'Twice daily', instructions: 'After food', duration: '5 Days' },
      { name: 'Domperidone 10mg', dosage: '1-0-1', frequency: 'Twice daily', instructions: 'Before food', duration: '5 Days' }
    ]
  }
];

@Component({
  selector: 'pf-patient-profile',
  standalone: true,
  imports: [DatePipe, FormsModule, CurrencyInrPipe, AvatarComponent, ChipComponent, SkeletonComponent, CommonModule, PatientDocumentsComponent, PatientIdCardComponent, BarcodeDisplayComponent, LabTrendsComponent, LabOrdersComponent, AbhaWizardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './patient-profile.component.html',
  styleUrls: ['./patient-profile.component.scss']
})
export class PatientProfileComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly entitlements = inject(TenantEntitlementsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly orderEntry = inject(OrderEntryService);
  private readonly locationSvc = inject(Location);
  private readonly chat = inject(ChatService);
  private readonly dialog = inject(DialogService);
  protected readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  protected readonly navBack = inject(NavBackService);

  private readonly _patient = signal<Patient | null>(null);
  private readonly _history = signal<Order[]>([]);
  private readonly _loading = signal(false);
  readonly patient = this._patient.asReadonly();
  readonly history = this._history.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly showIdCard = signal(false);
  // Trendogram (serial-result charts) shown on demand from the Lab Orders
  // corner toggle — hidden by default so it isn't mandatory.
  readonly showTrendogram = signal(false);
  /** Full-screen Patient Timeline overlay (rendered at shell root). */
  readonly patientTimeline = inject(PatientTimelineService);
  /** ABHA (ABDM) create/verify wizard. */
  readonly abhaWizardOpen = signal(false);
  onAbhaDone(updated: Patient) {
    if (updated) this._patient.set({ ...(this._patient() ?? {} as Patient), ...updated });
    this.abhaWizardOpen.set(false);
    this.toasts.success('ABHA linked & verified');
  }
  // Top-bar overflow menu (secondary actions) + on-demand QR popover — the QR
  // is no longer always shown; it's behind "Show QR" in the menu.
  readonly moreOpen = signal(false);
  readonly qrOpen = signal(false);
  toggleMore() { this.moreOpen.update(v => !v); }
  closeMore() { this.moreOpen.set(false); }
  readonly qrValue = computed(() => {
    const p = this._patient();
    if (!p) return '';
    const origin = typeof location !== 'undefined' ? location.origin : '';
    return `${origin}/p/${p.id}`;
  });
  readonly displayName = computed(() => patientDisplayName(this._patient()));
  protected readonly formatPatient = formatPatientInfo;

  // ── ABHA health card (real ABDM card look) ──────────────────────────────
  /** 14-digit ABHA as the official 2-4-4-4 grouping, e.g. 91-6723-6210-7704. */
  readonly abhaFormatted = computed(() => {
    const id = (this._patient()?.abhaId || '').replace(/\D/g, '');
    return id.length === 14
      ? `${id.slice(0, 2)}-${id.slice(2, 6)}-${id.slice(6, 10)}-${id.slice(10, 14)}`
      : (this._patient()?.abhaId || '—');
  });
  /** Card QR — encodes the ABHA in the same shape our registration prefill reads
   *  (hidn/hid/name/gender/dob/mobile) so scanning this card round-trips. */
  readonly abhaQrValue = computed(() => {
    const p = this._patient();
    if (!p?.abhaId) return '';
    return JSON.stringify({
      hidn: (p.abhaId || '').replace(/\D/g, ''),
      hid: p.abhaAddress || this.kyc()?.abhaAddress || '',
      name: patientDisplayName(p),
      gender: p.sex || '',
      dob: p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : '',
      mobile: p.phone || ''
    });
  });
  /** Two-letter initials for the card photo placeholder. */
  readonly initials = computed(() => {
    const parts = this.displayName().trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  });
  /** 12 rotations × a full-diameter line = the Ashoka Chakra's 24 spokes. */
  protected readonly chakraSpokes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  /** Address / KYC details captured from ABHA into the patient's attributes JSON
   *  (the registration form has no columns for these). null when none present. */
  readonly kyc = computed(() => {
    const raw = this._patient()?.attributes;
    if (!raw) return null;
    let a: Record<string, unknown>;
    try { a = JSON.parse(raw); } catch { return null; }
    const pick = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim()) ? (a[k] as string).trim() : undefined;
    const d = {
      address: pick('address'),
      pincode: pick('pincode'),
      district: pick('district'),
      state: pick('state'),
      abhaAddress: pick('abhaAddress')
    };
    return (d.address || d.pincode || d.district || d.state || d.abhaAddress) ? d : null;
  });
  /** ABHA address for the card — the column, falling back to the KYC attribute. */
  readonly cardAbhaAddress = computed(() => this._patient()?.abhaAddress || this.kyc()?.abhaAddress || '');
  /** ABHA KYC photo (data URL) if captured into attributes; else null → silhouette. */
  readonly abhaPhoto = computed(() => {
    const raw = this._patient()?.attributes;
    if (!raw) return null;
    let a: Record<string, unknown>;
    try { a = JSON.parse(raw); } catch { return null; }
    const p = a['abhaPhoto'] ?? a['photo'];
    if (typeof p !== 'string' || !p.trim()) return null;
    return p.startsWith('data:') ? p : `data:image/jpeg;base64,${p}`;
  });

  readonly copied = signal(false);

  copyToClipboard(text: string | undefined) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
      this.toasts.success('Patient ID copied to clipboard');
    }).catch(() => {
      this.toasts.error('Failed to copy to clipboard');
    });
  }

  /** "37y" — a DOB (real or synthesized from an entered age, anchored to the
   *  registration date) always wins so the age stays live and increments; falls
   *  back to a stored static age, else "—". */
  ageLabel(p: Patient): string {
    const yrs = p.dateOfBirth ? this.ageFromDob(p.dateOfBirth) : (p.age ?? null);
    return yrs == null ? '—' : `${yrs}y`;
  }
  private ageFromDob(dob: string | undefined): number | null {
    if (!dob) return null;
    const d = new Date(dob);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
    return Math.max(0, a);
  }

  // ── Edit patient info ─────────────────────────────────────────────
  readonly canEdit = computed(() => this.auth.hasAnyPermission(['edit_patient', 'register_patient']));
  // Common groups first, then the rarer sub-types that were previously
  // impossible to record (OPS-30), then a free-text escape hatch.
  readonly bloodGroups = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-',
    'A1+', 'A1-', 'A1B+', 'A1B-', 'Bombay (hh)', 'Rh-null', 'Other'];
  private readonly _editDraft = signal<{
    firstName: string; fathersName: string; phone: string; email: string;
    sex: string; dateOfBirth: string; age: number | null; bloodGroup: string;
  } | null>(null);
  readonly editDraft = this._editDraft.asReadonly();
  readonly savingEdit = signal(false);

  openEdit(p: Patient) {
    this.router.navigate(['/frontdesk/patients/new'], { queryParams: { patientId: p.id } });
  }
  patchEdit(patch: Partial<NonNullable<ReturnType<typeof this.editDraft>>>) {
    this._editDraft.update(d => d ? { ...d, ...patch } : d);
  }
  closeEdit() { this._editDraft.set(null); }

  async saveEdit() {
    const d = this._editDraft();
    const p = this._patient();
    if (!d || !p || this.savingEdit()) return;
    if (!d.firstName.trim()) { this.toasts.warning('First name is required'); return; }
    this.savingEdit.set(true);
    // Empty-string clears (sent as null where the API treats null = no-change,
    // so for clearable text we send '' which the patch applies verbatim).
    // Hybrid DOB/age: a DOB wins; an age-only entry becomes a synthetic DOB
    // anchored to today so the displayed age increments over time.
    let dobIso = d.dateOfBirth ? new Date(d.dateOfBirth).toISOString() : undefined;
    let ageOut: number | undefined = d.age != null && `${d.age}` !== '' ? Number(d.age) : undefined;
    if (!dobIso && ageOut != null && Number.isFinite(ageOut) && ageOut >= 0 && ageOut < 150) {
      const a = new Date(); a.setHours(0, 0, 0, 0); a.setFullYear(a.getFullYear() - ageOut);
      dobIso = a.toISOString();
    }
    if (dobIso) ageOut = undefined; // DOB present → recompute age from it (stays live)
    const body = {
      firstName: d.firstName.trim(),
      fathersName: d.fathersName.trim(),
      phone: d.phone.trim(),
      email: d.email.trim(),
      sex: d.sex || undefined,
      dateOfBirth: dobIso,
      age: ageOut,
      bloodGroup: d.bloodGroup ?? '',
    };
    try {
      const updated = await firstValueFrom(this.api.patch<Patient>(`/api/patients/${p.id}`, body));
      if (updated) this._patient.set(updated);
      this.toasts.success('Patient updated');
      this._editDraft.set(null);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.savingEdit.set(false);
    }
  }

  // Active Tab state
  protected readonly activeTab = signal<string>('overview');
  // Expanded timelines state for the visits
  protected readonly expandedVisits = signal<Record<string, boolean>>({});
  // Clinical data signal
  protected readonly clinicalData = signal<PatientClinicalData | null>(null);

  // Send-to-chat colleague picker state.
  protected readonly chatPickerOpen = signal(false);
  protected readonly chatPickerSearch = signal('');
  protected readonly chatPickerUsers = signal<DirectoryUser[]>([]);
  protected readonly chatPickerSending = signal(false);
  protected readonly chatPickerFiltered = computed(() => {
    const term = this.chatPickerSearch().toLowerCase().trim();
    const me = this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
    const all = this.chatPickerUsers().filter(u => u.id !== me && u.isActive);
    return term
      ? all.filter(u => u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
      : all;
  });

  // Dynamic health analysis notes based on vitals
  readonly healthStatusNotes = computed(() => {
    const data = this.clinicalData();
    if (!data) return 'No vitals recorded.';
    const bpVal = data.vitals.bloodPressure;
    const pulse = data.vitals.pulseRate;
    const temp = data.vitals.temperature;

    const notes: string[] = [];
    const bpParts = bpVal.split('/');
    if (bpParts.length === 2) {
      const sys = Number(bpParts[0]);
      const dia = Number(bpParts[1]);
      if (sys >= 140 || dia >= 90) {
        notes.push('Elevated BP: Hypertension observed. Low sodium diet advised.');
      } else if (sys >= 130 || dia >= 80) {
        notes.push('Elevated BP: Pre-hypertension noted. Regular monitoring recommended.');
      } else if (sys < 90 || dia < 60) {
        notes.push('Low BP: Hypotension indicators present.');
      } else {
        notes.push('BP: Blood pressure is within optimal limits.');
      }
    }
    
    if (pulse > 100) {
      notes.push('Heart Rate: Tachycardia indicators (resting rate > 100 bpm).');
    } else if (pulse < 60) {
      notes.push('Heart Rate: Bradycardia indicators (resting rate < 60 bpm).');
    } else {
      notes.push('Heart Rate: Pulse is normal and steady.');
    }

    if (temp > 99.5) {
      notes.push('Temperature: Low-grade fever detected. Check symptoms log.');
    }

    return notes.join(' · ');
  });

  // Helper for BMI meter
  getBmiDetails(bmi: number): { label: string; tone: string; color: string; pct: number } {
    if (bmi < 18.5) return { label: 'Underweight', tone: 'sky', color: '#38bdf8', pct: Math.min(Math.max((bmi / 18.5) * 25, 5), 24) };
    if (bmi >= 18.5 && bmi < 25) return { label: 'Normal Weight', tone: 'emerald', color: '#34d399', pct: 25 + ((bmi - 18.5) / 6.5) * 25 };
    if (bmi >= 25 && bmi < 30) return { label: 'Overweight', tone: 'amber', color: '#fbbf24', pct: 50 + ((bmi - 25) / 5) * 25 };
    return { label: 'Obese', tone: 'rose', color: '#f87171', pct: 75 + Math.min(((bmi - 30) / 15) * 25, 20) };
  }

  // Unified visit timeline (OPD, IPD, Labs merged chronologically)
  readonly unifiedTimeline = computed(() => {
    const list: Array<{
      type: 'opd' | 'ipd' | 'lab';
      date: string;
      id: string;
      title: string;
      subtitle: string;
      status: string;
      amount?: number;
      doctor?: string;
      data: any;
    }> = [];

    // Add actual lab orders
    const historyData = this.history();
    for (const o of historyData) {
      const tests = this.orderTests(o);
      list.push({
        type: 'lab',
        date: o.createdAt,
        id: o.id,
        title: `Lab Diagnostics (${tests.length} test${tests.length === 1 ? '' : 's'})`,
        subtitle: `${o.collectionType} · Ref: ${o.refDoctorName || 'Self Referral'}`,
        status: o.status,
        amount: o.totalAmount,
        doctor: o.refDoctorName,
        data: o
      });
    }

    // Add OPD records
    const clinical = this.clinicalData();
    if (clinical) {
      for (const opd of clinical.opdRecords) {
        list.push({
          type: 'opd',
          date: opd.date,
          id: opd.id,
          title: `OPD Consultation: ${opd.diagnosis}`,
          subtitle: `${opd.doctorName} · Dept: ${opd.department}`,
          status: 'completed',
          doctor: opd.doctorName,
          data: opd
        });
      }

      // Add IPD admissions
      for (const ipd of clinical.ipdAdmissions) {
        list.push({
          type: 'ipd',
          date: ipd.admissionDate,
          id: ipd.id,
          title: `IPD Hospitalization: ${ipd.diagnosis}`,
          subtitle: `${ipd.admittingDoctor} · Room: ${ipd.roomWard}`,
          status: ipd.status,
          doctor: ipd.admittingDoctor,
          data: ipd
        });
      }
    }

    // Sort by date descending
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  // ── Real KPIs derived from the patient's actual lab history ─────────
  readonly realVisits = computed(() => this.history().length);
  readonly realTotalSpent = computed(() =>
    this.history().reduce((sum, o) => sum + (o.totalAmount ?? 0), 0));
  readonly realTestsDone = computed(() =>
    this.history().reduce((sum, o) => sum + this.orderTests(o).length, 0));
  readonly realLastVisit = computed(() => {
    const times = this.history().map(o => new Date(o.createdAt).getTime()).filter(n => !isNaN(n));
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
  });

  ngOnInit() {
    this.route.paramMap.subscribe(map => {
      const id = map.get('id');
      if (id) this.load(id);
    });
  }

  statusTone(status: string): ChipTone {
    switch (status) {
      case 'completed':    return 'emerald';
      case 'billed':       return 'amber';
      case 'cancelled':    return 'rose';
      case 'in_progress':  return 'violet';
      default:             return 'default';
    }
  }

  testStatusTone(status: string): ChipTone {
    switch (status) {
      case 'validated':
      case 'completed':
      case 'reported':   return 'emerald';
      case 'rejected':   return 'rose';
      case 'in_progress':
      case 'resulted':   return 'violet';
      case 'pending':    return 'amber';
      default:           return 'default';
    }
  }

  orderTests(o: Order): OrderTest[] {
    const tests: OrderTest[] = [];
    for (const s of o.samples ?? []) {
      for (const t of s.tests ?? []) tests.push(t);
    }
    return tests;
  }

  back() {
    this.navBack.backTo('/frontdesk');
  }

  startOrder(p: Patient) {
    // Routes lab/OPD by module scope; 'lab' (today's default) → order-create.
    void this.orderEntry.startNewOrder(p.id);
  }

  /** Re-order the same tests from a prior order. Routes through order-create
   *  with `?fromOrderId=…` (preselectFromOrder seeds the cart), where the
   *  receptionist confirms/edits before creating the order → billing. */
  repeatOrder(o: Order) {
    const patientId = (o as { patientId?: string }).patientId || this.patient()?.id;
    if (!patientId) return;
    this.router.navigate(['/frontdesk/order'], {
      queryParams: { patientId, fromOrderId: o.id }
    });
  }

  bookAppointment(p: Patient) {
    this.router.navigate(['/frontdesk/appointments/new'], { queryParams: { patientId: p.id } });
  }

  // Visit expand toggle
  toggleVisitExpand(id: string) {
    const prev = this.expandedVisits();
    this.expandedVisits.set({
      ...prev,
      [id]: !prev[id]
    });
  }

  // Get status color tone for vitals
  getVitalStatus(type: string, value: number | string): 'emerald' | 'amber' | 'rose' {
    if (type === 'heartRate') {
      const num = Number(value);
      if (num >= 60 && num <= 100) return 'emerald';
      if ((num >= 50 && num < 60) || (num > 100 && num <= 115)) return 'amber';
      return 'rose';
    }
    if (type === 'spo2') {
      const num = Number(value);
      if (num >= 95) return 'emerald';
      if (num >= 91 && num <= 94) return 'amber';
      return 'rose';
    }
    if (type === 'temp') {
      const num = Number(value);
      if (num >= 97.0 && num <= 99.1) return 'emerald';
      if ((num >= 95.5 && num < 97.0) || (num > 99.1 && num <= 100.4)) return 'amber';
      return 'rose';
    }
    if (type === 'respRate') {
      const num = Number(value);
      if (num >= 12 && num <= 20) return 'emerald';
      if ((num >= 9 && num < 12) || (num > 20 && num <= 24)) return 'amber';
      return 'rose';
    }
    if (type === 'bmi') {
      const num = Number(value);
      if (num >= 18.5 && num < 25) return 'emerald';
      if (num >= 25 && num < 30) return 'amber';
      return 'rose';
    }
    if (type === 'bp') {
      const parts = String(value).split('/');
      if (parts.length === 2) {
        const sys = Number(parts[0]);
        const dia = Number(parts[1]);
        if (sys >= 90 && sys < 130 && dia >= 60 && dia < 85) return 'emerald';
        if ((sys >= 130 && sys < 140) || (dia >= 85 && dia < 90)) return 'amber';
      }
      return 'rose';
    }
    return 'emerald';
  }

  // ── Send-to-chat ──────────────────────────────────────────────────

  async openChatPicker(): Promise<void> {
    this.chatPickerOpen.set(true);
    this.chatPickerSearch.set('');
    if (this.chatPickerUsers().length === 0) {
      try {
        const users = await firstValueFrom(
          this.api.get<DirectoryUser[]>('/api/directory/users'));
        this.chatPickerUsers.set(users ?? []);
      } catch {
        this.toasts.error('Could not load directory.');
      }
    }
  }
  closeChatPicker(): void {
    this.chatPickerOpen.set(false);
    this.chatPickerSending.set(false);
  }

  async sendPatientToColleague(u: DirectoryUser): Promise<void> {
    const p = this.patient();
    if (!p) return;
    this.chatPickerSending.set(true);
    try {
      const label = `${this.displayName()}${p.mrn ? ' · ' + p.mrn : ''}`;
      await this.chat.sharePatientWithUser(u.id, p.id, label);
      this.toasts.info(`Sent ${this.displayName()} to ${u.displayName}`);
      this.closeChatPicker();
      this.router.navigate(['/messages']);
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    } finally {
      this.chatPickerSending.set(false);
    }
  }

  // ── Merge duplicate into this patient ─────────────────────────────
  // Search the same /api/patients?q= endpoint the app uses everywhere, pick
  // the DUPLICATE (source), confirm (danger), then POST merge-into with THIS
  // profile as the target. The duplicate's history moves here and the
  // duplicate record is deactivated server-side.

  protected readonly mergeOpen = signal(false);
  protected readonly mergeSearch = signal('');
  protected readonly mergeResults = signal<Patient[]>([]);
  protected readonly merging = signal(false);

  displayOf(p: Patient): string { return patientDisplayName(p); }

  openMerge(): void {
    this.mergeOpen.set(true);
    this.mergeSearch.set('');
    this.mergeResults.set([]);
  }
  closeMerge(): void {
    if (this.merging()) return;
    this.mergeOpen.set(false);
  }

  onMergeSearch(q: string): void {
    this.mergeSearch.set(q);
    const term = q.trim();
    if (!term) { this.mergeResults.set([]); return; }
    this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(term)}`).subscribe({
      next: list => {
        const targetId = this.patient()?.id;
        // Can't merge a record into itself — drop the open profile from results.
        this.mergeResults.set((list ?? []).filter(p => p.id !== targetId));
      },
      error: () => this.mergeResults.set([])
    });
  }

  async mergeFrom(source: Patient): Promise<void> {
    const target = this.patient();
    if (!target || this.merging()) return;
    const ok = await this.dialog.confirm({
      title: `Merge ${patientDisplayName(source)} into ${this.displayName()}?`,
      message: 'All orders, bills and appointments of the duplicate move into this record, '
        + 'and the duplicate is deactivated. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Merge records',
    });
    if (!ok) return;
    this.merging.set(true);
    try {
      const res = await firstValueFrom(
        this.api.post<MergeResult>(`/api/patients/${source.id}/merge-into/${target.id}`, {}));
      const m = res?.merged;
      this.toasts.success(m
        ? `Merged ${m.orders} order${m.orders === 1 ? '' : 's'}, `
          + `${m.bills} bill${m.bills === 1 ? '' : 's'}, `
          + `${m.appointments} appointment${m.appointments === 1 ? '' : 's'} into this record`
        : 'Patients merged');
      this.mergeOpen.set(false);
      this.load(target.id); // refresh — history now includes the moved records
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.merging.set(false);
    }
  }

  private load(id: string) {
    this._loading.set(true);
    this.api.get<ProfilePayload>(`/api/patients/${id}`).subscribe({
      next: res => {
        this._patient.set(res.patient);
        this._history.set(res.history ?? []);
        if (res.patient) {
          this.clinicalData.set(this.loadClinicalData(res.patient.id));
        } else {
          this.clinicalData.set(null);
        }
        this._loading.set(false);
      },
      error: () => {
        this.clinicalData.set(null);
        this._loading.set(false);
      }
    });
  }

  // Generates deterministic mock data using a seed based on the patientId
  private loadClinicalData(patientId: string): PatientClinicalData {
    const nextRand = getDeterministicRandom(patientId);

    // Blood Group
    const bloodGroups = ['A+ve', 'O+ve', 'B+ve', 'AB+ve', 'A-ve', 'O-ve', 'B-ve', 'AB-ve'];
    const bloodGroup = bloodGroups[Math.floor(nextRand() * bloodGroups.length)];

    // Allergies
    const allAllergies = ['Penicillin', 'Sulfa Drugs', 'Aspirin', 'Peanuts', 'Tree Nuts', 'Seafood', 'Shellfish', 'Soy', 'Wheat', 'Latex'];
    const hasAllergies = nextRand() > 0.4;
    const allergies: string[] = [];
    if (hasAllergies) {
      const numAllergies = Math.floor(nextRand() * 2) + 1;
      for (let i = 0; i < numAllergies; i++) {
        const alg = allAllergies[Math.floor(nextRand() * allAllergies.length)];
        if (!allergies.includes(alg)) allergies.push(alg);
      }
    }

    // Generate Vitals
    const weight = Math.round(50 + nextRand() * 40); // 50 to 90 kg
    const height = Math.round(150 + nextRand() * 35); // 150 to 185 cm
    const bmi = parseFloat((weight / Math.pow(height / 100, 2)).toFixed(1));

    const vitals: Vitals = {
      bloodPressure: `${Math.round(112 + nextRand() * 18)}/${Math.round(72 + nextRand() * 12)}`,
      pulseRate: Math.round(62 + nextRand() * 30),
      temperature: parseFloat((97.4 + nextRand() * 2.0).toFixed(1)),
      spo2: Math.round(96 + nextRand() * 3),
      respiratoryRate: Math.round(14 + nextRand() * 5),
      weight,
      height,
      bmi
    };

    // Generate OPD Records
    const numOpd = Math.floor(nextRand() * 3) + 2; // 2 to 4 records
    const opdRecords: OPDRecord[] = [];
    const prescriptions: PrescribedMedicine[] = [];
    const vitalsHistory: { date: string; bp: string; pulse: number; temp: number; spo2: number }[] = [];

    const baseDate = new Date();

    for (let i = 0; i < numOpd; i++) {
      const dateOffsetDays = (i + 1) * (15 + Math.floor(nextRand() * 30)); // every 15-45 days
      const recordDate = new Date(baseDate.getTime() - dateOffsetDays * 24 * 60 * 60 * 1000);
      const dateStr = recordDate.toISOString();

      const doc = DOCTORS[Math.floor(nextRand() * DOCTORS.length)];
      const diagData = SYMPTOMS_DIAGNOSES[Math.floor(nextRand() * SYMPTOMS_DIAGNOSES.length)];

      const recordVitals: Vitals = {
        bloodPressure: `${Math.round(110 + nextRand() * 20)}/${Math.round(70 + nextRand() * 15)}`,
        pulseRate: Math.round(60 + nextRand() * 35),
        temperature: parseFloat((97.5 + nextRand() * 2.2).toFixed(1)),
        spo2: Math.round(95 + nextRand() * 5),
        respiratoryRate: Math.round(14 + nextRand() * 6),
        weight: weight + Math.round(-2 + nextRand() * 4),
        height,
        bmi
      };

      vitalsHistory.push({
        date: dateStr,
        bp: recordVitals.bloodPressure,
        pulse: recordVitals.pulseRate,
        temp: recordVitals.temperature,
        spo2: recordVitals.spo2
      });

      const opdRecordMeds: PrescribedMedicine[] = diagData.meds.map(m => {
        const status = nextRand() > 0.35 ? 'Dispensed' : 'Pending';
        return {
          name: m.name,
          dosage: m.dosage,
          frequency: m.frequency,
          instructions: m.instructions,
          duration: m.duration,
          status,
          prescribedBy: doc.name,
          date: dateStr
        };
      });

      prescriptions.push(...opdRecordMeds);

      opdRecords.push({
        id: `OPD-${100000 + Math.floor(nextRand() * 900000)}`,
        date: dateStr,
        doctorName: doc.name,
        department: doc.dept,
        symptoms: diagData.symptoms,
        diagnosis: diagData.diagnosis,
        vitals: recordVitals,
        notes: diagData.notes,
        prescriptions: opdRecordMeds
      });
    }

    // Generate IPD Admissions (35% chance)
    const ipdAdmissions: IPDAdmission[] = [];
    if (nextRand() > 0.65) {
      const dateOffsetDays = 120 + Math.floor(nextRand() * 150);
      const admissionDate = new Date(baseDate.getTime() - dateOffsetDays * 24 * 60 * 60 * 1000);
      const dischargeDays = 3 + Math.floor(nextRand() * 6);
      const dischargeDate = new Date(admissionDate.getTime() + dischargeDays * 24 * 60 * 60 * 1000);

      const doc = DOCTORS[Math.floor(nextRand() * DOCTORS.length)];
      const diagData = SYMPTOMS_DIAGNOSES[Math.floor(nextRand() * SYMPTOMS_DIAGNOSES.length)];

      const roomWard = `Ward ${Math.floor(nextRand() * 4) + 1}A · Bed ${Math.floor(nextRand() * 15) + 201}`;

      const progressNotes = [
        { day: 1, note: 'Admitted with acute conditions. IV line secured, fluids started. Placed on vitals monitoring.', doctor: doc.name },
        { day: 2, note: 'Condition stable. Responding to drug therapy. Oral intake started.', doctor: doc.name },
        { day: 3, note: 'Symptomatically better. Mobile and active. Advised deep breathing exercises.', doctor: 'Dr. Sarah Alston' },
        { day: 4, note: 'Fully recovered. Vitals normalized. Discharged with oral prescriptions.', doctor: doc.name }
      ];

      const dailyProgress = progressNotes.slice(0, Math.min(dischargeDays, progressNotes.length)).map(pn => {
        const noteDate = new Date(admissionDate.getTime() + pn.day * 24 * 60 * 60 * 1000);
        return {
          date: noteDate.toISOString(),
          note: pn.note,
          doctor: pn.doctor
        };
      });

      const ipdVitalsHistory = Array.from({ length: Math.min(dischargeDays, 4) }).map((_, vIdx) => {
        const vDate = new Date(admissionDate.getTime() + vIdx * 24 * 60 * 60 * 1000);
        return {
          date: vDate.toISOString(),
          bp: `${Math.round(112 + nextRand() * 12)}/${Math.round(72 + nextRand() * 10)}`,
          pulse: Math.round(65 + nextRand() * 15),
          temp: parseFloat((97.8 + nextRand() * 1.6).toFixed(1))
        };
      });

      ipdAdmissions.push({
        id: `IPD-${200000 + Math.floor(nextRand() * 800000)}`,
        admissionDate: admissionDate.toISOString(),
        dischargeDate: dischargeDate.toISOString(),
        roomWard,
        admittingDoctor: doc.name,
        diagnosis: diagData.diagnosis,
        reason: `Admitted for acute therapeutic intervention of ${diagData.diagnosis} with complaints of persistent symptoms.`,
        status: 'Discharged',
        dailyProgress,
        vitalsHistory: ipdVitalsHistory
      });
    }

    return {
      vitals,
      vitalsHistory,
      opdRecords,
      ipdAdmissions,
      prescriptions,
      bloodGroup,
      allergies
    };
  }
}
