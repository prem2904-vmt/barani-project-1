import { Injectable, inject, signal } from '@angular/core';
import { PlatformService } from '../../../core/services/platform.service';
import { PrintConfig, PrintConfigService } from '../../../core/printer/print-config.service';
import { PrinterService, SystemPrinter } from '../../../core/printer/printer.service';
import { SettingAdapter } from './adapter';

/**
 * This device's printing (PrintConfigService → localStorage). Pairing and
 * the nudge pad stay in Printer setup (/printing); the simple values are rows.
 * Keys: PrintConfig fields, `printer` (connected name), `documentPrinters`
 * (the desktop app's system printers, as select options).
 */
@Injectable({ providedIn: 'root' })
export class PrintConfigAdapter implements SettingAdapter {
  private readonly cfg = inject(PrintConfigService);
  private readonly printer = inject(PrinterService);
  private readonly platform = inject(PlatformService);
  private readonly systemPrinters = signal<SystemPrinter[]>([]);
  private listed = false;

  ensure(): void {
    if (this.listed || !this.platform.isElectron()) return;
    this.listed = true;
    void this.printer.listSystemPrinters().then((l) => this.systemPrinters.set(l ?? [])).catch(() => undefined);
  }
  loaded(): boolean { return true; }

  read(key: string): unknown {
    if (key === 'printer') {
      const name = this.printer.deviceName();
      return this.printer.connected() && name ? `Connected: ${name}` : 'Not connected';
    }
    if (key === 'documentPrinters') {
      return [{ value: '', label: 'Ask each time' },
        ...this.systemPrinters().map((p) => ({ value: p.name, label: p.displayName || p.name }))];
    }
    return this.cfg.config()[key as keyof PrintConfig];
  }

  async write(key: string, value: unknown): Promise<void> {
    const n = Number(value);
    if (key !== 'documentPrinter' && (value === null || !Number.isFinite(n))) throw new Error('Type a number.');
    switch (key) {
      case 'labelWidthMm': this.cfg.setLabelSize(n, this.cfg.config().labelHeightMm); break;
      case 'labelHeightMm': this.cfg.setLabelSize(this.cfg.config().labelWidthMm, n); break;
      case 'density': this.cfg.setDensity(n); break;
      case 'speed': this.cfg.setSpeed(n); break;
      case 'codeScalePct': this.cfg.setCodeScale(n); break;
      case 'documentPrinter': this.cfg.setDocumentPrinter(String(value ?? '')); break;
      default: throw new Error('Change this in Printer setup.');
    }
  }
}
