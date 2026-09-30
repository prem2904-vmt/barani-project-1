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
 *  - `open(url)`  — open a file in a new tab: the bytes come through the
 *                   SAME authenticated fetch (never a bearer link that works
 *                   without the session — patient data) and the tab shows a
 *                   local blob: URL; the native shell hands the file to the
 *                   share sheet.
 *
 * Speed: uploads are immutable, so one fetch per file per session — the bytes
 * are cached (small files) and concurrent callers share one request; a file
 * the server said is gone (410) or that just failed is not re-requested on
 * every re-render.
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

  /** path → the fetch of its bytes (settled or in flight). Uploads are
   *  immutable, so a hit never goes stale; bounded (oldest dropped). */
  private readonly blobs = new Map<string, Promise<Blob | null>>();
  private static readonly MAX_CACHED = 60;
  /** Bigger files are fetched when asked, not kept (memory). */
  private static readonly MAX_CACHED_BYTES = 5 * 1024 * 1024;
  /** path → when its last fetch failed (not a 410): a re-render inside this
   *  window doesn't fire the request again. */
  private readonly failedAt = new Map<string, number>();
  static readonly RETRY_AFTER_MS = 15_000;

  private recentlyFailed(path: string): boolean {
    const at = this.failedAt.get(path);
    return at != null && Date.now() - at < UploadsService.RETRY_AFTER_MS;
  }

  /** Bytes of a private upload via the authenticated endpoint — once per
   *  file per session (shared by concurrent callers, cached when small). */
  async blob(url: string): Promise<Blob | null> {
    url = this.path(url);
    if (!isPrivateUploadPath(url)) {
      try {
        const r = await fetch(absoluteApiUrl(url, this.apiBase));
        return r.ok ? await r.blob() : null;
      } catch { return null; }
    }
    if (this.missing().has(url) || this.recentlyFailed(url)) return null;
    let p = this.blobs.get(url);
    if (!p) {
      const path = url;
      p = this.fetchBlob(path).then(b => {
        if (!b || b.size > UploadsService.MAX_CACHED_BYTES) this.blobs.delete(path);
        return b;
      });
      this.blobs.set(path, p);
      if (this.blobs.size > UploadsService.MAX_CACHED) {
        const oldest = this.blobs.keys().next().value;
        if (oldest !== undefined && oldest !== path) this.blobs.delete(oldest);
      }
    }
    return p;
  }

  private async fetchBlob(path: string): Promise<Blob | null> {
    try {
      const b = await firstValueFrom(this.http.get(
        `${this.apiBase}/api/uploads/file`, { params: { path }, responseType: 'blob' }));
      this.failedAt.delete(path);
      return b;
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 410) this.markMissing(path);
      else this.failedAt.set(path, Date.now());
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
    // Gone (410) or just failed: keep the placeholder, don't re-request per render.
    if (this.missing().has(url) || this.recentlyFailed(url)) return '';
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
   *  click, so popup blockers allow it) and pointed at a local blob: URL of
   *  the bytes fetched through the authenticated endpoint (one request — the
   *  same cached fetch previews use; no signed link, no HEAD probe). A file
   *  the server no longer has (410) closes the tab and says "upload it
   *  again". The native shell (no tabs) hands the file to the share sheet.
   *  Resolves 'opened' | 'missing' | 'failed'. */
  async open(url: string | null | undefined): Promise<'opened' | 'missing' | 'failed'> {
    if (!url) return 'failed';
    url = this.path(url);
    if (!isPrivateUploadPath(url)) { window.open(absoluteApiUrl(url, this.apiBase), '_blank', 'noopener'); return 'opened'; }
    if (this.isMissing(url)) { this.toast()?.error(FILE_MISSING_MESSAGE, 6000); return 'missing'; }
    const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.();
    const tab = native ? null : window.open('', '_blank');
    this.failedAt.delete(url);   // an explicit click always tries again
    const blob = await this.blob(url);
    if (!blob) {
      tab?.close();
      if (this.isMissing(url)) { this.toast()?.error(FILE_MISSING_MESSAGE, 6000); return 'missing'; }
      this.toast()?.error('Could not open the file. Check your connection and try again.', 5000);
      return 'failed';
    }
    const name = url.slice(url.lastIndexOf('/') + 1);
    if (native) {
      const file = new File([blob], name, { type: blob.type || undefined });
      try {
        if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return 'opened'; }
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return 'opened';   // sheet dismissed
      }
    }
    const href = URL.createObjectURL(blob);
    if (tab) { tab.opener = null; tab.location.href = href; }
    else window.open(href, '_blank', 'noopener');
    // The tab has the document by then; keep it long enough for the viewer's own Save / Print.
    setTimeout(() => { try { URL.revokeObjectURL(href); } catch { /* */ } }, 30 * 60_000);
    return 'opened';
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
