import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * Case-sheet files are LOGGED-IN ONLY (owner rule 2026-11-10; ENGINEERING-RULES §1): every picture / PDF is the body of an
 * authenticated API call, never an anonymous or signed link. This fetches such a path through HttpClient (the auth interceptor adds
 * the session), as a blob, and hands out an object URL — cached per path, revoked when the owner (a component / page provider) goes.
 * Provide it on the component that shows the pictures (`providers: [SessionBlobs]`) so its URLs die with it.
 */
@Injectable()
export class SessionBlobs implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly urls = new Map<string, Promise<string>>();
  private readonly made = new Set<string>();

  /** An object URL for the bytes at `url` (an absolute API path). */
  objectUrl(url: string): Promise<string> {
    let p = this.urls.get(url);
    if (!p) {
      p = firstValueFrom(this.http.get(url, { responseType: 'blob' })).then((b) => {
        const u = URL.createObjectURL(b);
        this.made.add(u);
        return u;
      });
      p.catch(() => this.urls.delete(url));
      this.urls.set(url, p);
    }
    return p;
  }

  /** The bytes themselves (e.g. a PDF to print / share). */
  blob(url: string): Promise<Blob> {
    return firstValueFrom(this.http.get(url, { responseType: 'blob' }));
  }

  ngOnDestroy(): void {
    for (const u of this.made) URL.revokeObjectURL(u);
    this.made.clear();
    this.urls.clear();
  }
}
