import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterEveryRender,
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
import { fillHeadTitles } from '../../utils/head-titles.js';

/** One row in the left list. */
export interface TwoPanelItem {
  id: string;
  label: string;
  /** Small muted note at the row's right edge (a count, "Soon"). */
  note?: string;
  /** Main-card head note beside the label (when the parent passes no `panelNote`). */
  description?: string;
  /** Main-card head icon (stroked path, 24-unit box) for this row; falls back to `panelIcon`. */
  icon?: string;
  /** A second, muted line under the label (a saved draft's sheet + date). */
  sub?: string;
  /** The row opens its own full-screen page (an arrow marks it). */
  external?: boolean;
  /** A tree heading (e.g. "Lab spaces"): a chevron toggles the rows naming it as `parent`, shown indented under it. */
  heading?: boolean;
  /** The heading row this row sits under. */
  parent?: string;
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
 * The shared two-panel settings layout, in TEST MASTER's frame (owner 2026-11-17, DESIGN-V2): LEFT a side card
 * (`aside.pf-card`, head = icon + label, body = the grouped rows in Test Master's department-row style), RIGHT the
 * main card (`section.pf-card`, head = the selected row's icon + label + note, body = the projected content, which
 * scrolls INSIDE the card). The host fills its parent (a `pf-band-body--fill`), so the page itself never scrolls.
 *
 * Purely presentational: the parent owns the selected id (and keeps it in the URL), decides when the phone shows the
 * detail, and projects the content. Phone (`compact`): the side card fills the screen; picking a row shows only the
 * main card. There is NO back button in either card (owner 2026-11-17: "only the top back"): the band's back chevron
 * climbs (the parent registers a NavBackService interceptor: group → list → section). Inside a setting (`navHead`) the
 * side card head shows that setting and the rows slide in (~260 ms, off under prefers-reduced-motion).
 */
@Component({
  selector: 'pf-two-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pf-tp',
    '[class.pf-tp--compact]': 'compact()',
    '[class.pf-tp--detail]': 'compact() && detailOpen()',
    '[class.pf-tp--nonav]': 'hideNav()',
  },
  template: `
    <aside class="pf-card pf-tp__nav" [attr.aria-label]="navLabel()" data-testid="tp-nav">
      <header class="pf-card__head pf-tp__navhead">
        @if (navIcon()) {
          <span class="pf-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="navIcon()"/></svg>
          </span>
        }
        <span class="pf-card__label pf-tp__navtitle" data-testid="tp-nav-title">{{ navHead() ?? navTitle() }}</span>
        <span class="pf-tp__navtools"><ng-content select="[nav-tools]"></ng-content></span>
      </header>
      <div class="pf-card__body pf-tp__scroll" [class.pf-tp__scroll--a]="navPhase() === 0" [class.pf-tp__scroll--b]="navPhase() === 1"
           [class.pf-tp__scroll--back]="navDir() === 'back'">
        @for (g of groups(); track g.key) {
          @if (!navHead() && g.heading) {
            <span class="pf-tp__heading" [attr.data-testid]="'tp-group-' + g.key">{{ g.heading }}</span>
          }
          @for (it of g.items; track it.id) {
            @if (it.heading) {
              <button type="button" class="pf-tp__item pf-tp__item--head" [attr.aria-expanded]="isOpen(it.id)"
                      [attr.data-testid]="'tp-item-' + it.id" (click)="toggle(it.id)">
                <svg class="pf-tp__tree" [class.is-open]="isOpen(it.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
                <span class="pf-tp__label">{{ it.label }}</span>
                @if (it.note) { <span class="pf-tp__note pf-num">{{ it.note }}</span> }
              </button>
            } @else if (!it.parent || isOpen(it.parent)) {
            <button type="button" class="pf-tp__item" [class.pf-tp__item--child]="!!it.parent" [class.is-on]="it.id === selected()"
                    [attr.aria-current]="it.id === selected() ? 'true' : null"
                    [attr.aria-pressed]="it.id === selected()"
                    [attr.data-testid]="'tp-item-' + it.id"
                    (click)="pick.emit(it.id)">
              <span class="pf-tp__label">{{ it.label }}@if (it.sub) { <span class="pf-tp__sub">{{ it.sub }}</span> }</span>
              @if (it.note) { <span class="pf-tp__note pf-num">{{ it.note }}</span> }
              @if (it.external) {
                <svg class="pf-tp__ext" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Opens its own page"><path d="M7 17 17 7M8 7h9v9"/></svg>
              }
              <svg class="pf-tp__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
            </button>
            }
          }
        }
      </div>
    </aside>

    <section class="pf-tp__panel" [class.pf-card]="!bareMain()" [class.pf-tp__panel--bare]="bareMain()" [attr.aria-label]="current()?.label ?? null" data-testid="tp-panel"
             [class.pf-tp__panel--a]="phase() === 0" [class.pf-tp__panel--b]="phase() === 1">
      @if (current(); as cur) {
        <header class="pf-card__head pf-tp__head" [hidden]="bareMain()">
          @if (cur.icon ?? panelIcon(); as ic) {
            <span class="pf-card__icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="ic"/></svg>
            </span>
          }
          <h2 class="pf-card__label pf-tp__title">{{ cur.label }}</h2>
          @if (panelNote() ?? cur.description; as note) { <span class="pf-card__note pf-tp__desc">{{ note }}</span> }
          <span class="pf-tp__tools"><ng-content select="[panel-tools]"></ng-content></span>
        </header>
        <div class="pf-tp__body" [class.pf-tp__body--flush]="flush()"><ng-content></ng-content></div>
      }
    </section>
  `,
  styles: [`
    :host { display: grid; grid-template-columns: var(--pf-side-w, 340px) minmax(0, 1fr); gap: 16px; flex: 1 1 auto; min-height: 0; min-width: 0; align-items: stretch; }
    .pf-tp__nav, .pf-tp__panel { min-height: 0; min-width: 0; }
    .pf-tp__navhead { flex-wrap: nowrap; }
    .pf-tp__head { flex-wrap: wrap; row-gap: 8px; }
    .pf-tp__navtitle, .pf-tp__title { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .pf-tp__title { flex: none; max-width: 60%; }
    .pf-tp__desc { flex: 1 1 120px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-tp__tools { margin-left: auto; display: inline-flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; flex: 0 1 auto; max-width: 100%; }
    .pf-tp__tools:empty { display: none; }
    .pf-tp__navtools { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; flex: none; }
    .pf-tp__navtools:empty { display: none; }
    .pf-tp__sub { display: block; font-size: 12px; font-weight: 400; color: var(--text-tertiary); overflow-wrap: anywhere; }
    .pf-tp__iconbtn {
      width: 32px; height: 32px; display: inline-grid; place-items: center; flex: none; margin: -2px 0 -2px -4px;
      border: 1px solid var(--pf-line, var(--glass-border)); border-radius: 9px; background: var(--pf-card-bg, transparent);
      color: var(--text-secondary); cursor: pointer; transition: border-color 160ms ease, color 160ms ease;
    }
    .pf-tp__iconbtn:hover { border-color: var(--pf-sel-border); color: var(--text-primary); }
    .pf-tp__iconbtn:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }

    /* Rows: Test Master's department rows (44px, 13.5px, neutral selected state). */
    .pf-tp__scroll { padding: 8px; gap: 2px; }
    .pf-tp__heading { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); padding: 10px 10px 4px; }
    .pf-tp__heading:first-child { padding-top: 4px; }
    .pf-tp__item {
      flex: none; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 10px; border: 0; border-radius: 10px;
      background: transparent; color: var(--text-primary); font: inherit; font-size: 13.5px; font-weight: 500; text-align: left; cursor: pointer;
      transition: background var(--pf-dur-fast, 200ms) ease, box-shadow var(--pf-dur-fast, 200ms) ease;
    }
    .pf-tp__item:hover { background: var(--pf-chip-bg); }
    .pf-tp__item:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
    .pf-tp__item.is-on { background: var(--pf-sel-bg); box-shadow: inset 0 0 0 1px var(--pf-sel-border); }
    .pf-tp__label { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .pf-tp__note { flex: none; font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); }
    .pf-tp__ext { flex: none; color: var(--text-tertiary); }
    .pf-tp__item--head { gap: 6px; color: var(--text-secondary); }
    .pf-tp__tree { flex: none; transition: transform 160ms ease; }
    .pf-tp__tree.is-open { transform: rotate(90deg); }
    .pf-tp__item--child { padding-left: 30px; }
    .pf-tp__chev { display: none; flex: none; color: var(--text-tertiary); }

    @keyframes pf-tp-nav-a { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
    @keyframes pf-tp-nav-b { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
    @keyframes pf-tp-nav-ra { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
    @keyframes pf-tp-nav-rb { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
    .pf-tp__scroll--a { animation: pf-tp-nav-a 260ms cubic-bezier(.2,.7,.2,1) both; }
    .pf-tp__scroll--b { animation: pf-tp-nav-b 260ms cubic-bezier(.2,.7,.2,1) both; }
    .pf-tp__scroll--back.pf-tp__scroll--a { animation-name: pf-tp-nav-ra; }
    .pf-tp__scroll--back.pf-tp__scroll--b { animation-name: pf-tp-nav-rb; }

    /* Main card body: the ONE scroll container. */
    .pf-tp__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 14px; overscroll-behavior: contain; }
    .pf-tp__body--flush { padding: 0; }
    /* The hosted page brings its OWN card (never card-in-card): the panel is a bare column, the page's card is the main card. */
    .pf-tp__panel--bare { display: flex; flex-direction: column; background: none; border: 0; box-shadow: none; }
    .pf-tp__panel--bare .pf-tp__body { padding: 0; }

    @keyframes pf-tp-in-a { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
    @keyframes pf-tp-in-b { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
    .pf-tp__panel--a .pf-tp__body { animation: pf-tp-in-a 260ms cubic-bezier(.2,.7,.2,1) both; }
    .pf-tp__panel--b .pf-tp__body { animation: pf-tp-in-b 260ms cubic-bezier(.2,.7,.2,1) both; }
    @media (prefers-reduced-motion: reduce) {
      .pf-tp__scroll--a, .pf-tp__scroll--b, .pf-tp__panel--a .pf-tp__body, .pf-tp__panel--b .pf-tp__body { animation: none !important; }
      .pf-tp__item { transition: none; }
    }

    :host(.pf-tp--nonav) { display: flex; flex-direction: column; }
    :host(.pf-tp--nonav) .pf-tp__nav { display: none !important; }
    :host(.pf-tp--nonav) .pf-tp__panel { display: flex !important; flex: 1 1 auto; }
    /* Tablet portrait: a narrower side card. */
    /* ONE side-card width everywhere (--pf-side-w, owner 2026-11-17) — no narrower step of its own. */

    /* Phone: side card first; picking a row shows only the main card (back chevron in its head). */
    :host(.pf-tp--compact) { display: flex; flex-direction: column; }
    :host(.pf-tp--compact) .pf-tp__nav, :host(.pf-tp--compact) .pf-tp__panel { flex: 1 1 auto; }
    :host(.pf-tp--compact) .pf-tp__item { min-height: 48px; }
    :host(.pf-tp--compact) .pf-tp__chev { display: block; }
    :host(.pf-tp--compact) .pf-tp__desc { display: none; }
    :host(.pf-tp--compact) .pf-tp__title { max-width: none; flex: 1 1 auto; }
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
  /** Side-card head: icon (stroked path) and label when not inside a setting. */
  readonly navIcon = input<string | null>(null);
  readonly navTitle = input('Settings');
  /** Main-card head icon when the selected row has none, and its note (defaults to the row's description). */
  readonly panelIcon = input<string | null>(null);
  readonly panelNote = input<string | null>(null);
  /** Phone back chevron's label. */
  readonly backLabel = input('Back to sections');
  /** Main-card body without its own padding (the content brings its own rows). */
  readonly flush = input(false);
  /** The content brings its own card: no main-card chrome or head around it. */
  readonly bareMain = input(false);
  /** No side card (the host lists the categories elsewhere, e.g. as a pill in its own card head). */
  readonly hideNav = input(false);

  readonly navBack = output<void>();
  /** Tree headings the person collapsed (all open by default; a heading holding the selected row stays open). */
  private readonly closed = signal<ReadonlySet<string>>(new Set());
  isOpen(id: string): boolean {
    if (!this.closed().has(id)) return true;
    const sel = this.selected();
    return this.groups().some((g) => g.items.some((i) => i.id === sel && i.parent === id));
  }
  toggle(id: string): void {
    const next = new Set(this.closed());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.closed.set(next);
  }

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
  private readonly el = inject(ElementRef<HTMLElement>);
  constructor() {
    // Narrow heads turn text actions into icons (styles.scss `@container pf-head`): each keeps a tooltip.
    afterEveryRender(() => { fillHeadTitles((this.el.nativeElement as HTMLElement).querySelector('.pf-tp__tools')); });
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
