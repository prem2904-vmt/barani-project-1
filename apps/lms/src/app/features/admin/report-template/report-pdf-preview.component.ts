import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect, inject, input, signal, viewChild } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ReportTemplate } from '../../../shared/models/report.model';
import { ReportColumn, ResolvedReportLayout } from '../../../shared/models/report-layout.model';
import { preloadReportImages, renderReportPdfBlobUrl } from '../../../shared/utils/report-pdf';
import { resolveReportLayouts } from '../../../shared/utils/report-layouts';

/** A profile member fed to the preview so a PROFILE previews exactly as it
 *  prints: one fabricated snapshot row per member, resolved through the same
 *  layout pipeline the real report uses. */
export interface PreviewProfileMember {
  id: string;
  name: string;
  /** TestEntity.Parameters JSON (wrapper or bare array) — sample values are
   *  harvested from it so member results resolve to something visible. */
  parameters?: string | null;
}

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

  private static readonly SAMPLE_CULTURE = {
    microFormat: 'culture_sensitivity',
    values: {
      specimen: 'Urine',
      colonyCount: '>100,000 CFU/mL',
      organisms: [{ name: 'Escherichia coli', antibiotics: [
        { name: 'Amikacin', interpretation: 'S' },
        { name: 'Ciprofloxacin', interpretation: 'R' },
        { name: 'Meropenem', interpretation: 'S' },
      ]}],
      resistancePattern: 'Ampicillin-resistant; carbapenems retained.',
      clinicalNotes: 'Significant bacteriuria — correlate clinically.',
    },
    stages: [
      { key: 'gram', label: 'Gram / Direct smear', values: { fields: [
        { name: 'pus_cells', title: 'Pus Cells', value: 'Many' },
        { name: 'gram_negative_bacilli', title: 'Gram-negative bacilli', value: 'Many' },
      ], notes: 'GNB seen' } },
      { key: 'growth', label: 'Growth check', values: { fields: [
        { name: 'growth', title: 'Growth', value: 'Significant growth' },
      ] } },
    ],
  };
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
      this.columnsOverride(); this.refreshToken(); this.tpl();
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

  /** Plausible sample values for a list of parameter names — mirrors the old
   *  notes-editor harvesting so result/range/unit cells resolve visibly. */
  private static valuesFor(names: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const n of names) if (n) out[n] = '1.0';
    return out;
  }

  /** Parameter names out of a TestEntity.Parameters JSON (wrapper or array). */
  private static namesFromParametersJson(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      const list: Array<{ name?: string }> = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.parameters) ? parsed.parameters : [];
      return list.map(p => (p?.name ?? '').trim()).filter(Boolean);
    } catch { return []; }
  }

  private async render(): Promise<void> {
    const seq = ++this.renderSeq;
    const testId = this.testId();
    if (!testId) { this.rendering.set(false); return; }
    this.error.set('');
    try {
      const patient = { sex: 'Female', age: 35 };
      const members = this.profileMembers();
      let layouts: Record<string, ResolvedReportLayout> = {};
      let snapshotTests: Array<Record<string, unknown>>;

      if (members.length > 0) {
        // PROFILE: one fabricated row per member, resolved through the same
        // helper the real report uses — so the profile merge, notes rule and
        // the profile's own column override all exercise the true path.
        snapshotTests = members.map(m => {
          const vals = ReportPdfPreviewComponent.valuesFor(
            ReportPdfPreviewComponent.namesFromParametersJson(m.parameters));
          return {
            testId: m.id,
            name: m.name,
            department: this.department() || 'Department',
            packageTestId: testId,
            profileTestId: testId,
            packageType: 'profile',
            packageName: this.testName(),
            profileName: this.testName(),
            sampleType: this.sampleType() || undefined,
            result: { values: vals },
          };
        });
        layouts = await resolveReportLayouts<ResolvedReportLayout>(
          (id, vals, _c, p) => this.layout.preview(id, vals, [], p,
            id === this.testId() ? this.parametersJson() : null),
          snapshotTests as never,
          patient,
        );
      } else {
        // INDIVIDUAL test: one row from typed or generated sample values.
        const vals = this.values() && Object.keys(this.values()!).length > 0
          ? this.values()!
          : ReportPdfPreviewComponent.valuesFor(this.parameters());
        const resolved = await this.layout.preview(testId, vals, [], patient, this.parametersJson());
        layouts = { [testId]: resolved };
        snapshotTests = [{
          testId,
          name: this.testName() || resolved.testName,
          department: this.department() || resolved.departmentName || 'Department',
          sampleType: this.sampleType() || resolved.sampleType || undefined,
          result: this.culture() ? ReportPdfPreviewComponent.SAMPLE_CULTURE : { values: vals },
        }];
      }
      if (seq !== this.renderSeq) return;   // superseded by a newer render

      // Live unsaved column edits: patch the TARGET layout so the preview is
      // what Save would produce. departmentColumns keeps the pre-override set
      // for the renderer's profile-block fallback.
      const override = this.columnsOverride();
      const target = layouts[testId];
      if (override && override.length > 0 && target) {
        layouts[testId] = {
          ...target,
          columns: override,
          hasColumnOverride: true,
          departmentColumns: target.hasColumnOverride
            ? (target.departmentColumns ?? null)
            : target.columns,
        };
      }

      const snapshot = {
        patient: { displayName: 'Sita Raman', age: 35, sex: 'Female', phone: '9080706050' },
        order: {
          id: 'preview-order',
          orderNumber: 'LAB-2608-000042',
          createdAt: new Date().toISOString(),
          refDoctorName: 'Dr. A. Sharma',
          branchName: 'Preview',
        },
        type: 'final',
        tests: snapshotTests,
      };
      const baseInput = {
        report: {
          id: 'preview-' + testId,
          type: 'final',
          createdAt: new Date().toISOString(),
          data: JSON.stringify(snapshot),
        },
        template: this.tpl(),
        resolvedLayouts: layouts,
        previewKeepEmptyColumns: true,
      };
      const imageCache = await preloadReportImages(baseInput, this.platform.getApiUrl());
      if (seq !== this.renderSeq) return;
      const url = renderReportPdfBlobUrl({ ...baseInput, imageCache });
      this.setUrl(url);
    } catch (e) {
      console.error('report preview render failed', e);
      this.error.set('Preview failed to render — check the layout and try Refresh.');
    } finally {
      if (seq === this.renderSeq) this.rendering.set(false);
    }
  }
}
