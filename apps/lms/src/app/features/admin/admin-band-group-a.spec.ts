import { signal } from '@angular/core';
import { vi } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { UsersAccessComponent } from './users-access/users-access.component';
import { WebrtcService } from '../../core/services/webrtc.service';
import { SignalingService } from '../../core/services/signaling.service';
import { PresenceService } from '../../core/services/presence.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { TestsComponent } from './tests/tests/tests.component';
import { TestPricingService } from '../../core/services/test-pricing.service';
import { By } from '@angular/platform-browser';
// NB: never import the option-groups / micro panels here — they import
// tests.component (grid themes), and pulling them in first leaves
// TestsComponent's `imports` array with an undefined entry.

/**
 * Group A of "band pill everywhere": Users & Access and Test Master. Search,
 * the view/tab switch and the page buttons live in the band; the page header
 * is classic-only; the grid fills the band body.
 */

const users = [
  { id: 'u1', firstName: 'Asha', lastName: 'Kumar', username: 'asha', email: 'asha@lab.in', isActive: true, roles: [] },
  { id: 'u2', firstName: 'Ravi', lastName: 'Shankar', username: 'ravi', email: 'ravi@lab.in', isActive: true, roles: [] },
];
const roles = [
  { id: 'r1', name: 'Reception', description: '', permissions: [], isPreSeeded: true },
];

function renderUsers() {
  return renderBandPage(UsersAccessComponent, {
    getFor: (url) => (url.startsWith('/api/users') ? users : url.startsWith('/api/roles') ? roles : []),
    providers: [
      { provide: WebrtcService, useValue: { startCall: vi.fn() } },
      { provide: SignalingService, useValue: { onlineUserIds: signal(new Set<string>()) } },
      { provide: PresenceService, useValue: { seedFromUsers: vi.fn() } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true } },
    ],
  });
}

describe('Admin band — Users & Access', () => {
  it('band + fill body; header and the old toolbar are classic-only', () => {
    const p = renderUsers();
    expect(p.band()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.body()?.classList.contains('pf-band-body--fill')).toBe(true);
    expect(p.body()?.querySelector('ag-grid-angular')).not.toBeNull();
  });

  it('Users tab: "Create user" in the band actions; the pill search filters users', () => {
    const p = renderUsers();
    expect(p.actions().map((b) => b.textContent?.trim())).toEqual(['Create user']);
    expect(p.cmp.filteredUsers().length).toBe(2);
    p.type('ravi');
    expect(p.cmp.search()).toBe('ravi');
    expect(p.cmp.filteredUsers().map((u: any) => u.id)).toEqual(['u2']);
  });

  it('the Users / Roles switch rides in the pill and swaps the band action', () => {
    const p = renderUsers();
    const seg = p.tools()!.querySelectorAll<HTMLButtonElement>('pf-segmented button');
    expect(Array.from(seg).map((b) => b.textContent?.trim())).toEqual(['Users', 'Roles & Permissions']);
    seg[1].click();
    p.f.detectChanges();
    expect(p.cmp.tab()).toBe('roles');
    expect(p.actions().map((b) => b.textContent?.trim())).toEqual(['Create role']);
    expect(p.bandInput()!.placeholder).toContain('roles');
  });
});

const tests = [
  { id: 't1', name: 'Haemoglobin', type: 'individual', isActive: true, testCode: 'HEM012', price: 150,
    department: { id: 'd1', name: 'Haematology' }, parameters: '{"parameters":[]}' },
  { id: 't2', name: 'Glucose Fasting', type: 'individual', isActive: true, testCode: 'BIO001', price: 90,
    department: { id: 'd2', name: 'Biochemistry' }, parameters: '{"parameters":[]}' },
  { id: 't3', name: 'Old Test', type: 'individual', isActive: false, testCode: 'OLD001', price: 10,
    department: { id: 'd2', name: 'Biochemistry' }, parameters: '{"parameters":[]}' },
];
const optionGroups = [
  { code: 'posneg', name: 'Positive / Negative', values: [{ value: 'Positive', normal: false, active: true }], links: [] },
  { code: 'color', name: 'Urine colour', values: [{ value: 'Pale yellow', normal: true, active: true }], links: [] },
];

function renderTm() {
  return renderBandPage(TestsComponent, {
    getFor: (url) => (url.startsWith('/api/tests') ? tests
      : url.startsWith('/api/option-groups') ? optionGroups
      : url.startsWith('/api/tenants/departments') ? [{ id: 'd1', name: 'Haematology', isActive: true }, { id: 'd2', name: 'Biochemistry', isActive: true }]
      : []),
    providers: [
      { provide: TestPricingService, useValue: { save: vi.fn(), ensureLoaded: vi.fn(), isolationOn: () => false } },
    ],
  });
}

describe('Admin band — Test Master', () => {
  it('Pricing: unsaved prices put Save (the ONE primary) + Discard in the band; no separate save bar', async () => {
    const p = renderTm();
    p.cmp.openPricingView();
    p.f.detectChanges();
    await new Promise(r => setTimeout(r));
    p.f.detectChanges();
    const table = p.cmp.pricingTable();
    expect(table).toBeTruthy();
    expect(p.el.querySelector('.pf-tm-pricesave')).toBeNull();
    table.setPrice('t1', 175);
    p.f.detectChanges();
    const primaries = Array.from(p.el.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary'));
    expect(primaries.length).toBe(1);
    expect(primaries[0].classList.contains('pf-tm-pricesave')).toBe(true);
    expect(p.el.querySelector('pf-hero-band .pf-tm-pricediscard')).not.toBeNull();
    expect(p.el.querySelector('.pf-pricing__savebar')).toBeNull();
    // Create steps down while prices are unsaved.
    expect(p.actions().find(b => b.getAttribute('aria-label') === 'Create')!.classList.contains('pf-hb-btn--ghost')).toBe(true);
    (p.el.querySelector('.pf-tm-pricediscard') as HTMLButtonElement).click();
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-tm-pricesave')).toBeNull();
  });

  it('band + fill body in the grid view; header and old tab bar are classic-only', () => {
    const p = renderTm();
    expect(p.band()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.el.querySelector('.pf-tm-tabs')?.classList.contains('pf-classic-only')).toBe(true);
    expect(p.el.querySelector('.pf-tm-search')?.classList.contains('pf-classic-only')).toBe(true);
    expect(p.body()?.classList.contains('pf-band-body--fill')).toBe(true);
    expect(p.body()?.querySelector('.pf-tm-side')).not.toBeNull(); // the department rail stays
  });

  it('band actions: Restore to default + Create; Save/Discard appear with dirty edits', () => {
    const p = renderTm();
    const labels = () => p.actions().map((b) => b.textContent?.trim());
    expect(labels()).toEqual(['Restore to default', 'Create']);
    p.cmp._dirty.set(new Map([['t1', { unit: 'x' }]]));
    p.f.detectChanges();
    expect(labels()).toEqual(['Restore to default', 'Discard', 'Save changes (1)', 'Create']);
  });

  it('the pill search drives the grid search', () => {
    const p = renderTm();
    expect(p.bandInput()!.placeholder).toContain('Search tests');
    p.type('gluc');
    expect(p.cmp.search()).toBe('gluc');
    expect(p.cmp.rowData().map((r: any) => r.id)).toEqual(['t2']);
  });

  it('view switch in the pill: type views and the side views; option groups fill (grid + side card scroll)', () => {
    const p = renderTm();
    const seg = () => Array.from(p.tools()!.querySelectorAll<HTMLButtonElement>('pf-segmented button'));
    expect(seg().map((b) => b.textContent?.trim()))
      .toEqual(['Individual', 'Profiles', 'Packages', 'Option groups', 'Microbiology', 'Pricing']);
    seg()[1].click();
    p.f.detectChanges();
    expect(p.cmp.type()).toBe('profile');
    expect(p.bandInput()!.placeholder).toContain('profiles');
    seg()[3].click();
    p.f.detectChanges();
    expect(p.cmp.ogView()).toBe(true);
    expect(p.body()?.classList.contains('pf-band-body--fill')).toBe(true);
    expect(p.actions().map((b) => b.textContent?.trim())).toContain('New option group');
  });

  it('ONE primary: Create steps down while grid edits wait ("Save changes" is it)', () => {
    const p = renderTm();
    const prim = () => Array.from(p.el.querySelectorAll('pf-hero-band .pf-hb-btn--primary')).map(b => b.textContent?.trim());
    expect(prim()).toEqual(['Create']);
    p.cmp._dirty.set(new Map([['t1', { unit: 'x' }]]));
    p.f.detectChanges();
    expect(prim()).toEqual(['Save changes (1)']);
  });

  it('ONE primary: an open option-group editor owns it; the band "New option group" steps down', () => {
    const p = renderTm();
    p.cmp.setView('og');
    p.f.detectChanges();
    const prim = () => Array.from(p.el.querySelectorAll('pf-hero-band .pf-hb-btn--primary')).map(b => b.textContent?.trim());
    expect(prim()).toEqual(['New option group']);
    p.cmp.panelEditing.set(true);
    p.f.detectChanges();
    expect(prim()).toEqual([]);
  });

  it('ND hygiene: slate department switches, neutral selected rail, no green / mono', () => {
    const p = renderTm();
    const sw = p.el.querySelector('.pf-tm-side .nd-toggle[role="switch"]');
    expect(sw).not.toBeNull();
    expect(p.el.querySelector('.pf-tm-dept[aria-pressed="true"]')).not.toBeNull();
    expect(p.el.querySelector('.pf-tm-dept--active, .pf-tm-dept-switch--on, .pf-tm-inactive-chip--on, .font-mono, select')).toBeNull();
  });

  it('"Inactive (n)" chip in the pill toggles showInactive', () => {
    const p = renderTm();
    const chip = p.tools()!.querySelector<HTMLButtonElement>('.pf-tm-inactive-chip')!;
    expect(chip.textContent).toContain('Inactive (1)');
    chip.click();
    p.f.detectChanges();
    expect(p.cmp.showInactive()).toBe(true);
    expect(p.cmp.rowData().length).toBe(3);
  });

  it('Option groups view: the band search drives the panel; its own box and "+ New" hide', async () => {
    const p = renderTm();
    p.cmp.setView('og');
    p.f.detectChanges();
    const panelEl = p.el.querySelector('pf-option-groups-panel')!;
    expect(panelEl.querySelector('.pf-og__search')).toBeNull();
    expect(panelEl.querySelector('.pf-og__new')).toBeNull();
    expect(p.bandInput()!.placeholder).toContain('option groups');
    p.type('urine');
    expect(p.cmp.panelQuery()).toBe('urine');
    expect(p.cmp.search()).toBe('');
    const panel = p.f.debugElement.query(By.css('pf-option-groups-panel')).componentInstance;
    expect(panel.rows().map((r: any) => r.name)).toEqual(['Urine colour']);
    // Band "New option group" opens the panel's create flow.
    p.actions().find((b) => b.textContent?.includes('New option group'))!.click();
    p.f.detectChanges();
    expect(panel.mode()).toBe('create');
  });
});
