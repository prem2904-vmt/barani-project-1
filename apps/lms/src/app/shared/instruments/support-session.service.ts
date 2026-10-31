import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { InstrumentBridgeService } from './instrument-bridge.service';
import { SupportSessionState } from './instrument.models';

/** How long a session may run (minutes) — main clamps 5–240 again. */
export const SUPPORT_DURATIONS: readonly { value: number; label: string }[] = [
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
];
export const DEFAULT_SUPPORT_MINUTES = 120;

export const IDLE_SUPPORT_STATE: SupportSessionState = Object.freeze({ active: false, status: 'idle', log: [] }) as SupportSessionState;

/** Main's state, made safe to render (anything odd ⇒ idle). */
export function normaliseSupportState(s: unknown): SupportSessionState {
  if (!s || typeof s !== 'object') return IDLE_SUPPORT_STATE;
  const o = s as Partial<SupportSessionState>;
  return {
    ...o,
    active: o.active === true,
    status: (['idle', 'starting', 'waiting', 'connected', 'ended'] as const).includes(o.status as never) ? o.status! : 'idle',
    ...(o.connection !== undefined ? { connection: (['connecting', 'online', 'reconnecting'] as const).includes(o.connection as never) ? o.connection : 'connecting' } : {}),
    log: Array.isArray(o.log) ? o.log.filter((l) => l && typeof l.text === 'string') : [],
  } as SupportSessionState;
}

/** "1:58:07" / "4:05" — time left until `expiresAt`. */
export function countdownText(expiresAt: string | undefined, now: number): string {
  const end = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(end)) return '—';
  const left = Math.max(0, Math.floor((end - now) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = left % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "WDJB-MJHT" — the server's 8-letter code, dash in the middle, read out on the phone. */
export function supportCode(code: string | undefined): string {
  const c = String(code ?? '').replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{8}$/.test(c) ? `${c.slice(0, 4)}-${c.slice(4)}` : '—';
}

/** Why the last session ended, in plain words. */
export function endedText(reason: SupportSessionState['endedReason']): string | null {
  switch (reason) {
    case 'lab': return 'You stopped the last support session.';
    case 'expired': return 'The last support session ran out of time.';
    case 'signed_out': return 'The last support session ended when you signed out.';
    case 'ended': return 'Prefrontal support ended the last session.';
    case 'quit': return 'The last support session ended when the app closed.';
    default: return null;
  }
}

/**
 * "Allow Prefrontal support" from the renderer's side (beta `support`,
 * desktop ≥ 1.1.2). Main owns the session (support-session.js); this keeps
 * its state as a signal, hands main every fresh access token while a session
 * runs, and ends it when the person signs out or another profile takes over.
 * Created at app start (app.ts) so sign-out stops it from any screen.
 */
@Injectable({ providedIn: 'root' })
export class SupportSessionService {
  private readonly bridge = inject(InstrumentBridgeService);
  private readonly auth = inject(AuthService);
  private readonly beta = inject(BetaFeaturesService);

  private readonly _state = signal<SupportSessionState>(IDLE_SUPPORT_STATE);
  readonly state = this._state.asReadonly();
  readonly active = computed(() => this._state().active);
  /** Inside the desktop app with the support bridge. */
  readonly desktop: boolean;
  /** The beta surface may show (console switch + server + dev). */
  readonly visible = computed(() => this.beta.enabled('support'));

  private startedBy: string | null = null;
  private pushedToken: string | null = null;

  constructor() {
    const api = this.bridge.support;
    this.desktop = !!api;
    if (!api) return;
    try { api.onChange((s) => this._state.set(normaliseSupportState(s))); } catch { /* older preload */ }
    void api.status().then((s) => this._state.set(normaliseSupportState(s)), () => undefined);
    // While a session runs: every refreshed token goes to main; signing out
    // (no token) or switching to another profile ends the session.
    effect(() => {
      const active = this.active();
      const token = this.auth.accessToken();
      const userId = this.auth.user()?.id ?? null;
      untracked(() => {
        if (!active) { this.pushedToken = null; return; }
        if (!token || (this.startedBy && userId && userId !== this.startedBy)) { void this.stop(); return; }
        if (token !== this.pushedToken) {
          this.pushedToken = token;
          void api.setToken(token).catch(() => undefined);
        }
      });
    });
  }

  /** Start a session for `minutes`. Resolves to an error in plain words, or null. */
  async start(minutes: number): Promise<string | null> {
    const api = this.bridge.support;
    if (!api) return 'Remote support runs in the desktop app on the lab PC.';
    if (!this.visible()) return 'Remote support isn’t switched on.';
    const token = await this.auth.getAccessToken();
    if (!token) return 'Sign in again, then try once more.';
    try {
      // The active branch rides X-Active-Branch on main's HTTP calls and hub connection.
      const branchId = this.auth.activeBranchId() ?? undefined;
      const r = await api.start({ minutes, token, apiUrl: environment.apiUrl, ...(branchId ? { branchId } : {}) });
      if (r?.state) this._state.set(normaliseSupportState(r.state));
      if (!r?.ok) return r?.error === 'already_active' ? null : (r?.error || 'Couldn’t start the support session.');
      this.startedBy = this.auth.user()?.id ?? null;
      this.pushedToken = token;
      return null;
    } catch (e) {
      return (e as Error)?.message || 'Couldn’t start the support session.';
    }
  }

  /** Stop the session (always allowed, beta or not). */
  async stop(): Promise<void> {
    const api = this.bridge.support;
    if (!api) return;
    try {
      const r = await api.stop();
      if (r?.state) this._state.set(normaliseSupportState(r.state));
    } catch { /* main ends it on quit / expiry anyway */ }
    this.startedBy = null;
    this.pushedToken = null;
  }
}
