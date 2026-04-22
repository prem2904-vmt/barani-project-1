import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Branch, SubBranch } from '../../../shared/models/tenant.model';
import { Role, User } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface InviteForm {
  name: string;
  email: string;
  phone: string;
  roleId: string;
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
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin · Users"
        title="Invite user"
        subtitle="Send a sign-in invite and pick the role and branch scope.">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="!canInvite() || saving()" (pressed)="submit()">
          {{ saving() ? 'Sending…' : 'Send invite' }}
        </pf-touch-btn>
      </pf-screen-header>

      <pf-tile tone="default" padding="lg" class="block">
        <div class="space-y-3">
          <div>
            <label class="pf-label">Name</label>
            <input type="text" class="pf-input"
                   [ngModel]="form().name" (ngModelChange)="patch({ name: $event })" />
          </div>
          <div>
            <label class="pf-label">Email</label>
            <input type="email" class="pf-input"
                   [ngModel]="form().email" (ngModelChange)="patch({ email: $event })" />
          </div>
          <div>
            <label class="pf-label">Phone</label>
            <input type="tel" class="pf-input"
                   [ngModel]="form().phone" (ngModelChange)="patch({ phone: $event })" />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label class="pf-label">Role</label>
              <pf-select [options]="roleOptions()" [value]="form().roleId"
                         placeholder="— Select role —"
                         (valueChange)="patch({ roleId: $event })"></pf-select>
            </div>
            <div>
              <label class="pf-label">Scope</label>
              <pf-select [options]="scopeOptions()" [value]="scopeValue()"
                         placeholder="All branches"
                         (valueChange)="onScopeChange($event)"></pf-select>
              <p class="text-[11px] mt-1" style="color: var(--text-muted);">
                Pick a sub-branch (indented →) to scope the user to that lab only.
              </p>
            </div>
          </div>
        </div>
      </pf-tile>
    </section>
  `
})
export class UserInviteComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  private readonly _roles = signal<Role[]>([]);
  private readonly _branches = signal<Branch[]>([]);
  private readonly _form = signal<InviteForm>({ name: '', email: '', phone: '', roleId: '', branchId: '', subBranchId: '' });
  private readonly _saving = signal(false);

  readonly form = this._form.asReadonly();
  readonly saving = this._saving.asReadonly();

  readonly roleOptions = computed<PfSelectOption<string>[]>(() =>
    this._roles().map(r => ({ value: r.id, label: r.name }))
  );

  // Hierarchical scope picker: encodes as `b:<id>` for branch, `sb:<id>` for sub-branch.
  // Keeps a single select while letting the admin target either level.
  readonly scopeOptions = computed<PfSelectOption<string>[]>(() => {
    const out: PfSelectOption<string>[] = [{ value: '', label: 'All branches' }];
    for (const b of this._branches()) {
      out.push({ value: `b:${b.id}`, label: b.name });
      for (const sb of b.subBranches ?? []) {
        out.push({ value: `sb:${sb.id}`, label: `  → ${sb.name}` });
      }
    }
    return out;
  });
  readonly scopeValue = computed(() => {
    const i = this._form();
    if (i.subBranchId) return `sb:${i.subBranchId}`;
    if (i.branchId) return `b:${i.branchId}`;
    return '';
  });

  readonly canInvite = computed(() => {
    const i = this._form();
    return i.name.trim().length > 0 && i.email.trim().length > 0 && !!i.roleId;
  });

  ngOnInit() {
    this.api.get<Role[]>('/api/roles/').subscribe({ next: l => this._roles.set(l ?? []) });
    this.api.get<Branch[]>('/api/tenants/branches?includeSubBranches=true').subscribe({ next: l => this._branches.set(l ?? []) });
  }

  patch(p: Partial<InviteForm>) { this._form.update(v => ({ ...v, ...p })); }
  back() { this.router.navigateByUrl('/admin/users'); }

  onScopeChange(v: string) {
    if (!v) { this.patch({ branchId: '', subBranchId: '' }); return; }
    if (v.startsWith('sb:')) {
      const sbId = v.substring(3);
      // Parent branch is auto-resolved on backend when only subBranchId is sent
      this.patch({ branchId: '', subBranchId: sbId });
      return;
    }
    if (v.startsWith('b:')) {
      this.patch({ branchId: v.substring(2), subBranchId: '' });
    }
  }

  submit() {
    const i = this._form();
    this._saving.set(true);
    this.api.post<User>('/api/users/invite', {
      name: i.name, email: i.email, phone: i.phone || undefined,
      roleIds: [i.roleId],
      branchId: i.branchId || undefined,
      subBranchId: i.subBranchId || undefined
    }).subscribe({
      next: u => {
        this._saving.set(false);
        this.toasts.success(`Invited ${u.name}`);
        this.back();
      },
      error: e => {
        this._saving.set(false);
        this.toasts.error(e.message ?? 'Failed to invite');
      }
    });
  }
}
