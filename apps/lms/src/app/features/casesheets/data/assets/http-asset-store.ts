import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { AssetLink, AssetRef, AssetStore, StarterInfo, StarterPicture } from '@prefrontal/forms-engine';
import { firstValueFrom } from 'rxjs';
import { api } from '../api-url';

/** What the API answers for an asset (docs/API.md "Image kinds"). */
interface AssetDto {
  id: string;
  mime: string;
  width: number;
  height: number;
  url?: string | null;
  expiresAt?: string | null;
}

/** A signed link is renewed this long before it runs out. */
const RENEW_MS = 60_000;

const absolute = (u: string) => (/^https?:/.test(u) ? u : api(u));

/**
 * Pictures for the image kinds through the API (never `data:` in a form or an answer):
 *  - starter pictures: `GET /api/casesheets/canvas/templates`, `GET /api/casesheets/canvas/templates/{id}` (cached for the session);
 *  - `GET /api/casesheets/assets/{id}`: size + a fresh signed link (`/api/casesheets/files/{id}?exp=&sig=`, ~5 min; cached until shortly before);
 *  - Studio uploads: `POST /api/casesheets/assets/templates` (owner / admin), raw PNG / JPEG / SVG ≤ 4 MB;
 *  - case photos: `POST /api/casesheets/sheets/{id}/photos` on the sheet that is open (`forSheet`), raw PNG / JPEG ≤ 8 MB,
 *    shrunk on the device first; the width / height answered are the size AS SHOWN (EXIF rotation applied).
 */
@Injectable()
export class HttpAssetStore implements AssetStore {
  private readonly http = inject(HttpClient);
  private readonly links = new Map<string, { link: AssetLink; until: number }>();
  private readonly starterCache = new Map<string, Promise<StarterPicture>>();
  private list: Promise<StarterInfo[]> | null = null;
  /** The draft sheet that is open (photos are uploaded to it). */
  private readonly sheet = signal<string | null>(null);

  /** The case sheet page says which sheet is open (null when it closes). */
  forSheet(id: string | null): void {
    this.sheet.set(id);
  }

  canAddPhotos(): boolean {
    return !!this.sheet();
  }

  starters(): Promise<StarterInfo[]> {
    this.list ??= firstValueFrom(this.http.get<{ items: StarterInfo[] }>(api('/api/casesheets/canvas/templates')))
      .then((r) => (r.items ?? []).map((s) => ({ ...s, svgUrl: absolute(s.svgUrl) })))
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
        (s) => ({ ...s, svgUrl: absolute(s.svgUrl) }),
      );
      p.catch(() => this.starterCache.delete(id));
      this.starterCache.set(id, p);
    }
    return p;
  }

  async asset(assetId: string): Promise<AssetLink> {
    const hit = this.links.get(assetId);
    if (hit && hit.until > Date.now()) return hit.link;
    const r = await firstValueFrom(this.http.get<AssetDto>(api(`/api/casesheets/assets/${encodeURIComponent(assetId)}`)));
    return this.remember(r)!;
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

  private remember(r: AssetDto): AssetLink | null {
    if (!r.url) return null;
    const link: AssetLink = { assetId: r.id, width: r.width, height: r.height, mime: r.mime, url: absolute(r.url) };
    const exp = r.expiresAt ? Date.parse(r.expiresAt) : Date.now() + 4 * 60_000;
    this.links.set(r.id, { link, until: exp - RENEW_MS });
    return link;
  }
}
