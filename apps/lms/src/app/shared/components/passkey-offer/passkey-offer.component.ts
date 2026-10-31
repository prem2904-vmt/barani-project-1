import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../../core/auth/auth.service';
import { PasskeyService } from '../../../core/auth/passkey.service';
import { PasskeyOfferService } from '../../../core/auth/passkey-offer';
import { PasskeyError, passkeyErrorText } from '../../../core/auth/passkey-webauthn';
import { ToastService } from '../../../core/services/toast.service';
import { PasskeyIconComponent } from '../../primitives/passkey-icon.component';

/**
 * "Sign in faster next time with fingerprint or face?" — optional, dismissible,
 * shown at most ONCE per user per device, and only after a password sign-in in
 * a web browser (rules: core/auth/passkey-offer.ts). Mounted once in the shell.
 * Nothing is created unless the person presses "Set up".
 */
@Component({
  selector: 'pf-passkey-offer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PasskeyIconComponent],
  template: `
    @if (visible()) {
      <!-- role="region", never "dialog": the global phone rule turns every [role=dialog] into a full sheet. -->
      <section class="pf-pko" role="region" aria-labelledby="pf-pko-title" data-testid="passkey-offer">
        <span class="pf-pko__icon" aria-hidden="true"><pf-passkey-icon [size]="16"></pf-passkey-icon></span>
        <span class="pf-pko__text">
          <span class="pf-pko__title" id="pf-pko-title">Sign in faster next time with fingerprint or face?</span>
          <span class="pf-pko__note">Set up a passkey on this device. Only do this on your own device — not on a shared lab computer.</span>
          @if (error()) { <span class="pf-pko__error" role="alert">{{ error() }}</span> }
        </span>
        <span class="pf-pko__actions">
          <button type="button" class="pf-btn pf-btn--secondary press" data-testid="passkey-offer-dismiss" (click)="notNow()" [disabled]="busy()">Not now</button>
          <button type="button" class="pf-btn pf-btn--primary press" data-testid="passkey-offer-setup" (click)="setUp()" [disabled]="busy()">
            {{ busy() ? 'Waiting…' : 'Set up' }}
          </button>
        </span>
      </section>
    }
  `,
  styles: [`
    .pf-pko {
      position: fixed; z-index: 63; right: 16px; bottom: calc(var(--pf-nav-h, 0px) + 16px);
      display: flex; align-items: center; gap: 12px; max-width: min(560px, calc(100vw - 32px));
      padding: 12px 14px; border-radius: var(--pf-radius-card, 14px);
      background: var(--pf-card-bg, #fff); border: 1px solid var(--pf-line, #e5e7eb);
      box-shadow: 0 10px 32px rgba(15, 23, 42, 0.18);
      animation: pf-pko-in 320ms var(--pf-spring, cubic-bezier(0.32, 0.72, 0, 1)) both;
    }
    .pf-pko__icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px;
      border-radius: 9px; background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); color: var(--violet-text, #7c3aed); }
    .pf-pko__text { display: flex; flex-direction: column; min-width: 0; gap: 3px; }
    .pf-pko__title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-pko__note { font-size: 12.5px; line-height: 1.45; color: var(--text-secondary); }
    .pf-pko__error { font-size: 12.5px; color: var(--red-text, #dc2626); }
    .pf-pko__actions { display: flex; gap: 8px; flex: none; }
    @keyframes pf-pko-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .pf-pko { animation: none; } }
    @media (max-width: 640px) {
      .pf-pko { left: 16px; right: 16px; max-width: none; flex-wrap: wrap; align-items: flex-start; }
      .pf-pko__text { flex: 1 1 calc(100% - 44px); }
      .pf-pko__actions { width: 100%; }
      .pf-pko__actions .pf-btn { flex: 1 1 0; }
    }
  `],
})
export class PasskeyOfferComponent {
  private readonly auth = inject(AuthService);
  private readonly passkeys = inject(PasskeyService);
  private readonly offer = inject(PasskeyOfferService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly url = signal(this.router.url);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  /** Pending for THIS user, passkeys usable here, not mid temp-password change. */
  readonly visible = computed(() => {
    const id = this.auth.user()?.id;
    if (!id || this.offer.pending() !== id) return false;
    if (this.auth.mustChangePassword() || !this.passkeys.available()) return false;
    const u = this.url();
    return !u.startsWith('/set-password') && !u.startsWith('/security') && !u.startsWith('/login');
  });

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(e => this.url.set(e.urlAfterRedirects));
    // Shown once: mark it seen the moment it appears (never a second nag).
    effect(() => {
      if (!this.visible()) return;
      const id = this.auth.user()?.id;
      if (id) untracked(() => this.offer.shown(id));
    });
    // A different person / sign-out: drop the offer.
    effect(() => {
      const id = this.auth.user()?.id ?? null;
      untracked(() => { const p = this.offer.pending(); if (p && p !== id) this.offer.clear(); });
    });
  }

  notNow(): void { this.offer.clear(); }

  async setUp(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.passkeys.register();
      this.offer.clear();
      this.toasts.success('Passkey added. Next time, choose “Sign in with a passkey”.');
    } catch (e) {
      const kind = e instanceof PasskeyError ? e.kind : 'failed';
      this.error.set(passkeyErrorText(kind, 'add'));
    } finally {
      this.busy.set(false);
    }
  }
}
