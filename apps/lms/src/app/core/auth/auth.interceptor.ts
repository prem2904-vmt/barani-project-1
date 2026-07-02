import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
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

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api') && !req.url.includes('/api/')) {
    return next(req);
  }

  const auth = inject(AuthService);

  return from(auth.waitForAuth()).pipe(
    switchMap(() => next(withAuth(req, auth))),
    catchError((err: unknown) => {
      // 401 → the access token likely expired mid-session. Refresh once
      // (single-flight in AuthService) and retry with the new token. Auth
      // endpoints and the Supabase token URL are excluded: a 401 there IS
      // the answer (bad credentials / dead refresh token), not staleness.
      const is401 = err instanceof HttpErrorResponse && err.status === 401;
      const skip = req.url.includes('/api/auth/')
        || req.url.startsWith(environment.auth.supabaseUrl);
      if (!is401 || skip) return throwError(() => err);
      return from(auth.refreshAccessToken()).pipe(
        switchMap(ok => {
          // Errors from this retried request propagate to the caller —
          // catchError has already fired, so there's no second retry loop.
          if (ok) return next(withAuth(req, auth));
          // Refresh failed — propagate the original 401; the auth service's
          // existing logout path (loadProfile → signOut) handles dead sessions.
          return throwError(() => err);
        })
      );
    })
  );
};
