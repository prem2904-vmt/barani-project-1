import { DestroyRef, InjectionToken, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

/**
 * Provided by the Settings shell (features/admin/settings/settings-shell.component.ts) for everything routed
 * inside it. A settings page injects it (optional) to know it is HOSTED: the shell's left panel already lists
 * the page's categories, so the page hides its own tab strip, back chevron and band brand and only keeps
 * its actions (Save …). Outside the shell the token is absent and nothing changes.
 */
export interface SettingsHost {
  readonly hosted: true;
}
export const SETTINGS_HOST = new InjectionToken<SettingsHost>('pf.settings.host');

/** True while the page is rendered inside the Settings shell. Call from an injection context. */
export function injectSettingsHosted(): boolean {
  return !!inject(SETTINGS_HOST, { optional: true });
}

/**
 * Keep a page's own tab signal in step with `?tab=` — the shell's categories (and every old deep link) drive the
 * page through the URL. An unknown / missing value leaves the page's own default alone. Call from an injection context.
 */
export function bindTabQuery<T extends string>(valid: readonly T[], set: (tab: T) => void): void {
  const route = inject(ActivatedRoute, { optional: true });
  inject(DestroyRef);
  route?.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
    const t = q.get('tab');
    if (t && (valid as readonly string[]).includes(t)) set(t as T);
  });
}
