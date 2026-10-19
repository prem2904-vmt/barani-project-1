import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

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

/** Requests that answer for THEMSELVES — a 401/403 there is the verdict
 *  (bad credentials, wrong PIN, wrong DOB on a public report link), never a
 *  stale session to refresh or a reason to leave the page. */
export function answersForItself(url: string): boolean {
  return url.includes('/api/auth/')
    || url.includes('/api/public/')
    || url.startsWith(environment.auth.supabaseUrl);
}

/**
 * Session handling for every API call (login audit 2026-09-29):
 *  - PROACTIVE refresh: a token within 60s of expiry is refreshed before the
 *    request goes out (single-flight), so a burst after a wake meets a fresh
 *    token instead of five 401s.
 *  - A 401 refreshes once (single-flight — five parallel 401s share one
 *    exchange) and retries with the new token.
 *  - Only a DEFINITIVE failure ends the session: the auth server rejecting
 *    the refresh token. A network blip, a timeout, a 5xx or a deploy window
 *    surfaces as the request's own error and the session stays.
 *  - Ending a session is one call into SessionService — ordered clean-up,
 *    one redirect with "Session expired" and the return URL — however many
 *    requests fail at once; while it runs nothing retries or redirects.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api') && !req.url.includes('/api/')) {
    return next(req);
  }

  const auth = inject(AuthService);
  // Injected HERE: catchError runs outside the injection context.
  const session = inject(SessionService);
  const skip = answersForItself(req.url);

  return from(auth.waitForAuth()).pipe(
    switchMap(() => from(skip ? Promise.resolve('fresh' as const) : auth.ensureFreshToken())),
    switchMap((pre) => {
      if (pre === 'dead') {
        // The refresh token was rejected before we even sent this — don't
        // fire a request that can only 401.
        void session.expire('expired');
        return throwError(() => new HttpErrorResponse({ status: 401, statusText: 'Session expired', url: req.url }));
      }
      return next(withAuth(req, auth));
    }),
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || skip) return throwError(() => err);

      // Strict branch access: the active branch is no longer (or never was)
      // one of this user's branches. Drop it and retry ONCE on the default
      // branch — never loop, never bounce to login over it.
      if (isBranchRefused(err) && auth.activeBranchId()) {
        auth.dropActiveBranch();
        return next(withAuth(req, auth));
      }
      // Mid sign-out: in-flight calls just fail quietly — no refresh, no
      // second redirect (the "401 storm").
      if (session.ending()) return throwError(() => err);

      if (isSignedOut403(err.status, {
        skip, authed: auth.isAuthenticated(), hasToken: !!auth.accessToken(),
      })) {
        void session.expire('expired');
        return throwError(() => err);
      }

      if (err.status !== 401) return throwError(() => err);
      // No session at all (a stray call after sign-out): make sure we're on
      // the login screen, once — nothing to refresh.
      if (!auth.session()) {
        void session.expire('expired');
        return throwError(() => err);
      }
      return from(auth.refreshSession()).pipe(
        switchMap(outcome => {
          if (outcome === 'ok') {
            // A 401 even with a freshly minted token: let /me decide whether
            // the account is really gone (it ends the session only then).
            return next(withAuth(req, auth)).pipe(
              catchError((again: unknown) => {
                if (again instanceof HttpErrorResponse && again.status === 401) void auth.loadProfile();
                return throwError(() => again);
              }),
            );
          }
          // Dead refresh token — the session can never recover.
          if (outcome === 'dead') void session.expire('expired');
          // Transient — keep the session; the caller sees this request fail.
          return throwError(() => err);
        })
      );
    })
  );
};
