import { ReportSignatureCardComponent } from './report-signature-card.component';
import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UploadsService } from '../../../core/services/uploads.service';
import { normalizeHeaderPreset, ReportTemplate } from '../../../shared/models/report.model';
import { computeReportPageLayout } from '../../../shared/utils/report-pdf';
import {
  Align, BG_MAX_UPLOAD_BYTES, BackgroundImage, BgArea, BgFit, HeaderField, HeaderLayoutConfig, ItemOverride, LayoutIssue,
  LayoutItem, LayoutRegion, MARGIN_TOP, MARGIN_X, MAX_BACKGROUNDS, MM, PAGE, ResolvedBackground, addBackground, detectIssues,
  downscaleSize, pageSnapContext, positionReadout, ptToMm, readHeaderLayout, removeBackground, resetItem, setBackground,
  setItem, validateBackgroundFile, writeHeaderLayout,
} from '../../../shared/utils/report-header-layout';
import {
  NO_GUIDES, nudgeStop, snapMove, snappingOn, tolFromPx, type SnapContext, type SnapGuides, type SnapRect,
} from '../../../shared/utils/layout-snap';
import { SnapGuidesComponent } from '../../../shared/components/snap-guides.component';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { PlatformService } from '../../../core/services/platform.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ImageUploadComponent } from './image-upload.component';
import { ReportLetterheadCardComponent, type LetterheadFileKind } from './report-letterhead-card.component';
import { measureStationery, readImagePixels } from '../../../shared/utils/report-background-measure';
import {
  LH_SCAN_ID, applyLetterheadPreset, letterheadPresetOf, setLetterheadContinuation, setLetterpadMm,
  type LetterheadContinuation, type LetterheadPresetId,
} from '../../../shared/utils/report-letterhead';
import { DialogService } from '../../../core/services/dialog.service';

/** Template text field each element edits (content lives on the template). */
const FIELD_KEY: Record<string, keyof ReportTemplate> = {
  name: 'labName', tagline: 'tagline', address: 'address', phone: 'phone', email: 'email', website: 'website',
  disclaimer: 'disclaimer', footerText: 'footerText',
};
const FIELD_LABEL: Record<string, string> = {
  logo: 'Logo', name: 'Lab name', tagline: 'Tagline', address: 'Address', phone: 'Phone', email: 'Email',
  website: 'Website', contact: 'Contact line', nabl: 'NABL badge', accentBar: 'Accent bar', banner: 'Banner',
  disclaimer: 'Disclaimer', footerText: 'Footer text',
};
const JOINABLE: HeaderField[] = ['address', 'phone', 'email', 'website'];
const PRESETS = [
  { value: 'classic', label: 'Classic' }, { value: 'centered', label: 'Centered' },
  { value: 'banner', label: 'Banner' }, { value: 'minimal', label: 'Minimal' },
];
/** Nudge steps (mm): the pad's step choice; arrows = step, Shift+arrows = 5 mm. */
const STEPS = [0.5, 1, 5];

type EntryState = 'shown' | 'hidden' | 'joined' | 'notPrinted' | 'empty' | 'off';
interface Entry { id: string; label: string; value: string; state: EntryState; item?: LayoutItem; joinedIn?: string; warn: boolean }

/**
 * WYSIWYG letterhead / footer designer (owner, 2026-09-27: "make things
 * clearer, so the user can see where things are in the preview and arrange
 * them — left/right, more pixels — crystal clear").
 *
 * The page on the left IS the real report: page 1 of the PDF the renderer
 * produces (pdf.js → canvas). Over it sit outlines for every letterhead /
 * footer element, placed from the SAME resolved layout the PDF was drawn with
 * (computeReportPageLayout) — click one to select it, drag it, or nudge it
 * with the arrow keys; guides show the printable margins, the centre line and
 * where the patient details start. While moving, smart guides (layout-snap.ts,
 * the engine the profile Custom layout designer shares) line the element up
 * with the other elements and the background images / logos on both axes;
 * Alt (Option) held places it freely. The side card edits the selected element:
 * its text, show/hide, alignment, exact position in mm, size, bold and line
 * width, with a warning when it will wrap, overflow or collide. With nothing
 * selected it lists every element (the phone view) plus the page settings.
 *
 * Every change is a template patch (text fields) or a layout-override patch
 * (`metadata.headerLayout`) emitted to the parent, which owns save / undo.
 */
@Component({
  selector: 'pf-report-header-editor',
  standalone: true,
  imports: [FormsModule, RouterLink, ImageUploadComponent, SnapGuidesComponent, ReportLetterheadCardComponent, ReportSignatureCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-rhe-host', '[class.pf-rhe-host--flat]': 'flat()' },
  template: `
  <div class="pf-rhe" [class.pf-rhe--footer]="region() === 'footer'" [class.pf-rhe--guides]="guides()">
    <!-- ══ MAIN CARD: the page ══ -->
    <section class="pf-card pf-rhe-main" aria-label="Report page">
      <div class="pf-card__head pf-rhe-main__head">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>
        </span>
        <span class="pf-card__label">{{ region() === 'footer' ? 'Footer' : 'Letterhead' }}</span>
        <span class="pf-card__note">Click anything on the page to edit it. Drag, or use the arrow keys, to move it.</span>
        <div class="pf-rhe-tools">
          <button type="button" class="pf-btn pf-btn--icon pf-rhe-tool" [disabled]="!canUndo()" (click)="undo.emit()"
                  aria-label="Undo" title="Undo (Ctrl+Z)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
          </button>
          <button type="button" class="pf-btn pf-btn--icon pf-rhe-tool" [disabled]="!canRedo()" (click)="redo.emit()"
                  aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
          </button>
          <div class="pf-seg pf-rhe-zoom" role="radiogroup" aria-label="Zoom">
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="zoom() === 1" (click)="setZoom(1)">Whole page</button>
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="zoom() === 2" (click)="setZoom(2)">Zoom 200%</button>
          </div>
          <button type="button" class="pf-toggle pf-rhe-guides" role="switch" [attr.aria-checked]="guides()" (click)="guides.set(!guides())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>Guides
          </button>
        </div>
      </div>

      <div class="pf-rhe-viewport" #viewport>
        <div class="pf-rhe-page" #page [style.width.px]="pageW()" [style.height.px]="pageW() * PAGE_RATIO"
             tabindex="0" role="application"
             aria-label="Report page. Tab to an element, arrow keys move the selected element, Escape clears the selection."
             (keydown)="onKey($event)" (pointerdown)="onPagePointerDown($event)">
          <div class="pf-rhe-canvas" #canvasHost aria-hidden="true"></div>
          @if (!canvasReady()) { <div class="pf-rhe-loading">Rendering the page…</div> }

          <!-- Guides: printable margins, centre line, where the patient details start. -->
          @if (guides()) {
            <div class="pf-rhe-guide pf-rhe-guide--v" [style.left.px]="MARGIN_X * scale()" aria-hidden="true"></div>
            <div class="pf-rhe-guide pf-rhe-guide--v" [style.left.px]="(PAGE.w - MARGIN_X) * scale()" aria-hidden="true"></div>
            <div class="pf-rhe-guide pf-rhe-guide--v pf-rhe-guide--centre" [style.left.px]="PAGE.w / 2 * scale()" aria-hidden="true"></div>
            @if (region() === 'header') {
              <div class="pf-rhe-guide pf-rhe-guide--body" [style.top.px]="layout().bodyTop * scale()" aria-hidden="true">
                <span class="pf-rhe-guide__tag">Patient details start · {{ mm(layout().bodyTop) }} mm{{ layout().bodyTopAuto ? ' (auto)' : '' }}</span>
              </div>
              @if (template().letterpadMode && layout().letterpad; as lp) {
                <div class="pf-rhe-letterpad" [style.height.px]="lp.top * scale()" aria-hidden="true">
                  <span class="pf-rhe-guide__tag">Pre-printed letterhead area · {{ mm(lp.top) }} mm (left blank when printing on letterhead paper)</span>
                </div>
              }
            }
          }
          <!-- Smart guides: what the moving element lines up with (always, Guides on or off). -->
          <pf-snap-guides [guides]="smart()" [pxPerUnit]="scale()" [mmPerUnit]="MM_PER_PT" />

          <!-- Background images — under every element outline (and under the print). -->
          @for (bg of layout().backgrounds; track bg.id) {
            <button type="button" class="pf-rhe-box pf-rhe-box--bgimg"
                    [class.pf-rhe-box--sel]="selected() === 'bg:' + bg.id"
                    [class.pf-rhe-box--hidden]="bg.hidden"
                    [class.pf-rhe-box--drag]="drag()?.id === 'bg:' + bg.id"
                    [style.left.px]="bg.box.x * scale()" [style.top.px]="bg.box.y * scale()"
                    [style.width.px]="bg.box.w * scale()" [style.height.px]="bg.box.h * scale()"
                    [style.transform]="drag()?.id === 'bg:' + bg.id ? 'translate(' + drag()!.dxPx + 'px,' + drag()!.dyPx + 'px)' : null"
                    [attr.aria-label]="bg.label + (bg.hidden ? ' (hidden)' : '') + (selected() === 'bg:' + bg.id ? ', selected' : '')"
                    [attr.aria-pressed]="selected() === 'bg:' + bg.id"
                    (pointerdown)="onBgPointerDown($event, bg)" (click)="$event.stopPropagation()"
                    (focus)="focusSelect('bg:' + bg.id)">
              <span class="pf-rhe-box__tag">{{ bg.label }}@if (bg.hidden) { · hidden }</span>
              @if (drag()?.id === 'bg:' + bg.id) { <span class="pf-rhe-box__live pf-num">{{ dragReadoutBg(bg) }}</span> }
            </button>
          }

          <!-- Element outlines — the same boxes the PDF was drawn with. -->
          @for (it of regionItems(); track it.id) {
            <button type="button" class="pf-rhe-box"
                    [class.pf-rhe-box--sel]="selected() === it.id"
                    [class.pf-rhe-box--hidden]="it.hidden"
                    [class.pf-rhe-box--warn]="warnIds().has(it.id)"
                    [class.pf-rhe-box--bg]="it.kind === 'banner'"
                    [class.pf-rhe-box--drag]="drag()?.id === it.id"
                    [class.pf-rhe-box--r]="it.box.x + it.box.w / 2 > PAGE.w / 2"
                    [style.left.px]="boxPx(it).x" [style.top.px]="boxPx(it).y"
                    [style.width.px]="boxPx(it).w" [style.height.px]="boxPx(it).h"
                    [style.transform]="drag()?.id === it.id ? 'translate(' + drag()!.dxPx + 'px,' + drag()!.dyPx + 'px)' : null"
                    [attr.aria-label]="it.label + (it.hidden ? ' (hidden)' : '') + (selected() === it.id ? ', selected' : '')"
                    [attr.aria-pressed]="selected() === it.id"
                    (pointerdown)="onBoxPointerDown($event, it)"
                    (click)="$event.stopPropagation()"
                    (focus)="focusSelect(it.id)">
              <span class="pf-rhe-box__tag">
                {{ it.label }}@if (it.hidden) { · hidden }
                @if (warnIds().has(it.id)) {
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
                }
              </span>
              @if (drag()?.id === it.id) {
                <span class="pf-rhe-box__live pf-num">{{ dragReadout() }}</span>
              }
            </button>
          }
        </div>
      </div>
      <p class="pf-rhe-foot-note">
        @if (rendering()) { Updating the page… } @else { This is page 1 of the real report, with sample results. Save to apply it to every report. }
      </p>
    </section>

    <!-- ══ SIDE CARD: the selected element, or every element + page settings ══ -->
    <aside class="pf-card pf-rhe-side" aria-label="Element settings">
      <div class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>
        </span>
        <span class="pf-card__label">{{ selBg() ? selBg()!.label : sel() ? sel()!.label : (region() === 'footer' ? 'Footer elements' : 'Letterhead elements') }}</span>
        <span class="pf-card__spacer"></span>
        @if (sel() || selBg()) {
          <button type="button" class="pf-btn pf-btn--quiet" (click)="select(null)" aria-label="Back to all elements">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
            All elements
          </button>
        }
      </div>

      <div class="pf-card__body pf-rhe-side__body" #sideBody>
        @if (selBg(); as b) {
          <!-- ── Selected background image ── -->
          <div class="pf-rhe-bgthumb">
            <span class="pf-rhe-bgthumb__img">
              @if (imageCache()[b.url]; as src) { <img [src]="src" alt="" /> } @else { <span>Loading…</span> }
            </span>
            <div class="pf-rhe-bgthumb__act">
              <label class="pf-btn pf-btn--secondary pf-rhe-file" [class.pf-rhe-file--busy]="bgBusy()">
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden (change)="onBgPick($event, b.id)" [disabled]="bgBusy()" />
                {{ bgBusy() ? 'Uploading…' : 'Replace image' }}
              </label>
              <button type="button" class="pf-btn pf-btn--danger" (click)="removeBg(b.id)">Remove</button>
            </div>
          </div>
          @if (bgError()) { <p class="pf-rhe-err" role="alert">{{ bgError() }}</p> }
          <p class="pf-field__hint">Backgrounds always print behind the text, logo and results — never over them.</p>

          <div class="pf-rhe-row">
            <div><p class="pf-rhe-row__t">Print this</p><p class="pf-rhe-row__s">{{ b.hidden ? 'Hidden — not printed' : 'Printed' }}</p></div>
            <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="!b.hidden" aria-label="Print this background"
                    (click)="patchBg(b.id, { hidden: b.hidden ? undefined : true })">
              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
            </button>
          </div>

          <section class="pf-rhe-sec" aria-label="Where">
            <h4 class="pf-rhe-sec__h">Fills</h4>
            <div class="pf-seg pf-rhe-wrapseg" role="radiogroup" aria-label="Area">
              @for (a of bgAreas; track a.value) {
                <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="b.area === a.value"
                        (click)="patchBg(b.id, { area: a.value, x: undefined, y: undefined })">{{ a.label }}</button>
              }
            </div>
            <h4 class="pf-rhe-sec__h">Fit</h4>
            <div class="pf-seg pf-rhe-wrapseg" role="radiogroup" aria-label="Fit">
              @for (f of bgFits; track f.value) {
                <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="b.fit === f.value"
                        (click)="patchBg(b.id, { fit: f.value, x: undefined, y: undefined })">{{ f.label }}</button>
              }
            </div>
            <p class="pf-field__hint">{{ fitHint(b.fit) }}</p>
            <h4 class="pf-rhe-sec__h">Size</h4>
            <div class="pf-rhe-slider">
              <input type="range" min="10" max="300" step="1" [ngModel]="b.scale" (ngModelChange)="setBgScale(b.id, +$event)" aria-label="Background size in percent" />
              <label class="pf-rhe-num"><input class="pf-input pf-num" type="number" min="10" max="300" [ngModel]="b.scale"
                     (change)="setBgScale(b.id, +$any($event.target).value)" aria-label="Background size value" /><span>%</span></label>
            </div>
          </section>

          <section class="pf-rhe-sec" aria-label="Opacity">
            <h4 class="pf-rhe-sec__h">Opacity</h4>
            <div class="pf-rhe-slider">
              <input type="range" min="5" max="100" step="1" [ngModel]="round(b.opacity * 100)" (ngModelChange)="setBgOpacity(b.id, +$event)" aria-label="Opacity in percent" />
              <label class="pf-rhe-num"><input class="pf-input pf-num" type="number" min="5" max="100" [ngModel]="round(b.opacity * 100)"
                     (change)="setBgOpacity(b.id, +$any($event.target).value)" aria-label="Opacity value" /><span>%</span></label>
            </div>
            <p class="pf-field__hint">Lower it for a faint watermark (15–25% reads well behind results).</p>
          </section>

          <section class="pf-rhe-sec" aria-label="Pages">
            <h4 class="pf-rhe-sec__h">Pages</h4>
            <div class="pf-seg" role="radiogroup" aria-label="Pages">
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="b.pages === 'first'" (click)="patchBg(b.id, { pages: 'first' })">First page only</button>
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="b.pages === 'all'" (click)="patchBg(b.id, { pages: 'all' })">Every page</button>
            </div>
            <div class="pf-rhe-row pf-rhe-row--flat">
              <div><p class="pf-rhe-row__t">Also print on letterhead paper</p>
                <p class="pf-rhe-row__s">Off: left out when you print on your pre-printed paper (it already has the design). Plain-paper prints, downloads, WhatsApp, the QR link and archived PDFs always include it.</p></div>
              <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="b.onLetterhead" aria-label="Also print on letterhead paper"
                      (click)="patchBg(b.id, { onLetterhead: b.onLetterhead ? undefined : true })">
                <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
              </button>
            </div>
          </section>

          <section class="pf-rhe-sec" aria-label="Position">
            <h4 class="pf-rhe-sec__h">Position</h4>
            <p class="pf-rhe-readout pf-num">{{ b.moved ? 'Moved by you' : 'Centred in its area' }} · top-left {{ mm(b.rect.x) }} mm, {{ mm(b.rect.y) }} mm</p>
            <div class="pf-rhe-nudge">
              <div class="pf-rhe-pad" role="group" aria-label="Move background">
                <button type="button" class="pf-btn pf-btn--icon pf-rhe-pad__up" (click)="nudge(0, -step())" aria-label="Move up">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button>
                <button type="button" class="pf-btn pf-btn--icon pf-rhe-pad__left" (click)="nudge(-step(), 0)" aria-label="Move left">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
                <button type="button" class="pf-btn pf-btn--icon pf-rhe-pad__right" (click)="nudge(step(), 0)" aria-label="Move right">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
                <button type="button" class="pf-btn pf-btn--icon pf-rhe-pad__down" (click)="nudge(0, step())" aria-label="Move down">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
              </div>
              <div class="pf-rhe-step">
                <span class="pf-field__lbl">Step</span>
                <div class="pf-seg" role="radiogroup" aria-label="Step size">
                  @for (st of steps; track st) {
                    <button type="button" class="pf-seg__item pf-num" role="radio" [attr.aria-checked]="step() === st" (click)="step.set(st)">{{ st }} mm</button>
                  }
                </div>
              </div>
            </div>
            <div class="pf-rhe-grid2">
              <label class="pf-field"><span class="pf-field__lbl">From left edge (mm)</span>
                <input class="pf-input pf-num" type="number" step="0.5" [ngModel]="round(ptToMm(b.rect.x))" (change)="setBgPos(b.id, 'x', $any($event.target).value)" /></label>
              <label class="pf-field"><span class="pf-field__lbl">From top edge (mm)</span>
                <input class="pf-input pf-num" type="number" step="0.5" [ngModel]="round(ptToMm(b.rect.y))" (change)="setBgPos(b.id, 'y', $any($event.target).value)" /></label>
            </div>
            <button type="button" class="pf-btn pf-btn--tertiary" [disabled]="!b.moved && b.scale === 100" (click)="patchBg(b.id, { x: undefined, y: undefined, scale: undefined })">Centre it again at 100%</button>
          </section>
        } @else if (sel(); as s) {
          <!-- ── Selected element ── -->
          @if (issuesFor(s.id).length) {
            <ul class="pf-rhe-issues" role="status">
              @for (iss of issuesFor(s.id); track iss.message) {
                <li [class.pf-rhe-issue--info]="iss.level === 'info'">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    @if (iss.level === 'info') { <circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/> }
                    @else { <path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/> }
                  </svg>
                  <span>{{ iss.message }}
                    @if (iss.kind === 'overflow' && s.item?.kind === 'text') {
                      <button type="button" class="pf-btn pf-btn--quiet pf-rhe-fix" (click)="fitInside(s.id)">Fit it inside the page</button>
                    }
                    @if (iss.kind === 'body') {
                      <button type="button" class="pf-btn pf-btn--quiet pf-rhe-fix" (click)="setBodyTop(null)">Start the patient details below it</button>
                    }
                  </span>
                </li>
              }
            </ul>
          }

          <!-- Content -->
          @if (s.id === 'name') {
            <!-- The lab name is set ONCE in Organization profile (Settings re-home); shown here read-only. -->
            <div class="pf-field" data-testid="rhe-name-ro">
              <span class="pf-field__lbl">Text</span>
              <p class="pf-rhe-ro">{{ template().labName || 'No name set yet' }}</p>
              <span class="pf-field__hint">Set once for the whole app. <a routerLink="/admin/org/profile" class="pf-rhe-ro__link">Change in Organization profile</a></span>
            </div>
          } @else if (fieldKey(s.id); as key) {
            <label class="pf-field">
              <span class="pf-field__lbl">{{ s.id === 'address' ? 'Address — press Enter for a new line' : 'Text' }}</span>
              @if (multiline(s.id)) {
                <textarea class="pf-input pf-rhe-ta" rows="3" [ngModel]="$any(template())[key] ?? ''"
                          (ngModelChange)="setText(key, $event)"></textarea>
              } @else {
                <input class="pf-input" [ngModel]="$any(template())[key] ?? ''" (ngModelChange)="setText(key, $event)" />
              }
              @if (s.id === 'tagline') { <span class="pf-field__hint">A "|" prints as an accent-coloured divider in Classic and Centered.</span> }
              @if (s.state === 'empty') { <span class="pf-field__hint">Empty — type it to print it on the letterhead.</span> }
            </label>
          }
          @if (s.id.startsWith('line:')) {
            <label class="pf-field">
              <span class="pf-field__lbl">Text (registration no., GSTIN, timings…)</span>
              <textarea class="pf-input pf-rhe-ta" rows="2" [ngModel]="lineText(s.id)" (ngModelChange)="setLineText(s.id, $event)"></textarea>
            </label>
          }
          @if (s.state === 'joined') {
            <div class="pf-rhe-row">
              <p class="pf-rhe-row__s">Printed inside the {{ label(s.joinedIn ?? 'contact').toLowerCase() }}. Give it its own line to move, align or size it by itself.</p>
              <button type="button" class="pf-btn pf-btn--secondary" (click)="moveToOwnLine($any(s.id))">Own line</button>
            </div>
          }
          @if (s.id === 'contact' && s.item) {
            <div class="pf-field">
              <span class="pf-field__lbl">This line prints</span>
              <ul class="pf-rhe-fields">
                @for (f of s.item.fields ?? []; track f) {
                  <li>
                    <span class="pf-rhe-fields__name">{{ label(f) }}</span>
                    <span class="pf-rhe-fields__val">{{ fieldValue(f) || 'empty' }}</span>
                    <button type="button" class="pf-btn pf-btn--quiet" (click)="moveToOwnLine(f)">Own line</button>
                    <button type="button" class="pf-btn pf-btn--quiet" (click)="removeFromJoined(f)" [attr.aria-label]="'Remove ' + label(f) + ' from this line'">Remove</button>
                  </li>
                }
              </ul>
              <span class="pf-field__hint">"Own line" lets you place and size that field by itself.</span>
            </div>
          }
          @if (s.id === 'logo') {
            <div class="pf-field">
              <span class="pf-field__lbl">Logo image</span>
              <!-- The logo is set ONCE in Organization profile (Settings re-home); shown here read-only. -->
              <div class="pf-rhe-ro-logo" data-testid="rhe-logo-ro">
                @if (template().logoUrl) { <img [src]="logoSrc()" alt="" /> } @else { <span class="pf-field__hint">No logo</span> }
              </div>
              <span class="pf-field__hint">@if (!template().logoUrl) { No logo set — a placeholder circle prints. Add one, or switch the logo off below. }
                <a routerLink="/admin/org/profile" class="pf-rhe-ro__link">Change in Organization profile</a></span>
            </div>
          }
          @if (s.id === 'nabl') {
            <div class="pf-rhe-grid2">
              <label class="pf-field"><span class="pf-field__lbl">NABL number</span>
                <input class="pf-input pf-num" [ngModel]="template().nablNumber ?? ''" (ngModelChange)="emitPatch({ nablNumber: $event })" /></label>
              <div class="pf-field"><span class="pf-field__lbl">Badge image</span>
                <pf-image-upload [url]="template().nablLogoUrl" (urlChange)="emitPatch({ nablLogoUrl: $event })"></pf-image-upload></div>
            </div>
          }

          <!-- Print on / off (the banner too: off → the name turns dark ink). -->
          <div class="pf-rhe-row">
            <div>
              <p class="pf-rhe-row__t">Print this</p>
              <p class="pf-rhe-row__s">{{ stateText(s) }}</p>
            </div>
            <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="isOn(s)" [disabled]="s.state === 'empty'"
                    [attr.aria-label]="'Print ' + s.label" (click)="toggleEntry(s)">
              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
            </button>
          </div>

          @if (s.item && !s.item.hidden) {
            @let it = s.item;
            <!-- Position -->
            @if (movable(it)) {
              <section class="pf-rhe-sec" aria-label="Position">
                <h4 class="pf-rhe-sec__h">Position</h4>
                <p class="pf-rhe-readout pf-num">{{ readout(it).h }}<br>{{ readout(it).v }}</p>
                @if (it.kind !== 'bar') {
                  <div class="pf-seg pf-rhe-align" role="radiogroup" aria-label="Alignment">
                    @for (a of aligns; track a.value) {
                      <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="it.align === a.value"
                              (click)="setAlign(a.value)" [attr.aria-label]="'Align ' + a.label">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path [attr.d]="a.icon"/></svg>
                        {{ a.label }}
                      </button>
                    }
                  </div>
                }
                <div class="pf-rhe-nudge">
                  <div class="pf-rhe-pad" role="group" aria-label="Move">
                    <button type="button" class="pf-btn pf-btn--icon pf-rhe-pad__up" (click)="nudge(0, -step())" aria-label="Move up">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button>
                    @if (it.kind !== 'bar') {
                      <button type="button" class="pf-btn pf-btn--icon pf-rhe-pad__left" (click)="nudge(-step(), 0)" aria-label="Move left">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
                      <button type="button" class="pf-btn pf-btn--icon pf-rhe-pad__right" (click)="nudge(step(), 0)" aria-label="Move right">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
                    }
                    <button type="button" class="pf-btn pf-btn--icon pf-rhe-pad__down" (click)="nudge(0, step())" aria-label="Move down">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
                  </div>
                  <div class="pf-rhe-step">
                    <span class="pf-field__lbl">Step</span>
                    <div class="pf-seg" role="radiogroup" aria-label="Step size">
                      @for (st of steps; track st) {
                        <button type="button" class="pf-seg__item pf-num" role="radio" [attr.aria-checked]="step() === st" (click)="step.set(st)">{{ st }} mm</button>
                      }
                    </div>
                    <span class="pf-field__hint">Keyboard: arrows move {{ step() }} mm, Shift + arrows 5 mm. Dragged near another element or an image, it lines up with it; hold Alt (Option) while dragging to place it freely.</span>
                  </div>
                </div>
                <div class="pf-rhe-grid2">
                  @if (it.kind !== 'bar') {
                    <label class="pf-field">
                      <span class="pf-field__lbl">{{ it.align === 'center' ? 'Off centre (mm, + = right)' : it.align === 'right' ? 'From right margin (mm)' : 'From left margin (mm)' }}</span>
                      <input class="pf-input pf-num" type="number" step="0.5" inputmode="decimal"
                             [ngModel]="hValue(it)" (change)="setH($any($event.target).value)" />
                    </label>
                  }
                  <label class="pf-field">
                    <span class="pf-field__lbl">From top of page (mm)</span>
                    <input class="pf-input pf-num" type="number" step="0.5" inputmode="decimal"
                           [ngModel]="vValue(it)" (change)="setV($any($event.target).value)" />
                  </label>
                </div>
              </section>
            }

            <!-- Size -->
            @if (sizeSpec(it); as sz) {
              <section class="pf-rhe-sec" aria-label="Size">
                <h4 class="pf-rhe-sec__h">{{ sz.title }}</h4>
                <div class="pf-rhe-slider">
                  <input type="range" [min]="sz.min" [max]="sz.max" [step]="sz.step" [ngModel]="it.sizeValue"
                         (ngModelChange)="setSize(+$event)" [attr.aria-label]="sz.title" />
                  <label class="pf-rhe-num">
                    <input class="pf-input pf-num" type="number" [min]="sz.min" [max]="sz.max" [step]="sz.step"
                           [ngModel]="round(it.sizeValue)" (change)="setSize(+$any($event.target).value)" [attr.aria-label]="sz.title + ' value'" />
                    <span>{{ sz.unit }}</span>
                  </label>
                </div>
                @if (it.kind === 'logo') {
                  <div class="pf-seg" role="radiogroup" aria-label="Logo proportions">
                    <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="(it.fit ?? 'square') === 'square'" (click)="setOverride({ fit: undefined })">Square (as before)</button>
                    <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="it.fit === 'natural'" (click)="setOverride({ fit: 'natural' })">Keep proportions</button>
                  </div>
                }
              </section>
            }

            <!-- Text style + line width -->
            @if (it.kind === 'text') {
              <section class="pf-rhe-sec" aria-label="Text">
                <div class="pf-rhe-row pf-rhe-row--flat">
                  <p class="pf-rhe-row__t">Bold</p>
                  <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="it.style === 'bold'" aria-label="Bold"
                          (click)="setOverride({ bold: it.style !== 'bold' })">
                    <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                  </button>
                </div>
                @if (it.tone === 'plain') {
                  <h4 class="pf-rhe-sec__h">Line width</h4>
                  <div class="pf-seg" role="radiogroup" aria-label="Line width">
                    <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="wrapMode(it) === 'auto'" (click)="setOverride({ wrap: undefined })">Fit the page</button>
                    <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="wrapMode(it) === 'set'" (click)="setOverride({ wrap: round(ptToMm(it.box.w)) || 60 })">Set width</button>
                    <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="wrapMode(it) === 'never'" (click)="setOverride({ wrap: 0 })">One line</button>
                  </div>
                  @if (wrapMode(it) === 'set') {
                    <div class="pf-rhe-slider">
                      <input type="range" min="20" max="180" step="1" [ngModel]="override(it.id).wrap" (ngModelChange)="setOverride({ wrap: +$event })" aria-label="Line width in mm" />
                      <label class="pf-rhe-num"><input class="pf-input pf-num" type="number" min="20" max="180" [ngModel]="override(it.id).wrap"
                             (change)="setOverride({ wrap: +$any($event.target).value })" aria-label="Line width value" /><span>mm</span></label>
                    </div>
                  }
                  <p class="pf-field__hint">{{ wrapHint(it) }}</p>
                }
              </section>
            }

            <!-- Quick placements for the address -->
            @if (s.id === 'address' && placements().length) {
              <section class="pf-rhe-sec" aria-label="Quick placement">
                <h4 class="pf-rhe-sec__h">Put the address…</h4>
                <div class="pf-rhe-quick">
                  @for (p of placements(); track p.key) {
                    <button type="button" class="pf-btn pf-btn--secondary pf-rhe-quick__b" (click)="place(p.key)">{{ p.label }}</button>
                  }
                </div>
              </section>
            }
          }

          <div class="pf-rhe-sel-foot">
            <button type="button" class="pf-btn pf-btn--tertiary" [disabled]="!s.item?.customized" (click)="resetSelected()">
              Reset {{ s.label.toLowerCase() }} to the style's default
            </button>
            @if (s.id.startsWith('line:')) {
              <button type="button" class="pf-btn pf-btn--danger" (click)="deleteLine(s.id)">Delete this line</button>
            }
          </div>
        } @else {
          <!-- ── Every element (also the phone view) ── -->
          @if (region() === 'header') {
            <section class="pf-rhe-sec pf-rhe-sec--first" aria-label="Letterhead type">
              <pf-report-letterhead-card [tpl]="template()" [busy]="lhBusy()" [note]="lhNote()" [error]="lhError()"
                (presetChange)="applyLetterhead($event)" (continuationChange)="setLhContinuation($event)"
                (pick)="onLetterheadFile($event.kind, $event.file)" (measure)="measureScan()" (mm)="setLhMm($event)"></pf-report-letterhead-card>
            </section>
          }
          <ul class="pf-rhe-list" role="list">
            @for (e of entries(); track e.id) {
              <li class="pf-rhe-li" [class.pf-rhe-li--off]="!isOn(e)">
                <button type="button" class="pf-rhe-li__main" (click)="select(e.id)" [attr.aria-label]="'Edit ' + e.label">
                  <span class="pf-rhe-li__name">{{ e.label }}
                    @if (e.warn) {
                      <svg class="pf-rhe-li__warn" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-label="Needs attention"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
                    }
                  </span>
                  <span class="pf-rhe-li__val">{{ e.value || stateText(e) }}</span>
                </button>
                <button type="button" class="pf-toggle pf-rhe-li__sw" role="switch" [attr.aria-checked]="isOn(e)" [disabled]="e.state === 'empty'"
                        [attr.aria-label]="'Print ' + e.label" (click)="toggleEntry(e)">
                  <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                </button>
              </li>
            }
          </ul>

          <section class="pf-rhe-sec" aria-label="Background images">
            <h4 class="pf-rhe-sec__h">Background images</h4>
            @if (layout().backgrounds.length) {
              <ul class="pf-rhe-list" role="list">
                @for (bg of layout().backgrounds; track bg.id) {
                  <li class="pf-rhe-li" [class.pf-rhe-li--off]="bg.hidden">
                    <button type="button" class="pf-rhe-li__main pf-rhe-li__main--bg" (click)="select('bg:' + bg.id)" [attr.aria-label]="'Edit ' + bg.label">
                      <span class="pf-rhe-li__thumb">@if (imageCache()[bg.url]; as src) { <img [src]="src" alt="" /> }</span>
                      <span><span class="pf-rhe-li__name">{{ bg.label }}</span>
                      <span class="pf-rhe-li__val">{{ bgSummary(bg) }}</span></span>
                    </button>
                    <button type="button" class="pf-toggle pf-rhe-li__sw" role="switch" [attr.aria-checked]="!bg.hidden" [attr.aria-label]="'Print ' + bg.label"
                            (click)="patchBg(bg.id, { hidden: bg.hidden ? undefined : true })">
                      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <p class="pf-field__hint">Put your letterhead artwork or a faint watermark behind the report. It always prints under the text.</p>
            }
            @if (bgError()) { <p class="pf-rhe-err" role="alert">{{ bgError() }}</p> }
            <label class="pf-btn pf-btn--secondary pf-rhe-add pf-rhe-file" [class.pf-rhe-file--off]="layout().backgrounds.length >= maxBgs || bgBusy()">
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden (change)="onBgPick($event)"
                     [disabled]="layout().backgrounds.length >= maxBgs || bgBusy()" />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
              {{ bgBusy() ? 'Uploading…' : layout().backgrounds.length >= maxBgs ? 'Up to ' + maxBgs + ' backgrounds' : 'Add a background image' }}
            </label>
            <p class="pf-field__hint">PNG, JPG or WebP, up to 15 MB. Large images are shrunk to print size (A4 at 300 dpi).</p>
          </section>

          @if (region() === 'header') {
            <button type="button" class="pf-btn pf-btn--secondary pf-rhe-add" (click)="addLine()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              Add a text line (GSTIN, registration no.…)
            </button>

            <section class="pf-rhe-sec">
              <h4 class="pf-rhe-sec__h">Header style</h4>
              <div class="pf-rhe-presets" role="radiogroup" aria-label="Header style">
                @for (p of presets; track p.value) {
                  <button type="button" class="pf-rhe-preset pf-tile-sel" role="radio" [attr.aria-checked]="presetOf(template()) === p.value"
                          (click)="setPreset(p.value)">
                    <span class="pf-rhe-thumb" [class]="'pf-rhe-thumb pf-rhe-thumb--' + p.value + (p.value === 'banner' && bannerHidden() ? ' pf-rhe-thumb--nobanner' : '')" aria-hidden="true"><i></i><b></b><b></b><em></em></span>
                    {{ p.label }}
                  </button>
                }
              </div>
            </section>

            <section class="pf-rhe-sec">
              <h4 class="pf-rhe-sec__h">Brand colours</h4>
              <div class="pf-rhe-grid2">
                <label class="pf-field"><span class="pf-field__lbl">Lab name</span>
                  <span class="pf-rhe-color"><input type="color" [ngModel]="template().primaryColor || '#1B3A6B'" (ngModelChange)="emitPatch({ primaryColor: $event })" aria-label="Lab name colour" />
                  <span class="pf-num">{{ template().primaryColor || '#1B3A6B' }}</span></span></label>
                <label class="pf-field"><span class="pf-field__lbl">Accent</span>
                  <span class="pf-rhe-color"><input type="color" [ngModel]="template().accentColor || '#0066CC'" (ngModelChange)="emitPatch({ accentColor: $event })" aria-label="Accent colour" />
                  <span class="pf-num">{{ template().accentColor || '#0066CC' }}</span></span></label>
              </div>
            </section>

            <section class="pf-rhe-sec">
              <h4 class="pf-rhe-sec__h">Patient details start</h4>
              <div class="pf-seg" role="radiogroup" aria-label="Patient details start">
                <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="layout().bodyTopAuto" (click)="setBodyTop(null)">Below the letterhead</button>
                <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="!layout().bodyTopAuto" (click)="setBodyTop(round(ptToMm(layout().bodyTop)))">At a set height</button>
              </div>
              @if (!layout().bodyTopAuto) {
                <div class="pf-rhe-slider">
                  <input type="range" min="15" max="120" step="0.5" [ngModel]="cfg()?.bodyTop" (ngModelChange)="setBodyTop(+$event)" aria-label="Patient details start, mm from top" />
                  <label class="pf-rhe-num"><input class="pf-input pf-num" type="number" min="15" max="120" step="0.5" [ngModel]="cfg()?.bodyTop"
                         (change)="setBodyTop(+$any($event.target).value)" aria-label="Patient details start value" /><span>mm</span></label>
                </div>
              }
              <p class="pf-field__hint">{{ layout().active ? 'Automatic keeps a small gap under the lowest letterhead element.' : 'Untouched letterheads keep their original 34.6 mm.' }}</p>
            </section>

            <section class="pf-rhe-sec">
              <div class="pf-rhe-row pf-rhe-row--flat">
                <div><p class="pf-rhe-row__t">NABL accredited</p><p class="pf-rhe-row__s">Prints the NABL badge and number.</p></div>
                <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="!!template().nablAccredited" aria-label="NABL accredited"
                        (click)="emitPatch({ nablAccredited: !template().nablAccredited })">
                  <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                </button>
              </div>
              @if (lhPreset() !== 'preprinted') {
              <div class="pf-rhe-row pf-rhe-row--flat">
                <div><p class="pf-rhe-row__t">Pre-printed letterhead paper</p>
                  <p class="pf-rhe-row__s">Printing asks whether to use your letterhead paper (header and footer left blank). Shared and downloaded reports always include them.</p></div>
                <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="!!template().letterpadMode" aria-label="Pre-printed letterhead paper"
                        (click)="emitPatch({ letterpadMode: !template().letterpadMode })">
                  <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                </button>
              </div>
              @if (template().letterpadMode) {
                <div class="pf-rhe-grid2">
                  <label class="pf-field"><span class="pf-field__lbl">Blank at the top (mm)</span>
                    <input class="pf-input pf-num" type="number" min="0" max="120" [ngModel]="template().letterpadHeaderMm ?? 45" (ngModelChange)="emitPatch({ letterpadHeaderMm: +$event })" /></label>
                  <label class="pf-field"><span class="pf-field__lbl">Blank at the bottom (mm)</span>
                    <input class="pf-input pf-num" type="number" min="0" max="120" [ngModel]="template().letterpadFooterMm ?? 30" (ngModelChange)="emitPatch({ letterpadFooterMm: +$event })" /></label>
                </div>
              }
              }
            </section>

            <button type="button" class="pf-btn pf-btn--danger pf-rhe-resetall" [disabled]="!layout().active" (click)="resetAll()">
              Reset the whole letterhead layout
            </button>
          } @else {
            <section class="pf-rhe-sec">
              <label class="pf-field"><span class="pf-field__lbl">"End of report" marker</span>
                <input class="pf-input" placeholder="****End of Report****" [ngModel]="template().endOfReportText ?? ''" (ngModelChange)="emitPatch({ endOfReportText: $event })" /></label>
              <label class="pf-field"><span class="pf-field__lbl">Watermark text (page 1)</span>
                <input class="pf-input" placeholder="e.g. DRAFT, COPY" [ngModel]="template().watermarkText ?? ''" (ngModelChange)="emitPatch({ watermarkText: $event })" /></label>
              @if (template().watermarkText) {
                <div class="pf-field"><span class="pf-field__lbl">Watermark strength</span>
                  <div class="pf-rhe-slider">
                    <input type="range" min="0.02" max="0.4" step="0.02" [ngModel]="template().watermarkOpacity ?? 0.08" (ngModelChange)="emitPatch({ watermarkOpacity: +$event })" aria-label="Watermark strength" />
                    <span class="pf-rhe-num pf-rhe-num--ro pf-num">{{ round((template().watermarkOpacity ?? 0.08) * 100) }}%</span>
                  </div></div>
              }
            </section>
            <section class="pf-rhe-sec">
              <h4 class="pf-rhe-sec__h">Page extras</h4>
              @for (x of footerExtras; track x.key) {
                <div class="pf-rhe-row pf-rhe-row--flat">
                  <div><p class="pf-rhe-row__t">{{ x.label }}</p>@if (x.hint) { <p class="pf-rhe-row__s">{{ x.hint }}</p> }</div>
                  <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="extraOn(x.key, x.dflt)" [attr.aria-label]="x.label"
                          (click)="toggleExtra(x.key, x.dflt)">
                    <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                  </button>
                </div>
              }
            </section>
            <pf-report-signature-card [template]="template()" [sample]="sigSample()"
                                      (patch)="emitPatch($event)" (sampleChange)="sigSampleChange.emit($event)" />
          }
        }
      </div>
    </aside>
  </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; min-height: 0; }
    /* FLAT (inside Report design's ONE section card, owner 2026-11-17): no nested cards — the elements column and the
       page sit flush in the host card; one head (the host's), so the designer heads lose their icon + title. */
    :host(.pf-rhe-host--flat) .pf-rhe { gap: 0; height: 100%; }
    :host(.pf-rhe-host--flat) .pf-rhe > .pf-card { border: 0; border-radius: 0; box-shadow: none; background: transparent; }
    @media (min-width: 901px) { :host(.pf-rhe-host--flat) .pf-rhe-side { border-right: 1px solid var(--pf-line); } }
    :host(.pf-rhe-host--flat) .pf-rhe > .pf-card > .pf-card__head { background: transparent; border-radius: 0; min-height: 52px; }
    :host(.pf-rhe-host--flat) .pf-rhe-main__head > .pf-card__icon,
    :host(.pf-rhe-host--flat) .pf-rhe-main__head > .pf-card__label,
    :host(.pf-rhe-host--flat) .pf-rhe-side > .pf-card__head > .pf-card__icon { display: none; }
    :host(.pf-rhe-host--flat) .pf-rhe-side > .pf-card__head > .pf-card__label { text-transform: none; letter-spacing: 0; font-size: 13.5px; color: var(--text-primary); }
    /* Owner rule (2026-11-17): side cards sit on the LEFT, the same height as the main card. */
    .pf-rhe { display: grid; grid-template-columns: 380px minmax(0, 1fr); gap: 16px; height: 100%; min-height: 0; }
    @media (max-width: 1100px) { .pf-rhe { grid-template-columns: 330px minmax(0, 1fr); } }
    @media (min-width: 901px) { .pf-rhe-side { grid-column: 1; grid-row: 1; } .pf-rhe-main { grid-column: 2; grid-row: 1; } }
    @media (max-width: 900px) { .pf-rhe { grid-template-columns: minmax(0, 1fr); height: auto; } }

    .pf-rhe-main, .pf-rhe-side { min-height: 0; }
    .pf-rhe-main__head { row-gap: 8px; }
    .pf-rhe-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
    .pf-rhe-tool { width: 36px; min-height: 36px; height: 36px; }
    @media (pointer: coarse) { .pf-rhe-tool { width: 44px; min-height: 44px; height: 44px; } .pf-seg__item { min-height: 40px; } }
    .pf-rhe-guides { margin-left: 4px; }

    .pf-rhe-viewport { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px;
      background: color-mix(in srgb, var(--text-primary) 5%, var(--pf-card-bg)); overscroll-behavior: contain; }
    @media (max-width: 900px) { .pf-rhe-viewport { max-height: 72dvh; padding: 10px; } }
    .pf-rhe-page { position: relative; margin: 0 auto; background: #fff; border-radius: 4px; outline: none;
      box-shadow: 0 1px 3px rgba(15, 23, 42, .18), 0 10px 28px rgba(15, 23, 42, .12); touch-action: pan-y pinch-zoom; }
    .pf-rhe-page:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 40%, transparent), 0 10px 28px rgba(15, 23, 42, .12); }
    .pf-rhe-canvas, .pf-rhe-canvas ::ng-deep canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; border-radius: 4px; }
    .pf-rhe-loading { position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center; padding-top: 30%;
      font-size: 13px; color: #64748b; }

    .pf-rhe-guide { position: absolute; pointer-events: none; z-index: 1; }
    .pf-rhe-guide--v { top: 0; bottom: 0; width: 0; border-left: 1px dashed rgba(124, 58, 237, .28); }
    .pf-rhe-guide--centre { border-left-style: dotted; border-left-color: rgba(124, 58, 237, .38); }
    .pf-rhe-guide--body { left: 0; right: 0; height: 0; border-top: 1px dashed rgba(124, 58, 237, .5); }
    .pf-rhe-guide__tag { position: absolute; right: 6px; top: 2px; padding: 1px 6px; border-radius: 6px; white-space: nowrap;
      font-size: 10.5px; font-weight: 500; color: #5b21b6; background: rgba(245, 243, 255, .92); font-variant-numeric: tabular-nums; }
    .pf-rhe-letterpad { position: absolute; left: 0; right: 0; top: 0; pointer-events: none; z-index: 1;
      background: repeating-linear-gradient(135deg, rgba(124,58,237,.06) 0 6px, transparent 6px 12px); border-bottom: 1px dashed rgba(124,58,237,.45); }
    .pf-rhe-letterpad .pf-rhe-guide__tag { top: auto; bottom: 2px; }

    .pf-rhe-box { position: absolute; z-index: 2; padding: 0; margin: 0; background: transparent; cursor: pointer;
      border: 1px dashed transparent; border-radius: 3px; touch-action: none;
      transition: border-color var(--pf-dur-fast) ease, background var(--pf-dur-fast) ease; }
    .pf-rhe-box--bg { z-index: 1; }
    /* Background images: under the element outlines; outlined only on hover / when selected. */
    .pf-rhe-box.pf-rhe-box--bgimg { z-index: 1; border-color: transparent !important; background: transparent; }
    .pf-rhe-box.pf-rhe-box--bgimg:hover { border-color: rgba(124, 58, 237, .35) !important; }
    .pf-rhe-box.pf-rhe-box--bgimg.pf-rhe-box--sel { border: 1.5px dashed #7c3aed !important; background: rgba(124, 58, 237, .04); }
    .pf-rhe-box--bgimg .pf-rhe-box__tag { bottom: auto; top: 4px; left: 4px; }
    .pf-rhe-ro { margin: 0; padding: 8px 10px; border-radius: var(--pf-radius-sm); border: 1px solid var(--pf-line); background: var(--pf-chip-bg); font-size: 13.5px; color: var(--text-primary); }
    .pf-rhe-ro-logo { display: flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 8px; background: var(--pf-chip-bg); overflow: hidden; }
    .pf-rhe-ro-logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .pf-rhe-ro__link { color: var(--violet-text, #7c3aed); font-weight: 600; text-decoration: none; }
    .pf-rhe-ro__link:hover { text-decoration: underline; }
    /* With guides on, every element shows a faint outline — you can see what is editable. */
    .pf-rhe--guides .pf-rhe-box:not(.pf-rhe-box--bg) { border-color: rgba(124, 58, 237, .22); }
    .pf-rhe-box--r .pf-rhe-box__tag, .pf-rhe-box--r .pf-rhe-box__live { left: auto; right: -1px; }
    .pf-rhe-box:hover, .pf-rhe-box:focus-visible { border-color: rgba(124, 58, 237, .65); background: rgba(124, 58, 237, .05); outline: none; }
    .pf-rhe-box--sel, .pf-rhe-box--sel:hover { border: 1.5px solid #7c3aed; background: rgba(124, 58, 237, .07); cursor: move; }
    .pf-rhe-box--hidden { border-color: rgba(100, 116, 139, .55); background: repeating-linear-gradient(135deg, rgba(100,116,139,.10) 0 4px, transparent 4px 8px); }
    .pf-rhe-box--warn:not(.pf-rhe-box--sel) { border-color: rgba(217, 119, 6, .8); border-style: solid; }
    .pf-rhe-box--drag { transition: none; z-index: 4; }
    .pf-rhe-box__tag { position: absolute; left: -1px; bottom: calc(100% + 2px); display: none; align-items: center; gap: 4px;
      padding: 2px 7px; border-radius: 6px; white-space: nowrap; font-size: 11px; font-weight: 600; line-height: 1.3;
      color: #fff; background: #6d28d9; box-shadow: 0 2px 6px rgba(15,23,42,.2); pointer-events: none; }
    .pf-rhe-box--warn .pf-rhe-box__tag { background: #b45309; }
    /* While an element moves, its name tag steps aside for the smart guides (the live readout stays). */
    .pf-rhe-box--drag .pf-rhe-box__tag { display: none !important; }
    .pf-rhe-box:hover .pf-rhe-box__tag, .pf-rhe-box:focus-visible .pf-rhe-box__tag, .pf-rhe-box--sel .pf-rhe-box__tag { display: inline-flex; }
    .pf-rhe--footer .pf-rhe-box__tag { bottom: auto; top: calc(100% + 2px); }
    .pf-rhe-box__live { position: absolute; left: 0; top: calc(100% + 4px); padding: 2px 7px; border-radius: 6px; white-space: nowrap;
      font-size: 11px; color: #fff; background: #0f172a; pointer-events: none; }
    .pf-rhe-foot-note { margin: 0; padding: 8px 14px 10px; font-size: 12px; color: var(--text-tertiary); border-top: 1px solid var(--pf-line); }

    .pf-rhe-side__body { gap: 14px; }
    .pf-rhe-issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-rhe-issues li { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: var(--pf-radius-sm);
      font-size: 12.5px; line-height: 1.4; color: var(--text-primary);
      background: color-mix(in srgb, #d97706 10%, var(--pf-card-bg)); border: 1px solid color-mix(in srgb, #d97706 35%, transparent); }
    .pf-rhe-issues li svg { flex: none; margin-top: 2px; color: #b45309; }
    .pf-rhe-issues li.pf-rhe-issue--info { background: var(--pf-chip-bg); border-color: var(--pf-line); }
    .pf-rhe-issues li.pf-rhe-issue--info svg { color: var(--text-tertiary); }
    .pf-rhe-ta { min-height: 64px; }
    .pf-rhe-fix { display: flex; margin-top: 6px; }

    .pf-rhe-sec { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--pf-line); }
    .pf-rhe-sec--first { border-top: 0; padding-top: 0; }
    .pf-rhe-sec__h { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-rhe-readout { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-rhe-align { align-self: flex-start; }
    .pf-rhe-align .pf-seg__item { display: inline-flex; align-items: center; gap: 6px; }
    .pf-rhe-nudge { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .pf-rhe-pad { display: grid; grid-template-columns: repeat(3, 44px); grid-template-rows: repeat(3, 44px); gap: 2px; flex: none; }
    .pf-rhe-pad .pf-btn--icon { width: 44px; height: 44px; }
    .pf-rhe-pad__up { grid-column: 2; grid-row: 1; } .pf-rhe-pad__left { grid-column: 1; grid-row: 2; }
    .pf-rhe-pad__right { grid-column: 3; grid-row: 2; } .pf-rhe-pad__down { grid-column: 2; grid-row: 3; }
    .pf-rhe-step { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 150px; }
    .pf-rhe-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    @media (max-width: 420px) { .pf-rhe-grid2 { grid-template-columns: 1fr; } }
    .pf-rhe-slider { display: flex; align-items: center; gap: 10px; }
    .pf-rhe-slider input[type=range] { flex: 1 1 auto; min-width: 0; accent-color: var(--pf-switch-on); height: 28px; }
    .pf-rhe-num { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: 12px; color: var(--text-tertiary); }
    .pf-rhe-num .pf-input { width: 84px; }
    .pf-rhe-num--ro { min-width: 48px; justify-content: flex-end; font-size: 13px; color: var(--text-primary); }

    .pf-rhe-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; min-height: 44px;
      border-radius: var(--pf-radius-sm); border: 1px solid var(--pf-line); background: var(--pf-card-bg); }
    .pf-rhe-row--flat { padding: 4px 0; border: 0; background: transparent; }
    .pf-rhe-row__t { margin: 0; font-size: 13px; font-weight: 500; color: var(--text-primary); }
    .pf-rhe-row__s { margin: 2px 0 0; font-size: 12px; line-height: 1.4; color: var(--text-tertiary); }
    .pf-toggle { min-height: 44px; }

    .pf-rhe-fields { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-rhe-fields li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 8px; border-radius: var(--pf-radius-sm); border: 1px solid var(--pf-line); }
    .pf-rhe-fields__name { font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
    .pf-rhe-fields__val { flex: 1 1 120px; min-width: 0; font-size: 12px; color: var(--text-tertiary); overflow-wrap: anywhere; }
    .pf-rhe-quick { display: flex; flex-wrap: wrap; gap: 8px; }
    .pf-rhe-quick__b { flex: 1 1 140px; white-space: normal; height: auto; min-height: 44px; line-height: 1.25; padding: 8px 12px; }
    .pf-rhe-sel-foot { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; padding-top: 12px; border-top: 1px solid var(--pf-line); }
    .pf-rhe-sel-foot .pf-btn--tertiary { white-space: normal; height: auto; min-height: 44px; text-align: left; }

    .pf-rhe-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-rhe-li { display: flex; align-items: center; gap: 8px; padding-right: 10px; border-radius: var(--pf-radius-sm);
      border: 1px solid var(--pf-line); background: var(--pf-card-bg); }
    .pf-rhe-li:hover { border-color: var(--pf-sel-border); }
    .pf-rhe-li--off .pf-rhe-li__name { color: var(--text-tertiary); }
    .pf-rhe-li__main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; min-height: 52px; justify-content: center;
      padding: 8px 12px; border: 0; background: transparent; text-align: left; font: inherit; cursor: pointer; color: inherit; border-radius: var(--pf-radius-sm); }
    .pf-rhe-li__main:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
    .pf-rhe-li__name { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-rhe-li__warn { color: #b45309; }
    .pf-rhe-li__val { font-size: 12px; color: var(--text-tertiary); overflow-wrap: anywhere; white-space: pre-line; }
    .pf-rhe-add { width: 100%; }
    .pf-rhe-file { cursor: pointer; }
    .pf-rhe-file--off { opacity: .5; cursor: not-allowed; }
    .pf-rhe-file--busy { opacity: .7; }
    .pf-rhe-err { margin: 0; padding: 8px 10px; border-radius: var(--pf-radius-sm); font-size: 12.5px; line-height: 1.4;
      color: var(--red-text, #b91c1c); background: color-mix(in srgb, var(--red-text, #dc2626) 8%, var(--pf-card-bg));
      border: 1px solid color-mix(in srgb, var(--red-text, #dc2626) 30%, transparent); }
    .pf-rhe-bgthumb { display: flex; gap: 12px; align-items: center; }
    .pf-rhe-bgthumb__img { flex: none; width: 84px; height: 112px; border-radius: 6px; border: 1px solid var(--pf-line); background: #fff;
      display: flex; align-items: center; justify-content: center; overflow: hidden; font-size: 11px; color: #64748b; }
    .pf-rhe-bgthumb__img img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .pf-rhe-bgthumb__act { display: flex; flex-direction: column; gap: 8px; flex: 1 1 auto; min-width: 0; }
    .pf-rhe-wrapseg { flex-wrap: wrap; align-self: flex-start; }
    .pf-rhe-li__main--bg { flex-direction: row; align-items: center; gap: 10px; }
    .pf-rhe-li__main--bg > span:last-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-rhe-li__thumb { flex: none; width: 34px; height: 44px; border-radius: 4px; border: 1px solid var(--pf-line); background: #fff; overflow: hidden;
      display: flex; align-items: center; justify-content: center; }
    .pf-rhe-li__thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }

    .pf-rhe-presets { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    @media (max-width: 420px) { .pf-rhe-presets { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .pf-rhe-preset { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 4px; min-height: 44px;
      border-radius: var(--pf-radius-sm); border: 1px solid var(--pf-line); background: var(--pf-card-bg);
      font: inherit; font-size: 12px; font-weight: 500; color: var(--text-secondary); cursor: pointer; }
    .pf-rhe-thumb { position: relative; width: 100%; max-width: 72px; aspect-ratio: 72 / 40; border-radius: 4px; background: #fff; border: 1px solid #e2e8f0; overflow: hidden; }
    .pf-rhe-thumb i { position: absolute; left: 7%; top: 16%; width: 16%; aspect-ratio: 1; border-radius: 50%; background: #94a3b8; }
    .pf-rhe-thumb b { position: absolute; left: 28%; top: 18%; width: 46%; height: 9%; border-radius: 2px; background: #64748b; }
    .pf-rhe-thumb b + b { top: 34%; width: 30%; background: #cbd5e1; }
    .pf-rhe-thumb em { position: absolute; left: 6%; right: 6%; top: 60%; height: 5%; background: #7c8ea3; }
    .pf-rhe-thumb--centered i { left: 42%; top: 8%; } .pf-rhe-thumb--centered b { left: 27%; top: 38%; } .pf-rhe-thumb--centered b + b { left: 35%; top: 52%; } .pf-rhe-thumb--centered em { top: 70%; }
    .pf-rhe-thumb--banner em { top: 0; left: 0; right: 0; height: 36%; } .pf-rhe-thumb--banner i { top: 6%; background: #fff; width: 13%; } .pf-rhe-thumb--banner b { top: 9%; background: #fff; } .pf-rhe-thumb--banner b + b { top: 50%; background: #cbd5e1; }
    .pf-rhe-thumb--minimal i, .pf-rhe-thumb--minimal em { display: none; } .pf-rhe-thumb--minimal b { left: 8%; }
    /* Banner style with the band switched off: dark name on paper. */
    .pf-rhe-thumb--banner.pf-rhe-thumb--nobanner em { display: none; }
    .pf-rhe-thumb--banner.pf-rhe-thumb--nobanner i { background: #94a3b8; }
    .pf-rhe-thumb--banner.pf-rhe-thumb--nobanner b { background: #64748b; }
    .pf-rhe-thumb--banner.pf-rhe-thumb--nobanner b + b { background: #cbd5e1; }
    .pf-rhe-color { display: flex; align-items: center; gap: 8px; height: 40px; padding-right: 10px; border-radius: var(--pf-radius-sm);
      border: 1px solid color-mix(in srgb, var(--text-primary) 22%, transparent); overflow: hidden; font-size: 12px; color: var(--text-secondary); }
    .pf-rhe-color input { width: 44px; height: 48px; margin: -4px 0 -4px -4px; border: 0; padding: 0; background: transparent; cursor: pointer; }
    .pf-rhe-resetall { width: 100%; }

    /* Dark: the page stays paper-white; the viewport around it darkens. */
    :host-context(.dark) .pf-rhe-viewport, :host-context([data-theme='dark']) .pf-rhe-viewport { background: rgba(0, 0, 0, .28); }

    /* Desktop: the page card and the side card each scroll inside the band body. */
    @media (min-width: 901px) {
      .pf-rhe-main, .pf-rhe-side { height: 100%; }
    }
    @media (max-width: 640px) {
      .pf-card__note { display: none; }
      .pf-rhe-guide__tag { font-size: 9px; padding: 0 4px; }
      .pf-rhe-tools { margin-left: 0; width: 100%; }
      .pf-input { font-size: 16px; }
    }
    @media (prefers-reduced-motion: reduce) { .pf-rhe-box { transition: none; } }
  `],
})
export class ReportHeaderEditorComponent implements OnDestroy {
  private readonly dialog = inject(DialogService);
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);

  readonly template = input.required<ReportTemplate>();
  /** Inside a host card (Report design, new design): no card chrome of its own. */
  readonly flat = input(false);
  readonly region = input<LayoutRegion>('header');
  /** blob: URL of the current full preview (page 1 is drawn). */
  readonly pdfUrl = input<string | null>(null);
  readonly imageCache = input<Record<string, string>>({});
  readonly rendering = input(false);
  readonly canUndo = input(false);
  readonly canRedo = input(false);
  readonly patch = output<Partial<ReportTemplate>>();
  /** Signatures card: how many sample signatories the preview and readout try (the editor owns it). */
  readonly sigSample = input(2);
  readonly sigSampleChange = output<number>();
  readonly undo = output<void>();
  readonly redo = output<void>();

  protected readonly PAGE = PAGE;
  protected readonly MARGIN_X = MARGIN_X;
  protected readonly MM_PER_PT = 1 / MM;
  protected readonly PAGE_RATIO = PAGE.h / PAGE.w;
  protected readonly presets = PRESETS;
  protected readonly steps = STEPS;
  protected readonly ptToMm = ptToMm;
  protected readonly aligns: Array<{ value: Align; label: string; icon: string }> = [
    { value: 'left', label: 'Left', icon: 'M4 6h16M4 12h10M4 18h13' },
    { value: 'center', label: 'Centre', icon: 'M4 6h16M7 12h10M5.5 18h13' },
    { value: 'right', label: 'Right', icon: 'M4 6h16M10 12h10M7 18h13' },
  ];
  protected readonly footerExtras: Array<{ key: keyof ReportTemplate; label: string; hint?: string; dflt: boolean }> = [
    { key: 'showSampleCollectionBand', label: 'Sample-collection band', hint: 'Accent strip with the lab phone along the bottom edge.', dflt: true },
    { key: 'showPoweredBy', label: '"Powered by Prefrontal" line', dflt: true },
    { key: 'showQrCode', label: 'QR code (verify online)', dflt: true },
    { key: 'showPathologistName', label: 'Pathologist name (legacy)', dflt: true },
  ];

  // ── state ────────────────────────────────────────────────────────────
  readonly selected = signal<string | null>(null);
  readonly zoom = signal<1 | 2>(1);
  readonly guides = signal(true);
  readonly step = signal(1);
  /** Smart guides on show (while dragging, or briefly after a nudge). */
  readonly smart = signal<SnapGuides>(NO_GUIDES);
  readonly drag = signal<{ id: string; dxPx: number; dyPx: number } | null>(null);
  readonly canvasReady = signal(false);
  private readonly hostW = signal(600);

  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
  private readonly canvasHost = viewChild<ElementRef<HTMLDivElement>>('canvasHost');
  private readonly pageEl = viewChild<ElementRef<HTMLDivElement>>('page');
  private readonly sideBody = viewChild<ElementRef<HTMLDivElement>>('sideBody');

  readonly cfg = computed(() => readHeaderLayout(this.template()));
  /** The Banner style's band is switched off (a hidden override). */
  readonly bannerHidden = computed(() => this.cfg()?.items['banner']?.hidden === true);
  /** Same resolved layout the PDF was drawn with. */
  readonly layout = computed(() => computeReportPageLayout({
    report: { id: 'layout', type: 'final', data: '{}' }, template: this.template(), imageCache: this.imageCache(),
  }));
  readonly issues = computed<LayoutIssue[]>(() => detectIssues(this.layout()));
  readonly warnIds = computed(() => new Set(this.issues().filter(i => i.level === 'warn').map(i => i.itemId)));
  readonly regionItems = computed(() => this.layout().items.filter(i => i.region === this.region()));
  readonly pageW = computed(() => Math.max(280, Math.min(this.hostW(), 900)) * this.zoom());
  readonly scale = computed(() => this.pageW() / PAGE.w);

  readonly entries = computed<Entry[]>(() => this.buildEntries());
  /** The selected background image, when a "bg:<id>" is selected. */
  readonly selBg = computed<ResolvedBackground | null>(() => {
    const id = this.selected();
    return id?.startsWith('bg:') ? this.layout().backgrounds.find(b => 'bg:' + b.id === id) ?? null : null;
  });
  protected readonly maxBgs = MAX_BACKGROUNDS;
  protected readonly bgAreas: Array<{ value: BgArea; label: string }> = [
    { value: 'page', label: 'Whole page' }, { value: 'header', label: 'Letterhead' }, { value: 'footer', label: 'Footer' },
  ];
  protected readonly bgFits: Array<{ value: BgFit; label: string }> = [
    { value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' },
    { value: 'stretch', label: 'Stretch' }, { value: 'original', label: 'Original size' },
  ];
  readonly bgBusy = signal(false);
  readonly bgError = signal<string | null>(null);
  readonly sel = computed<Entry | null>(() => {
    const id = this.selected();
    return id && !id.startsWith('bg:') ? this.entries().find(e => e.id === id) ?? this.entryFromItem(id) : null;
  });

  private ro?: ResizeObserver;
  private renderToken = 0;

  constructor() {
    effect(() => {
      const vp = this.viewport()?.nativeElement;
      if (!vp || this.ro || typeof ResizeObserver === 'undefined') return;
      this.ro = new ResizeObserver(() => this.hostW.set(Math.max(0, vp.clientWidth - 32) || 600));
      this.ro.observe(vp);
    });
    effect(() => {
      const url = this.pdfUrl();
      const w = this.pageW();
      const host = this.canvasHost()?.nativeElement;
      if (url && host) void this.drawPage(url, w, host);
    });
    // A new selection opens its controls from the top.
    effect(() => {
      this.selected();
      const body = this.sideBody()?.nativeElement;
      if (body) body.scrollTop = 0;
    });
    // Footer: open scrolled to the bottom of the page (where the footer is).
    effect(() => {
      const vp = this.viewport()?.nativeElement;
      const ready = this.canvasReady();
      if (vp && ready && this.region() === 'footer') queueMicrotask(() => vp.scrollTop = vp.scrollHeight);
    });
  }

  ngOnDestroy() { this.ro?.disconnect(); if (this.flashTimer) clearTimeout(this.flashTimer); }

  // ── page rendering (pdf.js, page 1) ─────────────────────────────────
  private async drawPage(url: string, cssW: number, host: HTMLDivElement) {
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
      const viewport = page.getViewport({ scale: (cssW / base.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
      if (my !== this.renderToken) return;
      host.replaceChildren(canvas);   // swap only when ready — no flicker
      this.canvasReady.set(true);
    } catch { /* keep the previous page; outlines still work */ }
  }

  // ── helpers used by the template ─────────────────────────────────────
  mm(pt: number): string { return ptToMm(pt).toFixed(1); }
  round(n: number | undefined | null): number { return Math.round((n ?? 0) * 10) / 10; }
  label(id: string): string { return FIELD_LABEL[id] ?? id; }
  private readonly uploads = inject(UploadsService);
  /** The profile's logo through the session ("/uploads/…" is private). */
  logoSrc(): string { return this.uploads.src(this.template().logoUrl) ?? ''; }
  fieldKey(id: string): keyof ReportTemplate | null { return FIELD_KEY[id] ?? null; }
  multiline(id: string): boolean { return id === 'address' || id === 'disclaimer' || id === 'footerText'; }
  fieldValue(f: string): string { const k = FIELD_KEY[f]; return k ? String((this.template() as unknown as Record<string, unknown>)[k] ?? '') : ''; }
  override(id: string): ItemOverride { return this.cfg()?.items[id] ?? {}; }
  readout(it: LayoutItem) { return positionReadout(it); }
  issuesFor(id: string): LayoutIssue[] { return this.issues().filter(i => i.itemId === id); }
  extraOn(key: keyof ReportTemplate, dflt: boolean): boolean {
    const v = (this.template() as unknown as Record<string, unknown>)[key];
    return typeof v === 'boolean' ? v : dflt;
  }
  toggleExtra(key: keyof ReportTemplate, dflt: boolean) {
    this.emitPatch({ [key]: !this.extraOn(key, dflt) } as Partial<ReportTemplate>);
  }
  movable(it: LayoutItem): boolean { return it.kind !== 'banner'; }
  boxPx(it: LayoutItem): { x: number; y: number; w: number; h: number } {
    const s = this.scale(), pad = 2;
    const w = Math.max(it.box.w * s, 10), h = Math.max(it.box.h * s, 8);
    return { x: it.box.x * s - pad - (w - it.box.w * s) / 2, y: it.box.y * s - pad - (h - it.box.h * s) / 2, w: w + pad * 2, h: h + pad * 2 };
  }
  sizeSpec(it: LayoutItem): { title: string; min: number; max: number; step: number; unit: string } | null {
    switch (it.kind) {
      case 'text': return { title: 'Font size', min: 5, max: 36, step: 0.5, unit: 'pt' };
      case 'logo': return { title: 'Logo height', min: 5, max: 60, step: 0.5, unit: 'mm' };
      case 'nabl': return { title: 'Badge height', min: 5, max: 30, step: 0.5, unit: 'mm' };
      case 'bar': return { title: 'Thickness', min: 0.3, max: 6, step: 0.1, unit: 'mm' };
      case 'banner': return { title: 'Banner height', min: 10, max: 70, step: 0.5, unit: 'mm' };
    }
  }
  wrapMode(it: LayoutItem): 'auto' | 'set' | 'never' {
    const w = this.override(it.id).wrap;
    return w === undefined ? 'auto' : w === 0 ? 'never' : 'set';
  }
  wrapHint(it: LayoutItem): string {
    const n = it.lines?.length ?? 1;
    const m = this.wrapMode(it);
    if (m === 'never') return 'Stays on one line (plus any line breaks you typed) — watch the page edge.';
    const w = it.wrapW ? `${ptToMm(it.wrapW).toFixed(0)} mm` : 'the page';
    return n > 1 ? `Prints on ${n} lines, up to ${w} wide.` : `Wraps when it gets wider than ${w}.`;
  }
  hValue(it: LayoutItem): number {
    const b = it.box;
    if (it.align === 'center') return this.round(ptToMm(b.x + b.w / 2 - PAGE.w / 2));
    if (it.align === 'right') return this.round(ptToMm(PAGE.w - MARGIN_X - (b.x + b.w)));
    return this.round(ptToMm(b.x - MARGIN_X));
  }
  vValue(it: LayoutItem): number { return this.round(ptToMm(it.box.y)); }
  stateText(e: Entry): string {
    switch (e.state) {
      case 'shown': return 'Printed';
      case 'hidden': return 'Hidden — not printed';
      case 'joined': return `Printed inside the ${this.label(e.joinedIn ?? 'contact').toLowerCase()}`;
      case 'notPrinted': return 'Not printed in this header style — switch on to add it';
      case 'empty': return 'Empty — type it to print it';
      case 'off': return 'Off';
    }
  }
  isOn(e: Entry): boolean { return e.state === 'shown' || e.state === 'joined'; }
  dragReadout(): string {
    const d = this.drag(); const it = d && this.layout().items.find(i => i.id === d.id);
    if (!d || !it) return '';
    const s = this.scale();
    const x = ptToMm(it.box.x + d.dxPx / s - MARGIN_X), y = ptToMm(it.box.y + d.dyPx / s);
    return `${x.toFixed(1)} mm from left margin · ${y.toFixed(1)} mm from top`;
  }

  // ── element catalogue ────────────────────────────────────────────────
  private buildEntries(): Entry[] {
    const items = this.layout().items;
    const byId = new Map(items.map(i => [i.id, i]));
    const t = this.template();
    const warn = this.warnIds();
    const out: Entry[] = [];
    const push = (id: string, value: string, state: EntryState, item?: LayoutItem, joinedIn?: string) =>
      out.push({ id, label: item?.label ?? this.label(id), value, state, item, joinedIn, warn: warn.has(id) });
    const joinedOf = (f: string) => items.find(i => i.fields?.includes(f as HeaderField));
    if (this.region() === 'footer') {
      for (const id of ['disclaimer', 'footerText']) {
        const it = byId.get(id);
        const v = this.fieldValue(id);
        push(id, v, it ? (it.hidden ? 'hidden' : 'shown') : 'empty', it);
      }
      return out;
    }
    const preset = normalizeHeaderPreset(t.headerPreset);
    if (preset === 'banner') {
      const band = byId.get('banner');
      push('banner', band?.hidden ? 'Off — the name prints in dark ink' : 'The coloured band behind the name',
        band?.hidden ? 'hidden' : 'shown', band);
    }
    const logo = byId.get('logo');
    if (logo) push('logo', t.logoUrl ? 'Uploaded image' : 'No image — placeholder prints', logo.hidden ? 'hidden' : 'shown', logo);
    else push('logo', 'This header style prints no logo', 'off');
    for (const id of ['name', 'tagline', 'address', 'phone', 'email', 'website']) {
      const it = byId.get(id);
      const v = id === 'tagline' ? (t.tagline ?? '') : this.fieldValue(id);
      if (it) { push(id, v || (id === 'tagline' ? it.text ?? '' : ''), it.hidden ? 'hidden' : 'shown', it); continue; }
      const j = joinedOf(id);
      if (j && v) { push(id, v, 'joined', undefined, j.id); continue; }
      push(id, v, v ? 'notPrinted' : 'empty');
    }
    const contact = byId.get('contact');
    if (contact) push('contact', contact.text ?? '', contact.hidden ? 'hidden' : 'shown', contact);
    const nabl = byId.get('nabl');
    push('nabl', t.nablAccredited ? (t.nablNumber || 'No number set') : 'Not accredited', nabl ? (nabl.hidden ? 'hidden' : 'shown') : 'off', nabl);
    const bar = byId.get('accentBar');
    if (preset === 'classic' || preset === 'centered') push('accentBar', 'Thin coloured strip under the letterhead', bar ? (bar.hidden ? 'hidden' : 'shown') : 'off', bar);
    for (const l of this.cfg()?.lines ?? []) {
      const id = 'line:' + l.id; const it = byId.get(id);
      out.push({ id, label: 'Text line', value: l.text, state: it ? (it.hidden ? 'hidden' : 'shown') : 'empty', item: it, warn: warn.has(id) });
    }
    return out;
  }
  private entryFromItem(id: string): Entry | null {
    const it = this.layout().items.find(i => i.id === id);
    return it ? { id, label: it.label, value: it.text ?? '', state: it.hidden ? 'hidden' : 'shown', item: it, warn: this.warnIds().has(id) } : null;
  }

  // ── selection ────────────────────────────────────────────────────────
  select(id: string | null) { this.selected.set(id); }
  focusSelect(id: string) { if (this.selected() !== id) this.selected.set(id); }
  setZoom(z: 1 | 2) {
    this.zoom.set(z);
    const vp = this.viewport()?.nativeElement;
    if (vp) queueMicrotask(() => { vp.scrollTop = this.region() === 'footer' ? vp.scrollHeight : 0; });
  }
  onPagePointerDown(ev: PointerEvent) {
    if (ev.target === this.pageEl()?.nativeElement || (ev.target as HTMLElement)?.closest?.('.pf-rhe-canvas')) this.select(null);
  }

  // ── emitting changes ─────────────────────────────────────────────────
  emitPatch(p: Partial<ReportTemplate>) { this.patch.emit(p); }
  private emitCfg(next: HeaderLayoutConfig | null, extra: Partial<ReportTemplate> = {}) {
    this.patch.emit({ ...extra, metadata: writeHeaderLayout(this.template(), next) });
  }
  /** Text edits switch the letterhead to the edited layout (line breaks kept,
   *  wrap at the margin, patient details move down) — the lab touched it. */
  setText(key: keyof ReportTemplate, value: string) {
    const extra = { [key]: value } as Partial<ReportTemplate>;
    if (this.cfg() || !(key in { labName: 1, tagline: 1, address: 1, phone: 1, email: 1, website: 1, disclaimer: 1, footerText: 1 })) this.patch.emit(extra);
    else this.emitCfg({ v: 1, items: {} }, extra);
  }
  setOverride(p: Partial<Record<keyof ItemOverride, unknown>>, id = this.selected()) {
    if (!id) return;
    this.emitCfg(setItem(this.cfg(), id, p));
  }

  // ── position ─────────────────────────────────────────────────────────
  private current(): LayoutItem | null {
    const id = this.selected();
    return id ? this.layout().items.find(i => i.id === id) ?? null : null;
  }
  /** Move the selected element by (dx, dy) mm. A move that would carry an
   *  edge across the margin / centre line stops on it. */
  nudge(dxMm: number, dyMm: number) {
    const bg = this.selBg();
    if (bg) { this.moveBg(bg, dxMm * MM, dyMm * MM, 'nudge'); return; }
    const it = this.current();
    if (!it || !this.movable(it)) return;
    this.moveTo(it, dxMm * MM, dyMm * MM, 'nudge');
  }
  /** Everything a moving element can line up with: the other visible
   *  elements of this region AND the background images / logos (pt). */
  private snapContext(movingId: string, tol: number): SnapContext {
    const others: SnapRect[] = [
      ...this.regionItems().filter(i => i.id !== movingId && !i.hidden).map(i => i.box),
      ...this.layout().backgrounds.filter(b => 'bg:' + b.id !== movingId && !b.hidden).map(b => b.box),
    ];
    const L = this.layout();
    const ys = this.region() === 'header' ? [MARGIN_TOP, ...(L.bodyTopAuto ? [] : [L.bodyTop])] : [];
    return pageSnapContext(others, tol, ys);
  }
  /** Move an element by (dx, dy) pt. A nudge that would carry an edge or
   *  centre across a margin / centre line or another element's edge stops on
   *  it; 'place' commits a drag's already-snapped position as it is. */
  private moveTo(it: LayoutItem, dxPt: number, dyPt: number, mode: 'nudge' | 'place') {
    const lockX = it.kind === 'bar';
    if (lockX) dxPt = 0;
    if (mode === 'nudge' && (dxPt || dyPt)) {
      const r = nudgeStop(it.box, dxPt, dyPt, this.snapContext(it.id, 0));
      this.flashGuides(r);
      dxPt = r.rect.x - it.box.x; dyPt = r.rect.y - it.box.y;
    }
    const p: Partial<Record<keyof ItemOverride, unknown>> = {};
    if (dxPt) p['x'] = ptToMm(it.x + dxPt);
    if (dyPt) p['y'] = Math.max(0, ptToMm(it.y + dyPt));
    if (Object.keys(p).length) this.setOverride(p, it.id);
  }
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private flashGuides(g: SnapGuides) {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = null;
    this.smart.set({ lines: g.lines, measures: g.measures });
    if (g.lines.length || g.measures.length) this.flashTimer = setTimeout(() => { this.flashTimer = null; this.smart.set(NO_GUIDES); }, 900);
  }
  /** Overflow fix: wrap at the margin (and pull it back inside if it was moved out). */
  fitInside(id: string) {
    const it = this.layout().items.find(i => i.id === id);
    const outside = !!it && (it.box.x < MARGIN_X - 0.5 || it.box.x > PAGE.w - MARGIN_X);
    this.setOverride(outside ? { wrap: undefined, x: undefined, align: undefined } : { wrap: undefined }, id);
  }
  setAlign(a: Align) {
    // A new alignment anchors to that edge of the printable area (x resets).
    this.setOverride({ align: a, x: undefined });
  }
  setH(raw: string) {
    const it = this.current(); const v = parseFloat(raw);
    if (!it || !isFinite(v)) return;
    const b = it.box;
    const left = it.align === 'center' ? PAGE.w / 2 + v * MM - b.w / 2
      : it.align === 'right' ? PAGE.w - MARGIN_X - v * MM - b.w : MARGIN_X + v * MM;
    this.setOverride({ x: ptToMm(it.x + (left - b.x)) });
  }
  setV(raw: string) {
    const it = this.current(); const v = parseFloat(raw);
    if (!it || !isFinite(v)) return;
    this.setOverride({ y: Math.max(0, ptToMm(it.y + (v * MM - it.box.y))) });
  }
  setSize(v: number) {
    const it = this.current();
    const spec = it && this.sizeSpec(it);
    if (!it || !spec || !isFinite(v)) return;
    this.setOverride({ size: Math.min(spec.max, Math.max(spec.min, Math.round(v * 10) / 10)) });
  }

  // ── background images ────────────────────────────────────────────────
  fitHint(f: BgFit): string {
    return f === 'cover' ? 'Fills the whole area; edges that don’t fit are trimmed.'
      : f === 'contain' ? 'The whole image shows, as large as fits the area.'
      : f === 'stretch' ? 'Squeezed to exactly the area — proportions may change.'
      : 'Its own size (96 dpi), centred in the area.';
  }
  bgSummary(b: ResolvedBackground): string {
    const fit = this.bgFits.find(f => f.value === b.fit)?.label ?? b.fit;
    return [fit, `${this.round(b.opacity * 100)}% opacity`, b.pages === 'all' ? 'every page' : 'first page',
            b.onLetterhead ? 'also on letterhead paper' : ''].filter(Boolean).join(' · ');
  }
  patchBg(id: string, p: Partial<Record<keyof BackgroundImage, unknown>>) { this.emitCfg(setBackground(this.cfg(), id, p)); }
  setBgOpacity(id: string, pct: number) {
    if (!isFinite(pct)) return;
    this.patchBg(id, { opacity: Math.min(100, Math.max(5, Math.round(pct))) / 100 });
  }
  setBgScale(id: string, pct: number) {
    if (!isFinite(pct)) return;
    this.patchBg(id, { scale: Math.min(300, Math.max(10, Math.round(pct))) });
  }
  setBgPos(id: string, axis: 'x' | 'y', raw: string) {
    const v = parseFloat(raw);
    const b = this.layout().backgrounds.find(x => x.id === id);
    if (!b || !isFinite(v)) return;
    // Keep the other axis where it is on the page.
    const other = axis === 'x' ? { y: ptToMm(b.rect.y) } : { x: ptToMm(b.rect.x) };
    this.patchBg(id, { [axis]: v, ...other });
  }
  /** Move a background by (dx, dy) pt; a nudge stops on a guide / another
   *  element's edge, 'place' commits a drag's already-snapped position. */
  private moveBg(b: ResolvedBackground, dxPt: number, dyPt: number, mode: 'nudge' | 'place') {
    if (mode === 'nudge' && (dxPt || dyPt)) {
      const r = nudgeStop(b.box, dxPt, dyPt, this.snapContext('bg:' + b.id, 0));
      this.flashGuides(r);
      dxPt = r.rect.x - b.box.x; dyPt = r.rect.y - b.box.y;
    }
    this.patchBg(b.id, { x: ptToMm(b.rect.x + dxPt), y: ptToMm(b.rect.y + dyPt) });
  }
  dragReadoutBg(b: ResolvedBackground): string {
    const d = this.drag(); if (!d) return '';
    const s = this.scale();
    return `${ptToMm(b.rect.x + d.dxPx / s).toFixed(1)} mm · ${ptToMm(b.rect.y + d.dyPx / s).toFixed(1)} mm`;
  }
  onBgPointerDown(ev: PointerEvent, b: ResolvedBackground) {
    ev.stopPropagation();
    const id = 'bg:' + b.id;
    if (this.selected() !== id) { this.select(id); return; }
    if (ev.button !== 0) return;
    this.trackDrag(ev, id, b.box, false, (dx, dy) => this.moveBg(b, dx, dy, 'place'));
  }
  async removeBg(id: string) {
    const ok = await this.dialog.confirm({ title: 'Remove this background image?', message: 'It stops printing on every report. You can upload it again later.',
      confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    this.select(null);
    this.emitCfg(removeBackground(this.cfg(), id));
  }
  /** Pick → check → shrink to print size → upload (private /uploads) → add / replace. */
  async onBgPick(ev: Event, replaceId?: string) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    this.bgError.set(null);
    const bad = validateBackgroundFile(file);
    if (bad) { this.bgError.set(bad); return; }
    if (!replaceId && (this.cfg()?.backgrounds?.length ?? 0) >= MAX_BACKGROUNDS) { this.bgError.set(`Up to ${MAX_BACKGROUNDS} background images.`); return; }
    this.bgBusy.set(true);
    try {
      const shrunk = await this.shrinkImage(file);
      if (shrunk.blob.size > BG_MAX_UPLOAD_BYTES) {
        this.bgError.set(`Even at print size it is ${(shrunk.blob.size / 1048576).toFixed(1)} MB — save it as a JPG, or simplify it (limit 5 MB).`);
        return;
      }
      const url = await this.uploadBlob(shrunk.blob, `background.${shrunk.ext}`);
      if (replaceId) {
        this.emitCfg(setBackground(this.cfg(), replaceId, { url }));
      } else {
        const id = Date.now().toString(36);
        this.emitCfg(addBackground(this.cfg(), url, id, this.region() === 'footer' ? 'footer' : 'page'));
        this.select('bg:' + id);
      }
    } catch (e) {
      this.bgError.set(ApiError.from(e).message || 'Upload failed — try again.');
    } finally {
      this.bgBusy.set(false);
    }
  }
  // ── letterhead presets (phase 5) ─────────────────────────────────────
  readonly lhBusy = signal(false);
  readonly lhNote = signal<string | null>(null);
  readonly lhError = signal<string | null>(null);
  readonly lhPreset = computed<LetterheadPresetId>(() => letterheadPresetOf(this.template()));

  applyLetterhead(id: LetterheadPresetId) {
    if (id === this.lhPreset()) return;
    this.lhNote.set(null); this.lhError.set(null);
    this.patch.emit(applyLetterheadPreset(this.template(), id));
  }
  setLhContinuation(c: LetterheadContinuation) { this.patch.emit(setLetterheadContinuation(this.template(), c)); }
  setLhMm(mm: { headerMm?: number; footerMm?: number }) { this.lhNote.set(null); this.patch.emit(setLetterpadMm(this.template(), mm)); }

  /** Pick -> check -> shrink -> upload -> (stationery: measure it) -> apply the preset with the picture. */
  async onLetterheadFile(kind: LetterheadFileKind, file: File) {
    this.lhError.set(null); this.lhNote.set(null);
    const bad = validateBackgroundFile(file);
    if (bad) { this.lhError.set(bad); return; }
    this.lhBusy.set(true);
    try {
      const shrunk = await this.shrinkImage(file);
      if (shrunk.blob.size > BG_MAX_UPLOAD_BYTES) {
        this.lhError.set(`Even at print size it is ${(shrunk.blob.size / 1048576).toFixed(1)} MB — save it as a JPG, or simplify it (limit 5 MB).`);
        return;
      }
      const px = await readImagePixels(shrunk.blob);
      const url = await this.uploadBlob(shrunk.blob, `${kind === 'scan' ? 'stationery' : 'letterhead'}.${shrunk.ext}`);
      if (kind === 'image') {
        this.patch.emit(applyLetterheadPreset(this.template(), 'image', { imageUrl: url, imageAspect: px.height / px.width }));
        return;
      }
      const m = measureStationery(px);
      this.patch.emit(applyLetterheadPreset(this.template(), 'preprinted', { scanUrl: url, headerMm: m.headerMm ?? undefined, footerMm: m.footerMm ?? undefined }));
      this.lhNote.set(this.measureText(m.headerMm, m.footerMm));
    } catch (e) {
      this.lhError.set(ApiError.from(e).message || 'Upload failed — try again.');
    } finally {
      this.lhBusy.set(false);
    }
  }
  /** Measure the stationery scan that is already on the page again. */
  async measureScan() {
    this.lhError.set(null); this.lhNote.set(null);
    const bg = this.layout().backgrounds.find(b => b.id === LH_SCAN_ID);
    const src = bg ? this.imageCache()[bg.url] : null;
    if (!src) { this.lhError.set('The scan is not loaded yet — try again in a moment.'); return; }
    this.lhBusy.set(true);
    try {
      const m = measureStationery(await readImagePixels(src));
      this.patch.emit(setLetterpadMm(this.template(), { headerMm: m.headerMm ?? undefined, footerMm: m.footerMm ?? undefined }));
      this.lhNote.set(this.measureText(m.headerMm, m.footerMm));
    } catch {
      this.lhError.set('Could not read that image.');
    } finally {
      this.lhBusy.set(false);
    }
  }
  private measureText(top: number | null, bottom: number | null): string {
    if (top === null && bottom === null) return 'We could not see any printing at the top or bottom of that image. Type the blank space in mm.';
    const parts = [top !== null ? `${top} mm at the top` : 'nothing printed at the top', bottom !== null ? `${bottom} mm at the bottom` : 'nothing printed at the bottom'];
    return `Measured ${parts.join(' and ')}. Check the guides on the page and change the numbers if they are off.`;
  }

  /** Shrink to A4 @ 300 dpi on the longest side; opaque images become JPEG (small),
   *  images with transparency stay PNG. */
  protected async shrinkImage(file: File): Promise<{ blob: Blob; ext: 'jpg' | 'png' }> {
    const bmp = await createImageBitmap(file);
    const size = downscaleSize(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.w; canvas.height = size.h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, size.w, size.h);
    bmp.close?.();
    let alpha = false;
    if (!/jpe?g/i.test(file.type)) {
      const px = ctx.getImageData(0, 0, size.w, size.h).data;
      for (let i = 3; i < px.length; i += 4 * 7) { if (px[i] < 250) { alpha = true; break; } }
    }
    const type = alpha ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not read that image.'))), type, 0.86));
    return { blob, ext: alpha ? 'png' : 'jpg' };
  }
  /** POST /api/uploads/image (private, tenant-scoped) → the stored path. */
  protected async uploadBlob(blob: Blob, filename: string): Promise<string> {
    const fd = new FormData();
    fd.append('file', blob, filename);
    const resp = await firstValueFrom(this.http.post<{ success: boolean; data?: { url: string }; message?: string }>(
      `${this.platform.getApiUrl()}/api/uploads/image`, fd));
    if (!resp?.success || !resp.data?.url) throw new Error(resp?.message || 'Upload failed — try again.');
    return resp.data.url;
  }

  onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      // A deselect uses the Esc (desktop full screen stays — desktop-fullscreen-esc.ts).
      if (this.selected()) ev.preventDefault();
      this.select(null);
      return;
    }
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[ev.key];
    if (!d || !this.selected()) return;
    ev.preventDefault();
    const s = ev.shiftKey ? 5 : this.step();
    this.nudge(d[0] * s, d[1] * s);
  }

  // ── drag on the page ─────────────────────────────────────────────────
  onBoxPointerDown(ev: PointerEvent, it: LayoutItem) {
    ev.stopPropagation();
    if (this.selected() !== it.id) { this.select(it.id); return; }   // first tap selects
    if (!this.movable(it) || ev.button !== 0) return;
    this.trackDrag(ev, it.id, it.box, it.kind === 'bar', (dx, dy) => this.moveTo(it, dx, dy, 'place'));
  }
  /** Pointer drag with live smart guides; `commit` gets the final, already
   *  snapped (dx, dy) in pt. Alt (Option) held = free placement. */
  private trackDrag(ev: PointerEvent, id: string, box: SnapRect, lockX: boolean, commit: (dx: number, dy: number) => void) {
    const el = ev.currentTarget as HTMLElement;
    const sx = ev.clientX, sy = ev.clientY;
    let moved = false;
    try { el.setPointerCapture(ev.pointerId); } catch { /* jsdom */ }
    const onMove = (e: PointerEvent) => {
      const dx = lockX ? 0 : e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      if (this.flashTimer) { clearTimeout(this.flashTimer); this.flashTimer = null; }
      const s = this.scale();
      const proposed = { ...box, x: box.x + dx / s, y: box.y + dy / s };
      let at = proposed;
      if (snappingOn(e)) {
        const r = snapMove(proposed, this.snapContext(id, tolFromPx(s)), { x: !lockX });
        at = r.rect;
        this.smart.set({ lines: r.lines, measures: r.measures });
      } else {
        this.smart.set(NO_GUIDES);
      }
      this.drag.set({ id, dxPx: (at.x - box.x) * s, dyPx: (at.y - box.y) * s });
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      const d = this.drag();
      this.drag.set(null);
      this.smart.set(NO_GUIDES);
      if (moved && d) {
        const s = this.scale();
        // The snapped position is already in dxPx — commit it as a plain move.
        commit(d.dxPx / s, d.dyPx / s);
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  // ── show / hide, fields, lines ───────────────────────────────────────
  toggleEntry(e: Entry) {
    const on = this.isOn(e);
    if (e.id === 'accentBar') {
      // The bar is a template setting; clear any "hidden" override with it.
      const cfg = this.cfg();
      if (cfg?.items['accentBar']?.hidden) this.emitCfg(setItem(cfg, 'accentBar', { hidden: undefined }), { topAccentBar: !on });
      else this.emitPatch({ topAccentBar: !on });
      return;
    }
    if (e.id === 'nabl' && !this.template().nablAccredited) { this.emitPatch({ nablAccredited: true }); return; }
    if (e.state === 'joined') { this.removeFromJoined(e.id as HeaderField); return; }
    if (e.state === 'notPrinted') { this.addField(e.id as HeaderField); return; }
    if (e.state === 'off' && e.id === 'logo') return;
    this.setOverride({ hidden: on ? true : undefined }, e.id);
  }
  private joinedItem(): LayoutItem | undefined { return this.layout().items.find(i => i.id === 'contact'); }
  removeFromJoined(f: HeaderField) {
    const j = this.joinedItem(); if (!j) return;
    this.emitCfg(setItem(this.cfg(), 'contact', { fields: (j.fields ?? []).filter(x => x !== f) }));
  }
  moveToOwnLine(f: HeaderField) {
    const j = this.joinedItem(); if (!j) return;
    let cfg = setItem(this.cfg(), 'contact', { fields: (j.fields ?? []).filter(x => x !== f) });
    cfg = setItem(cfg, f, { added: true, hidden: undefined });
    this.emitCfg(cfg);
    this.select(f);
  }
  private addField(f: HeaderField) {
    this.emitCfg(setItem(this.cfg(), f, { added: true, hidden: undefined }));
  }
  lineText(id: string): string { return this.cfg()?.lines?.find(l => 'line:' + l.id === id)?.text ?? ''; }
  setLineText(id: string, text: string) {
    const cfg = this.cfg() ?? { v: 1 as const, items: {} };
    this.emitCfg({ ...cfg, lines: (cfg.lines ?? []).map(l => ('line:' + l.id === id ? { ...l, text } : l)) });
  }
  addLine() {
    const cfg = this.cfg() ?? { v: 1 as const, items: {} };
    const id = Date.now().toString(36);
    this.emitCfg({ ...cfg, lines: [...(cfg.lines ?? []), { id, text: 'GSTIN ' }] });
    this.select('line:' + id);
  }
  async deleteLine(id: string) {
    const ok = await this.dialog.confirm({ title: 'Delete this text line?', message: this.lineText(id), confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    const cfg = resetItem(this.cfg(), id);
    this.emitCfg({ ...cfg, lines: (cfg.lines ?? []).filter(l => 'line:' + l.id !== id) });
    this.select(null);
  }

  // ── resets ───────────────────────────────────────────────────────────
  resetSelected() {
    const id = this.selected(); if (!id) return;
    const cur = this.override(id);
    // "added" is WHETHER it prints, not how — keep it.
    const next = resetItem(this.cfg(), id);
    this.emitCfg(cur.added ? setItem(next, id, { added: true }) : next);
  }
  async resetAll() {
    const ok = await this.dialog.confirm({
      title: 'Reset the whole letterhead layout?',
      message: 'Every move, size, alignment and added line goes back to the header style’s own layout. Your lab name, address and other text stay.',
      confirmLabel: 'Reset layout', tone: 'danger',
    });
    if (!ok) return;
    this.select(null);
    this.emitCfg(null);
  }
  /** The template's preset, with the pre-rename spelling read as 'classic'. */
  presetOf(t: ReportTemplate): string { return normalizeHeaderPreset(t.headerPreset); }
  async setPreset(value: string) {
    if (normalizeHeaderPreset(this.template().headerPreset) === value) return;
    const cfg = this.cfg();
    const moved = cfg && Object.values(cfg.items).some(o => o.x !== undefined || o.y !== undefined || o.align !== undefined);
    if (!moved) { this.emitPatch({ headerPreset: value }); return; }
    const pick = await this.dialog.choose({
      title: `Switch to the ${PRESETS.find(p => p.value === value)?.label} style?`,
      message: 'You moved some elements. Their positions were chosen for the current style.',
      choices: [
        { value: 'fresh', label: 'Use the new style’s positions', hint: 'Keeps your text, sizes and hidden elements.' },
        { value: 'keep', label: 'Keep my positions', hint: 'Moved elements stay exactly where they are on the page.' },
      ],
    });
    if (!pick) return;
    if (pick === 'keep') { this.emitPatch({ headerPreset: value }); return; }
    let next: HeaderLayoutConfig = { ...cfg!, items: { ...cfg!.items } };
    for (const id of Object.keys(next.items)) next = setItem(next, id, { x: undefined, y: undefined, align: undefined });
    this.emitCfg(next, { headerPreset: value });
  }
  setBodyTop(v: number | null) {
    const cfg = this.cfg() ?? { v: 1 as const, items: {} };
    const next: HeaderLayoutConfig = { ...cfg };
    if (v == null || !isFinite(v)) delete next.bodyTop; else next.bodyTop = Math.min(120, Math.max(10, Math.round(v * 10) / 10));
    this.emitCfg(next);
  }

  // ── address quick placements ─────────────────────────────────────────
  readonly placements = computed(() => {
    const items = this.layout().items;
    const has = (id: string) => items.some(i => i.id === id && !i.hidden);
    const out: Array<{ key: 'underName' | 'rightColumn' | 'default'; label: string }> = [];
    if (has('name')) out.push({ key: 'underName', label: 'Under the lab name' });
    if (has('phone') || has('email')) out.push({ key: 'rightColumn', label: 'In the right column, under phone & email' });
    out.push({ key: 'default', label: 'Back to the style’s place' });
    return out;
  });
  place(key: 'underName' | 'rightColumn' | 'default') {
    const items = this.layout().items;
    const get = (id: string) => items.find(i => i.id === id && !i.hidden);
    if (key === 'default') { this.setOverride({ x: undefined, y: undefined, align: undefined, wrap: undefined }, 'address'); return; }
    const addr = get('address'); if (!addr) return;
    const size = addr.size ?? 8;
    if (key === 'underName') {
      const name = get('name')!, tag = get('tagline');
      const left = Math.min(name.box.x, tag?.box.x ?? Infinity);
      const base = (tag ?? name).y + size * 1.35;
      // Wrap before whatever sits on the right (phone / email / NABL).
      const rights = items.filter(i => !i.hidden && i.region === 'header' && ['phone', 'email', 'nabl', 'contact'].includes(i.id) && i.box.x > left + 20);
      const edge = rights.length ? Math.min(...rights.map(i => i.box.x)) - 8 : PAGE.w - MARGIN_X;
      this.setOverride({ align: 'left', x: ptToMm(left), y: ptToMm(base), wrap: Math.max(30, Math.round(ptToMm(edge - left))) }, 'address');
    } else {
      const col = ['phone', 'email'].map(get).filter((i): i is LayoutItem => !!i);
      const right = Math.max(...col.map(i => i.box.x + i.box.w));
      const low = col.reduce((m, i) => Math.max(m, i.y + ((i.lines?.length ?? 1) - 1) * (i.lineH ?? 0)), 0);
      this.setOverride({ align: 'right', x: ptToMm(right), y: ptToMm(low + size * 1.5), wrap: 70 }, 'address');
    }
  }
}
