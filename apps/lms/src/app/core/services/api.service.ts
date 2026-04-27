import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
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

  private wrap<T>(source: Observable<ApiResponse<T>>): Observable<T> {
    this._isLoading.set(true);
    this._error.set(null);
    return source.pipe(
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
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (body && typeof body === 'object' && 'message' in body) return String(body.message);
      return err.message;
    }
    return err.message ?? 'Unknown error';
  }
}
