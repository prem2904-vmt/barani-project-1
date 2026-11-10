import { HttpInterceptorFn } from '@angular/common/http';
import { CASESHEETS_HEADER, isApiRequest, readCasesheetsFlag, safeLocalStorage } from './casesheet-gate';

/**
 * While the console flag is set (`pf.casesheets()` ⇒ localStorage `pf.casesheets` === '1'), every request to our
 * API carries `X-PF-CASESHEETS: 1`, which the server's CaseSheetAccess treats as "case sheets allowed for this
 * request" (dev only). Without the flag nothing is added and requests are byte-for-byte what they were. Never
 * touches third-party URLs (Supabase, signed Spaces links). Same shape as opd-preview.interceptor.ts.
 */
export const casesheetHeaderInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiRequest(req.url) || !readCasesheetsFlag(safeLocalStorage()) || req.headers.has(CASESHEETS_HEADER)) {
    return next(req);
  }
  return next(req.clone({ setHeaders: { [CASESHEETS_HEADER]: '1' } }));
};
