import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { ReportTemplateComponent } from './report-template/report-template.component';
import { BillingConfigComponent } from './billing-config/billing-config.component';
import { SetupWizardComponent } from './setup-wizard/setup-wizard.component';
import { TenantStateService } from '../../core/services/tenant-state.service';

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
      : url === '/api/tenants/branches' ? [{ id: 'b1', name: 'Main', code: 'MN' }]
      : [],
  });

  it('flattened: no pill tabs, the pill names the page; header classic-only', () => {
    const p = make();
    expect(p.bandInput()).toBeNull();
    expect(pillTabs(p.el).length).toBe(0);
    expect(p.el.querySelector('pf-hero-band .pf-hb__tools h1.nd-band-page')?.textContent).toContain('Billing settings');
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.el.querySelector('pf-hero-band pf-segmented')).toBeNull();
  });

  it('all four sections render at once, in order, with the jump list', () => {
    const p = make();
    const ids = Array.from(p.body()!.querySelectorAll('section.nd-setsec')).map((s) => s.id);
    expect(ids).toEqual(['sec-gst', 'sec-discounts', 'sec-bill', 'sec-look']);
    expect(p.body()!.querySelectorAll('pf-settings-jump .nd-setjump__item').length).toBe(4);
  });

  it('every search anchor exists on the page', () => {
    const p = make();
    for (const id of ['gst', 'gstin', 'discounts', 'invoice-number', 'proforma', 'upi', 'bank', 'bill-template', 'letterhead']) {
      expect(p.el.querySelector('#' + id), id).not.toBeNull();
    }
  });

  it('GST scope is a radiogroup of radios; picking one patches the config', () => {
    const p = make();
    const group = p.el.querySelector<HTMLElement>('[role="radiogroup"][aria-labelledby="bc-gst-scope"]')!;
    expect(group).not.toBeNull();
    const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Each branch', 'Each region', 'Whole lab']);
    radios[2].click();
    p.f.detectChanges();
    expect(p.cmp.config().gstScope).toBe('tenant');
  });

  it('bill number shows a "Looks like" preview', () => {
    const p = make();
    expect(p.el.querySelector('#invoice-number .nd-set__preview')?.textContent).toContain(`INV/${new Date().getFullYear()}/`);
  });

  it('Save sits in the band actions and posts the billing config', () => {
    const p = make();
    p.actions().find((b) => b.textContent?.includes('Save'))!.click();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/billing', expect.objectContaining({ invoicePrefix: 'INV' }));
  });
});

describe('Admin band — Branding (/setup)', () => {
  const tenant = signal<any>({ id: 't1', name: 'Micro World', brandingMode: 'both', brandingName: 'MW', logoUrl: '' });
  const make = () => {
    const tenantState = { tenant, ensureLoaded: vi.fn(), update: vi.fn() };
    const p = renderBandPage(SetupWizardComponent, {
      providers: [{ provide: TenantStateService, useValue: tenantState }],
    });
    p.api.patch.mockImplementation(() => of({ id: 't1' }) as any);
    return { ...p, tenantState };
  };

  it('no pill tabs: the pill names the page; "What the top bar shows" is an in-page radiogroup', () => {
    const p = make();
    expect(p.bandInput()).toBeNull();
    expect(p.tools()!.querySelector('pf-segmented')).toBeNull();
    expect(p.tools()!.querySelector('h1.nd-band-page')?.textContent).toContain('Branding');
    const g = p.body()!.querySelector('[role="radiogroup"][aria-labelledby="sw-mode-l"]')!;
    expect(Array.from(g.querySelectorAll('[role="radio"]')).map((b) => b.getAttribute('aria-label'))).toEqual(['Both', 'Logo only', 'Name only']);
    expect(p.headerIsClassicOnly()).toBe(true);
  });

  it('switching the mode changes it; Save (band) enables when dirty and patches the tenant', async () => {
    const p = make();
    const save = () => p.actions().find((b) => b.textContent?.includes('Save'))! as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    p.body()!.querySelector<HTMLButtonElement>('[role="radio"][aria-label="Name only"]')!.click();
    p.f.detectChanges();
    expect(p.cmp.branding().brandingMode).toBe('name');
    expect(save().disabled).toBe(false);
    save().click();
    await Promise.resolve();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/current', expect.objectContaining({ brandingMode: 'name' }));
  });
});
