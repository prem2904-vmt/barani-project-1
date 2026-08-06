import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PlatformService } from '../../../core/services/platform.service';
import { PrinterService, SystemPrinter } from '../../../core/printer/printer.service';
import { PrintConfigService } from '../../../core/printer/print-config.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ToastService } from '../../../core/services/toast.service';
import { PfBleDevice } from '../../../core/printer/prefrontal-printer.plugin';

/**
 * Printing — the per-station print setup, for anyone with print access (not just
 * admins). Everything here is saved in localStorage (per station), since the
 * printer + label roll are physical to this workstation:
 *   • Label printer  — USB and/or Bluetooth (the thermal tube-label printer).
 *   • Label          — physical size (mm) + the one machine-readable code.
 *   • Document printer — an OS printer for A4 invoices/reports (Electron).
 * At print time the transport auto-selects USB → Bluetooth.
 */
@Component({
  selector: 'pf-label-printer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ScreenHeaderComponent],
  template: `
    <div class="mx-auto w-full max-w-2xl px-4 py-4">
      <pf-screen-header title="Printing"
        subtitle="Set up this station's printers and label. USB is used automatically when connected, otherwise Bluetooth.">
      </pf-screen-header>

      @if (!supported()) {
        <div class="pf-note">
          Direct printing runs in the installed <b>Prefrontal</b> desktop or tablet app.
          On the web, labels + invoices use the system print dialog.
        </div>
      }

      <!-- ── LABEL PRINTER ─────────────────────────────────────── -->
      <p class="pf-h">Label printer</p>

      @if (isElectron) {
        <div class="pf-card">
          <div class="min-w-0">
            <p class="pf-eyebrow">USB</p>
            <p class="pf-val">
              @if (usbConnected()) { {{ usbName() || 'Label printer' }} <span class="pf-ok">· connected</span> }
              @else { Not connected }
            </p>
          </div>
          <button type="button" class="pf-btn" (click)="refreshUsb()">Refresh</button>
        </div>

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
          <div class="pf-list">
            @if (bleDevices().length === 0) {
              <p class="pf-muted">Looking for printers…</p>
            } @else {
              @for (d of bleDevices(); track d.deviceId) {
                <button type="button" class="pf-row" (click)="choose(d.deviceId)">
                  <span class="truncate">{{ d.deviceName }}</span>
                  <span class="pf-hint">tap to pair</span>
                </button>
              }
            }
            <button type="button" class="pf-row pf-muted" (click)="cancelPair()">Cancel</button>
          </div>
        }
      } @else if (isCapacitor) {
        <div class="pf-card">
          <div class="min-w-0">
            <p class="pf-eyebrow">Bluetooth printer</p>
            <p class="pf-val">
              {{ printer.deviceName() ?? 'None paired' }}
              @if (printer.connected()) { <span class="pf-ok">· connected</span> }
            </p>
          </div>
          <button type="button" class="pf-btn pf-btn--primary" (click)="scan()" [disabled]="busy()">
            {{ scanning() ? 'Scanning…' : 'Scan' }}
          </button>
        </div>
        <div class="pf-list">
          @if (devices().length === 0) {
            <p class="pf-muted">{{ scanning() ? 'Looking…' : 'Tap Scan to find your printer.' }}</p>
          } @else {
            @for (d of devices(); track d.deviceId) {
              <button type="button" class="pf-row" (click)="pair(d)" [disabled]="busy()">
                <span class="min-w-0"><span class="block truncate">{{ d.name || 'Unnamed device' }}</span>
                  <span class="pf-mono">{{ d.deviceId }}</span></span>
                <span class="pf-hint">tap to pair</span>
              </button>
            }
          }
        </div>
      }

      <!-- ── LABEL SIZE + CODE ─────────────────────────────────── -->
      <p class="pf-h mt-5">Label</p>
      <div class="pf-card pf-card--col">
        <div class="flex flex-wrap items-end gap-5">
          <label class="block">
            <span class="pf-eyebrow">Width (mm)</span>
            <input type="number" min="10" max="120" class="pf-num" [value]="cfg().labelWidthMm"
                   (change)="onSize('w', $any($event.target).valueAsNumber)">
          </label>
          <label class="block">
            <span class="pf-eyebrow">Height (mm)</span>
            <input type="number" min="10" max="120" class="pf-num" [value]="cfg().labelHeightMm"
                   (change)="onSize('h', $any($event.target).valueAsNumber)">
          </label>
          <div class="pf-prev-wrap">
            <span class="pf-eyebrow">Preview</span>
            <div class="pf-prev" [style.width.px]="cfg().labelWidthMm * 3.4" [style.height.px]="cfg().labelHeightMm * 3.4">
              <div class="pf-prev-t"><b>Rahul Sharma</b><span>MIC-2607-00001</span><span class="pf-prev-d">MICRO</span></div>
              <div class="pf-prev-c" [attr.data-mode]="printConfig.codeMode()">
                {{ printConfig.codeMode() === 'barcode' ? 'BARCODE' : (printConfig.codeMode() === 'qr' ? 'QR' : 'DMX') }}
              </div>
            </div>
            <span class="pf-mono">{{ cfg().labelWidthMm }} × {{ cfg().labelHeightMm }} mm</span>
          </div>
        </div>

        <div>
          <span class="pf-eyebrow">Code</span>
          <p class="pf-val">
            {{ codeLabel() }}
            <span class="pf-hint">· set by admin in Lab settings (organisation policy)</span>
          </p>
        </div>

        <button type="button" class="pf-btn pf-btn--primary self-start" (click)="test()" [disabled]="busy()">Test print</button>
      </div>

      <!-- ── ALIGNMENT (nudge print position) ──────────────────── -->
      <p class="pf-h mt-5">Alignment</p>
      <div class="pf-card">
        <div class="min-w-0">
          <p class="pf-eyebrow">Nudge the print position on the label</p>
          <p class="pf-mono">X {{ cfg().offsetXmm }} mm · Y {{ cfg().offsetYmm }} mm</p>
          <button type="button" class="pf-btn mt-2" (click)="resetAlign()">Reset to center</button>
        </div>
        <div class="pf-nudge">
          <button type="button" (click)="printConfig.nudge(0, -0.5)" aria-label="Up">↑</button>
          <div class="pf-nudge-mid">
            <button type="button" (click)="printConfig.nudge(-0.5, 0)" aria-label="Left">←</button>
            <button type="button" (click)="resetAlign()" aria-label="Center">•</button>
            <button type="button" (click)="printConfig.nudge(0.5, 0)" aria-label="Right">→</button>
          </div>
          <button type="button" (click)="printConfig.nudge(0, 0.5)" aria-label="Down">↓</button>
        </div>
      </div>

      <!-- ── PRINT QUALITY (driver) ────────────────────────────── -->
      <p class="pf-h mt-5">Print quality</p>
      <div class="pf-card pf-card--col">
        <div class="flex flex-wrap gap-8">
          <label class="block grow">
            <span class="pf-eyebrow">Darkness / thickness — {{ cfg().density }}/15</span>
            <input type="range" min="1" max="15" class="pf-range" [value]="cfg().density"
                   (input)="printConfig.setDensity($any($event.target).valueAsNumber)">
          </label>
          <label class="block grow">
            <span class="pf-eyebrow">Speed — {{ cfg().speed }}/5</span>
            <input type="range" min="1" max="5" class="pf-range" [value]="cfg().speed"
                   (input)="printConfig.setSpeed($any($event.target).valueAsNumber)">
          </label>
          <label class="block grow">
            <span class="pf-eyebrow">Code size — {{ cfg().codeScalePct }}%</span>
            <input type="range" min="50" max="130" class="pf-range" [value]="cfg().codeScalePct"
                   (input)="printConfig.setCodeScale($any($event.target).valueAsNumber)">
          </label>
        </div>
        <p class="pf-hint">Higher darkness = bolder/thicker; slower speed = crisper. Shrink <strong>Code size</strong>
          for narrow tube labels — but not so small the scanner can't read it.</p>
      </div>

      <!-- ── DOCUMENT PRINTER (invoices) ───────────────────────── -->
      @if (isElectron) {
        <p class="pf-h mt-5">Invoice / document printer</p>
        <div class="pf-card">
          <div class="min-w-0 grow">
            <p class="pf-eyebrow">A4 printer for invoices &amp; reports</p>
            <select class="pf-num w-full" [value]="cfg().documentPrinter"
                    (change)="printConfig.setDocumentPrinter($any($event.target).value)">
              <option value="">System dialog (ask each time)</option>
              @for (p of systemPrinters(); track p.name) {
                <option [value]="p.name">{{ p.displayName || p.name }}{{ p.isDefault ? ' (default)' : '' }}</option>
              }
            </select>
          </div>
          <button type="button" class="pf-btn" (click)="loadSystemPrinters()">Refresh</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .pf-h { font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color: var(--text-muted); margin:0 0 8px; }
    .pf-note { border-radius:12px; padding:14px 16px; margin-bottom:12px; font-size:13px; background: var(--glass-bg, rgba(255,255,255,.05)); border:1px solid var(--border-muted); color: var(--text-secondary); }
    .pf-card { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; margin-bottom:12px; border-radius:14px; background: var(--glass-bg, rgba(255,255,255,.05)); border:1px solid var(--border-muted); }
    .pf-card--col { flex-direction:column; align-items:stretch; gap:16px; }
    .pf-eyebrow { display:block; font-size:10.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color: var(--text-muted); margin:0 0 6px; }
    .pf-val { margin:0; color: var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pf-ok { color: var(--success, #34d399); }
    .pf-muted { padding:14px 16px; font-size:13px; color: var(--text-muted); }
    .pf-hint { font-size:12px; color: var(--text-muted); }
    .pf-mono { display:block; font-size:11px; font-family: ui-monospace, monospace; color: var(--text-muted); }
    .pf-btn { padding:8px 14px; border-radius:10px; font-size:13px; font-weight:600; border:1px solid var(--border-muted); background:transparent; color: var(--text-primary); cursor:pointer; }
    .pf-btn:disabled { opacity:.5; cursor:default; }
    .pf-btn--primary { background: var(--gradient-primary, #7c3aed); border-color:transparent; color:#fff; }
    .pf-list { border:1px solid var(--border-muted); border-radius:14px; overflow:hidden; margin-bottom:12px; }
    .pf-row { width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; text-align:left; background:transparent; color: var(--text-primary); border:0; border-bottom:1px solid var(--border-muted); cursor:pointer; }
    .pf-num { padding:8px 10px; border-radius:10px; background: var(--glass-bg); border:1px solid var(--border-muted); color: var(--text-primary); font-size:14px; width:96px; }
    .pf-chip { padding:7px 14px; border-radius:999px; font-size:13px; font-weight:600; border:1px solid var(--border-muted); background:transparent; color: var(--text-secondary); cursor:pointer; }
    .pf-chip--on { background: var(--gradient-primary, #7c3aed); border-color:transparent; color:#fff; }
    .pf-range { width:100%; min-width:180px; accent-color: var(--gradient-primary, #7c3aed); }
    .pf-nudge { display:flex; flex-direction:column; align-items:center; gap:4px; flex-shrink:0; }
    .pf-nudge-mid { display:flex; gap:4px; }
    .pf-nudge button { width:36px; height:36px; border-radius:9px; border:1px solid var(--border-muted); background: var(--glass-bg); color: var(--text-primary); font-size:16px; cursor:pointer; }
    .pf-nudge button:active { background: var(--gradient-primary, #7c3aed); color:#fff; }
    .pf-prev-wrap { display:flex; flex-direction:column; }
    .pf-prev { position:relative; display:flex; align-items:center; justify-content:space-between; gap:6px; padding:6px 8px; background:#fff; border:1px solid #cbd5e1; border-radius:4px; overflow:hidden; box-shadow: var(--shadow-sm); }
    .pf-prev-t { display:flex; flex-direction:column; gap:1px; min-width:0; color:#0f172a; line-height:1.15; }
    .pf-prev-t b { font-size:9px; font-weight:800; }
    .pf-prev-t span { font-size:8px; font-family: ui-monospace, monospace; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pf-prev-d { font-weight:700; letter-spacing:.08em; }
    .pf-prev-c { flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:7px; font-weight:700; color:#0f172a; border:1.5px solid #0f172a; border-radius:3px; }
    .pf-prev-c[data-mode='barcode'] { width:34%; min-width:30px; height:60%; background: repeating-linear-gradient(90deg,#0f172a 0 1.5px,#fff 1.5px 3px); border:none; color:transparent; }
    .pf-prev-c[data-mode='qr'], .pf-prev-c[data-mode='datamatrix'] { aspect-ratio:1; height:74%; }
  `]
})
export class LabelPrinterComponent implements OnInit, OnDestroy {
  readonly printer = inject(PrinterService);
  readonly printConfig = inject(PrintConfigService);
  private readonly branchCfg = inject(BranchLabConfigService);
  private readonly platform = inject(PlatformService);
  private readonly toasts = inject(ToastService);

  readonly isElectron = this.platform.isElectron();
  readonly isCapacitor = this.platform.isCapacitor();
  supported(): boolean { return this.isElectron || this.isCapacitor; }

  readonly cfg = this.printConfig.config;
  codeLabel(): string {
    const m = this.printConfig.codeMode();
    return m === 'barcode' ? 'Barcode' : m === 'qr' ? 'QR' : 'Data Matrix';
  }

  // Electron BLE pairing + USB status
  readonly pairing = signal(false);
  readonly bleDevices = signal<{ deviceId: string; deviceName: string }[]>([]);
  readonly usbConnected = signal(false);
  readonly usbName = signal<string>('');
  readonly systemPrinters = signal<SystemPrinter[]>([]);
  private unsub?: () => void;
  private poll?: ReturnType<typeof setInterval>;

  // Capacitor BLE
  readonly devices = signal<PfBleDevice[]>([]);
  readonly scanning = signal(false);
  readonly busy = signal(false);

  ngOnInit(): void {
    this.branchCfg.ensureLoaded(); // the admin-set code comes from here
    if (this.isElectron) {
      this.refreshUsb();
      this.loadSystemPrinters();
      this.poll = setInterval(() => this.refreshUsb(), 4000);
    }
  }
  ngOnDestroy(): void { this.unsub?.(); if (this.poll) clearInterval(this.poll); }

  resetAlign(): void { this.printConfig.setOffsetX(0); this.printConfig.setOffsetY(0); }

  onSize(which: 'w' | 'h', value: number): void {
    const c = this.cfg();
    if (which === 'w') this.printConfig.setLabelSize(value, c.labelHeightMm);
    else this.printConfig.setLabelSize(c.labelWidthMm, value);
  }

  async refreshUsb(): Promise<void> {
    const s = await this.printer.electronStatus();
    this.usbConnected.set(s.connected); this.usbName.set(s.name ?? '');
  }
  async loadSystemPrinters(): Promise<void> {
    this.systemPrinters.set(await this.printer.listSystemPrinters());
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
    this.toasts.info('Printing test label…');
    try {
      const r = await this.printer.testPrint();
      if (r.ok) this.toasts.success('Test label sent'); else this.toasts.error(r.error || 'Print failed');
    } finally { this.busy.set(false); }
  }

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
