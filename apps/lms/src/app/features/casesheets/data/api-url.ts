import { environment } from '../../../../environments/environment';

/**
 * `api('/api/casesheets/sheets')` → `<apiUrl>/api/casesheets/sheets`. Every case-sheet API call is built here (the
 * one URL seam of Prepare's `core/api/api-url.ts`). The base is the LMS API (`environment.apiUrl`, the same value
 * PlatformService.getApiUrl() reads), read lazily so /config.json has merged first. Paths are Prepare's, moved under
 * `/api/casesheets/*` (prefrontal-mw docs/CASESHEETS.md Part 2 "Path map"). The LMS authInterceptor adds the session
 * token + branch; casesheetHeaderInterceptor adds X-PF-CASESHEETS after `pf.casesheets()`.
 */
export function api(path: string): string {
  return environment.apiUrl.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
}
