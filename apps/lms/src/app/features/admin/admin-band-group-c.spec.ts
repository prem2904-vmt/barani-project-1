import { provideHttpClient } from '@angular/common/http';
import { renderBandPage } from './admin-band.spec-helpers';
import { BranchesComponent } from './branches/branches.component';
import { VendorsComponent } from './vendors/vendors.component';
import { ReferralLabsComponent } from './referral-labs/referral-labs.component';
import { ReferringNetworkComponent } from './referring-network/referring-network.component';
import { InventoryComponent } from './inventory/inventory.component';
import { HomeCollectionAgentsComponent } from './home-collection/home-collection-agents.component';

/**
 * Admin band — list pages (group C): each gets a page-specific pill search,
 * its filters in the pill, and its primary button in the band actions. The
 * classic header stays in code as pf-classic-only.
 */
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ');

describe('Admin band — Branches', () => {
  const branches = [
    { id: 'b1', name: 'Main Lab', code: 'MAIN', city: 'Chennai', isActive: true, hasPfBox: false },
    { id: 'b2', name: 'Anna Nagar', code: 'ANN', city: 'Chennai', isActive: true, hasPfBox: false },
    { id: 'b3', name: 'Madurai Centre', code: 'MDU', city: 'Madurai', isActive: true, hasPfBox: false },
  ];
  const render = () => renderBandPage(BranchesComponent, {
    getFor: (url) => url.startsWith('/api/tenants/branches') ? branches
      : url.startsWith('/api/tenants/departments') ? [{ id: 'd1', name: 'Haematology', code: 'HEM', isActive: true }]
          : [],
  });
  const names = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-branch-toggle')).map(b => text(b));

  it('band present, header classic-only, list in the band body', () => {
    const p = render();
    expect(p.band()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.body()!.querySelectorAll('.pf-branch-toggle').length).toBe(3);
  });

  it('"Add branch" rides the band actions and toggles the form (Cancel while open)', () => {
    const p = render();
    const btn = p.actions().find(b => /Add branch/.test(b.textContent ?? ''))!;
    expect(btn).toBeTruthy();
    btn.click(); p.f.detectChanges();
    expect(text(p.body())).toContain('New branch');
    expect(p.actions()[0].textContent).toContain('Cancel');
  });

  it('pill search matches branch fields', () => {
    const p = render();
    p.type('madurai');
    expect(names(p.el).length).toBe(1);
    expect(names(p.el)[0]).toContain('Madurai Centre');
    p.type('ann');
    expect(names(p.el).length).toBe(1);
    expect(names(p.el)[0]).toContain('Anna Nagar');
  });

  it('a department hit keeps every branch (departments are tenant-global)', () => {
    const p = render();
    p.type('haem');
    expect(names(p.el).length).toBe(3);
  });

  it('no match → empty state', () => {
    const p = render();
    p.type('zzz');
    expect(names(p.el).length).toBe(0);
    expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
  });
});

describe('Admin band — Vendors', () => {
  const vendors = [
    { id: 'v1', name: 'Apollo Hospital', code: 'APOLLO', contactName: 'Ravi', isActive: true, totalCredit: 0, usedCredit: 0, balance: 0, outstanding: 0, createdAt: '2026-01-01' },
    { id: 'v2', name: 'Kauvery Clinic', code: 'KAUV', contactName: 'Meena', isActive: true, totalCredit: 0, usedCredit: 0, balance: 0, outstanding: 0, createdAt: '2026-01-01' },
    { id: 'v3', name: 'Old Partner', code: 'OLD', isActive: false, totalCredit: 0, usedCredit: 0, balance: 0, outstanding: 0, createdAt: '2026-01-01' },
  ];
  const render = () => renderBandPage(VendorsComponent, {
    getFor: (url) => url.startsWith('/api/vendors') && !url.includes('/transactions') ? vendors : [],
    providers: [provideHttpClient()],
  });
  const names = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-vendor__name')).map(n => text(n));

  it('band present, header classic-only, status filter inside the pill', () => {
    const p = render();
    expect(p.band()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.tools()!.querySelector('.nd-seg[role="radiogroup"]')).not.toBeNull();
    expect(names(p.el).length).toBe(3);
  });

  it('"Add vendor" in the band opens the form', () => {
    const p = render();
    p.actions().find(b => /Add vendor/.test(b.textContent ?? ''))!.click();
    p.f.detectChanges();
    expect(text(p.body())).toContain('New vendor');
  });

  it('pill search + status filter narrow the list; empty state', () => {
    const p = render();
    p.type('kauv');
    expect(names(p.el)).toEqual(['Kauvery Clinic']);
    p.type('');
    p.cmp.status.set('inactive'); p.f.detectChanges();
    expect(names(p.el)).toEqual(['Old Partner']);
    p.type('apollo');
    expect(names(p.el).length).toBe(0);
    expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
  });
});

describe('Admin band — Referral labs', () => {
  const labs = [
    { id: 'r1', name: 'Apollo Diagnostics', code: 'APOLLO', contactName: 'Suresh', isActive: true, departmentCodesJson: '["MIC"]' },
    { id: 'r2', name: 'Neuberg', code: 'NEU', contactName: 'Priya', isActive: true, departmentCodesJson: null },
  ];
  const render = () => renderBandPage(ReferralLabsComponent, {
    getFor: (url) => url.startsWith('/api/referral-labs') ? labs
      : url.startsWith('/api/tenants/departments') ? [{ id: 'd1', name: 'Microbiology', code: 'MIC', isActive: true }]
        : [],
  });
  const names = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-rl__name')).map(n => text(n));

  it('band present, header classic-only, labs in the band body', () => {
    const p = render();
    expect(p.band()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(names(p.el).length).toBe(2);
  });

  it('"Add referral lab" in the band opens the form and flips to Cancel', () => {
    const p = render();
    p.actions().find(b => /Add referral lab/.test(b.textContent ?? ''))!.click();
    p.f.detectChanges();
    expect(text(p.body())).toContain('New referral lab');
    expect(p.actions()[0].textContent).toContain('Cancel');
  });

  it('pill search matches name, contact and handled department names; empty state', () => {
    const p = render();
    p.type('priya');
    expect(names(p.el)).toEqual(['Neuberg']);
    p.type('microbio');
    expect(names(p.el)).toEqual(['Apollo Diagnostics']);
    p.type('zzz');
    expect(names(p.el).length).toBe(0);
    expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
  });
});

describe('Admin band — Referring network', () => {
  const hospitals = [
    { id: 'h1', name: 'Apollo Hospitals', code: 'APO', address: 'Greams Road', isActive: true, doctorCount: 3 },
    { id: 'h2', name: 'MIOT International', code: 'MIOT', address: 'Manapakkam', isActive: true, doctorCount: 1 },
  ];
  const render = async () => {
    const p = renderBandPage(ReferringNetworkComponent, {
      getFor: (url) => url.startsWith('/api/referring-network/hospitals') ? hospitals : [],
    });
    await p.f.whenStable();
    p.f.detectChanges();
    return p;
  };
  const names = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-rn-row__name')).map(n => text(n));

  it('band present, header classic-only, the pane search box is classic-only', async () => {
    const p = await render();
    expect(p.band()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.el.querySelector('.pf-rn-search')!.classList.contains('pf-classic-only')).toBe(true);
    expect(names(p.el).length).toBe(2);
  });

  it('an open editor modal owns the ONE primary: the band "Add hospital" steps down + disables', async () => {
    const p = await render();
    const add = () => p.el.querySelector<HTMLButtonElement>('pf-hero-band .pf-rn-add')!;
    expect(add().classList.contains('pf-hb-btn--primary')).toBe(true);
    add().click();
    p.f.detectChanges();
    expect(add().classList.contains('pf-hb-btn--primary')).toBe(false);
    expect(add().classList.contains('pf-hb-btn--ghost')).toBe(true);
    expect(add().disabled).toBe(true);
    const primaries = p.el.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary');
    expect(primaries.length).toBe(1);
    expect(primaries[0].closest('.pf-rn-modal__ftr')).not.toBeNull();
    p.cmp.closeHospitalEditor();
    p.f.detectChanges();
    expect(add().classList.contains('pf-hb-btn--primary')).toBe(true);
  });

  it('"Add hospital" in the band opens the hospital editor', async () => {
    const p = await render();
    p.actions().find(b => /Add hospital/.test(b.textContent ?? ''))!.click();
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-rn-modal')).not.toBeNull();
  });

  it('the pill search filters hospitals (name, code, address); empty state', async () => {
    const p = await render();
    p.type('manapakkam');
    expect(names(p.el)).toEqual(['MIOT International']);
    p.type('zzz');
    expect(names(p.el).length).toBe(0);
    expect(text(p.body())).toContain('No hospitals match');
  });
});

describe('Admin band — Inventory', () => {
  const items = [
    { id: 'i1', sku: 'EDTA-3', name: 'EDTA tube 3ml', category: 'consumable', uom: 'piece', reorderLevel: 100, nearExpiryDays: 30, isActive: true, onHand: 500, lowStock: false },
    { id: 'i2', sku: 'GLU-R', name: 'Glucose reagent', category: 'reagent', uom: 'ml', reorderLevel: 50, nearExpiryDays: 30, isActive: true, onHand: 20, lowStock: true },
  ];
  const render = async () => {
    const p = renderBandPage(InventoryComponent, {
      getFor: (url) => url === '/api/inventory/items' ? items
        : url === '/api/inventory/alerts' ? { lowStock: [], expiring: [] }
          : url === '/api/tests/' ? [{ id: 't1', name: 'CBC' }, { id: 't2', name: 'Glucose' }]
            : [],
    });
    await p.f.whenStable();
    p.f.detectChanges();
    return p;
  };
  const rows = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr td:first-child .pf-inv-name')).map(b => text(b));

  it('band present, custom header classic-only, tabs + category filter in the pill', async () => {
    const p = await render();
    expect(p.band()).not.toBeNull();
    expect(p.el.querySelector('h1')!.closest('.pf-classic-only')).not.toBeNull();
    expect(p.tools()!.querySelector('pf-segmented')).not.toBeNull();
    expect(p.tools()!.querySelector('pf-select')).not.toBeNull();
    expect(rows(p.el).length).toBe(2);
  });

  it('"New item" in the band opens the item form', async () => {
    const p = await render();
    p.actions().find(b => /New item/.test(b.textContent ?? ''))!.click();
    p.f.detectChanges();
    expect(text(p.body())).toContain('New item');
    expect(p.body()!.querySelector('select')).toBeNull();
  });

  it('pill search + category narrow the items; empty state', async () => {
    const p = await render();
    p.type('edta');
    expect(rows(p.el)).toEqual(['EDTA tube 3ml']);
    p.type('');
    p.cmp.category.set('reagent'); p.f.detectChanges();
    expect(rows(p.el)).toEqual(['Glucose reagent']);
    p.type('edta');
    expect(rows(p.el).length).toBe(0);
    expect(text(p.body())).toContain('No items match');
  });

  it('Test consumables tab: tabs-only pill with the test picker; items table hidden', async () => {
    const p = await render();
    p.cmp.setTab('bom'); p.f.detectChanges();
    expect(p.bandInput()).toBeNull();
    expect(p.el.querySelector('.pf-hb__search--tabs')).not.toBeNull();
    expect(p.tools()!.querySelector('.pf-inv-bandsel--test')).not.toBeNull();
    expect(p.body()!.querySelector('table')).toBeNull();
    expect(text(p.body())).toContain('Per-test consumables');
  });
});

describe('Admin band — Home-collection agents', () => {
  const agents = [
    { id: 'a1', userId: 'u1', branchId: 'b1', areaMode: 'pincode', pincodesJson: '["600040","600041"]', weightage: 2, isActive: true, user: { id: 'u1', name: 'Karthik', email: 'karthik@lab.in' } },
    { id: 'a2', userId: 'u2', branchId: 'b1', areaMode: 'radius', centerLat: 13.08, centerLng: 80.27, radiusKm: 5, weightage: 1, isActive: true, user: { id: 'u2', name: 'Lakshmi', email: 'lakshmi@lab.in' } },
  ];
  const render = () => renderBandPage(HomeCollectionAgentsComponent, {
    getFor: (url) => url.startsWith('/api/home-collection/agents') ? agents : [],
  });
  const names = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-band-body .pf-hc-name')).map(n => text(n));

  it('band present, header classic-only, agents in the band body', () => {
    const p = render();
    expect(p.band()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(names(p.el)).toEqual(['Karthik', 'Lakshmi']);
  });

  it('"Add agent" in the band opens the form and flips to Cancel', () => {
    const p = render();
    p.actions().find(b => /Add agent/.test(b.textContent ?? ''))!.click();
    p.f.detectChanges();
    expect(text(p.body())).toContain('New agent');
    expect(p.actions()[0].textContent).toContain('Cancel');
  });

  it('pill search matches name and covered pincodes; empty state', () => {
    const p = render();
    p.type('600041');
    expect(names(p.el)).toEqual(['Karthik']);
    p.type('lakshmi');
    expect(names(p.el)).toEqual(['Lakshmi']);
    p.type('zzz');
    expect(names(p.el).length).toBe(0);
    expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
  });
});
