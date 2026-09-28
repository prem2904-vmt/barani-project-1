import { Injectable, inject, signal } from '@angular/core';
import { LabelCodeMode } from './label-render';
import { BranchLabConfigService } from '../services/branch-lab-config.service';

/**
 * Per-station print configuration, stored in localStorage (NOT the cloud).
 *
 * Direct printing only runs inside the installed desktop/tablet app, so
 * localStorage is effectively per-station — which is exactly right: the printer,
 * label roll, and print darkness are PHYSICAL to that workstation.
 *
 * The machine-readable CODE (barcode | qr | datamatrix) is deliberately NOT
 * here — it's an organisation policy set by admin (branch lab config), so every
 * station encodes labels the same way. This service reads it from there.
 */
export interface PrintConfig {
  labelWidthMm: number;
  labelHeightMm: number;
  /** Thermal "driver" settings for the label printer. Darkness 1–15 (thicker /
   *  bolder), speed 1–5 (slower = crisper). Extensible — add more knobs here. */
  density: number;
  speed: number;
  /** Print-position nudge in mm (+X = right, +Y = down) to align the content on
   *  the label without having to match the exact size. */
  offsetXmm: number;
  offsetYmm: number;
  /** Code size as a % of the default (50–130). Smaller for narrow tube labels;
   *  don't go so small the scanner can't read it. */
  codeScalePct: number;
  /** CODE rotation in degrees: 0 | 90 | 180 | 270. Rotates only the
   *  barcode/QR/Data Matrix (the text stays upright) so the code can be
   *  oriented for the tube. */
  rotation: number;
  /** OS printer name to route A4/invoice documents to (Electron). Empty = use
   *  the system print dialog. */
  documentPrinter: string;
  /** WEB BROWSER ONLY: how "Print label" behaves when no label printer can be
   *  driven directly. 'printer' (default) = always ask; 'system' = the user
   *  ticked "Don't ask again" and chose the label-sized system print dialog.
   *  Ignored on Electron / the native app, which only ever use the printer. */
  labelRoute: LabelRoute;
}

export type LabelRoute = 'printer' | 'system';

const KEY = 'pf.printConfig';
const DEFAULTS: PrintConfig = {
  labelWidthMm: 50,
  labelHeightMm: 20,
  density: 5,
  speed: 2,
  offsetXmm: 0,
  offsetYmm: 0,
  codeScalePct: 100,
  rotation: 0,
  documentPrinter: '',
  labelRoute: 'printer',
};

@Injectable({ providedIn: 'root' })
export class PrintConfigService {
  private readonly branchCfg = inject(BranchLabConfigService);
  private readonly _config = signal<PrintConfig>(this.load());
  readonly config = this._config.asReadonly();

  private load(): PrintConfig {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private persist(next: PrintConfig): void {
    this._config.set(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  /** Merge a partial update and persist. */
  update(patch: Partial<PrintConfig>): void {
    this.persist({ ...this._config(), ...patch });
  }

  setLabelSize(widthMm: number, heightMm: number): void {
    this.update({
      // 0.1 mm precision so inch stock (2 × 1 in = 50.8 × 25.4 mm) is exact.
      labelWidthMm: Math.min(120, Math.max(10, Math.round((widthMm || 0) * 10) / 10)),
      labelHeightMm: Math.min(120, Math.max(10, Math.round((heightMm || 0) * 10) / 10)),
    });
  }
  setDocumentPrinter(name: string): void { this.update({ documentPrinter: name }); }
  setLabelRoute(route: LabelRoute): void { this.update({ labelRoute: route === 'system' ? 'system' : 'printer' }); }
  setDensity(v: number): void { this.update({ density: Math.min(15, Math.max(1, Math.round(v))) }); }
  setSpeed(v: number): void { this.update({ speed: Math.min(5, Math.max(1, Math.round(v))) }); }
  private clampOff(v: number): number { return Math.min(15, Math.max(-15, Math.round((v || 0) * 2) / 2)); }
  setOffsetX(v: number): void { this.update({ offsetXmm: this.clampOff(v) }); }
  setOffsetY(v: number): void { this.update({ offsetYmm: this.clampOff(v) }); }
  nudge(dx: number, dy: number): void {
    const c = this._config();
    this.update({ offsetXmm: this.clampOff(c.offsetXmm + dx), offsetYmm: this.clampOff(c.offsetYmm + dy) });
  }
  setCodeScale(v: number): void { this.update({ codeScalePct: Math.min(130, Math.max(50, Math.round(v))) }); }
  rotate(): void { this.update({ rotation: (this._config().rotation + 90) % 360 }); }

  /** Printer "driver" params for the job (converted to the DP27's 0-based scale). */
  driverOpts(): { density: number; speed: number } {
    const c = this._config();
    return { density: c.density - 1, speed: c.speed - 1 };
  }

  /** The admin-set code (org policy), read from the branch lab config. */
  codeMode(): LabelCodeMode {
    const m = this.branchCfg.config()?.labelCodeMode ?? 'barcode';
    return (m === ('both' as string) ? 'barcode' : m) as LabelCodeMode;
  }

  /** Label render options: per-station size + alignment + code + code scale. */
  labelOpts(): { widthMm: number; heightMm: number; codeMode: LabelCodeMode; offsetXmm: number; offsetYmm: number; codeScalePct: number; rotation: number } {
    const c = this._config();
    return { widthMm: c.labelWidthMm, heightMm: c.labelHeightMm, codeMode: this.codeMode(), offsetXmm: c.offsetXmm, offsetYmm: c.offsetYmm, codeScalePct: c.codeScalePct, rotation: c.rotation };
  }
}
