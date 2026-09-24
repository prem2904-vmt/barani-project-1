import { renderBandPage } from './admin-band.spec-helpers';
import { FinanceHubComponent } from '../finance/finance-hub.component';

/**
 * Hub-linked pages outside /admin (owner counts them as admin nested pages):
 * Finance, Daily statement, TAT board, Printing, My signature — each gets the
 * band: filters/switches in the pill, primary actions on the band.
 */
const segBtn = (root: HTMLElement | null, label: string) =>
  Array.from(root?.querySelectorAll<HTMLButtonElement>('pf-segmented button') ?? [])
    .find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === label);

describe('Admin band — Finance hub (/finance)', () => {
  const summary = {
    from: '2026-09-01', to: '2026-09-25',
    moneyIn: { totalCollected: 1000, totalRefunded: 0, netCollected: 1000, byMode: [{ mode: 'cash', count: 2, total: 1000 }], refundsByMode: [] },
    billed: { grossBilled: 1200, totalDiscount: 200, totalTax: 0, count: 2 },
    moneyOut: { inventorySpend: 100, batchCount: 1 },
    outstanding: 50, netPosition: 900,
  };
  const vendors = [
    { id: 'v1', name: 'City Hospital', code: 'CITY', outstanding: 500, usedCredit: 500, totalCredit: 0, isActive: true },
    { id: 'v2', name: 'Apollo Clinic', code: 'APL', outstanding: 0, usedCredit: 0, totalCredit: 0, isActive: true },
  ];
  const make = () => renderBandPage(FinanceHubComponent, {
    getFor: (url) => url.startsWith('/api/finance/summary') ? summary : url.startsWith('/api/vendors?') ? vendors : [],
  });

  it('band + body, header classic-only; Lab line is a tabs-only pill (no search) with the date range', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.body()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.bandInput()).toBeNull();
    expect(p.tools()!.querySelectorAll('input[type="date"]').length).toBe(2);
    expect(p.actions().map((b) => b.textContent!.trim())).toEqual(['Download CSV']);
  });

  it('quick range in the pill reloads the summary for that window', () => {
    const p = make();
    p.api.get.mockClear();
    segBtn(p.tools(), '7d')!.click();
    p.f.detectChanges();
    const url = p.api.get.mock.calls.at(-1)![0] as string;
    expect(url).toContain('/api/finance/summary?from=');
    expect(p.cmp.quickDays()).toBe(7);
  });

  it('Credit Wallet in the pill switch loads partners and the pill search filters them', () => {
    const p = make();
    segBtn(p.tools(), 'Credit Wallet')!.click();
    p.f.detectChanges();
    expect(p.bandInput()).not.toBeNull();
    const names = () => Array.from(p.body()!.querySelectorAll('.pf-fin__vname')).map((e) => e.textContent!.trim());
    expect(names().length).toBe(2);
    p.type('apollo');
    expect(names()).toEqual([expect.stringContaining('Apollo Clinic')]);
    p.type('zzz');
    expect(names().length).toBe(0);
    expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
  });
});
