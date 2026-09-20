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
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { ApiError } from '../../../shared/models/api-response.model';
import { AlphaDirective } from '../../../shared/directives/alpha.directive';
import { NumericDirective } from '../../../shared/directives/numeric.directive';
import { COUNTRY_CODES, getCountryDigitLength, parsePhoneNumber } from '../../../shared/utils/country-codes';
import { NavBackService } from '../../../core/services/nav-back.service';

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
        [title]="'Edit ' + (loadedName() || 'user')"
        parentRoute="/admin/users?tab=users"
        subtitle="Update the user's details, roles and branch scope.">
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="!canSave() || saving()" (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save changes' }}
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
                     [class.pf-input-error]="!!fieldError()['firstName']"
                     placeholder="e.g. Prem"
                     [ngModel]="form().firstName" (ngModelChange)="patch({ firstName: $event })" />
              @if (fieldError()['firstName']; as msg) { <p class="pf-field-error">{{ msg }}</p> }
            </div>
            <div>
              <label class="pf-label">Last name</label>
              <input type="text" pfAlpha class="pf-input"
                     [class.pf-input-error]="!!fieldError()['fathersName']"
                     placeholder="e.g. Kumar"
                     [ngModel]="form().fathersName" (ngModelChange)="patch({ fathersName: $event })" />
              @if (fieldError()['fathersName']; as msg) { <p class="pf-field-error">{{ msg }}</p> }
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            @if (username()) {
              <div>
                <label class="pf-label">Username</label>
                <input type="text" class="pf-input" [value]="username()" disabled />
                <p class="text-[11px] mt-1" style="color: var(--text-muted);">The login handle can't be changed. Use “Reset password” to issue a new password.</p>
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
                         [class.pf-input-error]="!!fieldError()['phone']"
                         [placeholder]="phoneMaxDigits() + '-digit mobile number'"
                         [ngModel]="phoneDigits()" (ngModelChange)="onPhoneChange($event)" />
                </div>
                @if (fieldError()['phone']; as msg) { <p class="pf-field-error">{{ msg }}</p> }
              </div>
            } @else {
              <div class="col-span-full">
                <label class="pf-label">Phone</label>
                <div class="flex gap-2 items-center">
                  <select class="pf-input max-w-[105px] shrink-0 text-[13px]"
                          [ngModel]="countryCode()" (ngModelChange)="onCountryCodeChange($event)">
                    @for (c of countryCodes; track c.code) {
                      <option [value]="c.code">{{ c.code }} {{ c.flag }}</option>
                    }
                  </select>
                  <input type="tel" pfNumeric [maxDigits]="phoneMaxDigits()" [attr.maxlength]="phoneMaxDigits()" class="pf-input flex-1"
                         [class.pf-input-error]="!!fieldError()['phone']"
                         [placeholder]="phoneMaxDigits() + '-digit mobile number'"
                         [ngModel]="phoneDigits()" (ngModelChange)="onPhoneChange($event)" />
                </div>
                @if (fieldError()['phone']; as msg) { <p class="pf-field-error">{{ msg }}</p> }
              </div>
            }
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
          </div>
          <div>
            <label class="pf-label">Branch</label>
            <pf-select [options]="scopeOptions()" [value]="scopeValue()" placeholder="All branches" (valueChange)="onScopeChange($event)"></pf-select>
          </div>
        </div>
      </pf-tile>
    </section>
  `,
  styles: [`
    .pf-req { color: var(--danger, #ef4444); font-weight: 700; margin-left: 2px; }
    .pf-input-error { border-color: var(--danger, #ef4444) !important; }
    .pf-field-error { margin-top: 4px; font-size: 12px; color: var(--danger, #ef4444); }
    .pf-roles { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
    .pf-role-chip { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; padding: 8px 12px; min-height: 40px; border-radius: 10px; border: 1px solid transparent; font-size: 13px; color: var(--text-primary); transition: border-color .15s, background .15s; }
    .pf-role-chip input { cursor: pointer; width: 16px; height: 16px; flex: 0 0 auto; }
    .pf-role-chip--on { border-color: var(--brand, #6366f1); background: color-mix(in srgb, var(--brand, #6366f1) 12%, transparent); }
    @media (pointer: coarse) { :host .pf-role-chip { min-height: 44px; } :host .pf-role-chip input { width: 20px; height: 20px; } :host .pf-input { min-height: 44px; } }
  `]
})
export class UserEditComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
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

  readonly roleOptions = computed<PfSelectOption<string>[]>(() => this._roles().map(r => ({ value: r.id, label: r.name })));

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
