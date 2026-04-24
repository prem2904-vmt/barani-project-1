import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const permissionGuard = (required: string | string[]): CanActivateFn => async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitForAuth();
  const codes = Array.isArray(required) ? required : [required];
  if (auth.hasAnyPermission(codes)) return true;
  return router.createUrlTree(['/403']);
};
