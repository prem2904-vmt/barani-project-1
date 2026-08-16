import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { OptionRow, OptionTable } from '../../shared/models/option-table.model';

/**
 * HTTP wrapper + session cache for the shared dropdown dictionaries
 * (Result Option Master tables, OptionTablesController). Result entry
 * resolves a parameter's `optionTable` code through `byCode()`; admin
 * screens use the CRUD methods and `refresh()` the cache after writes.
 */
@Injectable({ providedIn: 'root' })
export class OptionTablesService {
  private readonly api = inject(ApiService);

  /** All of the tenant's tables, loaded once per session (refresh on write). */
  readonly tables = signal<OptionTable[]>([]);
  private loaded = false;
  private loading: Promise<void> | null = null;

  /** Idempotent session load — safe to call from any screen that might need
   *  dropdown resolution; concurrent callers share one request. */
  ensureLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    this.loading ??= firstValueFrom(this.api.get<OptionTable[]>('/api/option-tables'))
      .then(rows => {
        this.tables.set(rows ?? []);
        this.loaded = true;
      })
      .finally(() => (this.loading = null));
    return this.loading;
  }

  async refresh(): Promise<void> {
    this.loaded = false;
    await this.ensureLoaded();
  }

  /** Case-insensitive lookup by table code. */
  byCode(code: string | null | undefined): OptionTable | undefined {
    if (!code) return undefined;
    const target = code.trim().toUpperCase();
    return this.tables().find(t => t.code.toUpperCase() === target);
  }

  /** Dropdown values for a table code — active rows in sort order. */
  valuesFor(code: string | null | undefined): string[] | null {
    const t = this.byCode(code);
    if (!t) return null;
    return t.options.filter(o => o.active !== false).map(o => o.value);
  }

  /** Normal (expected) values for a table code — drives entry highlighting. */
  normalsFor(code: string | null | undefined): string[] | null {
    const t = this.byCode(code);
    if (!t) return null;
    return t.options
      .filter(o => o.active !== false && o.normal === true)
      .map(o => o.value);
  }

  // ── Admin CRUD ──────────────────────────────────────────

  create(input: { code: string; name: string; departmentId?: string | null; options: OptionRow[] }): Promise<OptionTable> {
    return firstValueFrom(this.api.post<OptionTable>('/api/option-tables', input));
  }

  update(id: string, input: { name?: string; options?: OptionRow[]; isActive?: boolean }): Promise<OptionTable> {
    return firstValueFrom(this.api.put<OptionTable>(`/api/option-tables/${id}`, input));
  }

  delete(id: string): Promise<unknown> {
    return firstValueFrom(this.api.delete<unknown>(`/api/option-tables/${id}`));
  }
}
