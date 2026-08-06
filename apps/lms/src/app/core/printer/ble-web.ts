/// <reference types="web-bluetooth" />

// Web Bluetooth can only touch services declared up-front, so we declare a
// broad set of the BLE services these cheap thermal printers actually use, then
// auto-discover the writable characteristic among them (mirrors the native
// mobile plugins). If a printer's service isn't here, its UUIDs are logged so
// we can add it.
const CANDIDATE_SERVICES: BluetoothServiceUUID[] = [
  0xae30, 0xae00, 0xff00, 0xff10, 0xffe0, 0xffe5, 0xfff0, 0x18f0, 0xffb0, 0xfee7, 0xff80,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC/Microchip transparent UART (very common)
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

/**
 * Web-Bluetooth transport for the DP27 on the Electron desktop. BLE is the ONE
 * wireless path that also works on the iPad, so desktop uses the same encoder;
 * only the pairing differs (here: navigator.bluetooth + Electron's in-app
 * picker; on iPad: the Capacitor plugin).
 *
 * The pairing list is surfaced by Electron's `select-bluetooth-device` handler
 * (main → 'ble:devices'); the settings screen shows it and calls
 * electronAPI.ble.choose(id), which resolves requestDevice() here.
 */
type BleWindow = Window & { electronAPI?: { ble?: { choose(id: string): void; cancel(): void } } };

export class BleWebPrinter {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  get deviceName(): string | null { return this.device?.name ?? null; }
  isConnected(): boolean { return !!this.device?.gatt?.connected && !!this.characteristic; }
  /** A device has been paired this session (may be disconnected — reconnectable). */
  hasDevice(): boolean { return !!this.device; }

  /** Trigger the (in-app) chooser, connect GATT, and grab the write char.
   *  Must be called from a user gesture. */
  async requestAndConnect(): Promise<string> {
    const bt = (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
    if (!bt) throw new Error('Bluetooth not available in this app build.');
    const device = await bt.requestDevice({
      acceptAllDevices: true,
      optionalServices: CANDIDATE_SERVICES,
    });
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => { this.characteristic = null; });
    await this.connectGatt();
    return device.name ?? device.id;
  }

  private async connectGatt(): Promise<void> {
    if (!this.device?.gatt) throw new Error('No device');
    const server = await this.device.gatt.connect();
    // Auto-discover: scan every accessible service and SCORE the writable
    // characteristics, so we pick the print-data channel (e.g. 0xff02 on 0xff00)
    // rather than a config/OTA one (e.g. 0xff11). Higher score wins.
    const short = (u: string) => (/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i.exec(u)?.[1] ?? u).toLowerCase();
    const PREF_CHAR = new Set(['ff02', 'ffe1', 'ae01', '2af1']); // known print-data chars
    const PREF_SVC = new Set(['ff00', 'ffe0', 'ae30', '18f0']);
    const services = await server.getPrimaryServices().catch(() => []);
    const found: string[] = [];
    let best: { ch: BluetoothRemoteGATTCharacteristic; score: number } | null = null;
    for (const svc of services) {
      const chars = await svc.getCharacteristics().catch(() => []);
      for (const ch of chars) {
        const p = ch.properties;
        found.push(`${svc.uuid} / ${ch.uuid} [${p.write ? 'W' : ''}${p.writeWithoutResponse ? 'Wn' : ''}]`);
        if (!p.write && !p.writeWithoutResponse) continue;
        const score =
          (PREF_CHAR.has(short(ch.uuid)) ? 100 : 0) +
          (PREF_SVC.has(short(svc.uuid)) ? 20 : 0) +
          (p.write ? 10 : 0) +
          (p.writeWithoutResponse ? 1 : 0);
        if (!best || score > best.score) best = { ch, score };
      }
    }
    this.characteristic = best?.ch ?? null;
    // Log what the printer exposes — invaluable if a new model shows up.
    console.info('[pf-printer] BLE services:', found.length ? found : '(none accessible)');
    if (this.characteristic) {
      const p = this.characteristic.properties;
      console.info('[pf-printer] using char', this.characteristic.uuid,
        `[${p.write ? 'write ' : ''}${p.writeWithoutResponse ? 'writeNoResp' : ''}]`);
    }
    if (!this.characteristic) {
      throw new Error(
        'Paired, but no writable Bluetooth service was found on this printer. ' +
        'Open the console and share the "[pf-printer] BLE services" line so the ' +
        'printer service UUID can be added.'
      );
    }
  }

  /** Reconnect to the already-chosen device (no chooser) — for a later print. */
  async ensureConnected(): Promise<void> {
    if (this.isConnected()) return;
    if (!this.device) throw new Error('No Bluetooth printer paired.');
    await this.connectGatt();
  }

  /** Write raw bytes to the printer, chunked + paced for BLE.
   *  Prefers acked writes (self-pacing, reliable, browser splits long values);
   *  falls back to small write-without-response chunks with a tiny delay so the
   *  peripheral's buffer doesn't overflow and drop data. */
  async write(bytes: Uint8Array): Promise<void> {
    await this.ensureConnected();
    const c = this.characteristic!;
    const useResp = c.properties.write; // acked → reliable
    const chunk = useResp ? 200 : 20;   // no-response must stay under the ATT MTU
    for (let off = 0; off < bytes.length; off += chunk) {
      const slice = bytes.slice(off, Math.min(off + chunk, bytes.length));
      const buf = slice as unknown as BufferSource;
      if (useResp) {
        await c.writeValueWithResponse(buf);
      } else {
        await c.writeValueWithoutResponse(buf);
        await new Promise((r) => setTimeout(r, 6));
      }
    }
  }

  disconnect(): void {
    try { this.device?.gatt?.disconnect(); } catch { /* ignore */ }
    this.characteristic = null;
  }

  /** Resolve the in-app chooser with the tapped deviceId. */
  static choose(deviceId: string): void { (window as BleWindow).electronAPI?.ble?.choose(deviceId); }
  static cancel(): void { (window as BleWindow).electronAPI?.ble?.cancel(); }
}
