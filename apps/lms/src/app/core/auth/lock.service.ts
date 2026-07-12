import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { StoredAccount } from './accounts.service';

/** 15-minute idle lock for shared lab machines. Arms only while a PIN-enabled
 *  account is signed in (locking a PIN-less user would strand them). The lock
 *  survives reloads via pf.lockedAt; unlock = server-side PIN verify. */
@Injectable({ providedIn: 'root' })
export class LockService {
  private static readonly IDLE_MS = 15 * 60_000;
  private static readonly LOCKED_KEY = 'pf.lockedAt';

  private readonly auth = inject(AuthService);
  private readonly _locked = signal<boolean>(this.restoreLocked());
  readonly locked = this._locked.asReadonly();

  /** Profile being switched INTO — drives the full-screen switch screen
   *  (Windows-style: leave the current account, meet the target's PIN gate). */
  readonly switchTarget = signal<StoredAccount | null>(null);

  private lastActivity = Date.now();
  private started = false;

  /** Called once from the root component. */
  start(): void {
    if (this.started) return;
    this.started = true;
    // Passive, throttled-by-cheapness activity tracking.
    const bump = () => { this.lastActivity = Date.now(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const) {
      window.addEventListener(ev, bump, { passive: true, capture: true });
    }
    setInterval(() => this.tick(), 30_000);
    // A tab that slept past the idle window locks the moment it wakes.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.tick();
    });
    // Manual lock: Ctrl+L on EVERY platform — browsers reserve ⌘L for the
    // address bar (Safari/Chrome never deliver it to the page), but Ctrl+L is
    // free, including on macOS. ⌘L stays wired for installed-PWA/desktop runs
    // where there is no address bar to compete with.
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
        if (this.auth.isAuthenticated() && this.auth.user()?.hasPin && !this._locked()) {
          e.preventDefault();
          e.stopPropagation();
          this.lock();
        }
      }
    }, { capture: true });
  }

  private tick(): void {
    if (this._locked()) return;
    if (!this.auth.isAuthenticated() || !this.auth.user()?.hasPin) return;
    if (Date.now() - this.lastActivity >= LockService.IDLE_MS) this.lock();
  }

  lock(): void {
    this._locked.set(true);
    try { localStorage.setItem(LockService.LOCKED_KEY, String(Date.now())); } catch { /* */ }
  }

  async unlock(pin: string): Promise<void> {
    await this.auth.verifyPin(pin); // throws with a readable message on failure
    this._locked.set(false);
    this.lastActivity = Date.now();
    try { localStorage.removeItem(LockService.LOCKED_KEY); } catch { /* */ }
  }

  /** Escape hatch when the PIN is forgotten: sign the profile out entirely. */
  async abandonToLogin(): Promise<void> {
    this._locked.set(false);
    try { localStorage.removeItem(LockService.LOCKED_KEY); } catch { /* */ }
    await this.auth.signOut();
    location.assign('/login');
  }

  private restoreLocked(): boolean {
    try { return !!localStorage.getItem(LockService.LOCKED_KEY); } catch { return false; }
  }
}
