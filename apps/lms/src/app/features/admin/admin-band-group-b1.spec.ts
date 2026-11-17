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

  it('ONE page: search pill + one tab strip (design tabs, Technician notes, Sending); rail and page title are gone', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).not.toBeNull();
    expect(p.bandInput()!.placeholder).toBe('Find a report setting');
    expect(p.el.querySelector('.pf-hb__search--tabs')).toBeNull();
    expect(pillTabs(p.el).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Letterhead', 'Patient strip', 'Table columns', 'Results table', 'Sequencing', 'Footer', 'Report notes', 'Sending']);
    expect(p.el.querySelector('[data-testid="rt-report-options"]')).toBeNull();
    expect(p.el.querySelector('.pf-rt-rail')).toBeNull();
    expect(p.el.querySelector('.pf-rt-work__title')).toBeNull();
    expect(p.el.querySelector('.pf-rt-head')?.classList.contains('pf-classic-only')).toBe(true);
    expect(p.body()?.classList.contains('pf-band-body--fill')).toBe(true);
    // Letterhead is edited ON the page (the WYSIWYG designer) …
    expect(p.body()?.querySelector('pf-report-header-editor')).not.toBeNull();
    // … the other sections keep the form + live preview.
    p.cmp.setTab('patient');
    p.f.detectChanges();
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

  it('Technician notes and Sending render in the same body frame; one Save, notes PATCH only techReportNotes', () => {
    const p = make();
    tabByLabel(p.el, 'Report notes').click();
    p.f.detectChanges();
    expect(p.cmp.tab()).toBe('notes');
    const work = p.body()!.querySelector('.pf-rt-work')!;
    expect(work.querySelector('[data-testid="ls-tech-notes"]')).not.toBeNull();
    expect(p.body()!.querySelector('.pf-rt-aside')).not.toBeNull();
    const sw = work.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Report notes"]')!;
    sw.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { techReportNotes: true });
    tabByLabel(p.el, 'Sending').click();
    p.f.detectChanges();
    expect(p.body()!.querySelector('.pf-rt-work pf-report-sending-card')).not.toBeNull();
    expect(p.actions().filter((b) => /\bSave\b/.test(b.textContent ?? '')).length).toBe(1);
  });

  it('the band search finds a setting on another tab and opens it', () => {
    const p = make();
    p.type('whatsapp');
    p.f.detectChanges();
    const hit = p.el.querySelector<HTMLButtonElement>('[data-testid="rt-find"] .pf-rt-find__hit')!;
    expect(hit.textContent).toContain('WhatsApp Auto');
    hit.click();
    p.f.detectChanges();
    expect(p.cmp.tab()).toBe('sending');
    expect(p.el.querySelector('[data-testid="rt-find"]')).toBeNull();
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

  it('"What to show" is the tabs-only pill; header and in-page switch are classic-only', () => {
    const p = make();
    expect(p.bandInput()).toBeNull();
    expect(pillTabs(p.el).map((b) => b.getAttribute('aria-label'))).toEqual(['Both', 'Logo only', 'Name only']);
    expect(p.headerIsClassicOnly()).toBe(true);
  });

  it('switching the pill changes the mode; Save (band) enables when dirty and patches the tenant', async () => {
    const p = make();
    const save = () => p.actions().find((b) => b.textContent?.includes('Save'))! as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    tabByLabel(p.el, 'Name only').click();
    p.f.detectChanges();
    expect(p.cmp.branding().brandingMode).toBe('name');
    expect(save().disabled).toBe(false);
    save().click();
    await Promise.resolve();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/current', expect.objectContaining({ brandingMode: 'name' }));
  });
});
