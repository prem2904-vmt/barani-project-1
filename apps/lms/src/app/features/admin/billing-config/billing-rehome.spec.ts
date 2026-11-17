import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { BillingConfigComponent } from './billing-config.component';
import { BILLING_SECTIONS, BillingSettingsPage, billingSectionOf } from './billing-settings.page';

const rows: Record<string, unknown> = {
  '/api/config/billing': { tenantId: 't1', gstEnabled: true, allowDiscounts: true, invoicePrefix: 'INV', invoiceStartNumber: 1000,
    bankAccountName: 'Arun Labs', bankAccountNumber: '1234', bankIfsc: 'HDFC0001', bankName: 'HDFC Bank' },
  '/api/config/invoice-template': { labName: 'Stale Name', logoUrl: '/uploads/stale.png', bankDetails: 'old free text', tagline: 'Kept' },
};
const profile = { tenant: () => ({ name: 'Arun Labs', logoUrl: '/uploads/a.png' }), ensureLoaded: () => undefined, update: () => undefined };
const make = (cmp: any = BillingConfigComponent) => renderBandPage(cmp, {
  getFor: (url) => rows[url] ?? [],
  providers: [{ provide: TenantStateService, useValue: profile }],
});
afterEach(() => TestBed.resetTestingModule());

describe('Billing — Organization profile feeds the bill letterhead', () => {
  const openInvoice = (p: ReturnType<typeof make>) => { p.cmp.setTab('invoice'); p.f.detectChanges(); };

  it('the bill name and logo are read-only with a link to the profile; bank details come from the card only', () => {
    const p = make();
    openInvoice(p);
    expect(p.el.querySelector('[data-testid="bc-name-ro"]')!.textContent).toContain('Arun Labs');
    expect(p.el.querySelector('[data-testid="bc-name-ro"] a')!.getAttribute('href')).toBe('/admin/org/profile');
    expect(p.el.querySelector('[data-testid="bc-logo-ro"]')).not.toBeNull();
    // No free-text bank field, no logo uploader, no editable lab-name input.
    expect(p.el.querySelector('pf-image-upload')).toBeNull();
    expect(p.el.querySelector('input[placeholder="A/c · IFSC · Bank"]')).toBeNull();
    expect(p.el.querySelector('[data-testid="bc-name-ro"] input')).toBeNull();
    expect(p.el.querySelector('[data-testid="bc-bank-ro"]')!.textContent).toContain('Arun Labs · A/c 1234 · IFSC HDFC0001 · HDFC Bank');
  });

  it('Save letterhead posts the profile name + logo and the derived bank line, keeping the letterhead-only fields', () => {
    const p = make();
    openInvoice(p);
    p.el.querySelector<HTMLButtonElement>('.pf-save-letterhead')!.click();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/invoice-template', expect.objectContaining({
      labName: 'Arun Labs', logoUrl: '/uploads/a.png', bankDetails: 'Arun Labs · A/c 1234 · IFSC HDFC0001 · HDFC Bank', tagline: 'Kept',
    }));
  });

  it('a lab with only the old free-text bank details keeps printing them until the card is filled', () => {
    const old = { ...rows };
    rows['/api/config/billing'] = { tenantId: 't1', invoicePrefix: 'INV' };
    const p = make();
    openInvoice(p);
    expect(p.el.querySelector('[data-testid="bc-bank-ro"]')!.textContent).toContain('old free text');
    p.el.querySelector<HTMLButtonElement>('.pf-save-letterhead')!.click();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/invoice-template', expect.objectContaining({ bankDetails: 'old free text' }));
    rows['/api/config/billing'] = old['/api/config/billing'];
  });

  it('saving the billing config re-posts the bill template with the changed bank line (same API)', () => {
    const p = make();
    p.cmp.patch({ bankName: 'ICICI Bank' });
    p.api.post.mockClear();
    p.cmp.saveConfig();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/billing', expect.objectContaining({ bankName: 'ICICI Bank' }));
    expect(p.api.post).toHaveBeenCalledWith('/api/config/invoice-template', expect.objectContaining({ bankDetails: expect.stringContaining('ICICI Bank') }));
  });
});

describe('Billing and taxes — categories', () => {
  it('lists GST and discounts, Invoices and bill design, Payment rules, Credit accounts', () => {
    expect(BILLING_SECTIONS.map(s => s.label)).toEqual(['GST and discounts', 'Invoices and bill design', 'Payment rules', 'Credit accounts']);
  });
  it('old tab names land on their new category; unknown opens GST and discounts', () => {
    expect(billingSectionOf('discounts')).toBe('gst');
    expect(billingSectionOf('invoice')).toBe('invoice');
    expect(billingSectionOf('payments')).toBe('payments');
    expect(billingSectionOf('credit')).toBe('credit');
    expect(billingSectionOf(null)).toBe('gst');
    expect(billingSectionOf('nope')).toBe('gst');
  });

  it('pinned to gst the screen shows GST AND discounts together, with no in-page tab pill', () => {
    const p = renderBandPage(BillingConfigComponent, { getFor: (u) => rows[u] ?? [], providers: [{ provide: TenantStateService, useValue: profile }] });
    p.f.componentRef.setInput('section', 'gst');
    p.f.detectChanges();
    expect(p.cmp.tab()).toBe('gst');
    expect(p.el.textContent).toContain('Allow discounts');
    expect(p.el.querySelector('pf-hero-band pf-segmented')).toBeNull();
  });

  it('pinned to invoice opens the bill design', () => {
    const p = renderBandPage(BillingConfigComponent, { getFor: (u) => rows[u] ?? [], providers: [{ provide: TenantStateService, useValue: profile }] });
    p.f.componentRef.setInput('section', 'invoice');
    p.f.detectChanges();
    expect(p.cmp.tab()).toBe('invoice');
    expect(p.el.querySelector('[data-testid="bc-name-ro"]')).not.toBeNull();
  });

  it('the host opens Payment rules and Credit accounts from ?tab=', async () => {
    const { ActivatedRoute } = await import('@angular/router');
    const qp = (tab: string) => ({ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map([['tab', tab]]) as any, data: {} }, queryParamMap: of(new Map([['tab', tab]]) as any) } });
    const pay = renderBandPage(BillingSettingsPage, { getFor: (u) => rows[u] ?? [], providers: [qp('payments')] });
    pay.f.detectChanges();
    expect(pay.el.querySelector('[data-testid="billing-payments"] pf-payment-rules-card')).not.toBeNull();
    TestBed.resetTestingModule();
    const credit = renderBandPage(BillingSettingsPage, { getFor: (u) => rows[u] ?? [], providers: [qp('credit')] });
    credit.f.detectChanges();
    expect(credit.el.querySelector('pf-vendors')).not.toBeNull();
    // Setup only: no top-up / payment / statement actions on this screen.
    expect(credit.el.textContent).not.toContain('Record payment');
  });
});
