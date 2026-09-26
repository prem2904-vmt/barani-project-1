import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, throwError, timeout } from 'rxjs';
import { ApiError, ApiResponse } from '../../shared/models/api-response.model';
import { PlatformService } from './platform.service';

/** Optional per-request extras (headers only, for now). */
export interface ApiRequestOptions { headers?: Record<string, string> }

function httpOpts(opts?: ApiRequestOptions): { headers?: Record<string, string> } {
  return opts?.headers ? { headers: opts.headers } : {};
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  protected readonly http = inject(HttpClient);
  // Resolve the base URL through PlatformService so Capacitor/Electron
  // builds use the right host. PlatformService also warns if a mobile
  // build is misconfigured to point at localhost.
  protected readonly baseUrl = inject(PlatformService).getApiUrl();

  private readonly _isLoading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  /* `opts.headers` is optional and additive. Settings uses it to send an
     explicit X-Active-Branch for ONE call (a branch-scoped row editing a
     branch other than the active one); the auth interceptor keeps a header
     the caller already set. */
  get<T>(path: string, opts?: ApiRequestOptions): Observable<T> {
    return this.wrap(this.http.get<ApiResponse<T>>(`${this.baseUrl}${path}`, httpOpts(opts)));
  }

  post<T>(path: string, body: unknown, opts?: ApiRequestOptions): Observable<T> {
    return this.wrap(this.http.post<ApiResponse<T>>(`${this.baseUrl}${path}`, body, httpOpts(opts)));
  }

  patch<T>(path: string, body: unknown = {}, opts?: ApiRequestOptions): Observable<T> {
    return this.wrap(this.http.patch<ApiResponse<T>>(`${this.baseUrl}${path}`, body, httpOpts(opts)));
  }

  put<T>(path: string, body: unknown = {}, opts?: ApiRequestOptions): Observable<T> {
    return this.wrap(this.http.put<ApiResponse<T>>(`${this.baseUrl}${path}`, body, httpOpts(opts)));
  }

  delete<T>(path: string): Observable<T> {
    return this.wrap(this.http.delete<ApiResponse<T>>(`${this.baseUrl}${path}`));
  }

  /** Hard ceiling on any API round-trip. Flaky mobile networks otherwise
   *  leave requests hanging forever with spinners that never resolve.
   *  File uploads don't go through ApiService (they post FormData via
   *  HttpClient directly), so a flat 20s is safe here. */
  private static readonly TIMEOUT_MS = 20_000;

  private wrap<T>(source: Observable<ApiResponse<T>>): Observable<T> {
    this._isLoading.set(true);
    this._error.set(null);
    return source.pipe(
      timeout({
        each: ApiService.TIMEOUT_MS,
        with: () => throwError(() => new Error('Request timed out — check your connection')),
      }),
      map(resp => {
        this._isLoading.set(false);
        // Preserve the CODE and FIELD, not just the message — pages route
        // field-level failures (email_exists → email input) off these.
        if (!resp.success) throw new ApiError(resp.message ?? resp.error ?? 'Request failed', resp.error, resp.field);
        return resp.data as T;
      }),
      catchError((err: HttpErrorResponse | Error) => {
        this._isLoading.set(false);
        const apiErr = ApiError.from(err);
        this._error.set(apiErr.message);
        return throwError(() => apiErr);
      })
    );
  }

  private messageFrom(err: HttpErrorResponse | Error): string {
    return ApiError.from(err).message;
  }
}

