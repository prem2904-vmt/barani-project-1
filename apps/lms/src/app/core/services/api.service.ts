import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, throwError, timeout } from 'rxjs';
import { ApiError, ApiResponse } from '../../shared/models/api-response.model';
import { PlatformService } from './platform.service';

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

  get<T>(path: string): Observable<T> {
    return this.wrap(this.http.get<ApiResponse<T>>(`${this.baseUrl}${path}`));
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.wrap(this.http.post<ApiResponse<T>>(`${this.baseUrl}${path}`, body));
  }

  patch<T>(path: string, body: unknown = {}): Observable<T> {
    return this.wrap(this.http.patch<ApiResponse<T>>(`${this.baseUrl}${path}`, body));
  }

  put<T>(path: string, body: unknown = {}): Observable<T> {
    return this.wrap(this.http.put<ApiResponse<T>>(`${this.baseUrl}${path}`, body));
  }

  delete<T>(path: string): Observable<T> {
    return this.wrap(this.http.delete<ApiResponse<T>>(`${this.baseUrl}${path}`));
  }

  /** A binary body (e.g. the stored report PDF). Not wrapped: a failure keeps
   *  the HttpErrorResponse (its `status` tells "not stored yet" (404) from a
   *  real failure). Longer ceiling than JSON calls — a report can be MBs. */
  getBlob(path: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}${path}`, { responseType: 'blob' }).pipe(
      timeout({
        each: ApiService.BLOB_TIMEOUT_MS,
        with: () => throwError(() => new Error('Request timed out — check your connection')),
      }),
    );
  }

  private static readonly BLOB_TIMEOUT_MS = 60_000;

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

