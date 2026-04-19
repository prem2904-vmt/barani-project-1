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
      const authed = req.clone({
        setHeaders: { Authorization: `Bearer ${token}` }
      });
      return next(authed);
    })
  );
};
