import { printPdfBlobUrl } from '../../../shared/utils/print-pdf';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { ZoomTargetDirective } from '../../../core/navigation/zoom.directive';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
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
import { NgTemplateOutlet } from '@angular/common';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { formatPatientMeta, patientDisplayName } from '../../../shared/models/patient.model';
import { EditResultDialogComponent } from '../../../shared/components/edit-result-dialog/edit-result-dialog.component';
import { resolveReportLayouts, LayoutSnapshotTest } from '../../../shared/utils/report-layouts';
import { NavBackService } from '../../../core/services/nav-back.service';
import { savedFlagOf, type SavedFlag } from '../../../shared/utils/result-flag';
import { reportFlag } from '../../../shared/utils/report-flag';
import { OutsourcingService } from '../../../core/services/outsourcing.service';
import { PartnerReport, absoluteFileUrl, partnerReportShareLine } from '../../frontdesk/outsourced/outsourced-view';

interface ReportData {
  patient?: { name?: string; displayName?: string; firstName?: string; fathersName?: string; age?: number; sex?: string; phone?: string; mrn?: string };
  order?: { id?: string; orderNumber?: string; createdAt?: string; priority?: string; refDoctorName?: string };
  type?: string;
  amendment?: { isAmended?: boolean; reason?: string } | null;
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
  /** 'H' | 'L' | 'A' | '' — never 'C' (reportFlag). */
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
/** `saved` = the cell is mw's enriched wrapper ({ value, flag, … }) — its
 *  flag is THE verdict (single source), even when blank/'N'. */
function coerceResultCell(raw: unknown): { value: string; flag: string; saved?: boolean } {
  const s = (raw == null ? '' : String(raw)).trim();
  if (s.startsWith('{') && s.includes('"value"')) {
    try {
      const o = JSON.parse(s) as { value?: unknown; flag?: string };
      return { value: o.value == null ? '' : String(o.value), flag: (o.flag ?? '').toUpperCase(), saved: 'flag' in o };
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

/** matchMedia as a live boolean (same helper shape as the billing counter). */
function mq(query: string, ref: DestroyRef, on: (m: boolean) => void): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const m = window.matchMedia(query);
  const fn = (e: MediaQueryListEvent) => on(e.matches);
  try { m.addEventListener?.('change', fn); ref.onDestroy(() => m.removeEventListener?.('change', fn)); } catch { /* old engines */ }
  return !!m.matches;
}

/** How long a button shows its success state (Printing ✓ / Sent ✓). */
export const RV_DONE_MS = 1800;

@Component({
  selector: 'pf-report-viewer',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    HeroBandComponent,
    EditResultDialogComponent,
    ZoomTargetDirective
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './report-viewer.component.html',
  styleUrl: './report-viewer.component.scss',
})
export class ReportViewerComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly entitlements = inject(TenantEntitlementsService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly chat = inject(ChatService);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  private readonly _report = signal<Report | null>(null);
  private readonly _tpl = signal<ReportTemplate | null>(null);
  readonly report = this._report.asReadonly();
  /** List → detail zoom (core/navigation/zoom.directive): the report-queue
   *  row answers to the report id or its order id. */
  protected readonly zoom = inject(ZoomTransitionService);
  readonly zoomKeys = computed(() => [this.zoomRouteId, this._report()?.id, this._report()?.orderId]);
  private readonly zoomRouteId = inject(ActivatedRoute).snapshot.paramMap.get('id');
  readonly tpl = this._tpl.asReadonly();

  // ── nd layout state ─────────────────────────────────────
  private readonly destroyRef = inject(DestroyRef);
  /** Web (fine pointer + hover) = text buttons; touch = 44px icons. */
  protected readonly web = webPointerSignal();
  /** ≤900px: no side column — REPORT opens as a sheet from the pill. */
  readonly narrow = signal(mq('(max-width: 900px)', this.destroyRef, m => this.narrow?.set(m)));
  readonly detailsOpen = signal(false);
  /** Phones: the "More" action sheet. */
  readonly moreOpen = signal(false);
  /** REPORT side card collapsed to a strip (remembered per user). */
  readonly sideCollapsed = signal(this.readCollapsed());
  toggleSide(): void {
    const next = !this.sideCollapsed();
    this.sideCollapsed.set(next);
    try { localStorage.setItem(this.collapseKey(), next ? '1' : '0'); } catch { /* private mode */ }
  }
  private collapseKey(): string {
    const u = this.auth.user();
    return 'pf:rv:side-collapsed:' + (u?.id || u?.authId || 'anon');
  }
  private readCollapsed(): boolean {
    try { return localStorage.getItem(this.collapseKey()) === '1'; } catch { return false; }
  }

  /** Brief success state on an action button, then back to its label. */
  readonly done = signal<'print' | 'whatsapp' | null>(null);
  readonly busy = signal<'print' | null>(null);
  private doneTimer: ReturnType<typeof setTimeout> | null = null;
  private flash(kind: 'print' | 'whatsapp'): void {
    this.done.set(kind);
    if (this.doneTimer) clearTimeout(this.doneTimer);
    this.doneTimer = setTimeout(() => { this.done.set(null); this.doneTimer = null; }, RV_DONE_MS);
  }

  /** The report could not be fetched at all (the preview shows why). */
  readonly loadError = signal(false);
  /** Page count of the painted PDF (header note). */
  readonly pageCount = signal(0);
  readonly pageCountLabel = computed(() => {
    const n = this.pageCount();
    return n === 1 ? '1 page' : `${n} pages`;
  });
  /** The skeleton stays up until the pages are painted — and through a
   *  zoom morph (`zoom.holding()`), so the zoom target never swaps. */
  readonly showSkeleton = computed(() => !this.loadError() && !this._pdfError() && (!this._report() || this.zoom.holding() || !this._pdfReady()));
  /** The pages' host is mounted once the report is here and no morph runs. */
  readonly showPages = computed(() => !!this._report() && !this.zoom.holding() && !this._pdfError());

  // ── Context bar ─────────────────────────────────────────
  readonly patientName = computed(() => {
    const p = this.data()?.patient;
    const fromData = p ? (p.displayName || patientDisplayName(p as never) || p.name || '') : '';
    return fromData || this._report()?.order?.patient?.displayName || 'Patient';
  });
  readonly patientMeta = computed(() => {
    const p = this.data()?.patient;
    const q = this._report()?.order?.patient;
    const age = p?.age ?? q?.age ?? null;
    const sex = p?.sex ?? q?.sex ?? null;
    const mrn = p?.mrn ?? q?.mrn ?? null;
    if (age == null && !sex && !mrn) return '';
    return formatPatientMeta({ age: age as never, sex: sex as never, mrn: mrn as never });
  });
  readonly orderLabel = computed(() => {
    const o = this.data()?.order;
    if (o?.orderNumber) return o.orderNumber;
    const id = o?.id ?? this._report()?.orderId ?? '';
    return id ? id.replace(/-/g, '').slice(0, 8).toUpperCase() : '';
  });
  readonly isPartial = computed(() => !!this.data()?.isPartial || this._report()?.type === 'partial');
  readonly kindLabel = computed(() =>
    this.isPartial() ? 'Preliminary' : this.data()?.amendment?.isAmended ? 'Amended' : 'Final');
  /** Same words as the Results list ('pending' = generated, awaiting handover). */
  readonly deliveryLabel = computed(() => {
    const st = this._report()?.deliveryStatus;
    if (st === 'delivered') return 'Delivered';
    if (st === 'failed') return 'Delivery failed';
    return 'Completed';
  });
  readonly deliveryLine = computed(() => {
    const r = this._report();
    if (!r) return '';
    if (r.deliveryStatus === 'delivered') {
      const via = (r.deliveredVia ?? '').trim();
      return via ? `Delivered via ${via === 'whatsapp' ? 'WhatsApp' : via.charAt(0).toUpperCase() + via.slice(1)}` : 'Delivered';
    }
    if (r.deliveryStatus === 'failed') return 'Delivery failed — send again';
    return 'Ready to deliver';
  });
  readonly generatedLabel = computed(() => {
    this._tpl();   // re-format once the template's date format arrives
    return this.formatStamp(this._report()?.createdAt);
  });

  initials(name: string): string {
    const parts = (name || '').trim().split(/\s+/);
    return ((parts[0]?.charAt(0) ?? '') + (parts[1]?.charAt(0) ?? '')).toUpperCase();
  }

  // ── Post-result edit ──────────────────────────────────
  // edit_result is held by Lab Technician, Pathologist and Lab Admin —
  // deliberately not the front desk.
  readonly canEditResult = computed(() => this.auth.hasPermission('edit_result'));
  readonly editDialogOpen = signal(false);

  openEditDialog() { this.editDialogOpen.set(true); }

  /** The corrected results left this report behind — reload so the viewer
   *  reflects the new state (and the PDF is rebuilt from fresh data). */
  onEdited() {
    this.editDialogOpen.set(false);
    const id = this._report()?.id;
    if (!id) return;
    this._pdfBlob = null;
    this.api.get<Report>(`/api/reports/${id}`).subscribe({
      // Re-arm the preview so the pages are rebuilt from the fresh data.
      next: r => { this._pdfReady.set(false); this._report.set(r); this.resolveLayouts(); },
      error: () => { /* the toast from the dialog already told the story */ }
    });
  }

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

  /** Chat share label: "<patient> · <order>" (the snapshot carries
   *  displayName, not name — the old label always fell back). */
  readonly subtitle = computed(() => {
    if (!this._report()) return '';
    const name = this.patientName();
    const order = this.orderLabel();
    return order ? `${name} · ${order}` : name;
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

  /** Effective abnormal-flag style — mirrors the PDF theme. */
  flagStyle(): 'bold' | 'bold_color' {
    return this.tpl()?.flagStyle === 'bold_color' ? 'bold_color' : 'bold';
  }
  /** Indicator glyph mode: H/L letters, ↑/↓ arrows, or none (plain value). */
  flagIndicator(): 'letter' | 'arrow' | 'none' {
    const f = this.tpl()?.flagIndicator;
    return f === 'arrow' || f === 'none' ? f : 'letter';
  }
  /** Admin-chosen colours for abnormals (high / low). */
  private abnormalColor(): string { return this.tpl()?.abnormalColor || '#dc2626'; }
  private abnormalLowColor(): string { return this.tpl()?.abnormalLowColor || '#2563eb'; }

  /** Result-cell colour: only tinted when style is bold_color AND the value
   *  is abnormal (admin high / low colour); otherwise default ink. */
  resultColor(row: ViewPanelRow): string | null {
    if (!row.abnormal || this.flagStyle() !== 'bold_color' || this.flagIndicator() === 'none') return null;
    return row.isLow ? this.abnormalLowColor() : this.abnormalColor();
  }

  /** The flag glyph to show beside the value: ↑/↓ in arrow mode, H/L/A in
   *  letter mode (criticals already arrive as H / L — reportFlag). */
  flagDisplay(row: ViewPanelRow): string {
    if (!row.flag || this.flagIndicator() === 'none') return '';
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
      // Keep zero-row groups in the tabular table so a pending/empty test still
      // shows its bold panel header in its department position, rather than being
      // sunk to the un-bold block at the bottom.
      tabular.push(this.buildViewGroup(t, layout));
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
      // Union with the department columns (present only when the test has a
      // column override) so a column the override drops still resolves its
      // VALUES — the on-screen table's shape is fixed and must never blank
      // out because the print layout chose fewer columns.
      const cols = [...layout!.columns, ...(layout!.departmentColumns ?? [])];
      const srcOf = (type: string) => cols.find(c => c.type === type);
      const resultSrc = srcOf('result'), rangeSrc = srcOf('range'), unitSrc = srcOf('unit');
      const savedValues = (t.result?.values ?? undefined) as Record<string, SavedFlag> | undefined;
      for (const sec of gridSections) {
        for (const r of sec.rows ?? []) {
          if (r.isMerged) {
            const note = (r.mergeContent ?? '').trim();
            if (note) g.rows.push({ kind: 'note', note });
            continue;
          }
          const rc = coerceResultCell(resultSrc ? r.cells[resultSrc.name] : '');
          // mw's SAVED verdict (snapshot value / enriched cell) is the flag —
          // single source; the row colour only stands in when there is none.
          const sv = r.parameterName ? savedFlagOf({ flagged: savedValues }, r.parameterName) : undefined;
          const hasSaved = (!!sv && typeof sv === 'object' && 'flag' in sv) || !!rc.saved;
          const raw = sv && typeof sv === 'object' && 'flag' in sv ? sv.flag : rc.flag;
          const colorWord = hasSaved ? '' : this.hueFlag(r.color);
          const result = rc.value || (resultSrc ? String(r.cells[resultSrc.name] ?? '') : '');
          const range = coerceCellText(rangeSrc ? r.cells[rangeSrc.name] : '');
          // Report rule: a critical prints as H / L — never C (report-flag.ts).
          const rf = reportFlag(raw, result, range || sv?.range);
          const colorLetter = colorWord === 'High' ? 'H' : colorWord === 'Low' ? 'L' : '';
          const flag = rf.flag || colorLetter;
          g.rows.push({
            kind: 'param',
            name: this.humanize(r.parameterName ?? ''),
            result,
            range,
            unit: coerceCellText(unitSrc ? r.cells[unitSrc.name] : ''),
            flag,
            isLow: rf.flag ? rf.isLow : flag === 'L',
            abnormal: hasSaved ? rf.abnormal : (!!r.color || r.isBold || rf.abnormal),
          });
        }
      }
    } else {
      const values = (t.result?.values ?? {}) as Record<string, { value?: unknown; flag?: string; range?: string; unit?: string } | unknown>;
      for (const [name, raw] of Object.entries(values)) {
        const v = (raw ?? {}) as { value?: unknown; flag?: string; range?: string; unit?: string };
        const isObj = v && typeof v === 'object' && !Array.isArray(v);
        const rf = reportFlag(isObj ? v.flag : '', isObj ? v.value : raw, isObj ? v.range : '');
        g.rows.push({
          kind: 'param',
          name: this.humanize(name),
          result: isObj ? String(v.value ?? '—') : String(raw ?? '—'),
          range: isObj ? (v.range ?? '') : '',
          unit: isObj ? (v.unit ?? '') : '',
          flag: rf.flag,
          isLow: rf.isLow,
          abnormal: rf.abnormal,
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
    // A blank separator glued "2026" to "09:18 PM" on screen.
    return `${datePart}${t?.dateTimeSeparator?.trim() ? t.dateTimeSeparator : ', '}${timePart}`;
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

  // ── Partner lab reports (outsourced tests) ─────────────
  private readonly outsourcing = inject(OutsourcingService);
  readonly partnerReports = signal<PartnerReport[]>([]);
  private loadPartnerReports(orderId: string | undefined) {
    if (!orderId) return;
    this.outsourcing.partnerReports(orderId).then(
      l => this.partnerReports.set(l ?? []),
      () => this.partnerReports.set([]));
  }
  /** Opens the partner's file in a new tab — the browser's own viewer
   *  downloads / prints it as is. */
  openPartnerReport(p: PartnerReport) {
    window.open(absoluteFileUrl(p.url, this.outsourcing.apiBase), '_blank', 'noopener');
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.back(); return; }
    this.load();
    this.api.get<ReportTemplate>('/api/config/report-template').subscribe({ next: t => this._tpl.set(t) });
    this.destroyRef.onDestroy(() => { if (this.doneTimer) clearTimeout(this.doneTimer); });
  }

  /** Fetch the report (also the error state's Try again). */
  load() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.loadError.set(false);
    this.api.get<Report>(`/api/reports/${id}`).subscribe({
      next: r => {
        this._report.set(r);
        this.resolveLayouts();
        this.loadPartnerReports(r?.orderId);
      },
      error: () => { this.loadError.set(true); this.toasts.error('Could not load report'); }
    });
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
      this.pageCount.set(doc.numPages);
      this._pdfReady.set(true);
    } catch (err) {
      console.error('[report-viewer] PDF render failed', err);
      const { reportRenderErrorMessage } = await import('../../../shared/utils/report-render-input');
      this._pdfError.set(reportRenderErrorMessage(err, 'Could not render the report PDF.'));
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
    // The ONE resolver: SCALAR values (the snapshot's { value, flag, … }
    // wrappers are unwrapped so "show when result > X" conditions match),
    // snapshot images, and the ordered PROFILES' layouts.
    try {
      const next = await resolveReportLayouts<ResolvedReportLayout>(
        (id, values, images, p) => this.layoutSvc.preview(id, values, images as never, p),
        tests as unknown as LayoutSnapshotTest[], patient);
      this._resolved.set(next);
    } catch (err) {
      // Permission / network failure: the PDF pane shows the error state; the
      // on-screen extras simply stay unresolved (never a half-resolved mix).
      console.error('[report-viewer] layout resolve failed', err);
    }
  }

  back() { this.navBack.backTo('/reports'); }

  /** Print the SAME PDF the viewer shows / Download produces. Native shell:
   *  hand the file to the share sheet (it has Print). Web: open the PDF in a
   *  new tab — the browser's PDF viewer prints it verbatim, unlike
   *  window.print() which would rasterize the app shell. */
  async print() {
    const r = this._report();
    if (!r || this.busy() === 'print') return;
    this.busy.set('print');
    try {
      this._pdfBlob ??= await this.buildPdfBlob(r);
      const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor?.isNativePlatform?.();
      const file = new File([this._pdfBlob], `report-${r.id.replace(/-/g, '').slice(-8).toUpperCase()}.pdf`,
        { type: 'application/pdf' });
      if (isNative && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Print report' });
      } else {
        // Off-screen A4 iframe via the shared helper; a 0-sized frame printed blank.
        printPdfBlobUrl(URL.createObjectURL(this._pdfBlob), { revokeOnDone: true });
      }
      this.flash('print');
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return; // share sheet dismissed
      console.error('[report-viewer] print failed', err);
      const { reportRenderErrorMessage } = await import('../../../shared/utils/report-render-input');
      this.toasts.error(reportRenderErrorMessage(err, 'Could not prepare the report for printing'));
    } finally {
      this.busy.set(null);
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
    const partnerLine = partnerReportShareLine(this.partnerReports());
    if (partnerLine) lines.push(partnerLine);
    lines.push('Please contact us if you have any questions.');
    // Render + archive the PDF (best-effort, background) so the public link
    // resolves to a real file when the patient opens it. Fire before the
    // synchronous window.open so the popup isn't blocked.
    if (r.qrToken) this.archiveReportPdf(r);
    const url = waLink(d?.patient?.phone, lines.join('\n\n'));
    window.open(url, '_blank', 'noopener');
    this.flash('whatsapp');
    this.api.post(`/api/reports/${r.id}/deliver`, { via: 'whatsapp', note: 'wa.me link' }).subscribe({
      next: () => {
        this.toasts.success('Opened WhatsApp with the report link');
        // Reflect the recorded delivery in the REPORT card without a refetch.
        const cur = this._report();
        if (cur && cur.id === r.id) this._report.set({ ...cur, deliveryStatus: 'delivered', deliveredVia: 'whatsapp' });
      },
      error: () => this.toasts.info('Opened WhatsApp with the report link'),
    });
  }

  /** Render the report to the SAME PDF the Download button in the queue
   *  produces (jsPDF + tenant template + per-test resolved layouts + images).
   *  Single source for the inline view, Print and the archive upload. */
  private async buildPdfBlob(r: Report): Promise<Blob> {
    const [{ buildReportPdf }, { ReportLayoutService }, { PlatformService }, { prepareReportPdfInput }] = await Promise.all([
      import('../../../shared/utils/report-pdf'),
      import('../../../core/services/report-layout.service'),
      import('../../../core/services/platform.service'),
      import('../../../shared/utils/report-render-input'),
    ]);
    const svc = this.injector.get(ReportLayoutService);
    const platform = this.injector.get(PlatformService);
    // The ONE recipe (template + layouts incl. PROFILE layouts + images +
    // trendograms). Throws instead of silently rendering the default design.
    const input = await prepareReportPdfInput(r, {
      api: this.api,
      preview: (id, values, images, p) => svc.preview(id, values, images as never, p),
      apiUrl: platform.getApiUrl(),
    });
    return buildReportPdf(input).output('blob');
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
