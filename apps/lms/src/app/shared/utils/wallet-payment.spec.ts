import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { firstValueFrom, of } from 'rxjs';
import { payBillFromWallet, WalletPaymentApi, WalletPaymentResult } from './wallet-payment';

describe('payBillFromWallet (H8 — one call, one transaction)', () => {
  const result = { bill: { id: 'b1', balance: 0 }, vendor: { id: 'v1', usedCredit: 100 } } as unknown as WalletPaymentResult;

  function fakeApi() {
    const calls: { path: string; body: any }[] = [];
    const api: WalletPaymentApi = {
      post: <T>(path: string, body: unknown) => { calls.push({ path, body }); return of(result as unknown as T); },
    };
    return { api, calls };
  }

  it('posts ONCE to the bill wallet-payment endpoint — never to /vendors/{id}/charge', async () => {
    const { api, calls } = fakeApi();
    const r = await firstValueFrom(payBillFromWallet(api, 'b1', 'v1', 100, { referenceNo: 'REF', reason: 'Bill #INV-1' }));
    expect(r).toBe(result);
    expect(calls).toEqual([{ path: '/api/billing/b1/wallet-payment', body: { vendorId: 'v1', amount: 100, referenceNo: 'REF', reason: 'Bill #INV-1' } }]);
    expect(calls.some(c => c.path.includes('/charge'))).toBe(false);
  });

  it('falls back to the vendor id as the reference, like the old payment call', async () => {
    const { api, calls } = fakeApi();
    await firstValueFrom(payBillFromWallet(api, 'b2', 'v9', 42.5));
    expect(calls[0].body).toEqual({ vendorId: 'v9', amount: 42.5, referenceNo: 'v9', reason: null });
  });
});

describe('Every wallet-paying screen uses the single call (H8)', () => {
  const root = resolve(process.cwd(), 'apps/lms/src/app');
  const screens = [
    'features/billing-counter/billing-counter.component.ts',
    'features/frontdesk/order-create/order-create.component.ts',
    'features/frontdesk/billing/billing.component.ts',
  ];
  for (const rel of screens) {
    it(`${rel.split('/').pop()} never makes the old charge-then-pay pair`, () => {
      const src = readFileSync(resolve(root, rel), 'utf8');
      expect(src).not.toMatch(/\/api\/vendors\/\$\{[^}]+\}\/charge/);
      expect(src).not.toMatch(/mode:\s*'wallet'/);
      expect(src).toContain('payBillFromWallet(');
    });
  }
});
