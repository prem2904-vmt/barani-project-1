import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';

export interface DirectoryUser {
  id: string;
  displayName: string;
  email: string;
  isActive: boolean;
}

/**
 * Tenant people directory — everyone you can message. Uses the auth-only
 * /api/directory/users endpoint (NOT admin-only /api/users, which 403s
 * for reception and lab staff). Fetched once, cached for the session.
 */
@Injectable({ providedIn: 'root' })
export class DirectoryService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  private readonly _users = signal<DirectoryUser[]>([]);
  readonly users = this._users.asReadonly();
  private loaded = false;
  private inflight: Promise<void> | null = null;

  constructor() {
    // Account switch: the cache (and who "me" is) belongs to the previous
    // account — reload on next use.
    inject(SessionScopeService).onChange(() => {
      this._users.set([]);
      this.loaded = false;
      this.inflight = null;
    });
  }

  /** Active people in my tenant, me excluded, A→Z. Directory ids are
   *  AuthIds (sub) — comparing them to the app user id never matched, so
   *  you used to see yourself in the list. */
  others(): DirectoryUser[] {
    const u = this.auth.user();
    const mine = new Set([u?.authId, u?.id].filter((x): x is string => !!x));
    return this._users()
      .filter(x => x.isActive && !mine.has(x.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const rows = await firstValueFrom(
          this.api.get<DirectoryUser[]>('/api/directory/users'));
        this._users.set(rows ?? []);
        this.loaded = true;
      } catch { /* offline / not permitted — leave the list empty */ }
    })();
    try { await this.inflight; } finally { this.inflight = null; }
  }
}
