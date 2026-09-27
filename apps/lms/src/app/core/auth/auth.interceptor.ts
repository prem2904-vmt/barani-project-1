import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/** Clone the request with the CURRENT access token + active-branch header. */
function withAuth(req: HttpRequest<unknown>, auth: AuthService): HttpRequest<unknown> {
  const token = auth.accessToken();
  if (!token) return req;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  // Branch switcher: tell the backend which branch to scope this request to.
  // The server validates it against the user's permitted branches.
  const branch = auth.activeBranchId();
  if (branch) headers['X-Active-Branch'] = branch;
  return req.clone({ setHeaders: headers });
}

/**
 * Does this 403 mean "you are signed out" (bounce to login) or "you are not
 * allowed" (show the error)?
 *
 * The distinction matters both ways. Reception hitting an admin-only
 * endpoint gets a 403 with a perfectly good session — bouncing them to
 * login would be a bug, and a nasty one. But a 403 with no usable session
 * is the state that used to strand people on a dead page after signing out.
 *
 * Auth endpoints answer for themselves (bad PIN, bad credentials), so they
 * never bounce.
 */
export function isSignedOut403(
  status: number,
  opts: { skip: boolean; authed: boolean; hasToken: boolean },
): boolean {
  if (opts.skip || status !== 403) return false;
  return !(opts.authed && opts.hasToken);
}

/** The server's "that branch isn't yours" 403 (X-Active-Branch outside the
 *  user's assigned branches). */
export function isBranchRefused(err: unknown): boolean {
  return err instanceof HttpErrorResponse && err.status === 403
    && (err.error as { error?: string } | null)?.error === 'branch_not_permitted';
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api') && !req.url.includes('/api/')) {
    return next(req);
  }

  const auth = inject(AuthService);
  // Injected HERE: catchError runs outside the injection context.
  const router = inject(Router);

  /**
   * The session is gone — stop showing the user a raw 401/403 on a page they
   * can no longer load, and send them where they can actually do something
   * (owner: "if the login has failed it has to redirect to the login screen
   * rather than staying and saying it's a 403"). Clears any half-dead
   * session first so the login screen starts clean, and carries the current
   * URL so they land back where they were.
   */
  const bounceToLogin = (): void => {
    if (router.url.startsWith('/login')) return;     // already there — no loop
    const returnUrl = router.url;
    void auth.signOut().finally(() => {
      void router.navigate(['/login'], { queryParams: { returnUrl } });
    });
  };

  return from(auth.waitForAuth()).pipe(
    switchMap(() => next(withAuth(req, auth))),
    catchError((err: unknown) => {
      // Auth endpoints and the Supabase token URL answer for THEMSELVES: a
      // 401/403 there is the verdict (bad credentials, wrong PIN, dead
      // refresh token), not a stale session to recover or bounce on.
      const skip = req.url.includes('/api/auth/')
        || req.url.startsWith(environment.auth.supabaseUrl);

      // Strict branch access: the active branch is no longer (or never was)
      // one of this user's branches. Drop it and retry ONCE on the default
      // branch — never loop, never bounce to login over it.
      if (isBranchRefused(err) && !skip && auth.activeBranchId()) {
        auth.dropActiveBranch();
        return next(withAuth(req, auth));
      }
      if (err instanceof HttpErrorResponse && isSignedOut403(err.status, {
        skip, authed: auth.isAuthenticated(), hasToken: !!auth.accessToken(),
      })) {
        bounceToLogin();
        return throwError(() => err);
      }
      // 401 → the access token likely expired mid-session. Refresh once
      // (single-flight in AuthService) and retry with the new token.
      const is401 = err instanceof HttpErrorResponse && err.status === 401;
      if (!is401 || skip) return throwError(() => err);
      return from(auth.refreshAccessToken()).pipe(
        switchMap(ok => {
          // Errors from this retried request propagate to the caller —
          // catchError has already fired, so there's no second retry loop.
          if (ok) return next(withAuth(req, auth));
          // Refresh failed — the refresh token is dead, so this session can
          // never recover. Sign out and send them to the login screen instead
          // of leaving a 401 on screen for a page that will never load.
          bounceToLogin();
          return throwError(() => err);
        })
      );
    })
  );
};
