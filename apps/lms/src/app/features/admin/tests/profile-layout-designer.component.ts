import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReportColumn, ReportSection, PageLayoutBox } from '../../../shared/models/report-layout.model';
import type { ReportTemplate } from '../../../shared/models/report.model';
import {
  KNOWN_ANALYZER_IMAGES, MARGIN_X, MIN_BODY_FONT_PT, PAGE, addAnalyzerSlot, analyzerLabel, bodyArea,
  collapseMissingAnalyzerBoxes, detectLayoutIssues, fitMeter, missingAnalyzerWarning, moveBox,
  nudgeBox, readPageLayout, removeBox, resizeBox, setColumnVisible, setColumnWidth, writePageLayout,
  type BodyArea, type PageLayoutIssue,
} from '../../../shared/utils/report-profile-layout';
import { ptToMm } from '../../../shared/utils/report-header-layout';
import {
  computeReportPageLayout, footerFloor, preloadReportImages, renderReportPdfBlobUrl,
} from '../../../shared/utils/report-pdf';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';

/** A profile has no results snapshot at design time — an empty-tests report
 *  still draws the full page chrome (letterhead, patient block, footer),
 *  which is all the designer borrows: the REAL page, read-only/greyed,
 *  exactly like report-header-editor.component.ts renders it (pdf.js → a
 *  canvas) — see its "page rendering" section, reused here rather than
 *  reinvented. */
function blankPreviewSnapshot(): string {
  return JSON.stringify({
    patient: { displayName: 'Sample Patient', age: 30, sex: 'Female' },
    order: { id: 'preview', orderNumber: 'PREVIEW', createdAt: new Date().toISOString() },
    type: 'final',
    tests: [],
  });
}

/** Nudge steps (mm) — same choice the letterhead editor offers. */
const STEPS = [0.5, 1, 5];

/**
 * The profile's ONE-PAGE report layout designer (owner, 2026-10-02) — "exactly
 * like the letterhead editor": click a box to select it, drag it, arrow-key
 * nudge in mm with a step choice, exact mm position/size fields, issue
 * detection. Reuses the SAME geometry/snap/nudge pure functions the
 * letterhead editor (report-header-layout.ts) ships — see
 * shared/utils/report-profile-layout.ts.
 *
 * Header and footer are FIXED (taken from the Report template) — shown here
 * as read-only, greyed bands; only the BODY area between them is editable.
 * This surface does not re-render the tenant's actual letterhead pixel for
 * pixel (that needs the live template + pdf.js, wired in
 * report-header-editor.component.ts already) — it shows the same A4 frame
 * with plain "Letterhead (fixed)" / "Footer (fixed)" bands, which is enough
 * to place boxes correctly since every box position is relative to the BODY
 * area, not the letterhead's own content.
 *
 * Stateless, like report-chart-editor.component: the host (pf-report-structure
 * / the test editor) owns the sections array and autosaves via the existing
 * ReportLayoutService.saveTestLayout — this component only ever emits the
 * whole updated sections array.
 */
@Component({
  selector: 'pf-profile-layout-designer',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pld-host' },
  template: `
  <div class="pld">
    <section class="nd-card pld-main" aria-label="Profile page">
      <div class="nd-card__head">
        <span class="nd-card__label">One-page layout</span>
        <span class="nd-card__note">Click a box to select it. Drag, resize from its corner, or use the arrow keys.</span>
        <div class="pld-tools">
          <label class="nd-toggle" role="switch" [attr.aria-checked]="enabled()">
            <input type="checkbox" hidden [ngModel]="enabled()" (ngModelChange)="setEnabled($event)" />
            <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
            One-page layout
          </label>
          @if (hasDefault()) {
            <button type="button" class="nd-btn nd-btn--secondary" (click)="restoreDefault.emit()">Restore to default</button>
          }
        </div>
      </div>

      <div class="pld-page" [style.width.px]="pageW" [style.height.px]="pageW * (PAGE.h / PAGE.w)">
        <div class="pld-canvas" #canvasHost aria-hidden="true"></div>
        @if (!canvasReady()) {
          <div class="pld-band pld-band--header" [style.height.px]="bodyTopPx()">Letterhead (fixed — from Report template)</div>
          <div class="pld-band pld-band--footer" [style.top.px]="bodyBottomPx()" [style.height.px]="pageW * (PAGE.h / PAGE.w) - bodyBottomPx()">Footer (fixed)</div>
        } @else {
          <!-- The REAL letterhead/footer (pdf.js-rendered, same as the
               letterhead editor) — a grey wash over the top makes clear
               they're read-only here; only the body between them is live. -->
          <div class="pld-grey pld-grey--header" [style.height.px]="bodyTopPx()"></div>
          <div class="pld-grey pld-grey--footer" [style.top.px]="bodyBottomPx()" [style.height.px]="pageW * (PAGE.h / PAGE.w) - bodyBottomPx()"></div>
        }

        <div class="pld-body" [style.top.px]="bodyTopPx()" [style.left.px]="marginPx()" [style.width.px]="bodyWpx()" [style.height.px]="bodyHpx()"
             (pointerdown)="onBodyPointerDown($event)" tabindex="0" role="application"
             aria-label="Profile body. Tab to a box, arrow keys move it, Escape clears the selection."
             (keydown)="onKey($event)">
          @for (box of visibleBoxes(); track box.id) {
            <div class="pld-box" [class.pld-box--sel]="selected() === box.id" [class.pld-box--warn]="warnIds().has(box.id)"
                 [class.pld-box--table]="box.kind === 'table'"
                 [style.left.px]="box.x * scale()" [style.top.px]="box.y * scale()"
                 [style.width.px]="box.w * scale()" [style.height.px]="box.h * scale()"
                 (pointerdown)="onBoxPointerDown($event, box)">
              <span class="pld-box__tag">{{ labelFor(box) }}</span>
              @if (selected() === box.id) {
                <span class="pld-box__handle" (pointerdown)="onResizePointerDown($event, box)" aria-hidden="true"></span>
              }
            </div>
          }
        </div>
      </div>
      <p class="pld-fit" [class.pld-fit--bad]="!fit().fits">
        @if (fit().fits) {
          Fits one page{{ fit().shrinkToPt < (tableBox()?.fontSize ?? 9) ? ' (shrinks to ' + fit().shrinkToPt + ' pt)' : '' }}.
        } @else {
          Doesn't fit even at {{ minFontPt }} pt — the extra rows flow onto a second page.
        }
      </p>
      @if (issues().length) {
        <ul class="pld-issues">
          @for (i of issues(); track $index) { <li [class.pld-issues__warn]="i.level === 'warn'">{{ i.message }}</li> }
        </ul>
      }
    </section>

    <aside class="nd-card pld-side" aria-label="Box settings">
      <div class="nd-card__head"><span class="nd-card__label">{{ selectedBox()?.label ?? (selectedBox() ? kindLabel(selectedBox()!.kind) : 'Boxes') }}</span></div>
      <div class="nd-card__body pld-side__body">
        @if (selectedBox(); as b) {
          <div class="pld-row">
            <label>X (mm) <input class="nd-input nd-num" type="number" step="0.5" [ngModel]="round(b.x)" (ngModelChange)="setPos($event, b.y)" /></label>
            <label>Y (mm) <input class="nd-input nd-num" type="number" step="0.5" [ngModel]="round(b.y)" (ngModelChange)="setPos(b.x, $event)" /></label>
          </div>
          <div class="pld-row">
            <label>Width (mm) <input class="nd-input nd-num" type="number" step="0.5" min="10" [ngModel]="round(b.w)" (ngModelChange)="setSize($event, b.h)" /></label>
            <label>Height (mm) <input class="nd-input nd-num" type="number" step="0.5" min="8" [ngModel]="round(b.h)" (ngModelChange)="setSize(b.w, $event)" /></label>
          </div>
          <div class="nd-seg pld-steps" role="radiogroup" aria-label="Nudge step">
            @for (s of steps; track s) {
              <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="step() === s" (click)="step.set(s)">{{ s }} mm</button>
            }
          </div>
          @if (b.kind === 'table') {
            <h4 class="pld-sec__h">Font size</h4>
            <input class="nd-input nd-num" type="number" step="0.5" [min]="minFontPt" max="14" [ngModel]="b.fontSize ?? 9" (ngModelChange)="setFontSize($event)" />
            <h4 class="pld-sec__h">Columns</h4>
            @for (c of resolvedColumns(); track c.name) {
              <label class="pld-col"><input type="checkbox" [ngModel]="colVisible(b, c.name)" (ngModelChange)="toggleColumn(c.name, $event)" /> {{ c.label }}</label>
            }
          }
          @if (b.kind === 'analyzer') {
            <h4 class="pld-sec__h">Label</h4>
            <input class="nd-input" type="text" [ngModel]="b.label ?? ''" (ngModelChange)="setLabel($event)" />
          }
          @if (b.kind !== 'table' && b.kind !== 'signatures') {
            <button type="button" class="nd-btn nd-btn--danger" (click)="remove(b.id)">Remove this box</button>
          }
        } @else {
          <p class="nd-field__hint">Select a box on the page, or add one below.</p>
          <h4 class="pld-sec__h">Analyzer image slots</h4>
          @for (img of effectiveAnalyzerCodes(); track img) {
            @if (!hasBox('analyzer-' + img)) {
              <button type="button" class="nd-btn nd-btn--secondary pld-add" (click)="addAnalyzer(img)">+ {{ labelForCode(img) }}</button>
            }
          }
          <div class="pld-manual">
            <input class="nd-input" type="text" placeholder="Image code" [ngModel]="manualCode()" (ngModelChange)="manualCode.set($event)" />
            <button type="button" class="nd-btn nd-btn--secondary" [disabled]="!manualCode().trim()" (click)="addManual()">Add slot</button>
          </div>
          @if (!boxes().some(x => x.kind === 'table')) {
            <button type="button" class="nd-btn nd-btn--secondary pld-add" (click)="addTable()">+ Results table</button>
          }
          @if (!boxes().some(x => x.kind === 'signatures')) {
            <button type="button" class="nd-btn nd-btn--secondary pld-add" (click)="addSignatures()">+ Signatures</button>
          }
        }
      </div>
    </aside>
  </div>
  `,
  styles: [`
    .pld { display: grid; grid-template-columns: 1fr 280px; gap: 16px; align-items: start; }
    .pld-main { padding: 12px; }
    .pld-tools { display: flex; gap: 8px; margin-left: auto; align-items: center; }
    .pld-page { position: relative; background: #fff; border: 1px solid #d0d5dd; margin: 10px auto; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .pld-band { position: absolute; left: 0; right: 0; top: 0; background: repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 6px, #e2e8f0 6px, #e2e8f0 12px);
      color: #64748b; font-size: 10px; display: flex; align-items: center; justify-content: center; text-align: center; padding: 2px; }
    .pld-band--footer { bottom: 0; top: auto; }
    .pld-canvas, .pld-canvas ::ng-deep canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .pld-grey { position: absolute; left: 0; right: 0; top: 0; background: rgba(241,245,249,.72); pointer-events: none; }
    .pld-grey--footer { bottom: 0; top: auto; }
    .pld-body { position: absolute; outline: 1px dashed #94a3b8; }
    .pld-box { position: absolute; border: 1px solid #64748b; background: rgba(59,130,246,.08); cursor: move; box-sizing: border-box; }
    .pld-box--table { background: rgba(16,185,129,.08); }
    .pld-box--sel { border-color: #2563eb; border-width: 2px; z-index: 2; }
    .pld-box--warn { border-color: #dc2626; }
    .pld-box__tag { position: absolute; top: 2px; left: 4px; font-size: 9px; color: #334155; pointer-events: none; }
    .pld-box__handle { position: absolute; right: -4px; bottom: -4px; width: 10px; height: 10px; background: #2563eb; border-radius: 2px; cursor: nwse-resize; }
    .pld-fit { margin: 8px 0 0; font-size: 12.5px; color: var(--color-success, #16a34a); }
    .pld-fit--bad { color: var(--color-danger, #dc2626); }
    .pld-issues { margin: 6px 0 0; padding-left: 18px; font-size: 12px; color: var(--text-tertiary); }
    .pld-issues__warn { color: var(--color-danger, #dc2626); }
    .pld-side__body { display: flex; flex-direction: column; gap: 10px; color: var(--text-primary); }
    .pld-row { display: flex; gap: 8px; }
    .pld-row label { flex: 1; font-size: 11px; color: var(--text-tertiary); display: flex; flex-direction: column; gap: 2px; }
    .pld-sec__h { margin: 4px 0 0; font-size: 11px; font-weight: 600; color: var(--text-secondary); }
    .pld-col { display: flex; gap: 6px; align-items: center; font-size: 12.5px; color: var(--text-primary); }
    .pld-add { display: block; width: 100%; text-align: left; margin-top: 4px; }
    .pld-manual { display: flex; gap: 6px; margin-top: 6px; }
    .pld-steps { margin-top: 4px; }
  `],
})
export class ProfileLayoutDesignerComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly platform = inject(PlatformService);
  private readonly layoutSvc = inject(ReportLayoutService);

  readonly sections = input.required<ReportSection[]>();
  readonly resolvedColumns = input<ReportColumn[]>([]);
  /** This profile's own test id — used ONLY to ask the server which
   *  instrument codes have actually been attached to its recent results
   *  (generic — not CBC-specific; any profile whose member tests carry
   *  instrument-tagged attachments offers them here). */
  readonly profileTestId = input<string | null>(null);
  /** Fallback/override analyzer codes — the known M51 catalogue by default.
   *  Used whenever nothing has been SEEN yet (see effectiveAnalyzerCodes). */
  readonly availableAnalyzerCodes = input<string[]>(KNOWN_ANALYZER_IMAGES.map(i => i.code));
  private readonly seenAnalyzerCodes = signal<string[]>([]);
  /** Codes actually attached to recent results, falling back to the known
   *  M51 suggestions (or the host's override) when none have been seen. */
  readonly effectiveAnalyzerCodes = computed(() =>
    this.seenAnalyzerCodes().length ? this.seenAnalyzerCodes() : this.availableAnalyzerCodes());
  /** Codes with an image actually ATTACHED right now (sample preview) — used
   *  only for the live fit/issue preview; absent = assume all attached (the
   *  designer, unlike the printed report, doesn't collapse missing boxes by
   *  default, so the lab can still see and arrange them). */
  readonly previewAttachedCodes = input<string[] | null>(null);
  readonly sampleRowCount = input<number>(20);
  readonly hasDefault = input<boolean>(false);

  readonly sectionsChange = output<ReportSection[]>();
  readonly restoreDefault = output<void>();

  private readonly cfg = computed(() => readPageLayout(this.sections()));
  readonly enabled = computed(() => this.cfg()?.enabled ?? false);
  readonly boxes = signal<PageLayoutBox[]>([]);
  private readonly lastSections = signal<ReportSection[] | null>(null);

  // ── real letterhead/footer (pdf.js, page 1 — same technique as
  // report-header-editor.component.ts's "page rendering" section) ────────
  private readonly template = signal<ReportTemplate | null | undefined>(undefined);
  private readonly imageCache = signal<Record<string, string>>({});
  readonly pdfUrl = signal<string | null>(null);
  readonly canvasReady = signal(false);
  private readonly canvasHost = viewChild<ElementRef<HTMLDivElement>>('canvasHost');
  private renderToken = 0;
  private lastBlobUrl: string | null = null;

  constructor() {
    effect(() => {
      const sections = this.sections();
      if (sections === this.lastSections()) return; // our own emit — don't re-sync and fight the host's debounce
      const cfg = readPageLayout(sections);
      this.boxes.set(cfg?.boxes.length ? cfg.boxes : this.blankDefault());
    });
    this.api.get<ReportTemplate>('/api/config/report-template').subscribe({
      next: t => this.template.set(t ?? null),
      error: () => this.template.set(null),
    });
    effect(() => {
      const tpl = this.template();
      if (tpl === undefined) return; // still loading
      void this.buildPreview(tpl);
    });
    effect(() => {
      const url = this.pdfUrl();
      const host = this.canvasHost()?.nativeElement;
      if (url && host) void this.drawPage(url, host);
    });
    effect(() => {
      const id = this.profileTestId();
      if (!id) { this.seenAnalyzerCodes.set([]); return; }
      this.layoutSvc.analyzerCodesSeen(id).then(codes => this.seenAnalyzerCodes.set(codes));
    });
  }

  ngOnDestroy(): void { if (this.lastBlobUrl) URL.revokeObjectURL(this.lastBlobUrl); }

  private async buildPreview(tpl: ReportTemplate | null): Promise<void> {
    const baseInput = { report: { id: 'pld-preview', type: 'final', data: blankPreviewSnapshot() }, template: tpl };
    try {
      const imageCache = await preloadReportImages(baseInput, this.platform.getApiUrl());
      this.imageCache.set(imageCache);
      if (this.lastBlobUrl) URL.revokeObjectURL(this.lastBlobUrl);
      const url = renderReportPdfBlobUrl({ ...baseInput, imageCache });
      this.lastBlobUrl = url;
      this.pdfUrl.set(url);
    } catch { /* keep the plain greyed frame — outlines/placement still work */ }
  }

  /** pdf.js → canvas, page 1 — identical approach to
   *  report-header-editor.component.ts's drawPage(). */
  private async drawPage(url: string, host: HTMLDivElement): Promise<void> {
    const my = ++this.renderToken;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfjs: any = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';
      const buf = await fetch(url).then(r => r.arrayBuffer());
      if (my !== this.renderToken) return;
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      const page = await doc.getPage(1);
      if (my !== this.renderToken) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (this.pageW / base.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
      if (my !== this.renderToken) return;
      host.replaceChildren(canvas);
      this.canvasReady.set(true);
    } catch { /* keep the plain greyed frame */ }
  }

  readonly selected = signal<string | null>(null);
  readonly step = signal<number>(1);
  readonly manualCode = signal('');
  protected readonly steps = STEPS;
  protected readonly PAGE = PAGE;
  protected readonly minFontPt = MIN_BODY_FONT_PT;

  readonly pageW = 480;
  /** px per PDF point (the page is drawn at `pageW` px wide for PAGE.w pt). */
  private readonly pxPerPt = computed(() => this.pageW / PAGE.w);
  /** px per BOX-mm — every box's x/y/w/h is stored in mm; 1 mm = 2.834645669 pt. */
  readonly scale = computed(() => this.pxPerPt() * 2.834645669);

  /** The REAL body bounds for the tenant's actual template — the SAME
   *  geometry report-pdf.ts prints with (computeReportPageLayout / footerFloor,
   *  the same functions report-header-editor.component.ts's own `layout`
   *  computed uses). A generic classic-template fallback only until the
   *  template has loaded. */
  private readonly FALLBACK_BODY_TOP = 98;     // MARGIN_TOP(28) + 70, report-header-layout.ts
  private readonly FALLBACK_FOOTER_TOP = PAGE.h - 64; // PAGE.h - FOOTER_AREA_H
  readonly realLayout = computed(() => {
    const tpl = this.template();
    if (tpl === undefined) return null; // still loading
    return computeReportPageLayout({ report: { id: 'pld-layout', type: 'final', data: '{}' }, template: tpl, imageCache: this.imageCache() });
  });
  private readonly realBodyTop = computed(() => this.realLayout()?.bodyTop ?? this.FALLBACK_BODY_TOP);
  private readonly realFooterTop = computed(() => {
    const l = this.realLayout();
    return l ? PAGE.h - footerFloor(l) : this.FALLBACK_FOOTER_TOP;
  });
  readonly body = computed((): BodyArea => bodyArea(this.realBodyTop(), this.realFooterTop()));

  bodyTopPx(): number { return this.realBodyTop() * this.pxPerPt(); }
  bodyBottomPx(): number { return this.realFooterTop() * this.pxPerPt(); }
  marginPx(): number { return MARGIN_X * this.pxPerPt(); }
  bodyWpx(): number { return this.body().w * this.pxPerPt(); }
  bodyHpx(): number { return this.body().h * this.pxPerPt(); }
  /** Alias used by the drag/resize handlers below (same value as `scale`). */
  private readonly mmToPx = this.scale;

  readonly visibleBoxes = computed(() => {
    const attached = this.previewAttachedCodes();
    if (!attached) return this.boxes();
    return collapseMissingAnalyzerBoxes(this.boxes(), new Set(attached), this.body()).boxes;
  });
  readonly tableBox = computed(() => this.boxes().find(b => b.kind === 'table') ?? null);
  readonly fit = computed(() => {
    const t = this.tableBox();
    if (!t) return { fits: true, shrinkToPt: 9, overflowsToPage2: false, estimatedRows: 0 };
    return fitMeter(this.sampleRowCount(), t.h * 2.834645669, t.fontSize ?? 9);
  });
  readonly issues = computed((): PageLayoutIssue[] => {
    const attached = this.previewAttachedCodes();
    const missing = attached ? missingAnalyzerWarning(this.boxes(), new Set(attached)) : [];
    return [...detectLayoutIssues(this.visibleBoxes(), this.body()), ...missing];
  });
  readonly warnIds = computed(() => new Set(this.issues().filter(i => i.level === 'warn').map(i => i.boxId)));
  readonly selectedBox = computed(() => this.boxes().find(b => b.id === this.selected()) ?? null);

  kindLabel(k: PageLayoutBox['kind']): string {
    return k === 'table' ? 'Results table' : k === 'signatures' ? 'Signatures' : k === 'notes' ? 'Notes' : k === 'chart' ? 'Chart' : 'Analyzer image';
  }
  labelFor(b: PageLayoutBox): string { return b.label ?? this.kindLabel(b.kind); }
  labelForCode(code: string): string { return analyzerLabel(code); }
  hasBox(id: string): boolean { return this.boxes().some(b => b.id === id); }
  colVisible(b: PageLayoutBox, name: string): boolean { return b.columns?.find(c => c.name === name)?.visible ?? true; }
  round(n: number): number { return Math.round(n * 10) / 10; }

  private emit(boxes: PageLayoutBox[]): void {
    this.boxes.set(boxes);
    const next = writePageLayout(this.sections(), { enabled: this.enabled(), boxes });
    this.lastSections.set(next);
    this.sectionsChange.emit(next);
  }
  setEnabled(on: boolean): void {
    const next = writePageLayout(this.sections(), { enabled: on, boxes: this.boxes() });
    this.lastSections.set(next);
    this.sectionsChange.emit(next);
  }
  select(id: string | null): void { this.selected.set(id); }
  setPos(x: number, y: number): void {
    const id = this.selected(); if (!id) return;
    const b = this.boxes().find(x2 => x2.id === id); if (!b) return;
    this.emit(this.boxes().map(x2 => (x2.id === id ? { ...x2, x, y } : x2)));
  }
  setSize(w: number, h: number): void {
    const id = this.selected(); if (!id) return;
    this.emit(resizeBox(this.boxes(), id, w, h, this.body()));
  }
  setFontSize(v: number): void {
    const id = this.selected(); if (!id) return;
    this.emit(this.boxes().map(b => (b.id === id ? { ...b, fontSize: Math.max(MIN_BODY_FONT_PT, Math.min(14, v)) } : b)));
  }
  setLabel(v: string): void {
    const id = this.selected(); if (!id) return;
    this.emit(this.boxes().map(b => (b.id === id ? { ...b, label: v } : b)));
  }
  toggleColumn(name: string, visible: boolean): void {
    const id = this.selected(); if (!id) return;
    this.emit(setColumnVisible(this.boxes(), id, name, visible));
  }
  setColumnWidthPct(name: string, width: number): void {
    const id = this.selected(); if (!id) return;
    this.emit(setColumnWidth(this.boxes(), id, name, width));
  }
  remove(id: string): void {
    this.emit(removeBox(this.boxes(), id));
    if (this.selected() === id) this.selected.set(null);
  }
  addAnalyzer(code: string): void {
    this.emit(addAnalyzerSlot(this.boxes(), code, this.body()));
  }
  addManual(): void {
    const code = this.manualCode().trim();
    if (!code) return;
    this.emit(addAnalyzerSlot(this.boxes(), code, this.body()));
    this.manualCode.set('');
  }
  addTable(): void {
    this.emit([...this.boxes(), { id: 'table', kind: 'table', x: 0, y: 0, w: 80, h: 100, fontSize: 9 }]);
  }
  addSignatures(): void {
    this.emit([...this.boxes(), { id: 'signatures', kind: 'signatures', x: 0, y: ptToMm(this.body().h) - 24, w: ptToMm(this.body().w), h: 24 }]);
  }

  /** A profile with no saved layout starts from a plain table + signatures —
   *  generic, not CBC-shaped (only CBC's "Restore to default" pulls the
   *  catalogue's 4-analyzer-image arrangement). */
  private blankDefault(): PageLayoutBox[] {
    const b = this.body();
    const wMm = ptToMm(b.w), hMm = ptToMm(b.h), sigH = 24, gap = 4;
    return [
      { id: 'table', kind: 'table', x: 0, y: 0, w: wMm, h: Math.max(10, hMm - sigH - gap), fontSize: 9 },
      { id: 'signatures', kind: 'signatures', x: 0, y: Math.max(10, hMm - sigH - gap) + gap, w: wMm, h: sigH },
    ];
  }

  onBodyPointerDown(ev: PointerEvent): void {
    if (ev.target === ev.currentTarget) this.select(null);
  }
  onBoxPointerDown(ev: PointerEvent, box: PageLayoutBox): void {
    ev.stopPropagation();
    if (this.selected() !== box.id) { this.select(box.id); return; }
    const el = ev.currentTarget as HTMLElement;
    const sx = ev.clientX, sy = ev.clientY;
    const startX = box.x, startY = box.y;
    try { el.setPointerCapture(ev.pointerId); } catch { /* jsdom */ }
    const onMove = (e: PointerEvent) => {
      const dxMm = (e.clientX - sx) / this.mmToPx(), dyMm = (e.clientY - sy) / this.mmToPx();
      const { boxes } = moveBox(this.boxes(), box.id, startX + dxMm, startY + dyMm, this.body());
      this.boxes.set(boxes);
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      this.emit(this.boxes());
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }
  onResizePointerDown(ev: PointerEvent, box: PageLayoutBox): void {
    ev.stopPropagation();
    const sx = ev.clientX, sy = ev.clientY;
    const startW = box.w, startH = box.h;
    const el = ev.currentTarget as HTMLElement;
    try { el.setPointerCapture(ev.pointerId); } catch { /* jsdom */ }
    const onMove = (e: PointerEvent) => {
      const dwMm = (e.clientX - sx) / this.mmToPx(), dhMm = (e.clientY - sy) / this.mmToPx();
      this.boxes.set(resizeBox(this.boxes(), box.id, startW + dwMm, startH + dhMm, this.body()));
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      this.emit(this.boxes());
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }
  onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') { this.select(null); return; }
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[ev.key];
    const id = this.selected();
    if (!d || !id) return;
    ev.preventDefault();
    const s = ev.shiftKey ? 5 : this.step();
    const { boxes } = nudgeBox(this.boxes(), id, d[0] * s, d[1] * s, this.body());
    this.emit(boxes);
  }
}
