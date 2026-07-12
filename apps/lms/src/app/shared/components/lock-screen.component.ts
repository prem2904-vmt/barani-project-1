import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { AccountsService, StoredAccount } from '../../core/auth/accounts.service';
import { LockService } from '../../core/auth/lock.service';
import { PinDotsComponent } from './pin-dots.component';

/** OTT-style lock screen (shared lab machines): when locked, the screen
 *  becomes a "Who's working?" profile picker — every signed-in profile is a
 *  tile. Picking your own profile unlocks in place; picking someone else's
 *  switches to them. Either way the tile's PIN (4 digits, server-verified)
 *  gates entry; PIN-less profiles open directly. */
@Component({
  selector: 'pf-lock-screen',
  standalone: true,
  imports: [PinDotsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lock.locked() && auth.isAuthenticated()) {
      <div class="pf-lk-root" role="alertdialog" aria-modal="true" aria-label="Screen locked">
        <div class="pf-lk-backdrop"></div>

        @if (!selected()) {
          <div class="pf-lk-picker">
            <h2 class="pf-lk-heading">Who's working?</h2>
            <div class="pf-lk-tiles">
              @for (a of accounts.accounts(); track a.userId) {
                <button class="pf-lk-tile" (click)="select(a)">
                  <span class="pf-lk-tile-avatar">{{ accounts.initials(a) }}</span>
                  <span class="pf-lk-tile-name">{{ a.displayName }}</span>
                  <span class="pf-lk-tile-org">{{ a.org }}</span>
                </button>
              }
            </div>
            <button class="pf-lk-alt" (click)="lock.abandonToLogin()">Sign in with a different account</button>
          </div>
        } @else {
          <div class="pf-lk-card">
            <button class="pf-lk-back" (click)="back()" [disabled]="busy()">‹ Profiles</button>
            <div class="pf-lk-avatar">{{ accounts.initials(selected()!) }}</div>
            <h2 class="pf-lk-name">{{ selected()!.displayName }}</h2>
            <p class="pf-lk-org">{{ selected()!.org }}</p>

            @if (pinNeeded()) {
              <p class="pf-lk-hint">Enter PIN</p>
              <pf-pin-dots #dots [disabled]="busy()" (completed)="attempt($event)" />
            } @else {
              <p class="pf-lk-hint">{{ busy() ? 'Opening profile…' : 'No PIN — opening directly.' }}</p>
            }
            @if (error()) { <p class="pf-lk-error">{{ error() }}</p> }
            <button class="pf-lk-alt" (click)="lock.abandonToLogin()">Forgot PIN? Sign in with password</button>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .pf-lk-root {
      position: fixed; inset: 0; z-index: 190;
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .pf-lk-backdrop {
      position: absolute; inset: 0;
      background:
        radial-gradient(1200px 800px at 50% 100%, rgba(124, 58, 237, 0.15), transparent 60%),
        rgba(5, 5, 15, 0.9);
      backdrop-filter: blur(20px) saturate(1.2);
      -webkit-backdrop-filter: blur(20px) saturate(1.2);
    }

    /* ── Profile picker (OTT style) ── */
    .pf-lk-picker {
      position: relative;
      display: flex; flex-direction: column; align-items: center; gap: 26px;
      max-width: 640px;
    }
    .pf-lk-heading {
      margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.01em;
      color: var(--text-primary);
    }
    .pf-lk-tiles {
      display: flex; flex-wrap: wrap; justify-content: center;
      gap: 26px;
      /* 25-profile devices: the grid scrolls instead of outgrowing the screen. */
      max-height: min(58vh, 520px);
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 4px;
      scrollbar-width: thin;
    }
    .pf-lk-tile {
      display: flex; flex-direction: column; align-items: center; gap: 9px;
      width: 118px; padding: 8px; border: none; background: transparent;
      cursor: pointer; border-radius: 14px;
      transition: transform .15s ease;
    }
    .pf-lk-tile:hover { transform: scale(1.05); }
    .pf-lk-tile:focus-visible { outline: 2px solid rgba(168,85,247,.6); outline-offset: 2px; }
    .pf-lk-tile-avatar {
      width: 84px; height: 84px; border-radius: 22px;
      display: flex; align-items: center; justify-content: center;
      font-size: 28px; font-weight: 700; color: #c4b5fd;
      background: linear-gradient(135deg, rgba(168,85,247,.24), rgba(236,72,153,.12));
      border: 1.5px solid rgba(168,85,247,.32);
      transition: border-color .15s ease;
    }
    .pf-lk-tile:hover .pf-lk-tile-avatar { border-color: rgba(168,85,247,.7); }
    .pf-lk-tile-name {
      max-width: 112px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 13.5px; font-weight: 600; color: var(--text-primary);
    }
    .pf-lk-tile-org {
      max-width: 112px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em;
      color: var(--text-muted);
    }

    /* ── Selected profile / PIN card ── */
    .pf-lk-card {
      position: relative; width: 100%; max-width: 21rem; padding: 24px;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      border-radius: 20px; background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 1px 0 0 rgba(255,255,255,.04) inset, 0 30px 70px rgba(0,0,0,.55);
    }
    .pf-lk-back {
      align-self: flex-start;
      border: none; background: transparent; cursor: pointer;
      font-size: 13px; color: var(--text-muted); padding: 4px 6px; min-height: 34px;
    }
    .pf-lk-back:hover { color: var(--text-primary); }
    .pf-lk-avatar {
      width: 56px; height: 56px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 700; color: #c4b5fd;
      background: linear-gradient(135deg, rgba(168,85,247,.22), rgba(236,72,153,.12));
      border: 1px solid rgba(168,85,247,.3);
    }
    .pf-lk-name { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
    .pf-lk-org { margin: -4px 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-muted); }
    .pf-lk-hint { margin: 6px 0 0; font-size: 12.5px; color: var(--text-secondary); text-align: center; }
    .pf-lk-error { margin: 2px 0 0; font-size: 12px; color: #f87171; }
    .pf-lk-alt {
      margin-top: 6px; border: none; background: transparent; cursor: pointer;
      font-size: 12px; color: var(--text-muted); text-decoration: underline;
      min-height: 34px; position: relative;
    }
  `]
})
export class LockScreenComponent {
  readonly auth = inject(AuthService);
  readonly accounts = inject(AccountsService);
  readonly lock = inject(LockService);

  readonly selected = signal<StoredAccount | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly pinNeeded = signal(true);
  private dots = viewChild(PinDotsComponent);

  select(a: StoredAccount) {
    this.selected.set(a);
    this.error.set(null);
    const isMe = a.userId === this.auth.user()?.id;
    // My own profile: the lock only arms for PIN-enabled users, so always ask.
    // Someone else's: their PIN — or straight in when they don't have one
    // (the blank attempt lets the SERVER confirm; a stale flag can't bypass).
    this.pinNeeded.set(isMe ? true : a.hasPin);
    if (!isMe && !a.hasPin) void this.attempt('');
  }

  back() {
    this.selected.set(null);
    this.error.set(null);
  }

  async attempt(pin: string) {
    const target = this.selected();
    if (!target || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      if (target.userId === this.auth.user()?.id) {
        await this.lock.unlock(pin);          // unlock in place, session resumes
        this.selected.set(null);
      } else {
        await this.auth.switchAccount(target, pin);
        this.lock.clearAfterSwitch();         // don't boot the new profile locked
        location.assign('/');                 // clean re-bootstrap as the new user
        return;
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      if (pin === '' && (err.code === 'wrong_pin' || err.code === 'locked')) {
        // Stale local "no PIN" — the server says otherwise. Ask for it.
        this.pinNeeded.set(true);
        this.accounts.setHasPin(target.userId, true);
        this.error.set(err.code === 'locked' ? err.message : null);
      } else {
        this.error.set(err.message || 'Incorrect PIN.');
        this.dots()?.clear();
      }
    } finally {
      this.busy.set(false);
    }
  }
}
