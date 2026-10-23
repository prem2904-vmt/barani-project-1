import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, finalize, shareReplay, tap } from 'rxjs';
import { ApiService } from './api.service';
import type { OptionFamily } from '../../shared/utils/option-family';

/**
 * The tenant's option FAMILIES (`GET /api/option-families`, read only) —
 * loaded once per session for both result-entry screens and the test editor.
 * Families are written only as a profile's family lines
 * (`ProfileFamilyLinesService`), which refreshes this cache.
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

}
