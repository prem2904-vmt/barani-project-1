import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';

/**
 * DB optimisation phase 3 — the day feed is the SUMMARY view (no line results,
 * no test parameters), so the order drawer's "Preliminary report" reads the
 * order by id when it opens, and shows exactly what it showed from the feed.
 */
const DIR = 'apps/lms/src/app/features/frontdesk/frontdesk-landing';
const html = readFileSync(`${DIR}/frontdesk-landing.component.html`, 'utf8');
const ts = readFileSync(`${DIR}/frontdesk-landing.component.ts`, 'utf8');
const proto = FrontdeskLandingComponent.prototype as any;

const RESULT = JSON.stringify({ values: { hb: '18' }, flagged: { hb: { flag: 'H', range: '12–15' } } });
const PARAMS = JSON.stringify({ parameters: [{ name: 'hb', title: 'Haemoglobin', unit: 'g/dL' }] });
const summaryOrder = (id: string, validated: boolean) => ({
  id, samples: [{ id: `${id}-s1`, status: 'received', department: { id: 'd1', name: 'Haematology', code: 'HAE' },
    tests: [{ id: `${id}-t1`, status: validated ? 'validated' : 'entered', test: { name: 'CBC' } }] }],
});
const fullOrder = (id: string) => ({
  id, samples: [{ id: `${id}-s1`, status: 'received', department: { id: 'd1', name: 'Haematology', code: 'HAE' },
    tests: [{ id: `${id}-t1`, status: 'validated', currentResult: RESULT, test: { name: 'CBC', parameters: PARAMS } }] }],
});

function harness(respond: (url: string) => unknown = url => of(fullOrder(url.split('/').pop()!))) {
  const h = Object.create(proto);
  const get = vi.fn(respond);
  Object.assign(h, {
    api: { get },
    sampleIdsOpen: signal(false),
    _selectedOrder: signal(null),
    _drawerDetail: signal(null),
  });
  return { h, get };
}

describe('Front desk — the day feed is the summary view', () => {
  it('today and range ask for ?view=summary', () => {
    expect(ts).toMatch(/\/api\/orders\/today\?view=summary/);
    expect(ts).toMatch(/params\.set\('view', 'summary'\);\s*\n\s*this\.api\.get<Order\[\]>\(`\/api\/orders\/range\?\$\{params\}`\)/);
  });

  it('the drawer\'s Preliminary panel reads the by-id order (drawerPrelim), never the feed row', () => {
    const prelim = html.slice(html.indexOf('<section class="pf-prelim">') - 60, html.indexOf('<section class="pf-prelim">') + 900);
    expect(prelim).toMatch(/@if \(drawerPrelim\(\)\.length > 0\)/);
    expect(prelim).toMatch(/@for \(vs of drawerPrelim\(\); track vs\.id\)/);
    expect(html).not.toMatch(/validatedSamples\(so\)/);
  });
});

describe('Front desk — order drawer preliminary values', () => {
  it('opening an order with a validated tube reads it by id; the values come from that read', () => {
    const { h, get } = harness();
    h.openOrder(summaryOrder('o1', true));
    expect(get).toHaveBeenCalledWith('/api/orders/o1');
    const d = h._drawerDetail();
    expect(d.id).toBe('o1');
    const rows = h.validatedSamples(d);
    expect(rows).toHaveLength(1);
    expect(rows[0].tests[0].values).toEqual([
      expect.objectContaining({ name: 'hb', title: 'Haemoglobin', value: '18', unit: 'g/dL', range: '12–15 g/dL', flag: 'abnormal', code: 'H' }),
    ]);
    // The summary row alone has no values to show.
    expect(h.validatedSamples(summaryOrder('o1', true))[0].tests[0].values).toEqual([]);
  });

  it('no validated tube → no read (the panel has nothing to show)', () => {
    const { h, get } = harness();
    h.openOrder(summaryOrder('o2', false));
    expect(get).not.toHaveBeenCalled();
    expect(h._drawerDetail()).toBeNull();
  });

  it('a late answer for a drawer the user already switched away from is dropped', () => {
    const pending = new Subject<unknown>();
    const { h } = harness(url => (url.endsWith('/o1') ? pending : of(fullOrder('o3'))));
    h.openOrder(summaryOrder('o1', true));
    h.openOrder(summaryOrder('o3', true));
    expect(h._drawerDetail().id).toBe('o3');
    pending.next(fullOrder('o1'));
    expect(h._drawerDetail().id).toBe('o3');
  });
});
