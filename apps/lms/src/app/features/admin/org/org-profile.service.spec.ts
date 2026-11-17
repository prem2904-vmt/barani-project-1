import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { INVOICE_TEMPLATE_URL, OrgProfile, OrgProfileService, REPORT_TEMPLATE_URL, letterheadDiffers } from './org-profile.service';

describe('OrgProfileService — the one writer of the organization name + logo', () => {
  const prev: OrgProfile = { name: 'Arun Labs', brandingName: 'ARUN', brandingMode: 'both', logoUrl: '/uploads/a.png' };
  const report = { id: 'r1', labName: 'Old Name', logoUrl: '/uploads/old.png', tagline: 'Accurate | Caring', nablNumber: 'MC-1', primaryColor: '#123456' };
  const invoice = { labName: 'Old Name', logoUrl: '', template: 'modern', signatureLabel: 'Authorised' };
  let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> };
  let tenantState: { tenant: () => unknown; ensureLoaded: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

  const make = (rows: Record<string, unknown> = { [REPORT_TEMPLATE_URL]: report, [INVOICE_TEMPLATE_URL]: invoice }) => {
    api = {
      get: vi.fn((url: string) => of(rows[url] ?? null)),
      post: vi.fn(() => of({})),
      patch: vi.fn(() => of({ id: 't1' })),
    };
    tenantState = { tenant: () => ({ name: 'Arun Labs', logoUrl: '/uploads/a.png' }), ensureLoaded: vi.fn(), update: vi.fn() };
    TestBed.configureTestingModule({ providers: [
      { provide: ApiService, useValue: api },
      { provide: TenantStateService, useValue: tenantState },
    ] });
    return TestBed.inject(OrgProfileService);
  };
  const flush = async (o: { subscribe: (f: () => void) => void }) => new Promise<void>(res => o.subscribe(() => res()));
  afterEach(() => TestBed.resetTestingModule());

  it('exposes the profile name and logo the letterheads show read-only', () => {
    const s = make();
    expect(s.name()).toBe('Arun Labs');
    expect(s.logoUrl()).toBe('/uploads/a.png');
  });

  it('a name change writes the tenant (name only), then both letterheads with their other fields kept', async () => {
    const s = make();
    await flush(s.saveEverywhere({ ...prev, name: 'Arun Diagnostics' }, prev));
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/current', { name: 'Arun Diagnostics' });
    expect(api.post).toHaveBeenCalledWith(REPORT_TEMPLATE_URL, { ...report, labName: 'Arun Diagnostics', logoUrl: '/uploads/a.png' });
    expect(api.post).toHaveBeenCalledWith(INVOICE_TEMPLATE_URL, { ...invoice, labName: 'Arun Diagnostics', logoUrl: '/uploads/a.png' });
  });

  it('a branding change sends the same branding payload the Setup page did', async () => {
    const s = make();
    await flush(s.saveEverywhere({ ...prev, brandingName: 'AL', brandingMode: 'name', logoUrl: '' }, prev));
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/current', { brandingName: 'AL', brandingMode: 'name', logoUrl: '' });
    expect(api.post).toHaveBeenCalledWith(REPORT_TEMPLATE_URL, expect.objectContaining({ labName: 'Arun Labs', logoUrl: '', tagline: 'Accurate | Caring' }));
  });

  it('nothing changed and the letterheads already match: no write at all', async () => {
    const s = make({ [REPORT_TEMPLATE_URL]: { ...report, labName: 'Arun Labs', logoUrl: '/uploads/a.png' }, [INVOICE_TEMPLATE_URL]: { ...invoice, labName: 'Arun Labs', logoUrl: '/uploads/a.png' } });
    await flush(s.saveEverywhere(prev, prev));
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('only the letterhead that differs is re-posted', async () => {
    const s = make({ [REPORT_TEMPLATE_URL]: { ...report, labName: 'Arun Labs', logoUrl: '/uploads/a.png' }, [INVOICE_TEMPLATE_URL]: invoice });
    await flush(s.saveEverywhere(prev, prev));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls[0][0]).toBe(INVOICE_TEMPLATE_URL);
  });

  it('a bill template that was never saved is created with just the name + logo', async () => {
    const s = make({ [REPORT_TEMPLATE_URL]: null, [INVOICE_TEMPLATE_URL]: null });
    await flush(s.saveEverywhere(prev, prev));
    expect(api.post).toHaveBeenCalledWith(INVOICE_TEMPLATE_URL, { labName: 'Arun Labs', logoUrl: '/uploads/a.png' });
  });

  it('letterheadDiffers compares name and logo only', () => {
    expect(letterheadDiffers({ labName: 'A', logoUrl: 'x', tagline: 'different' }, { name: 'A', logoUrl: 'x' })).toBe(false);
    expect(letterheadDiffers({ labName: 'B', logoUrl: 'x' }, { name: 'A', logoUrl: 'x' })).toBe(true);
    expect(letterheadDiffers({ labName: 'A' }, { name: 'A', logoUrl: 'x' })).toBe(true);
  });
});
