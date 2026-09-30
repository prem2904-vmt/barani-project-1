import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { PlatformService } from './platform.service';
import { ApiError } from '../../shared/models/api-response.model';
import {
  ExpenseAttachment, ExpenseBook, ExpenseCategory, ExpenseDay, ExpenseEntry, ExpenseEntryInput, ExpenseFilter,
} from '../../shared/models/expense.model';

/**
 * Finance → Expense tracker API (`/api/expenses`). The book is always the
 * caller's ACTIVE branch (the server scopes by it). Bills go up as multipart
 * (not through ApiService's 20s JSON ceiling — a phone photo can be MBs).
 */
@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly base = inject(PlatformService).getApiUrl();

  static query(f: ExpenseFilter): string {
    const q = new URLSearchParams();
    q.set('from', f.from);
    q.set('to', f.to);
    if (f.categoryId) q.set('categoryId', f.categoryId);
    if (f.kind) q.set('kind', f.kind);
    if (f.mode) q.set('mode', f.mode);
    return '?' + q.toString();
  }

  book(f: ExpenseFilter): Observable<ExpenseBook> {
    return this.api.get<ExpenseBook>('/api/expenses' + ExpenseService.query(f));
  }

  exportCsv(f: ExpenseFilter): Observable<Blob> {
    return this.api.getBlob('/api/expenses/export.csv' + ExpenseService.query(f));
  }

  categories(): Observable<ExpenseCategory[]> {
    return this.api.get<ExpenseCategory[]>('/api/expenses/categories');
  }

  createCategory(name: string): Observable<ExpenseCategory> {
    return this.api.post<ExpenseCategory>('/api/expenses/categories', { name });
  }

  updateCategory(id: string, patch: { name?: string; isActive?: boolean }): Observable<ExpenseCategory> {
    return this.api.put<ExpenseCategory>(`/api/expenses/categories/${id}`, patch);
  }

  create(input: ExpenseEntryInput): Observable<ExpenseEntry> {
    return this.api.post<ExpenseEntry>('/api/expenses', input);
  }

  update(id: string, input: ExpenseEntryInput): Observable<ExpenseEntry> {
    return this.api.put<ExpenseEntry>(`/api/expenses/${id}`, input);
  }

  remove(id: string): Observable<void> {
    return this.api.delete<void>(`/api/expenses/${id}`);
  }

  removeAttachment(entryId: string, attachmentId: string): Observable<void> {
    return this.api.delete<void>(`/api/expenses/${entryId}/attachments/${attachmentId}`);
  }

  /** Upload bills (photos / PDFs) to an entry; resolves to the stored rows. */
  async attach(entryId: string, files: File[]): Promise<ExpenseAttachment[]> {
    if (files.length === 0) return [];
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    try {
      const resp = await firstValueFrom(this.http.post<{ success: boolean; data?: ExpenseAttachment[]; message?: string; error?: string }>(
        `${this.base}/api/expenses/${entryId}/attachments`, fd));
      if (!resp?.success) throw new ApiError(resp?.message ?? 'Upload failed', resp?.error);
      return resp.data ?? [];
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  setOpening(date: string, openingBalance: number | null): Observable<ExpenseDay> {
    return this.api.put<ExpenseDay>(`/api/expenses/days/${date}/opening`, { openingBalance });
  }

  closeDay(date: string, note: string | null): Observable<ExpenseDay> {
    return this.api.post<ExpenseDay>(`/api/expenses/days/${date}/close`, { note });
  }

  reopenDay(date: string): Observable<ExpenseDay> {
    return this.api.post<ExpenseDay>(`/api/expenses/days/${date}/reopen`, {});
  }
}
