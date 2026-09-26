import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NavigationCancel, NavigationCancellationCode, NavigationEnd, NavigationStart } from '@angular/router';
import { slideDirection } from './slide-transition';
import {
  ARM_MS, DOUBLE_TAP_MS, ZOOM_IN_CLASS, ZOOM_NAME, ZOOM_OUT_CLASS, ZoomEndpoint, ZoomTransitionService,
  isZoomDetail, keysMatch, zoomKeys, zoomPath,
} from './zoom-transition';

/** A ViewTransition stand-in whose phases we resolve by hand. */
function fakeTransition() {
  let doneUpdate!: () => void, ready!: () => void, finish!: () => void;
  const transition = {
    updateCallbackDone: new Promise<void>(r => (doneUpdate = r)),
    ready: new Promise<void>(r => (ready = r)),
    finished: new Promise<void>(r => (finish = r)),
    skipTransition: vi.fn(),
  };
  return { info: { transition }, doneUpdate, ready, finish };
}
const flush = () => new Promise(r => setTimeout(r, 0));
const vtName = (el: HTMLElement) => el.style.getPropertyValue('view-transition-name');

function endpoint(keys: string[]): ZoomEndpoint & { el: HTMLElement } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return { el, keys: () => keys };
}

describe('zoom keys + routes (pure)', () => {
  it('zoomKeys normalises a key or a list, dropping blanks and repeats', () => {
    expect(zoomKeys('s1')).toEqual(['s1']);
    expect(zoomKeys(['ot1', null, ' s1 ', undefined, 'ot1', ''])).toEqual(['ot1', 's1']);
    expect(zoomKeys(null)).toEqual([]);
  });
  it('keysMatch is any shared key (the redirect mapping: tube id ↔ culture page [orderTestId, sampleId])', () => {
    expect(keysMatch(['s1'], ['ot1', 's1'])).toBe(true);
    expect(keysMatch(['ot1', 's1'], ['s1'])).toBe(true);
    expect(keysMatch(['s2'], ['ot1', 's1'])).toBe(false);
  });
  it('zoomPath strips query, hash and trailing slash', () => {
    expect(zoomPath('/lab/my-work?tab=completed')).toBe('/lab/my-work');
    expect(zoomPath('/lab/sample/abc/#x')).toBe('/lab/sample/abc');
    expect(zoomPath('')).toBe('/');
  });
  it('isZoomDetail: the lab detail screens only', () => {
    for (const u of ['/lab/sample/a?view=1', '/lab/culture/ot', '/lab/result/t', '/pathologist/validate/t', '/reports/view/r'])
      expect(isZoomDetail(u)).toBe(true);
    for (const u of ['/lab/my-work', '/pathologist', '/reports', '/lab/collect', '/lab/sample'])
      expect(isZoomDetail(u)).toBe(false);
  });
  it('the zoom and the step slide never claim the same navigation', () => {
    expect(slideDirection('/lab/my-work', '/lab/sample/abc')).toBeNull();
    expect(slideDirection('/lab/sample/abc', '/lab/my-work')).toBeNull();
    expect(slideDirection('/pathologist', '/lab/culture/x')).toBeNull();
  });
});

describe('ZoomTransitionService', () => {
  let zoom: ZoomTransitionService;
  let clock = 1000;
  const made: HTMLElement[] = [];
  const mk = (keys: string[]) => { const e = endpoint(keys); made.push(e.el); return e; };

  beforeEach(() => {
    // jsdom lays nothing out: treat every connected element as rendered.
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
    });
    zoom = TestBed.inject(ZoomTransitionService);
    zoom._reset();
    clock = 1000;
    zoom.now = () => clock;
    zoom.doc = document;
  });
  afterEach(() => {
    made.splice(0).forEach(e => e.remove());
    document.documentElement.className = '';
    vi.restoreAllMocks();
  });

  it('IN: names ONLY the tapped tile, then the detail target; clears everything at the end', async () => {
    const a = mk(['s1']), b = mk(['s2']);
    zoom.attachSource(a); zoom.attachSource(b);
    expect(zoom.tap(a.el, a.keys())).toBe(true);
    const { info, doneUpdate, finish } = fakeTransition();

    expect(zoom.onRouterTransition(info, '/lab/my-work', '/lab/sample/s1')).toBe(true);
    expect(vtName(a.el)).toBe(ZOOM_NAME);
    expect(vtName(b.el)).toBe('');
    expect(document.documentElement.classList).toContain(ZOOM_IN_CLASS);
    expect(zoom.holding()).toBe(true);

    // The router swaps pages: the list leaves, the detail's skeleton renders.
    a.el.remove(); b.el.remove();
    const card = mk(['s1']);
    zoom.attachTarget(card);
    expect(vtName(card.el)).toBe(ZOOM_NAME);
    doneUpdate(); await flush();
    expect(document.querySelectorAll('[data-pf-zoom-named]').length).toBe(1);

    finish(); await flush();
    expect(vtName(card.el)).toBe('');
    expect(vtName(a.el)).toBe('');
    expect(document.documentElement.classList).not.toContain(ZOOM_IN_CLASS);
    expect(zoom.holding()).toBe(false);
  });

  it('holds the skeleton until the morph ends (the named element is never swapped mid-animation)', async () => {
    const a = mk(['s1']);
    zoom.tap(a.el, a.keys());
    const { info, finish } = fakeTransition();
    zoom.onRouterTransition(info, '/lab/my-work', '/lab/sample/s1');
    expect(zoom.holding()).toBe(true);
    clock += 5000;                       // data long since arrived
    expect(zoom.holding()).toBe(true);
    finish(); await flush();
    expect(zoom.holding()).toBe(false);
  });

  it('without a tap there is no zoom (search / scan / notification opens are instant)', () => {
    mk(['s1']);
    const { info } = fakeTransition();
    expect(zoom.onRouterTransition(info, '/lab/my-work', '/lab/sample/s1')).toBe(false);
    expect(document.documentElement.classList).not.toContain(ZOOM_IN_CLASS);
  });

  it('a tap followed by a non-detail navigation (sidebar) does not zoom, and disarms', () => {
    const a = mk(['s1']);
    zoom.tap(a.el, a.keys());
    expect(zoom.onRouterTransition(fakeTransition().info, '/lab/my-work', '/admin')).toBe(false);
    expect(zoom.onRouterTransition(fakeTransition().info, '/admin', '/lab/sample/s1')).toBe(false);
  });

  it('the arm expires when no navigation starts in time', () => {
    const a = mk(['s1']);
    zoom.tap(a.el, a.keys());
    clock += ARM_MS + 1;
    expect(zoom.onRouterTransition(fakeTransition().info, '/lab/my-work', '/lab/sample/s1')).toBe(false);
  });

  it('a slow navigation (guard / lazy chunk) keeps its arm once it has started', () => {
    const a = mk(['s1']);
    zoom.tap(a.el, a.keys());
    zoom.onNavEvent(new NavigationStart(1, '/lab/sample/s1'));
    clock += 4000;
    expect(zoom.onRouterTransition(fakeTransition().info, '/lab/my-work', '/lab/sample/s1')).toBe(true);
  });

  it('REDIRECT: /lab/sample/:sampleId → /lab/culture/:orderTestId still zooms, and back finds the tile by either key', async () => {
    const tile = mk(['s1']);
    zoom.attachSource(tile);
    zoom.tap(tile.el, tile.keys());
    zoom.onNavEvent(new NavigationStart(1, '/lab/sample/s1'));
    // cultureSampleRedirectGuard cancels with a redirect, then navigates on.
    zoom.onNavEvent(new NavigationCancel(1, '/lab/sample/s1', 'redirect', NavigationCancellationCode.Redirect));
    zoom.onNavEvent(new NavigationStart(2, '/lab/culture/ot1'));
    const t1 = fakeTransition();
    expect(zoom.onRouterTransition(t1.info, '/lab/my-work', '/lab/culture/ot1')).toBe(true);
    tile.el.remove(); zoom.detachSource(tile);
    const page = mk(['ot1', 's1']);            // culture page: [orderTestId, sampleId]
    zoom.attachTarget(page);
    expect(vtName(page.el)).toBe(ZOOM_NAME);
    t1.finish(); await flush();

    // Back to My Work: the card is named in the OLD state, the re-rendered
    // tube tile (keyed by sample id only) in the NEW one.
    const t2 = fakeTransition();
    expect(zoom.onRouterTransition(t2.info, '/lab/culture/ot1', '/lab/my-work')).toBe(true);
    expect(vtName(page.el)).toBe(ZOOM_NAME);
    expect(document.documentElement.classList).toContain(ZOOM_OUT_CLASS);
    page.el.remove(); zoom.detachTarget(page);
    const again = mk(['s1']);
    zoom.attachSource(again);
    expect(vtName(again.el)).toBe(ZOOM_NAME);
    t2.finish(); await flush();
    expect(vtName(again.el)).toBe('');
  });

  it('a culture tile keyed [orderTestId, sampleId] maps to the same page the other way round', () => {
    const tile = mk(['ot1', 's1']);
    zoom.tap(tile.el, tile.keys());
    const t = fakeTransition();
    expect(zoom.onRouterTransition(t.info, '/lab/my-work', '/lab/culture/ot1')).toBe(true);
    tile.el.remove();
    const other = mk(['zz']), page = mk(['ot1']);
    zoom.attachTarget(other);               // an unrelated target renders first…
    zoom.attachTarget(page);                // …the matching one takes over the name
    expect(vtName(other.el)).toBe('');
    expect(vtName(page.el)).toBe(ZOOM_NAME);
  });

  it('a target with no keys is inert (only the FIRST card is a target)', () => {
    const a = mk(['s1']);
    zoom.tap(a.el, a.keys());
    zoom.onRouterTransition(fakeTransition().info, '/lab/my-work', '/lab/sample/s1');
    a.el.remove();
    const second = mk([]);
    zoom.attachTarget(second);
    expect(vtName(second.el)).toBe('');
  });

  it('DOUBLE TAP: a second tap within the window is swallowed; a later one is not', () => {
    const a = mk(['s1']);
    expect(zoom.tap(a.el, a.keys())).toBe(true);
    clock += DOUBLE_TAP_MS - 50;
    expect(zoom.tap(a.el, a.keys())).toBe(false);
    clock += 400;
    expect(zoom.tap(a.el, a.keys())).toBe(true);
  });

  it('taps are swallowed while the tapped navigation is in flight, and free again after it ends', () => {
    const a = mk(['s1']), b = mk(['s2']);
    zoom.tap(a.el, a.keys());
    zoom.onNavEvent(new NavigationStart(1, '/lab/sample/s1'));
    clock += 2000;
    expect(zoom.tap(b.el, b.keys())).toBe(false);
    zoom.onNavEvent(new NavigationEnd(1, '/lab/sample/s1', '/lab/sample/s1'));
    expect(zoom.tap(b.el, b.keys())).toBe(true);
  });

  it('rearm(): only the tapped tile, and only for its own key (a scan of another tube never zooms)', () => {
    const a = mk(['s1']);
    zoom.tap(a.el, a.keys());
    clock += 30_000;                        // the scan-to-claim gate took a while
    expect(zoom.rearm('s2')).toBe(false);
    expect(zoom.rearm('s1')).toBe(true);
    expect(zoom.onRouterTransition(fakeTransition().info, '/lab/my-work', '/lab/sample/s1')).toBe(true);
  });

  it('an older transition finishing never strips a newer one (generation token)', async () => {
    const b = mk(['s1']);
    zoom.tap(b.el, b.keys());
    const t2 = fakeTransition();
    zoom.onRouterTransition(t2.info, '/lab/my-work', '/lab/sample/s1');
    const t3 = fakeTransition();
    clock += 1000;
    zoom.tap(b.el, b.keys());
    zoom.onRouterTransition(t3.info, '/lab/my-work', '/lab/sample/s1');
    t2.finish(); await flush();             // the superseded one ends late
    expect(document.documentElement.classList).toContain(ZOOM_IN_CLASS);
    expect(vtName(b.el)).toBe(ZOOM_NAME);
    expect(zoom.holding()).toBe(true);
    t3.finish(); await flush();
    expect(document.documentElement.classList).not.toContain(ZOOM_IN_CLASS);
    expect(vtName(b.el)).toBe('');
  });

  it('OUT with the tile not rendered yet: shrinks the card toward where the tile was', async () => {
    const a = mk(['s1']);
    zoom.tap(a.el, a.keys());
    const t1 = fakeTransition();
    zoom.onRouterTransition(t1.info, '/lab/my-work', '/lab/sample/s1');
    a.el.remove();
    const card = mk(['s1']);
    zoom.attachTarget(card);
    t1.finish(); await flush();

    const animate = vi.fn();
    (document.documentElement as unknown as { animate: unknown }).animate = animate;
    const t2 = fakeTransition();
    expect(zoom.onRouterTransition(t2.info, '/lab/sample/s1?view=1', '/lab/my-work?tab=completed')).toBe(true);
    card.el.remove();
    t2.doneUpdate(); await flush();
    t2.ready(); await flush();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][1].pseudoElement).toBe(`::view-transition-group(${ZOOM_NAME})`);
    delete (document.documentElement as unknown as { animate?: unknown }).animate;
  });

  it('back is not a reversal after leaving the detail for elsewhere', async () => {
    const a = mk(['s1']);
    zoom.tap(a.el, a.keys());
    const t1 = fakeTransition();
    zoom.onRouterTransition(t1.info, '/lab/my-work', '/lab/sample/s1');
    t1.finish(); await flush();
    expect(zoom.onRouterTransition(fakeTransition().info, '/lab/sample/s1', '/pathologist')).toBe(false);
    expect(zoom.onRouterTransition(fakeTransition().info, '/pathologist', '/lab/my-work')).toBe(false);
  });
});
