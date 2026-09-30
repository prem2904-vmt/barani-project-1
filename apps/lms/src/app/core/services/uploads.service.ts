import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PlatformService } from './platform.service';
import { ToastService } from './toast.service';
import { absoluteApiUrl, isPrivateUploadPath, registerUploadFetcher, uploadPathOf } from '../../shared/utils/upload-fetch';

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
 *
 * Files live in object storage on the server. One uploaded before that move
 * may be gone for good (it sat on a container disk a deploy wiped): the server
 * answers 410 `file_missing`; `isMissing(url)` then says so, and `open()`
 * tells the user to upload it again instead of opening an error page.
 */
/** Shown when the server no longer has a file (410 file_missing). */
export const FILE_MISSING_MESSAGE = 'This file is no longer available on the server. Upload it again.';

@Injectable({ providedIn: 'root' })
export class UploadsService {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  /** Resolved lazily (test doubles of PlatformService may omit it). */
  private get apiBase(): string { return this.platform.getApiUrl?.() ?? ''; }

  /** path → blob: URL (kept for the session; uploads are immutable). */
  private readonly urls = signal<Record<string, string>>({});
  private readonly inflight = new Map<string, Promise<string | null>>();
  /** Paths the server answered 410 file_missing for. */
  private readonly missing = signal<ReadonlySet<string>>(new Set());

  /** True once the server said this file no longer exists (re-upload it). */
  isMissing(url: string | null | undefined): boolean {
    return !!url && this.missing().has(this.path(url));
  }

  private markMissing(path: string): void {
    if (!this.missing().has(path)) this.missing.update(s => new Set(s).add(path));
  }

  constructor() {
    registerUploadFetcher(path => this.blob(path));
  }

  /** An absolute link to our own API's /uploads → its stored path. */
  private path(url: string): string { return uploadPathOf(url, this.apiBase); }

  /** Bytes of a private upload via the authenticated endpoint. */
  async blob(url: string): Promise<Blob | null> {
    url = this.path(url);
    if (!isPrivateUploadPath(url)) {
      try {
        const r = await fetch(absoluteApiUrl(url, this.apiBase));
        return r.ok ? await r.blob() : null;
      } catch { return null; }
    }
    try {
      return await firstValueFrom(this.http.get(
        `${this.apiBase}/api/uploads/file`, { params: { path: url }, responseType: 'blob' }));
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 410) this.markMissing(url);
      return null;
    }
  }

  /** blob: URL for a private upload (cached), or the resolved URL otherwise. */
  async objectUrl(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    url = this.path(url);
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
    url = this.path(url);
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
   *  it arrives. A file the server no longer has (410) closes the tab and
   *  says "upload it again" instead of showing an error page.
   *  Resolves 'opened' | 'missing' | 'failed'. */
  async open(url: string | null | undefined): Promise<'opened' | 'missing' | 'failed'> {
    if (!url) return 'failed';
    url = this.path(url);
    if (!isPrivateUploadPath(url)) { window.open(absoluteApiUrl(url, this.apiBase), '_blank', 'noopener'); return 'opened'; }
    const tab = window.open('', '_blank');
    const target = (await this.signed([url]))[url];
    if (!target) { tab?.close(); return 'failed'; }
    if (this.isMissing(url) || await this.gone(target)) {
      tab?.close();
      this.markMissing(url);
      this.toast()?.error(FILE_MISSING_MESSAGE, 6000);
      return 'missing';
    }
    if (tab) { tab.opener = null; tab.location.href = target; }
    else window.open(target, '_blank', 'noopener');
    return 'opened';
  }

  /** HEAD the signed URL: true only on a definite 410 (any network / CORS
   *  problem = let the tab try; it shows the real outcome). */
  private async gone(signedUrl: string): Promise<boolean> {
    try {
      const r = await fetch(signedUrl, { method: 'HEAD', mode: 'cors' });
      return r.status === 410;
    } catch {
      return false;
    }
  }

  private toast(): ToastService | null {
    try { return this.injector.get(ToastService, null); } catch { return null; }
  }
  private readonly injector = inject(Injector);
}

/**
 * <img> src for a stored branding asset — the tenant logo in the bars / band.
 * Usually a data: URL (the branding wizard) or an absolute link, which pass
 * straight through; only an "/uploads/…" reference (bare, or an absolute link
 * to our API) needs the session, and only then is UploadsService resolved —
 * so screens (and their specs) that never show a private upload don't need
 * HttpClient. null = nothing to show (yet): the caller keeps its fallback.
 */
export function brandingSrc(injector: Injector, url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^(data:|blob:)/i.test(url) || !url.includes('/uploads/') || /[?&]sig=/.test(url)) return url;
  return injector.get(UploadsService).src(url) || null;
}
