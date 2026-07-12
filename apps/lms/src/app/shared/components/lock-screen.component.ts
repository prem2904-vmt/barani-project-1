import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { LockService } from '../../core/auth/lock.service';

/** Full-screen idle lock (shared lab machines). Mirrors the version-gate glass
 *  card; unlock = the active account's PIN, verified server-side. */
@Component({
  selector: 'pf-lock-screen',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lock.locked() && auth.isAuthenticated()) {
      <div class="pf-lk-root" role="alertdialog" aria-modal="true" aria-label="Screen locked">
        <div class="pf-lk-backdrop"></div>
        <div class="pf-lk-card">
          <div class="pf-lk-avatar">{{ initials() }}</div>
          <h2 class="pf-lk-name">{{ auth.user()?.displayName }}</h2>
          <p class="pf-lk-hint">Locked after inactivity — enter your PIN to continue.</p>
          <input class="pf-lk-pin" type="password" inputmode="numeric" autocomplete="off"
                 maxlength="6" placeholder="••••"
                 [ngModel]="pin()" (ngModelChange)="onPin($event)"
                 (keydown.enter)="unlock()" [disabled]="busy()" #pinInput />
          @if (error()) { <p class="pf-lk-error">{{ error() }}</p> }
          <button class="pf-lk-btn" (click)="unlock()" [disabled]="busy() || pin().length < 4">
            {{ busy() ? 'Checking…' : 'Unlock' }}
          </button>
          <button class="pf-lk-alt" (click)="lock.abandonToLogin()">Forgot PIN? Sign in with password</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .pf-lk-root {
      position: fixed; inset: 0; z-index: 190; /* below only the version gate */
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .pf-lk-backdrop {
      position: absolute; inset: 0;
      background:
        radial-gradient(1200px 800px at 50% 100%, rgba(124, 58, 237, 0.15), transparent 60%),
        rgba(5, 5, 15, 0.82);
      backdrop-filter: blur(18px) saturate(1.2);
      -webkit-backdrop-filter: blur(18px) saturate(1.2);
    }
    .pf-lk-card {
      position: relative; width: 100%; max-width: 21rem; padding: 28px 24px;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      border-radius: 20px; background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 1px 0 0 rgba(255,255,255,.04) inset, 0 30px 70px rgba(0,0,0,.55);
    }
    .pf-lk-avatar {
      width: 56px; height: 56px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 700; color: #c4b5fd;
      background: linear-gradient(135deg, rgba(168,85,247,.22), rgba(236,72,153,.12));
      border: 1px solid rgba(168,85,247,.3);
    }
    .pf-lk-name { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
    .pf-lk-hint { margin: 0 0 6px; font-size: 12.5px; color: var(--text-secondary); text-align: center; }
    .pf-lk-pin {
      width: 140px; text-align: center; font-size: 22px; letter-spacing: 10px;
      padding: 10px 0; border-radius: 12px;
      background: rgba(255,255,255,.04); border: 1px solid var(--glass-border);
      color: var(--text-primary); outline: none;
    }
    .pf-lk-pin:focus { border-color: rgba(168,85,247,.5); }
    .pf-lk-error { margin: 2px 0 0; font-size: 12px; color: #f87171; }
    .pf-lk-btn {
      margin-top: 8px; width: 100%; min-height: 44px; border-radius: 12px;
      border: none; cursor: pointer; font-size: 14px; font-weight: 600;
      color: #fff; background: linear-gradient(135deg, #7c3aed, #a855f7);
    }
    .pf-lk-btn:disabled { opacity: .55; cursor: default; }
    .pf-lk-alt {
      margin-top: 2px; border: none; background: transparent; cursor: pointer;
      font-size: 12px; color: var(--text-muted); text-decoration: underline;
      min-height: 34px;
    }
  `]
})
export class LockScreenComponent {
  readonly auth = inject(AuthService);
  readonly lock = inject(LockService);

  readonly pin = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  initials(): string {
    return (this.auth.user()?.displayName || '?')
      .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  }

  onPin(v: string) {
    this.pin.set(v.replace(/\D/g, '').slice(0, 6));
    if (this.error()) this.error.set(null);
  }

  async unlock() {
    if (this.busy() || this.pin().length < 4) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.lock.unlock(this.pin());
      this.pin.set('');
    } catch (e) {
      this.error.set((e as Error).message || 'Incorrect PIN.');
    } finally {
      this.busy.set(false);
    }
  }
}
