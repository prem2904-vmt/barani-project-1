import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { hasAnyManage } from './settings-access';

/** /settings: anyone holding ANY manage_* permission (owner). Each row is
 *  still gated by the permission that guards its old page. */
export const settingsGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitForAuth();
  return hasAnyManage(auth.permissions()) ? true : router.createUrlTree(['/403']);
};
