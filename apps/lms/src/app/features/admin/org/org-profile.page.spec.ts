import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { DialogService } from '../../../core/services/dialog.service';
import { OrgProfilePage } from './org-profile.page';
import { INVOICE_TEMPLATE_URL, REPORT_TEMPLATE_URL } from './org-profile.service';

/** Settings → Organization → Organization profile: the ONE place the name and logo are set. */
describe('Organization profile page', () => {
  const tenant = signal<any>({ id: 't1', name: 'Arun Labs', slug: 'arunlabs', brandingName: 'ARUN', brandingMode: 'both', logoUrl: '/uploads/a.png' });
  const report = { labName: 'Arun Labs', logoUrl: '/uploads/a.png', tagline: 'Careful' };
  const invoice = { labName: 'Arun Labs', logoUrl: '/uploads/a.png' };
  const make = (rows: Record<string, unknown> = { [REPORT_TEMPLATE_URL]: report, [INVOICE_TEMPLATE_URL]: invoice }, confirm = true) => {
    const tenantState = { tenant, ensureLoaded: vi.fn(), update: vi.fn() };
    const p = renderBandPage(OrgProfilePage, {
      getFor: (url) => rows[url] ?? null,
      providers: [
        { provide: TenantStateService, useValue: tenantState },
        { provide: DialogService, useValue: { confirm: vi.fn(async () => confirm), prompt: vi.fn(async () => null) } },
      ],
    });
    p.api.patch.mockImplementation((() => of({ id: 't1' })) as any);
    return { ...p, tenantState };
  };
  const input = (el: HTMLElement, id: string) => el.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
  const type = (i: HTMLInputElement, v: string) => { i.value = v; i.dispatchEvent(new Event('input')); };
  const saveBtn = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[data-testid="op-save"]')!;
  const settle = async (p: { f: any }) => { for (let i = 0; i < 6; i++) { await p.f.whenStable(); await new Promise(r => setTimeout(r, 0)); p.f.detectChanges(); } };
  afterEach(() => TestBed.resetTestingModule());

  it('loads the name, short name, logo mode and login handle from the tenant; Save starts disabled', async () => {
    const p = make();
    await settle(p);
    expect(input(p.el, 'op-name-input').value).toBe('Arun Labs');
    expect(input(p.el, 'op-short-input').value).toBe('ARUN');
    expect(input(p.el, 'op-slug-input').value).toBe('arunlabs');
    expect(saveBtn(p.el).disabled).toBe(true);
    expect(p.el.querySelector('[data-testid="op-prints-status"]')!.textContent).toContain('Reports and bills print this name and logo');
  });

  it('typing a new name enables Save; Save writes the tenant name AND both letterheads', async () => {
    const p = make();
    p.f.detectChanges();
    type(input(p.el, 'op-name-input'), 'Arun Diagnostics');
    p.f.detectChanges();
    expect(saveBtn(p.el).disabled).toBe(false);
    saveBtn(p.el).click();
    await settle(p);
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/current', { name: 'Arun Diagnostics' });
    expect(p.api.post).toHaveBeenCalledWith(REPORT_TEMPLATE_URL, expect.objectContaining({ labName: 'Arun Diagnostics', tagline: 'Careful' }));
    expect(p.api.post).toHaveBeenCalledWith(INVOICE_TEMPLATE_URL, expect.objectContaining({ labName: 'Arun Diagnostics' }));
    expect(p.el.querySelector('[data-testid="op-prints-status"]')).not.toBeNull();
  });

  it('shows that a letterhead prints something else, and Save (even with no edit) brings it in line', async () => {
    const p = make({ [REPORT_TEMPLATE_URL]: { ...report, labName: 'Old Lab Name' }, [INVOICE_TEMPLATE_URL]: invoice });
    await settle(p);
    expect(p.el.querySelector('[data-testid="op-prints-status"]')!.textContent).toContain('still print a different name or logo');
    expect(saveBtn(p.el).disabled).toBe(false);
    saveBtn(p.el).click();
    await settle(p);
    expect(p.api.post).toHaveBeenCalledWith(REPORT_TEMPLATE_URL, expect.objectContaining({ labName: 'Arun Labs' }));
    expect(p.api.patch).not.toHaveBeenCalled();
  });

  it('a lab that only had its logo on the report letterhead keeps it (never blanked by the first Save)', async () => {
    tenant.set({ id: 't1', name: 'Arun Labs', slug: 'arunlabs', brandingMode: 'both', logoUrl: '' });
    const p = make({ [REPORT_TEMPLATE_URL]: { labName: 'Arun Labs', logoUrl: '/uploads/report-only.png' }, [INVOICE_TEMPLATE_URL]: invoice });
    await settle(p);
    expect(p.cmp.logoUrl()).toBe('/uploads/report-only.png');
    expect(saveBtn(p.el).disabled).toBe(false);
    tenant.set({ id: 't1', name: 'Arun Labs', slug: 'arunlabs', brandingName: 'ARUN', brandingMode: 'both', logoUrl: '/uploads/a.png' });
  });

  it('short name keeps letters / numbers / spaces and a few marks only, max 30', () => {
    const p = make();
    p.f.detectChanges();
    type(input(p.el, 'op-short-input'), 'AB<>#$ Lab ' + 'x'.repeat(40));
    expect(p.cmp.shortName()).toBe(('AB Lab ' + 'x'.repeat(40)).slice(0, 30));
  });

  it('the login handle asks first and is lowercase letters, numbers and hyphens', async () => {
    const p = make(undefined, true);
    p.f.detectChanges();
    type(input(p.el, 'op-slug-input'), 'New Handle_9!');
    expect(p.cmp.slug()).toBe('newhandle9');
    p.f.detectChanges();
    saveBtn(p.el).click();
    await settle(p);
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/current', { slug: 'newhandle9' });
  });

  it('declining the handle confirm saves nothing', async () => {
    const p = make(undefined, false);
    p.f.detectChanges();
    type(input(p.el, 'op-slug-input'), 'other');
    p.f.detectChanges();
    saveBtn(p.el).click();
    await settle(p);
    expect(p.api.patch).not.toHaveBeenCalled();
  });

  it('one primary (band Save), SVG icons only', () => {
    const p = make();
    p.f.detectChanges();
    expect(p.el.querySelectorAll('.pf-hb-btn--primary').length).toBe(1);
    expect(p.el.querySelectorAll('pf-setting-group').length).toBe(3);   // Name · Logo · Sign-in groups
    expect(/[\u{1F300}-\u{1FAFF}]/u.test(p.el.textContent ?? '')).toBe(false);
  });
});
