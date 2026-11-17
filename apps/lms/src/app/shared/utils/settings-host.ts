import { DestroyRef, InjectionToken, TemplateRef, WritableSignal, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

/**
 * Provided by the Settings shell (features/admin/settings/settings-shell.component.ts) for the card-style settings
 * pages routed inside it (Test Master's frame, DESIGN-V2). The shell owns THE band: a hosted page's `pf-hero-band`
 * renders nothing in place and hands the shell its band actions (Save …) and — when the page has a search — its
 * search field, which the shell's band shows in its pill. The shell's side card lists the page's categories, so the
 * page drops its own tab strip. Outside the shell the token is absent and nothing changes.
 */
export interface SettingsHost {
  readonly hosted: true;
  /** The hosted page's band actions (its `[band-actions]` content), shown on the shell's band. */
  readonly actions: WritableSignal<TemplateRef<unknown> | null>;
  /** The hosted page's band search field (icon + input / its custom search), shown in the shell's band pill. */
  readonly search: WritableSignal<TemplateRef<unknown> | null>;
  /** A hosted page's save state ("Saves automatically" / "Saving…"), shown small and muted in the shell's band. */
  readonly status: WritableSignal<TemplateRef<unknown> | null>;
}
export const SETTINGS_HOST = new InjectionToken<SettingsHost>('pf.settings.host');

/** A fresh host (the shell provides one per instance). */
export function createSettingsHost(): SettingsHost {
  return { hosted: true, actions: signal(null), search: signal(null), status: signal(null) };
}

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
