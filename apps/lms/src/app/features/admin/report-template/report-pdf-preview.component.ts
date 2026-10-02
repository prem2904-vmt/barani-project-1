import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect, inject, input, signal, viewChild } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ReportSignature, ReportTemplate } from '../../../shared/models/report.model';
import { ReportColumn } from '../../../shared/models/report-layout.model';
import { firstValueFrom } from 'rxjs';
import { ReportPdfInput, renderReportPdfBlobUrl } from '../../../shared/utils/report-pdf';
import { buildSamplePreviewInput, type PreviewProfileMember } from '../../../shared/utils/report-sample-preview';
import type { LiveLayout } from '../../../shared/utils/report-profile-layout';
import type { PageLayoutBox } from '../../../shared/models/report-layout.model';

export type { PreviewProfileMember } from '../../../shared/utils/report-sample-preview';

/**
 * EXACT-output report preview: runs the engine's /preview per test, fabricates
 * a minimal snapshot, and renders it through the REAL client PDF pipeline
 * (report-pdf.ts) into an embedded blob-URL iframe — byte-identical to the
 * printed patient report. Replaces the old HTML-table approximations, which
 * had drifted from the PDF (their own linkedNext merge, no letterhead, blank
 * for profiles).
 *
 * Live column editing: `columnsOverride` patches the TARGET layout before
 * rendering, so the Test Master's column editor shows its unsaved state.
 */
@Component({
  selector: 'pf-report-pdf-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-pdfprev">
      @if (!testId()) {
        <p class="pf-pdfprev__empty">Pick a test to preview its printed report.</p>
      } @else if (error()) {
        <p class="pf-pdfprev__err">{{ error() }}</p>
      } @else if (hasUrl()) {
        <!-- The blob URL is loaded via contentWindow.location.replace(), NEVER
             a [src] rebind: mutating a live iframe's src pushes a browser
             session-history entry per render, so after a few live-preview
             refreshes the page's Back button needed 2-3 clicks (each popping a
             revoked blob → WebKitBlobResource errors). replace() swaps the
             document with no history growth. -->
        <!-- aria-label, not title: a title shows as a floating native tooltip. -->
        <iframe #frame class="pf-pdfprev__frame" aria-label="Report preview"></iframe>
      } @else {
        <p class="pf-pdfprev__empty">Rendering…</p>
      }
      @if (rendering() && hasUrl()) {
        <span class="pf-pdfprev__spin">Rendering…</span>
      }
    </div>
  `,
  styles: [`
    .pf-pdfprev { position: relative; }
    .pf-pdfprev__frame {
      width: 100%;
      aspect-ratio: 210 / 260;
      min-height: 420px;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.25));
      border-radius: 12px;
      background: #525659; /* pdf viewer chrome */
    }
    .pf-pdfprev__empty { font-size: 13px; color: var(--text-tertiary, #94a3b8); padding: 24px 0; text-align: center; }
    .pf-pdfprev__err { font-size: 12.5px; color: #f87171; padding: 12px 0; }
    .pf-pdfprev__spin {
      position: absolute; top: 8px; right: 10px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--text-tertiary, #cbd5e1);
      background: rgba(0,0,0,0.45); border-radius: 999px; padding: 3px 9px;
    }
  `],
})
export class ReportPdfPreviewComponent implements OnDestroy {
  /** The test (or PROFILE) being previewed — the layout target. */
  readonly testId = input<string>('');
  readonly testName = input<string>('');
  readonly department = input<string>('');
  readonly sampleType = input<string>('');
  /** Parameter names of an INDIVIDUAL test — sample values are generated for
   *  them (the engine needs values for result/range/unit cells to resolve). */
  readonly parameters = input<string[]>([]);
  /** Explicit sample values (the advanced editor lets the admin type them);
   *  when set they replace the generated ones for the individual path. */
  readonly values = input<Record<string, unknown> | null>(null);
  /** Unsaved draft Parameters JSON — the engine previews THESE instead of the
   *  stored test, so range/unit edits show before Save. */
  readonly parametersJson = input<string | null>(null);
  /** Non-empty = the target is a PROFILE: one snapshot row per member. */
  readonly profileMembers = input<PreviewProfileMember[]>([]);
  /** LIVE (possibly unsaved) column override — patched onto the target layout
   *  before rendering so the columns editor previews before Save. */
  readonly columnsOverride = input<ReportColumn[] | null>(null);
  /** True for culture (C&S) tests: the preview snapshot carries sample
   *  culture data (gram stage, organisms, AST) with the culture microFormat
   *  so the PDF shows the real culture block instead of an empty grid. */
  readonly culture = input<boolean>(false);

  /** The profile one-page layout as the designer has it RIGHT NOW (unsaved
   *  boxes) — the preview renders it while the lab drags, instead of
   *  waiting for the autosave round trip. Null = whatever is saved. */
  readonly pageLayout = input<LiveLayout | null>(null);
  /** The test's department — the sample report signs with its REAL sign-off. */
  readonly departmentId = input<string | null>(null);
  private readonly signoff = signal<{ signatures: ReportSignature[] } | null>(null);
  private signoffFor: string | null = null;
  /** Bump to force a re-render (after Save, or a manual Refresh). */
  readonly refreshToken = input(0);

  private readonly api = inject(ApiService);
  private readonly layout = inject(ReportLayoutService);
  private readonly platform = inject(PlatformService);

  protected readonly rendering = signal(false);
  protected readonly error = signal('');
  private readonly _url = signal<string | null>(null);
  protected readonly hasUrl = signal(false);
  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  /** Tenant report template (letterhead, colors, signatures) — the preview
   *  must carry the real chrome or it isn't the exact output. */
  private readonly tpl = signal<ReportTemplate | null>(null);

  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  /** id → the tenant's EFFECTIVE row id (see effectiveId). Cleared on every
   *  refreshToken bump — a save is what can move a test to a new row. */
  private readonly effIds = new Map<string, Promise<string>>();
  private effToken = -1;
  /** Guards against an older async render finishing after a newer one. */
  private renderSeq = 0;

  constructor() {
    this.api.get<ReportTemplate>('/api/config/report-template').subscribe({
      next: t => this.tpl.set(t ?? null),
      error: () => this.tpl.set(null),   // default chrome still renders
    });
    // Debounced render on every input change (300ms — same cadence as the
    // report-template screen, avoids hammering jsPDF while typing).
    effect(() => {
      this.testId(); this.testName(); this.department(); this.sampleType();
      this.parameters(); this.values(); this.profileMembers();
      this.columnsOverride(); this.refreshToken(); this.tpl(); this.pageLayout(); this.departmentId();
      if (this.renderTimer) clearTimeout(this.renderTimer);
      if (!this.testId()) { this.setUrl(null); return; }
      this.rendering.set(true);
      this.renderTimer = setTimeout(() => void this.render(), 300);
    });
    // Load the blob into the frame once both exist — history-free (see the
    // template note). Re-runs whenever the URL or the frame's presence flips.
    effect(() => {
      const el = this.frame()?.nativeElement;
      const url = this._url();
      if (el && url) {
        el.contentWindow?.location.replace(url + '#view=FitH&toolbar=0');
      }
    });
  }

  ngOnDestroy() {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    const prev = this._url();
    if (prev) URL.revokeObjectURL(prev);
  }

  private setUrl(raw: string | null) {
    const prev = this._url();
    if (prev) URL.revokeObjectURL(prev);
    this._url.set(raw);
    this.hasUrl.set(raw !== null);
  }

  /**
   * The row whose layout the editor's saves actually reach. Reference-mode
   * labs edit a MASTER test copy-on-write: the first layout save materialises
   * the lab's (or branch's) own row under a NEW id and writes there, while the
   * open editor keeps the master id it was opened with. Every editor read maps
   * a lineage id to that effective row server-side — except the engine's
   * preview, which must render the EXACT row a real report points at. So the
   * preview asked for the master's layout and every Sentence / description the
   * admin had just saved was missing (owner bug 2026-09-27, Diabetes Profile).
   * GET /api/tests/{id} resolves any lineage id to the effective row — the
   * same row a new order stamps, so the preview is the report it will print.
   */
  private effectiveId(id: string): Promise<string> {
    const token = this.refreshToken();
    if (token !== this.effToken) { this.effIds.clear(); this.effToken = token; }
    let p = this.effIds.get(id);
    if (!p) {
      p = firstValueFrom(this.api.get<{ id?: string } | null>(`/api/tests/${id}`))
        .then(t => (t?.id && typeof t.id === 'string') ? t.id : id)
        .catch(() => id);
      this.effIds.set(id, p);
    }
    return p;
  }

  private async render(): Promise<void> {
    const seq = ++this.renderSeq;
    const testId = this.testId();
    if (!testId) { this.rendering.set(false); return; }
    this.error.set('');
    try {
      const input = await this.buildPreviewInput(() => seq !== this.renderSeq);
      if (!input) return;   // superseded by a newer render
      const url = renderReportPdfBlobUrl(input);
      this.setUrl(url);
    } catch (e) {
      console.error('report preview render failed', e);
      this.error.set('Preview failed to render — check the layout and try Refresh.');
    } finally {
      if (seq === this.renderSeq) this.rendering.set(false);
    }
  }

  /** The department's real sign-off, fetched once per department. */
  private async signoffOf(dept: string | null): Promise<{ signatures: ReportSignature[] } | null> {
    if (!dept) return null;
    if (this.signoffFor !== dept) {
      this.signoffFor = dept;
      this.signoff.set(await this.layout.signoffPreview(dept));
    }
    return this.signoff();
  }

  /** The fabricated report + resolved layouts, exactly as buildReportPdf will
   *  receive them (shared/utils/report-sample-preview.ts — the SAME builder
   *  the profile one-page layout designer draws its page with). Null when
   *  `superseded()` turns true mid-way. */
  async buildPreviewInput(superseded: () => boolean = () => false): Promise<ReportPdfInput | null> {
    return buildSamplePreviewInput({
      testId: this.testId(),
      testName: this.testName(),
      department: this.department(),
      sampleType: this.sampleType(),
      parameters: this.parameters(),
      values: this.values(),
      parametersJson: this.parametersJson(),
      members: this.profileMembers(),
      columnsOverride: this.columnsOverride(),
      culture: this.culture(),
      template: this.tpl(),
      apiUrl: this.platform.getApiUrl(),
      preview: async (id, vals, imgs, p, pj) => this.layout.preview(await this.effectiveId(id), vals, imgs, p, pj),
      pageLayout: this.pageLayout(),
      signoff: await this.signoffOf(this.departmentId()),
      assetBase: typeof document !== 'undefined' ? document.baseURI : null,
    }, superseded);
  }
}
