import { Injectable, signal } from '@angular/core';

/**
 * Calls currently ringing on a NATIVE ringer the OS owns — the iOS CallKit
 * lockscreen ring (VoIP push) or the Android full-screen call notification.
 * (Not the Electron call window — it has no sound of its own; the renderer's
 * ringtone is the ring there.) While a call id is in here the in-app ringtone
 * stays quiet (the OS is already ringing — two ringtones at once is the bug),
 * but the in-app ring card still shows.
 *
 * Dependency-free so the ring controller, push handling and the Electron
 * bridge can all share it without a DI cycle.
 */
@Injectable({ providedIn: 'root' })
export class NativeRingState {
  private readonly _ids = signal<ReadonlySet<string>>(new Set());
  readonly ids = this._ids.asReadonly();

  add(sessionId: string): void {
    if (!sessionId || this._ids().has(sessionId)) return;
    const next = new Set(this._ids()); next.add(sessionId); this._ids.set(next);
  }

  remove(sessionId: string): void {
    if (!this._ids().has(sessionId)) return;
    const next = new Set(this._ids()); next.delete(sessionId); this._ids.set(next);
  }

  has(sessionId: string | null | undefined): boolean {
    return !!sessionId && this._ids().has(sessionId);
  }

  clear(): void { if (this._ids().size) this._ids.set(new Set()); }
}
