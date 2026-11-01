import { DestroyRef, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

/** /set-password, keeping a safe in-app return URL for afterwards. */
export function setPasswordUrl(from: string | null | undefined): string {
  return from && SessionService.isReturnable(from)
    ? `/set-password?returnUrl=${encodeURIComponent(from)}`
    : '/set-password';
}

/**
 * The temporary-password gate on a RESTORED session. The route guard only
 * runs on navigation, so when /me reports `mustChangePassword` after the app
 * already booted from the cached profile (a reload or a reopened app before
 * the password was replaced), the person was left inside the app with every
 * call answering 403 "Set a new password before using the app". Whenever the
 * gate is (re)raised, leave the in-app screen for /set-password. The sign-in
 * and public pages handle themselves.
 *
 * Call once, in an injection context (the root App component).
 */
export function installPasswordGate(): void {
  const auth = inject(AuthService);
  const router = inject(Router);
  const ref = effect(() => {
    if (!auth.mustChangePassword() || !auth.isAuthenticated()) return;
    untracked(() => {
      const url = router.url || '/';
      if (url.startsWith('/set-password') || SessionService.isPublicUrl(url)) return;
      void router.navigateByUrl(setPasswordUrl(url), { replaceUrl: true }).catch(() => false);
    });
  });
  inject(DestroyRef).onDestroy(() => ref.destroy());
}
