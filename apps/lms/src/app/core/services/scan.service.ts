import { Injectable, computed, inject, signal } from '@angular/core';
import { TenantStateService } from './tenant-state.service';

/**
 * Tiny shared toggle for the global "scan an order QR" overlay. The top-strip
 * hosts the scanner modal and watches `scanning`; any screen can `open()` it.
 *
 * Also exposes the tenant-wide sample-identification mode. In `manual` mode the
 * lab screens hide the QR/camera scanner and present a plain sample-number
 * field instead (the tenant is already loaded app-wide by the top strip, so
 * `manualEntry` is reactive; it defaults to `false` — scan mode — until then).
 */
@Injectable({ providedIn: 'root' })
export class ScanService {
  private readonly tenantState = inject(TenantStateService);

  readonly scanning = signal(false);
  open() { this.scanning.set(true); }
  close() { this.scanning.set(false); }

  /** True when the tenant runs in manual mode (type the sample number, no QR).
   *  Anything other than the literal 'manual' — including absent/empty — is
   *  treated as scan mode. */
  readonly manualEntry = computed(() => this.tenantState.tenant()?.scanMode === 'manual');
}
