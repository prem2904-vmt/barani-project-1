import { Injectable, signal } from '@angular/core';

/**
 * How THIS device reads a code in the scanner window:
 *  - `camera`  — QR / barcode through the camera (the original behaviour);
 *  - `scanner` — a hardware (USB / Bluetooth) barcode scanner, no camera;
 *  - `type`    — type the number.
 *
 * Stored per device in localStorage (like PrintConfigService — the camera or
 * scanner is physical to the station), so the last choice is remembered.
 * Nothing stored → the lab's default: the tenant's Scan / Manual setting
 * (manual → `type`, anything else → `camera`). The tenant setting itself is
 * never written or changed here.
 */
export type ScanInputMode = 'camera' | 'scanner' | 'type';

export const SCAN_INPUT_MODES: readonly ScanInputMode[] = ['camera', 'scanner', 'type'];

const KEY = 'pf.scanInput';

function isMode(v: unknown): v is ScanInputMode {
  return v === 'camera' || v === 'scanner' || v === 'type';
}

/** The mode the scanner window opens in: the device's remembered choice, else
 *  the lab default from the tenant's manual setting. */
export function resolveScanInputMode(stored: ScanInputMode | null | undefined, tenantManual: boolean): ScanInputMode {
  if (isMode(stored)) return stored;
  return tenantManual ? 'type' : 'camera';
}

@Injectable({ providedIn: 'root' })
export class ScanInputPrefService {
  private readonly _stored = signal<ScanInputMode | null>(this.load());
  /** The device's remembered choice (null = never chosen → lab default). */
  readonly stored = this._stored.asReadonly();

  private load(): ScanInputMode | null {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      return isMode(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  modeFor(tenantManual: boolean): ScanInputMode {
    return resolveScanInputMode(this._stored(), tenantManual);
  }

  set(mode: ScanInputMode): void {
    if (!isMode(mode)) return;
    this._stored.set(mode);
    try { localStorage.setItem(KEY, mode); } catch { /* private window / blocked storage */ }
  }
}
