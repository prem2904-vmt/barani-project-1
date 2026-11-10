import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SegmentedComponent, SegmentedOption } from '@prefrontal/shared';
import { AuthService } from '../../../core/auth/auth.service';
import { SessionService } from '../../../core/auth/session.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ThemeMode, ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { PracticeCardComponent } from './practice-card.component';

/**
 * Settings on the public case-sheet site: who you are, how it looks, what your PDFs print (personal spaces only —
 * a lab's PDFs carry the lab's own branding), sign out.
 *
 * PORTED from prefrontal-prepare-ui `features/settings/settings.page.*` (layout + copy). Adapted: the LMS
 * AuthService profile (no Google picture — `user_metadata` is never used), the LMS ThemeService + SessionService
 * sign-out sequence, no Assistants row (the connector is phase 3), "Prefrontal" instead of "Prepare".
 */
@Component({
  selector: 'pf-cs-settings',
  standalone: true,
  imports: [HeroBandComponent, PfIconComponent, SegmentedComponent, PracticeCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-page pg">
      <pf-hero-band [contextBar]="true" [customSearch]="true">
        <div band-search class="ctx">
          <span class="ctx__k">Signed in as</span>
          <span class="ctx__v">{{ email() || name() }}</span>
        </div>
      </pf-hero-band>
      <div class="pf-body pf-body--split">
        <section class="pf-card main" aria-labelledby="cs-profile-h">
          <header class="pf-card__head">
            <span class="pf-card__icon"><pf-icon name="user" [size]="16" /></span>
            <h1 class="pf-card__label" id="cs-profile-h">Settings</h1>
          </header>
          <div class="pf-card__body">
            <div class="who">
              <span class="who__pic" aria-hidden="true">{{ initial() }}</span>
              <div class="who__text">
                <p class="who__name" data-testid="profile-name">{{ name() }}</p>
                @if (email()) { <p class="who__meta">{{ email() }}</p> }
                <p class="who__role" data-testid="profile-space">{{ space() }}</p>
              </div>
            </div>

            <div class="row">
              <div class="row__text">
                <h2 class="row__title">Appearance</h2>
                <p class="row__hint">Light, dark, or follow this device.</p>
              </div>
              <pf-segmented [options]="themes" [value]="theme.mode()" (valueChange)="theme.setMode($event)"
                            ariaLabel="Appearance" />
            </div>

            @if (personal()) {
              <pf-cs-practice-card />
            }
          </div>
        </section>
        <aside class="pf-card side" aria-labelledby="cs-account-h">
          <header class="pf-card__head">
            <span class="pf-card__icon"><pf-icon name="lock" [size]="16" /></span>
            <h2 class="pf-card__label" id="cs-account-h">Account</h2>
          </header>
          <div class="pf-card__body">
            <p class="note">You sign in to case sheets with your Google account. Signing out here signs out this device only.</p>
          </div>
          <footer class="pf-card__foot">
            <button type="button" class="pf-btn pf-btn--secondary pf-span" data-testid="sign-out"
                    [disabled]="signingOut()" [attr.aria-busy]="signingOut() ? 'true' : null" (click)="signOut()">
              <pf-icon name="sign-out" [size]="18" />
              {{ signingOut() ? 'Signing out…' : 'Sign out' }}
            </button>
          </footer>
        </aside>
      </div>
    </div>
  `,
  styles: [`
    .ctx { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
    .ctx__k { font-size: 12px; color: var(--text-tertiary); }
    .ctx__v { font-size: 15px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .who { display: flex; align-items: center; gap: 16px; padding: 8px 2px 18px; border-bottom: 1px solid var(--border-muted); }
    .who__pic {
      width: 64px; height: 64px; border-radius: 999px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 26px; font-weight: 600; color: var(--violet-text, #7c3aed);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, var(--pf-card-bg));
      border: 1px solid var(--border-muted);
    }
    .who__text { min-width: 0; }
    .who__name { margin: 0; font-size: 19px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .who__meta { margin: 2px 0 0; font-size: 14px; color: var(--text-tertiary); overflow-wrap: anywhere; }
    .who__role {
      display: inline-flex; margin: 8px 0 0; padding: 4px 10px; border-radius: var(--pf-radius-chip, 999px);
      background: var(--pf-chip-bg); font-size: 12.5px; font-weight: 500; color: var(--text-secondary);
    }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 16px 2px; }
    .row__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .row__hint { margin: 2px 0 0; font-size: 13px; color: var(--text-tertiary); }
    .note { margin: 0; font-size: 14px; line-height: 1.5; color: var(--text-secondary); }
  `],
})
export class CsSettingsPage {
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly session = inject(SessionService);
  protected readonly theme = inject(ThemeService);

  protected readonly personal = computed(() => this.auth.user()?.tenantKind === 'personal');
  protected readonly name = computed(() => this.auth.user()?.displayName || this.email() || '');
  /** Synthetic staff auth addresses (`…tenant.prefrontal`) are not shown. */
  protected readonly email = computed(() => {
    const e = this.auth.user()?.email ?? '';
    return /\.tenant\.prefrontal$/i.test(e) ? '' : e;
  });
  protected readonly space = computed(() =>
    this.personal() ? 'Your own case sheets' : `Case sheets at ${this.auth.user()?.tenantName ?? 'your lab'}`);
  protected readonly initial = computed(() => (this.name().trim().charAt(0) || '?').toUpperCase());
  protected readonly signingOut = signal(false);

  protected readonly themes: SegmentedOption<ThemeMode>[] = [
    { value: 'system', label: 'Same as device' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  protected async signOut(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Sign out of case sheets?',
      message: 'You can sign back in with Google any time.',
      confirmLabel: 'Sign out',
      cancelLabel: 'Stay signed in',
    });
    if (!ok) return;
    this.signingOut.set(true);
    try {
      // The ONE sign-out sequence (revoke this device's session, clear, back to sign-in).
      await this.session.logout();
    } finally {
      this.signingOut.set(false);
    }
  }
}
