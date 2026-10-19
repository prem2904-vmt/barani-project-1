import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { Order } from '../../../shared/models/order.model';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';
import { drawerPipeline, drawerStepCaption } from './order-drawer';
import { canBulkDispatch, canRecollect, createWorkSelection, workRowTone } from './work-selection';

/**
 * QA #6 (ii) — after "Can't collect" the Frontdesk row still offered
 * "Collect" and the order drawer's timeline read "Dispatch".
 *
 * State model: a not-collected tube (status 'rejected', no collectedAt) is a
 * SINK. The row reads "Not collected — <reason>" in red and offers Recollect
 * (never Collect / Dispatch); the drawer's Sample step STOPS with
 * "Not collected (<reason>)"; it's never counted as drawn, dispatched or
 * dispatchable. Partial orders keep the drawn tubes' own progress.
 */

type S = { id: string; status: string; collectedAt?: string; rejectedReason?: string; tests?: Array<{ status: string }> };
const order = (status: string, samples: S[]): Order =>
  ({ id: 'o1', status, paymentHold: false, samples, createdAt: '2026-09-27T08:00:00Z' } as unknown as Order);
const drawn = (id: string, status = 'collected'): S => ({ id, status, collectedAt: '2026-09-27T08:05:00Z', tests: [{ status: 'pending' }] });
const notCollected = (id: string, reason = 'Patient refused'): S => ({ id, status: 'rejected', rejectedReason: reason, tests: [{ status: 'rejected' }] });

const proto = FrontdeskLandingComponent.prototype as any;
function fd(perms: string[] = ['collect_sample', 'dispatch_sample'], extra: Record<string, unknown> = {}) {
  const h = Object.create(proto);
  Object.assign(h, {
    auth: { hasPermission: (p: string) => perms.includes(p) },
    labCfg: { collectsAtFrontdesk: () => true, billingMode: () => 'front_desk' },
    ...extra,
  });
  return h;
}

describe('Frontdesk row — not-collected status (QA #6)', () => {
  it('a single not-collected tube reads "Not collected — <reason>" in red, not Rejected / Dispatched', () => {
    const o = order('rejected', [notCollected('a', 'Patient refused — anxious')]);
    const c = fd();
    expect(c.effectiveStatusLabel(o)).toBe('Not collected — Patient refused');
    expect(c.rowTone(o)).toBe('red');
  });

  it('partial: one drawn + one not collected reads "1 of 2 not collected — reason"', () => {
    const o = order('partially_rejected', [drawn('a'), notCollected('b', 'Vein not found')]);
    const c = fd();
    expect(c.effectiveStatusLabel(o)).toBe('1 of 2 not collected — Vein not found');
    expect(c.rowTone(o)).toBe('red');
  });

  it('even a stale rollup ("dispatched" from before the fix) never reads Dispatched', () => {
    const o = order('dispatched', [drawn('a', 'dispatched'), notCollected('b')]);
    expect(fd().effectiveStatusLabel(o)).toBe('1 of 2 not collected — Patient refused');
  });

  it('the drawer header chip stays short (the timeline carries count + reason)', () => {
    const c = fd();
    expect(c.drawerStatusLabel(order('partially_rejected', [drawn('a'), notCollected('b')]))).toBe('Not collected');
    expect(c.drawerStatusLabel(order('sample_collected', [drawn('a')]))).toBe('Sample Collected');
  });

  it('the row offers Recollect — never Collect or Dispatch', () => {
    const c = fd();
    const all = order('rejected', [notCollected('a')]);
    expect(c.showRecollectOn(all)).toBe(true);
    expect(c.showCollectOn(all)).toBe(false);
    expect(c.sampleStatus(all)).toBe('pending');          // nothing drawn
    expect(c.showDispatchOn(all)).toBe(false);

    const partial = order('partially_rejected', [drawn('a'), notCollected('b')]);
    expect(c.showRecollectOn(partial)).toBe(true);
    // Used to be 'partially_collected' → the row re-offered Collect.
    expect(c.sampleStatus(partial)).toBe('fully_collected');
    expect(c.showDispatchOn(partial)).toBe(false);
  });

  it('Recollect needs collect_sample and a live order', () => {
    expect(fd(['dispatch_sample']).showRecollectOn(order('rejected', [notCollected('a')]))).toBe(false);
    expect(canRecollect(order('cancelled', [notCollected('a')]))).toBe(false);
    expect(canRecollect(order('billed', [drawn('a')]))).toBe(false);
    // A drawn tube the lab rejected is NOT "not collected".
    expect(canRecollect(order('rejected', [{ id: 'x', status: 'rejected', collectedAt: 't' }]))).toBe(false);
  });

  it('the template puts Recollect first in the action slot (before Collect / Dispatch)', () => {
    const html = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.html', 'utf8');
    const a = html.indexOf('@if (showRecollectOn(o))');
    const b = html.indexOf("} @else if (sampleStatus(o) === 'partially_collected' || showCollectOn(o))");
    const d = html.indexOf('} @else if (showDispatchOn(o))');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(d).toBeGreaterThan(b);
  });

  it('a not-collected tube never makes a row dispatchable', () => {
    expect(canBulkDispatch(order('rejected', [notCollected('a')]))).toBe(false);
    expect(canBulkDispatch(order('partially_rejected', [drawn('a'), notCollected('b')]))).toBe(true); // the drawn one can go
    const rows = signal([order('rejected', [notCollected('a')])]);
    expect(createWorkSelection(rows).selectable()).toEqual([]);
  });

  it('tone: partially_rejected is red; the label wins over a stale status', () => {
    expect(workRowTone('partially_rejected')).toBe('red');
    expect(workRowTone('dispatched', 'Not collected — Patient refused')).toBe('red');
    expect(workRowTone('dispatched', 'Dispatched')).toBe('blue');
  });
});

describe('Frontdesk row — Recollect action', () => {
  it('reopens every not-collected tube, toasts, and goes to collect', async () => {
    const patch = vi.fn(() => of({}));
    const toasts = { success: vi.fn(), error: vi.fn() };
    const router = { navigate: vi.fn() };
    const c = fd(undefined, { api: { patch }, toasts, router, _recollecting: signal<string | null>(null), fetchOrdersWithEtag: vi.fn() });
    await c.recollectOrder(order('partially_rejected', [drawn('a'), notCollected('b'), notCollected('c')]));
    expect(patch.mock.calls.map(([u]: any) => u)).toEqual(['/api/samples/b/recollect', '/api/samples/c/recollect']);
    expect(toasts.success).toHaveBeenCalledWith('2 tubes back in the collection queue');
    expect(router.navigate).toHaveBeenCalledWith(['/lab/collect'], { queryParams: { orderId: 'o1' } });
  });

  it('a dedicated collection counter: stays on the desk and refreshes', async () => {
    const fetch = vi.fn();
    const router = { navigate: vi.fn() };
    const c = fd(undefined, {
      api: { patch: vi.fn(() => of({})) }, toasts: { success: vi.fn(), error: vi.fn() }, router,
      labCfg: { collectsAtFrontdesk: () => false }, _recollecting: signal<string | null>(null), fetchOrdersWithEtag: fetch,
    });
    await c.recollectOrder(order('rejected', [notCollected('a')]));
    expect(router.navigate).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
  });

  it('a server refusal is surfaced and nothing navigates', async () => {
    const router = { navigate: vi.fn() };
    const toasts = { success: vi.fn(), error: vi.fn() };
    const c = fd(undefined, {
      api: { patch: vi.fn(() => throwError(() => ({ error: { message: 'Only a tube marked not collected can be recollected.' } }))) },
      toasts, router, _recollecting: signal<string | null>(null), fetchOrdersWithEtag: vi.fn(),
    });
    await c.recollectOrder(order('rejected', [notCollected('a')]));
    expect(toasts.error).toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('Order drawer timeline — "Sample — not collected (reason)", never Dispatch', () => {
  it('every tube not collected: Sample stops with the reason, Dispatch stays pending', () => {
    const o = order('rejected', [notCollected('a', 'Patient refused')]);
    const steps = drawerPipeline(o);
    const sample = steps.find(s => s.label === 'Sample')!;
    const dispatch = steps.find(s => s.label === 'Dispatch')!;
    expect(sample.state).toBe('stopped');
    expect(drawerStepCaption(o, sample)).toBe('Not collected (Patient refused)');
    expect(dispatch.state).toBe('pending');
    expect(steps.find(s => s.label === 'Result')!.state).toBe('pending');
  });

  it('partial: the not-collected stop shows the count; the drawn tube keeps its own progress', () => {
    const o = order('partially_rejected', [drawn('a'), notCollected('b', 'Vein not found')]);
    const steps = drawerPipeline(o);
    const sample = steps.find(s => s.label === 'Sample')!;
    expect(sample.state).toBe('stopped');
    expect(drawerStepCaption(o, sample)).toBe('1 of 2 not collected (Vein not found)');
    expect(steps.find(s => s.label === 'Dispatch')!.state).toBe('active'); // the drawn tube awaits dispatch
    const result = steps.find(s => s.label === 'Result')!;
    expect(drawerStepCaption(o, { ...result, state: 'active' })).toBe('0/1 tests resulted'); // voided tests don't count
  });

  it('a normal order is unchanged', () => {
    const o = order('dispatched', [drawn('a', 'dispatched')]);
    const steps = drawerPipeline(o);
    expect(steps.map(s => s.state)).toEqual(['done', 'done', 'done', 'pending', 'pending']);
    expect(drawerStepCaption(o, steps[1])).toBe('0/1 received at lab');
  });

  it('the drawer template renders a stopped node with an ✕ and styles it', () => {
    const html = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.html', 'utf8');
    expect(html).toMatch(/@else if \(step\.state === 'stopped'\)/);
    const css = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/styles/_drawers-modals.scss', 'utf8');
    expect(css).toMatch(/\.pf-vtl__row\[data-state='stopped'\] \.pf-vtl__node/);
  });
});
