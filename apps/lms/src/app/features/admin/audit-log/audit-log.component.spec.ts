import { renderBandPage } from '../admin-band.spec-helpers';
import { AuditLogComponent, areaCounts, auditQuery, AuditFilters } from './audit-log.component';
import { istDayRange } from '../../../shared/utils/lab-clock';

/**
 * Audit trail v2 (owner-approved 2026-11-19): two-panel frame (SHOW side card +
 * ACTIVITY timeline), human sentences, IDs never on screen, rows of one moment
 * merged, filters that apply at once.
 */
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ORDER = '11111111-1111-4111-8111-111111111111';
const SAMPLE = '22222222-2222-4222-8222-222222222222';
const USER = '55555555-5555-4555-8555-555555555555';
const now = new Date();
const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString();

const PAGE = {
  items: [
    { id: 'r1', entityType: 'OrderEntity', entityId: ORDER, action: 'update', userId: USER, userName: 'admin', at: iso(1),
      changes: JSON.stringify({ status: { old: 'collected', new: 'billed' }, updatedAt: { old: 'a', new: 'b' } }) },
    { id: 'r2', entityType: 'OrderSampleEntity', entityId: SAMPLE, action: 'update', userId: USER, userName: 'admin', at: iso(1),
      changes: JSON.stringify({ status: { old: 'collected', new: 'billed' } }) },
    { id: 'r3', entityType: 'TestEntity', entityId: 'gone', action: 'delete', userId: USER, userName: 'admin', at: iso(30),
      changes: JSON.stringify({ name: 'Vitamin D (25-OH)', price: 1200, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) },
  ],
  total: 3, page: 1, pageSize: 50,
  refs: {
    [ORDER]: { kind: 'order', label: 'LAB-2611-000016', orderId: ORDER, patient: 'Mr. Kumar Prem' },
    [SAMPLE]: { kind: 'sample', label: 'S-0042', orderId: ORDER },
    [USER]: { kind: 'user', label: 'Admin User' },
  },
};
const FACETS = {
  types: [{ entityType: 'OrderEntity', count: 10 }, { entityType: 'BillEntity', count: 4 }, { entityType: 'OrderSampleEntity', count: 9 },
          { entityType: 'TestEntity', count: 6 }, { entityType: 'MysteryEntity', count: 2 }],
  users: [{ userId: USER, name: 'Admin User', count: 31 }],
  total: 31,
};

const make = () => renderBandPage(AuditLogComponent, {
  getFor: u => (u.startsWith('/api/audit/logs') ? PAGE : u.startsWith('/api/audit/facets') ? FACETS : []),
});
const logUrls = (p: ReturnType<typeof make>) => p.api.get.mock.calls.map(c => String(c[0])).filter(u => u.startsWith('/api/audit/logs'));
const lastLogUrl = (p: ReturnType<typeof make>) => new URL('http://x' + logUrls(p).at(-1)!);

describe('Audit trail v2 — frame', () => {
  it('band (search + Export only), SHOW side card on the left, ACTIVITY card; no native controls', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()!.placeholder).toBe('Search a person, patient, order number or test…');
    expect(p.actions().map(b => b.textContent?.trim())).toEqual(['Export']);
    const side = p.el.querySelector('[data-testid="audit-side"]')!;
    expect(side.querySelector('.pf-card__label')!.textContent).toBe('Show');
    expect(side.querySelectorAll('[data-testid="audit-when"] [role="radio"]').length).toBe(4);
    expect(Array.from(side.querySelectorAll('[data-testid="audit-areas"] .pf-side-item .pf-au__arealbl')).map(e => e.textContent))
      .toEqual(['Everything', 'Orders & billing', 'Samples', 'Results & reports', 'Test Master', 'Settings', 'People & access']);
    expect(side.querySelector('pf-select[data-testid="audit-who"]')).not.toBeNull();
    expect(p.el.querySelector('[data-testid="audit-activity"] .pf-card__label')!.textContent).toBe('Activity');
    expect(p.el.querySelector('select, datalist, input[type="date"]:not([aria-hidden="true"])')).toBeNull();
  });

  it('area counts fold the facet types; Everything is the total', () => {
    const p = make();
    const n = (k: string) => p.el.querySelector(`[data-area="${k}"] .pf-au__n`)!.textContent!.trim();
    expect(n('all')).toBe('31');
    expect(n('orders')).toBe('14');
    expect(n('samples')).toBe('9');
    expect(n('tm')).toBe('6');
    expect(n('people')).toBe('0');
  });
});

describe('Audit trail v2 — timeline', () => {
  it('human sentences, grouped by day, rows of one moment merged, no id on screen', () => {
    const p = make();
    const text = p.el.querySelector('[data-testid="audit-activity"]')!.textContent!;
    expect(text).not.toMatch(GUID);
    const events = p.el.querySelectorAll('[data-testid="audit-event"]');
    expect(events.length).toBe(2);   // the order + its sample collapse into one
    expect(events[0].querySelector('.pf-au__text')!.textContent!.replace(/\s+/g, ' ').trim())
      .toBe('Admin User billed order LAB-2611-000016 for Mr. Kumar Prem');
    expect(events[1].querySelector('.pf-au__verb')!.classList.contains('is-danger')).toBe(true);
    expect(p.el.querySelector('[data-testid="audit-day"]')!.textContent).toMatch(/Today|Yesterday/);
    expect(events[0].querySelector('[data-testid="audit-area"]')!.textContent!.trim()).toBe('Orders & billing');
  });

  it('expand shows friendly changes, the link, "Also updated", and Technical details only on demand', () => {
    const p = make();
    (p.el.querySelector('[data-testid="audit-event"] .pf-au__row') as HTMLButtonElement).click();
    p.f.detectChanges();
    const detail = p.el.querySelector('[data-testid="audit-detail"]')!;
    const change = detail.querySelector('[data-testid="audit-change"]')!;
    expect(change.querySelector('dt')!.textContent).toBe('Status');
    expect(change.querySelector('.pf-au__from')!.textContent).toBe('Sample collected');
    expect(change.querySelector('.pf-au__to')!.textContent).toBe('Billed');
    expect(detail.querySelectorAll('[data-testid="audit-change"]').length).toBe(1);   // updatedAt hidden
    expect(detail.querySelector('[data-testid="audit-open"]')!.getAttribute('href')).toBe(`/o/${ORDER}`);
    expect(detail.querySelector('[data-testid="audit-also"]')!.textContent).toContain('1 sample');
    expect(detail.textContent).not.toMatch(GUID);
    expect(detail.querySelector('[data-testid="audit-raw"]')).toBeNull();
    (detail.querySelector('[data-testid="audit-tech"]') as HTMLButtonElement).click();
    p.f.detectChanges();
    expect(p.el.querySelector('[data-testid="audit-raw"]')!.textContent).toContain(ORDER);   // support view only
  });
});

describe('Audit trail v2 — filters', () => {
  const base: AuditFilters = { range: '7d', from: '', to: '', area: '', userId: '', q: '' };

  it('the query: IST window, area → entity types, person, search (2+ chars), paging', () => {
    const q = auditQuery({ ...base, area: 'samples', userId: USER, q: ' LAB-26 ' }, 2, 50, '2026-11-19');
    const win = istDayRange('2026-11-13', '2026-11-19');
    expect(q.get('from')).toBe(win.from);
    expect(q.get('to')).toBe(win.to);
    expect(q.get('entityTypes')!.split(',')).toEqual(expect.arrayContaining(['OrderSampleEntity']));
    expect(q.get('userId')).toBe(USER);
    expect(q.get('q')).toBe('LAB-26');
    expect(q.get('page')).toBe('2');
    expect(auditQuery({ ...base, q: 'a' }, 1, 50, '2026-11-19').has('q')).toBe(false);
    const today = auditQuery({ ...base, range: 'today' }, 1, 50, '2026-11-19');
    expect(today.get('from')).toBe(istDayRange('2026-11-19').from);
    const custom = auditQuery({ ...base, range: 'custom', from: '2026-10-01', to: '2026-10-05' }, 1, 50, '2026-11-19');
    expect(custom.get('to')).toBe(istDayRange('2026-10-01', '2026-10-05').to);
  });

  it('area counts with no facets are zeros', () => {
    expect(areaCounts(null)).toEqual({ all: 0, orders: 0, samples: 0, results: 0, tm: 0, settings: 0, people: 0 });
  });

  it('every choice reloads at once with enrich=true; an area keeps the counts (no facet reload)', () => {
    const p = make();
    expect(lastLogUrl(p).searchParams.get('enrich')).toBe('true');
    const facetCalls = () => p.api.get.mock.calls.filter(c => String(c[0]).startsWith('/api/audit/facets')).length;
    const f0 = facetCalls();
    (p.el.querySelector('[data-area="tm"]') as HTMLButtonElement).click();
    p.f.detectChanges();
    expect(lastLogUrl(p).searchParams.get('entityTypes')).toContain('TestEntity');
    expect(facetCalls()).toBe(f0);
    expect(p.el.querySelector('[data-area="tm"]')!.getAttribute('aria-selected')).toBe('true');
    const radios = p.el.querySelectorAll<HTMLButtonElement>('[data-testid="audit-when"] [role="radio"]');
    radios[0].click();
    p.f.detectChanges();
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(facetCalls()).toBe(f0 + 1);
    p.cmp.setUser(USER);
    expect(lastLogUrl(p).searchParams.get('userId')).toBe(USER);
  });

  it('search: Enter reloads with q', () => {
    const p = make();
    p.type('Kumar');
    p.bandInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(lastLogUrl(p).searchParams.get('q')).toBe('Kumar');
  });

  it('infinite scroll asks for the next page and appends', () => {
    const p = make();
    p.cmp.total.set(120);
    p.cmp.loadMore();
    expect(lastLogUrl(p).searchParams.get('page')).toBe('2');
  });
});
