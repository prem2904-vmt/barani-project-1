import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { Report, ReportTemplate } from '../../../shared/models/report.model';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { LogoMarkComponent } from '../../../shared/primitives/logo-mark.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface ReportData {
  patient?: { name?: string; age?: number; sex?: string; phone?: string };
  order?: { id?: string; createdAt?: string; priority?: string; refDoctorName?: string };
  tests?: Array<{
    testId: string;
    name?: string;
    department?: string;
    status?: string;
    result?: { values?: Record<string, unknown>; note?: string; flags?: { critical?: boolean } };
    resultedAt?: string;
    validatedAt?: string;
  }>;
}

@Component({
  selector: 'pf-report-viewer',
  standalone: true,
  imports: [
    DatePipe,
    BarcodeDisplayComponent,
    ChipComponent,
    LogoMarkComponent,
    ScreenHeaderComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-12 pf-report-section">
      <pf-screen-header
        eyebrow="Reports"
        title="Report viewer"
        [subtitle]="subtitle()">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
        @if (report()) {
          <pf-touch-btn actions size="sm" variant="secondary" (pressed)="print()">
            <span icon-left aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"/>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
            </span>
            Print
          </pf-touch-btn>
        }
        @if (report()) {
          <pf-touch-btn actions size="sm" variant="primary" (pressed)="deliverWhatsApp()">
            <span icon-left aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m22 2-7 20-4-9-9-4Z"/>
                <path d="M22 2 11 13"/>
              </svg>
            </span>
            Send WhatsApp
          </pf-touch-btn>
        }
      </pf-screen-header>

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

        <!-- The printable paper. White background kept so print output is clean. -->
        <article class="pf-paper" aria-label="Report body">
          <div class="pf-paper__masthead" [style.border-color]="tpl()?.primaryColor ?? '#1B3A6B'">
            <div class="flex items-center gap-3">
              @if (tpl()?.logoUrl && tpl()?.logoUrl !== '/logo.svg') {
                <img [src]="tpl()?.logoUrl" alt="" class="h-12 w-12 object-contain" />
              } @else {
                <pf-logo-mark size="lg" variant="badge"></pf-logo-mark>
              }
              <div>
                <p class="pf-paper__lab" [style.color]="tpl()?.primaryColor ?? '#1B3A6B'">
                  {{ tpl()?.labName ?? 'Prefrontal Lab' }}
                </p>
                <p class="pf-paper__tagline">{{ tpl()?.tagline ?? '' }}</p>
              </div>
            </div>
            @if (tpl()?.nablAccredited) {
              <span class="pf-paper__nabl">NABL {{ tpl()?.nablNumber ?? '—' }}</span>
            }
          </div>

          <dl class="pf-paper__meta">
            @if (tpl()?.showPatientName !== false && data()?.patient?.name) {
              <div><dt>Patient</dt><dd><strong>{{ data()?.patient?.name }}</strong></dd></div>
            }
            @if (tpl()?.showAge !== false) {
              <div><dt>Age · Sex</dt><dd>{{ data()?.patient?.age ?? '—' }}y · {{ data()?.patient?.sex ?? '—' }}</dd></div>
            }
            @if (tpl()?.showOrderId !== false && data()?.order?.id) {
              <div><dt>Order</dt><dd class="pf-mono">{{ data()?.order?.id?.slice(0, 8) }}</dd></div>
            }
            @if (tpl()?.showRefDoctor !== false && data()?.order?.refDoctorName) {
              <div><dt>Ref doctor</dt><dd>{{ data()?.order?.refDoctorName }}</dd></div>
            }
            @if (tpl()?.showCollectionDate !== false && data()?.order?.createdAt) {
              <div><dt>Collected</dt><dd>{{ data()?.order?.createdAt | date:'medium' }}</dd></div>
            }
            @if (tpl()?.showReportDate !== false) {
              <div><dt>Reported</dt><dd>{{ r.createdAt | date:'medium' }}</dd></div>
            }
          </dl>

          <div class="pf-paper__body">
            @for (group of groupedTests(); track group.department) {
              <section class="pf-paper__group">
                <h3 class="pf-paper__dept" [style.border-color]="tpl()?.primaryColor ?? '#1B3A6B'">
                  {{ group.department }}
                </h3>

                @for (t of group.tests; track t.testId) {
                  <div class="pf-paper__test">
                    <div class="flex items-baseline justify-between flex-wrap gap-2">
                      <p class="pf-paper__test-name">{{ t.name }}</p>
                      @if (t.result?.flags?.critical) {
                        <span class="pf-paper__crit-chip">CRITICAL</span>
                      }
                      @if (t.validatedAt) {
                        <span class="pf-paper__test-meta">
                          Validated {{ t.validatedAt | date:'shortDate' }}
                        </span>
                      }
                    </div>

                    @if (paramRows(t).length > 0) {
                      <table class="pf-paper__table">
                        <thead>
                          <tr>
                            <th>Parameter</th>
                            <th class="text-right">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (p of paramRows(t); track p.name) {
                            <tr>
                              <td>{{ p.name }}</td>
                              <td class="text-right pf-mono"
                                  [class.pf-paper__val--crit]="t.result?.flags?.critical && tpl()?.showCriticalFlag !== false">
                                {{ p.value }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    } @else {
                      <p class="pf-paper__empty">No values recorded.</p>
                    }

                    @if (t.result?.note) {
                      <p class="pf-paper__note">{{ t.result?.note }}</p>
                    }
                  </div>
                }
              </section>
            } @empty {
              <p class="pf-paper__empty">No tests on this report.</p>
            }
          </div>

          <footer class="pf-paper__footer">
            @if (tpl()?.showSignature !== false) {
              <div class="pf-paper__sig">
                <p class="pf-paper__disclaimer">{{ tpl()?.disclaimer }}</p>
                <div class="pf-paper__sig-line">
                  <div class="pf-paper__sig-rule"></div>
                  @if (tpl()?.showPathologistName !== false) {
                    <p>Dr. Pathologist, MD</p>
                  }
                </div>
              </div>
            }

            @if (tpl()?.showQrCode !== false && r.qrToken) {
              <div class="pf-paper__qr">
                <pf-barcode-display [code]="verifyCode(r.qrToken)"></pf-barcode-display>
                <p class="pf-paper__qr-caption">Scan to verify online</p>
              </div>
            }
          </footer>

          @if (tpl()?.showPoweredBy !== false) {
            <p class="pf-paper__powered">Powered by Prefrontal</p>
          }
        </article>
      } @else {
        <div class="pf-rv-loading">
          <p>Loading report…</p>
        </div>
      }
    </section>
  `,
  styles: [`
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
      }
      .pf-report-section { padding: 0 !important; max-width: none !important; }
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
  `]
})
export class ReportViewerComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _report = signal<Report | null>(null);
  private readonly _tpl = signal<ReportTemplate | null>(null);
  readonly report = this._report.asReadonly();
  readonly tpl = this._tpl.asReadonly();

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

  paramRows(t: { result?: { values?: Record<string, unknown> } }) {
    const vals = t.result?.values ?? {};
    return Object.entries(vals).map(([name, value]) => ({
      name,
      value: value == null || value === '' ? '—' : String(value)
    }));
  }

  verifyCode(token: string): string {
    return `${window.location.origin}/reports/public/${token}`;
  }

  deliveryTone(status: string | undefined): ChipTone {
    if (status === 'delivered') return 'emerald';
    if (status === 'failed')    return 'rose';
    if (status === 'pending')   return 'amber';
    return 'default';
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.back(); return; }
    this.api.get<Report>(`/api/reports/${id}`).subscribe({
      next: r => this._report.set(r),
      error: () => this.toasts.error('Could not load report')
    });
    this.api.get<ReportTemplate>('/api/config/report-template').subscribe({ next: t => this._tpl.set(t) });
  }

  back() { this.router.navigateByUrl('/reports'); }

  print() { window.print(); }

  deliverWhatsApp() {
    const r = this._report();
    if (!r) return;
    this.api.post(`/api/reports/${r.id}/deliver`, { via: 'whatsapp', note: null }).subscribe({
      next: () => this.toasts.success('Delivered via WhatsApp'),
      error: e => this.toasts.error(e.message ?? 'Delivery failed')
    });
  }
}
