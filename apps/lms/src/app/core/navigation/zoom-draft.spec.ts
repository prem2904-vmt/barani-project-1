import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZOOM_IN_CLASS, ZOOM_NAME, ZOOM_OUT_CLASS, ZoomEndpoint, ZoomTransitionService, isZoomDetail } from './zoom-transition';

/**
 * Draft open / close (owner, 2026-09-27: "when I click a draft and open /
 * close it, I need an animation there"). A parked draft (front-desk row or
 * app-bar shelf chip) ZOOMS into Order & Payments and back reverses it; focus
 * follows the motion (the order body on open, the draft row on close).
 */
function fakeTransition() {
  let doneUpdate!: () => void, finish!: () => void;
  const transition = {
    updateCallbackDone: new Promise<void>(r => (doneUpdate = r)),
    ready: new Promise<void>(() => undefined),
    finished: new Promise<void>(r => (finish = r)),
    skipTransition: vi.fn(),
  };
  return { info: { transition }, doneUpdate, finish };
}
const flush = () => new Promise(r => setTimeout(r, 0));
const vtName = (el: HTMLElement) => el.style.getPropertyValue('view-transition-name');
const read = (p: string) => readFileSync(resolve(process.cwd(), 'apps/lms/src/app', p), 'utf8');

describe('draft open / close — zoom', () => {
  let zoom: ZoomTransitionService;
  const made: HTMLElement[] = [];
  const mk = (keys: string[], tag = 'div'): ZoomEndpoint & { el: HTMLElement } => {
    const el = document.createElement(tag);
    document.body.appendChild(el);
    made.push(el);
    return { el, keys: () => keys };
  };

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
    });
    zoom = TestBed.inject(ZoomTransitionService);
    zoom._reset();
    let clock = 1000;
    zoom.now = () => clock++;
    zoom.doc = document;
  });
  afterEach(() => {
    made.splice(0).forEach(e => e.remove());
    document.documentElement.className = '';
    vi.restoreAllMocks();
  });

  it('Order & Payments is a zoom destination (only a TAPPED source zooms, so "New order" stays instant)', () => {
    expect(isZoomDetail('/frontdesk/order?patientId=p1')).toBe(true);
    expect(isZoomDetail('/frontdesk/order')).toBe(true);
    expect(isZoomDetail('/frontdesk')).toBe(false);
    const { info } = fakeTransition();
    expect(zoom.onRouterTransition(info, '/frontdesk', '/frontdesk/order')).toBe(false);   // no tap
  });

  it('OPEN: the tapped draft row morphs into the order body, which then takes focus', async () => {
    const row = mk(['p1', 'fd:p1']);
    zoom.attachSource(row);
    zoom.tap(row.el, row.keys());
    const t = fakeTransition();
    expect(zoom.onRouterTransition(t.info, '/frontdesk', '/frontdesk/order?patientId=p1')).toBe(true);
    expect(document.documentElement.classList).toContain(ZOOM_IN_CLASS);
    expect(zoom.holding()).toBe(true);                    // skeleton held through the morph
    row.el.remove(); zoom.detachSource(row);
    const body = mk(['p1', 'fd:p1']);
    zoom.attachTarget(body);
    expect(vtName(body.el)).toBe(ZOOM_NAME);
    t.doneUpdate(); await flush();
    t.finish(); await flush();
    expect(zoom.holding()).toBe(false);
    expect(document.activeElement).toBe(body.el);         // focus follows the open
    expect(body.el.getAttribute('tabindex')).toBe('-1');
  });

  it('CLOSE: back to the front desk shrinks into the draft row and returns focus to it', async () => {
    const row = mk(['p1', 'fd:p1']);
    row.el.setAttribute('tabindex', '0');
    zoom.attachSource(row);
    zoom.tap(row.el, row.keys());
    const t1 = fakeTransition();
    zoom.onRouterTransition(t1.info, '/frontdesk', '/frontdesk/order?patientId=p1');
    row.el.remove(); zoom.detachSource(row);
    const body = mk(['p1', 'fd:p1']);
    zoom.attachTarget(body);
    t1.doneUpdate(); t1.finish(); await flush();

    const t2 = fakeTransition();
    expect(zoom.onRouterTransition(t2.info, '/frontdesk/order?patientId=p1', '/frontdesk')).toBe(true);
    expect(document.documentElement.classList).toContain(ZOOM_OUT_CLASS);
    body.el.remove(); zoom.detachTarget(body);
    const back = mk(['p1', 'fd:p1']);
    back.el.setAttribute('tabindex', '0');
    zoom.attachSource(back);
    expect(vtName(back.el)).toBe(ZOOM_NAME);
    t2.doneUpdate(); t2.finish(); await flush();
    expect(document.activeElement).toBe(back.el);
  });

  it('never steals focus from a field the screen focused itself', async () => {
    const row = mk(['p1']);
    zoom.attachSource(row);
    zoom.tap(row.el, row.keys());
    const t = fakeTransition();
    zoom.onRouterTransition(t.info, '/frontdesk', '/frontdesk/order?patientId=p1');
    row.el.remove(); zoom.detachSource(row);
    const body = mk(['p1']);
    zoom.attachTarget(body);
    const input = mk([], 'input');
    input.el.focus();
    t.doneUpdate(); t.finish(); await flush();
    expect(document.activeElement).toBe(input.el);
  });

  it('the draft row and the shelf chips are zoom sources; the order body is the target', () => {
    expect(read('features/frontdesk/frontdesk-landing/frontdesk-landing.component.html'))
      .toMatch(/pf-wrow--draft"[^>]*\[pfZoomSource\]="\[d\.patientId, 'fd:' \+ d\.patientId\]"/);
    const strip = read('layout/top-strip/top-strip.component.html');
    expect(strip).toMatch(/pf-draftshelf__chip[^>]*\[pfZoomSource\]="on \? null : chipZoomKeys\(d\)"/);
    expect(strip).toMatch(/pf-draftshelf__pop-item[^>]*\[pfZoomSource\]="on \? null : chipZoomKeys\(d\)"/);
    expect(read('features/frontdesk/order-create/order-create.component.html'))
      .toMatch(/pf-oc-body"[^>]*\s+\[pfZoomTarget\]="zoomKeys\(\)"/);
  });
});
