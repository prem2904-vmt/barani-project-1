import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';

/** The bits of a user the account actions need. */
export interface AccountActionUser {
  id: string;
  displayName?: string | null;
  firstName?: string | null;
}

/**
 * Account actions shared by the Users list (row actions) and the Edit-user
 * page (band secondaries): reset password, deactivate, reactivate — the SAME
 * confirms, calls and toasts in both places. Each resolves `true` only when
 * the change went through, so the caller can update its own view.
 */
@Injectable({ providedIn: 'root' })
export class UserAccountActionsService {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);

  private who(u: AccountActionUser): string { return u.displayName || u.firstName || 'this user'; }

  async resetPassword(u: AccountActionUser): Promise<boolean> {
    const ok = await this.dialog.confirm({
      title: `Reset password for ${this.who(u)}?`,
      message: 'A new temporary password is generated and shown once — share it securely. They must change it at next login.',
      confirmLabel: 'Reset password',
    });
    if (!ok) return false;
    const temp = 'Pf-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89);
    try {
      await firstValueFrom(this.api.post(`/api/users/${u.id}/reset-password`, { newPassword: temp }));
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
      return false;
    }
    this.dialog.confirm({
      title: 'Password reset',
      message: `Temporary password for ${u.displayName || this.who(u)}:\n\n${temp}\n\nShare it securely — it won't be shown again.`,
      confirmLabel: 'Done',
    });
    return true;
  }

  async deactivate(u: AccountActionUser): Promise<boolean> {
    const ok = await this.dialog.confirm({
      title: `Deactivate ${this.who(u)}?`,
      message: 'They lose access immediately. Their history and assignments are kept.',
      tone: 'danger',
      confirmLabel: 'Deactivate',
    });
    if (!ok) return false;
    try {
      await firstValueFrom(this.api.delete(`/api/users/${u.id}`));
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
      return false;
    }
    this.toasts.success('User deactivated');
    return true;
  }

  async reactivate(u: AccountActionUser): Promise<boolean> {
    const ok = await this.dialog.confirm({
      title: `Reactivate ${this.who(u)}?`,
      message: 'They regain access immediately with their previous roles.',
      confirmLabel: 'Reactivate',
    });
    if (!ok) return false;
    try {
      await firstValueFrom(this.api.patch(`/api/users/${u.id}`, { isActive: true }));
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
      return false;
    }
    this.toasts.success('User reactivated');
    return true;
  }
}
