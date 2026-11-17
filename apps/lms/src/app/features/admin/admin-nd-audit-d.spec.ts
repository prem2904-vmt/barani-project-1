import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { renderBandPage } from './admin-band.spec-helpers';
import { CultureSettingsComponent } from '../lab/culture-settings/culture-settings.component';
import { OpdSettingsComponent } from '../opd/admin/opd-settings.component';
import { ModulePlaceholderComponent } from '../modules/module-placeholder.component';
import { AdminOverviewComponent } from './admin-overview.component';
import { BranchesComponent } from './branches/branches.component';
import { VendorsComponent } from './vendors/vendors.component';
import { ReferralLabsComponent } from './referral-labs/referral-labs.component';
import { ReferringNetworkComponent } from './referring-network/referring-network.component';
import { InventoryComponent } from './inventory/inventory.component';
import { AppointmentsConfigComponent } from './appointments-config/appointments-config.component';
import { HomeCollectionAgentsComponent } from './home-collection/home-collection-agents.component';
import { LabSettingsComponent } from './lab-settings/lab-settings.component';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { signal } from '@angular/core';
import { AppointmentQueueService } from '../../core/services/appointment-queue.service';
import { of } from 'rxjs';
import { provideHttpClient } from '@angular/common/http';

/**
 * /admin ND audit (fork D) — the CURRENT PF-PATTERN on hubs, list pages and
 * settings pages: ONE primary per view (in the band), the pill = context bar
 * (search on lists, identity chips on single-record pages), kit cards / fields,
 * slate switches (role=switch), neutral segments, no monospace / green / amber
 * classes, no native select, no emoji glyphs.
 */
export const EMOJI = /[✕✓✔⠿●↑↓]/;
export function hygiene(el: HTMLElement) {
  expect(el.querySelector('select, datalist')).toBeNull();
  expect(el.querySelector('.font-mono, .mono, code, .c-green, .c-amber')).toBeNull();
  expect(el.querySelector('input[type="checkbox"]:not(.pf-te2-srcheck)')).toBeNull();
  expect(EMOJI.test(el.textContent ?? '')).toBe(false);
}
/** Visible primaries (the classic header stays in code as .pf-classic-only). */
export const primaries = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('.pf-hb-btn--primary, .pf-btn--primary, pf-touch-btn .v-primary'))
    .filter(b => !b.closest('.pf-classic-only')).length;

describe('ND audit D — settings pages (Microbiology, OPD settings)', () => {
  it('Microbiology: pf-card sections, slate supervisor switch, kit number fields, ONE primary (band Save)', () => {
    const p = renderBandPage(CultureSettingsComponent, {
      getFor: () => ({ lockTimeoutMinutes: 60, allowSupervisorTakeover: true, stageTats: [{ stageKey: 'gram', tatHours: 4 }] }),
    });
    expect(primaries(p.el)).toBe(1);
    expect(p.actions()[0].className).toContain('pf-hb-btn--primary');
    const card = p.el.querySelector('.pf-band-body .pf-card')!;
    expect(card.querySelector('.pf-card__head .pf-card__icon')).not.toBeNull();
    const sw = card.querySelector<HTMLButtonElement>('.pf-toggle[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click(); p.f.detectChanges();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(card.querySelector('input.pf-input.pf-num')).not.toBeNull();
    hygiene(p.el);
  });

  it('OPD settings: tiers are a kit card with kit fields and an SVG remove, ONE primary', () => {
    const p = renderBandPage(OpdSettingsComponent, {
      getFor: () => ({ followUpMode: 'auto', tiers: [{ withinDays: 7, discountPercent: 50 }] }),
    });
    expect(primaries(p.el)).toBe(1);
    const card = p.el.querySelector('.pf-os__card.pf-card')!;
    expect(card).not.toBeNull();
    expect(card.querySelectorAll('input.pf-input.pf-num').length).toBe(2);
    expect(card.querySelector('.pf-os__del svg')).not.toBeNull();
    hygiene(p.el);
  });
});

describe('ND audit D — module placeholders (/admin/ipd …)', () => {
  it('get the band (back · tenant) and a context bar: module name + status chips; no title block', () => {
    const p = renderBandPage(ModulePlaceholderComponent, {
      providers: [{ provide: ActivatedRoute, useValue: { snapshot: { data: { moduleId: 'pharmacy' } } } }],
    });
    expect(p.band()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    const ctx = p.el.querySelector('pf-hero-band .pf-ctx')!;
    expect(ctx.querySelector('.pf-ctx__primary')!.textContent).toContain('Pharmacy');
    expect(ctx.textContent).toContain('Coming soon');
    expect(p.body()!.querySelector('.pf-card')).not.toBeNull();
    expect(primaries(p.el)).toBe(0);
    hygiene(p.el);
    TestBed.resetTestingModule();
  });
});

describe('ND audit D — Settings overview (/admin, two panels)', () => {
  it('Overview: the pill is the settings search only (no date range / KPI cards), two kit cards, no rainbow chips', () => {
    const p = renderBandPage(AdminOverviewComponent);
    expect(p.tools()?.querySelector('.pf-seg')).toBeNull();
    expect(p.el.querySelector('.pf-ov__kpi, .pf-ov__stat, .pf-ov__range')).toBeNull();
    expect(p.body()).not.toBeNull();
    expect(p.body()!.querySelector('pf-two-panel .pf-tp__nav.pf-card')).not.toBeNull();
    expect(p.body()!.querySelector('pf-two-panel .pf-tp__panel.pf-card')).not.toBeNull();
    expect(p.body()!.querySelector('.pf-ov__tile .pf-card__icon')).not.toBeNull();
    expect(p.el.querySelector('[data-color], [data-g]')).toBeNull();
    expect(primaries(p.el)).toBe(0);
    hygiene(p.el);
  });
});

describe('ND audit D — Branches', () => {
  const branches = [
    { id: 'b1', name: 'Main Lab — Anna Nagar Collection Centre', code: 'MAIN', city: 'Chennai', isActive: true, hasPfBox: true },
  ];
  const render = () => renderBandPage(BranchesComponent, {
    getFor: (url) => url.startsWith('/api/tenants/branches') ? branches
      : url.startsWith('/api/tenants/departments') ? [{ id: 'd1', name: 'Haematology', code: 'HEM', isActive: true }] : [],
  });

  it('ONE primary: "Add branch" in the band; while the form is open the band turns Cancel and "Create branch" is the primary', () => {
    const p = render();
    expect(primaries(p.el)).toBe(0);   // Settings: no violet primary — the action is a secondary in the pane
    p.cmp.toggleNewBranch(); p.f.detectChanges();
    expect(primaries(p.el)).toBe(1);
    const form = p.el.querySelector('.pf-br-new.pf-card')!;
    expect(form.querySelector('.pf-card__head .pf-card__icon')).not.toBeNull();
    expect(form.querySelectorAll('input.pf-input').length).toBe(4);
    expect(form.querySelector('.pf-btn--primary')!.textContent).toContain('Create branch');
    expect(p.actions()[0].classList.contains('pf-sg-act')).toBe(true);
  });

  it('branches grid: full names (wrap, never truncated); no sub-branch section; no × / → glyphs; PF Box under the name', () => {
    const p = render();
    expect(p.el.querySelector('.pf-br-main.pf-card pf-data-grid')).not.toBeNull();
    expect(p.el.querySelector('.pf-trunc')).toBeNull();
    const name = p.cmp.colDefs().find((c: any) => c.colId === 'name').cellRenderer({ data: branches[0] }) as HTMLElement;
    expect(name.textContent).toContain('Anna Nagar Collection Centre');
    expect(name.textContent).toContain('PF Box');
    expect(p.el.textContent).not.toMatch(/[×→]/);
    expect(p.el.textContent).not.toMatch(/sub-branch/i);
    expect(p.el.querySelector('.pf-board')).toBeNull();
    hygiene(p.el);
  });
});

describe('ND audit D — Vendors', () => {
  const vendors = [
    { id: 'v1', name: 'Apollo Hospital', code: 'APOLLO', contactName: 'Ravi', gstin: '33ABCDE1234F1Z5', isActive: true, totalCredit: 0, usedCredit: 500, balance: 0, outstanding: -200, createdAt: '2026-01-01' },
    { id: 'v2', name: 'Old Partner', code: 'OLD', isActive: false, totalCredit: 0, usedCredit: 0, balance: 0, outstanding: 0, createdAt: '2026-01-01' },
  ];
  const render = () => renderBandPage(VendorsComponent, {
    getFor: (url) => url.startsWith('/api/vendors') && !url.includes('/transactions') ? vendors : [],
    providers: [provideHttpClient()],
  });

  it('ONE primary (band "Add vendor"); row actions are kit .pf-rowact (text on web, quiet icons for the rest) in a Test Master grid', () => {
    const p = render();
    expect(primaries(p.el)).toBe(0);   // Settings: no violet primary — the action is a secondary in the pane
    expect(p.el.querySelector('.pf-sg-main ag-grid-angular')).not.toBeNull();
    const cell = p.cmp.colDefs().find((c: any) => c.colId === 'actions').cellRenderer({ data: vendors[0] }) as HTMLElement;
    const acts = cell.querySelectorAll('.pf-rowact');
    expect(Array.from(acts).map(a => a.querySelector('.pf-rowact__t')!.textContent!.trim()))
      .toEqual(['Top up', 'Record payment', 'Email statement', 'View history', 'Edit', 'Deactivate']);
    expect(Array.from(acts).every(a => !!a.querySelector('svg[aria-hidden="true"]'))).toBe(true);
    p.cmp.openTopUp(vendors[0]); p.f.detectChanges();
    expect(p.el.querySelector('.pf-sg-side .pf-topup')).not.toBeNull();
    expect(primaries(p.el)).toBe(0);   // Settings: no violet primary — the action is a secondary in the pane
    hygiene(p.el);
  });

  it('new-vendor editor = kit side card (LEFT) with kit fields; the band button becomes a quiet Cancel', () => {
    const p = render();
    p.cmp.toggleNewVendor(); p.f.detectChanges();
    const form = p.el.querySelector('.pf-sg-side.pf-card')!;
    expect(p.el.querySelector('.pf-sg-panels')!.firstElementChild).toBe(form);
    expect(form.querySelector('.pf-card__head .pf-card__icon')).not.toBeNull();
    expect(form.querySelectorAll('input.pf-input').length).toBeGreaterThanOrEqual(8);
    expect(primaries(p.el)).toBe(1);
    expect(p.actions()[0].classList.contains('pf-sg-act')).toBe(true);
  });

  it('palette: status = neutral pill, in-credit = violet, due = warning tone, filter = Test Master segmented in the card head', () => {
    const p = render();
    const out = p.cmp.colDefs().find((c: any) => c.colId === 'outstanding').cellRenderer;
    expect((out({ data: vendors[0] }) as HTMLElement).querySelector('.pf-sg-tone--credit')!.textContent).toContain('in credit');
    expect((out({ data: { ...vendors[0], outstanding: 3 } }) as HTMLElement).querySelector('.pf-sg-tone--warn')!.textContent).toContain('due');
    expect((out({ data: { ...vendors[0], outstanding: 0 } }) as HTMLElement).querySelector('.pf-sg-tone--muted')!.textContent).toBe('Settled');
    const pill = p.cmp.colDefs().find((c: any) => c.colId === 'status').cellRenderer({ data: vendors[1] }) as HTMLElement;
    expect(pill.textContent).toBe('Inactive');
    expect(p.el.querySelector('.pf-sg-main__head pf-segmented')).not.toBeNull();
    expect(p.el.querySelector('pf-chip, pf-tile')).toBeNull();
  });
});

describe('ND audit D — Referral labs', () => {
  const labs = [
    { id: 'r1', name: 'Apollo Diagnostics', code: 'APOLLO', contactName: 'Suresh', isActive: true, departmentCodesJson: '["MIC"]' },
    { id: 'r2', name: 'Neuberg', code: 'NEU', isActive: false, departmentCodesJson: null },
  ];
  const render = () => renderBandPage(ReferralLabsComponent, {
    getFor: (url) => url.startsWith('/api/referral-labs') ? labs
      : url.startsWith('/api/tenants/departments') ? [{ id: 'd1', name: 'Microbiology', code: 'MIC', isActive: true }] : [],
  });

  it('ONE primary; Edit / Deactivate are quiet same-size icon .pf-rowact; code column tabular; departments as neutral chips', () => {
    const p = render();
    expect(primaries(p.el)).toBe(0);   // Settings: no violet primary — the action is a secondary in the pane
    const cols = p.cmp.colDefs();
    const acts = cols.find((c: any) => c.colId === 'actions').cellRenderer({ data: labs[0] }) as HTMLElement;
    const btns = Array.from(acts.querySelectorAll('.pf-rowact'));
    expect(btns.map(t => t.querySelector('.pf-rowact__t')!.textContent!.trim())).toEqual(['Edit', 'Deactivate']);
    expect(btns.every(b => b.classList.contains('pf-rowact--icon'))).toBe(true);
    expect(cols.find((c: any) => c.colId === 'code').cellClass).toBe('pf-num');
    const depts = cols.find((c: any) => c.colId === 'departments').cellRenderer({ data: labs[0] }) as HTMLElement;
    expect(depts.textContent).toContain('Microbiology');
    hygiene(p.el);
  });

  it('edit opens the kit-card editor; dept chips use the NEUTRAL aria-pressed state (no --on gradient)', () => {
    const p = render();
    p.cmp.edit(labs[0]); p.f.detectChanges();
    const form = p.el.querySelector('.pf-rl-form.pf-card.pf-sg-side')!;
    expect(form.querySelector('.pf-card__label')!.textContent).toContain('Edit referral lab');
    const chip = form.querySelector('.pf-dept-chip')!;
    expect(chip.classList.contains('pf-chip')).toBe(true);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(form.querySelector('[class*="--on"]')).toBeNull();
    expect(primaries(p.el)).toBe(1);
  });
});

describe('ND audit D — Referring network', () => {
  const hospitals = [
    { id: 'h1', name: 'Apollo Hospitals', code: 'APO', address: 'Greams Road', isActive: true, doctorCount: 1 },
  ];
  const doctors = [{ id: 'd1', hospitalId: 'h1', name: 'Dr. Priya Krishnan', designation: 'Consultant', registrationNo: 'TN-12345', isActive: true }];
  const render = async () => {
    const p = renderBandPage(ReferringNetworkComponent, {
      getFor: (url) => url.startsWith('/api/referring-network/hospitals') && !url.includes('/doctors') ? hospitals
        : url.includes('doctors') ? doctors : [],
    });
    await p.f.whenStable(); p.f.detectChanges();
    return p;
  };

  it('ONE grid card (no nested panes); quiet same-size icon actions; Remove from a hospital only when filtered to it; ONE primary', async () => {
    const p = await render();
    expect(p.el.querySelectorAll('.pf-rn-pane').length).toBe(0);
    expect(p.el.querySelector('.pf-sg-main .pf-card__head .pf-card__icon')).not.toBeNull();
    const acts = (d: any) => p.cmp.doctorActions(d).map((a: any) => a.label);
    expect(acts(doctors[0])).toEqual(['Edit', 'Deactivate']);
    p.cmp.setHospitalFilter('h1'); p.f.detectChanges();
    expect(acts(doctors[0])).toEqual(['Edit', 'Remove', 'Deactivate']);
    expect(p.cmp.doctorActions(doctors[0]).every((a: any) => a.icon)).toBe(true);
    expect(primaries(p.el)).toBe(0);   // Settings: no violet primary — the action is a secondary in the pane
    hygiene(p.el);
  });

  it('the hospital editor is an pf-card modal (BILLING header, kit fields, ONE primary in the footer)', async () => {
    const p = await render();
    p.cmp.openHospitalEditor(null); p.f.detectChanges();
    const m = p.el.querySelector('.pf-rn-modal.pf-card[role="dialog"]')!;
    expect(m.querySelector('.pf-card__head .pf-card__icon')).not.toBeNull();
    expect(m.querySelectorAll('input.pf-input').length).toBeGreaterThanOrEqual(5);
    expect(m.querySelectorAll('.pf-btn--primary').length).toBe(1);
  });
});

describe('ND audit D — Inventory', () => {
  const items = [
    { id: 'i1', sku: 'EDTA-3', name: 'EDTA tube 3ml', category: 'consumable', uom: 'piece', reorderLevel: 100, nearExpiryDays: 30, isActive: true, onHand: 500, lowStock: false },
    { id: 'i2', sku: 'GLU-R', name: 'Glucose reagent', category: 'reagent', uom: 'ml', reorderLevel: 50, nearExpiryDays: 30, isActive: true, onHand: 20, lowStock: true },
  ];
  const render = async () => {
    const p = renderBandPage(InventoryComponent, {
      getFor: (url) => url === '/api/inventory/items' ? items
        : url === '/api/inventory/alerts' ? { lowStock: [{ id: 'i2', name: 'Glucose reagent', onHand: 20, reorderLevel: 50 }], expiring: [] } : [],
    });
    await p.f.whenStable(); p.f.detectChanges();
    return p;
  };

  it('ONE primary (band New item); the item grid is AG-Grid; nothing picked = ATTENTION side card with neutral numbers + status dots', async () => {
    const p = await render();
    expect(primaries(p.el)).toBe(1);
    expect(p.actions()[0].className).toContain('pf-hb-btn--primary');
    expect(p.el.querySelector('ag-grid-angular.pf-inv-grid')).not.toBeNull();
    const side = p.el.querySelector('.pf-inv-side.pf-card')!;
    expect(side.querySelector('.pf-card__icon')).not.toBeNull();
    expect(side.textContent).toContain('Attention');
    expect(side.querySelector('.pf-sdot[data-tone="warn"]')).not.toBeNull();
    expect(side.textContent).toContain('Glucose reagent');
    // No off-palette status pills / fills.
    expect(p.el.querySelector('.pill--green, .pill--amber, .pill--red, .kpi--green')).toBeNull();
    hygiene(p.el);
  });

  it('picking an item opens the ITEM side card (Batches · Receive · Label · Ledger) with ONE primary; the band New item turns ghost', async () => {
    const p = await render();
    p.cmp.selectItem(items[0]); p.f.detectChanges();
    await p.f.whenStable(); p.f.detectChanges();
    const side = p.el.querySelector('.pf-inv-side')!;
    expect(side.textContent).toContain('EDTA tube 3ml');
    const secs = Array.from(side.querySelectorAll('.pf-inv-sections [role="radio"]')).map(b => b.textContent!.trim());
    expect(secs).toEqual(['Batches', 'Receive', 'Label', 'Ledger']);
    expect(primaries(p.el)).toBe(1);
    expect(side.querySelector('.pf-card__foot .pf-btn--primary')!.textContent).toContain('Receive stock');
    expect(p.actions()[0].className).toContain('pf-hb-btn--ghost');
    expect(p.api.get).toHaveBeenCalledWith('/api/inventory/items/i1/batches');

    // Receive: the kit date picker (never a native date input), Add stock is the primary once a quantity is in.
    p.cmp.openReceive(items[0]); p.cmp.setR('qty', 5); p.f.detectChanges();
    expect(side.querySelector('pf-date')).not.toBeNull();
    expect(side.querySelector('input[type="date"]:not(.pf-date__native)')).toBeNull();
    expect(primaries(p.el)).toBe(1);
    expect(side.querySelector('.pf-card__foot .pf-btn--primary')!.textContent).toContain('Add stock');

    // Ledger reads the item ledger endpoint.
    p.cmp.setSection(items[0], 'ledger'); p.f.detectChanges();
    expect(p.api.get).toHaveBeenCalledWith('/api/inventory/items/i1/ledger?take=50');
    hygiene(p.el);
  });

  it('item editor = the side card with kit fields (incl. Barcode) + a slate Active switch; the band turns ghost so Save is the one primary', async () => {
    const p = await render();
    p.cmp.startNew(); p.f.detectChanges();
    const ed = p.el.querySelector('.pf-inv-side.pf-card')!;
    expect(ed.querySelectorAll('input.pf-input').length).toBeGreaterThanOrEqual(5);
    expect(ed.querySelector('#pf-inv-barcode')).not.toBeNull();
    const sw = ed.querySelector<HTMLButtonElement>('.pf-toggle[role="switch"]')!;
    expect(sw).not.toBeNull();
    expect(primaries(p.el)).toBe(1);
    expect(ed.querySelector('.pf-btn--primary')).not.toBeNull();
    hygiene(p.el);
  });

  it('the label type switch is a neutral pf-seg (no gradient --on)', async () => {
    const p = await render();
    p.cmp.showLabel(items[0]); p.f.detectChanges();
    const seg = p.el.querySelector('.label-wrap .pf-seg[role="radiogroup"]');
    if (seg) {
      expect(seg.querySelectorAll('[role="radio"]').length).toBe(3);
      expect(p.el.querySelector('.seg__i--on')).toBeNull();
    }
  });
});

describe('ND audit D — Appointments & queue', () => {
  const cfg = {
    queueMode: 'token_queue', slotMinutes: 30, maxConcurrentSlots: 1, open24h: true, weeklyScheduleJson: null,
    queueOptions: { baseAppointment: 100, baseWalkin: 50, baseFollowup: 80, waitWeight: 1, appointmentGraceMinutes: 10,
      latePenalty: 50, noShowThresholdMinutes: 30, avgCollectionMinutes: 5, urgentOverrideScore: 1000 },
  };
  const render = () => renderBandPage(AppointmentsConfigComponent, {
    providers: [{ provide: AppointmentQueueService, useValue: { getConfig: vi.fn(() => of(cfg)), saveConfig: vi.fn((c: unknown) => of(c)) } }],
  });

  it('queue mode = neutral selected tiles (role=radio), kit card, ONE primary', () => {
    const p = render();
    expect(primaries(p.el)).toBe(1);
    const card = p.el.querySelector('pf-setting-group.pf-ap-card')!;
    expect(card.querySelector('.pf-sgroup__label')?.textContent).toContain('Queue mode');
    // ONE row: the modes are a segmented control (neutral selected state)
    const radios = card.querySelectorAll('pf-segmented [role="radio"]');
    expect(radios.length).toBeGreaterThanOrEqual(2);
    expect(card.querySelectorAll('pf-segmented [role="radio"][aria-checked="true"]').length).toBe(1);
    expect(p.el.querySelector('pf-tile')).toBeNull();
    hygiene(p.el);
  });

  it('Open 24×7 is a slate switch; turning it off shows kit time fields', () => {
    const p = render();
    p.cmp.tab.set('slots'); p.f.detectChanges();
    const sw = p.el.querySelector<HTMLButtonElement>('.pf-toggle[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click(); p.f.detectChanges();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    // Kit time field (pf-time): a typed hh:mm box, never a visible
    // native time input (one hidden native sits behind it for the picker).
    expect(p.el.querySelectorAll('pf-time').length).toBe(2);
    expect(p.el.querySelectorAll('input.pf-time__in').length).toBe(2);
    hygiene(p.el);
  });
});

describe('ND audit D — Home-collection agents', () => {
  const agents = [{ id: 'a1', userId: 'u1', areaMode: 'pincode', pincodesJson: '["600001","600028"]', weightage: 2, isActive: true,
    user: { name: 'Karthikeyan Subramaniam Ramasamy', email: 'k@x.in' } }];
  const render = () => renderBandPage(HomeCollectionAgentsComponent, {
    providers: [{ provide: AppointmentQueueService, useValue: { listAgents: vi.fn(() => of(agents)), upsertAgent: vi.fn(() => of({})), removeAgent: vi.fn(() => of({})),
      getConfig: vi.fn(() => of({ queueMode: 'token_queue' })), saveConfig: vi.fn(() => of({ queueMode: 'home_collection' })) } }],
  });

  it('agents grid: full name (wraps, no truncate), weight column, Edit / Remove kit .pf-rowact; ONE primary', () => {
    const p = render();
    expect(primaries(p.el)).toBe(0);   // Settings: no violet primary — the action is a secondary in the pane
    const cols = p.cmp.colDefs();
    const name = cols.find((c: any) => c.colId === 'agent').cellRenderer({ data: agents[0] }) as HTMLElement;
    expect(name.textContent).toContain('Karthikeyan Subramaniam Ramasamy');
    expect(name.querySelector('.truncate')).toBeNull();
    expect(cols.find((c: any) => c.colId === 'weight').headerName).toBe('Share of work');
    const acts = cols.find((c: any) => c.colId === 'actions').cellRenderer({ data: agents[0] }) as HTMLElement;
    expect(Array.from(acts.querySelectorAll('.pf-rowact .pf-rowact__t')).map(t => t.textContent!.trim())).toEqual(['Edit', 'Remove']);
    hygiene(p.el);
  });

  it('the branch switch is ONE compact strip above the grid (switch | Available · This branch)', () => {
    const p = render();
    const strip = p.el.querySelector('[data-testid="hc-switch-card"]')!;
    expect(strip.classList.contains('pf-hs-strip')).toBe(true);
    expect(strip.querySelector('[role="switch"]')).not.toBeNull();
    expect(strip.textContent).toContain('This branch: Not running');
  });

  it('agent editor = kit card; coverage is a neutral pf-seg; the band turns a quiet Cancel', () => {
    const p = render();
    p.cmp.toggleForm(); p.f.detectChanges();
    const form = p.el.querySelector('.pf-hc-form.pf-card.pf-sg-side')!;
    expect(form.querySelectorAll('.pf-seg [role="radio"]').length).toBe(2);
    expect(form.querySelector('input.pf-input')).not.toBeNull();
    expect(primaries(p.el)).toBe(1);
    expect(p.actions()[0].classList.contains('pf-sg-act')).toBe(true);
    hygiene(p.el);
  });
});

describe('ND audit D — Lab settings', () => {
  const render = () => renderBandPage(LabSettingsComponent, {
    getFor: (url) => (url === '/api/tenants/branch-lab-config' ? { labStructure: 'auto' } : []),
    providers: [
      { provide: AuthService, useValue: { user: () => ({ tenantName: 'Micro World', branchId: null, permissions: [] }), activeBranchId: () => null,
        hasPermission: () => true, hasAnyPermission: () => true, isAuthenticated: () => true, waitForAuth: async () => undefined } },
      { provide: TenantStateService, useValue: { tenant: () => null, ensureLoaded: vi.fn(), update: vi.fn() } },
      { provide: BranchLabConfigService, useValue: { collectionMode: signal('front_desk'), billingMode: signal('front_desk'), ensureLoaded: vi.fn(), update: vi.fn() } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
    ],
  });

  it('autosave is stated (neutral + violet check); no primary; cards have the BILLING header', () => {
    const p = render();
    const st = p.el.querySelector('.pf-savestate')!;
    expect(st.textContent).toContain('Changes save automatically');
    expect(st.querySelector('svg')).not.toBeNull();
    expect(primaries(p.el)).toBe(0);
    const groups = p.el.querySelectorAll('pf-setting-group .pf-sgroup__sec');
    expect(groups.length).toBeGreaterThan(2);
    expect(Array.from(groups).every(c => !!c.querySelector('.pf-sgroup__head .pf-sgroup__label'))).toBe(true);
    hygiene(p.el);
  });

  it('option cards are NEUTRAL radios (aria-checked, no --on class); rule switches are slate role=switch', () => {
    const p = render();
    expect(p.el.querySelector('pf-segmented.pf-ls__gate [role="radiogroup"] [role="radio"]')).not.toBeNull();
    expect(p.el.querySelector('[class*="gate-opt--on"]')).toBeNull();
    p.f.componentRef.setInput('cards', ['require-validation', 'no-scan', 'calc-constants']); p.f.detectChanges();
    const sw = p.el.querySelectorAll('.pf-ls__card .pf-toggle[role="switch"]');
    expect(sw.length).toBe(2);
    expect(p.el.querySelectorAll('input.pf-input.pf-num').length).toBe(3);
    hygiene(p.el);
  });
});
