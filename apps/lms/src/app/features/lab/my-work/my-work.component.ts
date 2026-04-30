import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { DelegateModalComponent } from './delegate-modal.component';
import { ReceiveSamplesComponent } from '../receive-samples/receive-samples.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { NumPadComponent } from '../../../shared/primitives/num-pad.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { Department } from '../../../shared/models/tenant.model';
import { OrderTest } from '../../../shared/models/order.model';

const LAST_DEPT_KEY = 'pf-lms.my-work.last-dept-code';

type Tab = 'intake' | 'my_work' | 'service_queue' | 'rejected';
type Level = 'urgent' | 'high' | 'normal';
type Bucket = { level: Level; items: Enriched[] };
type Enriched = OrderTest & { _level: Level; _remainingMin: number };

interface CounterSpec {
  id: 'pending' | 'critical' | 'in_progress' | 'done' | 'all';
  label: string;
  tone: 'amber' | 'rose' | 'violet' | 'emerald' | 'default';
  subtitle?: string;
}

const COUNTERS: CounterSpec[] = [
  { id: 'pending', label: 'Pending', tone: 'amber', subtitle: 'Awaiting intake' },
  { id: 'critical', label: 'Critical', tone: 'rose', subtitle: 'Urgent priority' },
  { id: 'in_progress', label: 'In progress', tone: 'violet', subtitle: 'Currently running' },
  { id: 'done', label: 'Done today', tone: 'emerald', subtitle: 'Completed' },
  { id: 'all', label: 'All', tone: 'default', subtitle: 'Total items' }
];

@Component({
  selector: 'pf-my-work',
  standalone: true,
  imports: [
    DatePipe, FormsModule, BarcodeScannerModalComponent, DelegateModalComponent, TatIndicatorComponent,
    AvatarComponent, NumPadComponent, ReceiveSamplesComponent, ScreenHeaderComponent, SegmentedComponent, SelectComponent, SkeletonComponent, TileComponent, TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './my-work.component.html',
  styleUrls: ['./my-work.component.scss']
})
export class MyWorkComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  // Rejected tab dropped — re-entry rows now show inline in My Work
  // with their rejection reason in the tube tile, so the tech sees WHY
  // the pathologist sent it back without switching tabs.
  readonly tabOptions = [
    { value: 'intake' as Tab, label: 'Lab Intake' },
    { value: 'my_work' as Tab, label: 'My Work' },
    { value: 'service_queue' as Tab, label: 'Service Queue' }
  ];
  readonly counters = COUNTERS;

  private readonly _tab = signal<Tab>('my_work');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) { this._tab.set(t); this.refresh(); }

  private readonly _counter = signal<CounterSpec['id']>('all');
  readonly counter = this._counter.asReadonly();
  setCounter(c: CounterSpec['id']) { this._counter.set(c); }

  private readonly _scan = signal<string>('');
  readonly scan = this._scan.asReadonly();
  setScan(v: string) { this._scan.set(v); }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  // ── Manual barcode entry ─────────────────────────────────────────────
  private readonly auth = inject(AuthService);
  private readonly tenantState = inject(TenantStateService);

  protected readonly manualMode = signal(false);
  protected readonly seqValue = signal('');
  protected readonly departments = signal<Department[]>([]);
  protected readonly selectedDeptCode = signal<string>('');
  protected readonly isTouch = signal<boolean>(
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  );
  readonly currentYear = new Date().getFullYear();

  readonly vendorCode = computed(() => this.tenantState.tenant()?.vendorCode ?? '');

  readonly deptOptions = computed<PfSelectOption<string>[]>(() =>
    this.departments().map(d => ({ value: d.code, label: `${d.code} · ${d.name}` }))
  );

  readonly fullManualBarcode = computed(() => {
    const v = this.vendorCode() || '??';
    const seq = (this.seqValue() || '').padStart(5, '0');
    const d = this.selectedDeptCode() || '——';
    return `PF-${v}-${this.currentYear}-${seq}-${d}`;
  });

  readonly canManualConfirm = computed(() =>
    this.seqValue().length === 5 &&
    !!this.selectedDeptCode() &&
    !!this.vendorCode()
  );

  toggleManual() {
    const next = !this.manualMode();
    this.manualMode.set(next);
    if (next) {
      this.tenantState.ensureLoaded();
      if (this.departments().length === 0) this.loadDepartments();
    }
  }

  onSeqChange(v: string) {
    this.seqValue.set((v ?? '').replace(/\D/g, '').slice(0, 5));
  }

  onDeptChange(code: string) {
    this.selectedDeptCode.set(code);
    try { localStorage.setItem(LAST_DEPT_KEY, code); } catch { /* ignore */ }
  }

  submitManual() {
    if (!this.canManualConfirm()) return;
    const code = this.fullManualBarcode();
    this.setScan(code);
    this.scanSubmit();
    this.seqValue.set('');
  }

  private loadDepartments() {
    const branchId = this.auth.user()?.branchId;
    if (!branchId) return;
    this.api.get<Department[]>(`/api/tenants/departments?branchId=${branchId}`).subscribe({
      next: list => {
        const arr = list ?? [];
        this.departments.set(arr);
        let last = '';
        try { last = localStorage.getItem(LAST_DEPT_KEY) ?? ''; } catch { /* ignore */ }
        const match = arr.find(d => d.code === last);
        if (match) this.selectedDeptCode.set(match.code);
        else if (arr.length > 0) this.selectedDeptCode.set(arr[0].code);
      }
    });
  }

  private readonly _rows = signal<OrderTest[]>([]);
  readonly rows = this._rows.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  private readonly _counts = signal<Record<Tab, number>>({ intake: 0, my_work: 0, service_queue: 0, rejected: 0 });
  countFor(t: Tab): number { return this._counts()[t]; }

  readonly buckets = computed<Bucket[]>(() => {
    const enriched: Enriched[] = this.enrich(this._rows());
    const filtered = this.filterByCounter(enriched);
    return [
      { level: 'urgent' as const, items: filtered.filter(e => e._level === 'urgent') },
      { level: 'high' as const, items: filtered.filter(e => e._level === 'high') },
      { level: 'normal' as const, items: filtered.filter(e => e._level === 'normal') }
    ];
  });

  private enrich(rows: OrderTest[]): Enriched[] {
    return rows.map(t => {
      const ral = t.subOrder?.receivedAtLab;
      const budget = (t.test?.tatHours ?? 0) * 60;
      const elapsed = ral ? (Date.now() - new Date(ral).getTime()) / 60000 : 0;
      const remaining = budget - elapsed;
      const level: Level = remaining <= 0 ? 'urgent' : remaining <= 60 ? 'high' : 'normal';
      return { ...t, _level: level, _remainingMin: remaining };
    });
  }

  /** Counter-tile filter runs on top of the segmented tab filter. */
  private filterByCounter(list: Enriched[]): Enriched[] {
    switch (this._counter()) {
      case 'pending': return list.filter(t => t.status === 'pending' || t.status === 're_entry');
      case 'critical': return list.filter(t => this.isCritical(t));
      case 'in_progress': return list.filter(t => t.status === 'in_progress' || t.status === 'entered');
      case 'done': return list.filter(t => t.status === 'validated' || t.status === 'signed_off');
      default: return list;
    }
  }

  counterValue(id: CounterSpec['id']): number {
    const enriched = this.enrich(this._rows());
    switch (id) {
      case 'pending': return enriched.filter(t => t.status === 'pending' || t.status === 're_entry').length;
      case 'critical': return enriched.filter(t => this.isCritical(t)).length;
      case 'in_progress': return enriched.filter(t => t.status === 'in_progress' || t.status === 'entered').length;
      case 'done': return enriched.filter(t => t.status === 'validated' || t.status === 'signed_off').length;
      default: return enriched.length;
    }
  }

  private isCritical(t: OrderTest): boolean {
    if (!t.currentResult) return false;
    try {
      const snap = JSON.parse(t.currentResult) as { flags?: { critical?: boolean } };
      return snap.flags?.critical === true;
    } catch { return false; }
  }

  /**
   * Group bucket items by orderId so the queue shows one card per patient
   * with all their tests nested inside instead of one floating card per
   * test. The card's TAT level is the worst (most-urgent) of any test in
   * the order so a patient with one breached test isn't buried.
   */
  patientGroups(items: Enriched[]): Array<{
    orderId: string;
    patientName: string;
    items: Enriched[];
    testNames: string[];
    level: Level;
    remainingMin: number;
  }> {
    const byOrder = new Map<string, Enriched[]>();
    for (const t of items) {
      const oid = t.subOrder?.order?.id ?? t.id;
      if (!byOrder.has(oid)) byOrder.set(oid, []);
      byOrder.get(oid)!.push(t);
    }
    const levelRank: Record<Level, number> = { 'urgent': 0, 'high': 1, 'normal': 2 };
    return Array.from(byOrder.entries()).map(([orderId, group]) => {
      const worst = [...group].sort((a, b) => levelRank[a._level] - levelRank[b._level])[0];
      return {
        orderId,
        patientName: worst.subOrder?.order?.patient?.displayName ?? 'Patient',
        items: group,
        testNames: group.map(t => t.test?.name ?? 'Test').slice(0, 4),
        level: worst._level,
        remainingMin: Math.min(...group.map(t => t._remainingMin))
      };
    });
  }

  // Expand/collapse state per order id within My Work.
  private readonly _expanded = signal<Set<string>>(new Set());
  expanded(id: string): boolean { return this._expanded().has(id); }
  toggleExpand(id: string): void {
    const next = new Set(this._expanded());
    if (next.has(id)) next.delete(id); else next.add(id);
    this._expanded.set(next);
  }

  toneFor(level: Level): TileTone {
    return level === 'urgent' ? 'rose' : level === 'high' ? 'amber' : 'default';
  }

  ngOnInit() { this.refresh(); this.refreshAllCounts(); }

  refresh() {
    // Intake tab embeds the ReceiveSamplesComponent which manages its own
    // data; nothing to fetch here.
    if (this._tab() === 'intake') { this._loading.set(false); return; }
    const url = this.endpointFor(this._tab());
    this._loading.set(true);
    this.api.get<OrderTest[]>(url).subscribe({
      next: l => { this._rows.set((l ?? []).filter(t => this.matchesTab(t, this._tab()))); this._loading.set(false); },
      error: () => this._loading.set(false)
    });
  }

  private refreshAllCounts() {
    for (const t of ['my_work', 'service_queue', 'rejected'] as Tab[]) {
      this.api.get<OrderTest[]>(this.endpointFor(t)).subscribe({
        next: l => {
          const count = (l ?? []).filter(x => this.matchesTab(x, t)).length;
          this._counts.update(c => ({ ...c, [t]: count }));
        }
      });
    }
  }

  private endpointFor(t: Tab): string {
    if (t === 'service_queue') return '/api/results/service-queue';
    return '/api/results/my-work';
  }
  private matchesTab(t: OrderTest, tab: Tab): boolean {
    // Rejected tab: focused view, only re_entry rows.
    if (tab === 'rejected') return t.status === 're_entry';
    // My Work tab: every row assigned to the tech that still needs
    // their hands on it — pending (not yet started), in_progress
    // (mid-entry), AND re_entry (pathologist sent it back). Without the
    // re_entry inclusion the original submitter doesn't see their own
    // rejected work in the default landing tab.
    if (tab === 'my_work') return t.status === 'pending' || t.status === 'in_progress' || t.status === 're_entry';
    return true;
  }

  /** Try to resolve a scanned barcode/OrderTest id → jump to result entry. */
  scanSubmit() {
    const q = this._scan().trim();
    if (!q) return;
    // Look for a row whose barcode/id matches the scan. We route through
    // /claim-by-scan so the backend enforces (a) this user is the
    // assignee and (b) the scanned code actually matches the sample —
    // the scan bar is just a faster path to the same gate the modal uses.
    const hit = this._rows().find(r =>
      r.subOrder?.barcode === q ||
      r.id === q ||
      r.subOrder?.id === q
    );
    if (!hit) {
      this.toasts.warning('No match for scan');
      return;
    }
    const scannedBarcode = hit.subOrder?.barcode ?? q;
    this.api.post<OrderTest>(`/api/results/${hit.id}/claim-by-scan`, { barcode: scannedBarcode }).subscribe({
      next: () => { this._scan.set(''); this.enterJustScanned(hit); },
      error: e => this.toasts.error(e.message ?? 'Scan rejected')
    });
  }

  // ── Scan-gated pickup ─────────────────────────────────
  // Clicking the queue action opens the scanner modal with the row's
  // expected barcode. The modal only emits (matched) when the scanned
  // code equals the expected one. Backend /claim-by-scan then verifies
  // the user is actually the assignee (auto-assigned or delegated) —
  // which prevents cross-tech scanning.
  private readonly _scanTarget = signal<OrderTest | null>(null);
  readonly scanTarget = this._scanTarget.asReadonly();
  readonly scanExpected = computed(() => this._scanTarget()?.subOrder?.barcode ?? '');

  startPick(t: OrderTest) {
    if (!t.subOrder?.barcode) {
      this.toasts.warning('This sample has no barcode — ask supervisor to reprint.');
      return;
    }
    this._scanTarget.set(t);
  }

  cancelScan() { this._scanTarget.set(null); }

  // Top-bar camera mode: no expected code, relays decoded value into the
  // scan input and submits via scanSubmit → same claim-by-scan gate.
  private readonly _barScannerOpen = signal(false);
  readonly barScannerOpen = this._barScannerOpen.asReadonly();
  openBarSearchScanner() { this._barScannerOpen.set(true); }
  closeBarSearchScanner() { this._barScannerOpen.set(false); }
  onBarSearchMatched(code: string) {
    this._barScannerOpen.set(false);
    this._scan.set(code);
    this.scanSubmit();
  }

  onScanMatched(code: string) {
    const t = this._scanTarget();
    if (!t) return;
    this.api.post<OrderTest>(`/api/results/${t.id}/claim-by-scan`, { barcode: code }).subscribe({
      next: () => {
        this._scanTarget.set(null);
        this.enterJustScanned(t);
      },
      error: e => this.toasts.error(e.message ?? 'Scan rejected')
    });
  }

  // Sample-level entry (Fix 6 — the tube IS the unit of work). One scan,
  // all tests in the tube on one screen. Falls back to per-test entry only
  // when the row has no sample link (legacy data).
  enter(t: OrderTest) {
    const sid = t.subOrder?.id;
    if (sid) this.router.navigate(['/lab/sample', sid]);
    else this.router.navigate(['/lab/result', t.id]);
  }

  /**
   * Sub-group a patient's OrderTests by their tube (OrderSample). Each
   * tube row carries the sample id, dept name, barcode (for the scan
   * gate), the tests inside, and a pre-computed allDone flag so the UI
   * can render a status pill instead of an Open button when the whole
   * tube is already entered/validated.
   */
  tubesIn(items: Enriched[]): Array<{
    sampleId: string;
    deptName: string;
    barcode: string;
    tests: Enriched[];
    allDone: boolean;
    rejections: Array<{ testName: string; reason: string }>;
  }> {
    const bySample = new Map<string, Enriched[]>();
    for (const t of items) {
      const sid = t.subOrder?.id ?? t.id; // fall back so legacy tests still render
      if (!bySample.has(sid)) bySample.set(sid, []);
      bySample.get(sid)!.push(t);
    }
    return Array.from(bySample.entries()).map(([sampleId, tests]) => {
      const first = tests[0];
      const deptName = first.subOrder?.department?.name ?? first.test?.department?.name ?? '';
      const barcode = first.subOrder?.barcode ?? '';
      const allDone = tests.every(x => x.status === 'entered' || x.status === 'validated');
      // Surface every rejected test's reason so the tile can show a
      // banner explaining WHY the pathologist sent it back. Without this
      // the tech sees only the ↻ icon and has to dig into the test to
      // find out what to fix.
      const rejections = tests
        .filter(x => x.status === 're_entry' && (x.rejectionReason ?? '').trim().length > 0)
        .map(x => ({ testName: x.test?.name ?? 'Test', reason: x.rejectionReason ?? '' }));
      return { sampleId, deptName, barcode, tests, allDone, rejections };
    });
  }

  /**
   * Pick action on a tube row. Uses the existing scan-gated startPick on
   * the first test (so the modal demands the tube barcode) — once the
   * scanner emits matched, onScanMatched ends up calling enterJustScanned
   * which navigates to /lab/sample/:sampleId (Fix 6 sample-level entry).
   * One scan → all tests in the tube open together.
   */
  pickTube(tube: { sampleId: string; barcode: string; tests: Enriched[] }) {
    const probe = tube.tests[0];
    if (!probe) return;
    // Brief tube-fill animation on the tile so the tech sees a clear
    // "picked" cue before the route swaps. ~280ms is long enough to feel
    // intentional but short enough not to block the workflow.
    this._pickingTubeId.set(tube.sampleId);
    setTimeout(() => this._pickingTubeId.set(null), 600);

    if (!tube.barcode) {
      // Fall back to direct nav when there's no barcode to gate on
      // (e.g. samples created by the realignment seeder without a printed
      // label). The user will still see all tests in the tube together.
      this.router.navigate(['/lab/sample', tube.sampleId]);
      return;
    }
    this.startPick(probe);
  }
  private readonly _pickingTubeId = signal<string | null>(null);
  readonly pickingTubeId = this._pickingTubeId.asReadonly();

  private enterJustScanned(t: OrderTest) {
    const sid = t.subOrder?.id;
    if (sid) this.router.navigate(['/lab/sample', sid], { state: { justScanned: true } });
    else this.router.navigate(['/lab/result', t.id], { state: { justScanned: true } });
  }

  // ── Supervisor delegation ─────────────────────────────
  // Thin wrapper over POST /api/results/:id/delegate. The UI gate (who
  // sees the button) is visual-only for now; the backend endpoint is
  // open. Add role-based gating once permission infra lands.
  private readonly _delegateTarget = signal<OrderTest | null>(null);
  readonly delegateTarget = this._delegateTarget.asReadonly();

  openDelegate(t: OrderTest) { this._delegateTarget.set(t); }
  cancelDelegate() { this._delegateTarget.set(null); }

  onDelegate(toUserId: string) {
    const t = this._delegateTarget();
    if (!t) return;
    this.api.post(`/api/results/${t.id}/delegate`, { toUserId }).subscribe({
      next: () => {
        this._delegateTarget.set(null);
        this.toasts.success('Delegated — the new assignee must scan to pick up.');
        this.refresh();
      },
      error: e => this.toasts.error(e.message ?? 'Delegate failed')
    });
  }
}
