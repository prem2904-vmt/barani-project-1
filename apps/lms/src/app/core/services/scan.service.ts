import { Injectable, signal } from '@angular/core';

/**
 * Tiny shared toggle for the global "scan an order QR" overlay. The top-strip
 * hosts the scanner modal and watches `scanning`; any screen can `open()` it.
 */
@Injectable({ providedIn: 'root' })
export class ScanService {
  readonly scanning = signal(false);
  open() { this.scanning.set(true); }
  close() { this.scanning.set(false); }
}
