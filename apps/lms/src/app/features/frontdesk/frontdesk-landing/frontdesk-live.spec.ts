import { signal } from '@angular/core';
import { EMPTY, Subject } from 'rxjs';
import { vi } from 'vitest';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';

/**
 * Live work screens — Front desk. The landing's lists (appointments, Today's
 * Orders, payments due, counts) follow the branch's work events instead of a
 * 30 s network poll; the subscription dies with the screen.
 */
const proto = FrontdeskLandingComponent.prototype as any;

function landing() {
  const live = new Subject<unknown>();
  const on = vi.fn(() => live.asObservable());
  const destroyers: Array<() => void> = [];
  const h = Object.create(proto);
  Object.assign(h, {
    labCfg: { ensureLoaded: vi.fn() },
    process: { refreshActive: vi.fn() },
    auth: { user: signal({ permissions: [] }) },
    route: { queryParamMap: EMPTY },
    destroyRef: { onDestroy: (fn: () => void) => { destroyers.push(fn); return () => undefined; }, destroyed: false },
    work: { on },
    refresh: vi.fn(),
    refreshDrafts: vi.fn(),
  });
  return { h, live, on, destroy: () => destroyers.forEach(fn => fn()) };
}

describe('Front desk landing — live work events', () => {
  afterEach(() => vi.useRealTimers());

  it('subscribes to the front-desk lists and refetches on a work event (no 30 s poll)', () => {
    vi.useFakeTimers();
    const t = landing();
    t.h.ngOnInit();
    expect(t.on).toHaveBeenCalledWith('frontdesk', 'collection', 'billing', 'appointments', 'reports', 'receive');
    expect(t.h.refresh).toHaveBeenCalledTimes(1);           // initial load

    vi.advanceTimersByTime(90_000);
    expect(t.h.refresh).toHaveBeenCalledTimes(1);           // nothing on a timer

    t.live.next({ reason: 'event' });
    expect(t.h.refresh).toHaveBeenCalledTimes(2);
  });

  it('stops listening when the screen is destroyed', () => {
    const t = landing();
    t.h.ngOnInit();
    t.destroy();
    t.live.next({ reason: 'event' });
    expect(t.h.refresh).toHaveBeenCalledTimes(1);
  });
});
