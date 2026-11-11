import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { api } from './api-url';

/** GET/PUT /api/casesheets/prepare — the lab admin's Prepare switch in Settings → IPD (owner 2026-11-11). */
export interface PrepareSwitchState {
  enabled: boolean;
  /** The lab is entitled to IPD (the platform switched it on), so its admin may flip Prepare. */
  canChange: boolean;
}

@Injectable({ providedIn: 'root' })
export class PrepareSwitchApi {
  private readonly http = inject(HttpClient);

  get(): Promise<PrepareSwitchState> {
    return firstValueFrom(this.http.get<PrepareSwitchState>(api('/api/casesheets/prepare')));
  }

  set(enabled: boolean): Promise<PrepareSwitchState> {
    return firstValueFrom(this.http.put<PrepareSwitchState>(api('/api/casesheets/prepare'), { enabled }));
  }
}
