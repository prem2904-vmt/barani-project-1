import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Report, ReportTemplate } from '../../../shared/models/report.model';
import { LogoMarkComponent } from '../../../shared/primitives/logo-mark.component';

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
  imports: [DatePipe, LogoMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-8 max-w-4xl">
      <header class="flex items-center justify-between mb-4 print:hidden">
        <button class="text-xs text-slate-500 hover:text-slate-900" (click)="back()">← Back to queue</button>
        <div class="flex gap-2">
          <button class="pf-btn pf-btn-ghost" (click)="print()">🖨 Print</button>
          <button class="pf-btn pf-btn-primary" (click)="deliverWhatsApp()">Send WhatsApp</button>
        </div>
      </header>

      @if (report(); as r) {
        <article class="pf-card">
          <div class="flex items-center justify-between pb-3 border-b" [style.border-color]="tpl()?.primaryColor ?? '#1B3A6B'">
            <div class="flex items-center gap-3">
              @if (tpl()?.logoUrl && tpl()?.logoUrl !== '/logo.svg') {
                <img [src]="tpl()?.logoUrl" alt="" class="h-12 w-12 object-contain" />
              } @else {
                <pf-logo-mark size="lg" variant="badge"></pf-logo-mark>
              }
              <div>
                <p class="text-lg font-semibold" [style.color]="tpl()?.primaryColor ?? '#1B3A6B'">{{ tpl()?.labName ?? 'Prefrontal Lab' }}</p>
                <p class="text-xs text-slate-500">{{ tpl()?.tagline ?? '' }}</p>
              </div>
            </div>
            @if (tpl()?.nablAccredited) {
              <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                NABL {{ tpl()?.nablNumber ?? '—' }}
              </span>
            }
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs mt-3">
            @if (tpl()?.showPatientName !== false && data()?.patient?.name) {
              <div><span class="text-slate-500">Patient:</span> <strong>{{ data()?.patient?.name }}</strong></div>
            }
            @if (tpl()?.showAge !== false) {
              <div><span class="text-slate-500">Age / Sex:</span> {{ data()?.patient?.age }}y · {{ data()?.patient?.sex }}</div>
            }
            @if (tpl()?.showOrderId !== false) {
              <div><span class="text-slate-500">Order:</span> {{ data()?.order?.id?.slice(0, 8) }}</div>
            }
            @if (tpl()?.showRefDoctor !== false && data()?.order?.refDoctorName) {
              <div><span class="text-slate-500">Ref Dr:</span> {{ data()?.order?.refDoctorName }}</div>
            }
            @if (tpl()?.showCollectionDate !== false && data()?.order?.createdAt) {
              <div><span class="text-slate-500">Collected:</span> {{ data()?.order?.createdAt | date:'medium' }}</div>
            }
            @if (tpl()?.showReportDate !== false) {
              <div><span class="text-slate-500">Reported:</span> {{ r.createdAt | date:'medium' }}</div>
            }
          </div>

          <div class="mt-5 space-y-4">
            @for (group of groupedTests(); track group.department) {
              <div>
                <h3 class="text-sm font-semibold border-b pb-1 mb-2"
                    [style.border-color]="tpl()?.primaryColor ?? '#1B3A6B'">
                  {{ group.department }}
                </h3>
                @for (t of group.tests; track t.testId) {
                  <div class="mb-3">
                    <p class="text-sm font-medium">{{ t.name }}</p>
                    @if (paramRows(t).length > 0) {
                      <table class="w-full text-xs mt-1">
                        <thead class="text-slate-500 text-left">
                          <tr><th class="py-0.5">Parameter</th><th class="py-0.5 text-right">Value</th></tr>
                        </thead>
                        <tbody>
                          @for (p of paramRows(t); track p.name) {
                            <tr class="border-t border-slate-100">
                              <td class="py-0.5">{{ p.name }}</td>
                              <td class="py-0.5 text-right"
                                  [class.text-red-600]="p.critical && tpl()?.showCriticalFlag !== false"
                                  [class.font-semibold]="p.critical">
                                {{ p.value }} <span class="text-slate-400">{{ p.unit ?? '' }}</span>
                                @if (p.critical && tpl()?.showCriticalFlag !== false) { <span class="ml-1 text-[10px]">CRITICAL</span> }
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    } @else {
                      <p class="text-xs text-slate-500 italic">No values recorded.</p>
                    }
                  </div>
                }
              </div>
            }
          </div>

          @if (tpl()?.showSignature !== false) {
            <div class="mt-10 flex justify-between items-end">
              <p class="text-[10px] text-slate-500 max-w-xs">{{ tpl()?.disclaimer }}</p>
              <div class="text-right">
                <div class="h-10 border-b border-slate-400 w-40 mb-1"></div>
                @if (tpl()?.showPathologistName !== false) { <p class="text-xs">Dr. Pathologist, MD</p> }
              </div>
            </div>
          }

          @if (tpl()?.showQrCode !== false && r.qrToken) {
            <div class="mt-4 text-center">
              <div class="inline-block text-[10px] text-slate-500 font-mono">
                Verify online: /reports/public/{{ r.qrToken.slice(0, 10) }}…
              </div>
            </div>
          }

          @if (tpl()?.showPoweredBy !== false) {
            <p class="text-center text-[10px] text-slate-400 mt-3">Powered by Prefrontal</p>
          }
        </article>
      } @else {
        <div class="pf-card text-sm text-slate-500">Loading…</div>
      }
    </section>
  `,
  styles: [`
    @media print {
      :host { background: white; }
      .pf-btn, header { display: none !important; }
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
      name, value: String(value), unit: undefined as string | undefined, critical: false
    }));
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.back(); return; }
    this.api.get<Report>(`/api/reports/${id}`).subscribe({ next: r => this._report.set(r) });
    this.api.get<ReportTemplate>('/api/config/report-template').subscribe({ next: t => this._tpl.set(t) });
  }

  back() { this.router.navigateByUrl('/reports'); }

  print() { window.print(); }

  deliverWhatsApp() {
    const r = this._report();
    if (!r) return;
    this.api.post(`/api/reports/${r.id}/deliver`, { via: 'whatsapp', note: null }).subscribe({
      next: () => this.toasts.success('Delivered via WhatsApp (demo)')
    });
  }
}
