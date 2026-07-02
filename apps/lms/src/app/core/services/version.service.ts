import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { APP_VERSION } from '../version';
import { ApiService } from './api.service';

interface VersionInfo {
  api: string;
  minClientVersion: string;
}

/**
 * Boot-time version handshake. Fetches GET /api/version (best-effort — any
 * failure is ignored so an offline start never blocks the app) and flips
 * `updateRequired` when this bundle is older than the server's minimum
 * supported client version. The app component renders a persistent blocking
 * overlay off that signal.
 */
@Injectable({ providedIn: 'root' })
export class VersionService {
  private readonly api = inject(ApiService);

  private readonly _updateRequired = signal(false);
  readonly updateRequired = this._updateRequired.asReadonly();

  async init(): Promise<void> {
    try {
      const info = await firstValueFrom(this.api.get<VersionInfo>('/api/version'));
      if (info?.minClientVersion && compareVersions(APP_VERSION, info.minClientVersion) < 0) {
        this._updateRequired.set(true);
      }
    } catch { /* unreachable / old API — never block boot on the handshake */ }
  }
}

/** Simple numeric-segment semver compare: -1 when a < b, 0 equal, 1 when a > b. */
function compareVersions(a: string, b: string): number {
  const as = a.split('.').map(n => parseInt(n, 10) || 0);
  const bs = b.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const d = (as[i] ?? 0) - (bs[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
