import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { renderBandPage } from './admin-band.spec-helpers';
import { AdminModulesComponent } from './modules/modules.component';
import { PartnersComponent } from './partners/partners.component';
import { LabSettingsHubComponent } from '../lab/lab-settings-hub/lab-settings-hub.component';
import { OpdAdminComponent } from '../opd/admin/opd-admin.component';
import { CultureSettingsComponent } from '../lab/culture-settings/culture-settings.component';
import { OpdSettingsComponent } from '../opd/admin/opd-settings.component';
import { ModulePlaceholderComponent } from '../modules/module-placeholder.component';
import { AdminOverviewComponent } from './admin-overview.component';
import { AdminDashboardComponent } from './admin-dashboard.component';
import { BranchesComponent } from './branches/branches.component';
import { VendorsComponent } from './vendors/vendors.component';
import { ReferralLabsComponent } from './referral-labs/referral-labs.component';
import { ReferringNetworkComponent } from './referring-network/referring-network.component';
import { InventoryComponent } from './inventory/inventory.component';
import { AppointmentsConfigComponent } from './appointments-config/appointments-config.component';
import { HomeCollectionAgentsComponent } from './home-collection/home-collection-agents.component';
import { AppointmentQueueService } from '../../core/services/appointment-queue.service';
import { of } from 'rxjs';
import { provideHttpClient } from '@angular/common/http';

/**
 * /admin ND audit (fork D) — the CURRENT ND-PATTERN on hubs, list pages and
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
  Array.from(el.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary, pf-touch-btn .v-primary'))
    .filter(b => !b.closest('.pf-classic-only')).length;

describe('ND audit D — Modules', () => {
  it('module + feature toggles are slate switches (role=switch); the On/Off filter is a neutral kit segment', () => {
    const p = renderBandPage(AdminModulesComponent);
    p.cmp.state.set({ opd: { enabled: true, features: {} } });
    p.f.detectChanges();
    const sw = p.el.querySelectorAll('.pf-mod .nd-toggle[role="switch"]');
    expect(sw.length).toBeGreaterThan(3);
    expect(p.el.querySelector('.pf-mod .nd-toggle[aria-checked="true"]')).not.toBeNull();
    expect(p.el.querySelector('.pf-mod.nd-card .nd-card__icon')).not.toBeNull();
    const seg = p.tools()!.querySelector('.nd-seg[role="radiogroup"]')!;
    expect(seg.querySelectorAll('[role="radio"]').length).toBe(3);
    expect(p.tools()!.querySelector('pf-segmented')).toBeNull();
    expect(primaries(p.el)).toBe(0);   // toggles save live — no band actions
    hygiene(p.el);
  });

  it('a switch click flips the module (persist is called)', () => {
    const p = renderBandPage(AdminModulesComponent);
    const spy = vi.spyOn(p.cmp as any, 'persist').mockImplementation(() => {});
    (p.el.querySelector('.pf-mod .pf-mod__head .nd-toggle') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
  });
});

describe('ND audit D — tile hubs (Lab settings, Partners, OPD)', () => {
  for (const [name, cmp, sel] of [
    ['Lab settings hub', LabSettingsHubComponent, '.pf-lsh__tile'],
    ['Partners', PartnersComponent, '.pf-ph__tile'],
    ['OPD', OpdAdminComponent, '.pf-lsh__tile'],
  ] as const) {
    it(`${name}: band search, tiles are kit cards with the violet icon chip, no primary`, () => {
      const p = renderBandPage(cmp as any);
      expect(p.bandInput()).not.toBeNull();
      const tile = p.el.querySelector(sel)!;
      expect(tile.classList.contains('nd-card')).toBe(true);
      expect(tile.querySelector('.nd-card__icon svg[aria-hidden="true"]')).not.toBeNull();
      expect(primaries(p.el)).toBe(0);
      hygiene(p.el);
    });
  }
});

describe('ND audit D — settings pages (Microbiology, OPD settings)', () => {
  it('Microbiology: nd-card sections, slate supervisor switch, kit number fields, ONE primary (band Save)', () => {
    const p = renderBandPage(CultureSettingsComponent, {
      getFor: () => ({ lockTimeoutMinutes: 60, allowSupervisorTakeover: true, stageTats: [{ stageKey: 'gram', tatHours: 4 }] }),
    });
    expect(primaries(p.el)).toBe(1);
    expect(p.actions()[0].className).toContain('pf-hb-btn--primary');
    const card = p.el.querySelector('.pf-band-body .nd-card')!;
    expect(card.querySelector('.nd-card__head .nd-card__icon')).not.toBeNull();
    const sw = card.querySelector<HTMLButtonElement>('.nd-toggle[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click(); p.f.detectChanges();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(card.querySelector('input.nd-input.nd-num')).not.toBeNull();
    hygiene(p.el);
  });

  it('OPD settings: tiers are a kit card with kit fields and an SVG remove, ONE primary', () => {
    const p = renderBandPage(OpdSettingsComponent, {
      getFor: () => ({ followUpMode: 'auto', tiers: [{ withinDays: 7, discountPercent: 50 }] }),
    });
    expect(primaries(p.el)).toBe(1);
    const card = p.el.querySelector('.pf-os__card.nd-card')!;
    expect(card).not.toBeNull();
    expect(card.querySelectorAll('input.nd-input.nd-num').length).toBe(2);
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
    const ctx = p.el.querySelector('pf-hero-band .nd-ctx')!;
    expect(ctx.querySelector('.nd-ctx__primary')!.textContent).toContain('Pharmacy');
    expect(ctx.textContent).toContain('Coming soon');
    expect(p.body()!.querySelector('.nd-card')).not.toBeNull();
    expect(primaries(p.el)).toBe(0);
    hygiene(p.el);
    TestBed.resetTestingModule();
  });
});

describe('ND audit D — Overview (/admin) and settings hub (/admin/manage)', () => {
  it('Overview: range is a neutral nd-seg in the pill, content scrolls inside .pf-band-body, violet kit icon chips only', () => {
    const p = renderBandPage(AdminOverviewComponent);
    const seg = p.tools()!.querySelector('.nd-seg[role="radiogroup"]')!;
    expect(seg.querySelectorAll('[role="radio"]').length).toBe(4);
    expect(seg.querySelector('[aria-checked="true"]')!.textContent!.trim()).toBe('Today');
    expect(p.el.querySelector('pf-hero-band .pf-ov__range--on')).toBeNull();
    expect(p.body()).not.toBeNull();
    expect(p.body()!.querySelector('.pf-ov__kpi.nd-card .nd-card__icon')).not.toBeNull();
    expect(p.el.querySelector('[data-color], [data-g]')).toBeNull();
    expect(primaries(p.el)).toBe(0);
    hygiene(p.el);
  });

  it('Manage: the category pane is ONE kit card with the BILLING header and a plain muted count; no rainbow chips', () => {
    const p = renderBandPage(AdminDashboardComponent);
    const pane = p.el.querySelector('.pf-admin-pane.nd-card')!;
    expect(pane).not.toBeNull();
    const head = pane.querySelector('.nd-card__head')!;
    expect(head.querySelector('.nd-card__icon svg')).not.toBeNull();
    expect(head.querySelector('.nd-card__label')).not.toBeNull();
    expect(head.querySelector('.pf-admin-pane__count')!.textContent).toMatch(/\d+ settings?/);
    expect(pane.querySelector('.pf-admin-tile .nd-card__icon')).not.toBeNull();
    expect(p.el.querySelector('[data-g]')).toBeNull();
    expect(primaries(p.el)).toBe(0);
    hygiene(p.el);
  });
});

describe('ND audit D — Branches', () => {
  const branches = [
    { id: 'b1', name: 'Main Lab — Anna Nagar Collection Centre', code: 'MAIN', city: 'Chennai', isActive: true, hasPfBox: true,
      subBranches: [{ id: 's1', branchId: 'b1', name: 'Kilpauk Satellite', code: 'KIL', type: 'satellite', isActive: true }] },
  ];
  const render = () => renderBandPage(BranchesComponent, {
    getFor: (url) => url.startsWith('/api/tenants/branches') ? branches
      : url.startsWith('/api/tenants/departments') ? [{ id: 'd1', name: 'Haematology', code: 'HEM', isActive: true, subBranchId: 's1' }] : [],
  });

  it('ONE primary: "Add branch" in the band; while the form is open the band turns Cancel and "Create branch" is the primary', () => {
    const p = render();
    expect(primaries(p.el)).toBe(1);
    p.cmp.toggleNewBranch(); p.f.detectChanges();
    expect(primaries(p.el)).toBe(1);
    const form = p.el.querySelector('.pf-br-new.nd-card')!;
    expect(form.querySelector('.nd-card__head .nd-card__icon')).not.toBeNull();
    expect(form.querySelectorAll('input.nd-input').length).toBe(4);
    expect(form.querySelector('.nd-btn--primary')!.textContent).toContain('Create branch');
    expect(p.actions()[0].classList.contains('pf-hb-btn--ghost')).toBe(true);
  });

  it('branch cards are kit cards; names never truncated; no gradient badge / pink sub-branch; no × / → glyphs', () => {
    const p = render();
    const card = p.el.querySelector('.pf-br-card.nd-card')!;
    expect(card).not.toBeNull();
    expect(p.el.querySelector('.pf-trunc')).toBeNull();
    expect(card.querySelector('.pf-br-name')!.textContent).toContain('Anna Nagar Collection Centre');
    p.cmp.toggle('b1'); p.f.detectChanges();
    expect(card.textContent).not.toMatch(/[×→]/);
    expect(p.el.querySelector('.pf-dot-on')).not.toBeNull();
    const act = card.querySelector('.nd-rowact')!;
    expect(act.textContent).toContain('Deactivate');
    expect(act.querySelector('svg')).not.toBeNull();
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

  it('ONE primary (band "Add vendor"); per-vendor actions are .nd-rowact text buttons with icons for touch', () => {
    const p = render();
    expect(primaries(p.el)).toBe(1);
    const acts = p.el.querySelectorAll('.pf-vn-card')[0].querySelectorAll('.pf-vendor__actions .nd-rowact');
    expect(Array.from(acts).map(a => a.querySelector('.nd-rowact__t')!.textContent!.trim()))
      .toEqual(['Top up', 'Record payment', 'Email statement', 'View history', 'Deactivate']);
    expect(Array.from(acts).every(a => !!a.querySelector('svg[aria-hidden="true"]'))).toBe(true);
    p.cmp.openTopUp(vendors[0]); p.f.detectChanges();
    expect(primaries(p.el)).toBe(1);
    hygiene(p.el);
  });

  it('new-vendor editor = kit card with kit fields; the band button becomes a quiet Cancel', () => {
    const p = render();
    p.cmp.toggleNewVendor(); p.f.detectChanges();
    const form = p.el.querySelector('.pf-vn-new.nd-card')!;
    expect(form.querySelector('.nd-card__head .nd-card__icon')).not.toBeNull();
    expect(form.querySelectorAll('input.nd-input').length).toBeGreaterThanOrEqual(8);
    expect(primaries(p.el)).toBe(1);
    expect(p.actions()[0].classList.contains('pf-hb-btn--ghost')).toBe(true);
  });

  it('palette: code / inactive = neutral chips, in-credit = violet (never green), filter = neutral nd-seg', () => {
    const p = render();
    const chips = p.el.querySelectorAll('.pf-vendor__code.nd-chip');
    expect(chips.length).toBe(3);
    expect(p.el.querySelector('.pf-vendor__bal-amt--credit')).not.toBeNull();
    expect(p.tools()!.querySelectorAll('.nd-seg [role="radio"]').length).toBe(3);
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

  it('ONE primary; Edit / Deactivate are .nd-rowact; codes are neutral tabular chips', () => {
    const p = render();
    expect(primaries(p.el)).toBe(1);
    const card = p.el.querySelector('.pf-rl-card.nd-card')!;
    expect(Array.from(card.querySelectorAll('.nd-rowact .nd-rowact__t')).map(t => t.textContent!.trim())).toEqual(['Edit', 'Deactivate']);
    expect(card.querySelector('.pf-rl__code.nd-chip.nd-num')!.textContent).toContain('APOLLO');
    hygiene(p.el);
  });

  it('edit opens the kit-card editor; dept chips use the NEUTRAL aria-pressed state (no --on gradient)', () => {
    const p = render();
    p.cmp.edit(labs[0]); p.f.detectChanges();
    const form = p.el.querySelector('.pf-rl-form.nd-card')!;
    expect(form.querySelector('.nd-card__label')!.textContent).toContain('Edit referral lab');
    const chip = form.querySelector('.pf-dept-chip')!;
    expect(chip.classList.contains('nd-chip')).toBe(true);
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

  it('panes are kit cards with BILLING headers; the selected hospital is the NEUTRAL aria-selected row; ONE primary', async () => {
    const p = await render();
    const panes = p.el.querySelectorAll('.pf-rn-pane.nd-card');
    expect(panes.length).toBe(2);
    expect(panes[0].querySelector('.nd-card__head .nd-card__icon')).not.toBeNull();
    expect(panes[0].querySelector('.pf-rn-pane__count')!.classList.contains('nd-num')).toBe(true);
    p.cmp.selectHospital('h1'); await p.f.whenStable(); p.f.detectChanges();
    expect(p.el.querySelector('.pf-rn-row[aria-selected="true"]')).not.toBeNull();
    expect(p.el.querySelector('.pf-rn-row--on')).toBeNull();
    expect(primaries(p.el)).toBe(1);
    const add = Array.from(p.el.querySelectorAll('.pf-rn-hdrbtn')).find(b => /Add doctor/.test(b.textContent ?? ''))!;
    expect(add.classList.contains('nd-btn--secondary')).toBe(true);
    hygiene(p.el);
  });

  it('the hospital editor is an nd-card modal (BILLING header, kit fields, ONE primary in the footer)', async () => {
    const p = await render();
    p.cmp.openHospitalEditor(null); p.f.detectChanges();
    const m = p.el.querySelector('.pf-rn-modal.nd-card[role="dialog"]')!;
    expect(m.querySelector('.nd-card__head .nd-card__icon')).not.toBeNull();
    expect(m.querySelectorAll('input.nd-input').length).toBeGreaterThanOrEqual(5);
    expect(m.querySelectorAll('.nd-btn--primary').length).toBe(1);
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

  it('ONE primary; row actions are .nd-rowact; low stock = neutral chip; alerts are kit cards', async () => {
    const p = await render();
    expect(primaries(p.el)).toBe(1);
    const acts = p.el.querySelectorAll('tbody tr.pf-inv-row')[0].querySelectorAll('.nd-rowact .nd-rowact__t');
    expect(Array.from(acts).map(a => a.textContent!.trim())).toEqual(['Receive', 'Label', 'Batches', 'Edit']);
    expect(p.el.querySelector('.pf-inv-low.nd-chip')).not.toBeNull();
    expect(p.el.querySelectorAll('.pf-inv-alert.nd-card .nd-card__icon').length).toBe(2);
    hygiene(p.el);
  });

  it('item editor = kit card with kit fields + a slate Active switch; the band turns ghost so Save is the one primary', async () => {
    const p = await render();
    p.cmp.startNew(); p.f.detectChanges();
    const ed = p.el.querySelector('.pf-inv-editor.nd-card')!;
    expect(ed.querySelectorAll('input.nd-input').length).toBeGreaterThanOrEqual(5);
    const sw = ed.querySelector<HTMLButtonElement>('.nd-toggle[role="switch"]')!;
    expect(sw).not.toBeNull();
    expect(primaries(p.el)).toBe(1);
    expect(ed.querySelector('.nd-btn--primary')).not.toBeNull();
    hygiene(p.el);
  });

  it('the label type switch is a neutral nd-seg (no gradient --on)', async () => {
    const p = await render();
    p.cmp.showLabel(items[0]); p.f.detectChanges();
    const seg = p.el.querySelector('.label-wrap .nd-seg[role="radiogroup"]');
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
    const card = p.el.querySelector('.pf-ap-card.nd-card')!;
    expect(card.querySelector('.nd-card__head .nd-card__icon')).not.toBeNull();
    const radios = card.querySelectorAll('.pf-mode-btn[role="radio"]');
    expect(radios.length).toBeGreaterThanOrEqual(2);
    expect(card.querySelectorAll('.pf-mode-btn[aria-checked="true"]').length).toBe(1);
    expect(p.el.querySelector('pf-tile')).toBeNull();
    hygiene(p.el);
  });

  it('Open 24×7 is a slate switch; turning it off shows kit time fields', () => {
    const p = render();
    p.cmp.tab.set('slots'); p.f.detectChanges();
    const sw = p.el.querySelector<HTMLButtonElement>('.nd-toggle[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click(); p.f.detectChanges();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(p.el.querySelectorAll('input[type="time"].nd-input').length).toBe(2);
    hygiene(p.el);
  });
});

describe('ND audit D — Home-collection agents', () => {
  const agents = [{ id: 'a1', userId: 'u1', areaMode: 'pincode', pincodesJson: '["600001","600028"]', weightage: 2, isActive: true,
    user: { name: 'Karthikeyan Subramaniam Ramasamy', email: 'k@x.in' } }];
  const render = () => renderBandPage(HomeCollectionAgentsComponent, {
    providers: [{ provide: AppointmentQueueService, useValue: { listAgents: vi.fn(() => of(agents)), upsertAgent: vi.fn(() => of({})), removeAgent: vi.fn(() => of({})) } }],
  });

  it('agent cards: kit card, full name (no truncate), neutral weight chip, Edit / Remove .nd-rowact; ONE primary', () => {
    const p = render();
    expect(primaries(p.el)).toBe(1);
    const card = p.el.querySelector('.pf-hc-card.nd-card')!;
    expect(card.querySelector('.pf-hc-name')!.textContent).toContain('Karthikeyan Subramaniam Ramasamy');
    expect(card.querySelector('.truncate')).toBeNull();
    expect(card.querySelector('.pf-hc-chip.nd-chip')!.textContent).toContain('Weight');
    expect(Array.from(card.querySelectorAll('.nd-rowact .nd-rowact__t')).map(t => t.textContent!.trim())).toEqual(['Edit', 'Remove']);
    hygiene(p.el);
  });

  it('agent editor = kit card; coverage is a neutral nd-seg; the band turns a quiet Cancel', () => {
    const p = render();
    p.cmp.toggleForm(); p.f.detectChanges();
    const form = p.el.querySelector('.pf-hc-form.nd-card')!;
    expect(form.querySelectorAll('.nd-seg [role="radio"]').length).toBe(2);
    expect(form.querySelector('input.nd-input')).not.toBeNull();
    expect(primaries(p.el)).toBe(1);
    expect(p.actions()[0].classList.contains('pf-hb-btn--ghost')).toBe(true);
    hygiene(p.el);
  });
});
