import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import { Report, ReportTemplate } from '../../../shared/models/report.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { ResolvedReportLayout, ResolvedRow } from '../../../shared/models/report-layout.model';
import { waLink } from '../../../shared/utils/whatsapp';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

interface ReportData {
  patient?: { name?: string; age?: number; sex?: string; phone?: string };
  order?: { id?: string; createdAt?: string; priority?: string; refDoctorName?: string };
  type?: string;
  isPartial?: boolean;
  pendingDepts?: string[];
  tests?: Array<{
    testId: string;
    name?: string;
    department?: string;
    status?: string;
    result?: { values?: Record<string, unknown>; note?: string; flags?: { critical?: boolean }; microFormat?: string };
    resultedAt?: string;
    validatedAt?: string;
    /** Specimen / sample type for the Specimen column. */
    sampleType?: string | null;
    /** NABL scope — false ⇒ segregated into "Tests not under NABL scope". */
    nablScope?: boolean;
    /** Referral / subcontracted lab — printed as "Tested at: …". */
    referralLab?: string | null;
    /** Analytical method — printed as a dim sub-line under the panel. */
    method?: string | null;
  }>;
}

/** One row in the continuous results table — mirrors the PDF's PanelRowData. */
interface ViewPanelRow {
  kind: 'param' | 'note';
  name?: string;
  result?: string;
  range?: string;
  unit?: string;
  specimen?: string;
  /** 'H' | 'L' | 'C' | 'A' | '' */
  flag?: string;
  abnormal?: boolean;
  isLow?: boolean;
  note?: string;
}

/** A test rendered as a panel header + its parameter rows. */
interface ViewPanelGroup {
  testId: string;
  testName: string;
  specimen?: string;
  method?: string;
  referralLab?: string;
  critical?: boolean;
  /** undefined ⇒ in NABL scope (no claim either way). */
  inScope?: boolean;
  rows: ViewPanelRow[];
}

/** A resolved 'result' cell sometimes arrives as the WHOLE enriched value
 *  object JSON — `{"value":8,"flag":"H","range":"...","unit":"..."}` — instead
 *  of just the value (the layout engine put the object in the result column).
 *  Unwrap it to the value + flag so the report never shows raw JSON. */
function coerceResultCell(raw: unknown): { value: string; flag: string } {
  const s = (raw == null ? '' : String(raw)).trim();
  if (s.startsWith('{') && s.includes('"value"')) {
    try {
      const o = JSON.parse(s) as { value?: unknown; flag?: string };
      return { value: o.value == null ? '' : String(o.value), flag: (o.flag ?? '').toUpperCase() };
    } catch { /* fall through to raw */ }
  }
  return { value: s, flag: '' };
}

/** Same unwrap for any cell — returns the .value when the cell is an enriched
 *  object JSON, else the text as-is. */
function coerceCellText(raw: unknown): string {
  const s = (raw == null ? '' : String(raw)).trim();
  if (s.startsWith('{') && s.includes('"value"')) {
    try { const o = JSON.parse(s) as { value?: unknown }; return o.value == null ? '' : String(o.value); }
    catch { /* fall through */ }
  }
  return s;
}

@Component({
  selector: 'pf-report-viewer',
  standalone: true,
  imports: [
    DatePipe,
    ChipComponent,
    ScreenHeaderComponent,
    TouchButtonComponent,
    LoadingLogoComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-report-section">
      <pf-screen-header
        class="pf-rv-header"
        eyebrow="Reports"
        title="Report viewer"
        [subtitle]="subtitle()">
        @if (report()) {
          <ng-container actions>
            <pf-touch-btn class="pf-rv-action" size="sm" variant="secondary" (pressed)="print()">
              <span icon-left aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9"/>
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                  <rect x="6" y="14" width="12" height="8"/>
                </svg>
              </span>
              <span class="pf-rv-action-label">Print</span>
            </pf-touch-btn>
            @if (entitlements.moduleEnabled('messages')) {
              <pf-touch-btn class="pf-rv-action" size="sm" variant="secondary" (pressed)="openSharePicker()">
                <span icon-left aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </span>
                <span class="pf-rv-action-label">Share with…</span>
              </pf-touch-btn>
            }
            <pf-touch-btn class="pf-rv-action" size="sm" variant="primary" (pressed)="deliverWhatsApp()">
              <span icon-left aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m22 2-7 20-4-9-9-4Z"/>
                  <path d="M22 2 11 13"/>
                </svg>
              </span>
              <span class="pf-rv-action-label">Send WhatsApp</span>
            </pf-touch-btn>
          </ng-container>
        }
      </pf-screen-header>

      @if (chatPickerOpen()) {
        <div class="pf-rv-share-backdrop pf-sheet" (click)="closeSharePicker()">
          <div class="pf-rv-share-modal pf-sheet__panel" (click)="$event.stopPropagation()">
            <header class="pf-rv-share-head">
              <div>
                <h3>Share this report</h3>
                <p>The colleague will receive a tap-to-open report card in their chat.</p>
              </div>
              <button type="button" class="pf-rv-share-close" (click)="closeSharePicker()" aria-label="Close">✕</button>
            </header>
            <div class="pf-rv-share-search">
              <input type="text" placeholder="Search by name or email"
                     [value]="chatPickerSearch()" (input)="chatPickerSearch.set($any($event.target).value)" autofocus>
            </div>
            <ul class="pf-rv-share-list">
              @for (u of chatPickerFiltered(); track u.id) {
                <li>
                  <button type="button" class="pf-rv-share-row" [disabled]="chatPickerSending()" (click)="shareWith(u)">
                    <div class="pf-rv-share-avatar">{{ (u.displayName.charAt(0) + (u.displayName.split(' ')[1]?.charAt(0) ?? '')).toUpperCase() }}</div>
                    <div class="pf-rv-share-meta">
                      <span class="pf-rv-share-name">{{ u.displayName }}</span>
                      <span class="pf-rv-share-email">{{ u.email }}</span>
                    </div>
                  </button>
                </li>
              } @empty {
                <li class="pf-rv-share-empty">No colleagues match.</li>
              }
            </ul>
          </div>
        </div>
      }

      <div class="pf-rv-scroll">
      @if (report(); as r) {
        <!-- Status strip -->
        <div class="pf-rv-status">
          <div class="flex items-center gap-2 flex-wrap">
            <pf-chip tone="violet" size="sm">{{ r.type }}</pf-chip>
            <pf-chip [tone]="deliveryTone(r.deliveryStatus)" size="sm">{{ r.deliveryStatus }}</pf-chip>
            @if (hasCritical()) {
              <pf-chip tone="rose" size="sm">CRITICAL</pf-chip>
            }
          </div>
          <p class="pf-rv-status__meta">
            Generated {{ r.createdAt | date:'medium' }}
            · #{{ r.id.slice(0, 8) }}
          </p>
        </div>

        <!-- The on-screen report IS the rendered PDF — the exact same file
             the Download button produces (jsPDF + tenant template + per-test
             layouts), painted page-by-page onto canvases so it renders
             identically on desktop and inside the iOS/Android WebView (an
             <iframe> PDF shows only page 1 in WKWebView). -->
        @if (data()?.isPartial) {
          <!-- Preliminary banner — non-negotiable on a partial report so a
               clinician understands they're not looking at the final one.
               (The PDF pages below carry the report's own chrome.) -->
          <div class="pf-paper__prelim">
            <span class="pf-paper__prelim-icon" aria-hidden="true">⚠</span>
            <div>
              <p class="pf-paper__prelim-title">PRELIMINARY REPORT</p>
              <p class="pf-paper__prelim-sub">
                Departments shown are signed off and final.
                @if (data()?.pendingDepts?.length) {
                  Other departments still pending: {{ data()?.pendingDepts?.join(', ') }}.
                } @else {
                  Other departments still pending.
                }
              </p>
            </div>
          </div>
        }
        @if (pdfError()) {
          <div class="pf-rv-pdf-error">
            <p>{{ pdfError() }}</p>
            <pf-touch-btn size="sm" variant="secondary" (pressed)="renderPdfView()">Try again</pf-touch-btn>
          </div>
        } @else {
          <div class="pf-rv-pdfpages" #pdfPages aria-label="Report PDF">
            @if (!pdfReady()) {
              <div class="pf-rv-loading">
                <pf-loading-logo size="xl" color="purple" [showDna]="true"
                                 [showText]="true" text="Rendering report…"></pf-loading-logo>
              </div>
            }
          </div>
        }
      } @else {
        <div class="pf-rv-loading">
          <pf-loading-logo size="xl" color="purple" [showDna]="true"
                           [showText]="true" text="Loading report…"></pf-loading-logo>
        </div>
      }
      </div>
    </section>
  `,
  styles: [`
    /* ── WORK page: non-scroll app layout on every size ──
       :host fills the shell's main area; the page itself never scrolls.
       The screen header is fixed; the report/loading content scrolls
       inside .pf-rv-scroll. */
    :host {
      display: block;
      height: 100%;
    }
    .pf-report-section {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      padding: 24px 16px 0;
      gap: 16px;
    }
    @media (min-width: 768px) {
      .pf-report-section { padding: 24px 32px 0; }
    }
    .pf-rv-header { flex: 0 0 auto; }
    .pf-rv-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      /* breathing room at the bottom of the inner scroll + safe-area for
         devices with a home indicator under our own scroll chrome. */
      padding-bottom: calc(48px + env(safe-area-inset-bottom));
      -webkit-overflow-scrolling: touch;
    }

    .pf-rv-status {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      margin-bottom: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
    }
    .pf-rv-status__meta {
      margin: 0;
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
    }

    .pf-rv-loading {
      padding: 48px;
      text-align: center;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      color: var(--text-tertiary);
      font-size: 13px;
    }

    /* The rendered PDF pages — stacked white sheets, exactly what the
       downloaded file looks like. Canvas draws at device resolution;
       CSS scales it to the column width. */
    .pf-rv-pdfpages {
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-width: 900px;
      margin: 0 auto;
      padding-bottom: 32px;
    }
    .pf-rv-pdfpages ::ng-deep canvas.pf-rv-pdfpage,
    .pf-rv-pdfpages canvas.pf-rv-pdfpage {
      width: 100%;
      height: auto;
      display: block;
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    }
    .pf-rv-pdf-error {
      padding: 40px 24px;
      text-align: center;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      color: var(--text-secondary);
      font-size: 13px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }

    /* Preliminary banner — only shown on partial reports. Drops into
       the paper before the masthead so any clinician reading it
       knows immediately this isn't the canonical final. */
    .pf-paper__prelim {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 14px;
      margin-bottom: 18px;
      border: 2px solid #b45309;
      background: #fef3c7;
      color: #78350f;
      border-radius: 8px;
    }
    .pf-paper__prelim-icon {
      flex-shrink: 0;
      width: 28px; height: 28px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #f59e0b;
      color: #ffffff;
      font-size: 16px;
      font-weight: 700;
    }
    .pf-paper__prelim-title {
      margin: 0;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: #78350f;
    }
    .pf-paper__prelim-sub {
      margin: 2px 0 0;
      font-size: 12px;
      color: #92400e;
    }

    /* The printable "paper". Kept static black-on-white so output prints cleanly. */
    .pf-paper {
      background: #ffffff;
      color: #0f172a;
      border-radius: 14px;
      padding: 36px 40px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(0, 0, 0, 0.08);
      font-family: 'Noto Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .pf-paper .pf-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

    .pf-paper__masthead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 14px;
      border-bottom: 2px solid #1B3A6B;
    }
    .pf-paper__lab {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .pf-paper__tagline {
      margin: 2px 0 0;
      font-size: 11.5px;
      color: #64748b;
    }
    .pf-paper__nabl {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 9999px;
      background: #ecfdf5;
      color: #047857;
      border: 1px solid #a7f3d0;
      white-space: nowrap;
    }

    .pf-paper__meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 6px 16px;
      margin: 18px 0 0;
      padding: 14px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    .pf-paper__meta > div { display: flex; flex-direction: column; }
    .pf-paper__meta dt {
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #94a3b8;
    }
    .pf-paper__meta dd {
      margin: 2px 0 0;
      font-size: 13px;
      color: #0f172a;
    }

    .pf-paper__body {
      margin-top: 22px;
      display: flex;
      flex-direction: column;
      gap: 22px;
    }
    .pf-paper__dept {
      margin: 0 0 10px;
      padding-bottom: 6px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #334155;
      border-bottom: 1px solid #1B3A6B;
    }
    .pf-paper__test { margin-bottom: 16px; }
    .pf-paper__test:last-child { margin-bottom: 0; }
    .pf-paper__test-name {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #0f172a;
    }
    .pf-paper__test-meta {
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: #94a3b8;
    }
    .pf-paper__crit-chip {
      padding: 1px 8px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      background: #fee2e2;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }

    .pf-paper__table {
      width: 100%;
      margin-top: 8px;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    .pf-paper__table th {
      text-align: left;
      padding: 6px 2px;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #94a3b8;
      border-bottom: 1px solid #e2e8f0;
    }
    .pf-paper__table td {
      padding: 6px 2px;
      border-bottom: 1px solid #f1f5f9;
      color: #0f172a;
      font-variant-numeric: tabular-nums;
    }
    .pf-paper__table tbody tr:last-child td { border-bottom: 0; }
    .text-right { text-align: right; }
    .pf-paper__val--crit { color: #b91c1c; font-weight: 700; }

    /* ── Continuous results table (matches the PDF download) ── */
    .pf-paper__rtable {
      width: 100%;
      margin-top: 4px;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    .pf-paper__rtable th {
      text-align: left;
      padding: 7px 8px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #0f172a;
      border-top: 1px solid #334155;
      border-bottom: 1px solid #334155;
    }
    .pf-paper__rtable td {
      padding: 5px 8px;
      color: #0f172a;
      font-variant-numeric: tabular-nums;
      vertical-align: top;
    }
    .pf-rt-invest { width: 32%; }
    .pf-rt-pname { font-weight: 700; }
    .pf-rt-muted { color: #64748b; }
    .pf-paper__rtable tr.pf-rt-panel td {
      padding: 7px 8px 5px;
      background: #eef2f7;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .pf-rt-crit {
      margin-left: 8px;
      padding: 1px 7px;
      border-radius: 9999px;
      font-size: 9px;
      font-weight: 700;
      background: #fee2e2;
      color: #b91c1c;
      border: 1px solid #fecaca;
      vertical-align: middle;
    }
    .pf-paper__rtable tr.pf-rt-sub td {
      padding: 2px 8px 6px;
      font-size: 11px;
      font-style: italic;
      color: #64748b;
    }
    .pf-rt-sub .pf-rt-dot { margin: 0 6px; }
    .pf-paper__rtable tr.pf-rt-note td {
      padding: 6px 8px;
      background: #f8fafc;
      font-style: italic;
      font-size: 11.5px;
      color: #475569;
    }
    .pf-rt-flag {
      margin-left: 6px;
      font-size: 10px;
      font-weight: 700;
      vertical-align: super;
    }
    .pf-paper__scope {
      margin: 22px 0 0;
      padding-bottom: 6px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #334155;
      border-bottom: 1px solid #cbd5e1;
    }

    /* Resolved-layout sections (when admin has configured a per-test layout) */
    .pf-paper__rs { margin: 10px 0; }
    .pf-paper__rs-label {
      margin: 0 0 4px; font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: #475569;
    }
    /* Override the legacy thead style so dynamic-layout headers use the
     * configured column widths and the navy bar matches the spec. */
    .pf-paper__rs .pf-paper__table th {
      background: #1B3A6B;
      color: #ffffff;
      font-weight: 700;
      letter-spacing: 0.06em;
    }
    .pf-paper__row--merged td {
      background: #f1f5f9;
      font-style: italic;
      color: #475569;
      text-align: center;
      padding: 8px;
    }
    .pf-paper__rs-para {
      margin: 4px 0 0;
      padding: 8px 12px;
      background: #f8fafc;
      border-left: 3px solid #cbd5e1;
      border-radius: 4px;
      font-size: 12.5px;
      color: #1e293b;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .pf-paper__rs-images {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px;
    }
    .pf-paper__rs-images img {
      width: 100%;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
    }
    .pf-paper__rs-chart { display: flex; flex-direction: column; gap: 4px; }
    .pf-paper__rs-chart-bar {
      position: relative;
      height: 14px;
      background: #f1f5f9;
      border-radius: 7px;
      overflow: hidden;
    }
    .pf-paper__rs-chart-zone { position: absolute; top: 0; bottom: 0; }
    .pf-paper__rs-chart-marker {
      position: absolute;
      top: -3px; bottom: -3px;
      width: 3px; background: #0f172a;
      border-radius: 2px;
      transform: translateX(-1.5px);
    }
    .pf-paper__rs-chart-axis {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #64748b;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }

    .pf-paper__note {
      margin: 8px 0 0;
      padding: 8px 10px;
      background: #f8fafc;
      border-left: 3px solid #cbd5e1;
      border-radius: 4px;
      font-size: 12px;
      color: #475569;
    }
    .pf-paper__empty {
      margin: 4px 0 0;
      font-style: italic;
      font-size: 12px;
      color: #94a3b8;
    }

    .pf-paper__footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 24px;
      margin-top: 36px;
      flex-wrap: wrap;
    }
    .pf-paper__sig { flex: 1; min-width: 240px; }
    .pf-paper__disclaimer {
      margin: 0 0 14px;
      max-width: 420px;
      font-size: 10.5px;
      color: #64748b;
    }
    .pf-paper__sig-line { text-align: right; }
    .pf-paper__sig-rule {
      height: 1px;
      width: 180px;
      margin-left: auto;
      border-bottom: 1px solid #64748b;
      margin-bottom: 6px;
    }
    .pf-paper__sig-line p {
      margin: 0;
      font-size: 12px;
      color: #0f172a;
    }

    .pf-paper__qr { text-align: center; }
    .pf-paper__qr-caption {
      margin: 6px 0 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.08em;
      color: #64748b;
    }

    .pf-paper__powered {
      margin: 22px 0 0;
      text-align: center;
      font-size: 10px;
      color: #94a3b8;
    }

    @media print {
      :host {
        background: #ffffff !important;
        display: block;
        height: auto !important;
      }
      /* Undo the non-scroll viewport clamp so the full report paginates
         across pages instead of being clipped to one screen. */
      .pf-report-section {
        padding: 0 !important;
        max-width: none !important;
        height: auto !important;
        overflow: visible !important;
        display: block !important;
      }
      .pf-rv-scroll {
        overflow: visible !important;
        padding-bottom: 0 !important;
      }
      .pf-rv-status,
      .pf-rv-loading,
      pf-screen-header { display: none !important; }
      .pf-paper {
        box-shadow: none !important;
        border: 0 !important;
        border-radius: 0 !important;
        padding: 18mm 14mm !important;
      }
    }

    /* Share-with-colleague modal */
    .pf-rv-share-backdrop {
      position: fixed; inset: 0; z-index: 200;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
    }
    .pf-rv-share-modal {
      background: var(--surface-elevated);
      border: 1px solid var(--glass-border-hover);
      border-radius: 14px;
      width: 100%; max-width: 440px;
      max-height: min(80dvh, 560px);
      display: flex; flex-direction: column;
      box-shadow: var(--glass-shadow-hover);
      color: var(--text-primary);
      overflow: hidden;
    }
    .pf-rv-share-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; padding: 14px 18px;
      border-bottom: 1px solid var(--border-muted);
      h3 { font-size: 14px; font-weight: 700; margin: 0; }
      p  { font-size: 11.5px; color: var(--text-tertiary); margin: 2px 0 0; }
    }
    .pf-rv-share-close {
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      width: 28px; height: 28px; border-radius: 7px;
      cursor: pointer; font-size: 12px;
      &:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    }
    .pf-rv-share-search {
      padding: 12px 18px; border-bottom: 1px solid var(--border-muted);
      input {
        width: 100%; padding: 9px 12px; border-radius: 9px;
        border: 1px solid var(--input-border); background: var(--bg-input);
        color: var(--input-text); font-size: 13px; outline: none;
        &:focus { border-color: var(--input-border-focus); }
      }
    }
    .pf-rv-share-list {
      list-style: none; margin: 0; padding: 6px 0 10px;
      overflow-y: auto; flex: 1;
    }
    .pf-rv-share-row {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 8px 18px;
      background: transparent; border: none;
      text-align: left; cursor: pointer;
      color: inherit;
      &:hover:not(:disabled) { background: var(--bg-hover); }
      &:disabled { opacity: 0.55; cursor: progress; }
    }
    .pf-rv-share-avatar {
      width: 34px; height: 34px; border-radius: 50%;
      background: var(--gradient-primary); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; flex-shrink: 0;
    }
    .pf-rv-share-meta { display: flex; flex-direction: column; min-width: 0; }
    .pf-rv-share-name { font-size: 13px; font-weight: 600; }
    .pf-rv-share-email { font-size: 11px; color: var(--text-tertiary); }
    .pf-rv-share-empty { padding: 20px 16px; text-align: center; font-size: 12.5px; color: var(--text-tertiary); }

    /* ───────────────────────────────────────────────────────────────
       CROSS-PLATFORM OVERRIDES — additive only.
       Desktop-web (>=1280) is untouched: every rule below is gated to
       a sub-desktop width, a coarse pointer, or a platform html class.
       ─────────────────────────────────────────────────────────────── */

    /* iOS input-zoom guard: the share-search input is 13px which trips
       Safari's auto-zoom on focus. Bump to 16px on touch devices only;
       desktop keeps the original compact size. */
    @media (pointer: coarse) {
      .pf-rv-share-search input { font-size: 16px; }
      /* Close button must be a real 44px tap target on touch. */
      .pf-rv-share-close { width: 44px; height: 44px; }
      .pf-rv-share-row { padding-top: 12px; padding-bottom: 12px; min-height: 44px; }
    }

    /* Touch devices: neutralize sticky :hover backgrounds that linger
       after a tap (hover styles belong to real pointers only). */
    @media (hover: none) {
      .pf-rv-share-close:hover { background: var(--glass-bg); color: var(--text-secondary); }
      .pf-rv-share-row:hover:not(:disabled) { background: transparent; }
    }

    /* Use dynamic viewport height so the share sheet isn't clipped under
       mobile browser chrome (the static 80vh undershoots/overshoots). */
    @supports (height: 100dvh) {
      .pf-rv-share-modal { max-height: min(80dvh, 560px); }
    }

    /* ── Phone (<=640): single-column, no horizontal overflow ── */
    @media (max-width: 640px) {
      /* Header actions → compact icon-only squares so Print / Share / Send /
         Back all fit on one row under the title and nothing overflows the
         right edge. The text label stays in the DOM but visually-hidden, so
         each button keeps its accessible name (svg is aria-hidden). Desktop
         (>=641) keeps the full text buttons untouched. */
      .pf-rv-action-label {
        position: absolute;
        width: 1px; height: 1px;
        padding: 0; margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .pf-rv-action ::ng-deep button {
        width: 40px;
        min-width: 40px;
        height: 40px;
        padding: 0;
        gap: 0;
        border-radius: 12px;
      }

      /* Report preview must be contained within the viewport — never push the
         page sideways. The paper is fluid; pin it to the available width and
         let fixed-width children (barcode/QR card, images) scale down. Touch
         users can pinch-zoom the report for detail. */
      .pf-rv-scroll { touch-action: pan-x pan-y pinch-zoom; }
      .pf-paper { max-width: 100%; box-sizing: border-box; }
      .pf-paper img { max-width: 100%; height: auto; }
      .pf-paper__qr ::ng-deep .pf-code-card {
        max-width: 100%;
        box-sizing: border-box;
      }
      .pf-paper__qr ::ng-deep .pf-code-card__row {
        flex-wrap: wrap;
        justify-content: center;
        gap: 12px;
      }
      .pf-paper__qr ::ng-deep .pf-code-card__bar { max-width: 100%; }

      /* This page clamps itself (:host height:100%; section overflow:hidden)
         so .pf-rv-scroll is the real scroll container, NOT shell-main. The
         base 48px clearance under-clears the floating bottom-nav pill, so
         re-apply the canonical pill footprint here (88px + bottom safe-area)
         so the last report rows aren't hidden behind the pill. */
      .pf-rv-scroll { padding-bottom: var(--tab-nav-total-height); }

      /* Status strip: chips + meta stack instead of cramping. */
      .pf-rv-status {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }

      /* Tighter paper so the printable doesn't waste the narrow width. */
      .pf-paper { padding: 20px 16px; }
      .pf-paper__masthead { flex-wrap: wrap; }

      /* Wide 5-column results tables can't shrink below their content;
         let them scroll horizontally WITHIN the paper rather than blow
         the whole page out. The page itself never scrolls sideways. */
      .pf-paper__body { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .pf-paper__rtable,
      .pf-paper__test > .pf-paper__table,
      .pf-paper__rs .pf-paper__table { min-width: 460px; }

      /* Footer: signature + QR stack and left-align on a narrow page. */
      .pf-paper__footer { flex-direction: column; align-items: stretch; gap: 20px; }
      .pf-paper__sig { min-width: 0; }
      .pf-paper__sig-line { text-align: left; }
      .pf-paper__sig-rule { margin-left: 0; }
      .pf-paper__qr { text-align: left; }

      /* Share picker becomes a bottom sheet rather than a centred dialog. */
      .pf-rv-share-backdrop { align-items: flex-end; padding: 0; }
      .pf-rv-share-modal {
        max-width: none;
        width: 100%;
        max-height: 86dvh;
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        /* Clear the home-indicator / device gesture area. */
        padding-bottom: env(safe-area-inset-bottom);
      }
    }

    /* ── iPad (641–1279): keep the spacious paper, just ensure the share
       picker stays a comfortable centred dialog and tables never overflow
       the paper edge. No base changes — these only widen sub-desktop. ── */
    @media (min-width: 641px) and (max-width: 1279px) {
      .pf-paper__body { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    }

    /* Capacitor native: the share sheet is full-bleed fixed chrome, so it
       owns its own safe-area bottom inset on phone. */
    :host-context(html.cap-native) .pf-rv-share-modal {
      padding-bottom: env(safe-area-inset-bottom);
    }
  `]
})
export class ReportViewerComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly entitlements = inject(TenantEntitlementsService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly chat = inject(ChatService);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  private readonly _report = signal<Report | null>(null);
  private readonly _tpl = signal<ReportTemplate | null>(null);
  readonly report = this._report.asReadonly();
  readonly tpl = this._tpl.asReadonly();

  // ── Inline PDF view ─────────────────────────────────────
  // The on-screen report is the SAME jsPDF file the Download button
  // produces, painted onto canvases via pdf.js. One render, cached blob —
  // Print/Share reuse it instead of re-building.
  private readonly pdfPagesEl = viewChild<ElementRef<HTMLDivElement>>('pdfPages');
  private readonly _pdfReady = signal(false);
  private readonly _pdfError = signal<string | null>(null);
  readonly pdfReady = this._pdfReady.asReadonly();
  readonly pdfError = this._pdfError.asReadonly();
  private _pdfBlob: Blob | null = null;
  private _pdfRendering = false;
  // Kick the render only once BOTH the report data and the #pdfPages host
  // exist (the host is inside the @if(report()) branch, so it appears a
  // change-detection cycle after the report loads).
  private readonly _pdfKickoff = effect(() => {
    if (!this.pdfPagesEl() || !this._report()) return;
    if (this._pdfReady() || this._pdfError()) return;   // done or awaiting manual retry
    untracked(() => this.renderPdfView());
  });

  // Share-with-colleague picker state.
  protected readonly chatPickerOpen = signal(false);
  protected readonly chatPickerSearch = signal('');
  protected readonly chatPickerUsers = signal<{ id: string; displayName: string; email: string; isActive: boolean }[]>([]);
  protected readonly chatPickerSending = signal(false);
  protected readonly chatPickerFiltered = computed(() => {
    const term = this.chatPickerSearch().toLowerCase().trim();
    const me = this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
    return this.chatPickerUsers()
      .filter(u => u.id !== me && u.isActive)
      .filter(u => !term || u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));
  });

  async openSharePicker(): Promise<void> {
    this.chatPickerOpen.set(true);
    this.chatPickerSearch.set('');
    if (this.chatPickerUsers().length === 0) {
      try {
        const users = await firstValueFrom(this.api.get<{ id: string; displayName: string; email: string; isActive: boolean }[]>('/api/directory/users'));
        this.chatPickerUsers.set(users ?? []);
      } catch {
        this.toasts.error('Could not load directory.');
      }
    }
  }
  closeSharePicker(): void { this.chatPickerOpen.set(false); this.chatPickerSending.set(false); }

  async shareWith(u: { id: string; displayName: string }): Promise<void> {
    const r = this.report();
    if (!r) return;
    this.chatPickerSending.set(true);
    try {
      const label = this.subtitle() || `Report #${r.id.slice(0, 8)}`;
      const convId = await this.chat.openConversationWithContext(u.id, 'report', r.id, label);
      await this.chat.shareReport(convId, r.id);
      this.toasts.info(`Sent to ${u.displayName}`);
      this.closeSharePicker();
      this.router.navigate(['/messages']);
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    } finally { this.chatPickerSending.set(false); }
  }

  readonly data = computed<ReportData | null>(() => {
    const raw = this._report()?.data;
    if (!raw) return null;
    try { return JSON.parse(raw) as ReportData; } catch { return null; }
  });

  readonly subtitle = computed(() => {
    const d = this.data();
    if (!d?.patient?.name) return 'Final report preview.';
    return `${d.patient.name} · ${d.order?.id?.slice(0, 8) ?? ''}`;
  });

  readonly hasCritical = computed(() =>
    (this.data()?.tests ?? []).some(t => t.result?.flags?.critical));

  readonly groupedTests = computed(() => {
    const tests = this.data()?.tests ?? [];
    const map = new Map<string, typeof tests>();
    for (const t of tests) {
      const key = t.department ?? 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([department, tests]) => ({ department, tests }));
  });

  /** Effective abnormal-flag style — mirrors the PDF theme. */
  flagStyle(): 'bold' | 'bold_color' {
    return this.tpl()?.flagStyle === 'bold_color' ? 'bold_color' : 'bold';
  }
  /** Indicator glyph mode: H/L letters or ↑/↓ arrows. */
  flagIndicator(): 'letter' | 'arrow' {
    return this.tpl()?.flagIndicator === 'arrow' ? 'arrow' : 'letter';
  }
  /** Admin-chosen colours for abnormals (high / low). */
  private abnormalColor(): string { return this.tpl()?.abnormalColor || '#dc2626'; }
  private abnormalLowColor(): string { return this.tpl()?.abnormalLowColor || '#2563eb'; }

  /** Result-cell colour: only tinted when style is bold_color AND the value
   *  is abnormal (admin high / low colour); otherwise default ink. */
  resultColor(row: ViewPanelRow): string | null {
    if (!row.abnormal || this.flagStyle() !== 'bold_color') return null;
    return row.isLow ? this.abnormalLowColor() : this.abnormalColor();
  }

  /** The flag glyph to show beside the value: ↑/↓ in arrow mode, H/L/C/A in
   *  letter mode. */
  flagDisplay(row: ViewPanelRow): string {
    if (!row.flag) return '';
    if (this.flagIndicator() === 'arrow') {
      if (row.flag === 'H') return '↑';
      if (row.flag === 'L') return '↓';
    }
    return row.flag;
  }

  /** Classify tests + build the continuous-table panel groups. Mirrors the
   *  PDF's buildPanelGroup / scope segregation so the on-screen view and the
   *  download are structurally identical. */
  readonly panels = computed<{ inScope: ViewPanelGroup[]; outScope: ViewPanelGroup[]; special: NonNullable<ReportData['tests']> }>(() => {
    const tests = this.data()?.tests ?? [];
    const resolved = this._resolved();
    const tabular: ViewPanelGroup[] = [];
    const special: NonNullable<ReportData['tests']> = [];

    for (const t of tests) {
      const layout = resolved[t.testId];
      const isCulture = t.result?.microFormat === 'culture_sensitivity';
      const hasNonGrid = !!layout && layout.sections.some(s => s.isVisible && s.type !== 'grid');
      if (isCulture || hasNonGrid) { special.push(t); continue; }
      const g = this.buildViewGroup(t, layout);
      if (g.rows.length > 0) tabular.push(g); else special.push(t);
    }

    const claimsNabl = !!this.tpl()?.nablAccredited;
    const outScope = claimsNabl ? tabular.filter(g => g.inScope === false) : [];
    const inScope = outScope.length > 0 ? tabular.filter(g => g.inScope !== false) : tabular;
    return { inScope, outScope, special };
  });

  /** Build a panel group (header + parameter rows) from a test + its resolved
   *  layout. Reads the same grid columns / legacy values as the PDF. */
  private buildViewGroup(t: NonNullable<ReportData['tests']>[number], layout: ResolvedReportLayout | undefined): ViewPanelGroup {
    const g: ViewPanelGroup = {
      testId: t.testId,
      testName: t.name ?? layout?.testName ?? 'Test',
      specimen: ((t.sampleType ?? layout?.sampleType) ?? '').trim() || undefined,
      method: (t.method ?? '').trim() || undefined,
      referralLab: (t.referralLab ?? '').trim() || undefined,
      critical: !!t.result?.flags?.critical,
      inScope: t.nablScope,
      rows: [],
    };

    const gridSections = (layout?.sections ?? []).filter(s => s.isVisible && s.type === 'grid');
    if (gridSections.length > 0) {
      const cols = layout!.columns;
      const srcOf = (type: string) => cols.find(c => c.type === type);
      const resultSrc = srcOf('result'), rangeSrc = srcOf('range'), unitSrc = srcOf('unit');
      for (const sec of gridSections) {
        for (const r of sec.rows ?? []) {
          if (r.isMerged) {
            const note = (r.mergeContent ?? '').trim();
            if (note) g.rows.push({ kind: 'note', note });
            continue;
          }
          const rc = coerceResultCell(resultSrc ? r.cells[resultSrc.name] : '');
          const colorWord = this.hueFlag(r.color);
          const flag = rc.flag || (colorWord === 'High' ? 'H' : colorWord === 'Low' ? 'L' : '');
          g.rows.push({
            kind: 'param',
            name: this.humanize(r.parameterName ?? ''),
            result: rc.value || (resultSrc ? String(r.cells[resultSrc.name] ?? '') : ''),
            range: coerceCellText(rangeSrc ? r.cells[rangeSrc.name] : ''),
            unit: coerceCellText(unitSrc ? r.cells[unitSrc.name] : ''),
            flag,
            isLow: flag === 'L',
            abnormal: !!r.color || r.isBold || (!!rc.flag && rc.flag !== 'N'),
          });
        }
      }
    } else {
      const values = (t.result?.values ?? {}) as Record<string, { value?: unknown; flag?: string; range?: string; unit?: string } | unknown>;
      for (const [name, raw] of Object.entries(values)) {
        const v = (raw ?? {}) as { value?: unknown; flag?: string; range?: string; unit?: string };
        const isObj = v && typeof v === 'object' && !Array.isArray(v);
        const flag = (isObj ? (v.flag ?? '') : '').toUpperCase();
        const letter = ['H', 'L', 'C', 'A'].includes(flag) ? flag : '';
        g.rows.push({
          kind: 'param',
          name: this.humanize(name),
          result: isObj ? String(v.value ?? '—') : String(raw ?? '—'),
          range: isObj ? (v.range ?? '') : '',
          unit: isObj ? (v.unit ?? '') : '',
          flag: letter,
          isLow: flag === 'L',
          abnormal: !!letter,
        });
      }
    }

    // Specimen shown once, on the first parameter row.
    const firstParam = g.rows.find(r => r.kind === 'param');
    if (firstParam) firstParam.specimen = g.specimen;
    return g;
  }

  /** Template helper: render a resolved grid cell, unwrapping the enriched
   *  value object JSON to its `.value` so the report never shows raw JSON. */
  displayCell(row: ResolvedRow, name: string): string { return coerceCellText(row.cells?.[name]); }

  /** Map a resolved-row colour to a High/Low flag word (same heuristic as the
   *  PDF's flagLabel). */
  private hueFlag(color: string | null | undefined): string {
    if (!color) return '';
    const c = color.toLowerCase();
    if (c.includes('dc26') || c.includes('ef44') || c.includes('red') || c.includes('b91c')) return 'High';
    if (c.includes('2563') || c.includes('3b82') || c.includes('blue')) return 'Low';
    return '';
  }

  /** "hemoglobin_a1c" → "Hemoglobin A1c" (mirrors the PDF). */
  private humanize(s: string): string {
    if (!s) return '—';
    if (/\s/.test(s) || /^[A-Z]/.test(s)) return s;
    return s.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, c => c.toUpperCase());
  }

  paramRows(t: { result?: { values?: Record<string, unknown> } }) {
    const vals = t.result?.values ?? {};
    return Object.entries(vals).map(([name, value]) => ({
      name,
      value: value == null || value === '' ? '—' : String(value)
    }));
  }

  verifyCode(token: string): string {
    // Use the canonical public web origin, NOT window.location.origin — in the
    // native app the latter is capacitor://localhost, which a patient can't open.
    return `${environment.reportPublicBaseUrl}/reports/public/${token}`;
  }

  deliveryTone(status: string | undefined): ChipTone {
    if (status === 'delivered') return 'emerald';
    if (status === 'failed')    return 'rose';
    if (status === 'pending')   return 'amber';
    return 'default';
  }

  // ── Dynamic resolved layouts (one per testId) ─────────────
  // The admin's per-test report layout (sections + conditions) is fetched
  // for each test via /api/report-layout/preview/:testId with that test's
  // entered result values. Tests without a configured layout return an
  // empty sections array — the template renders the legacy parameter
  // table in that case.
  private readonly layoutSvc = inject(ReportLayoutService);
  private readonly _resolved = signal<Record<string, ResolvedReportLayout>>({});
  resolvedFor(testId: string): ResolvedReportLayout | null {
    const r = this._resolved()[testId];
    return r && r.sections.length > 0 ? r : null;
  }

  /** Visible columns for a resolved layout section. Mirrors the PDF
   *  renderer: (a) drop text columns whose cells are all blank (the
   *  unused Specimen case), but KEEP typed columns (result/unit/range/
   *  flag) so the header stays consistent across tests; (b) reorder to
   *  the Drlogy convention `Result → Reference → Unit` so the value
   *  and its acceptable range sit next to each other. */
  visibleColumns(
    pv: ResolvedReportLayout,
    sec: ResolvedReportLayout['sections'][number]
  ): ResolvedReportLayout['columns'] {
    const body = (sec.rows ?? []).filter(r => !r.isMerged);
    const filtered = pv.columns.filter(c => {
      if (c.type !== 'text') return true;
      if (body.length === 0) return true;
      return body.some(r => {
        const v = r.cells[c.name];
        return v != null && String(v).trim() !== '';
      });
    });
    const cols = filtered.length > 0 ? filtered : pv.columns;

    // Reorder typed core into Drlogy convention.
    const result = cols.find(c => c.type === 'result');
    const range  = cols.find(c => c.type === 'range');
    const unit   = cols.find(c => c.type === 'unit');
    const flag   = cols.find(c => c.type === 'flag');
    if (!result && !range && !unit) return cols;
    const typedSet = new Set([result, range, unit, flag].filter(Boolean) as ResolvedReportLayout['columns']);
    const ordered: ResolvedReportLayout['columns'] = [];
    if (result) ordered.push(result);
    if (range)  ordered.push(range);
    if (unit)   ordered.push(unit);
    if (flag)   ordered.push(flag);
    cols.forEach(c => { if (!typedSet.has(c)) ordered.push(c); });
    return ordered;
  }

  /** Drlogy-style column header label. Server defaults emit
   *  "Reference range" — Drlogy convention says "Reference Value".
   *  Falls back to the layout's original label for custom columns. */
  drlogyLabelFor(c: ResolvedReportLayout['columns'][number]): string {
    if (c.type === 'range') return 'Reference Value';
    return c.label;
  }

  /** Prepend the API base for server-relative asset URLs ("/uploads/…")
   *  so logos / signature images uploaded via the template editor resolve
   *  correctly when the viewer is served from a different host than the
   *  API (dev / capacitor / electron). Absolute http(s) URLs pass through. */
  private readonly platform = inject(PlatformService);
  resolveAsset(url: string | null | undefined): string {
    const u = url ?? '';
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || u.startsWith('data:')) return u;
    return `${this.platform.getApiUrl()}${u}`;
  }

  /** Template-driven date/time formatter (mirrors the PDF renderer).
   *  Falls back to the medium Angular date pipe shape when no template
   *  is loaded yet. */
  formatStamp(iso: string | undefined | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const t = this.tpl();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dd = String(d.getDate()).padStart(2, '0');
    const mmNum = String(d.getMonth() + 1).padStart(2, '0');
    const mmm = months[d.getMonth()];
    const yyyy = String(d.getFullYear());
    const fmt = t?.dateFormat ?? 'dd MMM yyyy';
    let datePart: string;
    switch (fmt) {
      case 'dd/MM/yyyy':   datePart = `${dd}/${mmNum}/${yyyy}`; break;
      case 'MMM dd, yyyy': datePart = `${mmm} ${dd}, ${yyyy}`;  break;
      case 'yyyy-MM-dd':   datePart = `${yyyy}-${mmNum}-${dd}`; break;
      case 'dd MMM yyyy':
      default:             datePart = `${dd} ${mmm} ${yyyy}`;
    }
    const tf = t?.timeFormat ?? '12h';
    if (tf === 'none') return datePart;
    const min = String(d.getMinutes()).padStart(2, '0');
    let timePart: string;
    if (tf === '24h') {
      timePart = `${String(d.getHours()).padStart(2, '0')}:${min}`;
    } else {
      let h = d.getHours();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      timePart = `${String(h).padStart(2, '0')}:${min} ${ampm}`;
    }
    return `${datePart}${t?.dateTimeSeparator ?? ', '}${timePart}`;
  }

  // Chart preview math — same as the admin live preview.
  zonePctLeft(chart: ResolvedReportLayout['sections'][number]['chart'], z: { from: number }): number {
    if (!chart || chart.max <= chart.min) return 0;
    return Math.max(0, Math.min(100, ((z.from - chart.min) / (chart.max - chart.min)) * 100));
  }
  zonePctWidth(chart: ResolvedReportLayout['sections'][number]['chart'], z: { from: number; to: number }): number {
    if (!chart || chart.max <= chart.min) return 0;
    return Math.max(0, Math.min(100, ((z.to - z.from) / (chart.max - chart.min)) * 100));
  }
  markerPct(chart: ResolvedReportLayout['sections'][number]['chart']): number {
    if (!chart || chart.value === null || chart.value === undefined || chart.max <= chart.min) return 0;
    return Math.max(0, Math.min(100, ((chart.value - chart.min) / (chart.max - chart.min)) * 100));
  }
  zoneHex(token: string): string {
    if (token === 'red')    return '#fecaca';
    if (token === 'orange') return '#fed7aa';
    if (token === 'green')  return '#bbf7d0';
    return token.startsWith('#') ? token : '#e2e8f0';
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.back(); return; }
    this.api.get<Report>(`/api/reports/${id}`).subscribe({
      next: r => {
        this._report.set(r);
        this.resolveLayouts();
      },
      error: () => this.toasts.error('Could not load report')
    });
    this.api.get<ReportTemplate>('/api/config/report-template').subscribe({ next: t => this._tpl.set(t) });
  }

  /** Build the report PDF (identical to Download) and paint its pages onto
   *  canvases inside the viewer. Cached: repeated calls reuse the blob. */
  async renderPdfView() {
    const r = this._report();
    if (!r || this._pdfRendering) return;
    this._pdfRendering = true;
    this._pdfError.set(null);
    this._pdfReady.set(false);
    try {
      this._pdfBlob ??= await this.buildPdfBlob(r);
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';
      const doc = await pdfjs.getDocument({ data: await this._pdfBlob.arrayBuffer() }).promise;

      const host = this.pdfPagesEl()?.nativeElement;
      if (!host) return;
      host.querySelectorAll('canvas').forEach(c => c.remove());

      // Render at the container width × devicePixelRatio (capped ×3) so text
      // stays crisp on retina/mobile; CSS scales each canvas back to 100%.
      const cssWidth = Math.max(host.clientWidth || 0, 320);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = (cssWidth / base.width) * dpr;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className = 'pf-rv-pdfpage';
        canvas.setAttribute('aria-label', `Report page ${i} of ${doc.numPages}`);
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        host.appendChild(canvas);
      }
      this._pdfReady.set(true);
    } catch (err) {
      console.error('[report-viewer] PDF render failed', err);
      this._pdfError.set('Could not render the report PDF.');
    } finally {
      this._pdfRendering = false;
    }
  }

  /** Walk every test on the report and ask the engine to resolve its
   *  layout against the actual entered values. Skips tests without a
   *  configured layout (empty sections) so the legacy table fallback
   *  renders. Image URLs aren't yet plumbed through the result model
   *  on the report endpoint — passed as empty until that lands.
   *
   *  Tests live inside the parsed `data` blob (same JSON the rest of
   *  this view renders from) — not on the raw Report API response. */
  private async resolveLayouts() {
    const tests = this.data()?.tests ?? [];
    if (tests.length === 0) return;

    const p = this.data()?.patient;
    const patient = { sex: p?.sex ?? null, age: p?.age ?? null };
    const next: Record<string, ResolvedReportLayout> = {};
    await Promise.all(tests.map(async t => {
      const values = (t.result?.values ?? {}) as Record<string, unknown>;
      try {
        const pv = await this.layoutSvc.preview(t.testId, values, [], patient);
        next[t.testId] = pv;
      } catch {
        /* test without a configured layout — fallback table will render */
      }
    }));
    this._resolved.set(next);
  }

  back() { this.router.navigateByUrl('/reports'); }

  /** Print the SAME PDF the viewer shows / Download produces. Native shell:
   *  hand the file to the share sheet (it has Print). Web: open the PDF in a
   *  new tab — the browser's PDF viewer prints it verbatim, unlike
   *  window.print() which would rasterize the app shell. */
  async print() {
    const r = this._report();
    if (!r) return;
    try {
      this._pdfBlob ??= await this.buildPdfBlob(r);
      const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor?.isNativePlatform?.();
      const file = new File([this._pdfBlob], `report-${r.id.replace(/-/g, '').slice(-8).toUpperCase()}.pdf`,
        { type: 'application/pdf' });
      if (isNative && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Print report' });
      } else {
        const url = URL.createObjectURL(this._pdfBlob);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return; // share sheet dismissed
      console.error('[report-viewer] print failed', err);
      this.toasts.error('Could not prepare the report for printing');
    }
  }

  /** Deliver via WhatsApp using the click-to-chat deep link (wa.me). The
   *  Meta WhatsApp API isn't wired up yet, so we open WhatsApp Web / app
   *  with the patient's number and a pre-filled message that carries the
   *  report's QR verify link — the recipient taps it to open & download the
   *  PDF. (wa.me cannot auto-attach files, so the link stands in for the
   *  attachment.) We still record the delivery best-effort so the queue
   *  reflects it. */
  deliverWhatsApp() {
    const r = this._report();
    const d = this.data();
    if (!r) return;
    const lab = this.tpl()?.labName || 'our lab';
    const name = d?.patient?.name ?? '';
    const link = r.qrToken ? this.verifyCode(r.qrToken) : '';
    const lines = [
      name ? `Hi ${name},` : 'Hi,',
      `Your lab report from ${lab} is ready.`,
    ];
    if (link) lines.push(`View & download your report:\n${link}`);
    lines.push('Please contact us if you have any questions.');
    // Render + archive the PDF (best-effort, background) so the public link
    // resolves to a real file when the patient opens it. Fire before the
    // synchronous window.open so the popup isn't blocked.
    if (r.qrToken) this.archiveReportPdf(r);
    const url = waLink(d?.patient?.phone, lines.join('\n\n'));
    window.open(url, '_blank', 'noopener');
    this.api.post(`/api/reports/${r.id}/deliver`, { via: 'whatsapp', note: 'wa.me link' }).subscribe({
      next: () => this.toasts.success('Opened WhatsApp with the report link'),
      error: () => this.toasts.info('Opened WhatsApp with the report link'),
    });
  }

  /** Render the report to the SAME PDF the Download button in the queue
   *  produces (jsPDF + tenant template + per-test resolved layouts + images).
   *  Single source for the inline view, Print and the archive upload. */
  private async buildPdfBlob(r: Report): Promise<Blob> {
    const [{ buildReportPdf, preloadReportImages }, { ReportLayoutService }, { PlatformService }] = await Promise.all([
      import('../../../shared/utils/report-pdf'),
      import('../../../core/services/report-layout.service'),
      import('../../../core/services/platform.service'),
    ]);
    const svc = this.injector.get(ReportLayoutService);
    const platform = this.injector.get(PlatformService);
    const resolvedLayouts: Record<string, import('../../../shared/models/report-layout.model').ResolvedReportLayout> = {};

    let tests: Array<{ testId?: string; result?: { values?: Record<string, unknown> } }> = [];
    let patient: { sex?: string | null; age?: number | null } | undefined;
    try {
      const snap = JSON.parse(r.data ?? '{}');
      tests = snap?.tests ?? [];
      patient = { sex: snap?.patient?.sex ?? null, age: snap?.patient?.age ?? null };
    } catch { /* malformed snapshot — render without layouts */ }

    const [template] = await Promise.all([
      this.api.get<ReportTemplate | null>('/api/config/report-template').toPromise().catch(() => null),
      ...tests.map(async t => {
        if (!t.testId) return;
        try {
          resolvedLayouts[t.testId] = await svc.preview(t.testId, (t.result?.values ?? {}) as Record<string, unknown>, [], patient);
        } catch { /* fallback table */ }
      }),
    ]);

    const baseInput = { report: r, resolvedLayouts, template: template ?? null };
    const [imageCache, trendograms] = await Promise.all([
      preloadReportImages(baseInput, platform.getApiUrl()),
      (await import('../../../shared/utils/trendogram-report')).prepareTrendograms(r, this.api),
    ]);
    return buildReportPdf({ ...baseInput, imageCache, trendograms }).output('blob');
  }

  /** Render + archive the report PDF to storage (best-effort, no download) so
   *  the public /reports/public/{qrToken} link resolves to a real file. */
  private async archiveReportPdf(r: Report) {
    try {
      this._pdfBlob ??= await this.buildPdfBlob(r);
      const fd = new FormData();
      fd.append('file', this._pdfBlob, `${r.id}.pdf`);
      this.api.post(`/api/reports/${r.id}/pdf`, fd).subscribe({ next: () => {}, error: () => {} });
    } catch { /* best-effort */ }
  }
}
