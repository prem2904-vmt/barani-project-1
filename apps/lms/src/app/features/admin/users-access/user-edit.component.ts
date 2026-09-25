import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Branch } from '../../../shared/models/tenant.model';
import { Role, User } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { ApiError } from '../../../shared/models/api-response.model';
import { AlphaDirective } from '../../../shared/directives/alpha.directive';
import { NumericDirective } from '../../../shared/directives/numeric.directive';
import { COUNTRY_CODES, getCountryDigitLength, parsePhoneNumber } from '../../../shared/utils/country-codes';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ROLE_INFO } from './permission-catalog';
import { TITLE_OPTIONS, USER_FORM_STYLES } from './user-form.styles';

interface EditForm {
  /** Honorific ("Dr." for doctors, etc.) — prefixes every mention of the name. */
  title: string;
  firstName: string;
  fathersName: string;
  phone: string;
  roleIds: string[];
  branchId: string;
  subBranchId: string;
}

@Component({
  selector: 'pf-user-edit',
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
             the CONTEXT BAR (the user being edited as read-only chips). -->
        <pf-hero-band [back]="true" [backTo]="'/admin/users?tab=users'" [customSearch]="true" [contextBar]="true">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-uf-primary press"
                    [disabled]="!canSave() || saving()" (click)="save()"
                    [attr.aria-label]="saving() ? 'Saving' : 'Save changes'" title="Save changes">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
              {{ saving() ? 'Saving…' : 'Save changes' }}
            </button>
          </ng-container>
          <div band-search class="nd-ctx pf-uf-ctx">
            <span class="nd-ctx__primary pf-uf-ctx__name">{{ displayPreview() || loadedName() || 'User' }}</span>
            @if (username()) {
              <span class="nd-ctx__chip" data-k="Username"><span class="nd-ctx__k">Username</span><span class="nd-num">{{ username() }}</span></span>
            }
            <span class="nd-ctx__chip" data-k="Roles"><span class="nd-ctx__k">Roles</span><span>{{ rolesSummary() }}</span></span>
            <span class="nd-ctx__chip" data-k="Branch"><span class="nd-ctx__k">Branch</span><span>{{ scopeLabel() }}</span></span>
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin · Users"
        [title]="'Edit ' + (loadedName() || 'user')"
        parentRoute="/admin/users?tab=users"
        subtitle="Update the user's details, roles and branch scope.">
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="!canSave() || saving()" (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save changes' }}
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
                    <input type="text" pfAlpha class="nd-input" [class.nd-input--error]="!!fieldError()['firstName']"
                           placeholder="e.g. Prem" [ngModel]="form().firstName" (ngModelChange)="patch({ firstName: $event })" />
                    @if (fieldError()['firstName']; as msg) { <p class="pf-uf-err">{{ msg }}</p> }
                  </label>
                  <label class="nd-field">
                    <span class="nd-field__lbl">Last name</span>
                    <input type="text" pfAlpha class="nd-input" [class.nd-input--error]="!!fieldError()['fathersName']"
                           placeholder="e.g. Kumar" [ngModel]="form().fathersName" (ngModelChange)="patch({ fathersName: $event })" />
                    @if (fieldError()['fathersName']; as msg) { <p class="pf-uf-err">{{ msg }}</p> }
                  </label>
                  @if (username()) {
                    <label class="nd-field">
                      <span class="nd-field__lbl">Username</span>
                      <input type="text" class="nd-input nd-num" [value]="username()" readonly aria-readonly="true" />
                      <p class="nd-field__hint">The login handle can't be changed. Use “Reset password” in Users to issue a new password.</p>
                    </label>
                  }
                  <div class="nd-field" [class.pf-uf-span]="!username()">
                    <span class="nd-field__lbl">Phone</span>
                    <div class="pf-uf-phone">
                      <pf-select class="pf-uf-phone__cc" [options]="countryOptions" [value]="countryCode()"
                                 [searchable]="true" (valueChange)="onCountryCodeChange($any($event))"></pf-select>
                      <input type="tel" pfNumeric [maxDigits]="phoneMaxDigits()" [attr.maxlength]="phoneMaxDigits()"
                             class="nd-input nd-num pf-uf-phone__num" aria-label="Mobile number"
                             [class.nd-input--error]="!!fieldError()['phone']"
                             [placeholder]="phoneMaxDigits() + '-digit mobile number'"
                             [ngModel]="phoneDigits()" (ngModelChange)="onPhoneChange($event)" />
                    </div>
                    @if (fieldError()['phone']; as msg) { <p class="pf-uf-err">{{ msg }}</p> }
                  </div>
                </div>
              </div>
            </section>

            <!-- BRANCH -->
            <section class="nd-card pf-uf-card">
              <div class="nd-card__head">
                <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg></span>
                <h2 class="nd-card__label pf-uf-h">Branch scope</h2>
              </div>
              <div class="nd-card__body">
                <div class="nd-field">
                  <span class="nd-field__lbl">Branch</span>
                  <pf-select [options]="scopeOptions()" [value]="scopeValue()" placeholder="All branches" (valueChange)="onScopeChange($event)"></pf-select>
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
        </div>
      </div>
    </section>
  `,
  styles: [USER_FORM_STYLES]
})
export class UserEditComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  protected readonly theme = inject(ThemeService);
  private readonly route = inject(ActivatedRoute);
  private readonly id = this.route.snapshot.paramMap.get('id')!;

  private readonly _roles = signal<Role[]>([]);
  private readonly _branches = signal<Branch[]>([]);
  private readonly _form = signal<EditForm>({ title: '', firstName: '', fathersName: '', phone: '', roleIds: [], branchId: '', subBranchId: '' });
  private readonly _saving = signal(false);
  private readonly _username = signal('');
  private readonly _loadedName = signal('');
  private readonly _fieldError = signal<Record<string, string>>({});

  readonly countryCodes = COUNTRY_CODES;
  readonly countryCode = signal<string>('+91');
  readonly phoneDigits = signal<string>('');
  readonly phoneMaxDigits = computed(() => getCountryDigitLength(this.countryCode()));

  readonly form = this._form.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly username = this._username.asReadonly();
  readonly loadedName = this._loadedName.asReadonly();
  readonly fieldError = this._fieldError.asReadonly();

  readonly roleOptions = computed<PfSelectOption<string>[]>(() =>
    this._roles().map(r => ({ value: r.id, label: r.name, hint: ROLE_INFO[r.name] ?? undefined })));
  readonly titleOptions: PfSelectOption<string>[] = TITLE_OPTIONS;
  /** Country codes as pf-select options (code + country; no flag emoji). */
  readonly countryOptions: PfSelectOption<string>[] = COUNTRY_CODES.map(c => ({ value: c.code, label: c.code, hint: c.country }));

  // ── Context bar (new design) ──
  readonly displayPreview = computed(() => {
    const f = this._form();
    return [f.title, f.firstName, f.fathersName].map(x => (x ?? '').trim()).filter(Boolean).join(' ');
  });
  readonly rolesSummary = computed(() => {
    const ids = this._form().roleIds;
    if (!ids.length) return 'None';
    const names = this._roles().filter(r => ids.includes(r.id)).map(r => r.name);
    return names.length ? names.join(', ') : `${ids.length}`;
  });
  readonly scopeLabel = computed(() => {
    const v = this.scopeValue();
    const o = this.scopeOptions().find(x => x.value === v);
    return (o?.label ?? 'All branches').replace(/^\s*→\s*/, '').trim() || 'All branches';
  });

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

  readonly canSave = computed(() => this._form().roleIds.length > 0);

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

        if (totalCount === 1 && !this._form().branchId && !this._form().subBranchId) {
          if (singleVal.startsWith('sb:')) {
            this.patch({ branchId: '', subBranchId: singleVal.substring(3) });
          } else if (singleVal.startsWith('b:')) {
            this.patch({ branchId: singleVal.substring(2), subBranchId: '' });
          }
        }
      }
    });
    // No single-user GET endpoint — read the list + this user's role assignments.
    forkJoin({
      users: this.api.get<User[]>('/api/users/'),
      roles: this.api.get<{ roleId: string; branchId?: string; subBranchId?: string }[]>(`/api/users/${this.id}/roles`),
    }).subscribe({
      next: ({ users, roles }) => {
        const u = (users ?? []).find(x => x.id === this.id);
        if (u) {
          this._loadedName.set(u.displayName || u.firstName || u.username || '');
          this._username.set(u.username || '');
          this._form.update(v => ({ ...v, title: u.title ?? '', firstName: u.firstName ?? '', fathersName: u.fathersName ?? '', phone: u.phone ?? '' }));

          if (u.phone) {
            const parsed = parsePhoneNumber(u.phone);
            this.countryCode.set(parsed.code);
            this.phoneDigits.set(parsed.digits);
          }
        }
        const rs = roles ?? [];
        const first = rs[0];
        let branchId = first?.subBranchId ? '' : (first?.branchId ?? '');
        let subBranchId = first?.subBranchId ?? '';

        // If user has no branch set and tenant has only 1 branch, auto-set it
        const branches = this._branches();
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
        if (totalCount === 1 && !branchId && !subBranchId) {
          if (singleVal.startsWith('sb:')) {
            subBranchId = singleVal.substring(3);
          } else if (singleVal.startsWith('b:')) {
            branchId = singleVal.substring(2);
          }
        }

        this._form.update(v => ({
          ...v,
          roleIds: rs.map(r => r.roleId),
          branchId,
          subBranchId,
        }));
      },
    });
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

  patch(p: Partial<EditForm>) {
    this._form.update(v => ({ ...v, ...p }));
    // Editing a field clears its stale inline error.
    const keys = Object.keys(p);
    if (keys.length) this._fieldError.update(fe => { const n = { ...fe }; for (const k of keys) delete n[k]; return n; });
  }
  back() { this.navBack.backTo('/admin/users?tab=users'); }
  hasRole(id: string) { return this._form().roleIds.includes(id); }
  toggleRole(id: string) {
    this._form.update(v => ({ ...v, roleIds: v.roleIds.includes(id) ? v.roleIds.filter(r => r !== id) : [...v.roleIds, id] }));
  }
  onScopeChange(v: string) {
    if (!v) { this.patch({ branchId: '', subBranchId: '' }); return; }
    if (v.startsWith('sb:')) { this.patch({ branchId: '', subBranchId: v.substring(3) }); return; }
    if (v.startsWith('b:')) { this.patch({ branchId: v.substring(2), subBranchId: '' }); }
  }

  save() {
    if (!this.canSave()) return;
    const i = this._form();
    this._saving.set(true);
    this._fieldError.set({});
    // Details first, then roles (full-replace). Both must land for a clean save.
    this.api.patch<User>(`/api/users/${this.id}`, {
      title: i.title, firstName: i.firstName, fathersName: i.fathersName, phone: i.phone || undefined,
    }).subscribe({
      next: () => {
        this.api.put(`/api/users/${this.id}/roles`, {
          roleIds: i.roleIds, branchId: i.branchId || undefined, subBranchId: i.subBranchId || undefined,
        }).subscribe({
          next: () => { this._saving.set(false); this.toasts.success('User updated'); this.back(); },
          error: e => { this._saving.set(false); this.showError(e); },
        });
      },
      error: e => { this._saving.set(false); this.showError(e); },
    });
  }

  /** Route field-named backend failures to the offending input; toast the rest. */
  private showError(e: unknown) {
    const err = ApiError.from(e);
    const inputs = ['firstName', 'fathersName', 'phone'];
    if (err.field && inputs.includes(err.field)) {
      this._fieldError.update(fe => ({ ...fe, [err.field!]: err.message }));
    } else {
      this.toasts.error(err.message);
    }
  }
}
