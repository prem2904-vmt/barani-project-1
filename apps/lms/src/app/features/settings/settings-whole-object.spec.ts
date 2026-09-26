import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AlertsAdapter } from './adapters/alerts.adapter';
import { AppointmentsAdapter } from './adapters/appointments.adapter';
import { BillingAdapter } from './adapters/billing.adapter';
import { IdFormatAdapter } from './adapters/id-format.adapter';
import { SettingRowComponent } from './setting-row.component';
import { SETTINGS, SETTINGS_BY_ID } from './settings-registry';
import { searchRows } from './settings-search';
import { SettingsStore } from './settings-store.service';
import { configure, flush } from './settings.spec-helpers';

describe('Whole-object stores: debounce, re-fetch, then write once', () => {
  afterEach(() => vi.useRealTimers());

  it('billing: two quick changes → ONE POST built on a fresh GET (another admin\'s change survives)', async () => {
    vi.useFakeTimers();
    const h = configure();
    let server: Record<string, unknown> = { gstEnabled: true, allowDiscounts: true, maxDiscountPct: 10, frontdeskCanSeeWalletBalance: false };
    h.api.get.mockImplementation(((url: string) => of(url === '/api/config/billing' ? { ...server } : null)) as never);
    const store = TestBed.inject(SettingsStore);
    const gst = SETTINGS_BY_ID.get('bil.gst')!;
    const cap = SETTINGS_BY_ID.get('bil.maxDisc')!;
    store.ensure([gst]);
    await flush();
    server = { ...server, approvalThresholdPct: 40 };             // someone else saved meanwhile
    const a = store.write(gst, false);
    const b = store.write(cap, 15);
    expect(store.read(gst)).toBe(false);                            // shown at once
    expect(h.api.post).not.toHaveBeenCalled();                      // debounced
    await vi.advanceTimersByTimeAsync(700);
    await Promise.all([a, b]);
    expect(h.api.post).toHaveBeenCalledTimes(1);
    const call = (h.api.post.mock.calls as unknown as unknown[][])[0];
    const body = call[1] as Record<string, unknown>;
    expect(call[0]).toBe('/api/config/billing');
    expect(body).toMatchObject({ gstEnabled: false, maxDiscountPct: 15, approvalThresholdPct: 40, frontdeskCanSeeWalletBalance: false });
  });

  it('a failed save rejects every waiting row and puts the server value back', async () => {
    vi.useFakeTimers();
    const h = configure();
    h.api.get.mockImplementation(((url: string) => of(url === '/api/config/billing' ? { gstEnabled: true } : null)) as never);
    h.api.post.mockImplementation((() => { throw new Error('Forbidden'); }) as never);
    const store = TestBed.inject(SettingsStore);
    const gst = SETTINGS_BY_ID.get('bil.gst')!;
    store.ensure([gst]);
    const p = store.write(gst, false);
    const settled = p.then(() => 'ok', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(700);
    expect(await settled).toBe('Forbidden');
    expect(store.read(gst)).toBe(true);
  });

  it('validation stops bad values before any call', async () => {
    const h = configure();
    const store = TestBed.inject(SettingsStore);
    await expect(store.write(SETTINGS_BY_ID.get('bil.maxDisc')!, 150)).rejects.toThrow(/100%/);
    await expect(store.write(SETTINGS_BY_ID.get('bil.gstin')!, '29ABC')).rejects.toThrow(/15/);
    expect(h.api.post).not.toHaveBeenCalled();
  });

  it('GST number: the state code comes from the GSTIN, for the branch the row edits', async () => {
    const h = configure({ branches: [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Annex' }] });
    const store = TestBed.inject(SettingsStore);
    store.setBranch('b2');
    await store.write(SETTINGS_BY_ID.get('bil.gstin')!, '29ABCDE1234F1Z5');
    expect(h.api.post).toHaveBeenCalledWith('/api/config/gst', { branchId: 'b2', gstin: '29ABCDE1234F1Z5', stateCode: '29' });
    expect(store.read(SETTINGS_BY_ID.get('bil.gstin')!)).toBe('29ABCDE1234F1Z5');
  });

  it('appointments: open hours fold into the weekly schedule, per branch; closing must be after opening', async () => {
    vi.useFakeTimers();
    const h = configure();
    h.api.get.mockImplementation(((url: string) => of(url === '/api/appointments/config'
      ? { branchId: 'b1', slotMinutes: 15, open24h: false, maxConcurrentSlots: 1, queueMode: 'token_queue',
          weeklyScheduleJson: JSON.stringify({ mon: [{ from: '08:00', to: '20:00' }] }), queueOptions: {} } : null)) as never);
    h.api.put.mockImplementation(((_u: string, body: unknown) => of(body)) as never);
    const store = TestBed.inject(SettingsStore);
    const hours = SETTINGS_BY_ID.get('fd.openHours')!;
    store.ensure([hours]);
    await flush();
    expect(store.read(hours, 'hours.from')).toBe('08:00');
    await expect(store.write(hours, '21:00', 'hours.from')).rejects.toThrow(/after opening/);
    const p = store.write(hours, '07:30', 'hours.from');
    await vi.advanceTimersByTimeAsync(700);
    await p;
    const [url, body, opts] = (h.api.put.mock.calls as unknown as unknown[][])[0] as [string, { weeklyScheduleJson: string }, unknown];
    expect(url).toBe('/api/appointments/config');
    expect(JSON.parse(body.weeklyScheduleJson).sun).toEqual([{ from: '07:30', to: '20:00' }]);
    expect(opts).toEqual({ headers: { 'X-Active-Branch': 'b1' } });
    expect(TestBed.inject(AppointmentsAdapter)).toBeTruthy();
  });

  it('ID formats: the preview follows the fields; letters switch = alpha serial', async () => {
    vi.useFakeTimers();
    const h = configure();
    h.api.get.mockImplementation(((url: string) => of(url === '/api/config/sample-id'
      ? { enabled: true, datePrefix: 'none', separator: '-', padding: 3, serialMode: 'numeric', letterCount: 2 } : null)) as never);
    const store = TestBed.inject(SettingsStore);
    const def = SETTINGS_BY_ID.get('col.sampleId')!;
    store.ensure([def]);
    await flush();
    expect(store.read(def, 'sample.preview')).toBe('MIC-001');
    const p = store.write(def, true, 'sample.letters');
    expect(store.read(def, 'sample.preview')).toBe('MIC-AA001');
    await vi.advanceTimersByTimeAsync(700);
    await p;
    expect(h.api.post).toHaveBeenCalledWith('/api/config/sample-id', expect.objectContaining({ serialMode: 'alpha', padding: 3, enabled: true }));
    expect(TestBed.inject(IdFormatAdapter)).toBeTruthy();
  });
});

describe('Composite rows ask first, then edit inline', () => {
  it('"Change" on an ID format confirms before the fields open', async () => {
    const h = configure({ confirm: false });
    TestBed.inject(SettingsStore).ensure([SETTINGS_BY_ID.get('setup.orderId')!]);
    await flush();
    const f = TestBed.createComponent(SettingRowComponent);
    f.componentRef.setInput('def', SETTINGS_BY_ID.get('setup.orderId')!);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('.pf-sr__change')!.click();
    await flush(); f.detectChanges();
    expect(h.dialog.confirm).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.pf-sr__fields')).toBeNull();          // declined → stays closed
    h.dialog.confirm.mockResolvedValue(true as never);
    el.querySelector<HTMLButtonElement>('.pf-sr__change')!.click();
    await flush(); f.detectChanges();
    expect(el.querySelector('.pf-sr__fields')).not.toBeNull();
    expect(el.querySelector('.pf-sr__looks')!.textContent).toContain('LAB');
    expect(el.querySelector('select')).toBeNull();                  // pf-select, never native
  });
});

describe('Alerts: one row per catalog event, in-app only', () => {
  it('rows come from the backend catalog; overdue ones carry "Alert after"; writes POST that event', async () => {
    const h = configure({ perms: ['manage_tenant'] });
    h.api.get.mockImplementation(((url: string) => of(url === '/api/config/notifications/catalog' ? [
      { key: 'critical_result', module: 'results', label: 'Critical result entered', firesWhen: 'A result is critical.',
        recipients: 'Pathologists', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false },
      { key: 'sample_overdue', module: 'lab', label: 'Sample not received', firesWhen: 'Not received in time.',
        recipients: 'Lab techs', kind: 'overdue', enabled: false, thresholdMinutes: 60, thresholdConfigurable: true },
    ] : null)) as never);
    const store = TestBed.inject(SettingsStore);
    store.ensure(SETTINGS);
    await flush();
    const alerts = store.allowedRows().filter((d) => d.adapter === 'alerts');
    expect(alerts.map((d) => d.label)).toEqual(['Critical result entered', 'Sample not received']);
    expect(alerts[0].subgroup).toBe('Results');
    expect(alerts[0].screens).toEqual(['result', 'pathologist']);
    expect(alerts[1].control.fields?.[0].label).toBe('Alert after');
    await store.write(alerts[1], true);
    expect(h.api.post).toHaveBeenCalledWith('/api/config/notifications',
      { eventType: 'sample_overdue', inAppEnabled: true, thresholdMinutes: 60 });
    expect(TestBed.inject(AlertsAdapter).read('sample_overdue.enabled')).toBe(true);
    expect(searchRows(store.allowedRows(), 'notification critical').map((d) => d.id)).toEqual(['alert.critical_result']);
  });
});

describe('Settings search — phase 2 rows', () => {
  const ids = (q: string) => searchRows(SETTINGS, q).map((d) => d.id);
  it('everyday words land on the right rows', () => {
    expect(ids('tax')).toContain('bil.gst');
    expect(ids('discount')).toEqual(expect.arrayContaining(['bil.discounts', 'bil.maxDisc']));
    expect(ids('printer')).toEqual(expect.arrayContaining(['col.printer', 'rep.docPrinter']));
    expect(ids('mrn')).toContain('setup.patientId');
    expect(ids('invoice number')).toContain('bil.invoiceNo');
    expect(ids('culture')).toEqual(expect.arrayContaining(['lab.cultureRelease', 'lab.cultureTat']));
  });
});
