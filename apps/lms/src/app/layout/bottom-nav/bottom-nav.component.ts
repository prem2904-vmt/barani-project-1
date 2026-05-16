import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy,
  computed, effect, inject, signal, viewChild, viewChildren
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { ADMIN_NAV, MORE_NAV, NavItem, PRIMARY_NAV } from '../nav-items';

const DRAG_THRESHOLD_PX = 4;

@Component({
  selector: 'pf-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Floating pill — mobile + tablet. Desktop uses the top strip.
         Scrolls horizontally on narrow viewports so all nav items stay reachable
         without overflowing off-screen. -->
    <nav class="pf-bottom-nav xl:hidden fixed left-1/2 -translate-x-1/2 z-30 safe-area-bottom"
         style="bottom: max(1rem, env(safe-area-inset-bottom)); max-width: calc(100vw - 16px);">
      <div #pill
           class="pf-pill flex items-center gap-0.5 sm:gap-1 p-1 sm:p-1.5 rounded-full shadow-2xl backdrop-blur-2xl overflow-x-auto"
           [class]="pillClasses"
           [class.pf-pill--dragging]="dragging()"
           (pointerdown)="onPillPointerDown($event)"
           (pointermove)="onPillPointerMove($event)"
           (pointerup)="onPillPointerUp($event)"
           (pointercancel)="onPillPointerUp($event)">
        <!-- Sliding gradient indicator. One element shared across all
             tabs — its position + width is driven by the active button's
             offsetLeft / offsetWidth so it glides between tabs. During a
             drag, position follows the pointer 1:1 (transitions off);
             on release it springs to the snapped target. -->
        <!-- Liquid-glass slider. At rest it's the gradient highlight
             pill behind the active tab. While dragging it transforms
             into a translucent glass pill that glides across the bar —
             icons stay put underneath; the slider's own backdrop blur
             + tinted edges give the iOS Liquid-Glass feel as it slides
             over them. -->
        <span class="pf-nav-indicator"
              [class.pf-nav-indicator--ready]="indicatorReady()"
              [class.pf-nav-indicator--dragging]="dragging()"
              [style.transform]="indicatorTransform()"
              [style.width.px]="indicatorRenderedW()"
              [style.height.px]="indicatorRenderedH()"
              aria-hidden="true"></span>

        @for (n of primary(); track n.id; let i = $index) {
          <!-- Buttons auto-scale to the visible-tab count. With many
               tabs (≥4) we stay icon-only on mobile to keep the pill
               compact; with few tabs (≤3) we always show the label
               on every viewport so a 2-button pill doesn't look like
               a tiny debug widget floating at the bottom. -->
          <button #navBtn type="button"
                  (click)="onTabClick(i, $event)"
                  class="pf-nav-btn press rounded-full flex items-center justify-center gap-1.5
                         shrink-0 text-[11px] font-semibold leading-none transition-colors"
                  [class.pf-nav-btn--compact]="compactMode()"
                  [class.pf-nav-btn--active]="activeIdx() === i">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                 @for(path of n.iconPath; track path) {
                  <path [attr.d]="path"/>
                 }
            </svg>
            <span class="pf-nav-btn__lbl">{{ n.label }}</span>
          </button>
        }

        @if (showAdminTab()) {
          <div class="w-px h-8 sm:h-10 mx-0.5 shrink-0" style="background: var(--border-muted);"></div>

          <!-- Admin = direct navigation to /admin (the categorised
               dashboard), not a popover. The old "More" sheet listed
               every admin page; that's now what the 2-panel /admin
               page itself shows, so the popover became redundant. -->
          <a #navBtn routerLink="/admin" routerLinkActive="pf-nav-btn--active"
             class="pf-nav-btn press rounded-full flex items-center justify-center gap-1.5
                    shrink-0 text-[11px] font-semibold leading-none transition-colors no-underline"
             [class.pf-nav-btn--compact]="compactMode()"
             aria-label="Admin">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>
            </svg>
            <span class="pf-nav-btn__lbl">Admin</span>
          </a>
        }
      </div>
    </nav>

    <!-- The mobile/iPad "More" sheet (formerly listed every admin
         page) has been removed. The Admin tab now navigates straight
         to /admin which already shows the same items in a richer
         2-panel layout — one destination instead of two competing
         menus. -->
  `,
  styles: [`
    .pf-bottom-nav {}

    /* The pill is the positioning context for the indicator + the
       pointer-event surface for the drag gesture. touch-action: pan-y
       reserves vertical scrolling for the page so horizontal swipes
       become our drag (we cancel them via preventDefault on move). */
    .pf-pill {
      position: relative;
      touch-action: pan-y;
      user-select: none;
      -webkit-user-select: none;
      transition: box-shadow 200ms ease;
    }
    .pf-pill::-webkit-scrollbar { display: none; }
    .pf-pill { scrollbar-width: none; -ms-overflow-style: none; }
    /* While dragging the pill clips horizontal scroll (so our gesture
     * doesn't compete with native overflow-x) AND releases vertical
     * overflow so the magnified loupe can rise above the bar's top
     * edge — like a real magnifier lifting off the page. The clip
     * value on overflow-x is the only one that allows the OTHER axis
     * to stay visible (hidden / auto / scroll all force a single
     * overflow style). Modern Chrome/Firefox/Safari all support it. */
    .pf-pill--dragging {
      overflow-x: clip;
      overflow-y: visible;
      box-shadow:
        0 18px 48px rgba(0,0,0,0.6),
        0 0 0 1px rgba(168, 85, 247, 0.25) inset;
    }
    /* The wrapping <nav> is also overflow-clipped by default by the
     * fixed positioning — make sure the magnifier can poke above. */
    .pf-bottom-nav { overflow: visible; }

    /* ─── Sliding indicator ───────────────────────────────────
     * One shared pill that glides between tabs. Position + width are
     * bound to the active button's offsetLeft / offsetWidth so it lands
     * exactly under whichever icon is current. Spring-ish overshoot on
     * the snap (cubic-bezier(0.34, 1.56, 0.64, 1)) — disabled while
     * dragging so the indicator follows the finger 1:1. */
    .pf-nav-indicator {
      position: absolute;
      top: 50%;
      left: 0;
      transform: translateX(0);
      transform-origin: center center;
      border-radius: 9999px;
      background: var(--gradient-primary);
      box-shadow: 0 6px 16px rgba(124, 58, 237, 0.45);
      pointer-events: none;
      z-index: 0;
      will-change: transform, width, height, background, box-shadow;
      /* Clip the duplicate nav row to the loupe's rounded shape so the
         magnified content stretches out of view at the edges. */
      overflow: hidden;
      transition:
        background 220ms ease,
        box-shadow 220ms ease,
        border-color 220ms ease;
      border: 1px solid transparent;
    }
    .pf-nav-indicator--ready {
      transition:
        transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
        width     260ms cubic-bezier(0.34, 1.56, 0.64, 1),
        height    260ms cubic-bezier(0.34, 1.56, 0.64, 1),
        background 220ms ease,
        box-shadow 220ms ease,
        border-color 220ms ease;
    }
    /* Drag state — Liquid-Glass loupe.
     * Background goes from gradient to near-transparent with a faint
     * white inner glow so the duplicate icons inside the loupe read
     * as the real icons seen through glass. Multi-layer box-shadow
     * gives a heavy outer drop, a white rim, and two thin chromatic-
     * aberration rings (cyan inside, magenta outside) for the iOS
     * Liquid-Glass fringe. */
    .pf-nav-indicator--dragging {
      /* Liquid violet glass.
       *
       * Two stacked backgrounds give the slider weight + lens shine:
       *   1. A specular radial highlight at the top-left, soft and
       *      diffuse, like studio light sitting on curved glass.
       *   2. A monochromatic violet gradient — same hue family
       *      throughout (deep violet → bright lavender → soft mauve)
       *      so it reads as a single brand-coloured object, no
       *      "rainbow stripe" feel.
       *
       * Backdrop blur softens whatever's behind it (real refraction).
       * Edges use only soft white glints + a single violet halo —
       * no hard cyan/magenta chromatic rings any more, which read as
       * harsh next to the brand colour. */
      background:
        radial-gradient(120% 80% at 30% 20%,
          rgba(255, 255, 255, 0.42) 0%,
          rgba(255, 255, 255, 0.10) 38%,
          transparent 72%),
        linear-gradient(135deg,
          rgba(124, 58, 237, 0.62) 0%,
          rgba(168, 85, 247, 0.55) 45%,
          rgba(192, 132, 252, 0.50) 100%);
      backdrop-filter: blur(14px) saturate(160%);
      -webkit-backdrop-filter: blur(14px) saturate(160%);
      border-color: rgba(221, 214, 254, 0.55);
      box-shadow:
        0 16px 40px rgba(124, 58, 237, 0.48),
        0 0 0 1px rgba(255, 255, 255, 0.34) inset,
        0 -1px 0 1px rgba(255, 255, 255, 0.22) inset,
        0  8px 14px rgba(58, 12, 130, 0.22) inset,
        0 0 32px rgba(168, 85, 247, 0.55);
      transition:
        background 220ms ease,
        border-color 220ms ease,
        box-shadow 220ms ease,
        backdrop-filter 220ms ease;
    }

    /* ─── Tab buttons ─────────────────────────────────────────
     * No per-tab background — the indicator owns the highlight. Buttons
     * sit above the indicator and crossfade icon colour as the indicator
     * arrives. */
    .pf-nav-btn {
      position: relative;
      z-index: 1;
      color: var(--text-tertiary);
      transition: color 320ms cubic-bezier(0.4, 0, 0.2, 1);
      background: transparent;
      border: 0;
      cursor: pointer;
      touch-action: pan-y;
      /* Default (label-visible) sizing — used when there are few
         tabs so the pill never looks like a sad widget. The icon +
         text sit side-by-side; height stays a pill-friendly 44px. */
      height: 44px;
      padding: 0 16px;
      min-width: 88px;
    }
    /* Compact mode — applied when there are 4+ visible items. Icon
       only on mobile, icon+label from sm:up. Matches the original
       look when the bar is dense. */
    .pf-nav-btn--compact {
      width: 44px; min-width: 44px;
      padding: 0;
      flex-direction: column;
      gap: 2px;
      font-size: 10px;
    }
    .pf-nav-btn--compact .pf-nav-btn__lbl { display: none; }
    @media (min-width: 640px) {
      .pf-nav-btn { height: 56px; min-width: 110px; padding: 0 18px; }
      .pf-nav-btn--compact { width: 64px; min-width: 64px; padding: 0; }
      .pf-nav-btn--compact .pf-nav-btn__lbl { display: inline; }
    }
    .pf-nav-btn:hover {
      color: var(--text-primary);
    }
    .pf-nav-btn--active {
      color: #ffffff;
    }
    .pf-nav-btn--active svg {
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
      animation: pf-nav-icon-bump 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes pf-nav-icon-bump {
      0%   { transform: scale(1); }
      55%  { transform: scale(1.10); }
      100% { transform: scale(1); }
    }

    .pf-more-item {
      color: var(--text-secondary);
      background: var(--glass-bg);
      border: 1px solid transparent;
    }
    .pf-more-item:hover {
      color: var(--text-primary);
      background: var(--glass-bg-hover);
      border-color: var(--glass-border);
    }
    .pf-more-active {
      background: var(--gradient-primary) !important;
      color: #ffffff !important;
      border-color: transparent !important;
    }

    @media (prefers-reduced-motion: reduce) {
      .pf-nav-indicator--ready { transition: none; }
      .pf-nav-btn--active svg { animation: none; }
    }
  `]
})
export class BottomNavComponent implements AfterViewInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly router = inject(Router);

  private readonly btns = viewChildren<ElementRef<HTMLElement>>('navBtn');
  private readonly pillRef = viewChild<ElementRef<HTMLElement>>('pill');

  protected readonly moreOpen = signal(false);

  // ─── Active state ────────────────────────────────────────────────
  protected readonly activeIdx = signal<number>(0);
  protected readonly moreActive = computed(() => this.activeIdx() === this.primary().length);

  // ─── Indicator geometry ──────────────────────────────────────────
  protected readonly indicator = signal<{ x: number; w: number; h: number }>({ x: 0, w: 56, h: 40 });
  protected readonly indicatorReady = signal(false);

  // ─── Loupe rendered geometry ─────────────────────────────────────
  // While dragging the loupe (1) gets a bigger CSS box so it captures
  // more world content (2 buttons-ish), (2) scales 1.35× via transform
  // for the magnification, and (3) re-centres on the user's drag
  // position so it doesn't drift off-axis when the active button width
  // differs from the rendered loupe width.

  /** Indicator's rendered width: ~1.25× during drag — modestly wider
   *  than the active button, just enough to read as an oval glass
   *  pill rather than a circle. */
  protected readonly indicatorRenderedW = computed(() => {
    const baseW = this.indicator().w;
    return this.dragging() ? Math.max(baseW * 1.25, 78) : baseW;
  });

  /** Indicator's rendered height: ~1.2× during drag — slightly taller
   *  than the bar so the glass oval lifts ~2–3 mm above. Always less
   *  than the rendered width so the silhouette stays a horizontal
   *  oval (not a circle or upright pill). */
  protected readonly indicatorRenderedH = computed(() => {
    const baseH = this.indicator().h;
    return this.dragging() ? baseH * 1.2 : baseH;
  });

  /** Indicator's rendered left: keeps the loupe centred on the same
   *  point the user is dragging (the active button's centre) even when
   *  rendered width != base width. */
  protected readonly indicatorRenderedX = computed(() => {
    const baseW = this.indicator().w;
    const renderedW = this.indicatorRenderedW();
    const cx = this.indicator().x + baseW / 2;
    return cx - renderedW / 2;
  });

  /** Composite transform: at rest the loupe stays vertically centred
   *  on the pill. Mid-drag we bias the centre slightly upward so the
   *  glass oval rises a couple of millimetres above the bar. Scale
   *  is light (1.05) — just enough to feel "lifted" off the surface
   *  without ballooning. */
  protected readonly indicatorTransform = computed(() => {
    const x = this.indicatorRenderedX();
    const scale = this.dragging() ? 1.05 : 1;
    const ty = this.dragging() ? '-55%' : '-50%';
    return `translate(${x}px, ${ty}) scale(${scale})`;
  });


  // ─── Drag state (transient, not used for change detection beyond the
  //     `dragging` signal that drives the CSS transition toggle) ─────
  protected readonly dragging = signal(false);
  private dragPointerId: number | null = null;
  private dragStartClientX = 0;
  private dragStartIndicatorW = 0;
  // Pill's left edge + current scrollLeft snapshot at pointerdown — used
  // to convert a pointer's clientX into a pill-content-relative X so the
  // indicator can lock its centre to wherever the finger is. Snapshotted
  // (not recomputed each move) because the pill is fixed-position and
  // scroll is clipped during drag, so it can't shift mid-gesture.
  private dragPillLeft = 0;
  private dragPillScrollLeft = 0;
  private dragMoved = false;
  private justDraggedAt = 0;        // performance.now() when the drag finished

  private routerSub?: Subscription;
  private resizeListener?: () => void;

  constructor() {
    this.labCfg.ensureLoaded();

    // Re-measure whenever the visible nav set changes (perm reload, mode
    // toggle, etc) so the indicator stays glued to the active button.
    effect(() => {
      const _btns = this.btns();
      const _idx = this.activeIdx();
      if (_btns.length === 0 || this.dragging()) return;
      requestAnimationFrame(() => this.measureToActive());
    });
  }

  ngAfterViewInit(): void {
    this.routerSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => this.recomputeActiveFromUrl());
    this.recomputeActiveFromUrl();

    this.resizeListener = () => this.measureToActive();
    window.addEventListener('resize', this.resizeListener);
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    if (this.resizeListener) window.removeEventListener('resize', this.resizeListener);
  }

  // ─── Visible nav lists ───────────────────────────────────────────
  private readonly visible = (items: NavItem[]): NavItem[] => {
    const cMode = this.labCfg.collectionMode();
    const bMode = this.labCfg.billingMode();
    return items.filter(i => {
      if (i.permissions?.length && !this.auth.hasAnyPermission(i.permissions)) return false;
      if (i.collectionModes && !i.collectionModes.includes(cMode)) return false;
      if (i.billingModes && !i.billingModes.includes(bMode)) return false;
      return true;
    });
  };

  readonly primary = computed(() => this.visible(PRIMARY_NAV));
  /** More-popover items. On mobile/iPad the desktop top-strip is
   *  hidden (`xl:flex`), so the new top-strip Admin icon isn't
   *  reachable there. We prepend ADMIN_NAV into More so admins on
   *  tablet/phone still have one tap to /admin. The permission
   *  filter (`visible`) already gates it for non-admins. */
  readonly more = computed(() => this.visible([ADMIN_NAV, ...MORE_NAV]));
  /** The Admin tab on the floating pill renders only when the user
   *  has at least one manage_* permission (i.e. ADMIN_NAV would
   *  appear in their visible list). Non-admin users see only their
   *  workflow tabs and no admin tab at all. */
  readonly showAdminTab = computed(() =>
    !ADMIN_NAV.permissions || this.auth.hasAnyPermission(ADMIN_NAV.permissions)
  );

  /** Compact (icon-only on mobile) when 4+ buttons are visible. With
   *  fewer the bar would otherwise look like a tiny floating widget;
   *  showing labels at low counts gives each button room to breathe. */
  readonly compactMode = computed(() => {
    const total = this.primary().length + (this.showAdminTab() ? 1 : 0);
    return total >= 4;
  });

  get pillClasses(): string {
    return 'bg-[var(--header-bg)] border border-[var(--header-border)]';
  }

  toggleMore() { this.moreOpen.update(v => !v); }
  closeMore() { this.moreOpen.set(false); }

  // ─── Click → navigate ────────────────────────────────────────────
  onTabClick(idx: number, ev: MouseEvent): void {
    // Suppress the synthetic click that fires after a finger drag — the
    // drag-release path already navigated; a duplicate router call here
    // is harmless but we want the tap-vs-drag distinction to stay clean.
    if (performance.now() - this.justDraggedAt < 250) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    this.setActive(idx, /* navigate */ true);
  }

  onMoreClick(ev: MouseEvent): void {
    if (performance.now() - this.justDraggedAt < 250) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    this.activeIdx.set(this.primary().length);
    this.toggleMore();
  }

  // ─── Pointer drag ────────────────────────────────────────────────

  onPillPointerDown(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    this.dragPointerId = ev.pointerId;
    this.dragStartClientX = ev.clientX;
    this.dragStartIndicatorW = this.indicator().w;
    this.dragMoved = false;

    // Snapshot the pill's position so we can map clientX -> pill-content
    // X without re-querying layout on every pointermove.
    const pill = this.pillRef()?.nativeElement;
    if (pill) {
      const rect = pill.getBoundingClientRect();
      this.dragPillLeft = rect.left;
      this.dragPillScrollLeft = pill.scrollLeft;
    }

    // Capture immediately. We don't want to wait until the threshold is
    // crossed — if we do, a fast swipe whose finger leaves the pill
    // mid-flight (between pointerdown and threshold) will silently lose
    // its pointermove stream. Capturing now routes every subsequent
    // move/up to the pill regardless of where the finger is on screen,
    // so the slider can follow the finger from tab 1 all the way to
    // tab 5 without dropping events.
    pill?.setPointerCapture?.(ev.pointerId);
  }

  onPillPointerMove(ev: PointerEvent): void {
    if (this.dragPointerId !== ev.pointerId) return;
    const dx = ev.clientX - this.dragStartClientX;

    if (!this.dragMoved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      // Crossed the threshold — promote to drag mode (turns off the
      // indicator's spring transition so it tracks the finger 1:1).
      this.dragMoved = true;
      this.dragging.set(true);
    }

    ev.preventDefault();

    // Lock the indicator's centre to the finger's X within the pill
    // content. This is what makes "tap on tab 5 and slide" work: on the
    // first qualifying move the indicator jumps under the finger and
    // tracks 1:1 from there, regardless of which tab was active before.
    const pointerXInPill = ev.clientX - this.dragPillLeft + this.dragPillScrollLeft;
    const halfW = this.dragStartIndicatorW / 2;
    const targetX = this.clampIndicatorX(pointerXInPill - halfW);
    this.indicator.update(g => ({ ...g, x: targetX }));

    // Active-idx live update — the icon the indicator centre sits over
    // goes white as the finger passes. Navigation itself is deferred to
    // pointerup so we don't router-thrash mid-drag.
    const centerX = targetX + halfW;
    const idx = this.idxAtCenter(centerX);
    if (idx !== this.activeIdx()) this.activeIdx.set(idx);
  }

  onPillPointerUp(ev: PointerEvent): void {
    if (this.dragPointerId !== ev.pointerId) return;
    const wasDrag = this.dragMoved;
    this.dragPointerId = null;
    this.dragMoved = false;

    if (wasDrag) {
      // Snap to the final active idx. Re-enabling the transition (by
      // dropping the --dragging class) lets the indicator spring to
      // measuredX with the cubic-bezier overshoot.
      this.dragging.set(false);
      this.justDraggedAt = performance.now();
      requestAnimationFrame(() => this.measureToActive());

      // Navigate to the snapped tab. If it's the More button index,
      // open the sheet instead.
      const idx = this.activeIdx();
      if (idx === this.primary().length) {
        this.toggleMore();
      } else {
        this.navigateTo(idx);
      }
    }
  }

  /** Map a (px) center X over the pill row to a button index. */
  private idxAtCenter(centerX: number): number {
    const btns = this.btns();
    if (btns.length === 0) return 0;
    for (let i = 0; i < btns.length; i++) {
      const el = btns[i].nativeElement;
      const left = el.offsetLeft;
      const right = left + el.offsetWidth;
      if (centerX >= left && centerX < right) return i;
    }
    // Past the last edge — clamp to nearest end.
    const first = btns[0].nativeElement;
    if (centerX < first.offsetLeft) return 0;
    return btns.length - 1;
  }

  /** Clamp the indicator's left edge so it never escapes the pill. */
  private clampIndicatorX(x: number): number {
    const btns = this.btns();
    if (btns.length === 0) return x;
    const first = btns[0].nativeElement;
    const last = btns[btns.length - 1].nativeElement;
    return Math.max(first.offsetLeft, Math.min(last.offsetLeft, x));
  }

  /** Navigate to the URL of the primary tab at `idx`. */
  private navigateTo(idx: number): void {
    const items = this.primary();
    if (idx < 0 || idx >= items.length) return;
    this.router.navigateByUrl(items[idx].href);
  }

  /** Tap-style commit: set active and navigate. */
  private setActive(idx: number, navigate: boolean): void {
    this.activeIdx.set(idx);
    if (navigate) this.navigateTo(idx);
  }

  // ─── URL → active idx ────────────────────────────────────────────

  private recomputeActiveFromUrl(): void {
    if (this.dragging()) return; // user is mid-drag — they own the indicator
    const url = this.router.url.split('?')[0];
    const primary = this.primary();
    const idx = primary.findIndex(n => this.matches(url, n));
    if (idx >= 0) {
      this.activeIdx.set(idx);
      return;
    }
    if (this.more().length > 0 && this.more().some(n => this.matches(url, n))) {
      this.activeIdx.set(primary.length);
      return;
    }
    this.activeIdx.set(0);
  }

  private matches(url: string, n: NavItem): boolean {
    if (n.exact) return url === n.href;
    return url === n.href || url.startsWith(n.href + '/');
  }

  /** Snap the indicator to the active button's measured box. Animated
   *  by CSS once `--ready` is on (and the drag class is off). */
  private measureToActive(): void {
    if (this.dragging()) return;
    const btns = this.btns();
    const ref = btns[this.activeIdx()];
    if (!ref) return;
    const el = ref.nativeElement;
    this.indicator.set({ x: el.offsetLeft, w: el.offsetWidth, h: el.offsetHeight });
    if (!this.indicatorReady()) {
      requestAnimationFrame(() => this.indicatorReady.set(true));
    }
  }
}
