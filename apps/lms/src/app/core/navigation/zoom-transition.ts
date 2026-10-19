import { ApplicationRef, Injectable, inject, signal } from '@angular/core';
import {
  NavigationCancel, NavigationCancellationCode, NavigationEnd, NavigationError, NavigationSkipped,
  NavigationStart, Router, ViewTransitionInfo,
} from '@angular/router';

/**
 * LIST → DETAIL ZOOM, one mechanism for every lab module (docs/PF-PATTERN.md
 * §9: "list → detail = zoom, step → step = slide").
 *
 *   <div [pfZoomSource]="[tube.sampleId]">…tile…</div>          (the list)
 *   <section [pfZoomTarget]="[sampleId]">…first card…</section> (the detail)
 *
 * The TAPPED source (never "whichever tile has that id") is the only element
 * named, and only for the length of the transition; the detail's target (its
 * skeleton while loading, its first card once loaded) takes the same name in
 * the new state, so the browser morphs one into the other. The name is ONE
 * fixed ident (`pf-zoom`): only one element ever carries it in a state, so
 * there is no duplicate-name abort and no per-id CSS.
 *
 * Why it is reliable:
 *  - zoom is decided by the TAP (an "arm"), not by URL patterns, so guard
 *    redirects (/lab/sample → /lab/culture) and any list → detail pair work;
 *  - the detail page holds its skeleton until the morph ends (`holding()`),
 *    so the named element is never swapped mid-animation (Chrome cuts a
 *    transition short when its captured element leaves the DOM — the old
 *    "zoom sometimes happens" bug: it depended on how fast the API answered);
 *  - a generation token keeps an older transition's cleanup from stripping
 *    a newer one's names/classes; a double tap is swallowed.
 * Back (detail → the list it came from) reverses it: the card shrinks into
 * the tile when the list has rendered it, else toward where the tile was.
 * No View Transitions → instant; reduced motion → instant (nothing named).
 */

export const ZOOM_NAME = 'pf-zoom';
/** Morph length: the nd spring over ~400ms reads as one continuous zoom. */
export const ZOOM_MS = 400;
export const ZOOM_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';   // --pf-spring
export const ZOOM_IN_CLASS = 'pf-vt-zoom-in';
export const ZOOM_OUT_CLASS = 'pf-vt-zoom-out';
/** Marks whatever we named, so a stale name can always be found and cleared. */
export const ZOOM_NAMED_ATTR = 'data-pf-zoom-named';
/** A tap arms the zoom; its navigation must START within this window. */
export const ARM_MS = 1200;
/** A second tap this soon after the first is a double tap: swallowed. */
export const DOUBLE_TAP_MS = 350;
/** While the tapped navigation is still in flight (slow guard / lazy chunk),
 *  further taps are swallowed, but never for longer than this. */
export const IN_FLIGHT_MAX_MS = 8000;

/** Keys a source/target answers to: a sample id, an order-test id, a report
 *  id… A detail reached through a redirect lists BOTH sides' ids (the culture
 *  page is [orderTestId, sampleId]) so back finds the tile either way. */
export type ZoomKeys = string | null | undefined | ReadonlyArray<string | null | undefined>;

export function zoomKeys(v: ZoomKeys): string[] {
  const list: ReadonlyArray<string | null | undefined> = Array.isArray(v) ? v : [v as string | null | undefined];
  const out: string[] = [];
  for (const k of list) {
    const s = (k ?? '').toString().trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function keysMatch(a: readonly string[], b: readonly string[]): boolean {
  return a.some(k => b.includes(k));
}

export function zoomPath(url: string | null | undefined): string {
  const p = (url || '').split(/[?#]/)[0].replace(/\/+$/, '');
  return p || '/';
}

/** The detail screens a list opens (the zoom's destinations). A tap on a
 *  source followed by a navigation anywhere else (sidebar, tabs) never zooms. */
const DETAIL_ROUTES: readonly RegExp[] = [
  /^\/frontdesk\/patients\/(?!new$)[^/]+$/,
  // Order & Payments opened FOR a record: a parked draft (row / shelf chip)
  // or an order tile. Only a tapped source zooms, so "New order" stays instant.
  /^\/frontdesk\/order$/,
  /^\/lab\/sample\/[^/]+$/,
  /^\/lab\/culture\/[^/]+$/,
  /^\/lab\/result\/[^/]+$/,
  /^\/pathologist\/validate\/[^/]+$/,
  /^\/reports\/view\/[^/]+$/,
];
export function isZoomDetail(url: string): boolean {
  const p = zoomPath(url);
  return DETAIL_ROUTES.some(r => r.test(p));
}

/** One zoom endpoint (a source tile or a target card), registered by the
 *  directives in zoom.directive.ts. */
export interface ZoomEndpoint {
  readonly el: HTMLElement;
  keys(): string[];
}

interface Rect { left: number; top: number; width: number; height: number; }
interface Arm { el: HTMLElement; keys: string[]; at: number; bound: boolean; }
/** The last zoom IN: what back has to reverse. */
interface Opened { keys: string[]; listPath: string; rect: Rect; }
interface Active { gen: number; dir: 'in' | 'out'; keys: string[]; from: HTMLElement | null; to: HTMLElement | null; }

/** The ViewTransition surface we use (the DOM type, or a test fake). */
export interface ZoomTransitionLike {
  readonly updateCallbackDone: Promise<unknown>;
  readonly ready: Promise<unknown>;
  readonly finished: Promise<unknown>;
  skipTransition(): void;
}

/** The longest any of our view transitions may run (update callback + the
 *  400ms morph / 360ms slide, with room for a slow first render). */
export const TRANSITION_MAX_MS = 2000;

/**
 * Never let a view transition outlive its purpose. While one is pending the
 * browser shows SNAPSHOTS of the page and suppresses rendering; on iPad
 * WebKit a transition caught by an app switch / lock / slow frame could sit
 * there, leaving a frozen or half-painted screen (owner, 2026-09-28: the
 * Frontdesk frame with an unpainted right strip, an empty search box and no
 * navbar — just after the Collect → Frontdesk "back" slide). So: skip it
 * (= jump to the final, live DOM) after `maxMs`, or the moment the page is
 * hidden. Harmless once it has finished.
 */
export function guardTransition(
  t: Pick<ZoomTransitionLike, 'finished' | 'skipTransition'>,
  doc: Document = document,
  maxMs = TRANSITION_MAX_MS,
): void {
  let done = false;
  const skip = () => { if (!done) { try { t.skipTransition(); } catch { /* already over */ } } };
  const onVis = () => { if (doc.visibilityState === 'hidden') skip(); };
  const timer = setTimeout(skip, maxMs);
  doc.addEventListener('visibilitychange', onVis);
  const settle = () => {
    done = true;
    clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVis);
  };
  Promise.resolve(t.finished).then(settle, settle);
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
function rendered(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

@Injectable({ providedIn: 'root' })
export class ZoomTransitionService {
  private readonly appRef = inject(ApplicationRef);
  private readonly sources = new Set<ZoomEndpoint>();
  private readonly targets = new Set<ZoomEndpoint>();
  private arm: Arm | null = null;
  private lastTap: { el: HTMLElement; keys: string[] } | null = null;
  private opened: Opened | null = null;
  private active: Active | null = null;
  private gen = 0;
  private readonly named = new Set<HTMLElement>();
  private readonly _holding = signal(false);
  /** True while a zoom IN is morphing: detail pages keep their skeleton up
   *  until it ends, so the named element is never swapped mid-animation. */
  readonly holding = this._holding.asReadonly();

  /** Test seams. */
  now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  doc: Document = document;

  constructor() {
    inject(Router, { optional: true })?.events?.subscribe(e => this.onNavEvent(e));
  }

  /** Router events drive the arm's lifetime (public for specs). */
  onNavEvent(e: unknown): void {
    const a = this.arm;
    if (!a) return;
    if (e instanceof NavigationStart) {
      // The navigation this tap started: keep the arm through guards and
      // lazy loading, however long they take.
      if (!a.bound && this.now() - a.at <= ARM_MS) a.bound = true;
      else if (!a.bound) this.arm = null;
    } else if (e instanceof NavigationCancel) {
      // A guard redirect (/lab/sample → /lab/culture) or a superseding
      // navigation continues the same intent; anything else ends it.
      if (e.code !== NavigationCancellationCode.Redirect
          && e.code !== NavigationCancellationCode.SupersededByNewNavigation) this.arm = null;
    } else if (e instanceof NavigationEnd || e instanceof NavigationError || e instanceof NavigationSkipped) {
      this.arm = null;
    }
  }

  // ── Registration (directives) ─────────────────────────────────────────
  attachSource(s: ZoomEndpoint): void {
    this.sources.add(s);
    const a = this.active;
    // Zoom OUT: the list re-rendered the tile we are shrinking into.
    if (a && a.dir === 'out' && !a.to && s.el !== a.from && keysMatch(s.keys(), a.keys)) this.nameTo(a, s.el);
  }
  detachSource(s: ZoomEndpoint): void { this.sources.delete(s); }

  attachTarget(t: ZoomEndpoint): void {
    this.targets.add(t);
    const a = this.active;
    // Zoom IN: the detail rendered its card / skeleton. Take it, or trade up
    // to one whose keys match where the current pick doesn't.
    if (a && a.dir === 'in' && t.el !== a.from && t.keys().length
        && (!a.to || (!keysMatch(this.keysOf(a.to), a.keys) && keysMatch(t.keys(), a.keys)))) {
      this.nameTo(a, t.el);
    }
  }
  detachTarget(t: ZoomEndpoint): void { this.targets.delete(t); }

  // ── Taps ──────────────────────────────────────────────────────────────
  /** A source was tapped. Returns false when the tap must be swallowed (a
   *  double tap, or a tap while the first one's navigation is in flight). */
  tap(el: HTMLElement, keys: string[]): boolean {
    const t = this.now();
    const a = this.arm;
    if (a && (t - a.at < DOUBLE_TAP_MS || (a.bound && t - a.at < IN_FLIGHT_MAX_MS))) return false;
    this.arm = { el, keys, at: t, bound: false };
    this.lastTap = { el, keys };
    return true;
  }

  /** Flows that open the detail only after a gate (scan to claim, a reason
   *  prompt) re-arm the tile the user tapped, right before navigating. Only
   *  that tile, and only when it is the one for `key`: a band scan of some
   *  other tube never zooms from a stale tile. */
  rearm(key: string | null | undefined): boolean {
    const lt = this.lastTap;
    if (!key || !lt || !lt.el.isConnected || !lt.keys.includes(key)) return false;
    this.arm = { el: lt.el, keys: lt.keys, at: this.now(), bound: false };
    return true;
  }

  disarm(): void { this.arm = null; }

  /** A tap has armed a zoom that has not run yet (PageOpenService holds its
   *  destination frame back: the zoom is this navigation's motion). */
  armed(): boolean {
    const a = this.arm;
    return !!a && a.el.isConnected && (a.bound || this.now() - a.at <= ARM_MS);
  }

  private takeArm(): Arm | null {
    const a = this.arm;
    this.arm = null;
    if (!a || !a.el.isConnected) return null;
    return a.bound || this.now() - a.at <= ARM_MS ? a : null;
  }

  // ── Router transitions (called from slideTransition) ───────────────────
  /** Decide + run the zoom for a router view transition. Returns false when
   *  this navigation is not a zoom (the caller swaps instantly). */
  onRouterTransition(info: ViewTransitionInfo | { transition: ZoomTransitionLike }, fromUrl: string, toUrl: string): boolean {
    const t = info.transition as ZoomTransitionLike;
    const from = zoomPath(fromUrl), to = zoomPath(toUrl);
    const arm = this.takeArm();
    if (arm && from !== to && isZoomDetail(to)) {
      this.zoomIn(t, arm, from);
      return true;
    }
    const o = this.opened;
    if (o && isZoomDetail(from) && to === o.listPath) {
      const card = this.pickTarget(o.keys) ?? this.pageHost();
      if (card) { this.zoomOut(t, o, card); return true; }
    }
    // Left the detail for somewhere else: back from there is not a reversal.
    if (!isZoomDetail(to)) this.opened = null;
    return false;
  }

  // ── In-page list → detail (Collect's patient card → collection view) ───
  /** Run `update` (which opens/closes an in-page detail) as a zoom. Falls
   *  back to calling it straight away when there is nothing to zoom. */
  runLocal(dir: 'in' | 'out', update: () => void): void {
    const doc = this.doc as Document & { startViewTransition?: (cb: () => void) => ZoomTransitionLike };
    if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) { this.arm = null; update(); return; }
    const run = () => { update(); this.appRef.tick(); };
    const start = () => { const t = doc.startViewTransition!(run); guardTransition(t, this.doc); return t; };
    if (dir === 'in') {
      const arm = this.takeArm();
      if (!arm) { update(); return; }
      this.zoomIn(start(), arm, '');
      return;
    }
    const o = this.opened;
    const card = o ? this.pickTarget(o.keys, null, true) : null;   // only the view that zoom opened
    if (!o || !card) { update(); return; }
    this.zoomOut(start(), o, card);
  }

  // ── The two directions ────────────────────────────────────────────────
  private zoomIn(t: ZoomTransitionLike, arm: Arm, listPath: string): void {
    const gen = this.begin(ZOOM_IN_CLASS);
    this.opened = { keys: arm.keys, listPath, rect: rectOf(arm.el) };
    const a: Active = { gen, dir: 'in', keys: arm.keys, from: arm.el, to: null };
    this.active = a;
    this.name(arm.el);            // the old state is captured after this, next frame
    this._holding.set(true);
    t.updateCallbackDone.then(() => {
      if (this.active !== a) return;
      if (!a.to) {
        // The detail rendered no target: morph into the whole routed page.
        const el = this.pickTarget(a.keys, a.from) ?? this.pageHost();
        if (el && el !== a.from) this.nameTo(a, el);
      }
      if (a.from && a.from !== a.to && a.from.isConnected) this.unname(a.from);   // in-page: the list stays
    }).catch(() => {});
    t.finished.finally(() => { this.settleFocus(a, gen); this.end(gen); }).catch(() => {});
  }

  private zoomOut(t: ZoomTransitionLike, o: Opened, card: HTMLElement): void {
    const gen = this.begin(ZOOM_OUT_CLASS);
    const keys = zoomKeys([...o.keys, ...this.keysOf(card)]);
    const a: Active = { gen, dir: 'out', keys, from: card, to: null };
    this.active = a;
    this.opened = null;
    const fromRect = rectOf(card);
    this.name(card);
    t.updateCallbackDone.then(() => {
      if (this.active !== a) return;
      if (card.isConnected && card !== a.to) this.unname(card);
      if (!a.to) {
        const src = this.pickSource(keys);
        if (src) this.nameTo(a, src);
      }
    }).catch(() => {});
    // The list hasn't rendered that tile yet (it reloads from the API):
    // shrink the card toward where the tile was.
    t.ready.then(() => {
      if (this.active !== a || a.to) return;
      const root = this.doc.documentElement;
      if (typeof root.animate !== 'function') return;
      const r = o.rect;
      root.animate(
        [
          { transform: `translate(${fromRect.left}px, ${fromRect.top}px)`, width: `${fromRect.width}px`, height: `${fromRect.height}px`, opacity: 1 },
          { transform: `translate(${r.left}px, ${r.top}px)`, width: `${r.width}px`, height: `${r.height}px`, opacity: 0 },
        ],
        { duration: ZOOM_MS, easing: ZOOM_EASING, fill: 'forwards', pseudoElement: `::view-transition-group(${ZOOM_NAME})` },
      );
    }).catch(() => {});
    t.finished.finally(() => { this.settleFocus(a, gen); this.end(gen); }).catch(() => {});
  }

  /** Focus follows the zoom (a11y): opened → the detail's card; closed →
   *  the tile it shrank back into. Only when focus was lost with the old
   *  view (on <body> or a detached node) — never steal it from a field the
   *  screen focused itself (e.g. the order search). */
  private settleFocus(a: Active, gen: number): void {
    if (gen !== this.gen) return;
    const el = a.to;
    if (!el || !el.isConnected) return;
    const ae = this.doc.activeElement as HTMLElement | null;
    if (ae && ae !== this.doc.body && ae.isConnected && ae !== a.from) return;
    const focusable = el.matches('a[href], button, input, select, textarea, [tabindex]');
    if (!focusable) {
      if (a.dir === 'out') return;              // a plain tile: leave focus alone
      el.setAttribute('tabindex', '-1');
    }
    try { el.focus({ preventScroll: true }); } catch { /* detached */ }
  }

  // ── Naming ────────────────────────────────────────────────────────────
  private begin(cls: string): number {
    const gen = ++this.gen;
    this.clearNames();
    const root = this.doc.documentElement;
    root.classList.remove(ZOOM_IN_CLASS, ZOOM_OUT_CLASS);
    root.classList.add(cls);
    return gen;
  }
  /** Only the transition that is still current may clean up: an older,
   *  superseded one must not strip the newer one's names or classes. */
  private end(gen: number): void {
    if (gen !== this.gen) return;
    this.clearNames();
    this.doc.documentElement.classList.remove(ZOOM_IN_CLASS, ZOOM_OUT_CLASS);
    this.active = null;
    this._holding.set(false);
  }
  /** Name the new-state element. The old-state one lets go if it is still in
   *  the DOM (in-page zoom): two elements with the name would abort. */
  private nameTo(a: Active, el: HTMLElement): void {
    if (a.to && a.to !== el) this.unname(a.to);
    if (a.from && a.from !== el && a.from.isConnected) this.unname(a.from);
    a.to = el;
    this.name(el);
  }
  private name(el: HTMLElement): void {
    el.style.setProperty('view-transition-name', ZOOM_NAME);
    el.setAttribute(ZOOM_NAMED_ATTR, '');
    this.named.add(el);
  }
  private unname(el: HTMLElement): void {
    el.style.removeProperty('view-transition-name');
    el.removeAttribute(ZOOM_NAMED_ATTR);
    this.named.delete(el);
  }
  /** Everything we ever named (detached ones too: a view can be re-attached)
   *  plus anything in the DOM still carrying our marker. */
  private clearNames(): void {
    [...this.named].forEach(el => this.unname(el));
    this.doc.querySelectorAll<HTMLElement>(`[${ZOOM_NAMED_ATTR}]`).forEach(el => this.unname(el));
  }

  // ── Lookup ────────────────────────────────────────────────────────────
  private keysOf(el: HTMLElement): string[] {
    for (const e of [...this.targets, ...this.sources]) if (e.el === el) return e.keys();
    return [];
  }
  private pickTarget(keys: readonly string[], not?: HTMLElement | null, strict = false): HTMLElement | null {
    // A target with no keys is inert (`[pfZoomTarget]="first ? keys : null"`).
    const live = [...this.targets].filter(t => t.el !== not && t.keys().length > 0 && rendered(t.el));
    const hit = live.find(t => keysMatch(t.keys(), keys));
    return (hit ?? (strict ? undefined : live[0]))?.el ?? null;
  }
  private pickSource(keys: readonly string[]): HTMLElement | null {
    const hits = [...this.sources].filter(s => keysMatch(s.keys(), keys) && rendered(s.el));
    const vh = this.doc.defaultView?.innerHeight ?? 0;
    const onScreen = hits.find(s => { const r = s.el.getBoundingClientRect(); return r.bottom > 0 && (!vh || r.top < vh); });
    return (onScreen ?? hits[0])?.el ?? null;
  }
  /** The routed page's host element (the deepest outlet's activated view). */
  private pageHost(): HTMLElement | null {
    const outlets = this.doc.querySelectorAll('router-outlet');
    const host = outlets[outlets.length - 1]?.nextElementSibling as HTMLElement | null | undefined;
    return host && rendered(host) ? host : null;
  }

  /** Test seam: forget everything. */
  _reset(): void {
    this.arm = null; this.lastTap = null; this.opened = null; this.active = null;
    this.gen++; this._holding.set(false);
    this.sources.clear(); this.targets.clear();
  }
}
