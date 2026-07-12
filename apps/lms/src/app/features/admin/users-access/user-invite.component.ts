import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Branch } from '../../../shared/models/tenant.model';
import { Role } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface CreateResult { id: string; username: string; displayName: string; }

interface CreateForm {
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
  imports: [FormsModule, ScreenHeaderComponent, SelectComponent, TileComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin · Users"
        title="Create user"
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
              <label class="pf-label">First name</label>
              <input type="text" class="pf-input"
                     [ngModel]="form().firstName" (ngModelChange)="patch({ firstName: $event })" />
            </div>
            <div>
              <label class="pf-label">Last name</label>
              <input type="text" class="pf-input"
                     [ngModel]="form().fathersName" (ngModelChange)="patch({ fathersName: $event })" />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="pf-label">Username <span class="pf-req">*</span></label>
              <input type="text" class="pf-input" autocomplete="off" autocapitalize="none" spellcheck="false"
                     [class.pf-input-error]="!!usernameError()"
                     placeholder="e.g. drpriya"
                     [ngModel]="form().username" (ngModelChange)="onUsernameChange($event)" />
              @if (usernameError()) { <p class="pf-field-error">{{ usernameError() }}</p> }
              <p class="text-[11px] mt-1" style="color: var(--text-muted);">
                3–32 characters: lowercase letters, digits, dot, underscore or hyphen. This is what they type to sign in.
              </p>
            </div>
            <div>
              <label class="pf-label">Phone</label>
              <input type="tel" class="pf-input"
                     [ngModel]="form().phone" (ngModelChange)="patch({ phone: $event })" />
            </div>
          </div>

          <div>
            <label class="pf-label">Password <span class="pf-req">*</span></label>
            <input type="text" class="pf-input" autocomplete="off"
                   placeholder="Minimum 8 characters"
                   [ngModel]="form().password" (ngModelChange)="patch({ password: $event })" />
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
  `]
})
export class UserInviteComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  private readonly _roles = signal<Role[]>([]);
  private readonly _branches = signal<Branch[]>([]);
  private readonly _form = signal<CreateForm>({
    username: '', password: '', firstName: '', fathersName: '', phone: '',
    roleIds: [], branchId: '', subBranchId: ''
  });
  private readonly _saving = signal(false);
  private readonly _usernameError = signal<string | null>(null);

  readonly form = this._form.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly usernameError = this._usernameError.asReadonly();

  readonly roleOptions = computed<PfSelectOption<string>[]>(() =>
    this._roles().map(r => ({ value: r.id, label: r.name }))
  );

  readonly scopeOptions = computed<PfSelectOption<string>[]>(() => {
    const out: PfSelectOption<string>[] = [{ value: '', label: 'All branches' }];
    for (const b of this._branches()) {
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
    if (!/^[a-z0-9._-]{3,32}$/.test(i.username.trim().toLowerCase())) return false;
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
    this.api.get<Branch[]>('/api/tenants/branches?includeSubBranches=true').subscribe({ next: l => this._branches.set(l ?? []) });
  }

  patch(p: Partial<CreateForm>) { this._form.update(v => ({ ...v, ...p })); }
  back() { this.router.navigateByUrl('/admin/users'); }

  // Force lowercase (usernames are case-insensitive) + clear a stale error.
  onUsernameChange(v: string) {
    if (this._usernameError()) this._usernameError.set(null);
    this.patch({ username: (v || '').toLowerCase() });
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
      firstName: i.firstName || undefined,
      fathersName: i.fathersName || undefined,
      phone: i.phone || undefined,
      roleIds: i.roleIds,
      branchId: i.branchId || undefined,
      subBranchId: i.subBranchId || undefined,
    }).subscribe({
      next: u => {
        this._saving.set(false);
        this.toasts.success(`${u.displayName || u.username} created. Share the password with them securely.`);
        this.back();
      },
      error: e => {
        this._saving.set(false);
        const code = e?.error?.error as string | undefined;
        const message = (e?.error?.message as string | undefined) ?? e?.message ?? 'Could not create the user';
        // A taken username is a field-level problem — surface it on the input.
        if (code === 'username_exists' || /already taken|already exists/i.test(message)) {
          this._usernameError.set(message);
        } else {
          this.toasts.error(message);
        }
      }
    });
  }
}
