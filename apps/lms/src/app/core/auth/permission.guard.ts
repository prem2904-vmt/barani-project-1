import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const permissionGuard = (required: string): CanActivateFn => async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitForAuth();
  if (auth.hasPermission(required)) return true;
  return router.createUrlTree(['/403']);
};
