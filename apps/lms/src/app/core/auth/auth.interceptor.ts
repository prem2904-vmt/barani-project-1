import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api') && !req.url.includes('/api/')) {
    return next(req);
  }

  const auth = inject(AuthService);

  return from(auth.waitForAuth()).pipe(
    switchMap(() => {
      const token = auth.accessToken();
      if (!token) return next(req);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      // Branch switcher: tell the backend which branch to scope this request to.
      // The server validates it against the user's permitted branches.
      const branch = auth.activeBranchId();
      if (branch) headers['X-Active-Branch'] = branch;
      const authed = req.clone({ setHeaders: headers });
      return next(authed);
    })
  );
};
