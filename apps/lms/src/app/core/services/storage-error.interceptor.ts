import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { ApiError } from '../../shared/models/api-response.model';

/** Shown for any object-storage failure on an upload — the file didn't save,
 *  but nothing else the user did was lost. */
export const STORAGE_ERROR_MESSAGE =
  "Couldn't save the file — storage is not responding. Your other work is safe; try again in a minute.";

/** Every upload in this app posts multipart (FormData); a few also carry it
 *  on a named action route (attachments/documents/payment/prescription) —
 *  matching the URL too means a future upload gains this handling for free. */
function isUploadRequest(req: HttpRequest<unknown>): boolean {
  return req.body instanceof FormData
    || /\/uploads\//.test(req.url)
    || /\/(documents|attachments|payment|prescription)$/.test(req.url);
}

/**
 * Storage failures must reach the user as a clear, specific message — never
 * a generic "Request failed", and never a bare "504".
 *
 * The backend answers a real object-storage fault 424 `storage_error`
 * (never 503/502/504): DigitalOcean App Platform's gateway silently rewrites
 * that triad into its own branded HTML error page before it reaches the
 * browser, so the real message never arrived (confirmed 2026-10-01 on a real
 * Spaces outage — `x-do-orig-status: 503` on an HTML "504" — see
 * memory/spaces-plain-put.md and docs/ENGINEERING-RULES.md §8). This is the
 * ONE place that recognises a storage failure, in both forms:
 *  - the normal case: a JSON body `{error: 'storage_error', ...}`;
 *  - the defensive case: a masked, non-JSON HTML 502/503/504 page on an
 *    upload request — e.g. the platform's OWN gateway timing out a hung
 *    origin before our app code ever answers, which no application-level
 *    status code can prevent.
 *
 * Every upload call site already normalises its catch through
 * `ApiError.from(e)` (see api-response.model.ts) and shows `.message` in a
 * toast — recognising the failure HERE is enough; no component changes.
 */
export const storageErrorInterceptor: HttpInterceptorFn = (req, next) => next(req).pipe(
  catchError((err: unknown) => {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as unknown;
      const isStorageCode = !!body && typeof body === 'object' && (body as { error?: string }).error === 'storage_error';
      const isMaskedGatewayPage = typeof body === 'string' && [502, 503, 504].includes(err.status) && isUploadRequest(req);
      if (isStorageCode || isMaskedGatewayPage) {
        return throwError(() => new ApiError(STORAGE_ERROR_MESSAGE, 'storage_error'));
      }
    }
    return throwError(() => err);
  }),
);
