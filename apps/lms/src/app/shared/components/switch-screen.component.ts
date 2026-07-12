import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { AccountsService } from '../../core/auth/accounts.service';
import { LockService } from '../../core/auth/lock.service';

/** Full-screen profile switch (Windows-style): leaves the current account's
 *  UI entirely and meets the TARGET account's PIN gate. PIN-less profiles
 *  open directly — the auto-attempt lets the server confirm that, so a stale
 *  local "no PIN" flag can't bypass a real PIN. */
@Component({
  selector: 'pf-switch-screen',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lock.switchTarget(); as target) {
      <div class="pf-sw-root" role="alertdialog" aria-modal="true" aria-label="Switch profile">
        <div class="pf-sw-backdrop"></div>
        <div class="pf-sw-card">
          <div class="pf-sw-avatar">{{ accounts.initials(target) }}</div>
          <h2 class="pf-sw-name">{{ target.displayName }}</h2>
          <p class="pf-sw-org">{{ target.org }}</p>

          @if (pinNeeded()) {
            <p class="pf-sw-hint">Enter {{ target.displayName.split(' ')[0] }}'s PIN to switch.</p>
            <input class="pf-sw-pin" type="password" inputmode="numeric" autocomplete="off"
                   maxlength="6" placeholder="••••"
                   [ngModel]="pin()" (ngModelChange)="onPin($event)"
                   (keydown.enter)="confirm()" [disabled]="busy()" />
            @if (error()) { <p class="pf-sw-error">{{ error() }}</p> }
            <button class="pf-sw-btn" (click)="confirm()" [disabled]="busy() || pin().length < 4">
              {{ busy() ? 'Switching…' : 'Switch profile' }}
            </button>
          } @else {
            <p class="pf-sw-hint">{{ busy() ? 'Opening profile…' : 'This profile has no PIN — opening it directly.' }}</p>
            @if (error()) { <p class="pf-sw-error">{{ error() }}</p> }
          }

          <button class="pf-sw-alt" (click)="cancel()" [disabled]="busy()">Cancel — stay as {{ auth.user()?.displayName }}</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .pf-sw-root {
      position: fixed; inset: 0; z-index: 190;
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .pf-sw-backdrop {
      position: absolute; inset: 0;
      background:
        radial-gradient(1200px 800px at 50% 100%, rgba(124, 58, 237, 0.15), transparent 60%),
        rgba(5, 5, 15, 0.82);
      backdrop-filter: blur(18px) saturate(1.2);
      -webkit-backdrop-filter: blur(18px) saturate(1.2);
    }
    .pf-sw-card {
      position: relative; width: 100%; max-width: 21rem; padding: 28px 24px;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      border-radius: 20px; background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 1px 0 0 rgba(255,255,255,.04) inset, 0 30px 70px rgba(0,0,0,.55);
    }
    .pf-sw-avatar {
      width: 56px; height: 56px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 700; color: #c4b5fd;
      background: linear-gradient(135deg, rgba(168,85,247,.22), rgba(236,72,153,.12));
      border: 1px solid rgba(168,85,247,.3);
    }
    .pf-sw-name { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
    .pf-sw-org { margin: -4px 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-muted); }
    .pf-sw-hint { margin: 6px 0 0; font-size: 12.5px; color: var(--text-secondary); text-align: center; }
    .pf-sw-pin {
      width: 140px; text-align: center; font-size: 22px; letter-spacing: 10px;
      padding: 10px 0; border-radius: 12px; margin-top: 4px;
      background: rgba(255,255,255,.04); border: 1px solid var(--glass-border);
      color: var(--text-primary); outline: none;
    }
    .pf-sw-pin:focus { border-color: rgba(168,85,247,.5); }
    .pf-sw-error { margin: 4px 0 0; font-size: 12px; color: #f87171; }
    .pf-sw-btn {
      margin-top: 10px; width: 100%; min-height: 44px; border-radius: 12px;
      border: none; cursor: pointer; font-size: 14px; font-weight: 600;
      color: #fff; background: linear-gradient(135deg, #7c3aed, #a855f7);
    }
    .pf-sw-btn:disabled { opacity: .55; cursor: default; }
    .pf-sw-alt {
      margin-top: 4px; border: none; background: transparent; cursor: pointer;
      font-size: 12px; color: var(--text-muted); text-decoration: underline;
      min-height: 34px;
    }
  `]
})
export class SwitchScreenComponent {
  readonly auth = inject(AuthService);
  readonly accounts = inject(AccountsService);
  readonly lock = inject(LockService);

  readonly pin = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly pinNeeded = signal(false);

  constructor() {
    // Each time a target is picked: reset state; PIN-less profiles auto-open
    // (the server decides — a wrong local flag falls back to the PIN input).
    effect(() => {
      const target = this.lock.switchTarget();
      if (!target) return;
      this.pin.set('');
      this.error.set(null);
      this.pinNeeded.set(target.hasPin);
      if (!target.hasPin) void this.attempt('');
    });
  }

  onPin(v: string) {
    this.pin.set(v.replace(/\D/g, '').slice(0, 6));
    if (this.error()) this.error.set(null);
  }

  confirm() {
    if (this.busy() || this.pin().length < 4) return;
    void this.attempt(this.pin());
  }

  private async attempt(pin: string) {
    const target = this.lock.switchTarget();
    if (!target || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.switchAccount(target, pin);
      // Full reload: every per-user service re-bootstraps for the new profile.
      location.assign('/');
    } catch (e) {
      const err = e as Error & { code?: string };
      if (pin === '' && (err.code === 'wrong_pin' || err.code === 'locked')) {
        // Local cache said "no PIN" but the server disagrees — ask for it.
        this.pinNeeded.set(true);
        this.accounts.setHasPin(target.userId, true);
        this.error.set(err.code === 'locked' ? err.message : 'This profile has a PIN.');
      } else {
        this.error.set(err.message || 'Could not switch.');
      }
      this.busy.set(false);
    }
  }

  cancel() {
    this.lock.switchTarget.set(null);
  }
}
