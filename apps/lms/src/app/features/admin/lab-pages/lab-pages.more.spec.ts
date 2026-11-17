import { signal } from '@angular/core';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { AuthService } from '../../../core/auth/auth.service';
import { LabFeaturesService } from '../../../core/services/lab-features.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { NotificationsConfigComponent } from '../notifications-config/notifications-config.component';
import { KpiConfigComponent } from '../kpis/kpi-config.component';
import { PaymentRulesCardComponent } from '../billing-config/payment-rules.component';
import { InventoryEnableCardComponent } from '../inventory/inventory-enable-card.component';
import { LabFrontDeskPage } from './front-desk.page';
import { LabHomeCollectionPage } from './home-collection.page';
import { LabAlertsPage } from './alerts.page';
import { LabNumbersPage } from './numbers.page';
import { alertModuleInDepartment, kpiScreenInDepartment } from '../../../shared/utils/department-scope';
import { renderLabPage, text } from './lab-pages.spec-helpers';

const apptCfg = (queueMode = 'token_queue') => ({
  branchId: 'b1', queueMode, slotMinutes: 30, maxConcurrentSlots: 1, open24h: true, weeklyScheduleJson: null,
  queueOptions: {
    baseAppointment: 100, baseWalkin: 50, baseFollowup: 80, waitWeight: 1, appointmentGraceMinutes: 10,
    latePenalty: 50, noShowThresholdMinutes: 30, avgCollectionMinutes: 5, urgentOverrideScore: 1000,
  },
});
const features = (on: boolean) => ({
  provide: LabFeaturesService,
  useValue: { homeCollectionEnabled: signal(on), appointmentsEnabled: signal(true), ensureLoaded: async () => undefined },
});

describe('Lab › Front desk', () => {
  it('appointments and queue: token queue / walk-up only (Home collection moved to its own page)', async () => {
    const p = await renderLabPage(LabFrontDeskPage, '/page', { getFor: u => u === '/api/appointments/config' ? apptCfg() : [] });
    expect(p.el.querySelector('pf-appointments-config')).not.toBeNull();
    const tiles = Array.from(p.el.querySelectorAll('.pf-mode-btn')).map(t => text(t.querySelector('.pf-mode-btn__t')));
    expect(tiles).toEqual(['Token queue', 'Walk-up']);
    expect(p.el.querySelector('[data-testid="ap-hc-note"]')).toBeNull();
  });

  it('a branch whose queue runs as home collection says so and points to Lab › Home collection', async () => {
    const p = await renderLabPage(LabFrontDeskPage, '/page', { getFor: u => u === '/api/appointments/config' ? apptCfg('home_collection') : [] });
    const note = p.el.querySelector('[data-testid="ap-hc-note"]')!;
    expect(note.textContent).toContain('home collection');
    expect(note.querySelector('a')!.getAttribute('href')).toBe('/admin/lab/home-collection');
    expect(p.el.querySelector('.pf-mode-btn[aria-checked="true"]')).toBeNull();
  });

  it('?tab=referring shows the shared referring doctors and hospitals list (embeddable component)', async () => {
    const p = await renderLabPage(LabFrontDeskPage, '/page?tab=referring');
    expect(p.el.querySelector('pf-referring-network')).not.toBeNull();
    expect(p.el.querySelector('pf-appointments-config')).toBeNull();
  });
});

describe('Lab › Home collection', () => {
  const get = (queueMode: string) => (u: string) => u === '/api/appointments/config' ? apptCfg(queueMode) : [];

  it('ON: the branch queue becomes home collection — same PUT, rest of the config untouched', async () => {
    const p = await renderLabPage(LabHomeCollectionPage, '/page', { getFor: get('walk_up'), providers: [features(true)] });
    const sw = p.el.querySelector<HTMLButtonElement>('[data-testid="hc-switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.disabled).toBe(false);
    sw.click();
    expect(p.api.put).toHaveBeenCalledWith('/api/appointments/config', { ...apptCfg('walk_up'), queueMode: 'home_collection' });
  });

  it('OFF: the queue returns to the token queue (or the mode it had before)', async () => {
    const p = await renderLabPage(LabHomeCollectionPage, '/page', { getFor: get('home_collection'), providers: [features(true)] });
    const sw = p.el.querySelector<HTMLButtonElement>('[data-testid="hc-switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click();
    expect(p.api.put).toHaveBeenCalledWith('/api/appointments/config', { ...apptCfg('home_collection'), queueMode: 'token_queue' });
  });

  it('not available (module / Home visits step off): the switch is disabled and it says how to get it', async () => {
    const p = await renderLabPage(LabHomeCollectionPage, '/page', { getFor: get('token_queue'), providers: [features(false)] });
    const sw = p.el.querySelector<HTMLButtonElement>('[data-testid="hc-switch"]')!;
    expect(sw.disabled).toBe(true);
    expect(p.el.querySelector('[data-testid="hc-unavailable"]')).not.toBeNull();
    expect(text(p.el.querySelector('[data-testid="hc-available"]'))).toContain('No');
    sw.click();
    expect(p.api.put).not.toHaveBeenCalled();
  });

  it('a running branch can always be switched off even if the module was removed since', async () => {
    const p = await renderLabPage(LabHomeCollectionPage, '/page', { getFor: get('home_collection'), providers: [features(false)] });
    expect(p.el.querySelector<HTMLButtonElement>('[data-testid="hc-switch"]')!.disabled).toBe(false);
  });

  it('?tab=agents is the existing agents screen (coverage area and share of work)', async () => {
    const p = await renderLabPage(LabHomeCollectionPage, '/page?tab=agents', { providers: [features(true)] });
    expect(p.el.querySelector('pf-home-collection-agents')).not.toBeNull();
    expect(p.el.querySelector('[data-testid="hc-switch"]')).toBeNull();
  });
});

describe('department scope (alerts, number cards)', () => {
  it('maps modules and screens to departments; no department = everything', () => {
    expect(alertModuleInDepartment('lab', 'lab')).toBe(true);
    expect(alertModuleInDepartment('opd', 'lab')).toBe(false);
    expect(alertModuleInDepartment('opd', 'opd')).toBe(true);
    expect(alertModuleInDepartment('anything', null)).toBe(true);
    expect(kpiScreenInDepartment('tat_board', 'lab')).toBe(true);
    expect(kpiScreenInDepartment('admin', 'lab')).toBe(false);
    expect(kpiScreenInDepartment('opd_queue', 'opd')).toBe(true);
    expect(kpiScreenInDepartment('admin', null)).toBe(true);
  });
});

describe('Notifications config — department input (Lab alerts, OPD alerts, IPD alerts)', () => {
  const rows = [
    { key: 'a', module: 'frontdesk', label: 'Order cancelled', firesWhen: 'x', recipients: 'y', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false },
    { key: 'b', module: 'results', label: 'Critical value', firesWhen: 'x', recipients: 'y', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false, critical: true },
    { key: 'c', module: 'opd', label: 'Consult started', firesWhen: 'x', recipients: 'y', kind: 'instant', enabled: false, thresholdMinutes: null, thresholdConfigurable: false },
  ];
  const make = (department: string | null) => renderBandPage(NotificationsConfigComponent, {
    getFor: u => u === '/api/config/notifications/catalog' ? rows : u === '/api/config/notifications/master' ? { enabled: true } : [],
    inputs: department ? { department } : {},
  });
  const labels = (p: ReturnType<typeof make>) => Array.from(p.el.querySelectorAll('.pf-nc-card p.font-semibold')).map(x => text(x));

  it('lab: only the lab groups', () => {
    expect(labels(make('lab'))).toEqual(['Order cancelled', 'Critical value']);
  });
  it('opd: only the OPD group', () => {
    expect(labels(make('opd'))).toEqual(['Consult started']);
  });
  it('ipd: none, and says so', () => {
    const q = make('ipd');
    expect(labels(q)).toEqual([]);
    expect(q.el.querySelector('[data-testid="nc-dept-empty"]')).not.toBeNull();
  });
  it('no department: every alert (unchanged)', () => {
    expect(labels(make(null)).length).toBe(3);
  });
  it('the master switch is unchanged: lab-wide, off asks first', () => {
    const lab = make('lab');
    lab.el.querySelector<HTMLButtonElement>('.pf-nc-master__switch')!.click();   // off asks first: dialog stub says no
    expect(lab.api.post).not.toHaveBeenCalled();
    expect(text(lab.el.querySelector('.pf-nc-master__sub'))).toContain('2 of 2 alerts');
  });
  it('a row switch posts the same body as before', () => {
    const p = make('lab');
    p.el.querySelector<HTMLButtonElement>('.pf-nc-card .pf-nc-switch')!.click();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/notifications', { eventType: 'a', inAppEnabled: false, thresholdMinutes: null });
  });
  it('the Lab alerts page is that screen narrowed to the lab', async () => {
    const p = await renderLabPage(LabAlertsPage, '/page', {
      getFor: u => u === '/api/config/notifications/catalog' ? rows : u === '/api/config/notifications/master' ? { enabled: true } : [],
    });
    expect(Array.from(p.el.querySelectorAll('.pf-nc-card p.font-semibold')).map(x => text(x))).toEqual(['Order cancelled', 'Critical value']);
  });
});

describe('KPI config — department input (Numbers on lab screens)', () => {
  const catalog = [{ id: 'k1', code: 'orders_today', name: 'Orders today', description: '', category: 'operational', unit: '', isActive: true }];
  const make = async (department: string | null) => {
    const p = renderBandPage(KpiConfigComponent, {
      getFor: u => u.startsWith('/api/kpis/catalog') ? catalog : [],
      inputs: department ? { department } : {},
    });
    await p.f.whenStable();
    p.f.detectChanges();
    return p;
  };
  it('lab: the eight lab screens, opening on the first (not the Admin dashboard)', async () => {
    const p = await make('lab');
    expect(p.cmp.screens().map((s: { id: string }) => s.id)).toEqual([
      'frontdesk_landing', 'lab_my_work', 'sample_collection', 'receive_samples', 'pathologist', 'report_queue', 'billing_counter', 'tat_board',
    ]);
    expect(p.cmp.selectedScreen()).toBe('frontdesk_landing');
  });
  it('no department keeps every screen, Admin dashboard first (unchanged)', async () => {
    const p = await make(null);
    expect(p.cmp.screens().length).toBe(9);
    expect(p.cmp.selectedScreen()).toBe('admin');
  });
  it('a department with no screens says so and loads nothing', async () => {
    const p = await make('opd');
    expect(p.el.querySelector('[data-testid="kpi-dept-empty"]')).not.toBeNull();
    expect(p.api.get.mock.calls.some((c: unknown[]) => String(c[0]).startsWith('/api/kpis/assignments'))).toBe(false);
  });
  it('the Numbers page is that screen narrowed to the lab', async () => {
    const p = await renderLabPage(LabNumbersPage, '/page', { getFor: u => u.startsWith('/api/kpis/catalog') ? catalog : [] });
    expect(p.el.querySelector('pf-kpi-config')).not.toBeNull();
    expect(p.api.get.mock.calls.some((c: unknown[]) => String(c[0]).includes('screen=frontdesk_landing'))).toBe(true);
    expect(p.api.get.mock.calls.some((c: unknown[]) => String(c[0]).includes('screen=admin'))).toBe(false);
  });
});

describe('Payment rules card (moved to Billing; one extractable component)', () => {
  const make = (allowed: boolean, cfg: Record<string, unknown> = {}) => {
    const p = renderBandPage(PaymentRulesCardComponent, {
      getFor: u => u === '/api/tenants/branch-lab-config' ? cfg : [],
      providers: [
        { provide: AuthService, useValue: { user: () => ({}), hasPermission: () => allowed, hasAnyPermission: () => allowed, isAuthenticated: () => true, waitForAuth: async () => undefined } },
        { provide: BranchLabConfigService, useValue: { update: vi.fn(), ensureLoaded: vi.fn() } },
      ],
    });
    return p;
  };
  it('renders nothing and reads nothing for people without the revenue permission', () => {
    const p = make(false);
    expect(p.el.querySelector('section')).toBeNull();
    expect(p.api.get).not.toHaveBeenCalled();
  });
  it('require full payment PATCHes paymentGateStage; payments-due tab PATCHes showPaymentsDueTab', () => {
    const p = make(true, { paymentGateStage: 'none', showPaymentsDueTab: true });
    expect(Array.from(p.el.querySelectorAll('.pf-card__label')).map(x => text(x))).toEqual(['Require full payment to progress', 'Show "Payments due" tab']);
    Array.from(p.el.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(b => text(b).startsWith('Block at report'))!.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { paymentGateStage: 'report' });
    p.el.querySelector<HTMLButtonElement>('button[aria-label="Show &quot;Payments due&quot; tab"], [data-testid="pr-due"] button[role="switch"]')!.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { showPaymentsDueTab: false });
  });
  it('reads the legacy requireBillBeforeCollection as block at dispatch', () => {
    const p = make(true, { requireBillBeforeCollection: true });
    expect(p.el.querySelector('[role="radio"][aria-checked="true"]')!.textContent).toContain('Block at dispatch');
  });
});

describe('Inventory › Enable inventory (moved from Lab settings)', () => {
  const make = (entitled: boolean, enabled = false) => renderBandPage(InventoryEnableCardComponent, {
    getFor: u => u === '/api/tenants/branch-lab-config' ? { inventoryEnabled: enabled } : [],
    providers: [
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => entitled, ensureLoaded: vi.fn() } },
      { provide: BranchLabConfigService, useValue: { update: vi.fn(), ensureLoaded: vi.fn() } },
    ],
  });
  it('hidden when the lab does not have the Inventory module', () => {
    expect(make(false).el.querySelector('section')).toBeNull();
  });
  it('shown when the lab has it', () => {
    expect(make(true).el.querySelector('[data-testid="inventory-enable"]')).not.toBeNull();
  });
  it('PATCHes only inventoryEnabled; reads the saved state', () => {
    const p = make(true, true);
    const sw = p.el.querySelector<HTMLButtonElement>('[data-testid="inventory-enable-switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { inventoryEnabled: false });
  });
});
