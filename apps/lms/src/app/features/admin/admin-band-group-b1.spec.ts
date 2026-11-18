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
/** Report design (owner 2026-11-17): the sections are the LEFT side card's list (Test Master two-panel). */
const rtTabs = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="rt-nav"] .pf-rt-nav__item'));
const rtTab = (el: HTMLElement, label: string) =>
  rtTabs(el).find((b) => (b.textContent ?? '').trim() === label)!;
const settle = async (p: { f: { detectChanges(): void; whenStable(): Promise<unknown> } }) => {
  for (let i = 0; i < 3; i++) { p.f.detectChanges(); await p.f.whenStable(); await new Promise((r) => setTimeout(r, 0)); }
  p.f.detectChanges();
};

describe('Admin band — Report designer (/admin/reports)', () => {
  const make = () => renderBandPage(ReportTemplateComponent, {
    getFor: (url) => url === '/api/config/report-template' ? { labName: 'Micro World Labs' }
      : url === '/api/tenants/departments' ? [{ id: 'd1', name: 'Haematology' }]
      : url.startsWith('/api/workflows/') ? { configJson: '{}' }
      : null,
  });

  it('ONE page: search pill in the band; the sections are the LEFT side card; no live preview pane', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).not.toBeNull();
    expect(p.bandInput()!.placeholder).toBe('Find a report setting');
    expect(p.el.querySelector('.pf-hb__search--tabs')).toBeNull();
    expect(p.el.querySelector('pf-hero-band pf-segmented')).toBeNull();
    expect(rtTabs(p.el).map((b) => (b.textContent ?? '').trim()))
      .toEqual(['Letterhead', 'Patient strip', 'Table columns', 'Results table', 'Sequencing', 'Footer', 'Sending']);
    expect(p.el.querySelector('[data-testid="rt-report-options"]')).toBeNull();
    expect(p.el.querySelector('.pf-rt-rail')).toBeNull();
    expect(p.el.querySelector('.pf-rt-work__title')).toBeNull();
    expect(p.el.querySelector('.pf-rt-head')?.classList.contains('pf-classic-only')).toBe(true);
    expect(p.body()?.classList.contains('pf-band-body--fill')).toBe(true);
    // Letterhead is edited ON the page (the WYSIWYG designer) …
    expect(p.body()?.querySelector('pf-report-header-editor')).not.toBeNull();
    // … the other sections fill the main card full width — NO live preview (Preview opens on demand).
    p.cmp.setTab('patient');
    p.f.detectChanges();
    expect(p.body()?.querySelector('.pf-rt-main .pf-rt-work')).not.toBeNull();
    expect(p.body()?.querySelector('.pf-rt-aside')).toBeNull();
    expect(p.body()?.querySelector('[data-testid="rt-preview"]')).not.toBeNull();
  });

  it('clicking a section switches it', async () => {
    const p = make();
    expect(p.cmp.tab()).toBe('letterhead');
    rtTab(p.el, 'Footer').click();
    await settle(p);
    expect(p.cmp.tab()).toBe('footer');
    expect(rtTab(p.el, 'Footer').getAttribute('aria-selected')).toBe('true');
  });

  it('Report notes is a row of Results table and Sending renders in the same body frame; one Save, notes PATCH only techReportNotes', async () => {
    const p = make();
    expect(rtTab(p.el, 'Report notes')).toBeUndefined();
    rtTab(p.el, 'Results table').click();
    await settle(p);
    expect(p.cmp.tab()).toBe('table');
    const work = p.body()!.querySelector('.pf-rt-work')!;
    expect(work.querySelector('[data-testid="ls-tech-notes"]')).not.toBeNull();
    expect(p.body()!.querySelector('.pf-rt-aside')).toBeNull();   // no live preview pane (Preview opens on demand)
    const sw = work.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Report notes"]')!;
    sw.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { techReportNotes: true });
    rtTab(p.el, 'Sending').click();
    await settle(p);
    expect(p.body()!.querySelector('.pf-rt-work pf-report-sending-card')).not.toBeNull();
    expect(p.el.querySelectorAll('pf-hero-band [data-testid="band-save"]').length).toBeLessThanOrEqual(1);   // ONE Save, in the band's corner
    expect(p.el.querySelectorAll('.pf-ssb__bar').length).toBe(0);                                          // never a card-footer bar
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

  it('Save sits in the band\'s top-right corner (owner 2026-11-17) and posts the template', () => {
    const p = make();
    expect(p.el.querySelectorAll('.pf-ssb__bar').length).toBe(0);
    p.cmp.save();
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
