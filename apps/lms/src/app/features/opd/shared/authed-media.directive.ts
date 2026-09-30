import { Directive, ElementRef, OnChanges, OnDestroy, SimpleChanges, inject, input } from '@angular/core';
import { UploadsService } from '../../../core/services/uploads.service';

/**
 * `[pfAuthedSrc]` — an authenticated `<img>` / `<video>` thumbnail for a
 * consult's media (`/api/opd/consult/{visitId}/media/file`) or a walk-in's
 * prescription photo (`/api/opd/pharmacy/counter/{id}/prescription/file`):
 * these are AUTHENTICATED API paths, never presigned links (engineering
 * rules §1), so a plain `[src]` can't render them — the browser has no
 * Authorization header to attach to an `<img>` fetch.
 *
 * Reuses the app's existing authed-file pattern (UploadsService / shared/
 * utils/upload-fetch.ts) rather than inventing a second one: the bytes come
 * through `UploadsService.blob()` — HttpClient, so the auth + X-PF-OPD
 * interceptors apply — fetched and cached ONCE per path for the session (no
 * HEAD pre-check, no refetch per render). What THIS directive owns is the
 * `object:` URL's lifetime: it creates its own on every bind (cheap — the
 * underlying bytes are already cached) and revokes it on destroy or before
 * creating the next one, so a screen with many thumbnails (a visit's photos,
 * a compare view) never leaks blob handles even though the cached bytes
 * themselves live for the rest of the session.
 */
@Directive({ selector: 'img[pfAuthedSrc], video[pfAuthedSrc]', standalone: true })
export class AuthedMediaDirective implements OnChanges, OnDestroy {
  readonly pfAuthedSrc = input<string | null | undefined>(null);

  private readonly el = inject(ElementRef<HTMLImageElement | HTMLVideoElement>);
  private readonly uploads = inject(UploadsService);
  private objectUrl: string | null = null;
  /** Bumped on every (re)bind so a stale fetch (fast list recycling) never
   *  overwrites a newer one. */
  private token = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if ('pfAuthedSrc' in changes) void this.load();
  }

  ngOnDestroy(): void {
    this.revoke();
  }

  private async load(): Promise<void> {
    const mine = ++this.token;
    this.revoke();
    this.el.nativeElement.removeAttribute('src');
    const path = this.pfAuthedSrc();
    if (!path) return;
    const blob = await this.uploads.blob(path);
    if (mine !== this.token || !blob) return; // rebound / destroyed meanwhile, or the fetch failed
    this.objectUrl = URL.createObjectURL(blob);
    this.el.nativeElement.setAttribute('src', this.objectUrl);
  }

  private revoke(): void {
    if (!this.objectUrl) return;
    try { URL.revokeObjectURL(this.objectUrl); } catch { /* already gone */ }
    this.objectUrl = null;
  }
}
