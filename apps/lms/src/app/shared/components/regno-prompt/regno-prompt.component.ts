import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

/** The permission whose holders SIGN reports ("Validated by" — the
 *  pathologist / consultant / doctor). Their registration number prints under
 *  that signature. */
export const SIGNING_PERMISSION = 'validate_result';

/** The one prompt line (owner 2026-09-29). */
export const REGNO_PROMPT_TEXT = 'Add your registration number — it prints under your signature.';

/** True when a signing user has no registration number yet. Pure, so the
 *  screens and the specs share one rule. */
export function needsRegistrationNumber(
  user: { permissions?: string[] | null; registrationId?: string | null } | null | undefined,
): boolean {
  if (!user) return false;
  const perms = user.permissions ?? [];
  const signs = perms.includes('*') || perms.includes(SIGNING_PERMISSION);
  return signs && !(user.registrationId ?? '').trim();
}

/**
 * Gentle prompt for a signing user whose registration number is missing
 * ("If the admin has missed the doctor registration number, the doctor can
 * feed it"). Links to My signature → Registration ID, where they add it
 * themselves (PUT /api/auth/me/registration-id). Renders nothing once the
 * number is set — the auth profile updates in place on save.
 *
 * Shown on the pathologist queue's side card and on the tube review
 * (validate) screen. Neutral notice: slate surface, violet mark, SVG icon.
 */
@Component({
  selector: 'pf-regno-prompt',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
      <div class="pf-regno" role="status">
        <span class="pf-regno__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M7 16h10"/></svg>
        </span>
        <span class="pf-regno__t">{{ text }}</span>
        <a class="nd-rowact pf-regno__cta" routerLink="/signature" [queryParams]="{ tab: 'registration' }"
           aria-label="Add your registration number">Add</a>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .pf-regno {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 10px 12px; border-radius: var(--nd-radius-sm, 10px);
      border: 1px solid var(--nd-line, rgba(148, 163, 184, .35));
      background: var(--nd-chip-bg, rgba(148, 163, 184, .12));
      color: var(--text-secondary, #475569); font-size: 12.5px; font-weight: 500; line-height: 1.4;
    }
    .pf-regno__icon { display: inline-flex; flex: none; color: var(--color-primary, #7c3aed); }
    .pf-regno__t { flex: 1 1 12rem; min-width: 0; }
    .pf-regno__cta { text-decoration: none; }
  `],
})
export class RegnoPromptComponent {
  private readonly auth = inject(AuthService);
  readonly text = REGNO_PROMPT_TEXT;
  readonly show = computed(() => needsRegistrationNumber(this.auth.user()));
}
