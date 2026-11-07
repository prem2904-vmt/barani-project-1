import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouteReuseStrategy, Router, provideRouter } from '@angular/router';
import { IdentityRouteReuseStrategy, ORDER_PAY_RECREATE_ON } from './identity-reuse.strategy';

const created: string[] = [];
@Component({ template: '' })
class Screen {
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  constructor() { created.push(this.id); }
}

async function setup() {
  created.length = 0;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'keyed/:id', component: Screen, data: { recreateOn: ['id', '?stage'] } },
        { path: 'order', component: Screen, data: { recreateOn: ORDER_PAY_RECREATE_ON } },
        { path: 'plain/:id', component: Screen },
      ]),
      { provide: RouteReuseStrategy, useClass: IdentityRouteReuseStrategy },
    ],
  });
  const { RouterTestingHarness } = await import('@angular/router/testing');
  const harness = await RouterTestingHarness.create();
  return { harness, router: TestBed.inject(Router) };
}

describe('IdentityRouteReuseStrategy (record screens that read their id once)', () => {
  it('a keyed route gets a FRESH screen when its record changes — the snapshot id is the new one', async () => {
    const { harness } = await setup();
    const a = await harness.navigateByUrl('/keyed/A', Screen);
    const b = await harness.navigateByUrl('/keyed/B', Screen);
    expect(b).not.toBe(a);
    expect(b.id).toBe('B');
    expect(created).toEqual(['A', 'B']);
  });

  it('a keyed query param counts too; the same identity (or an unkeyed query) reuses', async () => {
    const { harness } = await setup();
    const a = await harness.navigateByUrl('/keyed/A?stage=gram', Screen);
    expect(await harness.navigateByUrl('/keyed/A?stage=gram&x=1', Screen)).toBe(a);
    expect(await harness.navigateByUrl('/keyed/A?stage=ast', Screen)).not.toBe(a);
  });

  it('routes without the key keep Angular’s default reuse', async () => {
    const { harness } = await setup();
    const a = await harness.navigateByUrl('/plain/A', Screen);
    const b = await harness.navigateByUrl('/plain/B', Screen);
    expect(b).toBe(a);
    expect(created).toEqual(['A']);
  });

  it('OPS-113: Modify -> Save (?editOrderId=X -> ?orderId=X on /order) rebuilds the screen; a patient swap stays in place', async () => {
    const { harness } = await setup();
    const edit = await harness.navigateByUrl('/order?editOrderId=X', Screen);
    const pay = await harness.navigateByUrl('/order?orderId=X', Screen);
    expect(pay).not.toBe(edit);
    // same bill again (discount param etc.) -> reused
    expect(await harness.navigateByUrl('/order?orderId=X&discount=10', Screen)).toBe(pay);
    // draft shelf: patient A -> patient B, no record id -> reused (swapped in place)
    const a = await harness.navigateByUrl('/order?patientId=A', Screen);
    expect(await harness.navigateByUrl('/order?patientId=B', Screen)).toBe(a);
  });
});
