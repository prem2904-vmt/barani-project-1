import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

// Picks a landing page based on permissions so a logged-in user hitting '/'
// goes to a screen they can actually see, instead of bouncing off a perm
// guard. Ordered most-specific → most-generic. A Sample Collector without
// enter_result/receive_sample lands on /sample-collection; everyone else
// flows through the existing home routes.
const LANDINGS: Array<{ perm: string; path: string }> = [
  { perm: 'manage_tests',     path: '/admin' },
  { perm: 'register_patient', path: '/frontdesk' },
  { perm: 'enter_result',     path: '/lab/my-work' },
  { perm: 'validate_result',  path: '/pathologist' },
  { perm: 'collect_sample',   path: '/sample-collection' },
  { perm: 'view_tat_dashboard', path: '/dashboard' },
  { perm: 'view_dashboard',     path: '/dashboard' }
];

export const landingGuard: CanActivateFn = async (): Promise<UrlTree | boolean> => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitForAuth();
  for (const { perm, path } of LANDINGS) {
    if (auth.hasPermission(perm)) return router.createUrlTree([path]);
  }
  return router.createUrlTree(['/403']);
};
