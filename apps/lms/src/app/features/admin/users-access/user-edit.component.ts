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

interface EditForm {
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
  imports: [FormsModule, ScreenHeaderComponent, SelectComponent, TileComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin · Users"
        [title]="'Edit ' + (loadedName() || 'user')"
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
              <label class="pf-label">First name</label>
              <input type="text" class="pf-input" [ngModel]="form().firstName" (ngModelChange)="patch({ firstName: $event })" />
            </div>
            <div>
              <label class="pf-label">Last name</label>
              <input type="text" class="pf-input" [ngModel]="form().fathersName" (ngModelChange)="patch({ fathersName: $event })" />
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
                <input type="tel" class="pf-input" [ngModel]="form().phone" (ngModelChange)="patch({ phone: $event })" />
              </div>
            } @else {
              <div class="col-span-full">
                <label class="pf-label">Phone</label>
                <input type="tel" class="pf-input" [ngModel]="form().phone" (ngModelChange)="patch({ phone: $event })" />
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
  private readonly route = inject(ActivatedRoute);
  private readonly id = this.route.snapshot.paramMap.get('id')!;

  private readonly _roles = signal<Role[]>([]);
  private readonly _branches = signal<Branch[]>([]);
  private readonly _form = signal<EditForm>({ firstName: '', fathersName: '', phone: '', roleIds: [], branchId: '', subBranchId: '' });
  private readonly _saving = signal(false);
  private readonly _username = signal('');
  private readonly _loadedName = signal('');

  readonly form = this._form.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly username = this._username.asReadonly();
  readonly loadedName = this._loadedName.asReadonly();

  readonly roleOptions = computed<PfSelectOption<string>[]>(() => this._roles().map(r => ({ value: r.id, label: r.name })));

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

  readonly canSave = computed(() => this._form().roleIds.length > 0);

  ngOnInit() {
    this.api.get<Role[]>('/api/roles/').subscribe({ next: l => this._roles.set(l ?? []) });
    this.api.get<Branch[]>('/api/tenants/branches?includeSubBranches=true').subscribe({ next: l => this._branches.set(l ?? []) });
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
          this._form.update(v => ({ ...v, firstName: u.firstName ?? '', fathersName: u.fathersName ?? '', phone: u.phone ?? '' }));
        }
        const rs = roles ?? [];
        const first = rs[0];
        this._form.update(v => ({
          ...v,
          roleIds: rs.map(r => r.roleId),
          branchId: first?.subBranchId ? '' : (first?.branchId ?? ''),
          subBranchId: first?.subBranchId ?? '',
        }));
      },
    });
  }

  patch(p: Partial<EditForm>) { this._form.update(v => ({ ...v, ...p })); }
  back() { this.router.navigateByUrl('/admin/users'); }
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
    // Details first, then roles (full-replace). Both must land for a clean save.
    this.api.patch<User>(`/api/users/${this.id}`, {
      firstName: i.firstName, fathersName: i.fathersName, phone: i.phone || undefined,
    }).subscribe({
      next: () => {
        this.api.put(`/api/users/${this.id}/roles`, {
          roleIds: i.roleIds, branchId: i.branchId || undefined, subBranchId: i.subBranchId || undefined,
        }).subscribe({
          next: () => { this._saving.set(false); this.toasts.success('User updated'); this.back(); },
          error: e => { this._saving.set(false); this.toasts.error(this.msg(e) ?? 'Saved details, but roles failed'); },
        });
      },
      error: e => { this._saving.set(false); this.toasts.error(this.msg(e) ?? 'Could not save'); },
    });
  }

  private msg(e: any): string | undefined { return e?.error?.message ?? e?.message; }
}
