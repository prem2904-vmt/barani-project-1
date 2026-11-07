import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { LabelPrinterComponent } from './label-printer.component';
import { renderBandPage } from '../admin-band.spec-helpers';
import { PrinterService } from '../../../core/printer/printer.service';
import { PrintConfigService } from '../../../core/printer/print-config.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * /printing (new design): band pill = context bar (Printing · station ·
 * label-printer status), Test print = the ONE primary, kit cards below.
 * Every control still writes the same per-station PrintConfigService setting.
 */
/** Same probes as the admin ND audit (not imported: importing a spec file
 *  would re-register its suites here). */
const EMOJI = /[✕✓✔⠿●↑↓]/;
function hygiene(el: HTMLElement) {
  expect(el.querySelector('select, datalist')).toBeNull();
  expect(el.querySelector('.font-mono, .mono, code, .c-green, .c-amber')).toBeNull();
  expect(el.querySelector('input[type="checkbox"]')).toBeNull();
  expect(EMOJI.test(el.textContent ?? '')).toBe(false);
}
const primaries = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('.pf-hb-btn--primary, .pf-btn--primary'))
    .filter(b => !b.closest('.pf-classic-only')).length;

function printerStub(electron = false) {
  return {
    testPrint: vi.fn(async () => ({ ok: true })),
    electronStatus: vi.fn(async () => ({ connected: true, name: 'Detonger DP27' })),
    labelPrinterState: vi.fn(async () => (electron
      ? { platform: 'electron', configured: true, name: 'Detonger DP27' }
      : { platform: 'web', configured: false, name: null })),
    listSystemPrinters: vi.fn(async () => [{ name: 'HP_M1136', displayName: 'HP LaserJet M1136', isDefault: true }]),
    bleConnected: () => false,
    bleDeviceName: () => null,
    connected: signal(false),
    deviceName: signal<string | null>(null),
    onBleDevices: vi.fn(() => () => {}),
    connectBluetooth: vi.fn(async () => 'BLE printer'),
    pickBleDevice: vi.fn(),
    cancelBlePick: vi.fn(),
    requestPermissions: vi.fn(async () => true),
    scan: vi.fn(async () => []),
    selectDevice: vi.fn(async () => {}),
  };
}

function render(opts: { code?: string; electron?: boolean; providers?: unknown[] } = {}) {
  try { localStorage.removeItem('pf.printConfig'); } catch { /* ignore */ }
  // jsdom has no canvas: the preview draw bails out quietly.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const printer = printerStub(!!opts.electron);
  const p = renderBandPage(LabelPrinterComponent, {
    getFor: (url) => (url === '/api/tenants/branch-lab-config' ? { labelCodeMode: opts.code ?? 'barcode' } : []),
    providers: [
      { provide: PrinterService, useValue: printer },
      { provide: PlatformService, useValue: { isElectron: () => !!opts.electron, isCapacitor: () => false } },
      ...(opts.providers ?? []),
    ],
  });
  const cfg = TestBed.inject(PrintConfigService);
  const $ = <T extends Element = HTMLElement>(sel: string) => p.el.querySelector<T & HTMLElement>(sel);
  const click = (sel: string | Element) => {
    const b = typeof sel === 'string' ? $(sel) : (sel as HTMLElement);
    if (!b) throw new Error(`missing ${sel}`);
    (b as HTMLElement).click();
    p.f.detectChanges();
  };
  const btn = (text: string, root: ParentNode = p.el) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b => (b.textContent ?? '').trim().startsWith(text));
  return { ...p, printer, cfg, $, click, btn };
}

afterEach(() => { vi.restoreAllMocks(); TestBed.resetTestingModule(); });

describe('Printing (ND) — structure', () => {
  it('band pill is the context bar: Printing · this station · label-printer status (no pill tabs)', () => {
    const p = render();
    const ctx = p.$('pf-hero-band .pf-ctx')!;
    expect(ctx).not.toBeNull();
    expect(ctx.querySelector('.pf-ctx__primary')!.textContent!.trim()).toBe('Printing');
    expect(ctx.querySelector('.pf-lp-ctx__station')!.textContent).toContain('Web browser');
    const status = ctx.querySelector('.pf-lp-status')!;
    expect(status.getAttribute('data-state')).toBe('web');
    expect(status.textContent).toContain('Needs the desktop or tablet app');
    expect(p.el.querySelector('pf-segmented')).toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
  });

  it('Test print is the ONE primary, in the band actions', () => {
    const p = render();
    expect(primaries(p.el)).toBe(1);
    const acts = p.actions();
    expect(acts.length).toBe(1);
    expect(acts[0].classList.contains('pf-hb-btn--primary')).toBe(true);
    expect(acts[0].getAttribute('aria-label')).toBe('Test print');
  });

  it('kit cards with the icon-chip header: Label size, Label printer, Code & quality (no document printer on the web)', () => {
    const p = render();
    for (const k of ['label', 'printer', 'quality']) {
      const card = p.$(`.pf-card[data-card="${k}"]`);
      expect(card, k).not.toBeNull();
      expect(card!.querySelector('.pf-card__head .pf-card__icon svg')).not.toBeNull();
    }
    expect(p.$('.pf-card[data-card="docs"]')).toBeNull();
    expect(p.$('.pf-card[data-card="printer"] .pf-note')!.textContent).toContain('system print dialog');
    // Everything lives inside the one scrolling body.
    expect(p.body()!.querySelector('.pf-lp-grid')).not.toBeNull();
    hygiene(p.el);
  });

  it('live preview uses the real label bitmap on a label outline sized to the config', () => {
    const p = render();
    const label = p.$('.pf-lp-label')!;
    expect(label.getAttribute('data-w-mm')).toBe('50');
    expect(label.getAttribute('data-h-mm')).toBe('20');
    expect(label.getAttribute('data-code')).toBe('barcode');
    expect(label.querySelector('canvas.pf-lp-label__bmp[role="img"]')).not.toBeNull();
  });
});

describe('Printing (ND) — every control writes the same station config', () => {
  it('size presets apply and show pressed (neutral chip), incl. inch stock', () => {
    const p = render();
    const presets = Array.from(p.el.querySelectorAll<HTMLButtonElement>('[data-card="label"] .pf-lp-preset'));
    expect(presets.map(b => b.textContent!.trim())).toEqual(['50 × 25 mm', '50 × 20 mm', '38 × 25 mm', '2 × 1 in']);
    expect(presets.every(b => b.classList.contains('pf-chip'))).toBe(true);
    expect(presets[1].getAttribute('aria-pressed')).toBe('true'); // default 50 × 20

    p.click(presets[0]);
    expect(p.cfg.config().labelWidthMm).toBe(50);
    expect(p.cfg.config().labelHeightMm).toBe(25);
    expect(presets[0].getAttribute('aria-pressed')).toBe('true');
    expect(presets[1].getAttribute('aria-pressed')).toBe('false');
    expect(p.$('.pf-lp-label')!.getAttribute('data-h-mm')).toBe('25');

    p.click(presets[3]);
    expect(p.cfg.config().labelWidthMm).toBe(50.8);
    expect(p.cfg.config().labelHeightMm).toBe(25.4);
  });

  it('ID card size row: presets (default pressed), custom width / height, same kit controls', () => {
    const p = render();
    const card = p.$('.pf-card[data-card="idcard"]')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('.pf-card__head .pf-card__icon svg')).not.toBeNull();
    expect(card.querySelector('.pf-card__label')!.textContent).toContain('ID card size');
    const presets = Array.from(card.querySelectorAll<HTMLButtonElement>('.pf-lp-preset'));
    expect(presets.map(b => b.textContent!.trim())).toEqual([
      'Card 92 × 62 mm (default)', 'CR80 86 × 54 mm', 'A6 105 × 148 mm', 'A5 148 × 210 mm', 'A4 210 × 297 mm']);
    expect(presets[0].getAttribute('aria-pressed')).toBe('true');
    p.click(presets[1]);
    expect(p.cfg.config().idCardWidthMm).toBe(86);
    expect(p.cfg.config().idCardHeightMm).toBe(54);
    expect(presets[1].getAttribute('aria-pressed')).toBe('true');
    expect(presets[0].getAttribute('aria-pressed')).toBe('false');
    p.click(presets[4]);
    expect(p.cfg.idCardSize()).toEqual({ w: 210, h: 297 });
    const w = p.$<HTMLInputElement>('input[data-field="idcard-width"]')!;
    const h = p.$<HTMLInputElement>('input[data-field="idcard-height"]')!;
    expect(w.classList.contains('pf-input')).toBe(true);
    w.value = '100'; w.dispatchEvent(new Event('change')); p.f.detectChanges();
    h.value = '1000'; h.dispatchEvent(new Event('change')); p.f.detectChanges();
    expect(p.cfg.config().idCardWidthMm).toBe(100);
    expect(p.cfg.config().idCardHeightMm).toBe(300);          // clamped
    expect(p.cfg.config().labelWidthMm).toBe(50);              // the tube label is untouched
    hygiene(p.el);
  });

  it('custom width / height inputs set the label size', () => {
    const p = render();
    const w = p.$<HTMLInputElement>('input[data-field="width"]')!;
    const h = p.$<HTMLInputElement>('input[data-field="height"]')!;
    expect(w.classList.contains('pf-input')).toBe(true);
    w.value = '38'; w.dispatchEvent(new Event('change')); p.f.detectChanges();
    h.value = '25'; h.dispatchEvent(new Event('change')); p.f.detectChanges();
    expect(p.cfg.config().labelWidthMm).toBe(38);
    expect(p.cfg.config().labelHeightMm).toBe(25);
    expect(p.$('.pf-lp-cap')!.textContent).toContain('38 × 25 mm');
  });

  it('darkness / speed / code size sliders write density, speed, codeScalePct', () => {
    const p = render();
    const set = (f: string, v: string) => {
      const i = p.$<HTMLInputElement>(`input[type="range"][data-field="${f}"]`)!;
      i.value = v; i.dispatchEvent(new Event('input')); p.f.detectChanges();
    };
    set('density', '12'); set('speed', '4'); set('codeScale', '80');
    const c = p.cfg.config();
    expect([c.density, c.speed, c.codeScalePct]).toEqual([12, 4, 80]);
    expect(p.$('.pf-card[data-card="quality"]')!.textContent).toContain('12/15');
  });

  it('print position: nudge pad, Reset and Rotate code', () => {
    const p = render();
    p.click('.pf-nudge button[aria-label="Right"]');
    p.click('.pf-nudge button[aria-label="Down"]');
    expect([p.cfg.config().offsetXmm, p.cfg.config().offsetYmm]).toEqual([0.5, 0.5]);
    expect(p.$('.pf-lp-offsets')!.textContent).toContain('X 0.5 mm · Y 0.5 mm');
    p.click(p.btn('Rotate code')!);
    expect(p.cfg.config().rotation).toBe(90);
    p.click(p.btn('Reset')!);
    expect([p.cfg.config().offsetXmm, p.cfg.config().offsetYmm]).toEqual([0, 0]);
  });

  it('thin-barcode warning on narrow stock; none for a 2-D code', () => {
    const p = render();
    expect(p.$('.pf-lp-warn')).toBeNull();
    p.cfg.setLabelSize(25, 15); p.f.detectChanges();
    expect(p.$('.pf-lp-warn')!.textContent).toContain('narrowest bar');
    TestBed.resetTestingModule();
    const q = render({ code: 'qr' });
    q.cfg.setLabelSize(25, 15); q.f.detectChanges();
    expect(q.$('.pf-lp-warn')).toBeNull();
    expect(q.$('.pf-lp-codechip')!.textContent!.trim()).toBe('QR');
  });

  it('the code is read-only here with a Lab settings link for admins only', () => {
    const p = render();
    expect(p.$('.pf-lp-codechip')!.textContent!.trim()).toBe('Barcode');
    expect(p.$('a.pf-lp-codelink')!.getAttribute('href')).toBe('/admin/lab-settings?tab=collection');
    TestBed.resetTestingModule();
    const q = render({ providers: [{ provide: AuthService, useValue: {
      user: () => ({ tenantName: 'Micro World', permissions: [] }), hasPermission: () => false, hasAnyPermission: () => false,
      isAuthenticated: () => true, waitForAuth: async () => undefined } }] });
    expect(q.$('a.pf-lp-codelink')).toBeNull();
    expect(q.$('.pf-lp-codechip')).not.toBeNull();
  });

  it('web: "Labels in this browser" row shows the remembered route and "Ask each time" clears it', () => {
    const p = render();
    const row = () => p.$('.pf-lp-conn[data-conn="route"]')!;
    expect(row().textContent).toContain('Ask each time');
    expect(p.btn('Ask each time', row())).toBeUndefined();
    p.cfg.setLabelRoute('system'); p.f.detectChanges();
    expect(row().textContent).toContain('System print dialog (label-sized page)');
    p.click(p.btn('Ask each time', row())!);
    expect(p.cfg.config().labelRoute).toBe('printer');
  });

  it('Test print is wired to PrinterService.testPrint', async () => {
    const p = render();
    p.click(p.actions()[0]);
    expect(p.printer.testPrint).toHaveBeenCalledTimes(1);
    await p.f.whenStable();
    expect(p.toasts.success).toHaveBeenCalledWith('Test label sent');
  });
});

describe('Printing (ND) — desktop app (Electron)', () => {
  it('USB + Bluetooth rows, connected status in the band, document printer pf-select', async () => {
    const p = render({ electron: true });
    await p.f.whenStable(); p.f.detectChanges();
    expect(p.$('.pf-lp-ctx__station')!.textContent).toContain('Desktop app');
    const status = p.$('.pf-lp-status')!;
    expect(status.getAttribute('data-state')).toBe('connected');
    expect(status.textContent).toContain('Connected · Detonger DP27');
    expect(p.$('.pf-lp-conn[data-conn="usb"]')!.textContent).toContain('Detonger DP27');
    expect(p.$('.pf-lp-conn[data-conn="ble"]')!.textContent).toContain('None paired');
    const docs = p.$('.pf-card[data-card="docs"]')!;
    expect(docs.querySelector('pf-select')).not.toBeNull();
    expect(p.cmp.docPrinterOptions().map((o: { label: string }) => o.label))
      .toEqual(['System dialog (ask each time)', 'HP LaserJet M1136 (default)']);
    p.click(p.btn('Refresh', p.$('.pf-lp-conn[data-conn="usb"]')!)!);
    expect(p.printer.electronStatus).toHaveBeenCalledTimes(2);
    expect(p.$('.pf-lp-conn[data-conn="route"]')).toBeNull();
    p.cmp.printConfig.setDocumentPrinter('HP_M1136');
    expect(p.cfg.config().documentPrinter).toBe('HP_M1136');
    expect(primaries(p.el)).toBe(1);
    hygiene(p.el);
    p.f.destroy();
  });

  it('band shows "set up · not connected" when the shared check says configured but USB is unplugged', async () => {
    const p = render({ electron: true });
    p.printer.electronStatus.mockResolvedValue({ connected: false } as any);
    p.printer.labelPrinterState.mockResolvedValue({ platform: 'electron', configured: true, name: 'Detonger DP27' } as any);
    await p.cmp.refreshUsb(); p.f.detectChanges();
    const status = p.$('.pf-lp-status')!;
    expect(status.getAttribute('data-state')).toBe('offline');
    expect(status.textContent).toContain('Set up · Detonger DP27 · not connected');
    p.printer.labelPrinterState.mockResolvedValue({ platform: 'electron', configured: false, name: null } as any);
    await p.cmp.refreshState(); p.f.detectChanges();
    expect(status.getAttribute('data-state')).toBe('none');
    expect(status.textContent).toContain('Not set up');
    p.f.destroy();
  });
});
