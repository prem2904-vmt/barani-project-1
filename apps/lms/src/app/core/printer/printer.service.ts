import { Injectable, inject, signal } from '@angular/core';
import { PlatformService } from '../services/platform.service';
import {
  PrefrontalPrinter,
  PfBleDevice,
} from './prefrontal-printer.plugin';
import {
  LabelInput,
  buildTsplLabel,
  bytesToBase64,
} from './label-tspl';
import { printLabelOnly } from '../../shared/utils/print-label';
import { renderLabelBitmap, LabelData, LabelCodeMode } from './label-render';
import { buildBleJob } from './dp27';
import { BleWebPrinter } from './ble-web';

// Thermal density (0–14) / speed (0–4). Light so 2D codes + text stay crisp.
const DENSITY = 4;
const SPEED = 2;

const DEVICE_KEY = 'pf.printer.deviceId';
const NAME_KEY = 'pf.printer.deviceName';

/** The USB printer bridge exposed by the Electron preload (desktop only). */
interface ElectronPrinter {
  status(): Promise<{ connected: boolean; name?: string; error?: string }>;
  print(p: { widthDots: number; heightDots: number; packed: string; density?: number; speed?: number }):
    Promise<{ ok: boolean; error?: string; bytes?: number }>;
}
function electronPrinter(): ElectronPrinter | undefined {
  return (window as unknown as { electronAPI?: { printer?: ElectronPrinter } })?.electronAPI?.printer;
}

/**
 * PrinterService — the single entry point the app uses to print a label.
 *
 * On a native (Capacitor) build it streams TSPL over BLE via the
 * PrefrontalPrinter plugin; on web/electron it falls back to the existing
 * browser print path (printLabelOnly) so nothing regresses on desktop.
 *
 * The chosen printer is remembered in localStorage so day-to-day printing
 * needs no pairing step — only the first setup does.
 */
@Injectable({ providedIn: 'root' })
export class PrinterService {
  private readonly platform = inject(PlatformService);

  /** Web-Bluetooth transport for the Electron desktop (BLE). */
  private readonly bleWeb = new BleWebPrinter();

  /** Reactive connection state for the settings UI. */
  readonly connected = signal(false);
  readonly deviceName = signal<string | null>(
    typeof localStorage !== 'undefined' ? localStorage.getItem(NAME_KEY) : null
  );

  /** BLE printing is only possible inside the native shell. */
  supported(): boolean {
    return this.platform.isCapacitor();
  }

  savedDeviceId(): string | null {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem(DEVICE_KEY)
      : null;
  }

  async requestPermissions(): Promise<boolean> {
    const r = await PrefrontalPrinter.requestPermissions();
    return !!r.granted;
  }

  async scan(timeoutMs = 6000): Promise<PfBleDevice[]> {
    const r = await PrefrontalPrinter.scan({ timeoutMs });
    return r.devices ?? [];
  }

  /** Pair with a device and remember it as the default printer. */
  async selectDevice(device: PfBleDevice): Promise<void> {
    await PrefrontalPrinter.connect({ deviceId: device.deviceId });
    localStorage.setItem(DEVICE_KEY, device.deviceId);
    localStorage.setItem(NAME_KEY, device.name ?? device.deviceId);
    this.deviceName.set(device.name ?? device.deviceId);
    this.connected.set(true);
  }

  async disconnect(): Promise<void> {
    try {
      await PrefrontalPrinter.disconnect();
    } finally {
      this.connected.set(false);
    }
  }

  /** Ensure a live connection to the remembered printer (reconnect if needed). */
  private async ensureConnected(): Promise<void> {
    const state = await PrefrontalPrinter.isConnected();
    if (state.connected) {
      this.connected.set(true);
      return;
    }
    const id = this.savedDeviceId();
    if (!id) throw new Error('No printer paired. Set one up in Lab settings.');
    await PrefrontalPrinter.connect({ deviceId: id });
    this.connected.set(true);
  }

  /**
   * Print a label. On native → TSPL over BLE. On web/electron → the DOM print
   * fallback (the caller must have rendered a `.pf-print-label` element).
   * Returns true if the native BLE path was used.
   */
  async printLabel(label: LabelInput): Promise<boolean> {
    if (!this.supported()) {
      printLabelOnly();
      return false;
    }
    await this.ensureConnected();
    const bytes = buildTsplLabel(label);
    await PrefrontalPrinter.print({ data: bytesToBase64(bytes) });
    return true;
  }

  /** Send an arbitrary TSPL program (used by the settings "Test print"). */
  async printRawTspl(program: string): Promise<void> {
    await this.ensureConnected();
    const bytes = new TextEncoder().encode(program);
    await PrefrontalPrinter.print({ data: bytesToBase64(bytes) });
  }

  // ── Direct label printing (renders the sticker → sends to the printer) ────
  // Desktop (Electron) → USB; the renderer builds the bitmap, main streams it.
  // Native (Capacitor/iPad) → BLE (wired via the plugin's DP27 command layer).

  /** True when a directly-driven printer is available (no OS print dialog):
   *  the Electron shell (USB or Bluetooth) or the native iPad (BLE). */
  directPrintAvailable(): boolean {
    return (this.platform.isElectron() && !!electronPrinter()) || this.platform.isCapacitor();
  }

  /** Query the connected USB printer (Electron only). */
  async electronStatus(): Promise<{ connected: boolean; name?: string }> {
    const p = electronPrinter();
    return p ? p.status() : { connected: false };
  }

  /** True if a Bluetooth printer is currently connected (Electron web-BLE). */
  bleConnected(): boolean { return this.bleWeb.isConnected(); }
  bleDeviceName(): string | null { return this.bleWeb.deviceName; }

  /** Pair a Bluetooth printer on the desktop via the in-app picker. Must be
   *  called from a user gesture (button click). Resolves once the user taps a
   *  device (via pickBleDevice) and GATT connects. */
  async connectBluetooth(): Promise<string> {
    const name = await this.bleWeb.requestAndConnect();
    this.deviceName.set(name);
    this.connected.set(true);
    return name;
  }

  /** Subscribe to the in-app BLE device list Electron streams during pairing.
   *  Returns an unsubscribe fn. */
  onBleDevices(cb: (devices: { deviceId: string; deviceName: string }[]) => void): () => void {
    const api = (window as unknown as { electronAPI?: { ble?: { onDevices(cb: (d: { deviceId: string; deviceName: string }[]) => void): () => void } } })?.electronAPI?.ble;
    return api?.onDevices ? api.onDevices(cb) : () => { /* noop */ };
  }
  /** Resolve the in-app picker with the tapped device. */
  pickBleDevice(id: string): void { BleWebPrinter.choose(id); }
  cancelBlePick(): void { BleWebPrinter.cancel(); }

  /** Send a small test label to whichever transport is active. */
  async testPrint(): Promise<{ ok: boolean; error?: string }> {
    return this.printLabelData(
      { code: 'TEST-0001', patientName: 'Prefrontal', mrn: 'TEST', deptCode: 'TEST', tube: 'Test label' },
      { widthMm: 50, heightMm: 20, codeMode: 'barcode' }
    );
  }

  /**
   * Print a specimen label at the branch's configured size + single code.
   * Transport priority: USB (if a USB printer is plugged in) → else Bluetooth.
   * On the iPad it's always BLE via the plugin. Web without any bridge falls
   * back to the browser print dialog.
   */
  async printLabelData(
    data: LabelData,
    opts: { widthMm: number; heightMm: number; codeMode: LabelCodeMode }
  ): Promise<{ ok: boolean; direct: boolean; error?: string }> {
    const bmp = renderLabelBitmap(data, opts);

    // iPad / native → BLE via the Capacitor plugin (same DP27 BLE stream).
    if (this.platform.isCapacitor()) {
      try {
        await this.ensureConnected();
        const job = buildBleJob(bmp, { density: DENSITY, speed: SPEED });
        await PrefrontalPrinter.print({ data: bytesToBase64(job) });
        return { ok: true, direct: true };
      } catch (e) {
        return { ok: false, direct: true, error: (e as Error)?.message };
      }
    }

    // Desktop (Electron) → USB first, else Bluetooth.
    const p = electronPrinter();
    if (this.platform.isElectron() && p) {
      const st = await p.status().catch(() => ({ connected: false }));
      if (st.connected) {
        const res = await p.print({ ...bmp, density: DENSITY, speed: SPEED }); // USB
        return { ok: res.ok, direct: true, error: res.error };
      }
      if (this.bleWeb.isConnected()) {
        try {
          await this.bleWeb.write(buildBleJob(bmp, { density: DENSITY, speed: SPEED })); // BLE
          return { ok: true, direct: true };
        } catch (e) {
          return { ok: false, direct: true, error: (e as Error)?.message };
        }
      }
      return { ok: false, direct: true, error: 'No printer found — plug in USB or pair Bluetooth in Lab settings.' };
    }

    // Plain web: rely on the DOM print path the caller rendered.
    printLabelOnly();
    return { ok: true, direct: false };
  }
}
