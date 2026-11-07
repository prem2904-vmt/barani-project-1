import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, afterRenderEffect, inject, signal, computed, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PlatformService } from '../../../core/services/platform.service';
import { PrinterService, SystemPrinter, LabelPrinterState } from '../../../core/printer/printer.service';
import { PrintConfigService } from '../../../core/printer/print-config.service';
import { LABEL_SIZE_PRESETS, MIN_X_MM, code128Modules, tubeLabelGeometry } from '../../../core/printer/label-layout';
import { ID_CARD_SIZE_PRESETS } from '../../../shared/utils/print-label';
import { LabelData, renderLabelBitmap } from '../../../core/printer/label-render';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { PfBleDevice } from '../../../core/printer/prefrontal-printer.plugin';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { ThemeService } from '../../../core/services/theme.service';
import { BusyDirective } from '../../../shared/directives/busy.directive';

/** Band status of this station's label printer. */
export type LabelPrinterBandState = 'connected' | 'offline' | 'none' | 'web';

/** The sample drawn in the live preview — a typical tube (9-digit sample ID,
 *  the same value the thin-barcode check measures). */
export const PREVIEW_LABEL: LabelData = {
  code: '012600001', patientName: 'Mr. Kesavan L', ageSex: '29M', mrn: 'AA0008', deptCode: 'BIO',
};

/**
 * Printing — the per-station print setup, for anyone with print access (not just
 * admins). Everything here is saved in localStorage (per station), since the
 * printer + label roll are physical to this workstation:
 *   • Label printer  — USB and/or Bluetooth (the thermal tube-label printer).
 *   • Label          — physical size (mm), live preview, print position.
 *   • Code & quality — the org-wide code (read-only here) + darkness/speed/code size.
 *   • Document printer — an OS printer for A4 invoices/reports (Electron).
 * At print time the transport auto-selects USB → Bluetooth.
 *
 * New design (PF-PATTERN): band pill = context bar (Printing · this station ·
 * label-printer status), Test print is the ONE primary; kit cards below — the
 * work (label + position) left, the station's printer + quality right.
 */
@Component({
  selector: 'pf-label-printer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BusyDirective, CommonModule, RouterLink, ScreenHeaderComponent, HeroBandComponent, SelectComponent],
  template: `
    <section class="pf-band-page pf-lp mx-auto w-full max-w-6xl px-4 py-4">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" [customSearch]="true" [contextBar]="true">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press pf-lp-test" (click)="test()" [disabled]="busy()" [pfBusy]="testing()" pfBusyLabel="Printing…"
                    aria-label="Test print" title="Test print">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>
              </svg>
              Test print
            </button>
          </ng-container>
          <!-- Context bar: what this page is, whose station, and the printer's state. -->
          <div band-search class="pf-ctx pf-lp-ctx">
            <span class="pf-ctx__primary">Printing</span>
            <span class="pf-ctx__chip pf-lp-status" [attr.data-state]="printerState()" role="status">
              <span class="pf-lp-status__mark" aria-hidden="true">
                @if (printerState() === 'connected') {
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                }
              </span>
              <span class="pf-ctx__k">Label printer</span>{{ printerStatusText() }}
            </span>
            <span class="pf-ctx__chip pf-lp-ctx__station"><span class="pf-ctx__k">This station</span>{{ stationLabel }}</span>
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" title="Printing"
        subtitle="Set up this station's printers and label. USB is used automatically when connected, otherwise Bluetooth.">
        <div actions>
          <button type="button" class="pf-btn pf-btn--primary press" (click)="test()" [disabled]="busy()" [pfBusy]="testing()" pfBusyLabel="Printing…">Test print</button>
        </div>
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-lp-grid">

      <!-- ── MAIN: the label itself ─────────────────────────────── -->
      <div class="pf-lp-col">
      <section class="pf-card pf-lp-card" data-card="label" aria-labelledby="pf-lp-h-label">
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg></span>
          <h3 class="pf-card__label" id="pf-lp-h-label">Label size</h3>
          <span class="pf-card__note">The roll loaded in this station's printer, and where the print lands on it.</span>
        </div>
        <div class="pf-card__body pf-lp-body">
          <div class="pf-field">
            <span class="pf-field__lbl" id="pf-lp-presets">Common tube labels</span>
            <div class="pf-lp-presets" role="group" aria-labelledby="pf-lp-presets">
              @for (p of sizePresets; track p.label) {
                <button type="button" class="pf-chip pf-lp-preset pf-num" [attr.aria-pressed]="isPreset(p)"
                        (click)="printConfig.setLabelSize(p.widthMm, p.heightMm)">{{ p.label }}</button>
              }
            </div>
          </div>
          <div class="pf-lp-sizes">
            <label class="pf-field pf-lp-size">
              <span class="pf-field__lbl">Width (mm)</span>
              <input type="number" min="10" max="120" step="0.1" inputmode="decimal" class="pf-input pf-num" data-field="width"
                     [value]="cfg().labelWidthMm" (change)="onSize('w', $any($event.target).valueAsNumber)">
            </label>
            <span class="pf-lp-times" aria-hidden="true">×</span>
            <label class="pf-field pf-lp-size">
              <span class="pf-field__lbl">Height (mm)</span>
              <input type="number" min="10" max="120" step="0.1" inputmode="decimal" class="pf-input pf-num" data-field="height"
                     [value]="cfg().labelHeightMm" (change)="onSize('h', $any($event.target).valueAsNumber)">
            </label>
          </div>

          <!-- Live preview: the SAME bitmap the thermal printer receives
               (label-render → label-layout), drawn on the label's outline.
               The position pad sits beside it, so a nudge shows at once. -->
          <div class="pf-lp-stage">
            <figure class="pf-lp-fig" aria-label="Label preview">
              <div class="pf-lp-label" [attr.data-w-mm]="cfg().labelWidthMm" [attr.data-h-mm]="cfg().labelHeightMm"
                   [attr.data-code]="printConfig.codeMode()"
                   [style.width]="'min(100%, ' + (cfg().labelWidthMm * 8) + 'px)'"
                   [style.aspect-ratio]="cfg().labelWidthMm + ' / ' + cfg().labelHeightMm">
                <canvas #prev class="pf-lp-label__bmp" role="img"
                        [attr.aria-label]="'Sample label, ' + cfg().labelWidthMm + ' by ' + cfg().labelHeightMm + ' millimetres, ' + codeLabel()"></canvas>
              </div>
              <figcaption class="pf-lp-cap pf-num">{{ cfg().labelWidthMm }} × {{ cfg().labelHeightMm }} mm · landscape, code beside the text</figcaption>
            </figure>
            <div class="pf-nudge" role="group" aria-label="Nudge print position">
              <button type="button" (click)="printConfig.nudge(0, -0.5)" aria-label="Up"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg></button>
              <div class="pf-nudge-mid">
                <button type="button" (click)="printConfig.nudge(-0.5, 0)" aria-label="Left"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
                <button type="button" (click)="resetAlign()" aria-label="Center"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg></button>
                <button type="button" (click)="printConfig.nudge(0.5, 0)" aria-label="Right"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
              </div>
              <button type="button" (click)="printConfig.nudge(0, 0.5)" aria-label="Down"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
            </div>
          </div>
          <div class="pf-lp-align" data-card="align">
            <div class="pf-lp-align__info">
              <span class="pf-field__lbl">Print position</span>
              <p class="pf-lp-offsets pf-num">X {{ cfg().offsetXmm }} mm · Y {{ cfg().offsetYmm }} mm · Code {{ cfg().rotation }}°</p>
            </div>
            <div class="pf-lp-row">
              <button type="button" class="pf-btn pf-btn--secondary" (click)="resetAlign()">Reset</button>
              <button type="button" class="pf-btn pf-btn--secondary" (click)="printConfig.rotate()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
                Rotate code ({{ cfg().rotation }}°)
              </button>
            </div>
          </div>
          @if (barWarning(); as warn) {
            <p class="pf-lp-warn" role="status">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
              <span>{{ warn }}</span>
            </p>
          }
        </div>
      </section>

      <!-- ── PATIENT ID CARD SIZE ───────────────────────────────── -->
      <section class="pf-card pf-lp-card" data-card="idcard" aria-labelledby="pf-lp-h-idcard">
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M14 10h5M14 14h3M5.5 16c.6-1.4 1.7-2 3-2s2.4.6 3 2"/></svg></span>
          <h3 class="pf-card__label" id="pf-lp-h-idcard">ID card size</h3>
          <span class="pf-card__note">The paper the patient ID card prints on at this station. The card scales to fit.</span>
        </div>
        <div class="pf-card__body pf-lp-body">
          <div class="pf-field">
            <span class="pf-field__lbl" id="pf-lp-idpresets">Common sizes</span>
            <div class="pf-lp-presets" role="group" aria-labelledby="pf-lp-idpresets">
              @for (p of idCardPresets; track p.label) {
                <button type="button" class="pf-chip pf-lp-preset pf-num" [attr.aria-pressed]="isIdCardPreset(p)"
                        (click)="printConfig.setIdCardSize(p.widthMm, p.heightMm)">{{ p.label }}</button>
              }
            </div>
          </div>
          <div class="pf-lp-sizes">
            <label class="pf-field pf-lp-size">
              <span class="pf-field__lbl">Width (mm)</span>
              <input type="number" min="50" max="220" step="0.1" inputmode="decimal" class="pf-input pf-num" data-field="idcard-width"
                     [value]="cfg().idCardWidthMm" (change)="onIdCardSize('w', $any($event.target).valueAsNumber)">
            </label>
            <span class="pf-lp-times" aria-hidden="true">×</span>
            <label class="pf-field pf-lp-size">
              <span class="pf-field__lbl">Height (mm)</span>
              <input type="number" min="30" max="300" step="0.1" inputmode="decimal" class="pf-input pf-num" data-field="idcard-height"
                     [value]="cfg().idCardHeightMm" (change)="onIdCardSize('h', $any($event.target).valueAsNumber)">
            </label>
          </div>
        </div>
      </section>

      <!-- ── DOCUMENT PRINTER (invoices) ───────────────────────── -->
      @if (isElectron) {
        <section class="pf-card pf-lp-card" data-card="docs" aria-labelledby="pf-lp-h-docs">
          <div class="pf-card__head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg></span>
            <h3 class="pf-card__label" id="pf-lp-h-docs">Invoice / document printer</h3>
          </div>
          <div class="pf-card__body pf-lp-body">
            <div class="pf-lp-docs">
              <div class="pf-field pf-lp-docs__pick">
                <span class="pf-field__lbl">A4 printer for invoices &amp; reports</span>
                <pf-select class="block w-full" [options]="docPrinterOptions()" [value]="cfg().documentPrinter ?? ''"
                           [searchable]="systemPrinters().length > 8"
                           (valueChange)="printConfig.setDocumentPrinter($any($event))"></pf-select>
              </div>
              <button type="button" class="pf-btn pf-btn--secondary" (click)="loadSystemPrinters()">Refresh</button>
            </div>
          </div>
        </section>
      }
      </div>

      <!-- ── SIDE: this station's printers + quality ─────────────── -->
      <div class="pf-lp-col">
      <section class="pf-card pf-lp-card" data-card="printer" aria-labelledby="pf-lp-h-printer">
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg></span>
          <h3 class="pf-card__label" id="pf-lp-h-printer">Label printer</h3>
        </div>
        <div class="pf-card__body pf-lp-body">
          @if (!supported()) {
            <p class="pf-note">
              Tube labels print only on a label printer, driven by the installed <b>Prefrontal</b>
              desktop or tablet app. A web browser can't reach one directly, so "Print label" asks
              first — it never falls back to a normal printer on its own. Invoices + reports still use
              the system print dialog.
            </p>
            <div class="pf-lp-conn pf-lp-route" data-conn="route">
              <div class="pf-lp-conn__txt">
                <span class="pf-lp-conn__k">Labels in this browser</span>
                <span class="pf-lp-conn__v">
                  @if (cfg().labelRoute === 'system') { System print dialog (label-sized page) }
                  @else { Ask each time }
                </span>
              </div>
              @if (cfg().labelRoute === 'system') {
                <button type="button" class="pf-btn pf-btn--secondary" (click)="printConfig.setLabelRoute('printer')">Ask each time</button>
              }
            </div>
          }

          @if (isElectron) {
            <div class="pf-lp-conn" data-conn="usb">
              <div class="pf-lp-conn__txt">
                <span class="pf-lp-conn__k">USB</span>
                <span class="pf-lp-conn__v">
                  @if (usbConnected()) { {{ usbName() || 'Label printer' }} <span class="pf-ok"><svg class="pf-ok__i" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>connected</span> }
                  @else { Not connected }
                </span>
              </div>
              <button type="button" class="pf-btn pf-btn--secondary" (click)="refreshUsb()">Refresh</button>
            </div>

            <div class="pf-lp-conn" data-conn="ble">
              <div class="pf-lp-conn__txt">
                <span class="pf-lp-conn__k">Bluetooth</span>
                <span class="pf-lp-conn__v">
                  {{ printer.bleDeviceName() ?? 'None paired' }}
                  @if (printer.bleConnected()) { <span class="pf-ok"><svg class="pf-ok__i" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>connected</span> }
                </span>
              </div>
              <button type="button" class="pf-btn pf-btn--secondary" (click)="startBlePair()" [disabled]="pairing()">
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
                      <span class="pf-wrap">{{ d.deviceName }}</span>
                      <span class="pf-hint">tap to pair</span>
                    </button>
                  }
                }
                <button type="button" class="pf-row pf-muted" (click)="cancelPair()">Cancel</button>
              </div>
            }
          } @else if (isCapacitor) {
            <div class="pf-lp-conn" data-conn="ble">
              <div class="pf-lp-conn__txt">
                <span class="pf-lp-conn__k">Bluetooth printer</span>
                <span class="pf-lp-conn__v">
                  {{ printer.deviceName() ?? 'None paired' }}
                  @if (printer.connected()) { <span class="pf-ok"><svg class="pf-ok__i" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>connected</span> }
                </span>
              </div>
              <button type="button" class="pf-btn pf-btn--secondary" (click)="scan()" [disabled]="busy()" [pfBusy]="scanning()" pfBusyLabel="Scanning…">
                {{ scanning() ? 'Scanning…' : 'Scan' }}
              </button>
            </div>
            <div class="pf-list">
              @if (devices().length === 0) {
                <p class="pf-muted">{{ scanning() ? 'Looking…' : 'Tap Scan to find your printer.' }}</p>
              } @else {
                @for (d of devices(); track d.deviceId) {
                  <button type="button" class="pf-row" (click)="pair(d)" [disabled]="busy()" [pfBusy]="pairingId() === d.deviceId" pfBusyLabel="Connecting…">
                    <span class="min-w-0"><span class="block pf-wrap">{{ d.name || 'Unnamed device' }}</span>
                      <span class="pf-mono">{{ d.deviceId }}</span></span>
                    <span class="pf-hint">tap to pair</span>
                  </button>
                }
              }
            </div>
          }
        </div>
      </section>

      <!-- ── Code & print quality (driver) ──────────────────────── -->
      <section class="pf-card pf-lp-card" data-card="quality" aria-labelledby="pf-lp-h-quality">
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg></span>
          <h3 class="pf-card__label" id="pf-lp-h-quality">Code &amp; quality</h3>
        </div>
        <div class="pf-card__body pf-lp-body">
          <div class="pf-lp-code">
            <div class="pf-lp-conn__txt">
              <span class="pf-lp-conn__k">Code on every label</span>
              <span class="pf-lp-conn__v pf-lp-code__v"><span class="pf-chip pf-chip--static pf-lp-codechip">{{ codeLabel() }}</span>
                <span class="pf-hint">Branch policy, set by an admin in Lab settings</span></span>
            </div>
            @if (canEditCode) {
              <a class="pf-btn pf-btn--quiet pf-lp-codelink" routerLink="/admin/lab-settings" [queryParams]="{ tab: 'collection' }">Lab settings</a>
            }
          </div>
          <label class="pf-field pf-lp-slider">
            <span class="pf-field__lbl pf-lp-slider__lbl">Darkness / thickness <span class="pf-num">{{ cfg().density }}/15</span></span>
            <input type="range" min="1" max="15" class="pf-range" data-field="density" [value]="cfg().density"
                   (input)="printConfig.setDensity($any($event.target).valueAsNumber)">
          </label>
          <label class="pf-field pf-lp-slider">
            <span class="pf-field__lbl pf-lp-slider__lbl">Speed <span class="pf-num">{{ cfg().speed }}/5</span></span>
            <input type="range" min="1" max="5" class="pf-range" data-field="speed" [value]="cfg().speed"
                   (input)="printConfig.setSpeed($any($event.target).valueAsNumber)">
          </label>
          <label class="pf-field pf-lp-slider">
            <span class="pf-field__lbl pf-lp-slider__lbl">Code size <span class="pf-num">{{ cfg().codeScalePct }}%</span></span>
            <input type="range" min="50" max="130" class="pf-range" data-field="codeScale" [value]="cfg().codeScalePct"
                   (input)="printConfig.setCodeScale($any($event.target).valueAsNumber)">
          </label>
          <p class="pf-field__hint">Higher darkness = bolder/thicker; slower speed = crisper. Shrink <strong>Code size</strong>
            for narrow tube labels — but not so small the scanner can't read it.</p>
        </div>
      </section>

      </div>

      </div>
      </div>
    </section>
  `,
  styles: [`
    @use '../../../shared/styles/device-tier' as dt;

    /* Two columns from 1024px (the kit's split width): the label work on the
       left, this station's printer + quality on the right. One column below. */
    .pf-lp-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
    @media (min-width: 1024px) { .pf-lp-grid { grid-template-columns: minmax(0, 1fr) minmax(340px, 400px); } }
    .pf-lp-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .pf-lp-card .pf-card__body { overflow: visible; }
    .pf-lp-body { padding: 14px 16px 16px; gap: 14px; }
    .pf-lp-card .pf-card__note { flex: 1 1 180px; }

    /* Context bar: the printer-status chip carries the ONE violet mark. */
    .pf-lp-ctx__station, .pf-lp-status { gap: 6px; }
    .pf-lp-status__mark { display: inline-flex; align-items: center; justify-content: center; flex: none;
      width: 14px; height: 14px; border-radius: 999px; color: var(--violet-text, #7c3aed); }
    .pf-lp-status[data-state='offline'] .pf-lp-status__mark { width: 8px; height: 8px; border: 1.5px solid var(--text-tertiary); }
    .pf-lp-status[data-state='none'] .pf-lp-status__mark,
    .pf-lp-status[data-state='web'] .pf-lp-status__mark { width: 7px; height: 7px; background: var(--text-muted); }

    /* Size presets + custom mm */
    .pf-lp-presets { display: flex; flex-wrap: wrap; gap: 8px; }
    .pf-lp-preset { height: 36px; padding: 0 14px; font-size: 13px; }
    .pf-lp-sizes { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
    .pf-lp-size { width: 128px; }
    .pf-lp-times { padding-bottom: 10px; color: var(--text-tertiary); }

    /* Preview stage: a neutral surface; the label stays black-on-white in
       every theme (it represents the physical label). 1 printer dot = 1 CSS
       px (8 px/mm) so the bitmap is shown crisp at its real resolution. */
    .pf-lp-stage { display: flex; align-items: center; gap: 16px; padding: 18px 16px 12px;
      border-radius: var(--pf-radius, 12px); background: var(--pf-chip-bg); border: 1px solid var(--pf-line); }
    .pf-lp-fig { flex: 1 1 auto; min-width: 0; margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .pf-lp-label { position: relative; max-width: 100%; background: #fff; border-radius: 4px; overflow: hidden;
      box-shadow: 0 0 0 1px #cbd5e1, 0 1px 3px rgba(15, 23, 42, 0.12); }
    .pf-lp-label__bmp { position: absolute; left: 0; top: 0; image-rendering: pixelated; }
    .pf-lp-cap { font-size: 12px; color: var(--text-tertiary); text-align: center; }
    .pf-lp-warn { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 10px 12px;
      border-radius: var(--pf-radius-sm, 10px); font-size: 12.5px; line-height: 1.45; text-wrap: pretty;
      color: var(--text-primary); background: var(--pf-chip-bg); border: 1px solid var(--pf-sel-border); }
    .pf-lp-warn > svg { flex: none; margin-top: 1px; color: var(--text-secondary); }

    /* Print position: the pad beside the preview, the readout + actions below. */
    .pf-lp-align { display: flex; align-items: center; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap; }
    .pf-lp-align__info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-lp-offsets { margin: 0; font-size: 13px; color: var(--text-primary); }
    .pf-lp-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .pf-nudge { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
    .pf-nudge-mid { display: flex; gap: 4px; }
    .pf-nudge button { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px;
      border-radius: 9px; border: 1px solid var(--pf-line); background: var(--pf-card-bg); color: var(--text-primary); cursor: pointer; }
    .pf-nudge button:hover { border-color: var(--pf-sel-border); }
    .pf-nudge button:active { background: var(--pf-sel-bg); border-color: var(--pf-sel-border); }
    .pf-nudge button:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }

    /* Connection rows (USB / Bluetooth) + the code row */
    .pf-lp-conn, .pf-lp-code { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 12px; border-radius: var(--pf-radius-sm, 10px); border: 1px solid var(--pf-line); background: var(--pf-card-bg); }
    .pf-lp-code { padding: 0; border: 0; background: transparent; }
    .pf-lp-conn__txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .pf-lp-conn__k { font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    .pf-lp-conn__v { font-size: 13.5px; font-weight: 500; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-lp-codechip { cursor: default; color: var(--text-primary); }
    .pf-lp-code__v { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; }
    .pf-lp-card[data-card='quality'] .pf-lp-body { gap: 12px; }
    .pf-lp-codelink { flex: none; text-decoration: none; }
    .pf-lp-conn .pf-btn { flex: none; height: 40px; min-height: 40px; }

    /* Sliders: slate accent, value in tabular numbers on the label row */
    .pf-lp-slider__lbl { display: flex; justify-content: space-between; gap: 8px; }
    .pf-lp-slider__lbl .pf-num { color: var(--text-primary); font-weight: 600; }
    .pf-range { width: 100%; min-width: 0; height: 24px; margin: 0; accent-color: var(--pf-toggle-on, #aeb8c2); cursor: pointer; }

    /* Document printer */
    .pf-lp-docs { display: flex; align-items: flex-end; gap: 10px; }
    .pf-lp-docs__pick { flex: 1 1 auto; }

    .pf-note { margin: 0; border-radius: var(--pf-radius, 12px); padding: 12px 14px; font-size: 13px; line-height: 1.5;
      background: var(--pf-chip-bg); border: 1px solid var(--pf-line); color: var(--text-secondary); text-wrap: pretty; }
    .pf-wrap { overflow-wrap: anywhere; }
    /* Connected = neutral text + a violet check (never green). */
    .pf-ok { display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; font-size: 12.5px; color: var(--text-secondary); }
    .pf-ok__i { color: var(--violet-text, #7c3aed); }
    .pf-muted { margin: 0; padding: 12px 14px; font-size: 13px; color: var(--text-muted); }
    .pf-hint { font-size: 12px; color: var(--text-muted); }
    .pf-mono { display: block; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text-muted); }
    .pf-list { border: 1px solid var(--pf-line); background: var(--pf-card-bg); border-radius: var(--pf-radius-sm, 10px); overflow: hidden; }
    .pf-row { width: 100%; min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px;
      text-align: left; background: transparent; color: var(--text-primary); border: 0; border-bottom: 1px solid var(--pf-line); cursor: pointer; font: inherit; font-size: 13.5px; }
    .pf-row:last-child { border-bottom: 0; }
    .pf-row:hover { background: var(--pf-chip-bg); }

    /* Touch tiers (iPad + phones, and touch-first devices at any width):
       44px targets everywhere. */
    @include dt.tablet-tier {
      .pf-lp-preset { height: 44px; }
      .pf-nudge button { width: 44px; height: 44px; }
      .pf-lp-conn .pf-btn { height: 44px; min-height: 44px; }
      .pf-range { height: 44px; }
      .pf-lp-codelink { min-height: 44px; height: 44px; }
    }
    /* Phones: stack the size fields and the connection rows' buttons. */
    @media (max-width: 640px) {
      .pf-lp-size { flex: 1 1 0; width: auto; }
      .pf-lp-times { display: none; }
      .pf-lp-conn, .pf-lp-code { flex-wrap: wrap; }
      .pf-lp-docs { flex-wrap: wrap; }
      .pf-lp-body { padding: 12px 14px 14px; }
      /* The label shrinks to the phone: smooth scaling reads better than
         nearest-neighbour at a fractional scale. */
      .pf-lp-stage { flex-direction: column; }
      .pf-lp-card .pf-card__note { flex-basis: 100%; }
      .pf-lp-label__bmp { image-rendering: auto; }
    }
    @media (prefers-reduced-motion: reduce) { .pf-nudge button { transition: none; } }
  `]
})
export class LabelPrinterComponent implements OnInit, OnDestroy {
  protected readonly theme = inject(ThemeService);
  readonly printer = inject(PrinterService);
  readonly printConfig = inject(PrintConfigService);
  private readonly branchCfg = inject(BranchLabConfigService);
  private readonly platform = inject(PlatformService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly isElectron = this.platform.isElectron();
  readonly isCapacitor = this.platform.isCapacitor();
  supported(): boolean { return this.isElectron || this.isCapacitor; }

  /** Band context: which kind of station this is. */
  readonly stationLabel = this.isElectron ? 'Desktop app' : this.isCapacitor ? 'Tablet app' : 'Web browser';
  /** The code is org policy (Lab settings); link there only for those who can change it. */
  readonly canEditCode = this.auth.hasPermission('manage_lab_settings');

  readonly docPrinterOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'System dialog (ask each time)' },
    ...this.systemPrinters().map((p) => ({
      value: p.name, label: `${p.displayName || p.name}${p.isDefault ? ' (default)' : ''}`,
    })),
  ]);

  readonly cfg = this.printConfig.config;
  readonly sizePresets = LABEL_SIZE_PRESETS;
  readonly idCardPresets = ID_CARD_SIZE_PRESETS;
  isIdCardPreset(p: { widthMm: number; heightMm: number }): boolean {
    const c = this.cfg();
    return Math.abs(c.idCardWidthMm - p.widthMm) < 0.05 && Math.abs(c.idCardHeightMm - p.heightMm) < 0.05;
  }
  onIdCardSize(which: 'w' | 'h', value: number): void {
    const c = this.cfg();
    if (which === 'w') this.printConfig.setIdCardSize(value, c.idCardHeightMm);
    else this.printConfig.setIdCardSize(c.idCardWidthMm, value);
  }
  isPreset(p: { widthMm: number; heightMm: number }): boolean {
    const c = this.cfg();
    return Math.abs(c.labelWidthMm - p.widthMm) < 0.05 && Math.abs(c.labelHeightMm - p.heightMm) < 0.05;
  }
  /** A 1-D barcode beside the text on narrow stock can drop below a readable
   *  bar width — say so (with the typical 9-digit sample number). */
  barWarning(): string | null {
    if (this.printConfig.codeMode() !== 'barcode') return null;
    const c = this.cfg();
    const g = tubeLabelGeometry(c.labelWidthMm, c.labelHeightMm, 'barcode', code128Modules('012600001'));
    if (g.scannable) return null;
    return `On ${c.labelWidthMm} × ${c.labelHeightMm} mm the barcode's narrowest bar is ${g.xMm} mm — some scanners need ≥ ${MIN_X_MM} mm. Use a wider label, or ask an admin to switch the code to QR or Data Matrix.`;
  }
  codeLabel(): string {
    const m = this.printConfig.codeMode();
    return m === 'barcode' ? 'Barcode' : m === 'qr' ? 'QR' : 'Data Matrix';
  }

  /** This station's label-printer set-up, from the SAME check "Print label"
   *  uses (PrinterService.labelPrinterState via LabelPrintService): set up or
   *  not + its name. Live connection comes from the transports below. */
  readonly labelState = signal<LabelPrinterState | null>(null);
  async refreshState(): Promise<void> {
    try { this.labelState.set(await this.printer.labelPrinterState()); } catch { /* keep last */ }
  }

  /** The label printer's state for the band: web can't drive one; otherwise
   *  not set up / set up but not reachable now / connected. */
  printerState(): LabelPrinterBandState {
    if (!this.supported()) return 'web';
    const st = this.labelState();
    if (!st?.configured) return 'none';
    const live = this.isElectron ? (this.usbConnected() || this.printer.bleConnected()) : this.printer.connected();
    return live ? 'connected' : 'offline';
  }
  printerStatusText(): string {
    const s = this.printerState();
    if (s === 'web') return 'Needs the desktop or tablet app';
    if (s === 'none') return 'Not set up';
    const name = this.labelState()?.name;
    return s === 'connected' ? `Connected${name ? ' · ' + name : ''}` : `Set up${name ? ' · ' + name : ''} · not connected`;
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
  /** Loading feedback: Test print running / the device row being paired. */
  readonly testing = signal(false);
  readonly pairingId = signal<string | null>(null);

  /** Live label preview — redrawn whenever size, position, code size,
   *  rotation or the org's code changes. */
  private readonly previewCanvas = viewChild<ElementRef<HTMLCanvasElement>>('prev');

  constructor() {
    afterRenderEffect(() => {
      const canvas = this.previewCanvas()?.nativeElement;
      const opts = this.printConfig.labelOpts(); // reads cfg() + the org code
      if (canvas) this.drawPreview(canvas, opts);
    });
  }

  ngOnInit(): void {
    this.branchCfg.ensureLoaded(); // the admin-set code comes from here
    void this.refreshState();
    if (this.isElectron) {
      this.refreshUsb();
      this.loadSystemPrinters();
      this.poll = setInterval(() => this.refreshUsb(), 4000);
    }
  }
  ngOnDestroy(): void { this.unsub?.(); if (this.poll) clearInterval(this.poll); }

  /** Paint the thermal bitmap (what the printer receives) onto the preview
   *  canvas, sized as a fraction of the label so it sits where it prints. */
  private drawPreview(canvas: HTMLCanvasElement, opts: ReturnType<PrintConfigService['labelOpts']>): void {
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const bmp = renderLabelBitmap(PREVIEW_LABEL, opts);
      const { widthDots: w, heightDots: h } = bmp;
      canvas.width = w; canvas.height = h;
      const bytes = atob(bmp.packed);
      const img = ctx.createImageData(w, h);
      const row = Math.ceil(w / 8);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const on = (bytes.charCodeAt(y * row + (x >> 3)) >> (7 - (x & 7))) & 1;
          const i = (y * w + x) * 4;
          const v = on ? 0 : 255;
          img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      // 8 dots/mm: place the printed area on the label outline.
      canvas.style.width = `${Math.min(100, (w / 8 / opts.widthMm) * 100)}%`;
      canvas.style.height = `${Math.min(100, (h / 8 / opts.heightMm) * 100)}%`;
    } catch { /* no canvas (tests / very old WebView) — the outline still shows */ }
  }

  resetAlign(): void { this.printConfig.setOffsetX(0); this.printConfig.setOffsetY(0); }

  onSize(which: 'w' | 'h', value: number): void {
    const c = this.cfg();
    if (which === 'w') this.printConfig.setLabelSize(value, c.labelHeightMm);
    else this.printConfig.setLabelSize(c.labelWidthMm, value);
  }

  async refreshUsb(): Promise<void> {
    const s = await this.printer.electronStatus();
    this.usbConnected.set(s.connected); this.usbName.set(s.name ?? '');
    void this.refreshState();
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
      .finally(() => { this.pairing.set(false); this.unsub?.(); this.unsub = undefined; void this.refreshState(); });
  }
  choose(id: string): void { this.printer.pickBleDevice(id); }
  cancelPair(): void { this.printer.cancelBlePick(); this.pairing.set(false); this.unsub?.(); }

  async test(): Promise<void> {
    this.busy.set(true);
    this.testing.set(true);
    this.toasts.info('Printing test label…');
    try {
      const r = await this.printer.testPrint();
      if (r.ok) this.toasts.success('Test label sent'); else this.toasts.error(r.error || 'Print failed');
    } finally { this.busy.set(false); this.testing.set(false); }
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
    this.pairingId.set(d.deviceId);
    try { await this.printer.selectDevice(d); this.toasts.success(`Paired ${d.name || d.deviceId}`); }
    catch (e) { this.toasts.error((e as Error)?.message || 'Could not connect'); }
    finally { this.busy.set(false); this.pairingId.set(null); void this.refreshState(); }
  }
}
