import { HttpClient } from '@angular/common/http';
import { vi } from 'vitest';
import { of } from 'rxjs';
import { PlatformService } from '../../../core/services/platform.service';
import { VendorsComponent } from './vendors.component';
import { renderBandPage } from '../admin-band.spec-helpers';

/**
 * The reported bug: "Record payment" used a native `<input type="date">`
 * (showed "mm/dd/yyyy"). Now it's the kit `pf-nd-date` — typed dd/mm/yyyy,
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

  it('renders pf-nd-date, never a native date input, for the payment date', () => {
    const p = render();
    p.cmp.openPayment(vendor);
    p.f.detectChanges();
    const panel = p.el.querySelector('.pf-topup')!;
    expect(panel.querySelector('pf-nd-date')).not.toBeNull();
    expect(panel.querySelector('input[type="date"]:not([aria-hidden="true"])')).toBeNull();
  });

  it('typing a date in the kit field sets paymentDate as plain ISO yyyy-MM-dd (never shifted)', () => {
    const p = render();
    p.cmp.openPayment(vendor);
    p.f.detectChanges();
    const txt = p.el.querySelector<HTMLInputElement>('.pf-topup pf-nd-date input[type="text"]')!;
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
