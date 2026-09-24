import { renderBandPage } from './admin-band.spec-helpers';
import { NotificationsConfigComponent } from './notifications-config/notifications-config.component';
import { WorkflowBuilderComponent } from './workflow-builder/workflow-builder.component';
import { ProcessBuilderComponent } from './process-builder/process-builder.component';
import { KpiConfigComponent } from './kpis/kpi-config.component';
import { TestBed } from '@angular/core/testing';
import { DialogService } from '../../core/services/dialog.service';

/**
 * Group D admin pages on the band pill: notifications, workflows list,
 * process builder, KPIs, audit, OPD doctors, modules, settings hub.
 */
describe('Admin band — Notifications', () => {
  const rows = [
    { key: 'a', module: 'lab', label: 'Sample rejected', firesWhen: 'A sample is rejected', recipients: 'Front desk', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false },
    { key: 'b', module: 'lab', label: 'Result overdue', firesWhen: 'TAT breached', recipients: 'Lab head', kind: 'overdue', enabled: true, thresholdMinutes: 30, thresholdConfigurable: true },
    { key: 'c', module: 'billing', label: 'Refund issued', firesWhen: 'A refund posts', recipients: 'Accounts', kind: 'instant', enabled: false, thresholdMinutes: null, thresholdConfigurable: false },
  ];
  const make = () => renderBandPage(NotificationsConfigComponent, { getFor: (u) => (u.includes('/notifications/catalog') ? rows : []) });
  const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-band-body pf-tile p.font-semibold')).map((p) => p.textContent?.trim());

  it('band + body; classic header and chip row are classic-only', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.body()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.el.querySelector('.pf-nc-chips')?.classList.contains('pf-classic-only')).toBe(true);
    expect(p.tools()?.querySelector('pf-select')).not.toBeNull();
  });

  it('pill search filters alerts across label / fires-when / recipients, with an empty state', () => {
    const p = make();
    expect(labels(p.el)).toEqual(['Sample rejected', 'Result overdue', 'Refund issued']);
    p.type('accounts');
    expect(labels(p.el)).toEqual(['Refund issued']);
    p.type('tat');
    expect(labels(p.el)).toEqual(['Result overdue']);
    p.type('nothing-here');
    expect(labels(p.el)).toEqual([]);
    expect(p.el.querySelector('.pf-band-empty')).not.toBeNull();
  });

  it('module picker in the pill: counts in labels, picking narrows the list', () => {
    const p = make();
    const opts = p.cmp.moduleOptions();
    expect(opts[0]).toEqual({ value: '', label: 'All modules · 3' });
    expect(opts.map((o: any) => o.label)).toContain('Lab bench · 2');
    p.cmp.setModuleFilter('billing');
    p.f.detectChanges();
    expect(labels(p.el)).toEqual(['Refund issued']);
  });
});

describe('Admin band — Workflow forms list', () => {
  const recs = [
    { screenName: 'patient_register', status: 'published', version: 3, configJson: '{"steps":[]}' },
    { screenName: 'order_create', status: 'draft', version: 1, configJson: '{"steps":[]}' },
  ];
  const make = () => renderBandPage(WorkflowBuilderComponent, { getFor: (u) => (u === '/api/workflows/' ? recs : []) });
  const names = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-band-body .pf-wf-name')).map((p) => p.textContent?.trim());

  it('list mode: band + body, header classic-only', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.body()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
  });

  it('pill search filters the forms, with an empty state', () => {
    const p = make();
    expect(names(p.el)).toEqual(['Patient Register', 'Order Create']);
    p.type('order');
    expect(names(p.el)).toEqual(['Order Create']);
    p.type('draft');
    expect(names(p.el)).toEqual(['Order Create']);
    p.type('xyz');
    expect(names(p.el)).toEqual([]);
    expect(p.el.querySelector('.pf-band-empty')).not.toBeNull();
  });
});

describe('Admin band — Process builder', () => {
  const wfs = [
    { id: 'w1', name: 'Main', isActive: true, branchId: null, configJson: '{"categories":[],"actions":[]}' },
    { id: 'w2', name: 'Evening', isActive: false, branchId: null, configJson: '{"categories":[],"actions":[]}' },
  ];
  const make = () => renderBandPage(ProcessBuilderComponent, {
    getFor: (u) => (u.startsWith('/api/process-workflows') ? wfs : u === '/api/tenants/branches' ? [{ id: 'b1', name: 'Anna Nagar' }] : []),
  });
  const visibleChips = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('.pb-palette-list .pb-chip:not(.pb-chip--hidden)')).map((c) => c.textContent?.trim());

  it('band + body; the custom title bar and hint are classic-only (no emoji lock)', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.body()).not.toBeNull();
    expect(p.el.querySelector('.pb-bar')?.classList.contains('pf-classic-only')).toBe(true);
    const hint = p.el.querySelector('.pb-hint')!;
    expect(hint.classList.contains('pf-classic-only')).toBe(true);
    expect(hint.textContent).not.toContain('🔒');
    expect(hint.querySelector('svg')).not.toBeNull();
  });

  it('pill search HIDES non-matching palette chips (palette array untouched for drag indices)', () => {
    const p = make();
    const total = p.cmp.palette().length;
    expect(visibleChips(p.el).length).toBe(total);
    p.type('register patient');
    expect(visibleChips(p.el).length).toBe(1);
    expect(visibleChips(p.el)[0]).toContain('Register Patient');
    expect(p.cmp.palette().length).toBe(total);
    expect(p.el.querySelectorAll('.pb-palette-list .pb-chip').length).toBe(total);
    p.type('zzz');
    expect(p.el.querySelector('.pb-palette-list .pb-empty')?.textContent).toContain('No actions match');
  });

  it('pickers in the pill (pf-select, no native select in the new design); actions in the band', () => {
    const p = make();
    const tools = p.tools()!;
    expect(tools.querySelectorAll('pf-select').length).toBe(2);
    expect(tools.querySelector('select')).toBeNull();
    expect(p.cmp.scopeOptions().map((o: any) => o.label)).toEqual(['All branches (default)', 'Anna Nagar']);
    expect(p.cmp.workflowOptions().map((o: any) => o.label)).toEqual(['Main · active', 'Evening']);
    const labels = p.actions().map((b) => b.textContent?.trim());
    expect(labels).toEqual(['New', 'Duplicate', 'Set active', 'Save']);
    p.cmp.selectWorkflow('w2');
    expect(p.cmp.currentId()).toBe('w2');
  });
});

describe('Admin band — KPI configuration', () => {
  const catalog = [
    { id: 'k1', code: 'CASH_IN', name: 'Cash in', category: 'financial', valueType: 'money', defaultLabel: 'Cash in' },
    { id: 'k2', code: 'TAT_BREACH', name: 'TAT breaches', category: 'tat', valueType: 'count', defaultLabel: 'TAT breaches' },
  ];
  const make = () => renderBandPage(KpiConfigComponent, {
    getFor: (u) => (u === '/api/kpis' ? catalog : u.startsWith('/api/kpis/assignments') ? [] : u === '/api/tenants/branches' ? [{ id: 'b1', name: 'Main' }] : []),
  });
  const names = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-kpi-cat__name')).map((n) => n.textContent?.trim());

  it('band + fill body; custom header, controls and in-pane search/actions are classic-only', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.el.querySelector('.pf-band-body.pf-band-body--fill')).not.toBeNull();
    expect(p.el.querySelector('.pf-kpi-hdr')?.classList.contains('pf-classic-only')).toBe(true);
    expect(p.el.querySelector('.pf-kpi-controls')?.classList.contains('pf-classic-only')).toBe(true);
    expect(p.el.querySelector('.pf-kpi-search')?.classList.contains('pf-classic-only')).toBe(true);
    expect(p.actions().map((b) => b.textContent?.trim())).toEqual(['Discard', 'Save']);
    expect(p.tools()!.querySelectorAll('pf-select').length).toBe(2);
  });

  it('pill search filters the catalog', () => {
    const p = make();
    expect(names(p.el)).toEqual(['Cash in', 'TAT breaches']);
    p.type('tat');
    expect(names(p.el)).toEqual(['TAT breaches']);
  });

  it('screen picker: count in the label; switching reloads assignments for that screen', async () => {
    const p = make();
    expect(p.cmp.screenOptions()[0]).toEqual({ value: 'admin', label: 'Admin dashboard', hint: 'Tenant-wide overview' });
    p.cmp.addToScreen(catalog[0]);
    expect(p.cmp.screenOptions()[0].label).toBe('Admin dashboard · 1');
    // Dirty → themed confirm (never window.confirm); declining keeps the screen.
    const dialog = TestBed.inject(DialogService) as any;
    await p.cmp.selectScreen('pathologist');
    expect(dialog.confirm).toHaveBeenCalled();
    expect(p.cmp.selectedScreen()).toBe('admin');
    dialog.confirm.mockResolvedValue(true);
    await p.cmp.selectScreen('pathologist');
    expect(p.cmp.selectedScreen()).toBe('pathologist');
    expect(p.api.get).toHaveBeenCalledWith('/api/kpis/assignments?screen=pathologist');
  });
});
