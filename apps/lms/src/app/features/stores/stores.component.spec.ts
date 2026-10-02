import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin/admin-band.spec-helpers';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { ScanService } from '../../core/services/scan.service';
import { DialogService } from '../../core/services/dialog.service';
import { StoresComponent } from './stores.component';

const items = [
  { id: 'i1', sku: 'EDTA-3', name: 'EDTA tube 3ml', category: 'consumable', uom: 'piece', reorderLevel: 100, onHand: 500, lowStock: false },
  { id: 'i2', sku: 'GLU-R', barcode: 'ITM0000000002', name: 'Glucose reagent', category: 'reagent', uom: 'ml', reorderLevel: 50, nearExpiryDays: 30, isActive: true, onHand: 20, lowStock: true },
  { id: 'i3', sku: 'SST-5', name: 'SST tube 5ml', category: 'consumable', uom: 'piece', reorderLevel: 50, onHand: 0, lowStock: true },
];
const alerts = { lowStock: [{ id: 'i2', name: 'Glucose reagent', onHand: 20, reorderLevel: 50 }], expiring: [{ id: 'b1', item: 'Glucose reagent', lotNumber: 'L1', daysLeft: 4, qtyOnHand: 10 }] };
function TestBed_reset() { TestBed.resetTestingModule(); }
/** Visible primaries (band + kit). */
const primaries = (el: HTMLElement) => el.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary').length;
/** ND hygiene: no native select / datalist, no monospace costume, no emoji glyph icons. */
function hygiene(el: HTMLElement) {
  expect(el.querySelector('select, datalist')).toBeNull();
  expect(el.querySelector('.font-mono, .mono, code')).toBeNull();
  expect(/[✕✓✔⠿●↑↓]/.test(el.textContent ?? '')).toBe(false);
}
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ');

const auth = (perms: string[] | 'all') => ({
  provide: AuthService,
  useValue: {
    user: () => ({ tenantName: 'Micro World', branchName: 'Main', permissions: [] }),
    hasPermission: (p: string) => perms === 'all' || perms.includes(p),
    hasAnyPermission: () => true, isAuthenticated: () => true, waitForAuth: async () => undefined,
  },
});
const scan = (manual: boolean) => ({ provide: ScanService, useValue: { manualEntry: () => manual, scanning: () => false } });

async function render(opts: { items?: unknown[]; perms?: string[] | 'all'; manual?: boolean; providers?: unknown[] } = {}) {
  const p = renderBandPage(StoresComponent, {
    getFor: (url) => url === '/api/inventory/items' ? (opts.items ?? items)
      : url === '/api/inventory/alerts' ? alerts
        : url.endsWith('/batches') ? [{ id: 'b1', lotNumber: 'L1', expiryDate: '2027-01-31T00:00:00Z', qtyOnHand: 300, expired: false }] : [],
    providers: [auth(opts.perms ?? 'all'), scan(!!opts.manual), ...(opts.providers ?? [])],
  });
  await p.f.whenStable(); p.f.detectChanges();
  return p;
}
const waitHold = () => new Promise(r => setTimeout(r, 700));
const tabLabels = (p: { el: HTMLElement }) => Array.from(p.el.querySelectorAll('pf-hero-band .pf-hb__tools pf-segmented button')).map(b => b.getAttribute('aria-label'));

describe('Stores desk — ND band + cards', () => {
  it('band: one field + Overview/Receive/Issue/Count tabs in the pill; Receive stock is the ONE primary; no own title', async () => {
    const p = await render();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()!.placeholder).toContain('Search stock');
    expect(tabLabels(p)).toEqual(['Overview', 'Receive', 'Issue', 'Count']);
    expect(p.el.querySelector('h1')).toBeNull();
    expect(primaries(p.el)).toBe(1);
    expect(p.actions().map(a => text(a).trim())).toEqual(['Manage items', 'Receive stock']);
    hygiene(p.el);
  });

  it('tabs follow the inventory permissions (no Manage items without manage_inventory)', async () => {
    const p = await render({ perms: ['inventory_issue'] });
    expect(tabLabels(p)).toEqual(['Overview', 'Issue']);
    expect(p.actions().map(a => text(a).trim())).toEqual([]);
  });

  it('Overview: STOCK is an AG-Grid fed by the band search + level filter; ATTENTION numbers are neutral with status dots', async () => {
    const p = await render();
    await waitHold(); p.f.detectChanges();
    expect(p.el.querySelector('ag-grid-angular.st-grid')).not.toBeNull();
    expect(p.el.querySelector('table')).toBeNull();
    p.type('glu');
    expect(p.cmp.stockRows().map((i: any) => i.name)).toEqual(['Glucose reagent']);
    p.type('');
    p.cmp.stockStatus.set('out'); p.f.detectChanges();
    expect(p.cmp.stockRows().map((i: any) => i.name)).toEqual(['SST tube 5ml']);
    const filters = Array.from(p.el.querySelectorAll('.st-filter [role="radio"]')).map(b => text(b).trim());
    expect(filters).toEqual(['All 3', 'In stock 1', 'Low 1', 'Out 1']);
    const kpis = p.el.querySelectorAll('.inv-kpi');
    expect(kpis.length).toBe(3);
    expect(Array.from(kpis).map(k => k.querySelector('.nd-sdot')!.getAttribute('data-tone'))).toEqual(['warn', 'bad', 'warn']);
    expect(p.el.querySelector('.kpi--green, .pill--green, .btn--green')).toBeNull();
    expect(text(p.el.querySelector('aside'))).toContain('4 days left');
  });

  it('no items: guides to creating them (link to Admin → Inventory with manage_inventory; truthful copy without)', async () => {
    let p = await render({ items: [] });
    await waitHold(); p.f.detectChanges();
    expect(text(p.body())).toContain('No inventory items yet');
    const link = p.el.querySelector('.pf-band-body a.nd-btn')!;
    expect(text(link).trim()).toBe('Create items');
    expect(link.getAttribute('href')).toBe('/admin/inventory');
    p.cmp.enterAction('receive'); p.f.detectChanges();
    expect(text(p.body())).toContain('No inventory items yet');
    expect(text(p.body())).not.toContain('No items match');

    TestBed_reset();
    p = await render({ items: [], perms: ['inventory_receive'] });
    p.cmp.enterAction('receive'); p.f.detectChanges();
    expect(text(p.body())).toContain('Ask an inventory admin');
    expect(p.el.querySelector('.pf-band-body a.nd-btn')).toBeNull();
  });

  it('Receive: pick an item → side card with the kit date picker (no native date input) and ONE primary that posts the same receive payload', async () => {
    const p = await render();
    p.cmp.enterAction('receive'); p.f.detectChanges();
    expect(p.bandInput()!.placeholder).toContain('Scan a supplier barcode');
    const rows = p.el.querySelectorAll<HTMLButtonElement>('.inv-row');
    expect(rows.length).toBe(3);
    rows[0].click(); p.f.detectChanges();
    const side = p.el.querySelector('aside')!;
    expect(text(side)).toContain('EDTA tube 3ml');
    expect(side.querySelector('pf-nd-date')).not.toBeNull();
    expect(side.querySelector('input[type="date"]:not(.pf-ndd__native)')).toBeNull();
    expect(primaries(p.el)).toBe(1);
    p.cmp.setR('lot', 'L9'); p.cmp.setR('expiry', '2027-05-31'); p.cmp.setR('cost', 4); p.cmp.setR('qty', 10); p.f.detectChanges();
    (p.api.post as any).mockImplementation(() => of({ lotBarcode: 'LOT123' }));
    await p.cmp.doReceive(items[0]);
    expect(p.api.post).toHaveBeenCalledWith('/api/inventory/items/i1/receive', { lotNumber: 'L9', expiryDate: '2027-05-31T00:00:00Z', unitCost: 4, qty: 10 });
    p.f.detectChanges();
    expect(p.el.querySelector('aside pf-barcode-display')).not.toBeNull();
  });

  it('unknown barcode: truthful note; with manage_inventory, Link barcode posts the item with the scanned GTIN; the GS1 lot/expiry still prefill', async () => {
    const p = await render();
    p.cmp.enterAction('receive'); p.f.detectChanges();
    (p.api.post as any).mockImplementation((url: string) => url === '/api/inventory/scan/resolve'
      ? of({ parsed: { raw: '0108901234567890', gtin: '08901234567890', lot: 'GL7', expiry: '2027-03-31T00:00:00', qty: 4 }, item: null, batches: [] })
      : of({ id: 'i1', barcode: '08901234567890' }));
    await p.cmp.resolve('0108901234567890'); p.f.detectChanges();
    expect(text(p.body())).toContain('No item has barcode 08901234567890');
    expect(text(p.body())).not.toContain('pick it below to link');
    p.el.querySelector<HTMLButtonElement>('.inv-row')!.click(); p.f.detectChanges();
    expect(p.cmp.rcv()).toEqual({ lot: 'GL7', expiry: '2027-03-31', cost: 0, qty: 4 });
    const link = Array.from(p.el.querySelectorAll<HTMLButtonElement>('aside button')).find(b => text(b).includes('Link barcode'))!;
    expect(link).toBeTruthy();
    await p.cmp.linkBarcode(items[0]);
    expect(p.api.post).toHaveBeenCalledWith('/api/inventory/items', expect.objectContaining({ id: 'i1', sku: 'EDTA-3', name: 'EDTA tube 3ml', barcode: '08901234567890' }));
    expect(p.cmp.unknown()).toBeNull();
  });

  it('linking over an existing item barcode asks first (DialogService) and does nothing when declined', async () => {
    const confirm = vi.fn(async () => false);
    const p = await render({ providers: [{ provide: DialogService, useValue: { confirm } }] });
    p.cmp.enterAction('receive');
    p.cmp.unknown.set({ raw: 'NEWCODE', code: 'NEWCODE', parsed: null });
    p.api.post.mockClear();
    await p.cmp.linkBarcode(items[1]);
    expect(confirm).toHaveBeenCalled();
    expect(p.api.post).not.toHaveBeenCalled();
  });

  it('without manage_inventory the unknown-barcode copy is truthful and there is no Link button', async () => {
    const p = await render({ perms: ['inventory_receive'] });
    p.cmp.enterAction('receive');
    p.cmp.unknown.set({ raw: 'X12345', code: 'X12345', parsed: null });
    p.cmp.pick(items[0]); p.f.detectChanges();
    expect(text(p.body())).toContain('ask an inventory admin to link it');
    expect(Array.from(p.el.querySelectorAll('aside button')).some(b => text(b).includes('Link barcode'))).toBe(false);
  });

  it('Scan mode: camera in the field + "Scanner ready"; Manual mode (lab setting): no camera, no scanner mark, no gun capture', async () => {
    let p = await render();
    p.cmp.enterAction('issue'); p.f.detectChanges();
    expect(p.el.querySelector('pf-hero-band button[aria-label="Scan with camera"]')).not.toBeNull();
    expect(text(p.body())).toContain('Scanner ready');

    TestBed_reset();
    p = await render({ manual: true });
    p.cmp.enterAction('issue'); p.f.detectChanges();
    expect(p.el.querySelector('pf-hero-band button[aria-label="Scan with camera"]')).toBeNull();
    expect(text(p.body())).not.toContain('Scanner ready');
    expect(p.bandInput()!.placeholder).toContain('Type an item name');
    const spy = vi.spyOn(p.cmp, 'resolve');
    for (const k of ['A', 'B', 'C', 'Enter']) p.cmp.onDocKey(new KeyboardEvent('keydown', { key: k }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('Issue and Count keep their API calls', async () => {
    const p = await render();
    p.cmp.enterAction('issue');
    p.cmp.pick(items[0]); p.cmp.issueQty.set(3); p.f.detectChanges();
    expect(primaries(p.el)).toBe(1);
    await p.cmp.doIssue(items[0]);
    expect(p.api.post).toHaveBeenCalledWith('/api/inventory/issue', { itemId: 'i1', qty: 3 });

    p.cmp.enterAction('count');
    p.cmp.pick(items[0]);
    await p.f.whenStable(); p.f.detectChanges();
    expect(p.el.querySelectorAll('.st-count').length).toBe(1);
    p.cmp.setCount('b1', 290);
    await p.cmp.doCount({ id: 'b1', qtyOnHand: 300, expired: false });
    expect(p.api.post).toHaveBeenCalledWith('/api/inventory/batches/b1/count', { countedQty: 290 });
  });
});
