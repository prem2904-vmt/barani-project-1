import { HttpClient } from '@angular/common/http';
import { vi } from 'vitest';
import { of } from 'rxjs';
import { PlatformService } from '../../../core/services/platform.service';
import { VendorsComponent } from './vendors.component';
import { renderBandPage } from '../admin-band.spec-helpers';

/**
 * The reported bug: "Record payment" used a native `<input type="date">`
 * (showed "mm/dd/yyyy"). Now it's the kit `pf-date` — typed dd/mm/yyyy,
 * ISO `yyyy-MM-dd` in/out, same `paidAt` form field the backend already read.
 */
describe('Vendors — Record payment date (no native browser control)', () => {
  const vendor = { id: 'v1', name: 'Apollo Hospital', code: 'APOLLO', isActive: true, totalCredit: 0, usedCredit: 0, balance: 0, outstanding: 500, createdAt: '2026-01-01' };

  function render() {
    const httpPost = vi.fn((_url: string, _body: FormData) => of({ success: true }));
    const p = renderBandPage(VendorsComponent, {
      getFor: (url) => (url.startsWith('/api/vendors') && !url.includes('/transactions') ? [vendor] : []),
      providers: [
        { provide: HttpClient, useValue: { post: httpPost } },
        { provide: PlatformService, useValue: { getApiUrl: () => 'https://mw.test' } },
      ],
    });
    return { ...p, httpPost };
  }

  it('renders pf-date, never a native date input, for the payment date', () => {
    const p = render();
    p.cmp.openPayment(vendor);
    p.f.detectChanges();
    const panel = p.el.querySelector('.pf-topup')!;
    expect(panel.querySelector('pf-date')).not.toBeNull();
    expect(panel.querySelector('input[type="date"]:not([aria-hidden="true"])')).toBeNull();
  });

  it('typing a date in the kit field sets paymentDate as plain ISO yyyy-MM-dd (never shifted)', () => {
    const p = render();
    p.cmp.openPayment(vendor);
    p.f.detectChanges();
    const txt = p.el.querySelector<HTMLInputElement>('.pf-topup pf-date input[type="text"]')!;
    txt.value = '26092026';
    txt.dispatchEvent(new Event('input'));
    p.f.detectChanges();
    expect(p.cmp.paymentDate()).toBe('2026-09-26');
  });

  it('confirming the payment posts the ISO date as the paidAt form field (unchanged API contract)', async () => {
    const p = render();
    p.cmp.openPayment(vendor);
    p.cmp.paymentAmount.set('5000');
    p.cmp.paymentDate.set('2026-09-26');
    await p.cmp.confirmPayment(vendor);
    expect(p.httpPost).toHaveBeenCalled();
    const [url, fd] = p.httpPost.mock.calls[0] as [string, FormData];
    expect(url).toContain('/api/vendors/v1/payment');
    expect(fd.get('paidAt')).toBe('2026-09-26');
  });
});

describe('Credit accounts grid — edit, status and search (same APIs)', () => {
  const rows = [
    { id: 'v1', name: 'Apollo D', code: 'APD1', contactName: 'Ravi', contactPhone: '9876543210', isActive: true, totalCredit: 0, usedCredit: 3, balance: 0, outstanding: 3, createdAt: '2026-01-01' },
    { id: 'v2', name: 'Apollo D', code: 'APD2', contactName: 'Meena', isActive: true, totalCredit: 471888, usedCredit: 3, balance: 0, outstanding: -471885, createdAt: '2026-01-01' },
    { id: 'v3', name: 'Old Partner', code: 'OLD', isActive: false, totalCredit: 0, usedCredit: 0, balance: 0, outstanding: 0, createdAt: '2026-01-01' },
  ];
  const render = () => renderBandPage(VendorsComponent, {
    getFor: (url) => (url.startsWith('/api/vendors') && !url.includes('/transactions') ? rows : []),
    providers: [{ provide: HttpClient, useValue: { post: vi.fn() } }, { provide: PlatformService, useValue: { getApiUrl: () => '' } }],
  });

  it('duplicate names stay distinguishable: code column + contact under the name', () => {
    const p = render();
    const name = p.cmp.colDefs().find((c: any) => c.colId === 'name').cellRenderer;
    expect((name({ data: rows[0] }) as HTMLElement).textContent).toContain('Ravi');
    expect((name({ data: rows[1] }) as HTMLElement).textContent).toContain('Meena');
    expect(p.cmp.colDefs().map((c: any) => c.colId)).toEqual(['name', 'code', 'status', 'charged', 'settled', 'outstanding', 'actions']);
  });

  it('Edit opens the form on the LEFT and saves with the same PUT (isActive kept)', () => {
    const p = render();
    p.cmp.editVendor(rows[0]);
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-sg-side')!.textContent).toContain('Edit vendor');
    p.cmp.patchDraft({ contactName: 'Ravi K' });
    p.cmp.saveVendor();
    expect(p.api.put).toHaveBeenCalledWith('/api/vendors/v1', {
      name: 'Apollo D', code: 'APD1', contactName: 'Ravi K', contactPhone: '9876543210', contactEmail: null, gstin: null, address: null, isActive: true,
    });
  });

  it('Deactivate from the row: the same PUT with isActive flipped; status filter Inactive', () => {
    const p = render();
    p.cmp.actionsFor(rows[0]).find((a: any) => a.label === 'Deactivate').run();
    expect(p.api.put).toHaveBeenCalledWith('/api/vendors/v1', expect.objectContaining({ isActive: false }));
    p.cmp.status.set('inactive');
    expect(p.cmp.visibleVendors().map((v: any) => v.id)).toEqual(['v3']);
  });
});
