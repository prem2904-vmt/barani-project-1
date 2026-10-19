import { Injectable, Injector, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { PfKeysDept } from './pf-keys-layouts';

/**
 * The lab's own departments (Test Master → departments) for the PF Keys code
 * pad's DEPARTMENT PREFIX keys. Loaded once, lazily — only when a code-pad
 * field first appears on a tablet — and cached for the session (per tenant +
 * branch). Never hardcoded: a lab sees exactly its own codes.
 */
@Injectable({ providedIn: 'root' })
export class PfKeysDepartmentsService {
  private readonly injector = inject(Injector);
  readonly list = signal<PfKeysDept[] | null>(null);
  private loadedFor: string | null = null;

  /** Seed from a screen that already has them (no extra request). */
  seed(depts: readonly PfKeysDept[] | null | undefined): void {
    if (depts?.length) this.list.set([...depts]);
  }

  ensure(): void {
    let key = 'anon';
    try {
      const u = this.injector.get(AuthService, null)?.user?.();
      key = `${u?.tenantId ?? ''}:${u?.branchId ?? ''}`;
    } catch { /* no auth in this context */ }
    if (this.loadedFor === key) return;
    const api = this.injector.get(ApiService, null);
    if (!api) return;
    this.loadedFor = key;
    try {
      api.get<PfKeysDept[]>('/api/tenants/departments').subscribe({
        next: l => this.list.set(l ?? []),
        error: () => { this.loadedFor = null; },
      });
    } catch { this.loadedFor = null; }
  }
}
