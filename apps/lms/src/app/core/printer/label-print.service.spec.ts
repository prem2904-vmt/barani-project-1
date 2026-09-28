import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { LabelPrintService, NO_LABEL_PRINTER_TITLE, PRINTING_SETTINGS_ROUTE } from './label-print.service';
import { LabelPrinterState, PrinterService } from './printer.service';
import { PrintConfigService } from './print-config.service';
import { DialogActionResult, DialogService } from '../services/dialog.service';
import { ToastService } from '../services/toast.service';
import { PlatformService } from '../services/platform.service';

/**
 * Owner 2026-09-28: "Print label is only for the printer". Tube labels go to
 * the station's label printer; no printer → a dialog, never a fallback print.
 */
const order = { id: 'o1', patient: { id: 'p1', displayName: 'Mr. Arun Kumar', age: 52, sex: 'Male', mrn: 'MW0131' } };
const samples = [
  { id: 's1', barcode: '26209', tubeColor: 'edta', order, departments: [{ id: 'd', name: 'Haematology', code: 'HEM' }] },
  { id: 's2', barcode: '26210', tubeColor: 'sst', order, departments: [{ id: 'b', name: 'Biochemistry', code: 'BIO' }] },
] as any[];

function setup(opts: {
  state: LabelPrinterState | LabelPrinterState[];
  send?: (n: number) => { ok: boolean; direct: boolean; offline?: boolean; error?: string };
  answer?: DialogActionResult | DialogActionResult[];
  labelRoute?: 'printer' | 'system';
}) {
  const states = Array.isArray(opts.state) ? [...opts.state] : [opts.state];
  let sends = 0;
  const printer = {
    labelPrinterState: vi.fn(async () => (states.length > 1 ? states.shift()! : states[0])),
    printLabelData: vi.fn(async (_d: any, _o?: any) => (opts.send ? opts.send(sends++) : { ok: true, direct: true })),
  };
  const cfg = { labelRoute: opts.labelRoute ?? 'printer' };
  const printConfig = {
    config: () => cfg,
    labelOpts: () => ({ widthMm: 50, heightMm: 25, codeMode: 'barcode' }),
    setLabelRoute: vi.fn((r: 'printer' | 'system') => { cfg.labelRoute = r; }),
  };
  const answers = Array.isArray(opts.answer) ? [...opts.answer] : [opts.answer ?? { action: null, checked: false }];
  const dialog = { actions: vi.fn(async (_req: any) => answers.length > 1 ? answers.shift()! : answers[0]) };
  const toasts = { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() };
  const router = { navigate: vi.fn(async () => true) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PrinterService, useValue: printer },
      { provide: PrintConfigService, useValue: printConfig },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: Router, useValue: router },
    ],
  });
  const svc = TestBed.inject(LabelPrintService);
  const systemPrint = vi.fn();
  const run = () => svc.printTubeLabels({ samples, systemPrint });
  return { svc, printer, printConfig, dialog, toasts, router, systemPrint, run };
}

const actionValues = (dialog: { actions: any }) =>
  (dialog.actions.mock.calls[0][0].actions as { value: string }[]).map(a => a.value);

describe('LabelPrintService — print label goes ONLY to the label printer', () => {
  let printSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined); });
  afterEach(() => { printSpy.mockRestore(); TestBed.resetTestingModule(); });

  it('printer configured → streams each label directly, no dialog, no system print', async () => {
    const t = setup({ state: { platform: 'native', configured: true, name: 'DP27' } });
    expect(await t.run()).toBe('printed');
    expect(t.printer.printLabelData).toHaveBeenCalledTimes(2);
    const [first] = t.printer.printLabelData.mock.calls[0] as any[];
    expect(first).toMatchObject({ code: '26209', patientName: 'Mr. Arun Kumar', ageSex: '52Y M', mrn: 'MW0131', qrValue: 'MW0131|26209' });
    expect(t.dialog.actions).not.toHaveBeenCalled();
    expect(t.systemPrint).not.toHaveBeenCalled();
    expect(printSpy).not.toHaveBeenCalled();
  });

  it('Electron, no printer → no print call at all; dialog offers Set up only (no system-dialog fallback)', async () => {
    const t = setup({ state: { platform: 'electron', configured: false, name: null } });
    expect(await t.run()).toBe('no-printer');
    expect(t.printer.printLabelData).not.toHaveBeenCalled();
    expect(t.systemPrint).not.toHaveBeenCalled();
    expect(printSpy).not.toHaveBeenCalled();
    const req = t.dialog.actions.mock.calls[0][0] as any;
    expect(req.title).toBe(NO_LABEL_PRINTER_TITLE);
    expect(req.title).toBe('No label printer connected on this device');
    expect(actionValues(t.dialog)).toEqual(['setup']);
    expect(req.checkbox).toBeUndefined();
  });

  it('native app, no printer → same: never offers the system dialog', async () => {
    const t = setup({ state: { platform: 'native', configured: false, name: null }, answer: { action: 'system', checked: true } });
    expect(await t.run()).toBe('no-printer');
    expect(actionValues(t.dialog)).not.toContain('system');
    expect(t.systemPrint).not.toHaveBeenCalled();
    expect(t.printConfig.setLabelRoute).not.toHaveBeenCalled();
  });

  it('native/Electron ignore a stored "system" label route', async () => {
    const t = setup({ state: { platform: 'electron', configured: false, name: null }, labelRoute: 'system' });
    await t.run();
    expect(t.systemPrint).not.toHaveBeenCalled();
    expect(t.dialog.actions).toHaveBeenCalledTimes(1);
  });

  it('"Set up label printer" goes to the station Printing settings', async () => {
    const t = setup({ state: { platform: 'electron', configured: false, name: null }, answer: { action: 'setup', checked: false } });
    await t.run();
    expect(t.router.navigate).toHaveBeenCalledWith([PRINTING_SETTINGS_ROUTE]);
    expect(PRINTING_SETTINGS_ROUTE).toBe('/printing');
  });

  it('configured but offline → dialog names the printer and offers Retry; Retry prints', async () => {
    const t = setup({
      state: { platform: 'electron', configured: true, name: 'DP27 Label' },
      send: (n) => n === 0 ? { ok: false, direct: true, offline: true, error: 'not connected' } : { ok: true, direct: true },
      answer: { action: 'retry', checked: false },
    });
    expect(await t.run()).toBe('printed');
    const req = t.dialog.actions.mock.calls[0][0] as any;
    expect(req.message).toContain('DP27 Label');
    expect(actionValues(t.dialog)).toEqual(['setup', 'retry']);
    expect(t.dialog.actions).toHaveBeenCalledTimes(1);
    // 1 offline attempt + 2 successful labels on retry
    expect(t.printer.printLabelData).toHaveBeenCalledTimes(3);
    expect(t.systemPrint).not.toHaveBeenCalled();
  });

  it('Retry is not offered when no printer is configured', async () => {
    const t = setup({ state: { platform: 'web', configured: false, name: null } });
    await t.run();
    expect(actionValues(t.dialog)).not.toContain('retry');
  });

  it('web, no printer → dialog with an explicit, secondary "Print via system dialog" + Don\'t ask again; never auto-invoked', async () => {
    const t = setup({ state: { platform: 'web', configured: false, name: null } }); // user cancels
    expect(await t.run()).toBe('no-printer');
    const req = t.dialog.actions.mock.calls[0][0] as any;
    const sys = req.actions.find((a: any) => a.value === 'system');
    expect(sys.label).toBe('Print via system dialog');
    expect(sys.variant).toBe('secondary');
    expect(req.checkbox.label).toMatch(/Don't ask again on this device/);
    expect(t.systemPrint).not.toHaveBeenCalled();
    expect(t.printer.printLabelData).not.toHaveBeenCalled();
    expect(printSpy).not.toHaveBeenCalled();
  });

  it('web, user picks the system dialog → label-sized system print once; preference unchanged when unticked', async () => {
    const t = setup({ state: { platform: 'web', configured: false, name: null }, answer: { action: 'system', checked: false } });
    expect(await t.run()).toBe('system');
    expect(t.systemPrint).toHaveBeenCalledTimes(1);
    expect(t.printConfig.setLabelRoute).not.toHaveBeenCalled();
  });

  it('web, "Don\'t ask again" → stored per station; next print goes straight to the system dialog', async () => {
    const t = setup({ state: { platform: 'web', configured: false, name: null }, answer: { action: 'system', checked: true } });
    await t.run();
    expect(t.printConfig.setLabelRoute).toHaveBeenCalledWith('system');
    t.dialog.actions.mockClear();
    t.systemPrint.mockClear();
    expect(await t.run()).toBe('system');
    expect(t.dialog.actions).not.toHaveBeenCalled();
    expect(t.systemPrint).toHaveBeenCalledTimes(1);
  });

  it('a ticked box with Cancel does not store the preference', async () => {
    const t = setup({ state: { platform: 'web', configured: false, name: null }, answer: { action: null, checked: true } });
    await t.run();
    expect(t.printConfig.setLabelRoute).not.toHaveBeenCalled();
  });

  it('no tubes → nothing printed, no dialog', async () => {
    const t = setup({ state: { platform: 'native', configured: true, name: 'DP27' } });
    expect(await t.svc.printTubeLabels({ samples: [], systemPrint: t.systemPrint })).toBe('empty');
    expect(t.printer.printLabelData).not.toHaveBeenCalled();
    expect(t.dialog.actions).not.toHaveBeenCalled();
  });
});

describe('PrinterService — no browser-print fallback for labels', () => {
  function make(platform: { electron: boolean; capacitor: boolean }) {
    TestBed.configureTestingModule({
      providers: [
        { provide: PlatformService, useValue: { isElectron: () => platform.electron, isCapacitor: () => platform.capacitor } },
        { provide: PrintConfigService, useValue: { driverOpts: () => ({ density: 4, speed: 1 }), labelOpts: () => ({ widthMm: 50, heightMm: 25, codeMode: 'qr' }) } },
      ],
    });
    return TestBed.inject(PrinterService);
  }
  afterEach(() => TestBed.resetTestingModule());

  it('plain web: no label printer is ever "configured"', async () => {
    const p = make({ electron: false, capacitor: false });
    expect(await p.labelPrinterState()).toEqual({ platform: 'web', configured: false, name: null });
  });

  it('plain web: printLabel() throws instead of opening the print dialog', async () => {
    const spy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const p = make({ electron: false, capacitor: false });
    await expect(p.printLabel({ code: 'X' } as any)).rejects.toThrow(/No label printer/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('native: configured = a paired BLE printer', async () => {
    const store = new Map<string, string>([['pf.printer.deviceId', 'dev-1'], ['pf.printer.deviceName', 'DP27']]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const p = make({ electron: false, capacitor: true });
    expect(await p.labelPrinterState()).toEqual({ platform: 'native', configured: true, name: 'DP27' });
    store.clear();
    TestBed.resetTestingModule();
    const q = make({ electron: false, capacitor: true });
    expect((await q.labelPrinterState()).configured).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('Every "Print label" caller goes through LabelPrintService', () => {
  const root = resolve(process.cwd(), 'apps/lms/src/app');
  const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
  const callers = [
    'features/lab/sample-collection/sample-collection.component.ts',
    'features/frontdesk/post-payment/post-payment.component.ts',
    'features/frontdesk/frontdesk-landing/frontdesk-landing.component.ts',
    'features/frontdesk/order-create/order-create.component.ts',
    'features/frontdesk/patient-profile/patient-profile.component.ts',
  ];

  for (const f of callers) {
    it(`${f.split('/').pop()} → labelPrint.printTubeLabels, printTubeLabels() only inside systemPrint`, () => {
      const src = read(f);
      expect(src).toContain('inject(LabelPrintService)');
      expect(src).toContain('this.labelPrint.printTubeLabels(');
      // No per-screen transport logic left behind.
      expect(src).not.toMatch(/directPrintAvailable|printLabelData|printLabelOnly/);
      // Every raw printTubeLabels() call sits inside the systemPrint callback.
      const raw = [...src.matchAll(/(?<![.\w])printTubeLabels\(/g)].map(m => m.index!);
      expect(raw.length).toBeGreaterThan(0);
      for (const i of raw) {
        const before = src.slice(Math.max(0, i - 600), i);
        expect(before).toContain('systemPrint:');
      }
    });
  }

  it('non-label prints are untouched (inventory, stores, patient ID card keep their own print)', () => {
    for (const f of ['features/admin/inventory/inventory.component.ts', 'features/stores/stores.component.ts', 'features/frontdesk/patient-profile/patient-id-card.component.ts']) {
      const src = read(f);
      expect(src).toContain('printLabelOnly()');
      expect(src).not.toContain('LabelPrintService');
    }
  });
});
