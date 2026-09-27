import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PlatformService } from './platform.service';
import { absoluteApiUrl, isPrivateUploadPath, registerUploadFetcher } from '../../shared/utils/upload-fetch';

/**
 * Private uploads in the app. "/uploads/…" files are served only to the
 * session (GET /api/uploads/file — tenant-scoped) or via a short-lived signed
 * URL (POST /api/uploads/sign). This service:
 *  - `src(url)`   — a synchronous, signal-backed <img>/<audio> src: returns a
 *                   blob: URL once the authenticated fetch lands ('' until
 *                   then), so templates can keep calling a plain method;
 *  - `blob(url)`  — the bytes (PDF renderers, previews);
 *  - `open(url)`  — open a file in a new tab (signed URL: a new tab / the
 *                   system viewer can't carry the bearer token).
 * Non-upload URLs (absolute, data:, blob:, already-signed) pass through.
 */
@Injectable({ providedIn: 'root' })
export class UploadsService {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  /** Resolved lazily (test doubles of PlatformService may omit it). */
  private get apiBase(): string { return this.platform.getApiUrl?.() ?? ''; }

  /** path → blob: URL (kept for the session; uploads are immutable). */
  private readonly urls = signal<Record<string, string>>({});
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor() {
    registerUploadFetcher(path => this.blob(path));
  }

  /** Bytes of a private upload via the authenticated endpoint. */
  async blob(url: string): Promise<Blob | null> {
    if (!isPrivateUploadPath(url)) {
      try {
        const r = await fetch(absoluteApiUrl(url, this.apiBase));
        return r.ok ? await r.blob() : null;
      } catch { return null; }
    }
    try {
      return await firstValueFrom(this.http.get(
        `${this.apiBase}/api/uploads/file`, { params: { path: url }, responseType: 'blob' }));
    } catch {
      return null;
    }
  }

  /** blob: URL for a private upload (cached), or the resolved URL otherwise. */
  async objectUrl(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    if (!isPrivateUploadPath(url)) return absoluteApiUrl(url, this.apiBase);
    const have = this.urls()[url];
    if (have) return have;
    let p = this.inflight.get(url);
    if (!p) {
      p = this.blob(url).then(b => {
        if (!b) return null;
        const u = URL.createObjectURL(b);
        this.urls.update(m => ({ ...m, [url]: u }));
        return u;
      }).finally(() => this.inflight.delete(url));
      this.inflight.set(url, p);
    }
    return p;
  }

  /** Synchronous src for templates: '' while a private file loads, then its
   *  blob: URL (the signal read re-renders the view when it lands). */
  src(url: string | null | undefined): string {
    if (!url) return '';
    if (!isPrivateUploadPath(url)) return absoluteApiUrl(url, this.apiBase);
    const have = this.urls()[url];
    if (have) return have;
    if (!this.inflight.has(url)) void this.objectUrl(url);
    return '';
  }

  /** Short-lived signed URLs for own-tenant paths (path → absolute URL). */
  async signed(paths: string[]): Promise<Record<string, string>> {
    const want = paths.filter(isPrivateUploadPath);
    if (!want.length) return {};
    try {
      const r = await firstValueFrom(this.http.post<{ success: boolean; data?: Record<string, string> }>(
        `${this.apiBase}/api/uploads/sign`, { paths: want }));
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r?.data ?? {})) out[k] = absoluteApiUrl(v, this.apiBase);
      return out;
    } catch {
      return {};
    }
  }

  /** Open a file in a new tab. The tab is opened synchronously (inside the
   *  click, so popup blockers allow it) and pointed at the signed URL once
   *  it arrives. */
  async open(url: string | null | undefined): Promise<void> {
    if (!url) return;
    if (!isPrivateUploadPath(url)) { window.open(absoluteApiUrl(url, this.apiBase), '_blank', 'noopener'); return; }
    const tab = window.open('', '_blank');
    const target = (await this.signed([url]))[url];
    if (!target) { tab?.close(); return; }
    if (tab) { tab.opener = null; tab.location.href = target; }
    else window.open(target, '_blank', 'noopener');
  }
}
