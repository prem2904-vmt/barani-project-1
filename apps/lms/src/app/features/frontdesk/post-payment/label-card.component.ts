import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js/browser';
import { OrderSample } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { tubeColor } from '../../../shared/utils/tube-colors';
import { tubeChosenSpecimen } from '../../../shared/utils/micro-specimen';
import { tubeDepartmentCodes, tubeDepartmentLabel } from '../../../shared/utils/shared-tube';
import { PrintConfigService } from '../../../core/printer/print-config.service';
import { FittedLine, QUIET_MODULES, TubeLabelGeometry, code128Modules, fitLabelText, tubeLabelGeometry } from '../../../core/printer/label-layout';
import { LabelData, labelTextLines } from '../../../core/printer/label-render';
import { formatAgeParts, patientAge } from '../../../shared/utils/patient-age';

export interface TubeSpec {
  label: string;
  color: 'lavender' | 'yellow' | 'red' | 'green' | 'container' | 'grey';
  volume: string;
}

// Keyed by DEPARTMENT CODE (or name). HEM / MIC are the codes going forward
// (owner 2026-09-26: department codes follow the test codes); the old HAE /
// HAEM / MICRO keys stay for departments that still carry them.
const TUBE_MAP: Record<string, TubeSpec> = {
  HAEM:         { label: 'Lavender',  color: 'lavender',  volume: '3 mL' },
  HAE:          { label: 'Lavender',  color: 'lavender',  volume: '3 mL' },
  HEM:          { label: 'Lavender',  color: 'lavender',  volume: '3 mL' },
  HAEMATOLOGY:  { label: 'Lavender',  color: 'lavender',  volume: '3 mL' },
  ENDO:         { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  ENDOCRINOLOGY:{ label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  BIO:          { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  BIOCHEM:      { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  BIOCHEMISTRY: { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  MICRO:        { label: 'Red',       color: 'red',       volume: '5 mL' },
  MIC:          { label: 'Red',       color: 'red',       volume: '5 mL' },
  MICROBIOLOGY: { label: 'Red',       color: 'red',       volume: '5 mL' },
  CPA:          { label: 'Container', color: 'container', volume: '30 mL' },
  PATHOLOGY:    { label: 'Container', color: 'container', volume: '30 mL' },
  IMMUNO:       { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
  IMMUNOLOGY:   { label: 'Yellow',    color: 'yellow',    volume: '5 mL' },
};
const DEFAULT_TUBE: TubeSpec = { label: 'Grey', color: 'grey', volume: '5 mL' };

/** Chip styling keys this card has CSS for. Anything else falls to grey — the
 *  chip is a visual aid, and a missing swatch beats a mislabelled tube. */
const CHIP_BY_KEY: Readonly<Record<string, TubeSpec['color']>> = {
  edta: 'lavender', sst: 'yellow', urine: 'yellow', plain: 'red',
  heparin: 'green', sterile: 'container', blood_culture: 'container', fluoride: 'grey',
  citrate: 'grey', esr: 'grey', trace: 'grey', multiple: 'grey',
};

/**
 * The tube printed on the label.
 *
 * The test's configured container wins. This used to read the DEPARTMENT code
 * and nothing else, so a test whose container was set to Red in Test Master
 * still printed "Lavender" if it sat in Haematology — while the collection
 * screen, which does honour the field, drew the red tube. Two screens in one
 * workflow disagreeing about which tube to draw is exactly the failure the
 * phlebotomist pays for.
 *
 * The department map stays as the fallback for samples with no container
 * configured, which is how every pre-NABL test still prints something useful.
 */
export function tubeSpec(s: OrderSample): TubeSpec {
  const tc = tubeColor(s.tubeColor);
  if (tc) {
    return {
      label: tc.short,
      color: CHIP_BY_KEY[tc.key] ?? 'grey',
      // Volume isn't carried on the container itself; keep the department's
      // conventional draw volume rather than inventing one.
      volume: deptTube(s).volume,
    };
  }
  return deptTube(s);
}

/** Blood vacutainers — one per colour, never one per specimen. */
const BLOOD_TUBE_KEYS = new Set(['sst', 'edta', 'fluoride', 'citrate', 'plain', 'heparin', 'esr', 'red', 'lavender', 'grey', 'blue', 'gold', 'green', 'black']);

/** The specimen CHOSEN at the desk that this tube's label names — only for
 *  pots/bottles (tubes group by it server-side); a blood vacutainer is one
 *  tube per colour whatever the line's specimen, so it names none. */
export function labelSpecimen(s: OrderSample): string | null {
  const key = (s.tubeColor ?? '').trim().toLowerCase();
  if (key && BLOOD_TUBE_KEYS.has(key)) return null;
  return tubeChosenSpecimen(s);
}

/** The label's tube line: "Sterile · Urine" when a specimen was chosen,
 *  else "{tube} · {volume}" as before. */
export function labelTubeLine(s: OrderSample): string {
  const spec = tubeSpec(s);
  const chosen = labelSpecimen(s);
  return chosen ? `${spec.label} · ${chosen}` : `${spec.label} · ${spec.volume}`;
}

function deptTube(s: OrderSample): TubeSpec {
  const code = (s.department?.code ?? s.department?.name ?? '').toUpperCase().trim();
  return TUBE_MAP[code] ?? DEFAULT_TUBE;
}

@Component({
  selector: 'pf-label-card',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-lc" [class.pf-lc--on]="selected" [class.pf-lc--printing]="printing">

      <!-- Header: checkbox · label number · dept · tube chip -->
      <div class="pf-lc__hdr">
        <button type="button" class="pf-lc__chk" [class.pf-lc__chk--on]="selected"
                (click)="selectToggle.emit()" [attr.aria-label]="selected ? 'Deselect' : 'Select'">
          @if (selected) {
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="m5 12 4 4L19 6"/>
          </svg>
          }
        </button>
        <span class="pf-lc__title">
          Label {{ num }}
          <span class="pf-lc__dept">· {{ deptName }}</span>
          @if (isOutsourced) {
            <span class="pf-lc__out">OUTSOURCED</span>
          }
        </span>
        <span class="pf-lc__tube-chip" [attr.data-color]="spec.color">
          <span class="pf-lc__tube-dot"></span>
          {{ tubeLine }}
        </span>
      </div>

      <!-- The label itself, drawn at its PHYSICAL size (mm) — landscape:
           patient text on the left, the code beside it on the right. On
           screen it is zoomed to fit the card; the print path clones the
           .pf-tl node onto its own W×H mm page (printTubeLabels). -->
      <div class="pf-lc__preview" [attr.data-color]="spec.color">
        <div class="pf-lc__stripe"></div>
        <div class="pf-lc__stage" [style.zoom]="screenZoom">
          <div class="pf-tl" [attr.data-code]="codeMode"
               [attr.data-w-mm]="size.widthMm" [attr.data-h-mm]="size.heightMm"
               [style.width.mm]="size.widthMm" [style.height.mm]="size.heightMm"
               [style.padding.mm]="geo.padMm" [style.column-gap.mm]="geo.gapMm">
            <div class="pf-tl__text" [style.width.mm]="geo.text.w" [style.height.mm]="geo.text.h">
              @for (l of textLines; track l.role) {
                @switch (l.role) {
                  @case ('flag') {
                    <!-- Same label as any tube — only this word is added (owner). -->
                    <p class="pf-tl__line pf-lc__outsourced" [style.font-size.mm]="l.fontMm">OUTSOURCED</p>
                  }
                  @case ('name') {
                    <p class="pf-tl__line pf-lc__pname" [style.font-size.mm]="l.fontMm">{{ patientName }}@if (agesex) { <span class="pf-lc__agesex">{{ agesex }}</span>}</p>
                  }
                  @case ('meta') {
                    <p class="pf-tl__line pf-lc__demo" [style.font-size.mm]="l.fontMm">MRN {{ mrnStr }}</p>
                  }
                  @case ('dept') {
                    <p class="pf-tl__line pf-lc__deptcode" [style.font-size.mm]="l.fontMm">{{ deptCode }}</p>
                  }
                  @case ('id') {
                    <p class="pf-tl__line pf-lc__sid" [style.font-size.mm]="l.fontMm">{{ barcode }}</p>
                  }
                  @case ('extra') {
                    <!-- The specimen chosen at the desk (pots / bottles only). -->
                    <p class="pf-tl__line pf-lc__specimen" [style.font-size.mm]="l.fontMm">{{ specimen }}</p>
                  }
                }
              }
            </div>
            <div class="pf-tl__code pf-lc__codes" [style.width.mm]="geo.code.w" [style.height.mm]="geo.code.h">
              <!-- 1-D: the box carries the 10-module quiet zones as padding. -->
              <div class="pf-lc__bar-wrap" [class.pf-lc__hidden]="!showBarcode"
                   [style.padding-inline.mm]="barQuietMm">
                <svg #barSvg class="pf-lc__bar" role="img" [attr.aria-label]="'Barcode ' + barcode"></svg>
              </div>
              <div #qrBox class="pf-lc__qr pf-lc__qr-wrap" [class.pf-lc__hidden]="!showQr" role="img" [attr.aria-label]="'QR ' + qrValue"></div>
              <div #dmxBox class="pf-lc__qr pf-lc__qr-wrap" [class.pf-lc__hidden]="!showDataMatrix" role="img" [attr.aria-label]="'Data Matrix ' + barcode"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tests in this tube -->
      <!-- <div class="pf-lc__tests-hdr">
        <span class="pf-lc__tests-label">Tests in this tube</span>
        <span class="pf-lc__tube-info" [attr.data-color]="spec.color">
          {{ spec.label | uppercase }} · {{ spec.volume }}
        </span>
      </div>
      <div class="pf-lc__chips">
        @for (t of sample.tests; track t.id) {
          <span class="pf-lc__chip">{{ t.test?.name ?? 'Test' }}</span>
        }
      </div> -->

      <!-- Footer -->
      <div class="pf-lc__footer">
        <span class="pf-lc__barcode-id">{{ barcode }}</span>
        <div class="pf-lc__actions">
          <button type="button" class="pf-lc__action-btn" title="Copy barcode"
                  (click)="copyRequest.emit(barcode)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button type="button" class="pf-lc__action-btn" title="Download"
                  (click)="downloadRequest.emit()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button type="button" class="pf-lc__print-btn" (click)="printRequest.emit()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 9V2h12v7"/>
              <rect x="6" y="13" width="12" height="9"/>
              <path d="M6 18H3a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-3"/>
            </svg>
            Print
          </button>
        </div>
      </div>

    </div>
  `,
  styles: [`
    .pf-lc {
      border-radius: 16px;
      background: var(--surface-elevated);
      border: 1.5px solid var(--border-primary);
      overflow: hidden;
      transition: border-color 0.18s, box-shadow 0.18s;
    }
    .pf-lc--on {
      border-color: #10b981;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
    }

    /* ── Header ─────────────────────────────────────────── */
    .pf-lc__hdr {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px 10px;
      border-bottom: 1px solid var(--border-primary);
    }
    .pf-lc__chk {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      background: var(--glass-bg);
      border: 1.5px solid var(--border-primary);
      color: #ffffff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s, border-color 0.15s;
    }
    .pf-lc__chk--on {
      background: #10b981;
      border-color: #10b981;
    }
    .pf-lc__title {
      flex: 1;
      min-width: 0;
      font-size: 11.5px;
      font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-secondary);
    }
    .pf-lc__dept {
      color: var(--text-tertiary);
      font-weight: 600;
    }
    .pf-lc__tube-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      background: var(--glass-bg);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      flex-shrink: 0;
    }
    .pf-lc__tube-dot {
      width: 9px;
      height: 9px;
      border-radius: 9999px;
      flex-shrink: 0;
    }
    .pf-lc__tube-chip[data-color='lavender'] { background: rgba(196,181,253,0.18); border-color: rgba(196,181,253,0.5); color: #a78bfa; }
    .pf-lc__tube-chip[data-color='lavender'] .pf-lc__tube-dot { background: #c4b5fd; }
    .pf-lc__tube-chip[data-color='yellow']   { background: rgba(253,230,138,0.18); border-color: rgba(253,230,138,0.6); color: #f59e0b; }
    .pf-lc__tube-chip[data-color='yellow']   .pf-lc__tube-dot { background: #fde68a; border: 1px solid #f59e0b; }
    .pf-lc__tube-chip[data-color='red']      { background: rgba(252,165,165,0.18); border-color: rgba(252,165,165,0.5); color: #f87171; }
    .pf-lc__tube-chip[data-color='red']      .pf-lc__tube-dot { background: #fca5a5; }
    .pf-lc__tube-chip[data-color='green']    { background: rgba(110,231,183,0.18); border-color: rgba(110,231,183,0.5); color: #34d399; }
    .pf-lc__tube-chip[data-color='green']    .pf-lc__tube-dot { background: #6ee7b7; }
    .pf-lc__tube-chip[data-color='container'] { background: var(--glass-bg); border-color: var(--border-primary); color: var(--text-tertiary); }
    .pf-lc__tube-chip[data-color='container'] .pf-lc__tube-dot { background: #d1d5db; }

    /* ── White label preview (always light — represents the printed label) ── */
    .pf-lc__preview {
      position: relative;
      margin: 10px 14px;
      border-radius: 10px;
      background: #f1f5f9;
      border: 1px solid #e5e7eb;
      overflow: hidden;
      padding: 10px 10px 10px 18px;
      display: flex;
      justify-content: center;
    }
    .pf-lc__stripe {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 7px;
      background: #d1d5db;
    }
    .pf-lc__preview[data-color='lavender'] .pf-lc__stripe { background: #c4b5fd; }
    .pf-lc__preview[data-color='yellow']   .pf-lc__stripe { background: #fde68a; border-right: 1px solid #f59e0b; }
    .pf-lc__preview[data-color='red']      .pf-lc__stripe { background: #fca5a5; }
    .pf-lc__preview[data-color='green']    .pf-lc__stripe { background: #6ee7b7; }
    .pf-lc__preview[data-color='container'] .pf-lc__stripe { background: #e5e7eb; }
    .pf-lc__stage { line-height: 0; }

    /* ── The physical label (mm). Black on white in every theme. ── */
    .pf-tl {
      box-sizing: border-box;
      display: flex;
      flex-direction: row;
      align-items: center;
      background: #ffffff;
      color: #000000;
      overflow: hidden;
      box-shadow: 0 0 0 0.2mm #cbd5e1;
      font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pf-tl__text {
      flex: none;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0;
    }
    .pf-tl__line {
      margin: 0;
      line-height: 1.12;
      color: #000000;
      /* Never truncated: a line that still doesn't fit at its smallest size
         wraps (even mid-token) instead of being cut. */
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .pf-tl__code {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-left: auto;
      line-height: 0;
    }

    /* Printed on the label itself — black on the white label, bold caps. */
    .pf-lc__outsourced { font-weight: 800; letter-spacing: 0.08em; }
    .pf-lc__pname { font-weight: 700; }
    .pf-lc__agesex { font-weight: 600; white-space: nowrap; margin-left: 0.3em; }
    .pf-lc__demo { font-family: 'JetBrains Mono', ui-monospace, 'Courier New', monospace; font-weight: 600; }
    .pf-lc__deptcode { font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    /* Sample ID — the label's primary identifier. */
    .pf-lc__sid { font-weight: 800; font-family: 'JetBrains Mono', ui-monospace, 'Courier New', monospace; }
    .pf-lc__specimen { font-weight: 700; }
    .pf-lc__hidden { display: none !important; }
    .pf-lc__bar-wrap { box-sizing: border-box; width: 100%; height: 100%; background: #fff; }
    .pf-lc__bar { display: block; width: 100%; height: 100%; }
    .pf-lc__qr { width: 100%; height: 100%; }
    .pf-lc__qr ::ng-deep svg { display: block; width: 100%; height: 100%; shape-rendering: crispEdges; }
    .pf-lc__out {
      margin-left: 6px;
      padding: 1px 7px;
      border-radius: 9999px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.04em;
      background: var(--pf-chip-bg, rgba(100, 116, 139, 0.12));
      color: var(--text-secondary);
      border: 1px solid var(--pf-line, var(--border-primary));
      white-space: nowrap;
    }

    /* ── Tests section ───────────────────────────────────── */
    .pf-lc__tests-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 14px 4px;
    }
    .pf-lc__tests-label {
      font-size: 10.5px;
      font-weight: 600;
      color: var(--text-tertiary);
    }
    .pf-lc__tube-info {
      font-size: 9.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--text-muted);
    }
    .pf-lc__tube-info[data-color='lavender'] { color: #a78bfa; }
    .pf-lc__tube-info[data-color='yellow']   { color: #f59e0b; }
    .pf-lc__tube-info[data-color='red']      { color: #f87171; }
    .pf-lc__tube-info[data-color='green']    { color: #34d399; }

    .pf-lc__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding: 0 14px 10px;
    }
    .pf-lc__chip {
      display: inline-flex;
      align-items: center;
      height: 24px;
      padding: 0 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      background: var(--glass-bg);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
    }

    /* ── Footer ─────────────────────────────────────────── */
    .pf-lc__footer {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px 12px;
      border-top: 1px solid var(--border-primary);
    }
    .pf-lc__barcode-id {
      flex: 1;
      min-width: 0;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pf-lc__actions {
      display: inline-flex;
      gap: 4px;
      flex-shrink: 0;
    }
    .pf-lc__action-btn {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: var(--glass-bg);
      border: 1px solid var(--border-primary);
      color: var(--text-tertiary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.14s, color 0.14s;
    }
    .pf-lc__action-btn:hover {
      background: var(--glass-bg-hover);
      color: var(--text-secondary);
    }
    .pf-lc__print-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 30px;
      padding: 0 14px;
      border-radius: 8px;
      background: #0d9488;
      border: none;
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.14s;
    }
    .pf-lc__print-btn:hover { background: #0f766e; }

    /* ── Print ─────────────────────────────────────────────── */
    @media print {
      .pf-lc:not(.pf-lc--printing) { display: none !important; }
      .pf-lc--printing {
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
        border-radius: 0 !important;
        overflow: visible !important;
        break-inside: avoid;
      }
      .pf-lc--printing .pf-lc__hdr,
      .pf-lc--printing .pf-lc__footer { display: none !important; }
      .pf-lc--printing .pf-lc__preview { margin: 0 !important; border-radius: 4px !important; }
      .pf-tl { box-shadow: none !important; }
    }

    /* ── Cross-platform overrides (additive only) ──────────────
       Desktop-web hover & sizing unchanged. */

    /* Gate hover so touch devices don't get stuck hover states. */
    @media (hover: none) {
      .pf-lc__action-btn:hover { background: var(--glass-bg); color: var(--text-tertiary); }
      .pf-lc__print-btn:hover { background: #0d9488; }
    }

    /* Touch sizing: coarse pointers get >=44px tap targets on the card
       action buttons (icon buttons were 30px). */
    @media (pointer: coarse) {
      .pf-lc__action-btn { width: 44px; height: 44px; }
      .pf-lc__print-btn { height: 44px; }
      /* Selection checkbox stays visually 20px but gets a 44px tap target
         via padding-box hit area so it's reliably tappable on touch. */
      .pf-lc__chk {
        position: relative;
      }
      .pf-lc__chk::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 44px;
        height: 44px;
        transform: translate(-50%, -50%);
      }
    }
  `],
})
export class LabelCardComponent implements AfterViewInit, OnChanges {
  @Input() sample!: OrderSample;
  @Input() patient: Patient | null | undefined;
  @Input() index = 0;
  @Input() selected = false;
  @Input() printing = false;
  /** Resolved referral-lab name for an outsourced vial (parent looks it up). */
  @Input() vendorName: string | null | undefined;

  @Output() selectToggle = new EventEmitter<void>();
  @Output() printRequest = new EventEmitter<void>();
  @Output() copyRequest = new EventEmitter<string>();
  @Output() downloadRequest = new EventEmitter<void>();

  @ViewChild('barSvg', { static: true }) barSvg!: ElementRef<SVGElement>;
  @ViewChild('qrBox', { static: true }) qrBox!: ElementRef<HTMLDivElement>;
  @ViewChild('dmxBox', { static: true }) dmxBox!: ElementRef<HTMLDivElement>;

  private readonly labelCfg = inject(BranchLabConfigService);
  private readonly printCfg = inject(PrintConfigService);
  constructor() { this.labelCfg.ensureLoaded(); }

  /** The station's label stock (Printing → Label), mm. */
  get size(): { widthMm: number; heightMm: number } {
    // Tolerant of partial test doubles; defaults = PrintConfig defaults.
    const c = typeof this.printCfg?.config === 'function' ? this.printCfg.config() : null;
    return { widthMm: c?.labelWidthMm || 50, heightMm: c?.labelHeightMm || 20 };
  }
  /** Landscape geometry: text left, code right (shared with the bitmap path). */
  get geo(): TubeLabelGeometry {
    const { widthMm, heightMm } = this.size;
    return tubeLabelGeometry(widthMm, heightMm, this.codeMode,
      this.codeMode === 'barcode' ? code128Modules(this.barcode) || undefined : undefined);
  }
  /** Barcode quiet zone each side (10 × narrow bar), mm. */
  get barQuietMm(): number { return this.geo.xMm ? QUIET_MODULES * this.geo.xMm : 0; }
  /** What the label prints, as data — the same line list the bitmap uses. */
  get labelData(): LabelData {
    return {
      code: this.barcode,
      patientName: this.patientName,
      ageSex: this.agesex,
      mrn: this.mrnStr,
      deptCode: this.deptCode,
      tube: this.specimen ?? undefined,
      outsourced: this.isOutsourced,
    };
  }
  /** Text lines sized to the text column (shrink → wrap; never cut). */
  get textLines(): FittedLine[] {
    const g = this.geo;
    return fitLabelText(labelTextLines(this.labelData), g.text.w, g.text.h);
  }
  /** On screen the mm-sized label is zoomed to ~300 px wide (never > 1.6×). */
  get screenZoom(): number {
    return Math.round(Math.min(1.6, 300 / (this.size.widthMm * 3.7795)) * 100) / 100;
  }

  get spec(): TubeSpec { return tubeSpec(this.sample); }
  get specimen(): string | null { return labelSpecimen(this.sample); }
  get tubeLine(): string { return labelTubeLine(this.sample); }
  get num(): string { return String(this.index + 1).padStart(2, '0'); }
  /** Every department on the tube — one label for a shared tube names them all. */
  get deptName(): string { return tubeDepartmentLabel(this.sample).toUpperCase(); }
  get deptCode(): string { return tubeDepartmentCodes(this.sample); }
  /** The Sample ID (e.g. MIC-2607-00001) — what the 1D barcode encodes. */
  get barcode(): string { return this.sample.barcode ?? this.sample.id; }
  /** QR payload = MRN + Sample ID (the 2D code carries both; the 1D barcode
   *  stays short with just the Sample ID). Drops the MRN when absent. */
  get qrValue(): string {
    const mrn = this.patient?.mrn?.trim();
    return mrn ? `${mrn}|${this.barcode}` : this.barcode;
  }
  /** Admin choice — a SINGLE code: 'barcode' | 'qr' | 'datamatrix' (default
   *  barcode). A tube label can't fit more than one. */
  get codeMode(): 'barcode' | 'qr' | 'datamatrix' {
    const m = this.labelCfg.config()?.labelCodeMode ?? 'barcode';
    return m === ('both' as string) ? 'barcode' : m; // legacy 'both' → barcode
  }
  get showBarcode(): boolean { return this.codeMode === 'barcode'; }
  get showQr(): boolean { return this.codeMode === 'qr'; }
  get showDataMatrix(): boolean { return this.codeMode === 'datamatrix'; }
  get isOutsourced(): boolean { return !!this.sample.outsourcedVendorId; }
  get patientName(): string { return this.patient?.displayName ?? 'Patient'; }

  get agesex(): string {
    const p = this.patient;
    if (!p) return '';
    // Shared patient-age helper: DOB first (live). Adults keep "34M"; an
    // infant prints "8M F" / "12D M" (never a bare "0").
    const a = patientAge(p);
    const s = p.sex ? p.sex.charAt(0).toUpperCase() : '';
    if (a && a.years < 1) return [formatAgeParts(a, 'Y'), s].filter(Boolean).join(' ');
    return [a ? String(a.years) : '', s].filter(Boolean).join('');
  }

  get mrnStr(): string {
    // Patient.mrn is the server-issued lifetime MRN (e.g. DEL-2605-004217-3).
    // Falls back to "—" for legacy NULL-MRN patients pre-2026-05-16; never
    // print the raw GUID slice — it was misleading patient staff into
    // treating order UUIDs as patient identifiers.
    return this.patient?.mrn?.trim() || '—';
  }

  get dobStr(): string { return this.patient?.dateOfBirth ?? ''; }

  ngAfterViewInit(): void { this.render(); }
  ngOnChanges(): void { if (this.barSvg && this.qrBox) this.render(); }

  private render(): void {
    const code = this.barcode;
    if (!code) return;
    // 1D barcode encodes ONLY the Sample ID (short → keeps the bars narrow).
    // Drawn at 1 unit per module, then stretched to the bar box through the
    // viewBox so every module prints the same width (the quiet zones are the
    // wrapper's padding).
    try {
      const svg = this.barSvg.nativeElement;
      JsBarcode(svg, code, {
        format: 'CODE128',
        displayValue: false,
        margin: 0,
        height: 100,
        width: 1,
        background: '#ffffff',
        lineColor: '#000000',
      });
      const w = parseFloat(svg.getAttribute('width') ?? '0') || code128Modules(code);
      svg.setAttribute('viewBox', `0 0 ${w} 100`);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('shape-rendering', 'crispEdges');
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.removeAttribute('style');
    } catch { /* ignore un-encodable strings */ }
    // QR encodes MRN + Sample ID — vector SVG so it stays crisp at any size.
    // All three codes are drawn (cheap) so the admin's code choice, which can
    // load after first render, only toggles visibility.
    {
      QRCode.toString(this.qrValue, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
        .then((svg: string) => { this.qrBox.nativeElement.innerHTML = svg; })
        .catch(() => {});
    }
    // Data Matrix (2D) encodes ONLY the Sample ID (like the 1D barcode) but
    // fits a much smaller square — for narrow tube labels.
    {
      try {
        this.dmxBox.nativeElement.innerHTML = bwipjs.toSVG({
          bcid: 'datamatrix', text: code, paddingwidth: 1, paddingheight: 1,
          barcolor: '000000', backgroundcolor: 'ffffff',
        });
      } catch { /* ignore un-encodable strings */ }
    }
  }

}
