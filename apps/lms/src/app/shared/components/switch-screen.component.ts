import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AccountsService, StoredAccount } from '../../core/auth/accounts.service';
import { LockService } from '../../core/auth/lock.service';
import { PinDotsComponent } from './pin-dots.component';

/** Full-screen profile switch (Windows-style): leaves the current account's
 *  UI and meets the TARGET account's 4-digit PIN gate. PIN-less profiles
 *  open directly — the blank auto-attempt lets the server confirm that, so a
 *  stale local "no PIN" flag can't bypass a real PIN. */
@Component({
  selector: 'pf-switch-screen',
  standalone: true,
  imports: [PinDotsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lock.switchTarget(); as target) {
      <div class="pf-sw-root" role="alertdialog" aria-modal="true" aria-label="Switch profile">
        <div class="pf-sw-backdrop"></div>
        <div class="pf-sw-card">
          <div class="pf-sw-avatar">{{ accounts.initials(target) }}</div>
          <h2 class="pf-sw-name">{{ target.displayName }}</h2>
          <p class="pf-sw-org">{{ target.org }}</p>

          @if (needsSignIn()) {
            <!-- The saved sign-in is really over: recover INLINE for this
                 profile (tenant-locked add-account, username pre-filled). -->
            <p class="pf-sw-hint">{{ error() || (target.displayName.split(' ')[0] + '’s saved sign-in has ended on this device.') }}</p>
            <button type="button" class="pf-sw-primary" (click)="signInAgain(target)" data-testid="switch-sign-in-again">
              Sign in as {{ target.displayName.split(' ')[0] }}
            </button>
          } @else {
            @if (pinNeeded()) {
              <p class="pf-sw-hint">Enter {{ target.displayName.split(' ')[0] }}'s PIN</p>
              <pf-pin-dots #dots [disabled]="busy()" (completed)="attempt($event)" />
            } @else {
              <p class="pf-sw-hint">{{ busy() ? 'Opening profile…' : 'No PIN — opening directly.' }}</p>
            }
            @if (error()) { <p class="pf-sw-error" role="alert">{{ error() }}</p> }
          }

          <button class="pf-sw-alt" (click)="cancel()" [disabled]="busy()">Cancel — stay as {{ auth.user()?.displayName }}</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .pf-sw-root {
      position: fixed;
      top: calc(-1 * env(safe-area-inset-top, 0px));
      bottom: calc(-1 * env(safe-area-inset-bottom, 0px));
      left: calc(-1 * env(safe-area-inset-left, 0px));
      right: calc(-1 * env(safe-area-inset-right, 0px));
      z-index: 190;
      display: flex; align-items: center; justify-content: center;
      padding: 24px 20px;
      overflow-y: auto; overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
      box-sizing: border-box;
      --text-primary: #f3f4f6;
      --text-secondary: #d1d5db;
      --text-muted: #9ca3af;
      --bg-card-solid: #13151a;
      --glass-border: rgba(255, 255, 255, 0.08);
      --violet-text: #c084fc;
      --red-text: #fca5a5;
    }
    :host-context(html.light) .pf-sw-root,
    :host-context([data-theme='light']) .pf-sw-root {
      --text-primary: #111928;
      --text-secondary: #4b5563;
      --text-muted: #6b7280;
      --bg-card-solid: #ffffff;
      --glass-border: rgba(17, 25, 40, 0.16);
      --violet-text: #7c3aed;
      --red-text: #b91c1c;
    }
    :host-context(html.cap-native) .pf-sw-root {
      top: calc(-1 * max(env(safe-area-inset-top, 0px), 50px));
    }
    @media (min-width: 641px) {
      :host-context(html.cap-native) .pf-sw-root {
        top: calc(-1 * max(env(safe-area-inset-top, 0px), 24px));
      }
    }
    .pf-sw-backdrop {
      position: absolute; inset: 0;
      background:
        radial-gradient(1200px 800px at 50% 100%, rgba(124, 58, 237, 0.15), transparent 60%),
        rgba(5, 5, 15, 0.96);
      backdrop-filter: blur(20px) saturate(1.2);
      -webkit-backdrop-filter: blur(20px) saturate(1.2);
    }
    :host-context(html.light) .pf-sw-backdrop,
    :host-context([data-theme='light']) .pf-sw-backdrop {
      background:
        radial-gradient(1200px 800px at 50% 100%, rgba(124, 58, 237, 0.14), transparent 60%),
        rgba(243, 243, 249, 0.97);
    }
    .pf-sw-card {
      position: relative; width: 100%; max-width: 22rem;
      padding: 28px 24px 36px 24px;
      margin: auto;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      border-radius: 24px; background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 1px 0 0 rgba(255,255,255,.04) inset, 0 30px 70px rgba(0,0,0,.55);
      box-sizing: border-box;
    }
    :host-context(html.light) .pf-sw-card,
    :host-context([data-theme='light']) .pf-sw-card {
      box-shadow: 0 20px 48px -8px rgba(124, 58, 237, 0.14), 0 4px 16px rgba(17, 25, 40, 0.04);
      border: 1px solid rgba(124, 58, 237, 0.12);
    }
    .pf-sw-avatar {
      width: 64px; height: 64px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 800; color: #7c3aed;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.16) 0%, rgba(219, 39, 119, 0.1) 100%);
      border: 1.5px solid rgba(124, 58, 237, 0.3);
      box-shadow: 0 4px 16px rgba(124, 58, 237, 0.12);
    }
    .pf-sw-name { margin: 2px 0 0; font-size: 17px; font-weight: 700; color: var(--text-primary); }
    .pf-sw-org {
      margin: 0; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em;
      color: #7c3aed; background: rgba(124, 58, 237, 0.08); padding: 3px 12px; border-radius: 9999px;
      border: 1px solid rgba(124, 58, 237, 0.16);
    }
    .pf-sw-hint { margin: 8px 0 0; font-size: 12.5px; font-weight: 500; color: var(--text-secondary); text-align: center; }
    .pf-sw-error { margin: 6px 0 0; font-size: 12px; font-weight: 600; color: var(--red-text); text-align: center; }
    .pf-sw-primary {
      margin-top: 10px; min-height: 44px; padding: 0 20px; border: 0; border-radius: 12px; cursor: pointer;
      background: var(--gradient-primary, linear-gradient(90deg, #7c3aed, #c026d3)); color: #fff;
      font-size: 14px; font-weight: 600;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);
      transition: transform .15s ease, box-shadow .15s ease;
    }
    .pf-sw-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(124, 58, 237, 0.4);
    }
    .pf-sw-primary:focus-visible { outline: 2px solid #c4b5fd; outline-offset: 2px; }
    .pf-sw-alt {
      margin-top: 14px; border: none; background: transparent; cursor: pointer;
      font-size: 12.5px; font-weight: 500; color: var(--text-secondary); text-decoration: none;
      min-height: 38px; padding: 6px 14px; border-radius: 8px; transition: all .15s ease;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .pf-sw-alt:hover { color: #7c3aed; background: rgba(124, 58, 237, 0.06); text-decoration: underline; text-underline-offset: 3px; }

    @media (max-width: 640px) {
      .pf-sw-root {
        padding: max(20px, env(safe-area-inset-top)) 16px
                 max(24px, env(safe-area-inset-bottom));
      }
      .pf-sw-card { max-width: 100%; padding: 24px 20px 32px 20px; margin: auto; }
      .pf-sw-alt { min-height: 44px; }
    }
  `]
})
export class SwitchScreenComponent {
  readonly auth = inject(AuthService);
  readonly accounts = inject(AccountsService);
  readonly lock = inject(LockService);
  private readonly router = inject(Router);
  /** The target's saved sign-in is dead → offer an inline sign-in. */
  readonly needsSignIn = signal(false);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly pinNeeded = signal(false);
  private dots = viewChild(PinDotsComponent);

  constructor() {
    // Each time a target is picked: reset state; PIN-less profiles auto-open
    // (the server decides — a wrong local flag falls back to the PIN input).
    effect(() => {
      const target = this.lock.switchTarget();
      if (!target) return;
      // untracked: attempt() READS busy() synchronously — tracked, every
      // busy flip re-ran this effect and re-attempted, so a PIN-less profile
      // whose switch failed retried in a tight loop (hammering the token
      // endpoint). Only a new target may start an attempt.
      untracked(() => {
        this.error.set(null);
        this.needsSignIn.set(!!target.expired);
        if (target.expired) return;
        this.pinNeeded.set(target.hasPin);
        if (!target.hasPin) void this.attempt('');
      });
    });
  }

  async attempt(pin: string) {
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
      if (err.code === 'session_expired' || err.code === 'session_mismatch') {
        // Not a dead end: the profile stays listed, and its owner signs in
        // again right here. Nothing was switched (checked before any state
        // changed), so the current account is untouched.
        this.error.set(err.message);
        this.needsSignIn.set(true);
        this.busy.set(false);
        return;
      }
      if (pin === '' && (err.code === 'wrong_pin' || err.code === 'locked')) {
        // Local cache said "no PIN" but the server disagrees — ask for it.
        this.pinNeeded.set(true);
        this.accounts.setHasPin(target.userId, true);
        this.error.set(err.code === 'locked' ? err.message : null);
      } else {
        this.error.set(err.message || 'Could not switch.');
        this.dots()?.clear();
      }
      this.busy.set(false);
    }
  }

  cancel() {
    this.lock.switchTarget.set(null);
  }

  /** Tenant-locked "add account" sign-in, username pre-filled; the fresh
   *  session replaces the dead one in the registry. */
  signInAgain(target: StoredAccount) {
    const handle = (target.username || '').trim()
      || (/\.tenant\.prefrontal$/i.test(target.email ?? '') ? target.email.split('@')[0] : (target.email ?? ''));
    this.lock.switchTarget.set(null);
    void this.router.navigate(['/login'], { queryParams: { add: '1', username: handle || null } });
  }
}
