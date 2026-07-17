import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, throwError, timeout } from 'rxjs';
import { ApiResponse } from '../../shared/models/api-response.model';
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
        if (!resp.success) throw new Error(resp.message ?? resp.error ?? 'Request failed');
        return resp.data as T;
      }),
      catchError((err: HttpErrorResponse | Error) => {
        this._isLoading.set(false);
        const message = this.messageFrom(err);
        this._error.set(message);
        return throwError(() => err);
      })
    );
  }

  private messageFrom(err: HttpErrorResponse | Error): string {
    return ApiError.from(err).message;
  }
}

export class ApiError {
  constructor(public readonly message: string, public readonly originalError?: any) {}

  static from(err: any): ApiError {
    let message = 'An unexpected error occurred';
    
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (body && typeof body === 'object') {
        if ('message' in body && body.message) {
          message = String(body.message);
        } else if ('error' in body && body.error) {
          if (typeof body.error === 'object' && 'message' in body.error && body.error.message) {
            message = String(body.error.message);
          } else if (typeof body.error === 'string') {
            message = body.error;
          }
        }
      } else if (typeof body === 'string') {
        message = body;
      } else {
        message = err.message || err.statusText || message;
      }
    } else if (err instanceof Error) {
      message = err.message;
    } else if (err && typeof err === 'object' && 'message' in err && err.message) {
      message = String(err.message);
    } else if (typeof err === 'string') {
      message = err;
    }
    
    return new ApiError(message, err);
  }
}

