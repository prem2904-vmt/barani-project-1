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
  /** The hosted page's band actions (each hosted band's `[band-actions]`, in order), shown on the shell's band. */
  readonly actions: WritableSignal<readonly TemplateRef<unknown>[]>;
  /** The hosted page's band search field (icon + input / its custom search), shown in the shell's band pill. */
  readonly search: WritableSignal<TemplateRef<unknown> | null>;
  /** A hosted page's save state ("Saves automatically" / "Saving…"), shown small and muted in the shell's band. */
  readonly status: WritableSignal<TemplateRef<unknown> | null>;
  /**
   * A page whose sections are only known at run time (alerts by module …) lists them here: the shell's side card shows
   * them (`?tab=<id>`, the note muted on the right) and the main card shows the matching `pf-setting-group [id]`.
   */
  readonly categories: WritableSignal<readonly SettingsHostCategory[] | null>;
}
export interface SettingsHostCategory {
  readonly id: string;
  readonly label: string;
  readonly note?: string;
  /** A tree's parent row (e.g. "Lab spaces"): a heading that groups the rows naming it as `parent`. */
  readonly heading?: boolean;
  /** The heading this row sits under (rendered indented beneath it). */
  readonly parent?: string;
}
export const SETTINGS_HOST = new InjectionToken<SettingsHost>('pf.settings.host');

/** A fresh host (the shell provides one per instance). */
export function createSettingsHost(): SettingsHost {
  return { hosted: true, actions: signal([]), search: signal(null), status: signal(null), categories: signal(null) };
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
