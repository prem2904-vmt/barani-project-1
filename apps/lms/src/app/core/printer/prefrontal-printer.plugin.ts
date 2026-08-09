import { registerPlugin } from '@capacitor/core';

/**
 * PrefrontalPrinter — a thin, BLE-only Capacitor plugin that lets the app
 * stream raw printer bytes (TSPL / ESC-POS / whatever the printer speaks) to a
 * Bluetooth Low Energy label printer, WITHOUT the standalone WePrint app.
 *
 * BLE is deliberate: it is the ONE transport that works on both Android AND iOS
 * with no MFi certification. Classic-Bluetooth (SPP) printers can't be reached
 * from an iOS app unless MFi-certified, so we standardise on BLE for parity.
 *
 * The native side is intentionally dumb: it finds a writable GATT
 * characteristic and chunks the bytes to it. ALL label-language knowledge lives
 * in TypeScript (label-tspl.ts) so the same code drives every platform and the
 * command set can change without touching native code.
 */
export interface PfBleDevice {
  /** Opaque per-platform handle (Android MAC / iOS CBPeripheral UUID). */
  deviceId: string;
  name?: string;
  rssi?: number;
}

export interface PrefrontalPrinterPlugin {
  /** Ask for the runtime BLE permissions (Android 12+ scan/connect, iOS
   *  Bluetooth). Resolves with whether they were granted. */
  requestPermissions(): Promise<{ granted: boolean }>;

  /** Scan for nearby BLE peripherals for `timeoutMs` (default 6000) and return
   *  what was seen. Safe to call repeatedly. */
  scan(options?: { timeoutMs?: number }): Promise<{ devices: PfBleDevice[] }>;

  /** Connect + discover services. Remembers the peripheral so `print` can be
   *  called without re-scanning. */
  connect(options: { deviceId: string }): Promise<void>;

  disconnect(): Promise<void>;

  isConnected(): Promise<{ connected: boolean; deviceId?: string }>;

  /** Write raw bytes (base64) to the connected printer's writable
   *  characteristic, chunked to the negotiated MTU. */
  print(options: { data: string }): Promise<void>;
}

export const PrefrontalPrinter =
  registerPlugin<PrefrontalPrinterPlugin>('PrefrontalPrinter');
