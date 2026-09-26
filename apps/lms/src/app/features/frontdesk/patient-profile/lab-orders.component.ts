import {
  ChangeDetectionStrategy, Component, Injector, OnDestroy, computed, inject, input, signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Order, OrderTest } from '../../../shared/models/order.model';
import { buildReportBlobUrl } from '../../../shared/utils/report-blob';
import { PdfCanvasComponent } from './pdf-canvas.component';
import { parseResultSnapshot, savedValueRows } from '../../../shared/utils/result-flag';

interface ResultRow { title: string; value: string; unit?: string; range?: string; flag: 'normal' | 'abnormal' | 'critical'; }

/**
 * Lab Orders — a patient's diagnostic orders as dated, collapsible rows. Each
 * order (repeatable across dates) expands to show its tests and their real
 * digital results (parameter · value · unit · reference range · abnormal flag,
 * parsed from currentResult × the test's parameter definitions), plus a
 * "View report" that renders the generated PDF in place. Filters: from/to date
 * range, quick presets, and a test-name search — all client-side over history().
 */
@Component({
  selector: 'pf-lab-orders',
  standalone: true,
  imports: [DatePipe, DecimalPipe, PdfCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-lo">
      <!-- Filters -->
      <div class="pf-lo__filters">
        <div class="pf-lo__search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" placeholder="Search test / panel…" [value]="search()" (input)="search.set($any($event.target).value)" />
        </div>
        <label class="pf-lo__date">From <input type="date" [value]="fromDate()" (change)="fromDate.set($any($event.target).value)" /></label>
        <label class="pf-lo__date">To <input type="date" [value]="toDate()" (change)="toDate.set($any($event.target).value)" /></label>
        <div class="pf-lo__quick">
          <button type="button" (click)="quick(30)">30d</button>
          <button type="button" (click)="quick(90)">90d</button>
          <button type="button" [class.on]="!fromDate() && !toDate()" (click)="clearRange()">All</button>
        </div>
      </div>

      @if (filtered().length === 0) {
        <div class="pf-lo__empty">No orders match the current filters.</div>
      } @else {
        @for (o of filtered(); track o.id) {
          <div class="pf-lo__card" [class.open]="isOpen(o.id)">
            <!-- Collapsed header row -->
            <button type="button" class="pf-lo__head" (click)="toggle(o.id)">
              <svg class="pf-lo__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              <div class="pf-lo__head-main">
                <span class="pf-lo__date-lbl">{{ o.createdAt | date:'d MMM y' }}<span class="pf-lo__time">{{ o.createdAt | date:'HH:mm' }}</span></span>
                <span class="pf-lo__tests-sum">{{ orderTests(o).length }} test{{ orderTests(o).length === 1 ? '' : 's' }}<span class="pf-lo__dot">·</span>{{ o.refDoctorName || 'Self referral' }}</span>
              </div>
              <span class="pf-lo__chip pf-lo__chip--{{ statusClass(o.status) }}">{{ o.status }}</span>
              @if (o.totalAmount != null) { <span class="pf-lo__amt">₹{{ o.totalAmount | number:'1.0-0' }}</span> }
            </button>

            <!-- Expanded body -->
            @if (isOpen(o.id)) {
              <div class="pf-lo__body">
                <div class="pf-lo__actions">
                  <button type="button" class="pf-lo__act" (click)="repeat(o); $event.stopPropagation()">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
                    Repeat order
                  </button>
                  <button type="button" class="pf-lo__act" (click)="toggleReport(o)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>
                    {{ showReport()[o.id] ? 'Hide report' : 'View report' }}
                  </button>
                </div>

                @for (t of orderTests(o); track t.id) {
                  <div class="pf-lo__test">
                    <div class="pf-lo__test-head">
                      @if (t.test?.code) { <span class="pf-lo__code">{{ t.test?.code }}</span> }
                      <span class="pf-lo__test-name">{{ t.name || 'Test' }}</span>
                      <span class="pf-lo__chip pf-lo__chip--{{ statusClass(t.status) }}">{{ t.status }}</span>
                    </div>
                    @if (resultRows(t); as rows) {
                      @if (rows.length) {
                        <div class="pf-lo__results">
                          <div class="pf-lo__rrow pf-lo__rrow--head">
                            <span>Parameter</span><span>Result</span><span>Reference</span>
                          </div>
                          @for (r of rows; track r.title) {
                            <div class="pf-lo__rrow" [class.abn]="r.flag === 'abnormal'" [class.crit]="r.flag === 'critical'">
                              <span class="pf-lo__rname">{{ r.title }}</span>
                              <span class="pf-lo__rval">{{ r.value }}<span class="pf-lo__runit">{{ r.unit || '' }}</span>@if (r.flag !== 'normal') { <span class="pf-lo__rflag">{{ r.flag === 'critical' ? '‼' : '!' }}</span> }</span>
                              <span class="pf-lo__rref">{{ r.range || '—' }}</span>
                            </div>
                          }
                        </div>
                      } @else {
                        <p class="pf-lo__pending">Results not entered yet.</p>
                      }
                    }
                  </div>
                }

                <!-- In-place report -->
                @if (showReport()[o.id]) {
                  <div class="pf-lo__report">
                    @if (reportBusy() === o.id) { <span class="pf-lo__spin"></span> }
                    @else if (reportUrl()[o.id]; as u) { <pf-pdf-canvas [src]="u"></pf-pdf-canvas> }
                    @else { <p class="pf-lo__pending">No report has been generated for this order yet.</p> }
                  </div>
                }
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .pf-lo { display: flex; flex-direction: column; gap: 10px; }
    .pf-lo__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 2px; }
    .pf-lo__search { display: flex; align-items: center; gap: 7px; padding: 7px 10px; border-radius: 9px; background: var(--input-bg, rgba(255,255,255,0.04)); border: 1px solid var(--glass-border); color: var(--text-tertiary); flex: 1 1 200px; min-width: 0; }
    .pf-lo__search input { flex: 1; min-width: 0; background: none; border: 0; outline: none; color: var(--text-primary); font-size: 13px; }
    .pf-lo__date { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
    .pf-lo__date input { background: var(--input-bg, rgba(255,255,255,0.04)); border: 1px solid var(--glass-border); border-radius: 8px; padding: 6px 8px; color: var(--text-primary); font-size: 12.5px; color-scheme: dark; }
    .pf-lo__quick { display: inline-flex; gap: 4px; }
    .pf-lo__quick button { padding: 6px 10px; border-radius: 8px; font-size: 11.5px; font-weight: 600; cursor: pointer; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); }
    .pf-lo__quick button.on, .pf-lo__quick button:hover { border-color: rgba(168,85,247,0.45); color: var(--text-primary); }

    .pf-lo__empty { padding: 28px; text-align: center; color: var(--text-tertiary); font-size: 13px; background: var(--bg-card-solid); border: 1px solid var(--glass-border); border-radius: 14px; }

    .pf-lo__card { border: 1px solid var(--glass-border); border-radius: 14px; background: var(--bg-card-solid); overflow: hidden; }
    .pf-lo__card.open { border-color: rgba(168,85,247,0.35); }
    .pf-lo__head { width: 100%; display: flex; align-items: center; gap: 12px; padding: 13px 16px; background: none; border: 0; cursor: pointer; text-align: left; }
    .pf-lo__chev { flex-shrink: 0; color: var(--text-tertiary); transition: transform .15s; }
    .pf-lo__card.open .pf-lo__chev { transform: rotate(90deg); color: #a855f7; }
    .pf-lo__head-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-lo__date-lbl { font-size: 14px; font-weight: 700; color: var(--text-primary); }
    .pf-lo__time { font-size: 11px; font-weight: 500; color: var(--text-tertiary); margin-left: 8px; }
    .pf-lo__tests-sum { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-lo__dot { margin: 0 6px; color: var(--text-tertiary); }
    .pf-lo__amt { font-size: 13px; font-weight: 700; color: var(--text-primary); flex-shrink: 0; }
    .pf-lo__chip { flex-shrink: 0; font-size: 10.5px; font-weight: 700; text-transform: capitalize; padding: 2px 9px; border-radius: 999px; }
    .pf-lo__chip--ok { background: rgba(16,185,129,0.14); color: var(--green-text); border: 1px solid rgba(16,185,129,0.3); }
    .pf-lo__chip--bad { background: rgba(239,68,68,0.14); color: var(--red-text); border: 1px solid rgba(239,68,68,0.3); }
    .pf-lo__chip--wait { background: rgba(245,158,11,0.14); color: var(--amber-text); border: 1px solid rgba(245,158,11,0.3); }

    .pf-lo__body { padding: 0 16px 14px; border-top: 1px solid var(--border-muted, var(--glass-border)); }
    .pf-lo__actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 0; }
    .pf-lo__act { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); }
    .pf-lo__act:hover { color: var(--text-primary); border-color: rgba(168,85,247,0.4); }

    .pf-lo__test { padding: 10px 0; border-top: 1px dashed var(--glass-border); }
    .pf-lo__test:first-of-type { border-top: 0; }
    .pf-lo__test-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .pf-lo__code { font-family: monospace; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 5px; background: rgba(168,85,247,0.14); color: var(--violet-text); }
    .pf-lo__test-name { font-size: 13px; font-weight: 600; color: var(--text-primary); flex: 1; min-width: 0; }
    .pf-lo__pending { font-size: 12px; color: var(--text-tertiary); padding: 4px 0; }

    .pf-lo__results { border: 1px solid var(--glass-border); border-radius: 10px; overflow: hidden; }
    .pf-lo__rrow { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 8px; padding: 7px 12px; font-size: 12.5px; align-items: center; }
    .pf-lo__rrow:nth-child(odd) { background: rgba(255,255,255,0.02); }
    .pf-lo__rrow--head { background: rgba(255,255,255,0.04); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }
    .pf-lo__rname { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; }
    .pf-lo__rval { font-family: monospace; font-weight: 700; color: var(--text-primary); }
    .pf-lo__runit { font-weight: 500; color: var(--text-tertiary); margin-left: 4px; font-size: 11px; }
    .pf-lo__rref { font-family: monospace; font-size: 11.5px; color: var(--text-tertiary); white-space: pre-line; }
    .pf-lo__rrow.abn .pf-lo__rval { color: var(--amber-text); }
    .pf-lo__rrow.crit .pf-lo__rval { color: var(--rose-text); }
    .pf-lo__rflag { margin-left: 5px; font-weight: 800; }
    .pf-lo__rrow.abn { background: rgba(245,158,11,0.06); }
    .pf-lo__rrow.crit { background: rgba(251,113,133,0.08); }

    .pf-lo__report { margin-top: 12px; padding: 10px; border: 1px solid var(--glass-border); border-radius: 12px; background: rgba(255,255,255,0.02); display: flex; justify-content: center; }
    .pf-lo__report pf-pdf-canvas { width: 100%; max-width: 820px; }
    .pf-lo__spin { width: 26px; height: 26px; border-radius: 50%; border: 2.5px solid rgba(168,85,247,0.3); border-top-color: #a855f7; animation: pf-lo-spin .7s linear infinite; margin: 24px; }
    @keyframes pf-lo-spin { to { transform: rotate(360deg); } }

    @media (max-width: 640px) {
      .pf-lo__filters { gap: 6px; }
      .pf-lo__search { flex: 1 1 100%; }
      .pf-lo__rrow { grid-template-columns: 1.3fr 1fr; }
      .pf-lo__rref { display: none; }
    }
  `],
})
export class LabOrdersComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  readonly orders = input<Order[]>([]);
  readonly patientId = input<string>('');

  readonly search = signal('');
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly expanded = signal<Record<string, boolean>>({});
  readonly showReport = signal<Record<string, boolean>>({});
  readonly reportUrl = signal<Record<string, string>>({});
  readonly reportBusy = signal<string | null>(null);
  private readonly blobUrls = new Set<string>();

  readonly filtered = computed<Order[]>(() => {
    const from = this.fromDate(), to = this.toDate(), q = this.search().trim().toLowerCase();
    return (this.orders() ?? []).filter(o => {
      const d = (o.createdAt || '').slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (q) { const names = this.orderTests(o).map(t => (t.name || '').toLowerCase()).join(' '); if (!names.includes(q)) return false; }
      return true;
    }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  });

  orderTests(o: Order): OrderTest[] { return (o.samples ?? []).flatMap(s => s.tests ?? []); }
  isOpen(id: string): boolean { return !!this.expanded()[id]; }
  toggle(id: string) { this.expanded.update(m => ({ ...m, [id]: !m[id] })); }

  statusClass(status: string): 'ok' | 'bad' | 'wait' {
    const s = (status || '').toLowerCase();
    if (/(complete|validated|dispatched|done|resulted|delivered|reported|paid)/.test(s)) return 'ok';
    if (/(cancel|reject|fail|unpaid)/.test(s)) return 'bad';
    return 'wait';
  }

  /** Parse a test's entered values × its parameter defs → per-parameter rows,
   *  flagged with the verdict mw SAVED with the result (no browser recompute). */
  resultRows(t: OrderTest): ResultRow[] {
    const snap = parseResultSnapshot(t.currentResult);
    if (!snap?.values) return [];
    const show = (v: unknown) => v === undefined || v === null || v === '' ? '—' : String(v);
    const rows = savedValueRows(t.currentResult, t.test?.parameters);
    if (rows.length) {
      return rows.map(r => ({ title: r.title, value: show(r.value), unit: r.unit, range: r.range, flag: r.flag }));
    }
    // Fallback: no parameter defs available — show the raw entered values.
    return Object.entries(snap.values).map(([k, v]) => ({
      title: k, value: show(v), flag: 'normal' as const,
    }));
  }

  // Filters
  quick(days: number) {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - days);
    this.fromDate.set(from.toISOString().slice(0, 10));
    this.toDate.set(to.toISOString().slice(0, 10));
  }
  clearRange() { this.fromDate.set(''); this.toDate.set(''); }

  repeat(o: Order) {
    this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: this.patientId(), fromOrderId: o.id } });
  }

  async toggleReport(o: Order) {
    const show = !this.showReport()[o.id];
    this.showReport.update(m => ({ ...m, [o.id]: show }));
    if (show && !this.reportUrl()[o.id] && this.reportBusy() !== o.id) {
      this.reportBusy.set(o.id);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rep = await firstValueFrom(this.api.get<any>(`/api/reports/by-order/${o.id}`)).catch(() => null);
        if (rep) {
          const url = await buildReportBlobUrl(rep, this.api, this.injector);
          if (url) { this.blobUrls.add(url); this.reportUrl.update(m => ({ ...m, [o.id]: url })); }
        }
      } finally { this.reportBusy.set(null); }
    }
  }

  ngOnDestroy() { for (const u of this.blobUrls) { try { URL.revokeObjectURL(u); } catch { /* */ } } }
}
