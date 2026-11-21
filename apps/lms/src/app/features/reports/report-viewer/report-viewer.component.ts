import { printPdfBlobUrl } from '../../../shared/utils/print-pdf';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { ZoomTargetDirective } from '../../../core/navigation/zoom.directive';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ShareService } from '../../../core/services/share.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import { Report, ReportTemplate } from '../../../shared/models/report.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { ResolvedReportLayout, ResolvedRow } from '../../../shared/models/report-layout.model';
import { WhatsAppManualService } from '../../../core/services/whatsapp-manual.service';
import { NgTemplateOutlet } from '@angular/common';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { formatPatientMeta, patientDisplayName } from '../../../shared/models/patient.model';
import { EditResultDialogComponent } from '../../../shared/components/edit-result-dialog/edit-result-dialog.component';
import { EditReferralDialogComponent } from '../../../shared/components/edit-referral-dialog/edit-referral-dialog.component';
import { EDIT_REFERRAL_PERM, ReferralSaveResult } from '../../../shared/components/edit-referral-dialog/referral-edit';
import { resolveReportLayouts, LayoutSnapshotTest } from '../../../shared/utils/report-layouts';
import { NavBackService } from '../../../core/services/nav-back.service';
import { savedFlagOf, type SavedFlag } from '../../../shared/utils/result-flag';
import { reportFlag } from '../../../shared/utils/report-flag';
import { OutsourcingService } from '../../../core/services/outsourcing.service';
import { PartnerReport, PdfParts, firstAttachProblem, partnerReportShareLine, partnerWhere } from '../../frontdesk/outsourced/outsourced-view';
import { UploadsService } from '../../../core/services/uploads.service';
import { ReportWhatsAppStatusComponent } from './report-whatsapp-status.component';
import { ActionsMenuComponent, ActionsMenuTriggerDirective, type PfAction } from '../../../shared/components/actions-menu/actions-menu.component';
import { LAB_RESULTS_PERMS, PATIENT_PROFILE_PERMS, ReportActionsService, WA_MANUAL_NOTE, type ChannelContext } from '../../../core/services/report-actions.service';
import { DialogService } from '../../../core/services/dialog.service';
import { WhatsAppSendService, waSendLabel } from '../../../core/services/whatsapp-send.service';
import { currentRecipient } from '../../../shared/utils/report-recipient';
import { formatAge } from '../../../shared/utils/patient-age';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { asFamilyValue, familyValueText, resultValueText } from '../../../shared/utils/option-family';

interface ReportData {
  patient?: { name?: string; displayName?: string; firstName?: string; fathersName?: string; age?: number; ageDisplay?: string | null; ageYears?: number | null; sex?: string; phone?: string; mrn?: string };
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
  // A family value: one line ("Present — Hyaline 2–3 /LPF; Granular Few").
  if (asFamilyValue(raw)) return { value: familyValueText(raw), flag: '' };
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
  if (asFamilyValue(raw)) return familyValueText(raw);
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
    ReportWhatsAppStatusComponent,
    HeroBandComponent,
    EditResultDialogComponent,
    EditReferralDialogComponent,
    ZoomTargetDirective,
    ActionsMenuComponent,
    ActionsMenuTriggerDirective,
    BusyDirective,
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
  /** A ⋮ menu action whose work outlives the menu (Download builds the PDF,
   *  Regenerate posts): the ⋮ trigger shows it busy until it answers. */
  readonly menuBusy = signal<'download' | 'regenerate' | null>(null);
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
    // The snapshot's age at collection ("8 M" for an infant), else the live patient.
    const ageSrc = p && (p.age != null || p.ageDisplay) ? { age: p.age, ageDisplay: p.ageDisplay } : q ?? null;
    const sex = p?.sex ?? q?.sex ?? null;
    const mrn = p?.mrn ?? q?.mrn ?? null;
    if (!formatAge(ageSrc) && !sex && !mrn) return '';
    return formatPatientMeta({ ...(ageSrc ?? {}), sex: sex as never, mrn: mrn as never } as never);
  });
  /** Who the report is SENT to — the current patient record (a profile
   *  correction reaches the share / WhatsApp message), else the snapshot. */
  readonly recipient = computed(() => currentRecipient(this._report(), this.data()?.patient));
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
    return 'Ready';
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
  /** Delivery desk (deliver_report): Send WhatsApp, Print, Share with a
   *  colleague. Without it (view_report only — Lab Tech, Branch / Quality
   *  Manager) the viewer is VIEW-ONLY; the PDF download lives on the list. */
  readonly canDeliver = computed(() => this.auth.hasPermission('deliver_report'));
  /** Print is NOT a delivery here (owner, 2026-09-27): everyone who can open
   *  the viewer (its route: deliver_report | view_report | validate_result)
   *  may print. print() is a client-side render + the letterpad choice — it
   *  never calls /deliver or archives, so a view-only print records nothing. */
  readonly canPrint = computed(() =>
    ['deliver_report', 'view_report', 'validate_result'].some(p => this.auth.hasPermission(p)));
  /** Generate / Regenerate change what the patient receives — the backend
   *  admits deliver_report | validate_result (same rule as the Results list). */
  readonly canGenerate = computed(() => ['deliver_report', 'validate_result'].some(p => this.auth.hasPermission(p)));

  // ── ⋮ Report actions (shared/components/actions-menu) ─────────────
  // EVERY action for this report in one place, on every width: share
  // (patient link / WhatsApp / a colleague), the PDF (download / print), the
  // workflow steps (edit results, regenerate) and go-to (patient, lab
  // results). Rows follow the same permission + state rules as the buttons
  // they mirror; the band keeps ONE primary (Send WhatsApp).
  private readonly reportActions = inject(ReportActionsService);
  private readonly dialog = inject(DialogService);
  private has(perms: string[]): boolean { return perms.some(p => this.auth.hasPermission(p)); }
  readonly menuActions = computed<PfAction[]>(() => {
    const r = this._report();
    if (!r) return [];
    const a: PfAction[] = [];
    if (this.reportActions.canLink(r)) {
      a.push({ id: 'share', label: 'Share…', icon: 'share', group: 'Share', hint: this.reportActions.shareHint() });
      a.push({ id: 'copy-link', label: 'Copy patient link', icon: 'link', group: 'Share' });
    }
    if (this.canDeliver()) {
      // ONE WhatsApp row: WhatsApp Auto (entitled + a sender), else WhatsApp Chat (entitled), else none.
      a.push(...this.reportActions.whatsAppActions({ ...r, type: this.isPartial() ? 'partial' : r.type }));
      // Email (the lab sends it, final report) + SMS Chat (phones / tablets only).
      a.push(...this.reportActions.channelActions({ ...r, type: this.isPartial() ? 'partial' : r.type }, this.channelCtx()));
      if (this.entitlements.moduleEnabled('messages')) a.push({ id: 'colleague', label: 'Share with a colleague', icon: 'chat', group: 'Share' });
    }
    a.push({ id: 'download', label: 'Download PDF', icon: 'download', group: 'Report' });
    if (this.canPrint()) a.push({ id: 'print', label: 'Print', icon: 'print', group: 'Report' });
    if (this.canEditResult()) a.push({ id: 'edit', label: 'Edit results', icon: 'edit', group: 'Report', hint: 'Re-opens the results for correction' });
    // Edit referral (modify_order): a released final is re-issued AMENDED by
    // the server; a preliminary's referral reaches the next final.
    if (this.canEditReferral() && r.orderId) {
      a.push({ id: 'referral', label: 'Edit referral', icon: 'referral', group: 'Report',
        hint: this.isPartial() ? 'Doctor, hospital or source' : 'Doctor, hospital or source · issues an amended report' });
    }
    if (this.canGenerate() && r.orderId && !this.isPartial()) {
      a.push({ id: 'regenerate', label: 'Regenerate', icon: 'regenerate', group: 'Report', hint: 'Rebuild with the current report template' });
    }
    if (r.patientId && this.has(PATIENT_PROFILE_PERMS)) a.push({ id: 'patient', label: 'Open patient', icon: 'patient', group: 'Go to' });
    if (r.orderId && this.has(LAB_RESULTS_PERMS)) a.push({ id: 'lab', label: 'Open lab results', icon: 'lab', group: 'Go to' });
    return a;
  });

  /** The menu opened: warm the patient link so Share… keeps the tap's gesture. */
  onMenuOpened(): void { this.reportActions.prefetch(this._report()); }

  /** What the viewer knows about the recipients: the current patient record (phone, and email when
   *  the server sends it); the referral doctor's email only when the report data carries it. */
  private channelCtx(): ChannelContext {
    const p = this._report()?.patient as { phone?: string | null; email?: string | null } | null | undefined;
    const o = this.data()?.order as { refDoctorName?: string; refDoctorEmail?: string | null } | undefined;
    return {
      patientPhone: this.recipient().phone ?? null,
      patientEmail: p && 'email' in p ? p.email ?? null : undefined,
      doctorEmail: o && 'refDoctorEmail' in o ? o.refDoctorEmail ?? null : undefined,
      doctorName: o?.refDoctorName ?? null,
    };
  }

  runAction(id: string): void {
    const r = this._report();
    if (!r) return;
    if (this.reportActions.runChannel(id, r as never, { name: this.recipient().name ?? this.patientName(), phone: this.recipient().phone }, this.channelCtx())) return;
    switch (id) {
      case 'share': void this.reportActions.share(r, this.recipient().name ?? this.patientName()); break;
      case 'copy-link': void this.reportActions.copyLink(r); break;
      case 'whatsapp': this.deliverWhatsApp(); break;
      case 'whatsapp-mine': void this.shareViaMyWhatsApp(); break;
      case 'colleague': void this.openSharePicker(); break;
      case 'download': void this.download(); break;
      case 'print': void this.print(); break;
      case 'edit': this.openEditDialog(); break;
      case 'regenerate': void this.regenerate(); break;
      case 'referral': this.referralDialogOpen.set(true); break;
      case 'patient': void this.router.navigate(['/frontdesk/patients', r.patientId]); break;
      case 'lab': void this.openLabResults(); break;
    }
  }

  /** Download the SAME PDF the preview shows. Native shell: the share sheet
   *  (Save to Files); web: a file download. */
  async download(): Promise<void> {
    const r = this._report();
    if (!r || this.menuBusy()) return;
    this.menuBusy.set('download');
    try {
      const blob = this._pdfBlob ??= await this.buildPdfBlob(r);
      const name = `report-${r.id.replace(/-/g, '').slice(-8).toUpperCase()}.pdf`;
      const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor?.isNativePlatform?.();
      const file = new File([blob], name, { type: 'application/pdf' });
      if (isNative && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Download report' });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* */ } }, 60_000);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      const { reportRenderErrorMessage } = await import('../../../shared/utils/report-render-input');
      this.toasts.error(reportRenderErrorMessage(err, 'Could not download report'));
    } finally {
      if (this.menuBusy() === 'download') this.menuBusy.set(null);
    }
  }

  /** Regenerate — the Results list's flow (DialogService confirm, then
   *  POST /api/reports/generate), and the viewer switches to the new version. */
  async regenerate(): Promise<void> {
    const r = this._report();
    if (!r?.orderId || !this.canGenerate()) return;
    const ok = await this.dialog.confirm({
      title: 'Regenerate report?',
      message: 'Rebuild this report using the current report template and Test Master. The previous version is replaced (it stays in the audit trail).',
      confirmLabel: 'Regenerate',
      tone: 'primary',
    });
    if (!ok || this.menuBusy()) return;
    this.menuBusy.set('regenerate');
    this.api.post<Report>('/api/reports/generate', { orderId: r.orderId, type: 'final' }).pipe(
      finalize(() => { if (this.menuBusy() === 'regenerate') this.menuBusy.set(null); }),
    ).subscribe({
      next: r2 => {
        this.toasts.success('Report regenerated with the latest template');
        if (!r2?.id) return;
        // The new version is rendered from its snapshot + the CURRENT
        // settings and stored the moment the preview paints it (the previous
        // version is superseded; its stored PDF stays for audit).
        this._pdfBlob = null;
        this.pdfParts.set(null);
        this._pdfReady.set(false);
        this._report.set(r2);
        void this.router.navigate(['/reports/view', r2.id], { replaceUrl: true });
      },
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }

  /** Open the bench's result screen READ-ONLY (the Results list's action). */
  async openLabResults(): Promise<void> {
    const r = this._report();
    if (!r?.orderId) return;
    try {
      const order = await firstValueFrom(this.api.get<{ samples?: Array<{ id: string }> }>(`/api/orders/${r.orderId}`));
      const sid = order?.samples?.[0]?.id;
      if (!sid) { this.toasts.error('No sample found for this order.'); return; }
      void this.router.navigate(['/lab/sample', sid], { queryParams: { view: 1 } });
    } catch {
      this.toasts.error('Could not open the lab results.');
    }
  }

  readonly editDialogOpen = signal(false);

  // ── Edit referral (shared/components/edit-referral-dialog) ──────────
  readonly canEditReferral = computed(() => this.auth.hasPermission(EDIT_REFERRAL_PERM));
  readonly referralDialogOpen = signal(false);
  /** Saved: an amended report replaced this one ⇒ show it (the released
   *  copy keeps the old referral for the record). */
  onReferralSaved(res: ReferralSaveResult): void {
    this.referralDialogOpen.set(false);
    const next = res.reportAmended ? res.amendedReportId : null;
    if (!next) return;
    void this.showLive(next).then(() => this.router.navigate(['/reports/view', next], { replaceUrl: true }));
  }

  openEditDialog() { this.editDialogOpen.set(true); }

  /** The corrected results left this report behind — reload so the viewer
   *  reflects the new state (and the PDF is rebuilt from fresh data). */
  onEdited() {
    this.editDialogOpen.set(false);
    const id = this._report()?.id;
    if (!id) return;
    // A corrected result is re-signed into a NEW (amended) report — follow
    // the chain to the live version and show ITS stored PDF.
    void this.showLive(id);
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

  // Share with a colleague → the ONE share sheet (a report card; the server
  // names it and checks I may see it). "Send to doctor" = the same sheet.
  private readonly share = inject(ShareService);
  openSharePicker(): void {
    const r = this.report();
    if (!r) return;
    this.share.openSheet({
      target: { type: 'report', id: r.id },
      title: this.patientName() || 'Lab report',
      subtitle: this.orderLabel() || '',
    });
  }
  closeSharePicker(): void { this.share.closeSheet(); }

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
          result: asFamilyValue(raw) ? familyValueText(raw) : isObj ? String(v.value ?? '—') : String(raw ?? '—'),
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
      value: value == null || value === '' ? '—' : resultValueText(value)
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
   *  the classic column order `Result → Reference → Unit` so the value
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

    // Reorder typed core into the classic column order.
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

  /** Classic-style column header label. Server defaults emit
   *  "Reference range" — the classic report says "Reference Value".
   *  Falls back to the layout's original label for custom columns. */
  classicLabelFor(c: ResolvedReportLayout['columns'][number]): string {
    if (c.type === 'range') return 'Reference Value';
    return c.label;
  }

  /** Prepend the API base for server-relative asset URLs ("/uploads/…")
   *  so logos / signature images uploaded via the template editor resolve
   *  correctly when the viewer is served from a different host than the
   *  API (dev / capacitor / electron). Absolute http(s) URLs pass through. */
  resolveAsset(url: string | null | undefined): string {
    // "/uploads/…" assets are private — a blob: URL fetched with the session.
    return this.uploadAssets.src(url);
  }
  private readonly uploadAssets = inject(UploadsService);

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
  private loadPartnerReports(orderId: string | undefined): Promise<void> {
    if (!orderId) return Promise.resolve();
    return this.outsourcing.partnerReports(orderId).then(
      l => this.partnerReports.set(l ?? []),
      () => this.partnerReports.set([]));
  }
  /** What the delivered PDF REALLY contains per attached partner file (the
   *  server's answer, read after the preview's PDF was fetched — so it
   *  describes the same file). Null = not known yet. */
  readonly pdfParts = signal<PdfParts | null>(null);
  readonly partnerWhere = partnerWhere;
  /** The Outsourced tab's permission for "Attach to report". */
  readonly canAttachPartner = computed(() => this.has(['deliver_report', 'dispatch_sample']));
  readonly attachingUrl = signal<string | null>(null);
  private refreshPdfParts(reportId: string) {
    if (!this._report()?.orderId) return;
    this.outsourcing.pdfParts(reportId).then(
      p => { if (this._report()?.id === reportId) this.pdfParts.set(p ?? null); },
      () => { /* unknown — the row keeps the flag's wording */ });
  }
  /** "Attach to report" from the viewer (a file uploaded before the feature,
   *  or unticked at upload): every line sharing that partner file is
   *  attached, then the preview reloads — the served PDF is now ours + the
   *  partner pages, and Print / Download / WhatsApp / the link follow. */
  async attachPartner(p: PartnerReport) {
    const r = this._report();
    if (!r || this.attachingUrl()) return;
    const ids = this.partnerReports().filter(x => x.url === p.url).map(x => x.orderTestId);
    this.attachingUrl.set(p.url);
    try {
      const updated = await this.outsourcing.setAttachToReport(ids, true);
      const problem = firstAttachProblem(updated);
      if (problem) this.toasts.warning(problem);
      else this.toasts.success('Attached — the patient gets one PDF with the partner report');
      await this.loadPartnerReports(r.orderId);
      this.reloadPdf();
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.attachingUrl.set(null);
    }
  }
  /** Drop the cached blob and paint the served PDF again. */
  private reloadPdf() {
    this._pdfBlob = null;
    this.pdfParts.set(null);
    this._pdfError.set(null);
    this._pdfReady.set(false);
    void this.renderPdfView();
  }
  /** Opens the partner's file in a new tab — the browser's own viewer
   *  downloads / prints it as is. */
  openPartnerReport(p: PartnerReport) {
    // Private upload → opened through a short-lived signed URL.
    void this.uploads.open(p.url);
  }
  protected readonly uploads = inject(UploadsService);

  ngOnInit() {
    this.waSend.ensure();
    this.reportActions.warmChannels();
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
        // A superseded version (regenerated / amended since) is no longer
        // what the patient receives — open the live one instead.
        if (r?.supersededByReportId) { void this.showLive(r.id); return; }
        this._report.set(r);
        this.loadPartnerReports(r?.orderId);
      },
      error: () => { this.loadError.set(true); this.toasts.error('Could not load report'); }
    });
  }

  /** Follow `supersededByReportId` from `id` to the live version (bounded)
   *  and show it — "the previous report is deleted" means the user no longer
   *  sees it; its row and stored PDF stay for audit. */
  private async showLive(id: string): Promise<void> {
    try {
      let r = await firstValueFrom(this.api.get<Report>(`/api/reports/${id}`));
      for (let hops = 0; r?.supersededByReportId && hops < 10; hops++)
        r = await firstValueFrom(this.api.get<Report>(`/api/reports/${r.supersededByReportId}`));
      if (!r) throw new Error('not found');
      const moved = r.id !== this._report()?.id;
      this._pdfBlob = null;
      this.pdfParts.set(null);
      this._pdfReady.set(false);
      this._report.set(r);
      this.loadPartnerReports(r.orderId);
      if (moved && r.id !== id) {
        this.toasts.info('Showing the latest version of this report');
        void this.router.navigate(['/reports/view', r.id], { replaceUrl: true });
      }
    } catch {
      this.loadError.set(true);
      this.toasts.error('Could not load report');
    }
  }

  /** Paint the report's STORED PDF (identical to Download / Print / the
   *  patient link) onto canvases inside the viewer. A report with nothing
   *  stored yet is rendered once from its saved snapshot and stored here.
   *  Cached: repeated calls reuse the blob. */
  async renderPdfView() {
    const r = this._report();
    if (!r || this._pdfRendering) return;
    this._pdfRendering = true;
    this._pdfError.set(null);
    this._pdfReady.set(false);
    try {
      this._pdfBlob ??= await this.buildPdfBlob(r);
      this.refreshPdfParts(r.id);
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
    const patient = { sex: p?.sex ?? null, age: p?.age ?? null, ageYears: p?.ageYears ?? null, ageDisplay: p?.ageDisplay ?? null };
    // The ONE resolver: SCALAR values (the snapshot's { value, flag, … }
    // wrappers are unwrapped so "show when result > X" conditions match),
    // snapshot images, and the ordered PROFILES' layouts.
    try {
      const next = await resolveReportLayouts<ResolvedReportLayout>(
        (id, values, images, pt, profileCode) => this.layoutSvc.preview(id, values, images as never, pt, null, profileCode),
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
   *  window.print() which would rasterize the app shell.
   *  Letterpad setting on → ask letterhead vs plain paper for THIS job only
   *  (letterhead paper renders with the header & footer left blank). */
  async print() {
    const r = this._report();
    if (!r || this.busy() === 'print' || !this.canPrint()) return;
    this.busy.set('print');
    try {
      const [{ askPrintLetterhead }, { DialogService }, { loadReportTemplate }] = await Promise.all([
        import('../../../shared/utils/print-letterhead'),
        import('../../../core/services/dialog.service'),
        import('../../../shared/utils/report-render-input'),
      ]);
      const job = await askPrintLetterhead(await loadReportTemplate(this.api), this.injector.get(DialogService));
      if (!job) return;   // dismissed — print nothing
      // The STORED copy for the paper: the full report, or its letterhead-
      // paper variant (header & footer blank) — each stored once.
      let blob: Blob;
      if (job.blankLetterhead) {
        const { storedReportBlob } = await import('../../../shared/utils/report-blob');
        blob = await storedReportBlob(r, this.api, this.injector, 'letterpad');
      } else {
        blob = this._pdfBlob ??= await this.buildPdfBlob(r);
      }
      const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor?.isNativePlatform?.();
      const file = new File([blob], `report-${r.id.replace(/-/g, '').slice(-8).toUpperCase()}.pdf`,
        { type: 'application/pdf' });
      if (isNative && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Print report' });
      } else {
        // Off-screen A4 iframe via the shared helper; a 0-sized frame printed blank.
        printPdfBlobUrl(URL.createObjectURL(blob), { revokeOnDone: true });
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

  // ── WhatsApp Auto (the lab's WhatsApp Cloud API number) / WhatsApp Chat (manual) ─────────
  private readonly waSend = inject(WhatsAppSendService);
  private readonly waManual = inject(WhatsAppManualService);
  /** This final report goes out from the server (the lab has a sender). */
  readonly waCloud = computed(() => {
    const r = this._report();
    return !!r && !this.isPartial() && this.waSend.canSend(r);
  });
  /** The ONE button's mode: Auto, else Chat, else none (no button). */
  readonly waMode = computed(() => {
    const r = this._report();
    return r ? this.waSend.mode({ type: this.isPartial() ? 'partial' : r.type }) : null;
  });
  /** Live phase of the server send for the report on screen. */
  readonly waState = computed(() => this.waSend.state(this._report()?.id));
  /** The primary's words: WhatsApp Auto → Sending… → Sent → Delivered / Read. */
  readonly waLabel = computed(() => {
    const st = this.waState();
    return st && st.phase !== 'failed' ? waSendLabel(st.phase) : 'WhatsApp Auto';
  });
  /** Sent / Delivered / Read: the primary shows the check. */
  readonly waDone = computed(() => ['sent', 'delivered', 'read'].includes(this.waState()?.phase ?? ''));

  /** THE primary. Lab has WhatsApp Cloud → the server sends the approved
   *  template with the report link to the patient's number; otherwise (or a
   *  preliminary report) WhatsApp Chat. */
  deliverWhatsApp() {
    const r = this._report();
    if (!r || !this.canDeliver()) return;
    if (this.waCloud()) {
      if (this.waSend.busy(r.id)) return;
      // The public link serves the archived PDF — archive it alongside (best-effort).
      void this.archiveReportPdf(r);
      void this.waSend.send(r.id).then((m) => {
        if (!m || m.status === 'failed') return;
        const cur = this._report();
        if (cur && cur.id === r.id) this._report.set({ ...cur, deliveryStatus: 'delivered', deliveredVia: 'whatsapp' });
      });
      return;
    }
    if (this.waSend.chatAllowed()) void this.shareViaMyWhatsApp();
  }

  /** WhatsApp Chat — the manual flow on THIS computer (every lab): the
   *  docked panel (desktop app) / a new tab (browser) / the
   *  WhatsApp app (phone) opens the patient's chat with the message ready;
   *  the person presses Send. The fallback when the lab has no server
   *  sender (and never when Prefrontal turned WhatsApp Chat off for the lab). */
  async shareViaMyWhatsApp() {
    const r = this._report();
    if (!r || !this.canDeliver() || !this.waSend.chatAllowed()) return;
    // Render + archive the PDF (best-effort, background) so the public link
    // resolves to a real file when the patient opens it.
    if (r.qrToken) this.archiveReportPdf(r);
    const out = await this.waManual.send({
      phone: this.recipient().phone,
      patientName: this.recipient().name,
      labName: this.tpl()?.labName,
      link: r.qrToken ? this.verifyCode(r.qrToken) : '',
      extra: [partnerReportShareLine(this.partnerReports())],
      reportId: r.id,
      pdf: async () => { await this.archiveReportPdf(r); return this._pdfBlob ?? null; },
      pdfName: `report-${r.id.replace(/-/g, '').slice(-8).toUpperCase()}.pdf`,
    });
    if (out !== 'opened') return;
    this.flash('whatsapp');
    // The referral doctor's copy is not the patient's hand-over: no delivery record.
    if (this.waManual.lastRecipient !== 'doctor') this.recordWhatsAppHandOver(r.id);
  }

  private recordWhatsAppHandOver(reportId: string) {
    const r = this._report();
    if (!r || r.id !== reportId) return;
    this.api.post(`/api/reports/${r.id}/deliver`, { via: 'whatsapp', note: WA_MANUAL_NOTE }).subscribe({
      // Silent: the chat (or the share sheet) is the feedback. Reflect the recorded delivery in the REPORT card.
      next: () => {
        const cur = this._report();
        if (cur && cur.id === r.id) this._report.set({ ...cur, deliveryStatus: 'delivered', deliveredVia: 'whatsapp' });
      },
      error: () => { /* the handover already happened; the record is best-effort */ },
    });
  }

  /** THE report PDF: the stored file (`GET /api/reports/{id}/pdf`); a report
   *  with nothing stored yet is rendered ONCE from its saved snapshot (the one
   *  recipe — template + layouts incl. PROFILE layouts + images + trendograms)
   *  and stored. Single source for the inline view, Download, Print (plain
   *  paper) and the patient link. Always WITH the letterhead. */
  private async buildPdfBlob(r: Report): Promise<Blob> {
    const { storedReportBlob } = await import('../../../shared/utils/report-blob');
    return storedReportBlob(r, this.api, this.injector, 'full');
  }

  /** Make sure the report's PDF is STORED (best-effort, no download) so the
   *  public /reports/public/{qrToken} link serves the real file — a no-op
   *  when it already is. */
  private async archiveReportPdf(r: Report) {
    try {
      this._pdfBlob ??= await this.buildPdfBlob(r);
    } catch { /* best-effort */ }
  }
}
