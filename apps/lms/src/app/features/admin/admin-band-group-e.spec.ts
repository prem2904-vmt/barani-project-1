import { signal } from '@angular/core';
import { vi } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { LabelPrinterComponent } from './label-printer/label-printer.component';
import { PrinterService } from '../../core/printer/printer.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { MySignatureComponent } from '../user-signature/my-signature.component';
import { AuthService } from '../../core/auth/auth.service';
import { FinanceHubComponent } from '../finance/finance-hub.component';
import { DailyStatementComponent } from '../finance/daily-statement.component';
import { TatBoardComponent } from '../dashboard/tat-board/tat-board.component';

/**
 * Hub-linked pages outside /admin (owner counts them as admin nested pages):
 * Finance, Daily statement, TAT board, Printing, My signature — each gets the
 * band: filters/switches in the pill, primary actions on the band.
 */
const segBtn = (root: HTMLElement | null, label: string) =>
  Array.from(root?.querySelectorAll<HTMLButtonElement>('pf-segmented button') ?? [])
    .find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === label);

describe('Admin band — Finance hub (/finance)', () => {
  const summary = {
    from: '2026-09-01', to: '2026-09-25',
    moneyIn: { totalCollected: 1000, totalRefunded: 0, netCollected: 1000, byMode: [{ mode: 'cash', count: 2, total: 1000 }], refundsByMode: [] },
    billed: { grossBilled: 1200, totalDiscount: 200, totalTax: 0, count: 2 },
    moneyOut: { inventorySpend: 100, batchCount: 1 },
    outstanding: 50, netPosition: 900,
  };
  const vendors = [
    { id: 'v1', name: 'City Hospital', code: 'CITY', outstanding: 500, usedCredit: 500, totalCredit: 0, isActive: true },
    { id: 'v2', name: 'Apollo Clinic', code: 'APL', outstanding: 0, usedCredit: 0, totalCredit: 0, isActive: true },
  ];
  const make = () => renderBandPage(FinanceHubComponent, {
    getFor: (url) => url.startsWith('/api/finance/summary') ? summary : url.startsWith('/api/vendors?') ? vendors : [],
  });

  it('band + body, header classic-only; Lab line is a tabs-only pill (no search) with the date range', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.body()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.bandInput()).toBeNull();
    expect(p.tools()!.querySelectorAll('input[type="date"]').length).toBe(2);
    expect(p.actions().map((b) => b.textContent!.trim())).toEqual(['Download CSV']);
  });

  it('quick range in the pill reloads the summary for that window', () => {
    const p = make();
    p.api.get.mockClear();
    segBtn(p.tools(), '7d')!.click();
    p.f.detectChanges();
    const url = p.api.get.mock.calls.at(-1)![0] as string;
    expect(url).toContain('/api/finance/summary?from=');
    expect(p.cmp.quickDays()).toBe(7);
  });

  it('Credit Wallet in the pill switch loads partners and the pill search filters them', () => {
    const p = make();
    segBtn(p.tools(), 'Credit Wallet')!.click();
    p.f.detectChanges();
    expect(p.bandInput()).not.toBeNull();
    const names = () => Array.from(p.body()!.querySelectorAll('.pf-fin__vname')).map((e) => e.textContent!.trim());
    expect(names().length).toBe(2);
    p.type('apollo');
    expect(names()).toEqual([expect.stringContaining('Apollo Clinic')]);
    p.type('zzz');
    expect(names().length).toBe(0);
    expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
  });
});

describe('Admin band — Daily statement (/finance/daily)', () => {
  const stmt = (closure: unknown = null) => ({
    date: '2026-09-25', shift: null, openingBalance: 100, totalCollected: 500, totalRefunded: 0,
    net: 500, expectedCash: 600, payments: [{ mode: 'cash', count: 1, total: 500 }], refunds: [], closure,
  });
  const closures = [
    { id: 'c1', date: '2026-09-20', shift: 'evening', openingBalance: 0, expectedCash: 100, countedCash: 100, variance: 0 },
    { id: 'c2', date: '2026-09-21', shift: null, openingBalance: 0, expectedCash: 100, countedCash: 90, variance: -10 },
  ];
  const make = (closure: unknown = null) => renderBandPage(DailyStatementComponent, {
    getFor: (url) => url.startsWith('/api/finance/daily') ? stmt(closure) : url.startsWith('/api/finance/closures') ? closures : [],
  });

  it('band + body, header classic-only; business day + shift sit in the pill', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.body()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.tools()!.querySelector('input[type="date"]')).not.toBeNull();
    expect(p.tools()!.querySelector('input[aria-label="Shift (optional)"]')).not.toBeNull();
  });

  it('changing the business day in the pill reloads that day', () => {
    const p = make();
    p.api.get.mockClear();
    p.cmp.setDate('2026-09-20');
    expect(p.api.get.mock.calls.some((c: unknown[]) => String(c[0]).includes('/api/finance/daily?date=2026-09-20'))).toBe(true);
  });

  it('Close day is the band primary action: disabled until counted cash, then posts the closure', () => {
    const p = make();
    const btn = () => p.actions().find((b) => b.textContent!.includes('Close day')) as HTMLButtonElement;
    expect(btn()).toBeTruthy();
    expect(btn().disabled).toBe(true);
    p.cmp.countedCash.set(600);
    p.f.detectChanges();
    expect(btn().disabled).toBe(false);
    btn().click();
    expect(p.api.post).toHaveBeenCalledWith('/api/finance/close', expect.objectContaining({ countedCash: 600 }));
  });

  it('a closed day has no Close action', () => {
    const p = make({ id: 'x', date: '2026-09-25', openingBalance: 0, expectedCash: 0, countedCash: 0, variance: 0, closedAt: '2026-09-25T10:00:00Z' });
    expect(p.actions().length).toBe(0);
  });

  it('the pill search filters the recent closures', () => {
    const p = make();
    const rows = () => p.body()!.querySelectorAll('.pf-mode-row').length;
    const before = rows();
    p.type('evening');
    expect(rows()).toBe(before - 1);
    p.type('zzz');
    expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
  });
});

describe('Admin band — TAT board (/dashboard)', () => {
  const rows = [
    { orderTestId: 'o1', patient: 'Ravi Kumar', test: 'CBC', status: 'received', elapsedMinutes: 90, remainingMinutes: -5, level: 'urgent' },
    { orderTestId: 'o2', patient: 'Asha Devi', test: 'Lipid profile', status: 'in_progress', elapsedMinutes: 40, remainingMinutes: 20, level: 'high' },
    { orderTestId: 'o3', patient: 'John Paul', test: 'TSH', status: 'entered', elapsedMinutes: 10, remainingMinutes: 200, level: 'normal' },
  ];
  const make = () => renderBandPage(TatBoardComponent, {
    getFor: (url) => url.startsWith('/api/dashboard/tat') ? { summary: {}, rows } : [],
  });
  const tiles = (p: ReturnType<typeof make>) => p.body()!.querySelectorAll('pf-tile').length;

  it('band + scrolling body, header classic-only, Refresh on the band', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.body()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    p.api.get.mockClear();
    const refresh = p.actions().find((b) => b.textContent!.includes('Refresh'))!;
    refresh.click();
    expect(p.api.get).toHaveBeenCalledWith('/api/dashboard/tat');
    p.f.destroy();
  });

  it('pill search filters the in-flight tests (patient / test / status)', () => {
    const p = make();
    expect(tiles(p)).toBe(3);
    p.type('lipid');
    expect(tiles(p)).toBe(1);
    p.type('in progress');
    expect(tiles(p)).toBe(1);
    p.type('zzz');
    expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
    p.f.destroy();
  });

  it('urgency filter in the pill shows one level, with counts', () => {
    const p = make();
    const urgent = segBtn(p.tools(), 'Urgent')!;
    expect(urgent.textContent).toContain('1');
    urgent.click();
    p.f.detectChanges();
    expect(tiles(p)).toBe(1);
    expect(p.body()!.textContent).toContain('Ravi Kumar');
    p.f.destroy();
  });
});

describe('Admin band — Printing (/printing)', () => {
  const make = () => {
    const printer = {
      testPrint: vi.fn(async () => ({ ok: true })),
      bleDeviceName: signal<string | null>(null), bleConnected: signal(false),
      deviceName: signal<string | null>(null), connected: signal(false),
      electronStatus: vi.fn(async () => ({ connected: false })), listSystemPrinters: vi.fn(async () => []),
    };
    const p = renderBandPage(LabelPrinterComponent, {
      providers: [
        { provide: PrinterService, useValue: printer },
        { provide: BranchLabConfigService, useValue: { ensureLoaded: vi.fn(), labelCodeMode: () => 'qr', config: () => null } },
      ],
    });
    return { ...p, printer };
  };

  it('context-bar pill (no search, no tabs), header classic-only, Test print on the band', async () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).toBeNull();
    expect(p.el.querySelector('.pf-hb__search--ctx .nd-ctx')).not.toBeNull();
    expect(p.el.querySelector('pf-hero-band pf-segmented')).toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    const btn = p.actions().find((b) => b.textContent!.includes('Test print'))!;
    btn.click();
    await Promise.resolve();
    expect(p.printer.testPrint).toHaveBeenCalled();
  });

  it('every section is a card in the body at once (web: no Documents card)', () => {
    const p = make();
    const cards = Array.from(p.body()!.querySelectorAll('.nd-card[data-card]')).map((c) => c.getAttribute('data-card'));
    expect(cards).toEqual(['label', 'printer', 'quality']);
    expect(p.body()!.querySelector('.pf-nudge svg')).not.toBeNull();
    expect(p.body()!.querySelector('.pf-lp-label canvas')).not.toBeNull();
  });
});

describe('Admin band — My signature (/signature)', () => {
  const make = (sig: string | null = null) => {
    const auth = {
      user: signal<any>({ tenantName: 'Micro World', signatureDataUrl: sig, registrationId: 'TN-1' }),
      setRegistrationIdLocal: vi.fn(), setSignatureLocal: vi.fn(),
    };
    const p = renderBandPage(MySignatureComponent, { providers: [{ provide: AuthService, useValue: auth }] });
    return { ...p, auth };
  };
  const labels = (p: ReturnType<typeof make>) => p.actions().map((b) => b.getAttribute('aria-label'));

  it('tabs-only pill, header classic-only; no signature → Upload + Draw on the band', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(labels(p)).toEqual(['Upload image', 'Draw signature']);
  });

  it('with a signature → Remove / Upload / Re-draw; Remove calls the API', () => {
    const p = make('data:image/png;base64,xx');
    expect(labels(p)).toEqual(['Remove', 'Upload image', 'Re-draw']);
    p.actions()[0].click();
    expect(p.api.delete).toHaveBeenCalledWith('/api/auth/me/signature');
  });

  it('Registration ID tab swaps the section and its Save rides on the band', () => {
    const p = make();
    expect(p.body()!.querySelector('.pf-sig-input')).toBeNull();
    segBtn(p.tools(), 'Registration ID')!.click();
    p.f.detectChanges();
    const input = p.body()!.querySelector<HTMLInputElement>('.pf-sig-input')!;
    expect(input).not.toBeNull();
    const save = () => p.actions().find((b) => b.getAttribute('aria-label') === 'Save') as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    input.value = 'TN-2';
    input.dispatchEvent(new Event('input'));
    p.f.detectChanges();
    expect(save().disabled).toBe(false);
    save().click();
    expect(p.api.put).toHaveBeenCalledWith('/api/auth/me/registration-id', { registrationId: 'TN-2' });
  });
});
