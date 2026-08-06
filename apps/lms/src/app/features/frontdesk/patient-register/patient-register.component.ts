import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  WorkflowRendererComponent,
  splitByStorage
} from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import { Patient } from '../../../shared/models/patient.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { AbhaWizardComponent } from '../../../shared/components/abha-wizard/abha-wizard.component';
import { AbhaPrefillComponent, AbhaPrefillData } from '../../../shared/components/abha-wizard/abha-prefill.component';
import { WorkflowConfig, WorkflowConfigRecord, WorkflowContext, WorkflowFormValues } from '../../../shared/models/workflow.model';

@Component({
  selector: 'pf-patient-register',
  standalone: true,
  imports: [
    WorkflowRendererComponent,
    ScreenHeaderComponent,
    TileComponent,
    LoadingLogoComponent,
    AbhaWizardComponent,
    AbhaPrefillComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-register-page px-3 sm:px-4 md:px-8 pt-5 sm:pt-6 pb-10">

      <pf-screen-header
        eyebrow="Frontdesk · Registration"
        [title]="patientId() ? 'Edit Patient Details' : 'Register Patient'"
        subtitle="Capture the patient's details — name, contact, ID, and any extras you collect.">
      </pf-screen-header>

      @if (!patientId() && config()) {
        <div class="flex items-center justify-between gap-3 flex-wrap mb-3 px-3.5 py-3 rounded-xl"
             style="background: linear-gradient(135deg, rgba(124,58,237,0.12), rgba(168,85,247,0.08)); border: 1px solid rgba(168,85,247,0.28);">
          <div class="min-w-0 flex items-center gap-2.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <div class="min-w-0">
              <span class="text-sm font-bold text-[var(--text-primary)]">ABHA (Health ID)</span>
              <p class="text-xs text-[var(--text-tertiary)]">Has an ABHA? Fetch their KYC to auto-fill. No ABHA? Create one — it fills the form and registers together.</p>
            </div>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <button type="button" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-violet-500/40 hover:bg-violet-600/10 text-[var(--text-primary)] text-xs font-bold cursor-pointer transition-colors"
                    (click)="openAbhaPrefill('create')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              Create ABHA
            </button>
            <button type="button" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer transition-colors"
                    (click)="openAbhaPrefill('fetch')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 21v.01M17 21h.01M21 17h.01"/></svg>
              Fetch from ABHA
            </button>
          </div>
        </div>
        @if (abhaPrefillOpen()) {
          <pf-abha-prefill [startMode]="abhaPrefillMode()" (close)="abhaPrefillOpen.set(false)" (fetched)="applyAbhaPrefill($event)"></pf-abha-prefill>
        }
      }

      <pf-tile tone="default" padding="lg" class="block">
        @if (config(); as cfg) {
          <pf-workflow-renderer
            [config]="cfg"
            [singlePage]="true"
            [context]="context()"
            [initialValues]="initialValues()"
            [submitting]="saving()"
            [finishLabel]="patientId() ? 'Save changes' : 'Register patient'"
            [extraActions]="patientId() ? [] : registerActions"
            (valuesChange)="values.set($event)"
            (extraActionClicked)="onExtraAction($event)"
            (workflowComplete)="onComplete($event)"></pf-workflow-renderer>
        } @else {
          <div class="flex justify-center py-10">
            <pf-loading-logo size="xl" color="purple" [showDna]="true"
                             [showText]="true" text="Loading workflow…"></pf-loading-logo>
          </div>
        }
      </pf-tile>

      @if (patientId(); as pid) {
        <pf-tile tone="default" padding="md" class="block mt-4">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="min-w-0">
              <span class="text-sm font-bold text-[var(--text-primary)]">ABHA (Health ID)</span>
              <p class="text-xs text-[var(--text-tertiary)]">Create a new ABHA or verify an existing one via ABDM OTP.</p>
            </div>
            <button type="button" class="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer transition-colors"
                    (click)="abhaWizardOpen.set(true)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Verify / Create ABHA
            </button>
          </div>
        </pf-tile>
        @if (abhaWizardOpen()) {
          <pf-abha-wizard [patientId]="pid" (close)="abhaWizardOpen.set(false)" (done)="onAbhaDone($event)"></pf-abha-wizard>
        }
      }

      <!-- <p class="text-[11px] font-mono mt-3 px-1" style="color: var(--text-muted);">
        Config: patient_registration v{{ record()?.version ?? '—' }}
      </p> -->
    </section>
  `,
  styles: [
    `
      /* PHONE (≤640px): the floating bottom-nav pill overlaps the
         in-flow workflow footer (the "← Back / Next →" / "Register
         patient" action row rendered by pf-workflow-renderer), so the
         primary button can't be reached/tapped. Pad the page foot by
         (action-row height + the pill's reserved height,
         --tab-nav-total-height) so the form scrolls fully clear and the
         button sits above the pill. Additive + phone-only: ≥641px is
         byte-for-byte unchanged. */
      @media (max-width: 640px) {
        :host .pf-register-page {
          padding-bottom: calc(56px + var(--tab-nav-total-height)) !important;
        }
      }
    `
  ]
})
export class PatientRegisterComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly _record = signal<WorkflowConfigRecord | null>(null);
  private readonly _config = signal<WorkflowConfig | null>(null);
  private readonly _saving = signal(false);
  protected readonly values = signal<WorkflowFormValues>({});
  protected readonly registerActions: Array<{ id: string; label: string; variant?: 'primary' | 'ghost' }> = [
    { id: 'create_order', label: 'Create Order', variant: 'ghost' },
    { id: 'create_appointment', label: 'Create Appointment', variant: 'ghost' }
  ];

  readonly record = this._record.asReadonly();
  readonly config = this._config.asReadonly();
  readonly saving = this._saving.asReadonly();

  protected readonly patientId = signal<string | null>(null);
  /** ABHA (ABDM) create/verify wizard — edit mode only (needs a patient id). */
  protected readonly abhaWizardOpen = signal(false);
  onAbhaDone(p: Patient) {
    this.abhaWizardOpen.set(false);
    this.toasts.success('ABHA verified — patient details updated from KYC');
    // The KYC demographics were mapped onto the patient server-side; open the
    // profile so the filled-in name/sex/DOB/phone are visible.
    if (p?.id) this.router.navigate(['/frontdesk/patients', p.id]);
  }
  protected readonly initialValues = signal<WorkflowFormValues>({});

  /** ABHA prefill (NEW registration) — enter number/scan QR → fill the form,
   *  or Create a new ABHA (Aadhaar OTP) → fill + register together. */
  protected readonly abhaPrefillOpen = signal(false);
  protected readonly abhaPrefillMode = signal<'fetch' | 'create'>('fetch');
  openAbhaPrefill(mode: 'fetch' | 'create') {
    this.abhaPrefillMode.set(mode);
    this.abhaPrefillOpen.set(true);
  }
  /**
   * Everything ABDM returned that the registration form has NO field for
   * (address, pincode, district, state, abhaAddress, middle name). Stashed on
   * fetch and merged into the patient's `attributes` on save — so we capture
   * the full KYC record, not just the visible fields.
   */
  private readonly _abhaExtras = signal<Record<string, string>>({});

  /**
   * Map ABHA/KYC demographics onto the dynamic form. We shape the demographics
   * into a partial Patient (camelCase, mirroring what the API returns) and reuse
   * buildInitialValues() so the mapping honours whatever storageKeys the active
   * workflow uses. Merge over what's already typed, then push through
   * initialValues — the renderer's ngOnChanges re-applies it to the form.
   * Anything the form can't show is preserved via _abhaExtras → attributes.
   */
  applyAbhaPrefill(demo: AbhaPrefillData) {
    this.abhaPrefillOpen.set(false);
    const cfg = this._config();
    if (!cfg || !demo) return;
    const synthetic: Record<string, unknown> = {};

    // Name: first_name = given name; fathers_name = surname (in most Indian
    // records the surname is the father's name). Fold any middle name into the
    // given name since the form has no middle-name field.
    let first = (demo.firstName || '').trim();
    let fathers = (demo.lastName || '').trim();
    const mid = (demo.middleName || '').trim();
    if (!first && demo.fullName) {
      const parts = demo.fullName.trim().split(/\s+/);
      first = parts.shift() || '';
      if (!fathers) fathers = parts.join(' ');
    }
    if (mid) first = [first, mid].filter(Boolean).join(' ');
    if (first) synthetic['firstName'] = first;
    if (fathers) synthetic['fathersName'] = fathers;

    const sex = this.normalizeSex(demo.gender);
    if (sex) synthetic['sex'] = sex;
    const dob = this.toIsoDob(demo.dob, demo.yearOfBirth);
    if (dob) synthetic['dateOfBirth'] = dob;
    const phone = (demo.mobile || '').replace(/\D/g, '');
    if (phone.length >= 10) synthetic['phone'] = phone.slice(-10);
    const abha = (demo.abhaNumber || '').replace(/\D/g, '');
    if (abha.length === 14) synthetic['abhaId'] = abha;

    const iv = this.buildInitialValues(cfg, synthetic as unknown as Patient);

    // Preserve every remaining ABDM detail even without a matching form field.
    const extras: Record<string, string> = {};
    const put = (k: string, v?: string) => { const t = (v || '').trim(); if (t) extras[k] = t; };
    put('abhaAddress', demo.abhaAddress);
    put('address', demo.address);
    put('pincode', demo.pincode);
    put('district', this.titleCase(demo.district));
    put('state', this.titleCase(demo.state));
    put('middleName', demo.middleName);
    put('abhaPhoto', demo.photo);
    this._abhaExtras.set(extras);

    if (!Object.keys(iv).length && !Object.keys(extras).length) {
      this.toasts.info('ABHA fetched, but no matching form fields to fill.');
      return;
    }
    this.initialValues.set({ ...this.values(), ...iv });
    this.toasts.success('Details captured from ABHA');
  }

  /** "TAMIL NADU" → "Tamil Nadu" (leaves already-mixed-case text alone). */
  private titleCase(s?: string): string | undefined {
    if (!s) return s;
    return s === s.toUpperCase()
      ? s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
      : s;
  }

  private normalizeSex(g?: string): string | undefined {
    const s = (g || '').trim().toLowerCase();
    if (!s) return undefined;
    if (s === 'm' || s.startsWith('male')) return 'Male';
    if (s === 'f' || s.startsWith('female')) return 'Female';
    if (s === 'o' || s.startsWith('other') || s.startsWith('trans')) return 'Other';
    return undefined;
  }

  /** ABHA DOB is usually "DD-MM-YYYY" (parts may be blank) — normalise to ISO. */
  private toIsoDob(dob?: string, yob?: number): string | undefined {
    const raw = (dob || '').trim();
    if (raw) {
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
      const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
      const y = raw.match(/(\d{4})/);
      if (y) return `${y[1]}-01-01`;
    }
    if (yob && yob > 1900 && yob < 2200) return `${yob}-01-01`;
    return undefined;
  }

  readonly context = computed<WorkflowContext>(() => {
    const user = this.auth.user();
    const v = this.values();
    const dobKey = Object.keys(v).find(k => k.endsWith('::date_of_birth'));
    const dob = dobKey ? v[dobKey] : undefined;
    const age = dob ? this.yearsBetween(String(dob), new Date()) : undefined;
    const sexKey = Object.keys(v).find(k => k.endsWith('::sex'));
    return {
      userId: user?.id,
      tenantId: user?.tenantId,
      branchId: user?.branchId,
      patientAge: age,
      patientSex: sexKey ? String(v[sexKey]) : undefined,
      'user.permissions': user?.permissions ?? []
    };
  });

  ngOnInit() {
    const pid = this.route.snapshot.queryParamMap.get('patientId');
    if (pid) {
      this.patientId.set(pid);
    }

    this.api.get<WorkflowConfigRecord>('/api/workflows/patient_registration').subscribe({
      next: r => {
        this._record.set(r);
        console.log('Parsing workflow config Patient', r.configJson);
        try {
          const cfg = JSON.parse(r.configJson) as WorkflowConfig;
          this._config.set(cfg);

          if (pid) {
            this.api.get<{ patient?: Patient } & Patient>(`/api/patients/${pid}`).subscribe({
              next: res => {
                // GET /api/patients/{id} returns the profile shape
                // { patient, history }. Unwrap to the patient (fall back to the
                // response itself if a bare patient is ever returned) — without
                // this, every field maps to `undefined` and the edit form loads
                // blank.
                const p = (res && (res as { patient?: Patient }).patient) || (res as Patient);
                const init = this.buildInitialValues(cfg, p);
                this.initialValues.set(init);
                this.values.set(init);
              },
              error: () => this.toasts.error('Could not load patient details for editing')
            });
          }
        }
        catch { this.toasts.error('Could not parse workflow'); }
      },
      error: () => this.toasts.error('Could not load patient_registration workflow')
    });
  }

  back() {
    const pid = this.patientId();
    if (pid) {
      this.router.navigate(['/frontdesk/patients', pid]);
    } else {
      this.router.navigateByUrl('/frontdesk');
    }
  }

  onComplete(values: WorkflowFormValues) {
    this.savePatient(values, 'profile');
  }

  onExtraAction(event: { actionId: string; values: WorkflowFormValues }) {
    if (event.actionId === 'create_order') {
      this.savePatient(event.values, 'order');
    } else if (event.actionId === 'create_appointment') {
      this.savePatient(event.values, 'appointment');
    }
  }

  private savePatient(values: WorkflowFormValues, target: 'profile' | 'order' | 'appointment') {
    const cfg = this._config();
    if (!cfg || this._saving()) return;
    const { standard, metadata } = splitByStorage(cfg, values);

    // Standard storageKeys come in snake_case (matching DB columns); wire DTO expects camelCase.
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(standard)) {
      if (v === null || v === undefined || v === '') continue;
      body[this.toCamelCase(k)] = v;
    }
    // Fold in the ABHA demographics the form had no field for, so the full KYC
    // record is persisted alongside any form metadata (form values win on clash).
    const meta: Record<string, unknown> = { ...this._abhaExtras(), ...metadata };
    if (Object.keys(meta).length > 0) {
      body['attributes'] = JSON.stringify(meta);
    }

    this.applyHybridDob(body);
    this._saving.set(true);

    const pid = this.patientId();
    if (pid) {
      // Backend exposes patient update as PATCH /api/patients/{id}; PUT 405s.
      this.api.patch<Patient>(`/api/patients/${pid}`, body).subscribe({
        next: patient => {
          this._saving.set(false);
          this.toasts.success(`Updated ${patient.displayName}`);
          this.router.navigate(['/frontdesk/patients', patient.id]);
        },
        error: e => {
          this._saving.set(false);
          this.toasts.error(ApiError.from(e).message);
        }
      });
    } else {
      this.api.post<Patient>('/api/patients/', body).subscribe({
        next: patient => {
          this._saving.set(false);
          this.toasts.success(`Registered ${patient.displayName}`);
          this.values.set({});
          if (target === 'order') {
            this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: patient.id } });
          } else if (target === 'appointment') {
            this.router.navigate(['/frontdesk/appointments/new'], { queryParams: { patientId: patient.id } });
          } else {
            this.router.navigate(['/frontdesk/patients', patient.id]);
          }
        },
        error: e => {
          this._saving.set(false);
          this.toasts.error(ApiError.from(e).message);
        }
      });
    }
  }

  private buildInitialValues(cfg: WorkflowConfig, p: Patient): WorkflowFormValues {
    const initial: WorkflowFormValues = {};
    let parsedAttrs: Record<string, unknown> = {};
    if (p.attributes) {
      try {
        parsedAttrs = JSON.parse(p.attributes);
      } catch (e) {
        console.error('Failed to parse patient attributes', e);
      }
    }

    for (const step of cfg.steps) {
      for (const f of step.fields) {
        const sk = f.storageKey;
        const key = `${step.name}::${f.name}`;
        if (sk.startsWith('metadata.')) {
          const metaKey = sk.slice('metadata.'.length);
          if (parsedAttrs[metaKey] !== undefined) {
            initial[key] = parsedAttrs[metaKey];
          }
        } else {
          const camelKey = this.toCamelCase(sk);
          const val = (p as any)[camelKey];
          if (val !== undefined && val !== null) {
            if (camelKey === 'dateOfBirth' && typeof val === 'string') {
              initial[key] = val.slice(0, 10);
            } else {
              initial[key] = val;
            }
          }
        }
      }
    }
    return initial;
  }

  private toCamelCase(snake: string): string {
    return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  }

  private applyHybridDob(body: Record<string, unknown>): void {
    const dob = body['dateOfBirth'];
    const ageRaw = body['age'];
    if ((dob === undefined || dob === null || dob === '') && ageRaw != null && `${ageRaw}` !== '') {
      const age = Math.floor(Number(ageRaw));
      if (Number.isFinite(age) && age >= 0 && age < 150) {
        const d = new Date(); d.setHours(0, 0, 0, 0);
        d.setFullYear(d.getFullYear() - age);
        body['dateOfBirth'] = d.toISOString();
      }
    }
    if (body['dateOfBirth']) delete body['age'];
  }

  private yearsBetween(dobIso: string, now: Date): number {
    const dob = new Date(dobIso);
    if (Number.isNaN(dob.getTime())) return 0;
    let age = now.getFullYear() - dob.getFullYear();
    if (now.getMonth() < dob.getMonth() ||
        (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) {
      age--;
    }
    return Math.max(0, age);
  }
}
