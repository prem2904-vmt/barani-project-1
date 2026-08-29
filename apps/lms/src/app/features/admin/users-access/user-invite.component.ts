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
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { AlphaDirective } from '../../../shared/directives/alpha.directive';
import { NumericDirective } from '../../../shared/directives/numeric.directive';
import { COUNTRY_CODES, getCountryDigitLength } from '../../../shared/utils/country-codes';
import { OPD_DEPARTMENTS, SPECIALIZATION_SUGGESTIONS } from '../../../shared/opd/medical-catalog';
import { hasDoctorRole } from '../../../shared/opd/doctor-role';

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
    TileComponent,
    TouchButtonComponent,
    AlphaDirective,
    NumericDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin · Users"
        title="Create user"
        parentRoute="/admin/users?tab=users"
        subtitle="Set a username and password, pick the roles and branch scope. Share the password with them — there's no email.">
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="!canCreate() || saving()" (pressed)="submit()">
          {{ saving() ? 'Creating…' : 'Create user' }}
        </pf-touch-btn>
      </pf-screen-header>

      <pf-tile tone="default" padding="lg" class="block">
        <div class="space-y-3">
          <p class="text-[11px]" style="color: var(--text-muted);"><span class="pf-req">*</span> required</p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="pf-label">Title</label>
              <select class="pf-input"
                      [ngModel]="form().title" (ngModelChange)="patch({ title: $event })">
                <option value="">—</option>
                <option value="Dr.">Dr.</option>
                <option value="Mr.">Mr.</option>
                <option value="Mrs.">Mrs.</option>
                <option value="Ms.">Ms.</option>
              </select>
            </div>
            <div>
              <label class="pf-label">First name</label>
              <input type="text" pfAlpha class="pf-input"
                     placeholder="e.g. Prem"
                     [ngModel]="form().firstName" (ngModelChange)="patch({ firstName: $event })" />
            </div>
            <div>
              <label class="pf-label">Last name</label>
              <input type="text" pfAlpha class="pf-input"
                     placeholder="e.g. Kumar"
                     [ngModel]="form().fathersName" (ngModelChange)="patch({ fathersName: $event })" />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="pf-label">Username <span class="pf-req">*</span></label>
              <input type="text" pfAlpha [allowNumbers]="true" class="pf-input" autocomplete="off" autocapitalize="none" spellcheck="false"
                     [class.pf-input-error]="!!usernameError()"
                     placeholder="e.g. drpriya"
                     [ngModel]="form().username" (ngModelChange)="onUsernameChange($event)" (blur)="onUsernameBlur()" />
              @if (usernameError()) { <p class="pf-field-error">{{ usernameError() }}</p> }
              <p class="text-[11px] mt-1" style="color: var(--text-muted);">
                3–32 characters: alphanumeric (letters and digits only). This is what they type to sign in.
              </p>
            </div>
            <div>
              <label class="pf-label">Phone</label>
              <div class="flex gap-2 items-center">
                <select class="pf-input max-w-[105px] shrink-0 text-[13px]"
                        [ngModel]="countryCode()" (ngModelChange)="onCountryCodeChange($event)">
                  @for (c of countryCodes; track c.code) {
                    <option [value]="c.code">{{ c.code }} {{ c.flag }}</option>
                  }
                </select>
                <input type="tel" pfNumeric [maxDigits]="phoneMaxDigits()" [attr.maxlength]="phoneMaxDigits()" class="pf-input flex-1"
                       [placeholder]="phoneMaxDigits() + '-digit mobile number'"
                       [ngModel]="phoneDigits()" (ngModelChange)="onPhoneChange($event)" />
              </div>
            </div>
          </div>

          <div>
            <label class="pf-label">Password <span class="pf-req">*</span></label>
            <input type="text" class="pf-input" autocomplete="off"
                   [class.pf-input-error]="!!passwordError()"
                   placeholder="Minimum 8 characters"
                   [ngModel]="form().password" (ngModelChange)="onPasswordChange($event)" />
            @if (passwordError()) { <p class="pf-field-error">{{ passwordError() }}</p> }
            <p class="text-[11px] mt-1" style="color: var(--text-muted);">
              Share this with the user securely — they can change it after signing in, and you can reset it anytime.
            </p>
          </div>

          <div>
            <label class="pf-label">Roles <span class="pf-req">*</span></label>
            <div class="pf-roles">
              @for (r of roleOptions(); track r.value) {
                <label class="pf-role-chip" [class.pf-role-chip--on]="hasRole(r.value)">
                  <input type="checkbox" [checked]="hasRole(r.value)" (change)="toggleRole(r.value)" />
                  <span>{{ r.label }}</span>
                </label>
              }
            </div>
            <p class="text-[11px] mt-1" style="color: var(--text-muted);">
              Pick one or more roles — the user gets the combined permissions of all selected roles.
            </p>
          </div>

          <!-- Doctor details (OPD build) — appears only when a doctor-type role
               is ticked; all fields optional. -->
          @if (isDoctorSelected()) {
            <div class="pf-doc">
              <h3 class="pf-doc__title">Doctor details</h3>

              <div>
                <label class="pf-label">Medical Registration No.</label>
                <input type="text" class="pf-input" [ngModel]="doctorReg()" (ngModelChange)="doctorReg.set($event)"
                       placeholder="NMC / State Medical Council reg. no." />
              </div>

              <div>
                <label class="pf-label">Department</label>
                <pf-select [options]="deptOptions()" [value]="deptSelectValue()"
                           placeholder="Select a department…" (valueChange)="onDeptChange($event)"></pf-select>
                @if (deptIsCustom()) {
                  <input type="text" class="pf-input" style="margin-top: 8px;" [ngModel]="doctorDept()"
                         (ngModelChange)="doctorDept.set($event)" placeholder="Type the department name" />
                }
              </div>

              <div>
                <label class="pf-label">Specialisation(s)</label>
                <pf-select [options]="specOptions()" [multiple]="true" [values]="doctorSpecs()"
                           placeholder="Select specialisation(s)…" (valuesChange)="doctorSpecs.set($event)"></pf-select>
              </div>

              <div>
                <label class="pf-label">Procedures / surgeries</label>
                @if (doctorProcs().length) {
                  <div class="pf-tags">
                    @for (p of doctorProcs(); track p) {
                      <span class="pf-tag">{{ p }}<button type="button" (click)="removeProc(p)" aria-label="Remove">×</button></span>
                    }
                  </div>
                }
                <input type="text" class="pf-input" [ngModel]="procDraft()"
                       (ngModelChange)="procDraft.set($event)"
                       (keydown.enter)="$event.preventDefault(); addProc(procDraft())"
                       placeholder="Type a procedure, press Enter…" />
              </div>
            </div>
          }

          <div>
            <label class="pf-label">Branch</label>
            <pf-select [options]="scopeOptions()" [value]="scopeValue()"
                       placeholder="All branches"
                       (valueChange)="onScopeChange($event)"></pf-select>
            <p class="text-[11px] mt-1" style="color: var(--text-muted);">
              Pick a sub-branch (indented →) to scope the user to that lab only.
            </p>
          </div>
        </div>
      </pf-tile>
    </section>
  `,
  styles: [`
    .pf-input-error { border-color: var(--danger, #ef4444) !important; }
    .pf-field-error { margin-top: 4px; font-size: 12px; color: var(--danger, #ef4444); }
    .pf-req { color: var(--danger, #ef4444); font-weight: 700; margin-left: 2px; }

    .pf-roles { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
    .pf-role-chip {
      display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
      padding: 8px 12px; min-height: 40px; border-radius: 10px;
      border: 1px solid transparent; font-size: 13px; color: var(--text-primary);
      transition: border-color .15s, background .15s;
    }
    .pf-role-chip input { cursor: pointer; width: 16px; height: 16px; flex: 0 0 auto; }
    .pf-role-chip--on { border-color: var(--brand, #6366f1); background: color-mix(in srgb, var(--brand, #6366f1) 12%, transparent); }
    @media (pointer: coarse) { :host .pf-role-chip { min-height: 44px; } :host .pf-role-chip input { width: 20px; height: 20px; } :host .pf-input { min-height: 44px; } }

    /* Doctor details (OPD build) */
    .pf-doc { display: flex; flex-direction: column; gap: 14px; padding: 14px;
      border-radius: 12px; border: 1px dashed var(--brand, #6366f1);
      background: color-mix(in srgb, var(--brand, #6366f1) 6%, transparent); }
    .pf-doc__title { font-size: 13px; font-weight: 700; color: var(--brand, #6366f1);
      text-transform: uppercase; letter-spacing: .04em; }
    .pf-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .pf-tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 10px;
      border-radius: 999px; font-size: 12.5px; color: var(--text-primary);
      background: color-mix(in srgb, var(--brand, #6366f1) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--brand, #6366f1) 35%, transparent); }
    .pf-tag button { border: 0; background: transparent; color: var(--text-secondary);
      font-size: 15px; line-height: 1; cursor: pointer; padding: 0 2px; }

    /* App-styled autocomplete popover (specialisation suggestions) */
    .pf-ac { position: relative; }
    .pf-ac__pop { position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; right: 0;
      max-height: 240px; overflow-y: auto; padding: 4px; border-radius: 12px;
      background: var(--surface, #0f172a);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.14));
      box-shadow: 0 16px 40px rgba(0,0,0,0.45); }
    .pf-ac__item { display: block; width: 100%; text-align: left; padding: 9px 12px;
      border: 0; border-radius: 8px; background: transparent; cursor: pointer;
      font-size: 13.5px; color: var(--text-primary, #e2e8f0); }
    .pf-ac__item:hover { background: var(--glass-bg-hover, rgba(255,255,255,0.06)); }
  `]
})
export class UserInviteComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

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
    this._roles().map(r => ({ value: r.id, label: r.name }))
  );

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
  back() { this.router.navigate(['/admin/users'], { queryParams: { tab: 'users' } }); }

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
