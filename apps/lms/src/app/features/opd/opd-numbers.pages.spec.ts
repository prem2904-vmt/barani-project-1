import { OpdNumbersPage } from './admin/opd-numbers.page';
import { PharmacyNumbersPage } from './pharmacy/pharmacy-numbers.page';
import { groupLabels, renderLabPage, rowLabels, text } from '../admin/lab-pages/lab-pages.spec-helpers';

describe('OPD › Visit numbers (/admin/opd/numbers)', () => {
  it('one group, Visit numbers (per branch), built-in format until the clinic opts in', async () => {
    const p = await renderLabPage(OpdNumbersPage, '/page', { getFor: () => null });
    expect(groupLabels(p.el)).toEqual(['Visit numbers']);
    expect(text(p.el.querySelector('.pf-sgroup__scope'))).toBe('per branch');
    expect(rowLabels(p.el)).toEqual(['Custom format', 'Preview']);
    expect(p.api.get).toHaveBeenCalledWith('/api/config/order-id?module=opd');
    expect(text(p.el.querySelector('[data-testid="order-id-preview"]'))).toMatch(/^OPD-\d{4}-000001$/);
    expect(p.cmp.hasUnsavedChanges()).toBe(false);
  });

  it('the band-corner Save posts module=opd', async () => {
    const p = await renderLabPage(OpdNumbersPage, '/page', {
      getFor: () => ({ enabled: true, datePrefix: 'yymm', separator: '-', padding: 6, serialMode: 'numeric', letterCount: 2, prefix: 'VIS' }),
    });
    (p.harness.routeDebugElement!.query(d => d.name === 'pf-order-id-format-card').componentInstance as { save(): void }).save();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/order-id?module=opd', expect.objectContaining({ enabled: true, prefix: 'VIS' }));
    expect(p.api.post).not.toHaveBeenCalledWith('/api/config/order-id?module=lab', expect.anything());
  });
});

describe('Pharmacy › Dispense numbers (/admin/pharmacy/numbers)', () => {
  it('one group, Dispense numbers (per branch), built-in PD format until the pharmacy opts in', async () => {
    const p = await renderLabPage(PharmacyNumbersPage, '/page', { getFor: () => null });
    expect(groupLabels(p.el)).toEqual(['Dispense numbers']);
    expect(p.api.get).toHaveBeenCalledWith('/api/config/order-id?module=pharmacy');
    expect(text(p.el.querySelector('[data-testid="order-id-preview"]'))).toMatch(/^PD-\d{4}-000001$/);
    expect(p.cmp.hasUnsavedChanges()).toBe(false);
  });
});
