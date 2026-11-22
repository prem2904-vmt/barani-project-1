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
  /**
   * The hosted page's actions (each hosted band's `[band-actions]`, in order). Owner 2026-11-17: in Settings no button sits
   * in the band's corner — the frame shows them IN the pane they act on (the main card's head), only for the group they
   * belong to (`group` = the nearest `pf-setting-group [id]` around the band; null = the whole page).
   */
  readonly actions: WritableSignal<readonly SettingsHostAction[]>;
  /** The hosted page's band search fields (icon + input / custom search), each with its group: the band pill shows the
   *  selected group's search (else the page's ungrouped one). */
  readonly searches: WritableSignal<readonly SettingsHostAction[]>;
  /** A hosted page's save state ("Saves automatically" / "Saving…"), shown small and muted in the shell's band. */
  readonly status: WritableSignal<TemplateRef<unknown> | null>;
  /**
   * A page whose sections are only known at run time (alerts by module …) lists them here: the shell's side card shows
   * them (`?tab=<id>`, the note muted on the right) and the main card shows the matching `pf-setting-group [id]`.
   */
  readonly categories: WritableSignal<readonly SettingsHostCategory[] | null>;
  /**
   * The `pf-setting-group [id]` the frame's main card currently shows ALONE (its head already names it), or null.
   * That group hands its `[group-tools]` (pills, Add, Paste, Reset…) to the card head instead of drawing a second
   * tools row under it (owner 2026-11-21: no extra toolbar row under the head). Optional: a test host may omit it.
   */
  readonly headGroup?: WritableSignal<string | null>;
}
export interface SettingsHostAction { readonly tpl: TemplateRef<unknown>; readonly group: string | null }
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
/** The search for the shown group: that group's, else the page's ungrouped one (`sel` null = any, the first). */
export function pickHostSearch(list: readonly SettingsHostAction[], sel: string | null): TemplateRef<unknown> | null {
  if (!list.length) return null;
  if (sel) return (list.find((s) => s.group === sel) ?? list.find((s) => !s.group))?.tpl ?? null;
  return (list.find((s) => !s.group) ?? list[0]).tpl;
}

export function createSettingsHost(): SettingsHost {
  return { hosted: true, actions: signal([]), searches: signal([]), status: signal(null), categories: signal(null), headGroup: signal(null) };
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
