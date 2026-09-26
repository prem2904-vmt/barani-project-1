import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { SettingAdapter } from './adapter';

/**
 * The signed-in user's own settings ("Only me"): the signature drawn on
 * reports they approve (drawn on /signature) and the registration number
 * printed under it (PUT /api/auth/me/registration-id).
 */
@Injectable({ providedIn: 'root' })
export class MeAdapter implements SettingAdapter {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);

  ensure(): void { /* from /me */ }
  loaded(): boolean { return !!this.auth.user(); }

  read(key: string): unknown {
    const u = this.auth.user();
    if (key === 'signature') return u?.signatureDataUrl ? 'Saved' : 'Not set yet';
    if (key === 'registrationId') return u?.registrationId ?? '';
    return undefined;
  }

  async write(key: string, value: unknown): Promise<void> {
    if (key !== 'registrationId') throw new Error('Draw it on My signature.');
    const v = String(value ?? '').trim() || null;
    const r = await firstValueFrom(this.api.put<{ registrationId: string | null }>('/api/auth/me/registration-id', { registrationId: v }));
    this.auth.setRegistrationIdLocal(r?.registrationId ?? v);
  }
}
