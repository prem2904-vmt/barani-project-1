import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderEntryService } from '../../../core/services/order-entry.service';
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
import { NavBackService } from '../../../core/services/nav-back.service';

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
        subtitle="Capture the patient's details — name, contact, ID, and any extras you collect."
        [parentRoute]="parentRoute()">
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
        @if (displayConfig(); as cfg) {
          <pf-workflow-renderer
            [config]="cfg"
            [singlePage]="true"
            [context]="context()"
            [initialValues]="initialValues()"
            [submitting]="saving()"
            [finishLabel]="patientId() ? 'Save changes' : 'Register patient'"
            [extraActions]="patientId() ? [] : registerActions"
            (valuesChange)="onValuesChange($event)"
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
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly orderEntry = inject(OrderEntryService);
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

  /** True while the Baby title is selected. */
  private readonly isBaby = computed(() => {
    const v = this.values();
    const k = Object.keys(v).find(key => key.endsWith('::title'));
    return k ? v[k] === 'Baby' : false;
  });

  /** Field names that belong in the "Contact & IDs" section. */
  private static readonly CONTACT_FIELDS = new Set(['phone', 'email', 'abha_id', 'aadhaar_last4']);

  /** The loaded config with display-only restructuring:
   *  - the basic step splits into "Patient identity" and "Contact & IDs"
   *    sections. The split steps KEEP the original step name, so every
   *    storage key (`basic_info::phone`) — and therefore save/load — is
   *    untouched; only the on-screen grouping changes.
   *  - while Title = Baby the FIRST-NAME box itself becomes "Baby of" (the
   *    standard infant convention — the mother's name IS the baby's identity
   *    anchor) and the separate guardian field is dropped: one input, asked
   *    once. Save copies the name into the guardian column too. */
  protected readonly displayConfig = computed<WorkflowConfig | null>(() => {
    const cfg = this._config();
    if (!cfg) return null;
    const baby = this.isBaby();

    const relabel = (f: WorkflowConfig['steps'][number]['fields'][number]) =>
      baby && f.name === 'first_name'
        ? { ...f, title: 'Baby of', placeholder: "Mother's name" }
        : f;

    // Canonical identity order: the name trio fills row one, DOB and the
    // guardian/"Baby of" pair fill row two; tenant-added extras follow.
    const IDENTITY_ORDER = ['title', 'first_name', 'fathers_name', 'sex', 'date_of_birth', 'guardian_name', 'guardian_phone'];
    const rank = (n: string) => {
      const i = IDENTITY_ORDER.indexOf(n);
      return i === -1 ? IDENTITY_ORDER.length : i;
    };

    const steps = cfg.steps.flatMap(s => {
      const fields = s.fields
        .filter(f => !(baby && (f.name === 'guardian_name' || f.name === 'guardian_phone')))
        .map(relabel);
      const contact = fields.filter(f => PatientRegisterComponent.CONTACT_FIELDS.has(f.name));
      const identity = fields
        .filter(f => !PatientRegisterComponent.CONTACT_FIELDS.has(f.name))
        .sort((a, b) => rank(a.name) - rank(b.name));
      // Split only the classic basic step, and only when both halves exist.
      if (s.name !== 'basic_info' || contact.length === 0 || identity.length === 0) {
        return [{ ...s, fields }];
      }
      return [
        { ...s, id: `${s.id}__identity`, title: 'Patient identity', fields: identity },
        { ...s, id: `${s.id}__contact`, title: 'Contact & IDs', fields: contact }
      ];
    });

    return { ...cfg, steps };
  });

  protected readonly patientId = signal<string | null>(null);
  protected readonly parentRoute = computed(() => {
    const pid = this.patientId();
    return pid ? `/frontdesk/patients/${pid}` : '/frontdesk';
  });
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
      this.navBack.backTo(`/frontdesk/patients/${pid}`);
    } else {
      this.router.navigateByUrl('/frontdesk');
    }
  }

  /** Sex a title implies. Baby and Dr. imply nothing — never guess those. */
  private static readonly TITLE_SEX: Record<string, string> = {
    'Mr.': 'Male', 'Master': 'Male', 'Mrs.': 'Female', 'Ms.': 'Female'
  };
  /** The sex value WE auto-filled last — a manual pick must never be stomped. */
  private _autoSex: string | null = null;

  /** Picking a gendered title auto-fills Sex (one less tap for the frontdesk).
   *  Only fills when Sex is empty or still holding our previous auto value —
   *  an explicit manual choice always wins. */
  protected onValuesChange(v: WorkflowFormValues) {
    const prev = this.values();
    this.values.set(v);

    const titleKey = Object.keys(v).find(k => k.endsWith('::title'));
    if (!titleKey) return;
    const title = String(v[titleKey] ?? '');
    if (title === String(prev[titleKey] ?? '')) return;   // something else changed

    const inferred = PatientRegisterComponent.TITLE_SEX[title];
    if (!inferred) return;
    const sexKey = titleKey.replace(/::title$/, '::sex');
    const current = v[sexKey];
    if (current === inferred) return;
    if (current != null && current !== '' && current !== this._autoSex) return;

    this._autoSex = inferred;
    const next = { ...v, [sexKey]: inferred };
    this.values.set(next);
    // The renderer owns the form state — push the filled value back through
    // initialValues (its ngOnChanges re-applies the whole bag).
    this.initialValues.set(next);
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
    // Baby: the "Baby of" box IS the first-name field holding the mother's
    // name — mirror it into the guardian column (the display form asks once).
    if (body['title'] === 'Baby' && !body['guardianName'] && body['firstName']) {
      body['guardianName'] = body['firstName'];
    }
    // Duplicate-confirmation retry: carry the force flag to the API even
    // though it is not a form field.
    if ((values as Record<string, unknown>)['force'] === true) body['force'] = true;
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
          this.toasts.success(`Registered ${patient.displayName}`);
          this.values.set({});
          // Navigation must never fail SILENTLY: four duplicates of one
          // patient were created by re-clicking a form that looked dead
          // (OPS-49). A guard-blocked or crashed navigation now says so,
          // and the button stays disabled until the navigation settles.
          const nav = target === 'order'
            ? this.orderEntry.startNewOrder(patient.id)
            : target === 'appointment'
              ? this.router.navigate(['/frontdesk/appointments/new'], { queryParams: { patientId: patient.id } })
              : this.router.navigate(['/frontdesk/patients', patient.id]);
          nav.then(ok => {
            this._saving.set(false);
            if (!ok) this.toasts.warning(
              `${patient.displayName} is registered (${patient.mrn ?? 'see search'}) — but the next page could not open. Find them via patient search.`, 8000);
          }).catch(() => {
            this._saving.set(false);
            this.toasts.warning(
              `${patient.displayName} is registered — but the next page failed to open. Find them via patient search.`, 8000);
          });
        },
        error: e => {
          this._saving.set(false);
          const err = ApiError.from(e);
          if (err.code === 'duplicate_patient') {
            void this.confirmDuplicate(err.message, values, target);
            return;
          }
          this.toasts.error(err.message);
        }
      });
    }
  }

  /** OPS-49: same name + phone already registered — confirm before creating
   *  a genuine namesake (retries with force=true). */
  private async confirmDuplicate(message: string, values: WorkflowFormValues, target: 'profile' | 'order' | 'appointment') {
    const ok = await this.dialog.confirm({
      title: 'Patient already registered?',
      message,
      tone: 'primary',
    });
    if (!ok) return;
    this.savePatient({ ...values, force: true } as WorkflowFormValues, target);
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
