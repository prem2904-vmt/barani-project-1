import { renderBandPage } from './admin-band.spec-helpers';
import { ReportTemplateComponent } from './report-template/report-template.component';
import { BillingConfigComponent } from './billing-config/billing-config.component';

/**
 * Admin band — pages with NO search but with sections (Report designer,
 * Billing config, Branding): the sections become a tabs-only pill, the
 * primary Save rides the band actions, the page title/rail are gone.
 */
const pillTabs = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('pf-hero-band .pf-hb__tools pf-segmented .seg-item'));
const tabByLabel = (el: HTMLElement, label: string) =>
  pillTabs(el).find((b) => (b.getAttribute('aria-label') ?? '') === label)!;

describe('Admin band — Report designer (/admin/reports)', () => {
  const make = () => renderBandPage(ReportTemplateComponent, {
    getFor: (url) => url === '/api/config/report-template' ? { labName: 'Micro World Labs' }
      : url === '/api/tenants/departments' ? [{ id: 'd1', name: 'Haematology' }]
      : url.startsWith('/api/workflows/') ? { configJson: '{}' }
      : null,
  });

  it('tabs-only pill carries the report sections; rail and page title are gone', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).toBeNull();
    expect(p.el.querySelector('.pf-hb__search--tabs')).not.toBeNull();
    expect(pillTabs(p.el).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Letterhead', 'Patient strip', 'Table columns', 'Results table', 'Footer']);
    expect(p.el.querySelector('.pf-rt-rail')).toBeNull();
    expect(p.el.querySelector('.pf-rt-work__title')).toBeNull();
    expect(p.el.querySelector('.pf-rt-head')?.classList.contains('pf-classic-only')).toBe(true);
    expect(p.body()?.classList.contains('pf-band-body--fill')).toBe(true);
    expect(p.body()?.querySelector('.pf-rt-work')).not.toBeNull();
    expect(p.body()?.querySelector('.pf-rt-aside')).not.toBeNull();
  });

  it('clicking a pill tab switches the section', () => {
    const p = make();
    expect(p.cmp.tab()).toBe('letterhead');
    tabByLabel(p.el, 'Footer').click();
    p.f.detectChanges();
    expect(p.cmp.tab()).toBe('footer');
    expect(tabByLabel(p.el, 'Footer').classList.contains('is-selected')).toBe(true);
  });

  it('Save sits in the band actions and posts the template', () => {
    const p = make();
    const save = p.actions().find((b) => b.textContent?.includes('Save'))!;
    expect(save).toBeTruthy();
    save.click();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/report-template', expect.objectContaining({ labName: 'Micro World Labs' }));
  });
});

describe('Admin band — Billing config (/admin/billing)', () => {
  const make = () => renderBandPage(BillingConfigComponent, {
    getFor: (url) => url === '/api/config/billing' ? { tenantId: 't1', gstEnabled: false, invoicePrefix: 'INV' }
      : url === '/api/config/invoice-template' ? {}
      : [],
  });

  it('GST / Discounts / Invoice are the tabs-only pill; the in-page switch is classic-only', () => {
    const p = make();
    expect(p.bandInput()).toBeNull();
    expect(pillTabs(p.el).map((b) => b.getAttribute('aria-label'))).toEqual(['GST Setup', 'Discounts', 'Invoice']);
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.body()?.querySelector(':scope > .pf-classic-only pf-segmented')).not.toBeNull();
  });

  it('clicking a pill tab switches the section', () => {
    const p = make();
    tabByLabel(p.el, 'Discounts').click();
    p.f.detectChanges();
    expect(p.cmp.tab()).toBe('discounts');
  });

  it('Save sits in the band actions and posts the billing config', () => {
    const p = make();
    p.actions().find((b) => b.textContent?.includes('Save'))!.click();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/billing', expect.objectContaining({ invoicePrefix: 'INV' }));
  });
});

