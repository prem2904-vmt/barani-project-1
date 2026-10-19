import { DailyStatementComponent } from './daily-statement.component';
import { renderBandPage } from '../admin/admin-band.spec-helpers';

/** Business day used a native `<input type="date">` (band pill + classic) —
 *  now `pf-date`, same ISO yyyy-MM-dd fed to `/api/finance/daily?date=…`. */
describe('Daily statement — business day (no native date input)', () => {
  const stmt = {
    date: '2026-09-25', shift: null, openingBalance: 100, totalCollected: 500, totalRefunded: 0,
    net: 500, expectedCash: 600, payments: [{ mode: 'cash', count: 1, total: 500 }], refunds: [], closure: null,
  };
  const make = () => renderBandPage(DailyStatementComponent, {
    getFor: (url) => (url.startsWith('/api/finance/daily') ? stmt : []),
  });

  it('band pill: pf-date for the business day, never a visible native date input', () => {
    const p = make();
    const tools = p.tools()!;
    expect(tools.querySelectorAll('pf-date').length).toBe(1);
    expect(tools.querySelector('input[type="date"]:not([aria-hidden="true"])')).toBeNull();
  });

  it('typing a business day in the pill calls setDate and reloads that day', () => {
    const p = make();
    p.api.get.mockClear();
    const txt = p.tools()!.querySelector<HTMLInputElement>('pf-date input[type="text"]')!;
    txt.value = '20092026';
    txt.dispatchEvent(new Event('input'));
    expect(p.cmp.dateStr()).toBe('2026-09-20');
    expect(p.api.get.mock.calls.some((c: unknown[]) => String(c[0]).includes('/api/finance/daily?date=2026-09-20'))).toBe(true);
  });
});
