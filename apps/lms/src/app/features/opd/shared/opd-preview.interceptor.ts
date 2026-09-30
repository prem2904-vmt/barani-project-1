import { HttpInterceptorFn } from '@angular/common/http';
import { OPD_PREVIEW_HEADER, isApiRequest, readOpdFlag, safeLocalStorage } from './opd-gate';

/**
 * OPD dark build — while the console flag is set (`pf.opd()` ⇒ localStorage
 * `pf.opd` === '1'), every request to our API carries `X-PF-OPD: 1`, which the
 * server's OpdAccess treats as "OPD allowed for this request". Without the flag
 * nothing is added and requests are byte-for-byte what they were. Never touches
 * third-party URLs (Supabase, signed Spaces links).
 */
export const opdPreviewInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiRequest(req.url) || !readOpdFlag(safeLocalStorage()) || req.headers.has(OPD_PREVIEW_HEADER)) {
    return next(req);
  }
  return next(req.clone({ setHeaders: { [OPD_PREVIEW_HEADER]: '1' } }));
};
