import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderEntryService } from '../../../core/services/order-entry.service';
import {
  WorkflowRendererComponent,
  DOB_ESTIMATED_SUFFIX,
  splitByStorage
} from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import { BABY_OF_TITLE, Patient, isBabyOfTitle } from '../../../shared/models/patient.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { AbhaWizardComponent } from '../../../shared/components/abha-wizard/abha-wizard.component';
import { AbhaPrefillComponent, AbhaPrefillData } from '../../../shared/components/abha-wizard/abha-prefill.component';
import { WorkflowConfig, WorkflowConfigRecord, WorkflowContext, WorkflowFormValues } from '../../../shared/models/workflow.model';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { PATIENT_REGISTER_ND_STYLES } from './patient-register.nd.styles';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { COUNTRY_PHONE_RULES } from '../../../shared/forms/validate';
import { SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ageParts } from '../../../shared/utils/patient-age';
import { dobFromAge } from '../../../shared/forms/patient-fields';

@Component({
  selector: 'pf-patient-register',
  standalone: true,
  imports: [SkeletonFormComponent, BusyDirective,
    WorkflowRendererComponent,
    ScreenHeaderComponent,
    TileComponent,
    AbhaWizardComponent,
    AbhaPrefillComponent,
    HeroBandComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (theme.isNewDesign()) {
    <!-- NEW DESIGN (ND-PATTERN §15): ONE form, no tabs, keyboard-first.
         Band = back · tenant · actions (ONE primary); the pill = the
         patient's name only; every section is a card on the same screen
         (3 / 2 / 1 columns). Ctrl/⌘+Enter saves from anywhere. -->
    <section class="pf-band-page pf-reg">
      <pf-hero-band class="pf-reg-band" [back]="true" [backTo]="parentRoute()" [backAction]="backFn"
                    [customSearch]="true" [contextBar]="true" [standardPill]="true">
        <ng-container band-actions>
          @if (patientId()) {
            <span class="nd-savestate pf-reg-savestate" role="status" aria-live="polite"
                  [attr.aria-label]="dirty() ? 'Unsaved changes' : 'No unsaved changes'"
                  [title]="dirty() ? 'Unsaved changes — Save changes to keep them' : 'No unsaved changes'">
              @if (dirty()) {
                <span class="nd-savestate__dot" aria-hidden="true"></span><span class="pf-reg-savestate__t">Unsaved changes</span>
              } @else {
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span class="pf-reg-savestate__t">All changes saved</span>
              }
            </span>
          }
          <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-reg-cancel press" [disabled]="saving()"
                  (click)="back()" aria-label="Cancel" title="Cancel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            Cancel
          </button>
          @if (!patientId()) {
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-reg-order press" [disabled]="saving() || !config()"
                    [pfBusy]="saving() && savingAs() === 'order'" pfBusyLabel="Saving patient…"
                    (click)="submit('create_order')" aria-label="Save & book test" title="Register, then book a test">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6"/><path d="M10 3v6.5L4.6 18.4A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.4-2.6L14 9.5V3"/><path d="M7.5 15h9"/></svg>
              Save &amp; Book test
            </button>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-reg-appt press" [disabled]="saving() || !config()"
                    [pfBusy]="saving() && savingAs() === 'appointment'" pfBusyLabel="Saving patient…"
                    (click)="submit('create_appointment')" aria-label="Save & book appointment" title="Register, then book an appointment">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              Save &amp; Book appointment
            </button>
          }
          <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-reg-primary press" [disabled]="saving() || !config()"
                  [pfBusy]="saving() && savingAs() === 'profile'" pfBusyLabel="Saving patient…"
                  (click)="submit(null)"
                  [attr.aria-label]="saving() ? 'Saving' : primaryLabel()" [title]="primaryLabel() + ' (Ctrl/⌘+Enter)'"
                  aria-keyshortcuts="Control+Enter Meta+Enter">
            @if (patientId()) {
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
            } @else {
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>
            }
            {{ saving() ? 'Saving…' : primaryLabel() }}
          </button>
        </ng-container>

        <!-- The pill (standard band-pill size) = the patient's name ✎ … and,
             at its right, the ABHA helpers as quiet grey buttons (icon +
             label on desktop, icon only on phones). -->
        <div band-search class="nd-ctx pf-reg-ctx">
          <span class="nd-ctx__primary pf-reg-ctx__name">
            <span class="pf-reg-ctx__nametext">{{ subjectName() }}</span>
            <button type="button" class="nd-ctx__edit press" (click)="editName()" aria-label="Edit name" title="Edit name">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </button>
          </span>
          <span class="pf-reg-ctx__abha">
            @if (!patientId()) {
              <button type="button" class="nd-btn nd-btn--quiet pf-reg-abha" (click)="openAbhaPrefill('fetch')"
                      aria-label="Fill from ABHA" title="Has an ABHA? Scan the card or enter the number to fill the form">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16"/></svg>
                <span class="pf-reg-abha__t">Fill from ABHA</span>
              </button>
              <button type="button" class="nd-btn nd-btn--quiet pf-reg-abha-new" (click)="openAbhaPrefill('create')"
                      aria-label="Create ABHA" title="No ABHA? Create one with Aadhaar OTP — it fills the form">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 9v6M9 12h6"/></svg>
                <span class="pf-reg-abha__t">Create ABHA</span>
              </button>
            } @else {
              <button type="button" class="nd-btn nd-btn--quiet pf-reg-abha" (click)="abhaWizardOpen.set(true)"
                      aria-label="Verify / create ABHA" title="Create a new ABHA or verify an existing one via ABDM OTP">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
                <span class="pf-reg-abha__t">Verify / create ABHA</span>
              </button>
            }
          </span>
        </div>
      </pf-hero-band>

      <div class="pf-band-body pf-reg-body">
        @if (displayConfig(); as cfg) {
          <pf-workflow-renderer class="pf-reg-form"
            [config]="cfg"
            [singlePage]="true"
            [nd]="true"
            [hideActions]="true"
            [context]="context()"
            [initialValues]="initialValues()"
            [submitting]="saving()"
            [finishLabel]="primaryLabel()"
            [extraActions]="patientId() ? [] : registerActions"
            (enterSubmit)="submit(null)"
            (valuesChange)="onValuesChange($event)"
            (extraActionClicked)="onExtraAction($event)"
            (workflowComplete)="onComplete($event)"></pf-workflow-renderer>
        } @else {
          <section class="nd-card pf-reg-loading" aria-busy="true">
            <div class="nd-card__body">
              <div class="flex justify-center py-10">
                <pf-skeleton-form [fields]="8" label="Loading the form…"></pf-skeleton-form>
              </div>
            </div>
          </section>
        }
      </div>

      @if (abhaPrefillOpen()) {
        <pf-abha-prefill [startMode]="abhaPrefillMode()" (close)="abhaPrefillOpen.set(false)" (fetched)="applyAbhaPrefill($event)"></pf-abha-prefill>
      }
      @if (patientId(); as pid) {
        @if (abhaWizardOpen()) {
          <pf-abha-wizard [patientId]="pid" (close)="abhaWizardOpen.set(false)" (done)="onAbhaDone($event)"></pf-abha-wizard>
        }
      }
    </section>
    }
    @else {
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
            <pf-skeleton-form [fields]="8" label="Loading workflow…"></pf-skeleton-form>
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

    </section>
    }
  `,
  styles: [
    PATIENT_REGISTER_ND_STYLES,
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
  protected readonly theme = inject(ThemeService);
  /** Web pointer (autofocus only on web — never pop the phone keyboard). */
  protected readonly web = webPointerSignal();

  // ── New design (§15): ONE form, the name-only pill, keyboard-first ──
  private readonly renderer = viewChild(WorkflowRendererComponent);
  private readonly tenantState = inject(TenantStateService);
  /** The patient's name as loaded (edit mode) — the pill's fallback. */
  protected readonly loadedName = signal('');
  /** The edit form as loaded, to tell "Unsaved changes" from "saved". */
  private readonly loadedValues = signal<WorkflowFormValues | null>(null);
  /** Opened from Order & Payments ("Register a new patient" / "Edit …
   *  details"): after saving (or cancelling) go BACK to that order. */
  protected readonly returnTo = signal<string | null>(null);

  /** The pill's subject: the FULL name as typed (never truncated), else
   *  "New patient" / the loaded name. The title leads, so "Baby" reads
   *  "Baby Arjun Kumar" and "Baby of" (names = the mother's) reads
   *  "Baby of Priya Kumar" — one rule, never "Baby Baby of". */
  protected readonly subjectName = computed(() => {
    const v = this.values();
    const pick = (n: string) => {
      const k = Object.keys(v).find(key => key.endsWith(`::${n}`));
      const x = k ? v[k] : '';
      return x == null ? '' : String(x).trim();
    };
    const title = pick('title');
    const first = pick('first_name');
    const last = pick('fathers_name');
    const name = [first, last].filter(Boolean).length ? [title, first, last].filter(Boolean).join(' ') : '';
    return name || this.loadedName() || (this.patientId() ? 'Patient' : 'New patient');
  });
  protected readonly primaryLabel = computed(() => this.patientId() ? 'Save changes' : 'Register patient');

  /** Edit mode: anything changed since the load? (Empty values ignored.) */
  protected readonly dirty = computed(() => {
    const base = this.loadedValues();
    if (!base) return false;
    return PatientRegisterComponent.canon(this.values()) !== PatientRegisterComponent.canon(base);
  });
  private static canon(v: WorkflowFormValues): string {
    return JSON.stringify(Object.keys(v).sort()
      .filter(k => v[k] !== '' && v[k] !== null && v[k] !== undefined)
      .map(k => [k, v[k]]));
  }

  /** The tenant's dialling code (from its phone number) → the phone
   *  field's default country; +91 when the tenant has none. */
  private readonly defaultPhoneCode = computed(() => {
    const ph = (this.tenantState.tenant()?.phone ?? '').replace(/\s+/g, '');
    const hit = ph.startsWith('+') ? COUNTRY_PHONE_RULES.find(r => ph.startsWith(r.code)) : null;
    return hit?.code ?? null;
  });

  /** Band actions (and Enter on the last field / Ctrl-⌘+Enter) → the
   *  renderer, which validates EVERY field first. */
  submit(action: 'create_order' | 'create_appointment' | null): void {
    const r = this.renderer();
    if (!r || this._saving()) return;
    if (action) r.triggerExtraAction(action); else r.finish();
  }
  /** Ctrl / ⌘ + Enter saves from anywhere on the form. */
  @HostListener('document:keydown', ['$event'])
  onDocKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || !this.theme.isNewDesign()) return;
    e.preventDefault();
    this.submit(null);
  }
  /** The pill pencil: focus First name. */
  editName(): void { this.focusField('first_name'); }
  private focusField(name: string): void {
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(`.pf-reg [data-field="${name}"] input`);
      el?.focus();
    });
  }
  /** Keyboard-first: First name has focus as soon as the form renders
   *  (web only — on touch it would throw the keyboard over the form). */
  private _autofocused = false;
  private readonly _autofocusFx = effect(() => {
    if (!this.renderer() || !this.displayConfig() || this._autofocused || !this.web()) return;
    this._autofocused = true;
    this.focusField('first_name');
  });
  /** Hero-band back chevron = Cancel (returns to the order when opened from it). */
  protected readonly backFn = () => this.back();

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
  /** Which band action started the save in flight (only that button shows busy). */
  private readonly _savingAs = signal<'profile' | 'order' | 'appointment'>('profile');
  readonly savingAs = this._savingAs.asReadonly();

  /** True while the "Baby of" title is selected (an unnamed newborn — the
   *  name boxes hold the MOTHER's name). Plain "Baby" is an own-name title. */
  private readonly isBabyOf = computed(() => {
    const v = this.values();
    const k = Object.keys(v).find(key => key.endsWith('::title'));
    return k ? isBabyOfTitle(String(v[k] ?? '')) : false;
  });

  /** Field names that belong in the "Contact & IDs" section. */
  private static readonly CONTACT_FIELDS = new Set(['phone', 'email', 'abha_id', 'aadhaar_last4']);

  /** The loaded config with display-only restructuring:
   *  - the basic step splits into "Patient identity" and "Contact & IDs"
   *    sections. The split steps KEEP the original step name, so every
   *    storage key (`basic_info::phone`) — and therefore save/load — is
   *    untouched; only the on-screen grouping changes.
   *  - while Title = "Baby of" the name boxes become "Mother's first name" /
   *    "Mother's last name" (the standard infant convention — the mother's
   *    name IS the unnamed baby's identity anchor) and the separate guardian
   *    fields are dropped: asked once. Save copies the mother's name into the
   *    guardian column too. Title = "Baby" is an ordinary own-name entry.
   *  - a title list that offers "Baby" always offers "Baby of" right after it
   *    (the two meanings split 2026-09-28; legacy "Baby" rows were re-titled
   *    "Baby of", so the pill must exist even on a customised form). */
  protected readonly displayConfig = computed<WorkflowConfig | null>(() => {
    const cfg = this._config();
    if (!cfg) return null;
    const baby = this.isBabyOf();

    type Field = WorkflowConfig['steps'][number]['fields'][number];
    const relabel = (f: Field): Field => {
      if (f.name === 'title') return PatientRegisterComponent.withBabyOf(f);
      if (!baby) return f;
      if (f.name === 'first_name') return { ...f, title: "Mother's first name", placeholder: "Mother's first name" };
      if (f.name === 'fathers_name') return { ...f, title: "Mother's last name", placeholder: "Mother's last name" };
      return f;
    };

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
    // Mirror into values too: the renderer's re-seed doesn't emit
    // valuesChange, and the pill name / age context read this copy.
    const merged = { ...this.values(), ...iv };
    this.values.set(merged);
    this.initialValues.set(merged);
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
    // The shared patient-age helper: whole years for workflow rules
    // ("age < 18"), fractional for any reference-band pick.
    const parts = dob ? ageParts(String(dob)) : null;
    const age = parts?.years;
    const sexKey = Object.keys(v).find(k => k.endsWith('::sex'));
    return {
      userId: user?.id,
      tenantId: user?.tenantId,
      branchId: user?.branchId,
      patientAge: age,
      patientBandAge: parts?.fractionalYears,
      patientSex: sexKey ? String(v[sexKey]) : undefined,
      'user.permissions': user?.permissions ?? [],
      // New design: the phone field's default country (the tenant's own).
      defaultPhoneCode: this.defaultPhoneCode()
    };
  });

  ngOnInit() {
    const pid = this.route.snapshot.queryParamMap.get('patientId');
    if (pid) {
      this.patientId.set(pid);
    }
    this.returnTo.set(this.route.snapshot.queryParamMap.get('returnTo'));

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
                this.loadedValues.set(init);
                this.loadedName.set(p?.displayName ?? '');
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
    if (this.returnTo() === 'order') {
      // Back to the half-built order: its stashed cart comes back with it.
      void this.router.navigate(['/frontdesk/order'], { queryParams: { ...(pid ? { patientId: pid } : {}), resume: 'registration' } });
      return;
    }
    if (pid) {
      this.navBack.backTo(`/frontdesk/patients/${pid}`);
    } else {
      this.router.navigateByUrl('/frontdesk');
    }
  }

  /** Title field → the same field with "Baby of" inserted right after "Baby"
   *  when the list offers Baby but not Baby of. Anything else is untouched. */
  private static withBabyOf<F extends { options?: Array<{ value: string; label: string }> }>(f: F): F {
    const opts = f.options ?? [];
    const i = opts.findIndex(o => o.value === 'Baby');
    if (i === -1 || opts.some(o => isBabyOfTitle(o.value))) return f;
    const next = [...opts];
    next.splice(i + 1, 0, { value: BABY_OF_TITLE, label: BABY_OF_TITLE });
    return { ...f, options: next };
  }

  /** Sex a title implies. Baby / Baby of (the BABY's sex is asked, never the
   *  mother's) and Dr. imply nothing — never guess those. */
  private static readonly TITLE_SEX: Record<string, string> = {
    'Mr.': 'Male', 'Master': 'Male', 'Mrs.': 'Female', 'Ms.': 'Female'
  };
  /** Default title to suggest for each sex. Other has no sensible default. */
  private static readonly SEX_TITLE: Record<string, string> = {
    'Male': 'Mr.', 'Female': 'Ms.'
  };
  /** Titles that belong to a single gender — swapping sex should replace these. */
  private static readonly GENDERED_TITLES = new Set(['Mr.', 'Master', 'Mrs.', 'Ms.']);

  /** The sex value WE auto-filled last — a manual pick must never be stomped. */
  private _autoSex: string | null = null;
  /** The title value WE auto-filled last — a manual pick must never be stomped. */
  private _autoTitle: string | null = null;

  /** Bidirectional Title ↔ Sex sync (one less tap for the frontdesk).
   *  Title → Sex: picking Mr./Master fills Male; Mrs./Ms. fills Female.
   *  Sex  → Title: picking Female replaces Mr./Master with Ms.;
   *                picking Male  replaces Mrs./Ms. with Mr.
   *  In both directions we only update the other field when it is empty or
   *  still holds the value WE last auto-filled — explicit manual choices win. */
  protected onValuesChange(v: WorkflowFormValues) {
    const prev = this.values();
    this.values.set(v);

    const titleKey = Object.keys(v).find(k => k.endsWith('::title'));
    if (!titleKey) return;
    const sexKey = titleKey.replace(/::title$/, '::sex');

    const title = String(v[titleKey] ?? '');
    const sex   = String(v[sexKey]   ?? '');
    const prevTitle = String(prev[titleKey] ?? '');
    const prevSex   = String(prev[sexKey]   ?? '');

    const titleChanged = title !== prevTitle;
    const sexChanged   = sex   !== prevSex;

    // ── Title → Sex ────────────────────────────────────────────────────────
    if (titleChanged) {
      const inferred = PatientRegisterComponent.TITLE_SEX[title];
      if (inferred) {
        const current = v[sexKey];
        if (current == null || current === '' || current === this._autoSex) {
          this._autoSex = inferred;
          const next = { ...v, [sexKey]: inferred };
          this.values.set(next);
          this.initialValues.set(next);
        }
      }
      return;
    }

    // ── Sex → Title ────────────────────────────────────────────────────────
    if (sexChanged) {
      const suggested = PatientRegisterComponent.SEX_TITLE[sex];
      if (!suggested) return;   // 'Other' → no default title
      const currentTitle = v[titleKey];
      // Only update if title is empty, was auto-filled by us, or is a
      // gendered title that now conflicts with the newly chosen sex.
      const isAutoFilled = currentTitle === this._autoTitle;
      const isConflicting = PatientRegisterComponent.GENDERED_TITLES.has(String(currentTitle))
                         && PatientRegisterComponent.TITLE_SEX[String(currentTitle)] !== sex;
      if (currentTitle == null || currentTitle === '' || isAutoFilled || isConflicting) {
        this._autoTitle = suggested;
        const next = { ...v, [titleKey]: suggested };
        this.values.set(next);
        this.initialValues.set(next);
      }
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
    // The DOB came from the age box → tell the server it is an estimate.
    if (body['dateOfBirth'] && this.dobEstimated(values)) body['dobEstimated'] = true;
    // "Baby of": the name boxes hold the MOTHER's name — mirror it into the
    // guardian column (the display form asks once). Plain "Baby" is the
    // baby's own name: no mirroring.
    if (isBabyOfTitle(String(body['title'] ?? '')) && !body['guardianName'] && body['firstName']) {
      body['guardianName'] = [body['firstName'], body['fathersName']].filter(Boolean).join(' ');
    }
    // Duplicate-confirmation retry: carry the force flag to the API even
    // though it is not a form field.
    if ((values as Record<string, unknown>)['force'] === true) body['force'] = true;
    this._savingAs.set(target);
    this._saving.set(true);

    const pid = this.patientId();
    if (pid) {
      // Backend exposes patient update as PATCH /api/patients/{id}; PUT 405s.
      this.api.patch<Patient>(`/api/patients/${pid}`, body).subscribe({
        next: patient => {
          this._saving.set(false);
          this.toasts.success(`Updated ${patient.displayName}`);
          if (this.returnTo() === 'order') { void this.returnToOrder(patient.id); return; }
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
          // Opened from a half-built Order & Payments: go BACK to it with the
          // new patient attached (its stashed cart is restored there).
          const backToOrder = this.returnTo() === 'order' && target !== 'appointment';
          const nav = backToOrder
            ? this.returnToOrder(patient.id)
            : target === 'order'
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

  /** Back to Order & Payments with this patient attached; `resume` tells it
   *  to restore the cart it stashed before opening registration. */
  private returnToOrder(patientId: string): Promise<boolean> {
    return this.router.navigate(['/frontdesk/order'], { queryParams: { patientId, resume: 'registration' } });
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
              if (p.dobEstimated) initial[key + DOB_ESTIMATED_SUFFIX] = true;
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
        // A calendar date (yyyy-MM-dd), never toISOString() of local midnight
        // (that is the PREVIOUS day in UTC for IST). Flagged as an estimate.
        body['dateOfBirth'] = dobFromAge(age, 'years');
        body['dobEstimated'] = true;
      }
    }
    // DOB is the single source: the server derives Age from it.
    if (body['dateOfBirth']) delete body['age'];
  }

  /** Did the DOB field's value come from the age box (an estimate)? */
  private dobEstimated(values: WorkflowFormValues): boolean {
    const v = values as Record<string, unknown>;
    const key = Object.keys(v).find(k => k.endsWith(DOB_ESTIMATED_SUFFIX) && /date_of_birth|(^|_|::)dob|birth_?date/i.test(k));
    return !!key && v[key] === true;
  }
}
