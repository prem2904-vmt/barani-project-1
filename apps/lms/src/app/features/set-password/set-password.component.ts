import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SessionService } from '../../core/auth/session.service';
import { PlatformService } from '../../core/services/platform.service';
import { KeyboardService } from '../../core/services/keyboard.service';
import { ApiError } from '../../shared/models/api-response.model';
import { LogoMarkComponent } from '../../shared/primitives/logo-mark.component';
import { LoadingLogoComponent } from '../../shared/components/loading-logo/loading-logo.component';
import { AmbientBgComponent } from '../../shared/components/ambient-bg/ambient-bg.component';

/**
 * Forced-password-change gate. Reached when a user signs in with a temporary
 * password (first login or after an admin reset) — auth.guard holds every
 * in-shell route here until `mustChangePassword` clears.
 *
 * Client-side policy mirrors the server (NIST 800-63B): length 8–64, no
 * composition rules. The server independently re-checks length AND screens the
 * password against the Pwned k-anonymity list, so the breach check is
 * authoritative there; here we only do cheap length + match validation for
 * instant feedback.
 */
@Component({
  selector: 'pf-set-password',
  standalone: true,
  imports: [FormsModule, LogoMarkComponent, LoadingLogoComponent, AmbientBgComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './set-password.component.html',
  // The sign-in screen's stylesheet is this page's base: same shell, brand,
  // card and fields (the Oct-31 Tailwind rewrite drifted from it).
  styleUrls: ['../login/login.component.scss', './set-password.component.scss'],
  host: { '[class.lg-host--kb]': 'kb.visible()' },
})
export class SetPasswordComponent implements AfterViewInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly platform = inject(PlatformService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly kb = inject(KeyboardService);

  /** Where to go once the password is set (login / the consent guard pass
   *  it through) — in-app paths only; otherwise the landing. */
  private readonly returnUrl = (() => {
    const u = inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl');
    return u && SessionService.isReturnable(u) ? u : null;
  })();

  protected readonly pw = signal('');
  protected readonly confirm = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);

  /** Live, non-blocking strength/validity hints shown under the field. */
  protected readonly tooShort = computed(() => this.pw().length > 0 && this.pw().length < 8);
  protected readonly mismatch = computed(() => this.confirm().length > 0 && this.confirm() !== this.pw());
  /** The new-password box shows red: too short, or a length error on submit. */
  protected readonly newPwInvalid = computed(() => this.tooShort() || (!!this.error() && (this.pw().length < 8 || this.pw().length > 64)));

  /** True when running inside Capacitor (iOS/Android), false on web. */
  protected readonly isNative = computed(() => this.platform.isCapacitor());
  /** Touch host: never auto-focus (no surprise keyboard); dodge the keyboard. */
  private readonly touch = typeof window !== 'undefined'
    && (this.platform.isCapacitor() || (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches));

  /** Split layout (brand panel + card): iPad landscape and desktop. */
  protected readonly wide = signal(false);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly newPassInput = viewChild<ElementRef<HTMLInputElement>>('newPassInput');
  private readonly confirmPassInput = viewChild<ElementRef<HTMLInputElement>>('confirmPassInput');
  private readonly submitBtn = viewChild<ElementRef<HTMLButtonElement>>('submitBtn');

  private revealTimers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    this.wireKeyboardDodge();
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(min-width: 1024px)');
      this.wide.set(mq.matches);
      const onChange = (e: MediaQueryListEvent) => this.wide.set(e.matches);
      mq.addEventListener?.('change', onChange);
      this.destroyRef.onDestroy(() => mq.removeEventListener?.('change', onChange));
    }
  }

  ngAfterViewInit(): void {
    if (this.touch) return;
    queueMicrotask(() => this.newPassInput()?.nativeElement.focus());
  }

  protected onEnterNewPassword(ev: Event): void {
    ev.preventDefault();
    this.confirmPassInput()?.nativeElement.focus();
  }

  protected onEnterConfirmPassword(ev: Event): void {
    ev.preventDefault();
    // Always submit: an invalid pair gets its reason inline, never silence.
    void this.submit(ev);
  }

  async submit(ev?: Event) {
    ev?.preventDefault?.();
    if (this.busy()) return;

    if (this.pw().length < 8 || this.pw().length > 64) {
      this.error.set('Password must be 8–64 characters.');
      return;
    }
    if (this.pw() !== this.confirm()) {
      this.error.set('The two passwords don’t match.');
      return;
    }

    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.changePassword(this.pw());
      // Gate cleared — back to where the sign-in was headed (e.g. an AI
      // connector consent link), else the app root and the landing guard.
      await this.router.navigateByUrl(this.returnUrl ?? '/');
    } catch (e: unknown) {
      // auth.changePassword throws a plain Error; ApiError.from normalises it
      // (and any HttpErrorResponse) so the REAL backend reason surfaces. This
      // is a password-only form, so field-named failures (field 'newPassword'/
      // 'password', code weak_password/breached_password) route to the same
      // inline error surface beneath the password inputs — cleared on edit via
      // the inputs' (ngModelChange)="error.set(null)".
      this.error.set(ApiError.from(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  /** Full sign-out sequence (revoke, push, sockets, clear, /login). */
  async signOut() {
    await this.session.logout();
  }

  // ── Soft keyboard dodge on mobile ──────────────────────────────────
  private wireKeyboardDodge(): void {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const onViewport = () => {
      this.syncInsets();
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && this.scroller()?.nativeElement.contains(el)) this.reveal(el);
    };
    const onResize = () => this.syncInsets();
    vv?.addEventListener('resize', onViewport);
    vv?.addEventListener('scroll', onViewport);
    window.addEventListener('resize', onResize);
    this.destroyRef.onDestroy(() => {
      vv?.removeEventListener('resize', onViewport);
      vv?.removeEventListener('scroll', onViewport);
      window.removeEventListener('resize', onResize);
      for (const t of this.revealTimers) clearTimeout(t);
      const active = document.activeElement;
      if (active instanceof HTMLElement && this.scroller()?.nativeElement.contains(active)) active.blur();
      this.kb.reset();
    });
    queueMicrotask(() => this.syncInsets());
  }

  private syncInsets(): void {
    const host = this.scroller()?.nativeElement;
    if (!host || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const focused = document.activeElement instanceof HTMLInputElement && host.contains(document.activeElement);
    const overlap = vv && focused ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    host.style.setProperty('--lg-kb', `${overlap > 80 ? overlap : 0}px`);
    if (!focused && !this.kb.visible()) host.style.setProperty('--lg-h', `${host.clientHeight}px`);
  }

  protected revealSoon(el: HTMLElement): void {
    if (!this.touch) return;
    for (const t of this.revealTimers) clearTimeout(t);
    this.revealTimers = [60, 320, 650].map(ms => setTimeout(() => { this.syncInsets(); this.reveal(el); }, ms));
  }

  protected onFieldFocus(ev: FocusEvent): void {
    const el = ev.target as HTMLElement | null;
    if (el) this.revealSoon(el);
  }

  private reveal(el: HTMLElement): void {
    const host = this.scroller()?.nativeElement;
    if (!host || !this.touch) return;
    const field = (el.closest('[data-field]') as HTMLElement | null) ?? el;
    const top = field.getBoundingClientRect().top;
    let bottom = field.getBoundingClientRect().bottom;
    const btn = this.submitBtn()?.nativeElement;
    if (btn) bottom = Math.max(bottom, btn.getBoundingClientRect().bottom);
    const vv = window.visualViewport;
    const visTop = (vv?.offsetTop ?? 0) + 12;
    const visBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 16;
    let delta = 0;
    if (bottom > visBottom) delta = bottom - visBottom;
    if (top - delta < visTop) delta = top - visTop;
    if (Math.abs(delta) < 2) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    host.scrollTo({ top: host.scrollTop + delta, behavior: reduce ? 'auto' : 'smooth' });
  }
}
