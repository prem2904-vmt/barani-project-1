import { FinanceHubComponent } from './finance-hub.component';
import { renderBandPage } from '../admin/admin-band.spec-helpers';

/** From/To date range (band pill + classic card) used native
 *  `<input type="date">` — now `pf-nd-date` everywhere, same ISO strings
 *  fed to `/api/finance/summary?from=…&to=…`. */
describe('Finance hub — date range (no native date input)', () => {
  const summary = {
    from: '2026-09-01', to: '2026-09-25',
    moneyIn: { totalCollected: 0, totalRefunded: 0, netCollected: 0, byMode: [], refundsByMode: [] },
    billed: { grossBilled: 0, totalDiscount: 0, totalTax: 0, count: 0 },
    moneyOut: { inventorySpend: 0, batchCount: 0 },
    outstanding: 0, netPosition: 0,
  };
  const make = () => renderBandPage(FinanceHubComponent, {
    getFor: (url) => (url.startsWith('/api/finance/summary') ? summary : []),
  });

  it('band pill: two pf-nd-date fields, never a visible native date input', () => {
    const p = make();
    const tools = p.tools()!;
    expect(tools.querySelectorAll('pf-nd-date').length).toBe(2);
    expect(tools.querySelector('input[type="date"]:not([aria-hidden="true"])')).toBeNull();
  });

  it('typing a From date in the pill updates fromDate and leaves the quick-range chips (customRange)', () => {
    const p = make();
    const txt = p.tools()!.querySelectorAll<HTMLInputElement>('pf-nd-date input[type="text"]')[0];
    txt.value = '01092026';
    txt.dispatchEvent(new Event('input'));
    expect(p.cmp.fromDate).toBe('2026-09-01');
    expect(p.cmp.quickDays()).toBe(0);
  });
});
