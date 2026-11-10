import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';

/**
 * Practice settings of a personal case-sheet space (plan §1.1 / §3.6): the header and signature its PDFs carry.
 * PORTED from prefrontal-prepare-ui `core/cases/case-models.ts` (PracticeSettings / PracticeImage) and
 * `core/cases/http-cases-api.ts` (toPractice + the four practice calls), paths moved under `/api/casesheets/`
 * (docs/CASESHEETS.md Part 2: `/api/practice-settings` → `/api/casesheets/practice-settings`). The server scopes
 * every call to the caller (tenant + `UserId == caller`). WP5's full CasesApi port may absorb this later — same
 * wire format, so only the import moves.
 */
export interface PracticeImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface PracticeSettings {
  practiceName: string;
  doctorName: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  email: string;
  website: string;
  /** Print the header and signature on case-sheet PDFs. */
  enabled: boolean;
  logo: PracticeImage | null;
  signature: PracticeImage | null;
}

export const PRACTICE_PATH = '/api/casesheets/practice-settings';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Empty / blank → null on the wire (Prepare's `nul`). */
const nul = (v: string): string | null => (v && v.trim() ? v.trim() : null);

/** A server-relative file link (`/api/casesheets/files/…?exp=…&sig=…`) → absolute against the API (read lazily). */
export function absolute(url: string): string {
  return url.startsWith('/') && !url.startsWith('//') ? `${environment.apiUrl}${url}` : url;
}

function toImage(v: unknown): PracticeImage | null {
  const i = obj(v);
  if (typeof i['url'] !== 'string') return null;
  return {
    url: absolute(i['url'] as string),
    width: typeof i['width'] === 'number' ? (i['width'] as number) : null,
    height: typeof i['height'] === 'number' ? (i['height'] as number) : null,
  };
}

export function toPractice(v: unknown): PracticeSettings {
  const p = obj(v);
  return {
    practiceName: str(p['practiceName']),
    doctorName: str(p['doctorName']),
    addressLine1: str(p['addressLine1']),
    addressLine2: str(p['addressLine2']),
    phone: str(p['phone']),
    email: str(p['email']),
    website: str(p['website']),
    enabled: p['enabled'] !== false,
    logo: toImage(p['logo']),
    signature: toImage(p['signature']),
  };
}

@Injectable({ providedIn: 'root' })
export class PracticeApi {
  private readonly http = inject(HttpClient);
  private url(path = ''): string {
    return `${environment.apiUrl}${PRACTICE_PATH}${path}`;
  }

  async getPractice(): Promise<PracticeSettings> {
    return toPractice(await firstValueFrom(this.http.get<unknown>(this.url())));
  }

  async savePractice(s: PracticeSettings): Promise<PracticeSettings> {
    const body = {
      practiceName: nul(s.practiceName),
      doctorName: nul(s.doctorName),
      addressLine1: nul(s.addressLine1),
      addressLine2: nul(s.addressLine2),
      phone: nul(s.phone),
      email: nul(s.email),
      website: nul(s.website),
      enabled: s.enabled,
    };
    return toPractice(await firstValueFrom(this.http.put<unknown>(this.url(), body)));
  }

  /** The picture goes as the raw body (PNG / JPEG). */
  async uploadPracticeImage(kind: 'logo' | 'signature', file: Blob): Promise<PracticeSettings> {
    const r = await firstValueFrom(this.http.put<unknown>(this.url(`/${kind}`), file, {
      headers: new HttpHeaders({ 'Content-Type': file.type || 'application/octet-stream' }),
    }));
    return r && typeof r === 'object' ? toPractice(r) : this.getPractice();
  }

  async removePracticeImage(kind: 'logo' | 'signature'): Promise<PracticeSettings> {
    await firstValueFrom(this.http.delete(this.url(`/${kind}`)));
    return this.getPractice();
  }
}
