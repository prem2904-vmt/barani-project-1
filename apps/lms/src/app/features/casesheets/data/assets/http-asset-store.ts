import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import type { AssetLink, AssetRef, AssetStore, StarterInfo, StarterPicture } from '@prefrontal/forms-engine';
import { firstValueFrom } from 'rxjs';
import { api } from '../api-url';

/** What the API answers for an asset (docs/API.md "Image kinds"). */
interface AssetDto {
  id: string;
  mime: string;
  width: number;
  height: number;
  /** The AUTHENTICATED bytes endpoint (`/api/casesheets/assets/{id}/file`, `/api/casesheets/sheets/{s}/photos/{p}`). Never a link. */
  url?: string | null;
}

const absolute = (u: string) => (/^https?:/.test(u) ? u : api(u));

/**
 * Pictures for the image kinds through the API (never `data:` in a form or an answer):
 *  - starter pictures: `GET /api/casesheets/canvas/templates`, `GET /api/casesheets/canvas/templates/{id}` (cached for the session);
 *    their `{id}.svg` needs the session, so it is fetched as a blob and `svgUrl` is an object URL (revoked on destroy);
 *  - a picture's bytes need the session (no anonymous / signed links, owner rule): `GET /api/casesheets/assets/{id}` (template picture)
 *    or `GET /api/casesheets/sheets/{s}/photos/{p}/info` (a photo of the open sheet) gives the size + the bytes path; the bytes are
 *    fetched through HttpClient as a blob and `url` is an object URL (cached by id, revoked when the store goes);
 *  - Studio uploads: `POST /api/casesheets/assets/templates` (owner / admin), raw PNG / JPEG / SVG ≤ 4 MB;
 *  - case photos: `POST /api/casesheets/sheets/{id}/photos` on the sheet that is open (`forSheet`), raw PNG / JPEG ≤ 8 MB,
 *    shrunk on the device first; the width / height answered are the size AS SHOWN (EXIF rotation applied).
 */
@Injectable()
export class HttpAssetStore implements AssetStore, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly links = new Map<string, Promise<AssetLink>>();
  /** Sizes + bytes paths an upload already answered (no second lookup). */
  private readonly known = new Map<string, AssetDto>();
  /** Every object URL this store handed out (revoked on destroy). */
  private readonly objectUrls = new Set<string>();
  private readonly starterCache = new Map<string, Promise<StarterPicture>>();
  private list: Promise<StarterInfo[]> | null = null;
  /** Starter SVG id → object URL of its fetched bytes (revoked when the store goes). */
  private readonly svgUrls = new Map<string, Promise<string>>();
  /** The draft sheet that is open (photos are uploaded to it). */
  private readonly sheet = signal<string | null>(null);

  /** The case sheet page says which sheet is open (null when it closes). */
  forSheet(id: string | null): void {
    this.sheet.set(id);
  }

  canAddPhotos(): boolean {
    return !!this.sheet();
  }

  ngOnDestroy(): void {
    for (const p of this.svgUrls.values()) void p.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
    this.svgUrls.clear();
    for (const u of this.objectUrls) URL.revokeObjectURL(u);
    this.objectUrls.clear();
    this.links.clear();
    this.known.clear();
  }

  /**
   * The starter picture's SVG sits behind the gate + the session, so an `<img src>` / `<image href>` to the API cannot
   * load it. Fetch it through HttpClient (the auth interceptor adds the token) and hand out an object URL (cached by id).
   */
  private svgObjectUrl(id: string, svgUrl: string): Promise<string> {
    let p = this.svgUrls.get(id);
    if (!p) {
      p = firstValueFrom(this.http.get(absolute(svgUrl), { responseType: 'blob' })).then((b) =>
        URL.createObjectURL(b.type ? b : new Blob([b], { type: 'image/svg+xml' })),
      );
      p.catch(() => this.svgUrls.delete(id));
      this.svgUrls.set(id, p);
    }
    return p;
  }

  starters(): Promise<StarterInfo[]> {
    this.list ??= firstValueFrom(this.http.get<{ items: StarterInfo[] }>(api('/api/casesheets/canvas/templates')))
      .then((r) => Promise.all((r.items ?? []).map(async (s) => ({ ...s, svgUrl: await this.svgObjectUrl(s.id, s.svgUrl) }))))
      .catch((e) => {
        this.list = null;
        throw e;
      });
    return this.list;
  }

  starter(id: string): Promise<StarterPicture> {
    let p = this.starterCache.get(id);
    if (!p) {
      p = firstValueFrom(this.http.get<StarterPicture>(api(`/api/casesheets/canvas/templates/${encodeURIComponent(id)}`))).then(
        async (s) => ({ ...s, svgUrl: await this.svgObjectUrl(s.id, s.svgUrl) }),
      );
      p.catch(() => this.starterCache.delete(id));
      this.starterCache.set(id, p);
    }
    return p;
  }

  asset(assetId: string): Promise<AssetLink> {
    let p = this.links.get(assetId);
    if (!p) {
      p = this.lookup(assetId).then((r) => this.link(r));
      p.catch(() => this.links.delete(assetId));
      this.links.set(assetId, p);
    }
    return p;
  }

  /** A template picture, else (a draft or finished sheet is open) one of its photos. */
  private async lookup(assetId: string): Promise<AssetDto> {
    const seen = this.known.get(assetId);
    if (seen) return seen;
    const id = encodeURIComponent(assetId);
    try {
      return await firstValueFrom(this.http.get<AssetDto>(api(`/api/casesheets/assets/${id}`)));
    } catch (e) {
      const sheet = this.sheet();
      if (!sheet || (e as { status?: number })?.status !== 404) throw e;
      return firstValueFrom(this.http.get<AssetDto>(api(`/api/casesheets/sheets/${encodeURIComponent(sheet)}/photos/${id}/info`)));
    }
  }

  /** The bytes, with the session → an object URL. */
  private async link(r: AssetDto): Promise<AssetLink> {
    if (!r.url) throw new Error('This picture has no file.');
    const blob = await firstValueFrom(this.http.get(absolute(r.url), { responseType: 'blob' }));
    const url = URL.createObjectURL(blob);
    this.objectUrls.add(url);
    return { assetId: r.id, width: r.width, height: r.height, mime: r.mime, url };
  }

  async uploadTemplate(file: Blob): Promise<AssetRef> {
    const r = await firstValueFrom(
      this.http.post<AssetDto>(api('/api/casesheets/assets/templates'), file, {
        headers: new HttpHeaders({ 'Content-Type': file.type || 'application/octet-stream' }),
      }),
    );
    this.remember(r);
    return { assetId: r.id, width: r.width, height: r.height, mime: r.mime };
  }

  async uploadPhoto(file: Blob): Promise<AssetRef> {
    const sheet = this.sheet();
    if (!sheet) throw new Error('no open case sheet');
    const r = await firstValueFrom(
      this.http.post<AssetDto>(api(`/api/casesheets/sheets/${encodeURIComponent(sheet)}/photos`), file, {
        headers: new HttpHeaders({ 'Content-Type': file.type || 'application/octet-stream' }),
      }),
    );
    this.remember(r);
    return { assetId: r.id, width: r.width, height: r.height, mime: r.mime };
  }

  /** An upload answered the size + bytes path: the first look fetches only the bytes. */
  private remember(r: AssetDto): void {
    if (r.url) this.known.set(r.id, r);
  }
}
