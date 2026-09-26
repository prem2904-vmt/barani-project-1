import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouteReuseStrategy, Router, provideRouter } from '@angular/router';
import { IdentityRouteReuseStrategy } from './identity-reuse.strategy';

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
});
