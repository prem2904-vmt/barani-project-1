import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PlatformService } from '../../../core/services/platform.service';
import { PrinterService } from '../../../core/printer/printer.service';
import { ToastService } from '../../../core/services/toast.service';
import { PfBleDevice } from '../../../core/printer/prefrontal-printer.plugin';

/**
 * Label printer setup — pair a printer INSIDE the app (no OS chooser).
 *  • Desktop (Electron): shows USB status; USB is used automatically when
 *    plugged in, otherwise Bluetooth. "Pair Bluetooth" opens an in-app list of
 *    nearby devices (streamed from Electron's Web-Bluetooth chooser).
 *  • iPad (Capacitor): scan + pair over BLE via the native plugin.
 * Transport priority at print time is USB → Bluetooth.
 */
@Component({
  selector: 'pf-label-printer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ScreenHeaderComponent],
  template: `
    <div class="mx-auto w-full max-w-2xl px-4 py-4">
      <pf-screen-header title="Label printer"
        subtitle="Pair a label printer. USB is used automatically when connected; otherwise Bluetooth.">
      </pf-screen-header>

      @if (isElectron) {
        <!-- USB status -->
        <div class="pf-card">
          <div class="min-w-0">
            <p class="pf-eyebrow">USB</p>
            <p class="pf-val">
              @if (usbConnected()) {
                {{ usbName() || 'Label printer' }} <span class="pf-ok">· connected</span>
              } @else { Not connected }
            </p>
          </div>
          <button type="button" class="pf-btn" (click)="refreshUsb()">Refresh</button>
        </div>

        <!-- Bluetooth -->
        <div class="pf-card">
          <div class="min-w-0">
            <p class="pf-eyebrow">Bluetooth</p>
            <p class="pf-val">
              {{ printer.bleDeviceName() ?? 'None paired' }}
              @if (printer.bleConnected()) { <span class="pf-ok">· connected</span> }
            </p>
          </div>
          <button type="button" class="pf-btn pf-btn--primary" (click)="startBlePair()" [disabled]="pairing()">
            {{ pairing() ? 'Scanning…' : 'Pair Bluetooth' }}
          </button>
        </div>

        @if (pairing()) {
          <div class="rounded-xl overflow-hidden mb-3" style="border:1px solid var(--border-muted);">
            @if (bleDevices().length === 0) {
              <p class="p-4 text-sm" style="color: var(--text-muted);">Looking for printers…</p>
            } @else {
              @for (d of bleDevices(); track d.deviceId) {
                <button type="button" class="pf-row" (click)="choose(d.deviceId)">
                  <span class="truncate">{{ d.deviceName }}</span>
                  <span class="text-xs" style="color: var(--text-muted);">tap to pair</span>
                </button>
              }
            }
            <button type="button" class="pf-row" (click)="cancelPair()" style="color: var(--text-muted);">Cancel</button>
          </div>
        }

        <button type="button" class="pf-btn w-full mt-1" (click)="test()"
                [disabled]="!usbConnected() && !printer.bleConnected()">Test print</button>

      } @else if (isCapacitor) {
        <!-- iPad: BLE scan/pair via the native plugin -->
        <div class="pf-card">
          <div class="min-w-0">
            <p class="pf-eyebrow">Current printer</p>
            <p class="pf-val">
              {{ printer.deviceName() ?? 'None paired' }}
              @if (printer.connected()) { <span class="pf-ok">· connected</span> }
            </p>
          </div>
          <button type="button" class="pf-btn" (click)="test()" [disabled]="busy() || !printer.savedDeviceId()">Test print</button>
        </div>
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm" style="color: var(--text-secondary);">Nearby devices</p>
          <button type="button" class="pf-btn pf-btn--primary" (click)="scan()" [disabled]="busy()">
            {{ scanning() ? 'Scanning…' : 'Scan' }}
          </button>
        </div>
        <div class="rounded-xl overflow-hidden" style="border:1px solid var(--border-muted);">
          @if (devices().length === 0) {
            <p class="p-4 text-sm" style="color: var(--text-muted);">{{ scanning() ? 'Looking…' : 'Tap Scan to find your printer.' }}</p>
          } @else {
            @for (d of devices(); track d.deviceId) {
              <button type="button" class="pf-row" (click)="pair(d)" [disabled]="busy()">
                <span class="min-w-0"><span class="block truncate">{{ d.name || 'Unnamed device' }}</span>
                  <span class="block text-[11px] font-mono truncate" style="color: var(--text-muted);">{{ d.deviceId }}</span></span>
                <span class="text-xs" style="color: var(--text-muted);">tap to pair</span>
              </button>
            }
          }
        </div>
      } @else {
        <div class="rounded-xl p-4 text-sm"
             style="background: var(--glass-bg, rgba(255,255,255,.05)); border:1px solid var(--border-muted); color: var(--text-secondary);">
          Direct printing runs in the installed <b>Prefrontal</b> desktop or tablet app.
          On the web, labels use the system print dialog.
        </div>
      }
    </div>
  `,
  styles: [`
    .pf-card { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; margin-bottom:12px; border-radius:14px; background: var(--glass-bg, rgba(255,255,255,.05)); border:1px solid var(--border-muted); }
    .pf-eyebrow { font-size:10.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color: var(--text-muted); margin:0 0 4px; }
    .pf-val { margin:0; color: var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pf-ok { color: var(--success, #34d399); }
    .pf-btn { padding:8px 14px; border-radius:10px; font-size:13px; font-weight:600; border:1px solid var(--border-muted); background:transparent; color: var(--text-primary); cursor:pointer; }
    .pf-btn:disabled { opacity:.5; cursor:default; }
    .pf-btn--primary { background: var(--gradient-primary, #7c3aed); border-color:transparent; color:#fff; }
    .pf-row { width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; text-align:left; background:transparent; color: var(--text-primary); border:0; border-bottom:1px solid var(--border-muted); cursor:pointer; }
  `]
})
export class LabelPrinterComponent implements OnInit, OnDestroy {
  readonly printer = inject(PrinterService);
  private readonly platform = inject(PlatformService);
  private readonly toasts = inject(ToastService);

  readonly isElectron = this.platform.isElectron();
  readonly isCapacitor = this.platform.isCapacitor();

  // Electron BLE pairing
  readonly pairing = signal(false);
  readonly bleDevices = signal<{ deviceId: string; deviceName: string }[]>([]);
  readonly usbConnected = signal(false);
  readonly usbName = signal<string>('');
  private unsub?: () => void;
  private poll?: ReturnType<typeof setInterval>;

  // Capacitor BLE
  readonly devices = signal<PfBleDevice[]>([]);
  readonly scanning = signal(false);
  readonly busy = signal(false);

  ngOnInit(): void {
    if (this.isElectron) { this.refreshUsb(); this.poll = setInterval(() => this.refreshUsb(), 4000); }
  }
  ngOnDestroy(): void { this.unsub?.(); if (this.poll) clearInterval(this.poll); }

  async refreshUsb(): Promise<void> {
    const s = await this.printer.electronStatus();
    this.usbConnected.set(s.connected); this.usbName.set(s.name ?? '');
  }

  startBlePair(): void {
    this.pairing.set(true);
    this.bleDevices.set([]);
    this.unsub = this.printer.onBleDevices(d => this.bleDevices.set(d));
    this.printer.connectBluetooth()
      .then(name => this.toasts.success(`Paired ${name}`))
      .catch((e: Error) => { if (!/cancel|user/i.test(e?.message ?? '')) this.toasts.error(e?.message || 'Pairing failed'); })
      .finally(() => { this.pairing.set(false); this.unsub?.(); this.unsub = undefined; });
  }
  choose(id: string): void { this.printer.pickBleDevice(id); }
  cancelPair(): void { this.printer.cancelBlePick(); this.pairing.set(false); this.unsub?.(); }

  async test(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.printer.testPrint();
      if (r.ok) this.toasts.success('Test label sent'); else this.toasts.error(r.error || 'Print failed');
    } finally { this.busy.set(false); }
  }

  // ── Capacitor scan/pair ──
  async scan(): Promise<void> {
    this.busy.set(true); this.scanning.set(true);
    try {
      if (!(await this.printer.requestPermissions())) { this.toasts.error('Bluetooth permission denied'); return; }
      this.devices.set(await this.printer.scan());
      if (this.devices().length === 0) this.toasts.error('No devices found — is the printer on?');
    } catch (e) { this.toasts.error((e as Error)?.message || 'Scan failed'); }
    finally { this.scanning.set(false); this.busy.set(false); }
  }
  async pair(d: PfBleDevice): Promise<void> {
    this.busy.set(true);
    try { await this.printer.selectDevice(d); this.toasts.success(`Paired ${d.name || d.deviceId}`); }
    catch (e) { this.toasts.error((e as Error)?.message || 'Could not connect'); }
    finally { this.busy.set(false); }
  }
}
