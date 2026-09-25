import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Branch } from '../../../shared/models/tenant.model';
import { Role } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { AlphaDirective } from '../../../shared/directives/alpha.directive';
import { NumericDirective } from '../../../shared/directives/numeric.directive';
import { COUNTRY_CODES, getCountryDigitLength } from '../../../shared/utils/country-codes';
import { OPD_DEPARTMENTS, SPECIALIZATION_SUGGESTIONS } from '../../../shared/opd/medical-catalog';
import { hasDoctorRole } from '../../../shared/opd/doctor-role';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ROLE_INFO } from './permission-catalog';
import { TITLE_OPTIONS, USER_FORM_STYLES } from './user-form.styles';

interface CreateResult { id: string; username: string; displayName: string; }

interface CreateForm {
  /** Honorific ("Dr." for doctors, etc.) — prefixes every mention of the name. */
  title: string;
  username: string;
  password: string;
  firstName: string;
  fathersName: string;
  phone: string;
  roleIds: string[];
  branchId: string;
  subBranchId: string;
}

@Component({
  selector: 'pf-user-invite',
  standalone: true,
  imports: [
    FormsModule,
    ScreenHeaderComponent,
    SelectComponent,
    TouchButtonComponent,
    HeroBandComponent,
    AlphaDirective,
    NumericDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- ND "Editors": band = back · tenant · the ONE primary; the pill is
             the CONTEXT BAR (who is being created, as it is typed). -->
        <pf-hero-band [back]="true" [backTo]="'/admin/users?tab=users'" [customSearch]="true" [contextBar]="true">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-uf-primary press"
                    [disabled]="!canCreate() || saving()" (click)="submit()"
                    [attr.aria-label]="saving() ? 'Creating user' : 'Create user'" title="Create user">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>
              {{ saving() ? 'Creating…' : 'Create user' }}
            </button>
          </ng-container>
          <div band-search class="nd-ctx pf-uf-ctx">
            <span class="nd-ctx__primary pf-uf-ctx__name">{{ displayPreview() || 'New user' }}</span>
            @if (form().username.trim()) {
              <span class="nd-ctx__chip" data-k="Username"><span class="nd-ctx__k">Username</span><span class="nd-num">{{ form().username.trim().toLowerCase() }}</span></span>
            }
            <span class="nd-ctx__chip" data-k="Roles"><span class="nd-ctx__k">Roles</span><span>{{ rolesSummary() }}</span></span>
            <span class="nd-ctx__chip" data-k="Branch"><span class="nd-ctx__k">Branch</span><span>{{ scopeLabel() }}</span></span>
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin · Users"
        title="Create user"
        parentRoute="/admin/users?tab=users"
        subtitle="Set a username and password, pick the roles and branch scope. Share the password with them — there's no email.">
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="!canCreate() || saving()" (pressed)="submit()">
          {{ saving() ? 'Creating…' : 'Create user' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body">
        <div class="pf-uf-body">
          <div class="pf-uf-grid2">
            <!-- PROFILE -->
            <section class="nd-card pf-uf-card">
              <div class="nd-card__head">
                <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
                <h2 class="nd-card__label pf-uf-h">Profile</h2>
                <span class="nd-card__note"><span class="pf-uf-req">*</span> required</span>
              </div>
              <div class="nd-card__body">
                <div class="pf-uf-fields">
                  <div class="nd-field">
                    <span class="nd-field__lbl">Title</span>
                    <pf-select [options]="titleOptions" [value]="form().title" placeholder="—"
                               (valueChange)="patch({ title: $any($event) ?? '' })"></pf-select>
                  </div>
                  <label class="nd-field">
                    <span class="nd-field__lbl">First name</span>
                    <input type="text" pfAlpha class="nd-input" placeholder="e.g. Prem"
                           [ngModel]="form().firstName" (ngModelChange)="patch({ firstName: $event })" />
                  </label>
                  <label class="nd-field">
                    <span class="nd-field__lbl">Last name</span>
                    <input type="text" pfAlpha class="nd-input" placeholder="e.g. Kumar"
                           [ngModel]="form().fathersName" (ngModelChange)="patch({ fathersName: $event })" />
                  </label>
                  <label class="nd-field">
                    <span class="nd-field__lbl">Username <span class="pf-uf-req">*</span></span>
                    <input type="text" pfAlpha [allowNumbers]="true" class="nd-input" autocomplete="off" autocapitalize="none" spellcheck="false"
                           [class.nd-input--error]="!!usernameError()" placeholder="e.g. drpriya"
                           [ngModel]="form().username" (ngModelChange)="onUsernameChange($event)" (blur)="onUsernameBlur()" />
                    @if (usernameError()) { <p class="pf-uf-err">{{ usernameError() }}</p> }
                    <p class="nd-field__hint">3–32 letters and digits. This is what they type to sign in.</p>
                  </label>
                  <div class="nd-field">
                    <span class="nd-field__lbl">Phone</span>
                    <div class="pf-uf-phone">
                      <pf-select class="pf-uf-phone__cc" [options]="countryOptions" [value]="countryCode()"
                                 [searchable]="true" (valueChange)="onCountryCodeChange($any($event))"></pf-select>
                      <input type="tel" pfNumeric [maxDigits]="phoneMaxDigits()" [attr.maxlength]="phoneMaxDigits()"
                             class="nd-input nd-num pf-uf-phone__num" aria-label="Mobile number"
                             [placeholder]="phoneMaxDigits() + '-digit mobile number'"
                             [ngModel]="phoneDigits()" (ngModelChange)="onPhoneChange($event)" />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- SIGN-IN + BRANCH -->
            <section class="nd-card pf-uf-card">
              <div class="nd-card__head">
                <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
                <h2 class="nd-card__label pf-uf-h">Sign-in &amp; branch</h2>
              </div>
              <div class="nd-card__body">
                <label class="nd-field">
                  <span class="nd-field__lbl">Password <span class="pf-uf-req">*</span></span>
                  <input type="text" class="nd-input" autocomplete="off"
                         [class.nd-input--error]="!!passwordError()" placeholder="Minimum 8 characters"
                         [ngModel]="form().password" (ngModelChange)="onPasswordChange($event)" />
                  @if (passwordError()) { <p class="pf-uf-err">{{ passwordError() }}</p> }
                  <p class="nd-field__hint">Share this with the user securely — they can change it after signing in, and you can reset it anytime.</p>
                </label>
                <div class="nd-field">
                  <span class="nd-field__lbl">Branch</span>
                  <pf-select [options]="scopeOptions()" [value]="scopeValue()" placeholder="All branches"
                             (valueChange)="onScopeChange($event)"></pf-select>
                  <p class="nd-field__hint">Pick a sub-branch (indented →) to scope the user to that lab only.</p>
                </div>
              </div>
            </section>
          </div>

          <!-- ROLES -->
          <section class="nd-card pf-uf-card">
            <div class="nd-card__head">
              <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
              <h2 class="nd-card__label pf-uf-h">Roles <span class="pf-uf-req">*</span></h2>
              <span class="nd-card__note">The user gets the combined permissions of every role switched on.</span>
            </div>
            <div class="nd-card__body">
              <div class="pf-uf-roles">
                @for (r of roleOptions(); track r.value) {
                  <button type="button" class="nd-toggle pf-uf-sw press" role="switch" [attr.aria-checked]="hasRole(r.value)"
                          (click)="toggleRole(r.value)">
                    <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
                    <span class="pf-uf-sw__txt">
                      <span class="pf-uf-sw__name">{{ r.label }}</span>
                      @if (r.hint) { <span class="pf-uf-sw__what">{{ r.hint }}</span> }
                    </span>
                  </button>
                }
              </div>
            </div>
          </section>

          <!-- DOCTOR DETAILS (OPD build) — only when a doctor-type role is on. -->
          @if (isDoctorSelected()) {
            <section class="nd-card pf-uf-card pf-doc">
              <div class="nd-card__head">
                <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/></svg></span>
                <h2 class="nd-card__label pf-uf-h pf-doc__title">Doctor details</h2>
                <span class="nd-card__note">Optional</span>
              </div>
              <div class="nd-card__body">
                <div class="pf-uf-fields">
                  <label class="nd-field">
                    <span class="nd-field__lbl">Medical Registration No.</span>
                    <input type="text" class="nd-input nd-num" [ngModel]="doctorReg()" (ngModelChange)="doctorReg.set($event)"
                           placeholder="NMC / State Medical Council reg. no." />
                  </label>
                  <div class="nd-field">
                    <span class="nd-field__lbl">Department</span>
                    <pf-select [options]="deptOptions()" [value]="deptSelectValue()"
                               placeholder="Select a department…" (valueChange)="onDeptChange($event)"></pf-select>
                    @if (deptIsCustom()) {
                      <input type="text" class="nd-input" [ngModel]="doctorDept()" aria-label="Department name"
                             (ngModelChange)="doctorDept.set($event)" placeholder="Type the department name" />
                    }
                  </div>
                  <div class="nd-field pf-uf-span">
                    <span class="nd-field__lbl">Specialisation(s)</span>
                    <pf-select [options]="specOptions()" [multiple]="true" [values]="doctorSpecs()"
                               placeholder="Select specialisation(s)…" (valuesChange)="doctorSpecs.set($event)"></pf-select>
                  </div>
                  <div class="nd-field pf-uf-span">
                    <span class="nd-field__lbl">Procedures / surgeries</span>
                    @if (doctorProcs().length) {
                      <div class="pf-uf-tags">
                        @for (p of doctorProcs(); track p) {
                          <span class="nd-chip nd-chip--static pf-uf-tag">{{ p }}
                            <button type="button" class="pf-uf-tag__x" (click)="removeProc(p)" [attr.aria-label]="'Remove ' + p">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                            </button>
                          </span>
                        }
                      </div>
                    }
                    <input type="text" class="nd-input" [ngModel]="procDraft()" aria-label="Add a procedure"
                           (ngModelChange)="procDraft.set($event)"
                           (keydown.enter)="$event.preventDefault(); addProc(procDraft())"
                           placeholder="Type a procedure, press Enter…" />
                  </div>
                </div>
              </div>
            </section>
          }
        </div>
      </div>
    </section>
  `,
  styles: [USER_FORM_STYLES]
})
export class UserInviteComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  protected readonly theme = inject(ThemeService);

  private readonly _roles = signal<Role[]>([]);
  private readonly _branches = signal<Branch[]>([]);
  private readonly _form = signal<CreateForm>({
    username: '', password: '', title: '', firstName: '', fathersName: '', phone: '',
    roleIds: [], branchId: '', subBranchId: ''
  });
  private readonly _saving = signal(false);
  private readonly _usernameError = signal<string | null>(null);
  private readonly _passwordError = signal<string | null>(null);

  readonly countryCodes = COUNTRY_CODES;
  readonly countryCode = signal<string>('+91');
  readonly phoneDigits = signal<string>('');
  readonly phoneMaxDigits = computed(() => getCountryDigitLength(this.countryCode()));

  readonly form = this._form.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly usernameError = this._usernameError.asReadonly();
  readonly passwordError = this._passwordError.asReadonly();

  readonly roleOptions = computed<PfSelectOption<string>[]>(() =>
    this._roles().map(r => ({ value: r.id, label: r.name, hint: ROLE_INFO[r.name] ?? undefined }))
  );
  readonly titleOptions: PfSelectOption<string>[] = TITLE_OPTIONS;
  /** Country codes as pf-select options (code + country; no flag emoji). */
  readonly countryOptions: PfSelectOption<string>[] = COUNTRY_CODES.map(c => ({ value: c.code, label: c.code, hint: c.country }));

  // ── Context bar (new design) ──
  /** "Dr. Prem Kumar" as it is typed; empty until a name is entered. */
  readonly displayPreview = computed(() => {
    const f = this._form();
    return [f.title, f.firstName, f.fathersName].map(x => (x ?? '').trim()).filter(Boolean).join(' ');
  });
  readonly rolesSummary = computed(() => {
    const ids = this._form().roleIds;
    if (!ids.length) return 'None yet';
    const names = this._roles().filter(r => ids.includes(r.id)).map(r => r.name);
    return names.length ? names.join(', ') : `${ids.length}`;
  });
  readonly scopeLabel = computed(() => {
    const v = this.scopeValue();
    const o = this.scopeOptions().find(x => x.value === v);
    return (o?.label ?? 'All branches').replace(/^\s*→\s*/, '').trim() || 'All branches';
  });

  // ── Doctor details (OPD build) — the section appears when a ticked role is a
  //    doctor-type role (role.kind === 'doctor'). All optional; free-add tags. ──
  readonly isDoctorSelected = computed(() =>
    hasDoctorRole(this._roles(), this._form().roleIds));

  readonly doctorReg = signal('');
  readonly doctorDept = signal('');
  readonly doctorSpecs = signal<string[]>([]);
  readonly doctorProcs = signal<string[]>([]);
  readonly procDraft = signal('');
  readonly specSuggestions = SPECIALIZATION_SUGGESTIONS;

  // Department uses the app select (styled) with a trailing "Other" option that
  // reveals a free-text input — keeps the managed list + add-your-own.
  readonly deptOptions = computed<PfSelectOption<string>[]>(() => [
    ...OPD_DEPARTMENTS.map(d => ({ value: d, label: d })),
    { value: '__custom__', label: 'Other (type below)…' },
  ]);
  readonly deptIsCustom = signal(false);
  readonly deptSelectValue = computed(() => this.deptIsCustom() ? '__custom__' : this.doctorDept());
  onDeptChange(v: string) {
    if (v === '__custom__') { this.deptIsCustom.set(true); this.doctorDept.set(''); }
    else { this.deptIsCustom.set(false); this.doctorDept.set(v); }
  }

  /** Specialisation uses the same app select as Department, in multi-select mode. */
  readonly specOptions = computed<PfSelectOption<string>[]>(() =>
    this.specSuggestions.map(s => ({ value: s, label: s })));

  addProc(v: string) { const t = v.trim(); if (t && !this.doctorProcs().includes(t)) this.doctorProcs.update(a => [...a, t]); this.procDraft.set(''); }
  removeProc(t: string) { this.doctorProcs.update(a => a.filter(x => x !== t)); }

  readonly scopeOptions = computed<PfSelectOption<string>[]>(() => {
    const branches = this._branches();
    let totalCount = 0;
    for (const b of branches) {
      totalCount++;
      totalCount += (b.subBranches?.length ?? 0);
    }

    const out: PfSelectOption<string>[] = [];
    if (totalCount > 1) {
      out.push({ value: '', label: 'All branches' });
    }

    for (const b of branches) {
      out.push({ value: `b:${b.id}`, label: b.name });
      for (const sb of b.subBranches ?? []) out.push({ value: `sb:${sb.id}`, label: `  → ${sb.name}` });
    }
    return out;
  });
  readonly scopeValue = computed(() => {
    const i = this._form();
    if (i.subBranchId) return `sb:${i.subBranchId}`;
    if (i.branchId) return `b:${i.branchId}`;
    return '';
  });

  // Required: a valid username, an 8+ char password, at least one role.
  readonly canCreate = computed(() => {
    const i = this._form();
    if (!/^[a-z0-9]{3,32}$/i.test(i.username.trim())) return false;
    if (i.password.length < 8) return false;
    if (i.roleIds.length === 0) return false;
    return true;
  });

  hasRole(id: string) { return this._form().roleIds.includes(id); }
  toggleRole(id: string) {
    this._form.update(v => ({
      ...v,
      roleIds: v.roleIds.includes(id) ? v.roleIds.filter(r => r !== id) : [...v.roleIds, id]
    }));
  }

  ngOnInit() {
    this.api.get<Role[]>('/api/roles/').subscribe({ next: l => this._roles.set(l ?? []) });
    this.api.get<Branch[]>('/api/tenants/branches?includeSubBranches=true').subscribe({
      next: l => {
        const branches = l ?? [];
        this._branches.set(branches);

        let totalCount = 0;
        let singleVal = '';
        for (const b of branches) {
          totalCount++;
          singleVal = `b:${b.id}`;
          for (const sb of b.subBranches ?? []) {
            totalCount++;
            singleVal = `sb:${sb.id}`;
          }
        }

        if (totalCount === 1) {
          if (singleVal.startsWith('sb:')) {
            this.patch({ branchId: '', subBranchId: singleVal.substring(3) });
          } else if (singleVal.startsWith('b:')) {
            this.patch({ branchId: singleVal.substring(2), subBranchId: '' });
          }
        }
      }
    });
  }

  patch(p: Partial<CreateForm>) { this._form.update(v => ({ ...v, ...p })); }
  back() { this.navBack.backTo('/admin/users?tab=users'); }

  onUsernameChange(v: string) {
    if (this._usernameError()) this._usernameError.set(null);
    // Don't force lowercase on every keypress to avoid cursor jumping to end when editing in the middle
    this.patch({ username: v || '' });
  }

  onUsernameBlur() {
    const u = this._form().username;
    if (u) {
      this.patch({ username: u.trim().toLowerCase() });
    }
  }

  onPasswordChange(v: string) {
    if (this._passwordError()) this._passwordError.set(null);
    this.patch({ password: v });
  }

  onCountryCodeChange(code: string) {
    this.countryCode.set(code);
    const maxLen = getCountryDigitLength(code);
    if (this.phoneDigits().length > maxLen) {
      this.phoneDigits.set(this.phoneDigits().substring(0, maxLen));
    }
    this.updateFullPhone();
  }

  onPhoneChange(v: string) {
    const maxLen = getCountryDigitLength(this.countryCode());
    const clean = (v || '').replace(/\D/g, '').substring(0, maxLen);
    this.phoneDigits.set(clean);
    this.updateFullPhone();
  }

  private updateFullPhone() {
    const digits = this.phoneDigits().trim();
    if (!digits) {
      this.patch({ phone: '' });
    } else {
      this.patch({ phone: `${this.countryCode()} ${digits}` });
    }
  }

  onScopeChange(v: string) {
    if (!v) { this.patch({ branchId: '', subBranchId: '' }); return; }
    if (v.startsWith('sb:')) { this.patch({ branchId: '', subBranchId: v.substring(3) }); return; }
    if (v.startsWith('b:')) { this.patch({ branchId: v.substring(2), subBranchId: '' }); }
  }

  submit() {
    if (!this.canCreate()) return;
    const i = this._form();
    this._saving.set(true);
    this._usernameError.set(null);
    this.api.post<CreateResult>('/api/users', {
      username: i.username.trim().toLowerCase(),
      password: i.password,
      title: i.title || undefined,
      firstName: i.firstName || undefined,
      fathersName: i.fathersName || undefined,
      phone: i.phone || undefined,
      roleIds: i.roleIds,
      branchId: i.branchId || undefined,
      subBranchId: i.subBranchId || undefined,
      // OPD: send the doctor profile only when a doctor role was selected.
      doctorProfile: this.isDoctorSelected() ? {
        medicalRegNo: this.doctorReg().trim() || undefined,
        department: this.doctorDept().trim() || undefined,
        specializations: this.doctorSpecs(),
        procedures: this.doctorProcs(),
      } : undefined,
    }).subscribe({
      next: u => {
        this._saving.set(false);
        this.toasts.success(`${u.displayName || u.username} created. Share the password with them securely.`);
        this.back();
      },
      error: e => {
        this._saving.set(false);
        const err = ApiError.from(e);
        // Field-level failures land on the offending input; anything else toasts.
        if (err.field === 'username' || err.code === 'username_exists' || err.code === 'invalid_username') {
          this._usernameError.set(err.message);
        } else if (err.field === 'password' || err.code === 'weak_password') {
          this._passwordError.set(err.message);
        } else {
          this.toasts.error(err.message);
        }
      }
    });
  }
}
