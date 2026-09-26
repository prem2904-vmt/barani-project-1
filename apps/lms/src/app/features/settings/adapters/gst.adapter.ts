import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SettingAdapter } from './adapter';

/** 15 characters: 2-digit state code, PAN, entity, Z, check. */
export const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/;

/**
 * A branch's GST number (POST /api/config/gst). The backend has no read for
 * it, so the row starts blank and shows what was saved in this visit. The
 * state code is the GSTIN's first two digits, so it is filled in for you.
 */
@Injectable({ providedIn: 'root' })
export class GstAdapter implements SettingAdapter {
  private readonly api = inject(ApiService);
  private readonly saved = signal<Record<string, string>>({});

  ensure(): void { /* write-only */ }
  loaded(): boolean { return true; }
  read(_key: string, branchId: string | null): unknown { return this.saved()[branchId ?? ''] ?? ''; }

  async write(_key: string, value: unknown, branchId: string | null): Promise<void> {
    const gstin = String(value ?? '').trim().toUpperCase();
    if (!branchId) throw new Error('Pick a branch first.');
    if (!GSTIN_RE.test(gstin)) throw new Error('A GST number has 15 letters and digits.');
    await firstValueFrom(this.api.post('/api/config/gst', { branchId, gstin, stateCode: gstin.slice(0, 2) }));
    this.saved.update((m) => ({ ...m, [branchId]: gstin }));
  }
}
