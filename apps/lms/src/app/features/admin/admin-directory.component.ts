import {
  ChangeDetectionStrategy, Component, ElementRef, Injectable, Injector, afterNextRender, computed, effect, inject, input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ModuleKey, TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { AdminAccess, AdminCategory, AdminHit } from './admin-catalog';

/** The live user's view of the admin catalogue (route guards' own checks). */
@Injectable({ providedIn: 'root' })
export class AdminAccessService implements AdminAccess {
  private readonly auth = inject(AuthService);
  private readonly entitlements = inject(TenantEntitlementsService, { optional: true });
  hasAnyPermission(codes: string[]): boolean { return this.auth.hasAnyPermission(codes); }
  moduleEnabled(key: ModuleKey): boolean { return this.entitlements ? this.entitlements.moduleEnabled(key) : true; }
  ensureLoaded(): void { void this.entitlements?.ensureLoaded?.(); }
}

/**
 * The Admin directory (ND-PATTERN "Admin pages"): every category the user
 * may see as one card, every page inside it one tap away. Used by the Admin
 * home, the settings hub and the Lab hub, so all three read the same.
 * `focus` (a category id, e.g. from `?cat=`) scrolls that card into view and
 * briefly highlights it.
 */
@Component({
  selector: 'pf-admin-directory',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-adir" [class.pf-adir--one]="categories().length === 1">
      @for (c of categories(); track c.id) {
        <section class="pf-adir__cat nd-card" [id]="'cat-' + c.id" [attr.aria-labelledby]="'cat-h-' + c.id" tabindex="-1">
          @if (showHeads()) {
            <header class="nd-card__head">
              <span class="nd-card__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                     stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="c.icon"/></svg>
              </span>
              <h2 class="nd-card__label pf-adir__h" [id]="'cat-h-' + c.id">{{ c.label }}</h2>
            </header>
          } @else {
            <h2 class="pf-adir__sr" [id]="'cat-h-' + c.id">{{ c.label }}</h2>
          }
          <ul class="pf-adir__list" role="list">
            @for (p of c.pages; track p.id) {
              <li>
                <a class="pf-adir__row" [routerLink]="p.href" [queryParams]="p.queryParams ?? null">
                  <span class="pf-adir__ic" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="p.icon"/></svg>
                  </span>
                  <span class="pf-adir__txt">
                    <span class="pf-adir__t">{{ p.label }}</span>
                    <span class="pf-adir__s">{{ p.hint }}</span>
                  </span>
                  @if (p.soon) { <span class="nd-chip nd-chip--static pf-adir__soon">Soon</span> }
                  <svg class="pf-adir__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                </a>
              </li>
            }
          </ul>
        </section>
      }
      @if (!categories().length) {
        <p class="pf-band-empty">Nothing to set up here for your role.</p>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pf-adir { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-items: start; }
    .pf-adir--one { grid-template-columns: minmax(0, 720px); }
    .pf-adir__cat { overflow: visible; scroll-margin-top: 8px; }
    .pf-adir__cat:focus { outline: none; }
    .pf-adir__cat.is-hit { animation: pf-adir-hit 2.4s ease-out both; }
    @keyframes pf-adir-hit { 0%, 55% { box-shadow: 0 0 0 2px var(--color-violet-600, #7c3aed); } 100% { box-shadow: var(--nd-shadow-sm); } }
    .pf-adir__h { margin: 0; }
    .pf-adir__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .pf-adir__list { list-style: none; margin: 0; padding: 4px 6px 6px; }
    .pf-adir__row {
      display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 10px;
      border-radius: var(--nd-radius); color: inherit; text-decoration: none;
      transition: background var(--nd-dur-fast) ease;
    }
    .pf-adir__row:hover { background: var(--nd-chip-bg); }
    .pf-adir__row:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
    .pf-adir__ic {
      flex: none; display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 10px;
      background: var(--nd-chip-bg); color: var(--text-secondary);
    }
    .pf-adir__txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .pf-adir__t { font-size: 14px; font-weight: 500; color: var(--text-primary); line-height: 1.3; }
    .pf-adir__s { font-size: 12.5px; color: var(--text-tertiary); line-height: 1.35; }
    .pf-adir__soon { flex: none; height: 22px; font-size: 11px; }
    .pf-adir__chev { flex: none; color: var(--text-tertiary); }
    @media (prefers-reduced-motion: reduce) {
      .pf-adir__row { transition: none; }
      .pf-adir__cat.is-hit { animation: none; box-shadow: 0 0 0 2px var(--color-violet-600, #7c3aed); }
    }
    @media (pointer: coarse) { .pf-adir__row { min-height: 56px; } }
    @media (max-width: 640px) {
      .pf-adir { grid-template-columns: minmax(0, 1fr); gap: 12px; }
    }
  `],
})
export class AdminDirectoryComponent {
  readonly categories = input.required<AdminCategory[]>();
  /** Category to scroll to + highlight (the `?cat=` deep link). */
  readonly focus = input<string | null>(null);
  /** Hide the per-category card header (a hub that IS one category). */
  readonly showHeads = input(true);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  constructor() {
    effect(() => {
      const id = this.focus();
      const cats = this.categories();
      if (!id || !cats.some((c) => c.id === id)) return;
      afterNextRender(() => this.reveal(id), { injector: this.injector });
    });
  }

  private reveal(id: string): void {
    const el = this.host.nativeElement.querySelector<HTMLElement>(`#cat-${id}`);
    if (!el) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    el.focus?.({ preventScroll: true });
    el.classList.add('is-hit');
    setTimeout(() => el.classList.remove('is-hit'), 2600);
  }
}

/**
 * Admin search results: one row per hit (ND §6), pages and single settings.
 * A setting hit deep-links to its row (`#anchor`) on the page, which scrolls
 * to it and highlights it (SettingAnchorDirective).
 */
@Component({
  selector: 'pf-admin-search-results',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="pf-asr__count" role="status" aria-live="polite">
      {{ hits().length }} {{ hits().length === 1 ? 'result' : 'results' }} for “{{ query() }}”
    </p>
    @if (hits().length) {
      <ul class="pf-asr nd-card" role="list" aria-label="Search results">
        @for (h of shown(); track h.key) {
          <li>
            <a class="pf-adir__row pf-asr__row"
               [routerLink]="h.page.href" [queryParams]="h.page.queryParams ?? null"
               [fragment]="h.kind === 'setting' ? h.setting.id : undefined">
              <span class="pf-adir__ic" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="h.page.icon"/></svg>
              </span>
              <span class="pf-adir__txt">
                @if (h.kind === 'setting') {
                  <span class="pf-adir__t">{{ h.setting.label }}</span>
                  <span class="pf-adir__s">{{ h.page.label }} › {{ h.setting.section }}</span>
                } @else {
                  <span class="pf-adir__t">{{ h.page.label }}</span>
                  <span class="pf-adir__s">{{ h.cat.label }} · {{ h.page.hint }}</span>
                }
              </span>
              <svg class="pf-adir__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
            </a>
          </li>
        }
      </ul>
    } @else {
      <p class="pf-band-empty">Nothing matches “{{ query() }}”. Try a plain word like “bill” or “scan”.</p>
    }
  `,
  styles: [`
    :host { display: block; max-width: 760px; }
    .pf-asr__count { margin: 2px 0 10px; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-asr { list-style: none; margin: 0; padding: 6px; overflow: visible; }
    .pf-adir__row {
      display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 10px;
      border-radius: var(--nd-radius); color: inherit; text-decoration: none;
    }
    .pf-adir__row:hover { background: var(--nd-chip-bg); }
    .pf-adir__row:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
    .pf-adir__ic { flex: none; display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: var(--nd-chip-bg); color: var(--text-secondary); }
    .pf-adir__txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .pf-adir__t { font-size: 14px; font-weight: 500; color: var(--text-primary); line-height: 1.3; }
    .pf-adir__s { font-size: 12.5px; color: var(--text-tertiary); line-height: 1.35; }
    .pf-adir__chev { flex: none; color: var(--text-tertiary); }
    @media (pointer: coarse) { .pf-adir__row { min-height: 56px; } }
  `],
})
export class AdminSearchResultsComponent {
  readonly hits = input.required<AdminHit[]>();
  readonly query = input('');
  /** Cap so a one-letter query can't produce a wall of rows. */
  readonly shown = computed(() => this.hits().slice(0, 30));
}
