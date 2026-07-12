import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Branch, SubBranch } from '../../../shared/models/tenant.model';
import { Role } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

type InviteMethod = 'email' | 'password';

interface InviteResult {
  id: string; email: string; username?: string; displayName: string;
  method: 'email' | 'password'; inviteSent: boolean; inviteError?: string | null;
}

interface InviteForm {
  firstName: string;
  fathersName: string;
  email: string;
  phone: string;
  roleIds: string[];
  branchId: string;
  subBranchId: string;
  method: InviteMethod;
  password: string;
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
          <p class="text-[11px]" style="color: var(--text-muted);"><span class="pf-req">*</span> required</p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label class="pf-label">First name <span class="pf-req">*</span></label>
              <input type="text" class="pf-input"
                     [ngModel]="form().firstName" (ngModelChange)="patch({ firstName: $event })" />
            </div>
            <div>
              <label class="pf-label">Father's name</label>
              <input type="text" class="pf-input"
                     [ngModel]="form().fathersName" (ngModelChange)="patch({ fathersName: $event })" />
            </div>
          </div>
          <div>
            <label class="pf-label">Email <span class="pf-req">*</span></label>
            <input type="email" class="pf-input"
                   [class.pf-input-error]="!!emailError()"
                   [ngModel]="form().email" (ngModelChange)="onEmailChange($event)" />
            @if (emailError()) {
              <p class="pf-field-error">{{ emailError() }}</p>
            }
          </div>
          <div>
            <label class="pf-label">Phone</label>
            <input type="tel" class="pf-input"
                   [ngModel]="form().phone" (ngModelChange)="patch({ phone: $event })" />
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
            <label class="pf-label">Scope</label>
            <pf-select [options]="scopeOptions()" [value]="scopeValue()"
                       placeholder="All branches"
                       (valueChange)="onScopeChange($event)"></pf-select>
            <p class="text-[11px] mt-1" style="color: var(--text-muted);">
              Pick a sub-branch (indented →) to scope the user to that lab only.
            </p>
          </div>

          <div class="pf-method">
            <label class="pf-label">Access method</label>
            <div class="pf-method-choices">
              <label class="pf-radio">
                <input type="radio" name="method" value="email"
                       [checked]="form().method === 'email'"
                       (change)="patch({ method: 'email', password: '' })" />
                <span>Send Supabase invite email (user sets their own password)</span>
              </label>
              <label class="pf-radio">
                <input type="radio" name="method" value="password"
                       [checked]="form().method === 'password'"
                       (change)="patch({ method: 'password' })" />
                <span>Set password now (I'll share it with them)</span>
              </label>
            </div>
            @if (form().method === 'password') {
              <label class="pf-label" style="margin-top:8px">Password <span class="pf-req">*</span></label>
              <input type="text" class="pf-input" autocomplete="off"
                     placeholder="Minimum 6 characters"
                     [ngModel]="form().password" (ngModelChange)="patch({ password: $event })" />
              <p class="text-[11px] mt-1" style="color: var(--text-muted);">
                Copy this before submitting — it won't be shown again.
              </p>
            }
          </div>
        </div>
      </pf-tile>
    </section>
  `,
  styles: [`
    .pf-method { margin-top: 12px; padding-top: 14px; border-top: 1px solid var(--glass-border); }
    .pf-method-choices { display: flex; flex-direction: column; gap: 6px; margin: 6px 0 10px; }
    .pf-radio { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-primary); cursor: pointer; }
    .pf-radio input { cursor: pointer; }

    /* Inline field-level validation (e.g. duplicate email) so the failure lands
       on the offending input instead of only as a transient toast. */
    .pf-input-error { border-color: var(--danger, #ef4444) !important; }
    .pf-field-error { margin-top: 4px; font-size: 12px; color: var(--danger, #ef4444); }

    /* Required-field marker */
    .pf-req { color: var(--danger, #ef4444); font-weight: 700; margin-left: 2px; }

    /* Multi-role picker: wrapping selectable chips (checkbox-backed). */
    .pf-roles { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
    .pf-role-chip {
      display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
      padding: 8px 12px; min-height: 40px; border-radius: 10px;
      border: 1px solid var(--glass-border); font-size: 13px; color: var(--text-primary);
      transition: border-color .15s, background .15s;
    }
    .pf-role-chip input { cursor: pointer; width: 16px; height: 16px; flex: 0 0 auto; }
    .pf-role-chip--on { border-color: var(--brand, #6366f1); background: color-mix(in srgb, var(--brand, #6366f1) 12%, transparent); }
    @media (pointer: coarse) { :host .pf-role-chip { min-height: 44px; } :host .pf-role-chip input { width: 20px; height: 20px; } }

    /* ===== Cross-platform overrides (additive only; desktop >=1280 untouched) ===== */

    /* Phone: give radio rows comfortable >=44px tap targets and keep the
       circle pinned to the top while long labels wrap (16px input font is a
       global guard, so it is intentionally not re-declared here). */
    @media (max-width: 640px) {
      :host .pf-radio { min-height: 44px; padding: 6px 0; align-items: flex-start; line-height: 1.35; }
      :host .pf-radio span { min-width: 0; }
      :host .pf-method-choices { gap: 2px; }
    }

    /* Coarse pointers (touch on any size): enlarge the native radio control so
       the hit area is finger-friendly without affecting mouse/desktop. */
    @media (pointer: coarse) {
      :host .pf-radio input { width: 20px; height: 20px; flex: 0 0 auto; margin-top: 2px; }
      /* Text inputs get the global 16px font bump but no min-height; give them a
         comfortable >=44px touch target on this form (scoped to :host so the
         shared .pf-input baseline and desktop are untouched). */
      :host .pf-input { min-height: 44px; }
    }
  `]
})
export class UserInviteComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  private readonly _roles = signal<Role[]>([]);
  private readonly _branches = signal<Branch[]>([]);
  private readonly _form = signal<InviteForm>({
    firstName: '', fathersName: '', email: '', phone: '',
    roleIds: [], branchId: '', subBranchId: '',
    method: 'email', password: ''
  });
  private readonly _saving = signal(false);
  private readonly _emailError = signal<string | null>(null);

  readonly form = this._form.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly emailError = this._emailError.asReadonly();

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

  // Required: first name, email, at least one role, and (password method only) a
  // 6+ char password. Father's name and phone are optional.
  readonly canInvite = computed(() => {
    const i = this._form();
    if (i.firstName.trim().length === 0) return false;
    if (i.email.trim().length === 0 || i.roleIds.length === 0) return false;
    if (i.method === 'password' && i.password.length < 6) return false;
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

  patch(p: Partial<InviteForm>) { this._form.update(v => ({ ...v, ...p })); }
  back() { this.router.navigateByUrl('/admin/users'); }

  // Clear a stale duplicate-email error as soon as the admin edits the address.
  onEmailChange(v: string) {
    if (this._emailError()) this._emailError.set(null);
    this.patch({ email: v });
  }

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
    this._emailError.set(null);
    this.api.post<InviteResult>('/api/users/invite', {
      firstName: i.firstName,
      fathersName: i.fathersName,
      email: i.email,
      phone: i.phone || undefined,
      roleIds: i.roleIds,
      branchId: i.branchId || undefined,
      subBranchId: i.subBranchId || undefined,
      password: i.method === 'password' ? i.password : undefined
    }).subscribe({
      next: u => {
        this._saving.set(false);
        if (i.method === 'password') {
          this.toasts.success(`${u.displayName} created. Share the password with them securely.`);
        } else if (u.inviteSent) {
          this.toasts.success(`Invite email sent to ${u.email}`);
        } else {
          // The account was created but Supabase didn't send the email — tell the
          // truth instead of a false "sent", so the admin can resend or set a
          // password. (Common causes: Supabase email rate limit / no SMTP set up.)
          this.toasts.error(`User created, but the invite email failed to send${u.inviteError ? ': ' + u.inviteError : ''}. Reset their password to share credentials instead.`);
        }
        this.back();
      },
      error: e => {
        this._saving.set(false);
        const body = e?.error;
        const code = body?.error as string | undefined;
        const message = (body?.message as string | undefined) ?? e?.message ?? 'Failed to invite';
        // A duplicate email is a field-level problem — surface it on the email
        // input rather than as a transient toast the admin might miss.
        if (code === 'email_exists' || /already exists/i.test(message)) {
          this._emailError.set(message);
        } else {
          this.toasts.error(message);
        }
      }
    });
  }
}
