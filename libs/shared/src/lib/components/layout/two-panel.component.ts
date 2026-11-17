import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  Signal,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';

/** One row in the left list. */
export interface TwoPanelItem {
  id: string;
  label: string;
  /** Small muted note at the row's right edge (a count, "Soon"). */
  note?: string;
  /** Right-panel heading text under the title. */
  description?: string;
}

/** A headed group of rows ("Departments", "Organization"…). */
export interface TwoPanelGroup {
  key: string;
  heading: string;
  items: TwoPanelItem[];
}

/** Width at or below which the two panels become a list → detail drill-in. */
export const TWO_PANEL_COMPACT_QUERY = '(max-width: 767px)';

/**
 * True while the viewport is phone-width. Tracks the media query live and
 * falls back to `false` where matchMedia is missing (SSR, old engines).
 */
export function injectTwoPanelCompact(query: string = TWO_PANEL_COMPACT_QUERY): Signal<boolean> {
  const doc = inject(DOCUMENT);
  const destroyRef = inject(DestroyRef);
  const win = doc.defaultView;
  const read = (): MediaQueryList | null => {
    try { return win?.matchMedia?.(query) ?? null; } catch { return null; }
  };
  const mql = read();
  const state = signal(!!mql?.matches);
  if (mql?.addEventListener) {
    const on = (e: MediaQueryListEvent) => state.set(e.matches);
    mql.addEventListener('change', on);
    destroyRef.onDestroy(() => mql.removeEventListener?.('change', on));
  }
  return state.asReadonly();
}

/**
 * The shared two-panel settings layout (owner 2026-11-15): LEFT a grouped
 * list of sections, RIGHT the selected section's content (projected).
 *
 * Settings-style hubs in the LMS and the admin console use THIS component;
 * work screens keep band + work card + side card. It is purely presentational:
 * the parent owns the selected id (and keeps it in the URL), decides when the
 * phone is showing the detail, and renders the section's tiles into the
 * default slot.
 *
 * Phone (`compact`): the list fills the screen; picking a row shows only the
 * detail with a back chevron (`back` output) — the parent wires that to the
 * history / swipe-back. Motion is a ~260 ms slide + fade, off under
 * prefers-reduced-motion.
 */
@Component({
  selector: 'pf-two-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pf-tp',
    '[class.pf-tp--compact]': 'compact()',
    '[class.pf-tp--detail]': 'compact() && detailOpen()',
    '[class.pf-tp--rail]': '!compact() && rail()',
    '[class.pf-tp--flush]': 'flush()',
    '[class.pf-tp--sticky]': 'stickyNav() && !compact()',
  },
  template: `
    <nav class="pf-tp__nav pf-card" [attr.aria-label]="navLabel()" data-testid="tp-nav">
      @if (navHead(); as head) {
        <!-- Inside a setting: the left panel carries that setting's categories under a back arrow. -->
        <div class="pf-tp__navhead">
          <button type="button" class="pf-tp__navback" [attr.aria-label]="navBackLabel()" data-testid="tp-nav-back"
                  (click)="navBack.emit()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <span class="pf-tp__navtitle" data-testid="tp-nav-title">{{ head }}</span>
          @if (collapsible() && !compact()) {
            <button type="button" class="pf-tp__railbtn" data-testid="tp-rail-toggle"
                    [attr.aria-label]="rail() ? 'Show the category names' : 'Shrink to a thin rail'"
                    [attr.aria-pressed]="rail()" (click)="railChange.emit(!rail())">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path [attr.d]="rail() ? 'm13 6 6 6-6 6M5 6l6 6-6 6' : 'm11 18-6-6 6-6M19 18l-6-6 6-6'"/>
              </svg>
            </button>
          }
        </div>
      }
      <div class="pf-tp__scroll" [class.pf-tp__scroll--a]="navPhase() === 0" [class.pf-tp__scroll--b]="navPhase() === 1"
           [class.pf-tp__scroll--back]="navDir() === 'back'">
        @for (g of groups(); track g.key) {
          @if (!navHead()) {
            <span class="pf-tp__heading" [attr.data-testid]="'tp-group-' + g.key">{{ g.heading }}</span>
          }
          @for (it of g.items; track it.id) {
            <button type="button" class="pf-tp__item" [class.is-on]="it.id === selected()"
                    [attr.aria-current]="it.id === selected() ? 'true' : null"
                    [attr.data-testid]="'tp-item-' + it.id"
                    [attr.title]="rail() && !compact() ? it.label : null"
                    (click)="pick.emit(it.id)">
              <span class="pf-tp__dot" aria-hidden="true"></span>
              <span class="pf-tp__mono" aria-hidden="true">{{ it.label.charAt(0) }}</span>
              <span class="pf-tp__label">{{ it.label }}</span>
              @if (it.note) { <span class="pf-tp__note">{{ it.note }}</span> }
              <svg class="pf-tp__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
            </button>
          }
        }
      </div>
    </nav>

    <section class="pf-tp__panel pf-card" [attr.aria-label]="current()?.label ?? null" data-testid="tp-panel"
             [class.pf-tp__panel--a]="phase() === 0" [class.pf-tp__panel--b]="phase() === 1">
      @if (current(); as cur) {
        <header class="pf-tp__head">
          @if (compact()) {
            <button type="button" class="pf-tp__back" aria-label="Back to sections" data-testid="tp-back" (click)="back.emit()">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          }
          <div class="pf-tp__titles">
            @if (currentGroup(); as grp) { <span class="pf-tp__eyebrow">{{ grp.heading }}</span> }
            <h2 class="pf-tp__title">{{ cur.label }}</h2>
            @if (cur.description) { <span class="pf-tp__desc">{{ cur.description }}</span> }
          </div>
        </header>
        <div class="pf-tp__body"><ng-content></ng-content></div>
      }
    </section>
  `,
  styles: [`
    :host { display: flex; gap: 20px; flex: 1; min-height: 0; min-width: 0; }
    .pf-tp__nav { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden; padding: 0; }
    .pf-tp__scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 2px; }
    .pf-tp__heading { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); padding: 12px 12px 6px; }
    .pf-tp__item {
      display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 12px; border: 0; border-radius: 10px;
      background: transparent; color: var(--text-primary); font: inherit; font-size: 14px; text-align: left; cursor: pointer;
      transition: background-color 120ms ease;
    }
    .pf-tp__item:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    @media (hover: hover) { .pf-tp__item:not(.is-on):hover { background: var(--glass-bg, rgba(124,58,237,.06)); } }
    .pf-tp__item.is-on { background: rgba(124,58,237,.13); color: var(--text-primary); font-weight: 600; }
    .pf-tp__dot { width: 8px; height: 8px; border-radius: 50%; background: transparent; flex-shrink: 0; }
    .pf-tp__item.is-on .pf-tp__dot { background: var(--color-violet-600, #7c3aed); }
    .pf-tp__label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .pf-tp__note { font-size: 12px; color: var(--text-muted); font-weight: 400; }
    .pf-tp__chev { display: none; color: var(--text-muted); flex-shrink: 0; }

    /* Inside a setting: back arrow + the setting's name above its categories. */
    .pf-tp__navhead { display: flex; align-items: center; gap: 4px; padding: 10px 10px 4px; flex-shrink: 0; }
    .pf-tp__navback, .pf-tp__railbtn {
      width: 36px; height: 36px; display: inline-grid; place-items: center; flex-shrink: 0; border: 0; border-radius: 10px;
      background: transparent; color: var(--text-primary); cursor: pointer;
    }
    .pf-tp__navback:focus-visible, .pf-tp__railbtn:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    @media (hover: hover) { .pf-tp__navback:hover, .pf-tp__railbtn:hover { background: var(--glass-bg, rgba(124,58,237,.06)); } }
    .pf-tp__navtitle { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-tp__railbtn { color: var(--text-muted); }
    .pf-tp__mono { display: none; }
    /* Thin rail: a slim strip with one round initial per category. */
    :host(.pf-tp--rail) .pf-tp__nav { width: 64px; }
    :host(.pf-tp--rail) .pf-tp__navtitle, :host(.pf-tp--rail) .pf-tp__label, :host(.pf-tp--rail) .pf-tp__note, :host(.pf-tp--rail) .pf-tp__dot { display: none; }
    :host(.pf-tp--rail) .pf-tp__navhead { flex-direction: column; padding: 8px 0 4px; }
    :host(.pf-tp--rail) .pf-tp__scroll { padding: 6px 0; align-items: center; }
    :host(.pf-tp--rail) .pf-tp__item { width: 40px; min-height: 40px; padding: 0; justify-content: center; border-radius: 50%; }
    :host(.pf-tp--rail) .pf-tp__mono { display: inline; font-weight: 600; }
    :host(.pf-tp--flush) .pf-tp__body { padding: 0; }
    /* The page grows with its content (document scroll); the left panel stays in view. */
    :host(.pf-tp--sticky) { align-items: flex-start; }
    :host(.pf-tp--sticky) .pf-tp__nav { position: sticky; top: 12px; max-height: calc(100dvh - var(--top-strip-h, 64px) - 32px); }
    :host(.pf-tp--sticky) .pf-tp__panel { overflow: visible; min-height: 320px; }
    :host(.pf-tp--flush) .pf-tp__head { padding-bottom: 14px; }
    @keyframes pf-tp-nav-a { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
    @keyframes pf-tp-nav-b { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
    @keyframes pf-tp-nav-ra { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
    @keyframes pf-tp-nav-rb { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
    .pf-tp__scroll--a { animation: pf-tp-nav-a 260ms cubic-bezier(.2,.7,.2,1) both; }
    .pf-tp__scroll--b { animation: pf-tp-nav-b 260ms cubic-bezier(.2,.7,.2,1) both; }
    .pf-tp__scroll--back.pf-tp__scroll--a { animation-name: pf-tp-nav-ra; }
    .pf-tp__scroll--back.pf-tp__scroll--b { animation-name: pf-tp-nav-rb; }
    @media (prefers-reduced-motion: reduce) { .pf-tp__scroll--a, .pf-tp__scroll--b { animation: none !important; } }

    .pf-tp__panel { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; padding: 0; }
    .pf-tp__head { display: flex; align-items: flex-start; gap: 8px; padding: 22px 26px 16px; border-bottom: 1px solid var(--pf-line, var(--glass-border)); }
    .pf-tp__titles { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pf-tp__eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); }
    .pf-tp__title { margin: 0; font-size: 24px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-tp__desc { font-size: 14px; color: var(--text-secondary, var(--text-muted)); }
    .pf-tp__body { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 26px; }
    .pf-tp__back {
      width: 40px; height: 40px; margin: -4px 0 0 -12px; display: inline-grid; place-items: center; flex-shrink: 0;
      border: 0; border-radius: 11px; background: transparent; color: var(--text-primary); cursor: pointer;
    }
    .pf-tp__back:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }

    /* Section switch: slide + fade, ~260 ms. Two identical keyframes alternate so
       the animation restarts on every pick. */
    @keyframes pf-tp-in-a { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
    @keyframes pf-tp-in-b { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
    .pf-tp__panel--a .pf-tp__body, .pf-tp__panel--a .pf-tp__head { animation: pf-tp-in-a 260ms cubic-bezier(.2,.7,.2,1) both; }
    .pf-tp__panel--b .pf-tp__body, .pf-tp__panel--b .pf-tp__head { animation: pf-tp-in-b 260ms cubic-bezier(.2,.7,.2,1) both; }
    @media (prefers-reduced-motion: reduce) {
      .pf-tp__panel--a .pf-tp__body, .pf-tp__panel--a .pf-tp__head,
      .pf-tp__panel--b .pf-tp__body, .pf-tp__panel--b .pf-tp__head { animation: none; }
      .pf-tp__item { transition: none; }
    }

    /* Phone: list first; picking a row drills into that section only. */
    :host(.pf-tp--compact) { display: block; }
    :host(.pf-tp--compact) .pf-tp__nav { width: auto; height: 100%; }
    :host(.pf-tp--compact) .pf-tp__item { min-height: 48px; }
    :host(.pf-tp--compact) .pf-tp__chev { display: block; }
    :host(.pf-tp--compact) .pf-tp__panel { height: 100%; }
    :host(.pf-tp--compact) .pf-tp__head { padding: 14px 16px 12px; }
    :host(.pf-tp--compact) .pf-tp__title { font-size: 20px; }
    :host(.pf-tp--compact) .pf-tp__body { padding: 14px 16px; }
    :host(.pf-tp--compact:not(.pf-tp--detail)) .pf-tp__panel { display: none; }
    :host(.pf-tp--compact.pf-tp--detail) .pf-tp__nav { display: none; }
  `],
})
export class TwoPanelComponent {
  readonly groups = input.required<TwoPanelGroup[]>();
  readonly selected = input<string | null>(null);
  /** Phone width: list → detail drill-in instead of side by side. */
  readonly compact = input(false);
  /** Compact only: true shows the detail (with its back chevron), false the list. */
  readonly detailOpen = input(false);
  readonly navLabel = input('Sections');
  /** Inside a setting: the setting's name. Set ⇒ a back arrow row heads the left panel and group headings go. */
  readonly navHead = input<string | null>(null);
  readonly navBackLabel = input('Back to sections');
  /** Changes whenever the left panel's content is swapped (sections → categories): replays the slide. */
  readonly navKey = input<string | null>(null);
  /** Slide direction of that swap: `in` = drilling into a setting, `back` = returning. */
  readonly navDir = input<'in' | 'back'>('in');
  /** Slide the left panel in once on first render (a freshly opened setting). */
  readonly animateNav = input(false);
  /** Offer the thin-rail toggle (wide only) and its state. */
  readonly collapsible = input(false);
  readonly rail = input(false);
  /** Right body without its own padding (the hosted page keeps its own). */
  readonly flush = input(false);
  /** Wide: the left panel sticks while the right one scrolls with the page. */
  readonly stickyNav = input(false);

  readonly navBack = output<void>();
  readonly railChange = output<boolean>();

  readonly pick = output<string>();
  readonly back = output<void>();

  readonly current = computed<TwoPanelItem | null>(() => {
    const id = this.selected();
    for (const g of this.groups()) {
      const hit = g.items.find((i) => i.id === id);
      if (hit) return hit;
    }
    return null;
  });
  readonly currentGroup = computed<TwoPanelGroup | null>(() => {
    const id = this.selected();
    return this.groups().find((g) => g.items.some((i) => i.id === id)) ?? null;
  });

  /** Alternates 0/1 on every selection so the slide/fade restarts. */
  readonly phase = signal<0 | 1>(0);
  readonly navPhase = signal<0 | 1 | null>(null);
  private lastNav: string | null | undefined = undefined;
  private last: string | null = null;
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  constructor() {
    effect(() => {
      const key = this.navKey();
      if (key === this.lastNav) return;
      const first = this.lastNav === undefined;
      this.lastNav = key;
      if (!this.browser) return;
      if (first && !this.animateNav()) return;
      this.navPhase.update((p) => (p === 0 ? 1 : 0));
    });
    effect(() => {
      const id = this.selected();
      if (id === this.last) return;
      if (this.last !== null && this.browser) this.phase.update((p) => (p === 0 ? 1 : 0));
      this.last = id;
    });
  }
}
