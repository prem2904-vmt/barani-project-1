import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, finalize, shareReplay, tap } from 'rxjs';
import { ApiService } from './api.service';
import type { OptionFamily } from '../../shared/utils/option-family';

/**
 * The tenant's option FAMILIES (`/api/option-families`) — loaded once per
 * session and shared by the Test Master (Families tab + test editor) and
 * both result-entry screens. Saves / deletes refresh the cache.
 */
@Injectable({ providedIn: 'root' })
export class OptionFamilyService {
  private readonly api = inject(ApiService);

  readonly families = signal<OptionFamily[]>([]);
  readonly loaded = signal(false);
  readonly failed = signal(false);
  /** code → family (case-insensitive key). */
  readonly byCode = computed(() => new Map(this.families().map(f => [f.code.toUpperCase(), f] as const)));

  private inflight: Observable<OptionFamily[]> | null = null;

  find(code: string | null | undefined): OptionFamily | null {
    if (!code) return null;
    return this.byCode().get(code.trim().toUpperCase()) ?? null;
  }

  /** Load once (no-op when loaded or loading). */
  ensureLoaded(): void {
    if (this.loaded() || this.inflight) return;
    this.reload().subscribe({ error: () => { /* failed() is set */ } });
  }

  reload(): Observable<OptionFamily[]> {
    if (this.inflight) return this.inflight;
    this.inflight = this.api.get<OptionFamily[]>('/api/option-families').pipe(
      tap({
        next: list => { this.families.set(list ?? []); this.loaded.set(true); this.failed.set(false); },
        error: () => { this.failed.set(true); },
      }),
      finalize(() => { this.inflight = null; }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.inflight;
  }

  create(def: OptionFamily): Observable<OptionFamily> {
    return this.api.post<OptionFamily>('/api/option-families', strip(def)).pipe(tap(() => this.refresh()));
  }

  update(def: OptionFamily): Observable<OptionFamily> {
    return this.api.put<OptionFamily>(`/api/option-families/${encodeURIComponent(def.code)}`, strip(def))
      .pipe(tap(() => this.refresh()));
  }

  /** 409 = a test still uses the family (the caller names them). */
  remove(code: string): Observable<unknown> {
    return this.api.delete<unknown>(`/api/option-families/${encodeURIComponent(code)}`).pipe(tap(() => this.refresh()));
  }

  private refresh() { this.reload().subscribe({ error: () => { /* keep the old list */ } }); }
}

/** The definition only — never the server's read-only `usedBy`. */
function strip(def: OptionFamily): OptionFamily {
  const { usedBy: _u, ...rest } = def;
  void _u;
  return rest;
}
