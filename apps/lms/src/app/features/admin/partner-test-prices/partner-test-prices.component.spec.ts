import { of } from 'rxjs';
import { vi } from 'vitest';
import { PartnerTestPricesComponent } from './partner-test-prices.component';
import { renderBandPage } from '../admin-band.spec-helpers';

describe('Partner prices — Test Master grid (pf-data-grid)', () => {
  const rows = [
    { id: 'p1', referralLabId: 'rl1', testCatalogKey: 'CBC', testName: 'Complete Blood Count', cost: 180, effectiveFrom: '2026-10-01' },
    { id: 'p2', referralLabId: 'rl1', testCatalogKey: 'LIPID', testName: 'Lipid Profile', cost: 320, effectiveFrom: '2026-10-01' },
  ];
  const make = () => renderBandPage(PartnerTestPricesComponent, {
    getFor: (u) => (u === '/api/referral-labs' ? [{ id: 'rl1', name: 'Apollo' }] : u.startsWith('/api/partner-test-prices') ? rows : []),
  });

  it('the grid fills the card; the lab filter is a head tool; Add price + Save in the band once a lab is picked', async () => {
    const p = make();
    expect(p.el.querySelector('.ptp-main pf-data-grid')).not.toBeNull();
    expect(p.el.querySelector('.pf-sg-main__head pf-select.ptp-filter')).not.toBeNull();
    expect(p.actions().length).toBe(0);
    await p.cmp.pickLab('rl1'); p.f.detectChanges();
    expect(p.cmp.visibleRows().length).toBe(2);
    expect(p.actions().map((b: HTMLElement) => b.textContent?.trim())).toEqual(['Add price', 'Save changes']);
    p.type('lipid');
    expect(p.cmp.visibleRows().map((r: any) => r.testCatalogKey)).toEqual(['LIPID']);
  });

  it('an edit is an unsaved change; Save sends the same batch payload', async () => {
    const p = make();
    await p.cmp.pickLab('rl1');
    p.cmp.onCellChanged({ data: Object.assign(p.cmp.rows()[0], { cost: 200 }) });
    expect(p.cmp.hasUnsavedChanges()).toBe(true);
    p.api.post.mockReturnValue(of({}));
    expect(await p.cmp.saveChanges()).toBe(true);
    expect(p.api.post).toHaveBeenCalledWith('/api/partner-test-prices/batch', {
      rows: [{ id: 'p1', referralLabId: 'rl1', testCatalogKey: 'CBC', testName: 'Complete Blood Count', cost: 200, effectiveFrom: '2026-10-01' }],
    });
    void vi;
  });
});
