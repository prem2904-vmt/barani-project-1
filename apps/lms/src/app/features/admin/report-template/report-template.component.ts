import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ReportSignature, ReportTemplate } from '../../../shared/models/report.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { ToggleComponent } from '../../../shared/primitives/toggle.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { ReportColumnsEditorComponent } from './report-columns-editor.component';
import { TestLayoutEditorComponent } from './test-layout-editor.component';
import { ImageUploadComponent } from './image-upload.component';
import { preloadReportImages, renderReportPdfBlobUrl } from '../../../shared/utils/report-pdf';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PlatformService } from '../../../core/services/platform.service';

type Tab = 'identity' | 'header' | 'theme' | 'patient' | 'datetime' | 'columns' | 'testlayout' | 'signoff';

/** Admin editor for the per-tenant ReportTemplateEntity. Seven tabs:
 *  Identity / Header & Logo / Theme / Patient / Date & Time / Columns /
 *  Sign-off & Footer. The right-hand pane renders a live PDF preview
 *  (debounced 300ms after each edit) using the same generateReportPdf
 *  code path real reports use — so what admins see is what patients get. */
@Component({
  selector: 'pf-report-template',
  standalone: true,
  imports: [
    FormsModule,
    ScreenHeaderComponent,
    SegmentedComponent,
    TileComponent,
    ToggleComponent,
    TouchButtonComponent,
    ReportColumnsEditorComponent,
    TestLayoutEditorComponent,
    ImageUploadComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin"
        title="Report Template"
        subtitle="Tune every visual element of the printed lab report — branding, colors, dates, signatures, footer.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="save()" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        <!-- ── Left: tabbed form ────────────────────────────── -->
        <div>
          <div class="mb-5 overflow-x-auto pb-1">
            <pf-segmented
              [options]="tabOptions"
              [value]="tab()"
              size="md"
              (valueChange)="setTab($event)">
            </pf-segmented>
          </div>

          @switch (tab()) {

            <!-- ────────── IDENTITY ────────── -->
            @case ('identity') {
              <pf-tile tone="default" padding="lg" class="block">
                <div class="space-y-3">
                  <div><label class="pf-label">Lab name</label>
                    <input type="text" class="pf-input"
                           [ngModel]="tpl().labName"
                           (ngModelChange)="patch({ labName: $event })" /></div>
                  <div><label class="pf-label">Tagline</label>
                    <input type="text" class="pf-input"
                           placeholder="e.g. Accurate | Caring | Instant"
                           [ngModel]="tpl().tagline"
                           (ngModelChange)="patch({ tagline: $event })" /></div>
                  <div class="grid grid-cols-2 gap-3">
                    <div><label class="pf-label">Phone</label>
                      <input type="text" class="pf-input"
                             [ngModel]="tpl().phone"
                             (ngModelChange)="patch({ phone: $event })" /></div>
                    <div><label class="pf-label">Email</label>
                      <input type="text" class="pf-input"
                             [ngModel]="tpl().email"
                             (ngModelChange)="patch({ email: $event })" /></div>
                  </div>
                  <div><label class="pf-label">Website</label>
                    <input type="text" class="pf-input"
                           [ngModel]="tpl().website"
                           (ngModelChange)="patch({ website: $event })" /></div>
                  <div><label class="pf-label">Address</label>
                    <input type="text" class="pf-input"
                           [ngModel]="tpl().address"
                           (ngModelChange)="patch({ address: $event })" /></div>

                  <div class="pf-divider"></div>

                  <div class="pf-toggle-row">
                    <div>
                      <p class="font-semibold text-[14px]" style="color: var(--text-primary);">NABL accredited</p>
                      <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">Display NABL badge on the report header.</p>
                    </div>
                    <pf-toggle [checked]="tpl().nablAccredited"
                               (checkedChange)="patch({ nablAccredited: $event })">
                    </pf-toggle>
                  </div>

                  @if (tpl().nablAccredited) {
                    <div class="grid grid-cols-2 gap-3 pf-nabl-grid">
                      <div><label class="pf-label">NABL number</label>
                        <input type="text" class="pf-input"
                               [ngModel]="tpl().nablNumber"
                               (ngModelChange)="patch({ nablNumber: $event })" /></div>
                      <div>
                        <label class="pf-label">NABL badge image</label>
                        <pf-image-upload [url]="tpl().nablLogoUrl"
                                         (urlChange)="patch({ nablLogoUrl: $event })">
                        </pf-image-upload>
                      </div>
                    </div>
                  }
                </div>
              </pf-tile>
            }

            <!-- ────────── HEADER & LOGO ────────── -->
            @case ('header') {
              <pf-tile tone="default" padding="lg" class="block">
                <div class="space-y-4">
                  <div>
                    <label class="pf-label">Lab logo</label>
                    <pf-image-upload [url]="tpl().logoUrl"
                                     (urlChange)="patch({ logoUrl: $event })">
                    </pf-image-upload>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label class="pf-label">Header preset</label>
                      <pf-segmented
                        [options]="headerPresetOptions"
                        [value]="tpl().headerPreset ?? 'drlogy'"
                        size="sm"
                        (valueChange)="patch({ headerPreset: $event })">
                      </pf-segmented>
                    </div>
                    <div>
                      <label class="pf-label">Logo position</label>
                      <pf-segmented
                        [options]="logoPositionOptions"
                        [value]="tpl().logoPosition ?? 'left'"
                        size="sm"
                        (valueChange)="patch({ logoPosition: $event })">
                      </pf-segmented>
                    </div>
                    <div>
                      <label class="pf-label">Logo size</label>
                      <pf-segmented
                        [options]="sizeOptions"
                        [value]="tpl().logoSize ?? 'md'"
                        size="sm"
                        (valueChange)="patch({ logoSize: $event })">
                      </pf-segmented>
                    </div>
                  </div>

                  <div class="pf-toggle-row">
                    <div>
                      <p class="font-semibold text-[14px]" style="color: var(--text-primary);">Top accent bar</p>
                      <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">Thin colored strip beneath the letterhead.</p>
                    </div>
                    <pf-toggle [checked]="tpl().topAccentBar ?? true"
                               (checkedChange)="patch({ topAccentBar: $event })">
                    </pf-toggle>
                  </div>
                </div>
              </pf-tile>
            }

            <!-- ────────── THEME ────────── -->
            @case ('theme') {
              <pf-tile tone="default" padding="lg" class="block">
                <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3"
                   style="color: var(--text-muted);">Colors</p>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
                  @for (c of colorFields; track c.key) {
                    <div>
                      <label class="pf-label">{{ c.label }}</label>
                      <div class="flex items-center gap-2">
                        <input type="color" class="pf-color-picker"
                               [ngModel]="colorOf(c.key) || c.fallback"
                               (ngModelChange)="patchKey(c.key, $event)" />
                        <span class="font-mono text-[11px]" style="color: var(--text-secondary);">
                          {{ colorOf(c.key) || c.fallback }}
                        </span>
                      </div>
                    </div>
                  }
                </div>

                <div class="pf-divider"></div>

                <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3 mt-4"
                   style="color: var(--text-muted);">Typography & table style</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label class="pf-label">Font family</label>
                    <pf-segmented
                      [options]="fontOptions"
                      [value]="tpl().fontFamily ?? 'helvetica'"
                      size="sm"
                      (valueChange)="patch({ fontFamily: $event })">
                    </pf-segmented>
                  </div>
                  <div>
                    <label class="pf-label">Font size</label>
                    <pf-segmented
                      [options]="sizeOptions"
                      [value]="tpl().fontSize ?? 'md'"
                      size="sm"
                      (valueChange)="patch({ fontSize: $event })">
                    </pf-segmented>
                  </div>
                  <div>
                    <label class="pf-label">Table style</label>
                    <pf-segmented
                      [options]="tableStyleOptions"
                      [value]="tpl().tableStyle ?? 'plain'"
                      size="sm"
                      (valueChange)="patch({ tableStyle: $event })">
                    </pf-segmented>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[14px]" style="color: var(--text-primary);">Zebra rows</span>
                    <pf-toggle [checked]="tpl().zebraRows ?? false"
                               (checkedChange)="patch({ zebraRows: $event })">
                    </pf-toggle>
                  </div>
                  <div>
                    <label class="pf-label">Abnormal value style</label>
                    <pf-segmented
                      [options]="flagStyleOptions"
                      [value]="tpl().flagStyle ?? 'bold'"
                      size="sm"
                      (valueChange)="patch({ flagStyle: $event })">
                    </pf-segmented>
                    <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">
                      How out-of-range results are emphasised. NABL reports typically use bold; colour is optional.
                    </p>
                  </div>
                  <div>
                    <label class="pf-label">Abnormal indicator</label>
                    <pf-segmented
                      [options]="flagIndicatorOptions"
                      [value]="tpl().flagIndicator ?? 'letter'"
                      size="sm"
                      (valueChange)="patch({ flagIndicator: $event })">
                    </pf-segmented>
                    <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">
                      Mark high/low with H&nbsp;/&nbsp;L letters or ↑&nbsp;/&nbsp;↓ arrows.
                    </p>
                  </div>
                  @if ((tpl().flagStyle ?? 'bold') === 'bold_color') {
                    <div class="pf-toggle-row">
                      <span class="text-[14px]" style="color: var(--text-primary);">High value colour</span>
                      <input type="color"
                             style="width:46px;height:30px;border:1px solid var(--glass-border);border-radius:8px;background:transparent;cursor:pointer;padding:2px"
                             [ngModel]="tpl().abnormalColor || '#dc2626'"
                             (ngModelChange)="patch({ abnormalColor: $event })" />
                    </div>
                    <div class="pf-toggle-row">
                      <span class="text-[14px]" style="color: var(--text-primary);">Low value colour</span>
                      <input type="color"
                             style="width:46px;height:30px;border:1px solid var(--glass-border);border-radius:8px;background:transparent;cursor:pointer;padding:2px"
                             [ngModel]="tpl().abnormalLowColor || '#2563eb'"
                             (ngModelChange)="patch({ abnormalLowColor: $event })" />
                    </div>
                  }
                  <div class="pf-toggle-row">
                    <span class="text-[14px]" style="color: var(--text-primary);">Group by department</span>
                    <pf-toggle [checked]="tpl().groupByDepartment ?? false"
                               (checkedChange)="patch({ groupByDepartment: $event })">
                    </pf-toggle>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[14px]" style="color: var(--text-primary);">Show method line</span>
                    <pf-toggle [checked]="tpl().showMethod ?? false"
                               (checkedChange)="patch({ showMethod: $event })">
                    </pf-toggle>
                  </div>
                </div>
              </pf-tile>
            }

            <!-- ────────── PATIENT BLOCK ────────── -->
            @case ('patient') {
              <pf-tile tone="default" padding="lg" class="block">
                <div class="space-y-4">
                  <div>
                    <label class="pf-label">Patient block layout</label>
                    <pf-segmented
                      [options]="patientLayoutOptions"
                      [value]="tpl().patientLayout ?? 'three-col'"
                      size="md"
                      (valueChange)="patch({ patientLayout: $event })">
                    </pf-segmented>
                  </div>

                  <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1 mt-4"
                     style="color: var(--text-muted);">Show / hide patient fields</p>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                    @for (f of patientToggles; track f.key) {
                      <div class="pf-toggle-row">
                        <span class="text-[14px]" style="color: var(--text-primary);">{{ f.label }}</span>
                        <pf-toggle
                          [checked]="getBool(f.key, f.defaultVal)"
                          size="sm"
                          (checkedChange)="patchBool(f.key, $event)">
                        </pf-toggle>
                      </div>
                    }
                  </div>
                </div>
              </pf-tile>
            }

            <!-- ────────── DATE & TIME ────────── -->
            @case ('datetime') {
              <pf-tile tone="default" padding="lg" class="block">
                <div class="space-y-4">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label class="pf-label">Date format</label>
                      <select class="pf-input"
                              [ngModel]="tpl().dateFormat ?? 'dd MMM yyyy'"
                              (ngModelChange)="patch({ dateFormat: $event })">
                        @for (o of dateFormatOptions; track o.value) {
                          <option [value]="o.value">{{ o.label }}</option>
                        }
                      </select>
                    </div>
                    <div>
                      <label class="pf-label">Time format</label>
                      <pf-segmented
                        [options]="timeFormatOptions"
                        [value]="tpl().timeFormat ?? '12h'"
                        size="sm"
                        (valueChange)="patch({ timeFormat: $event })">
                      </pf-segmented>
                    </div>
                  </div>

                  <div>
                    <label class="pf-label">Joiner between date and time</label>
                    <select class="pf-input"
                            [ngModel]="tpl().dateTimeSeparator ?? ', '"
                            (ngModelChange)="patch({ dateTimeSeparator: $event })">
                      @for (o of separatorOptions; track o.value) {
                        <option [value]="o.value">{{ o.label }}</option>
                      }
                    </select>
                  </div>

                  <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1 mt-4"
                     style="color: var(--text-muted);">Which timestamps to show</p>
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                    @for (f of timestampToggles; track f.key) {
                      <div class="pf-toggle-row">
                        <span class="text-[14px]" style="color: var(--text-primary);">{{ f.label }}</span>
                        <pf-toggle
                          [checked]="getBool(f.key, true)"
                          size="sm"
                          (checkedChange)="patchBool(f.key, $event)">
                        </pf-toggle>
                      </div>
                    }
                  </div>
                </div>
              </pf-tile>
            }

            <!-- ────────── COLUMNS (per-dept results table) ────────── -->
            @case ('columns') {
              <pf-report-columns-editor></pf-report-columns-editor>
            }

            <!-- ────────── PER-TEST LAYOUT (sections engine) ────────── -->
            @case ('testlayout') {
              <pf-test-layout-editor></pf-test-layout-editor>
            }

            <!-- ────────── SIGN-OFF & FOOTER ────────── -->
            @case ('signoff') {
              <pf-tile tone="default" padding="lg" class="block">
                <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3"
                   style="color: var(--text-muted);">Signature blocks (up to 3)</p>

                @for (sig of signatures(); track $index; let i = $index) {
                  <div class="pf-sig-card">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-[12px] font-semibold" style="color: var(--text-secondary);">Sign-off #{{ i + 1 }}</span>
                      <button type="button" class="pf-link-btn" (click)="removeSignature(i)">Remove</button>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <input class="pf-input" placeholder="Name (e.g. Dr. Payal Shah)"
                             [ngModel]="sig.name"
                             (ngModelChange)="updateSignature(i, { name: $event })" />
                      <input class="pf-input" placeholder="Title (e.g. MD, Pathologist)"
                             [ngModel]="sig.title"
                             (ngModelChange)="updateSignature(i, { title: $event })" />
                      <input class="pf-input" placeholder="Reg. No"
                             [ngModel]="sig.regNo"
                             (ngModelChange)="updateSignature(i, { regNo: $event })" />
                    </div>
                    <div class="mt-2">
                      <label class="pf-label">Signature image (optional)</label>
                      <pf-image-upload [url]="sig.signatureUrl"
                                       (urlChange)="updateSignature(i, { signatureUrl: $event })">
                      </pf-image-upload>
                    </div>
                  </div>
                }

                @if (signatures().length < 3) {
                  <button type="button" class="pf-add-btn" (click)="addSignature()">+ Add sign-off block</button>
                }

                <div class="pf-divider mt-4"></div>

                <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3 mt-4"
                   style="color: var(--text-muted);">Footer text</p>
                <div class="space-y-3">
                  <div>
                    <label class="pf-label">Disclaimer (small print)</label>
                    <textarea class="pf-input min-h-[64px]"
                              [ngModel]="tpl().disclaimer"
                              (ngModelChange)="patch({ disclaimer: $event })"></textarea>
                  </div>
                  <div>
                    <label class="pf-label">Footer text (legal / contact line)</label>
                    <input class="pf-input"
                           [ngModel]="tpl().footerText"
                           (ngModelChange)="patch({ footerText: $event })" />
                  </div>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label class="pf-label">"End of Report" marker text</label>
                      <input class="pf-input"
                             placeholder="****End of Report****"
                             [ngModel]="tpl().endOfReportText"
                             (ngModelChange)="patch({ endOfReportText: $event })" />
                    </div>
                    <div>
                      <label class="pf-label">Watermark text (page 1)</label>
                      <input class="pf-input"
                             placeholder="e.g. DRAFT, COPY"
                             [ngModel]="tpl().watermarkText"
                             (ngModelChange)="patch({ watermarkText: $event })" />
                    </div>
                  </div>
                  @if (tpl().watermarkText) {
                    <div>
                      <label class="pf-label">Watermark opacity ({{ ((tpl().watermarkOpacity ?? 0.08) * 100).toFixed(0) }}%)</label>
                      <input type="range" min="0.02" max="0.4" step="0.02"
                             [ngModel]="tpl().watermarkOpacity ?? 0.08"
                             (ngModelChange)="patch({ watermarkOpacity: +$event })" />
                    </div>
                  }
                </div>

                <div class="pf-divider mt-4"></div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
                  <div class="pf-toggle-row">
                    <span class="text-[14px]" style="color: var(--text-primary);">Sample Collection band</span>
                    <pf-toggle [checked]="tpl().showSampleCollectionBand ?? true"
                               (checkedChange)="patch({ showSampleCollectionBand: $event })">
                    </pf-toggle>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[14px]" style="color: var(--text-primary);">"Powered by Prefrontal" line</span>
                    <pf-toggle [checked]="tpl().showPoweredBy"
                               (checkedChange)="patch({ showPoweredBy: $event })">
                    </pf-toggle>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[14px]" style="color: var(--text-primary);">QR code (verify online)</span>
                    <pf-toggle [checked]="tpl().showQrCode"
                               (checkedChange)="patch({ showQrCode: $event })">
                    </pf-toggle>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[14px]" style="color: var(--text-primary);">Show pathologist name (legacy)</span>
                    <pf-toggle [checked]="tpl().showPathologistName"
                               (checkedChange)="patch({ showPathologistName: $event })">
                    </pf-toggle>
                  </div>
                </div>
              </pf-tile>
            }
          }
        </div>

        <!-- ── Right: live PDF preview (hidden on the per-test layout tab,
                which has its own engine-resolved preview pane) ─────── -->
        @if (tab() !== 'testlayout') {
        <aside class="lg:sticky lg:top-4 h-fit">
          <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-2"
             style="color: var(--text-muted);">Live preview ({{ rendering() ? 'rendering…' : 'PDF' }})</p>
          <div class="pf-pdf-frame">
            @if (previewSafe()) {
              <iframe [src]="previewSafe()" title="Report PDF preview"
                      class="w-full pf-pdf-iframe"></iframe>
            } @else {
              <div class="flex items-center justify-center h-[600px]" style="color: var(--text-tertiary);">
                Loading preview…
              </div>
            }
          </div>
          <p class="text-[10px] mt-2" style="color: var(--text-tertiary);">
            Preview uses a sample order. Save to apply this template to real reports.
          </p>
        </aside>
        }
      </div>
    </section>
  `,
  styles: [`
    .pf-color-picker { height: 36px; width: 56px; border-radius: 8px;
      border: 1px solid var(--glass-border); cursor: pointer;
      background: var(--glass-bg); }
    .pf-toggle-row { display: flex; align-items: center;
      justify-content: space-between; padding: 8px 12px; border-radius: 10px;
      background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-divider { height: 1px; background: var(--border-muted, #e2e8f0);
      margin: 8px 0; opacity: 0.6; }
    .pf-pdf-frame { border-radius: 14px; border: 1px solid var(--glass-border);
      background: #ffffff; overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18); }
    .pf-pdf-iframe { height: 760px; border: 0; background: #ffffff; display: block; }
    .pf-sig-card { border: 1px solid var(--glass-border); border-radius: 12px;
      padding: 12px; margin-bottom: 10px; background: rgba(255,255,255,0.02); }
    .pf-link-btn { background: transparent; border: none; color: #ef4444;
      cursor: pointer; font-size: 12px; text-decoration: underline; }
    .pf-add-btn { width: 100%; padding: 10px; border-radius: 10px;
      background: rgba(168,85,247,0.08); border: 1px dashed rgba(168,85,247,0.5);
      color: #c4b5fd; cursor: pointer; font-weight: 600; font-size: 13px; }

    /* ── Additive cross-platform overrides only — desktop-web (>=1280)
         is intentionally untouched. ──────────────────────────────── */

    /* Hover affordances gated to real pointers so touch devices don't
       get stuck-hover states. */
    @media (hover: hover) {
      .pf-add-btn:hover { background: rgba(168,85,247,0.14); }
    }

    /* Touch sizing: color pickers + small action buttons get >=44px
       tap targets on coarse pointers without changing visual size on
       mouse-driven desktop. */
    @media (pointer: coarse) {
      .pf-color-picker { min-height: 44px; }
      .pf-link-btn { min-height: 44px; padding: 6px 4px; }
      /* Inline-styled high/low colour swatches (Theme tab) sit at 30px;
         lift them to a real tap target on touch. !important is needed
         to win over the element's inline height. Scoped to this page's
         toggle rows so no global swatch is affected. */
      .pf-toggle-row input[type="color"] { min-height: 44px !important; }
    }

    /* Phone (<=640): the NABL number field + badge-image uploader are
       too cramped side-by-side — stack them. Width-gated, so the
       tablet/desktop 2-col layout is untouched. */
    @media (max-width: 640px) {
      .pf-nabl-grid { grid-template-columns: 1fr; }
    }

    /* Phone (<=640): the live-preview pane sits below the form as a tall
       block. Cap its height so it doesn't dominate the scroll, and let
       the placeholder match. Cannot affect desktop — width-gated. */
    @media (max-width: 640px) {
      .pf-pdf-iframe { height: 70dvh; min-height: 360px; max-height: 560px; }
      .pf-add-btn { padding: 12px; }
    }
  `],
})
export class ReportTemplateComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly platform = inject(PlatformService);

  readonly tabOptions: SegmentedOption<Tab>[] = [
    { value: 'identity', label: 'Identity' },
    { value: 'header',   label: 'Header & Logo' },
    { value: 'theme',    label: 'Theme' },
    { value: 'patient',  label: 'Patient' },
    { value: 'datetime', label: 'Date & Time' },
    { value: 'columns',  label: 'Columns' },
    { value: 'testlayout', label: 'Per-test layout' },
    { value: 'signoff',  label: 'Sign-off & Footer' },
  ];
  private readonly _tab = signal<Tab>('identity');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) { this._tab.set(t); }

  readonly headerPresetOptions: SegmentedOption<string>[] = [
    { value: 'drlogy',   label: 'Drlogy'   },
    { value: 'centered', label: 'Centered' },
    { value: 'banner',   label: 'Banner'   },
    { value: 'minimal',  label: 'Minimal'  },
  ];
  readonly logoPositionOptions: SegmentedOption<string>[] = [
    { value: 'left',   label: 'Left'   },
    { value: 'center', label: 'Center' },
    { value: 'right',  label: 'Right'  },
  ];
  readonly sizeOptions: SegmentedOption<string>[] = [
    { value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' },
  ];
  readonly fontOptions: SegmentedOption<string>[] = [
    { value: 'helvetica', label: 'Sans (Helvetica)' },
    { value: 'times',     label: 'Serif (Times)'    },
    { value: 'courier',   label: 'Mono (Courier)'   },
  ];
  readonly tableStyleOptions: SegmentedOption<string>[] = [
    { value: 'plain',    label: 'Plain'    },
    { value: 'bordered', label: 'Bordered' },
    { value: 'striped',  label: 'Striped'  },
  ];
  readonly flagIndicatorOptions: SegmentedOption<string>[] = [
    { value: 'letter', label: 'H / L' },
    { value: 'arrow',  label: '↑ / ↓' },
  ];
  readonly flagStyleOptions: SegmentedOption<string>[] = [
    { value: 'bold',       label: 'Bold (H/L)'   },
    { value: 'bold_color', label: 'Bold + colour' },
  ];
  readonly patientLayoutOptions: SegmentedOption<string>[] = [
    { value: 'three-col',     label: '3-column (Drlogy)' },
    { value: 'four-col-grid', label: '4-column grid'     },
    { value: 'stacked',       label: 'Stacked'           },
  ];
  readonly timeFormatOptions: SegmentedOption<string>[] = [
    { value: 'none', label: 'Date only' },
    { value: '12h',  label: '12h AM/PM' },
    { value: '24h',  label: '24h'       },
  ];
  readonly dateFormatOptions = [
    { value: 'dd MMM yyyy',   label: 'dd MMM yyyy   →  14 May 2026'   },
    { value: 'dd/MM/yyyy',    label: 'dd/MM/yyyy    →  14/05/2026'    },
    { value: 'MMM dd, yyyy',  label: 'MMM dd, yyyy  →  May 14, 2026'  },
    { value: 'yyyy-MM-dd',    label: 'yyyy-MM-dd    →  2026-05-14'    },
  ];
  readonly separatorOptions = [
    { value: ', ',   label: '", "   →  May 14, 2026, 11:01 PM' },
    { value: '  ',   label: '"  "   →  May 14, 2026 11:01 PM' },
    { value: ' · ',  label: '" · "  →  May 14, 2026 · 11:01 PM' },
    { value: ' | ',  label: '" | "  →  May 14, 2026 | 11:01 PM' },
  ];

  readonly colorFields: Array<{ key: keyof ReportTemplate; label: string; fallback: string }> = [
    { key: 'primaryColor',    label: 'Primary',           fallback: '#1B3A6B' },
    { key: 'accentColor',     label: 'Accent',            fallback: '#0066CC' },
    { key: 'tableHeaderBg',   label: 'Table header bg',   fallback: '#ffffff' },
    { key: 'tableHeaderText', label: 'Table header text', fallback: '#000000' },
    { key: 'bodyTextColor',   label: 'Body text',         fallback: '#1a1a1a' },
    { key: 'dividerColor',    label: 'Divider / hairline',fallback: '#cccccc' },
  ];

  readonly patientToggles: Array<{ key: keyof ReportTemplate; label: string; defaultVal: boolean }> = [
    { key: 'showPatientName', label: 'Patient name',       defaultVal: true  },
    { key: 'showAge',         label: 'Age & sex',          defaultVal: true  },
    { key: 'showOrderId',     label: 'Patient / Order ID', defaultVal: true  },
    { key: 'showRefDoctor',   label: 'Referring doctor',   defaultVal: true  },
    { key: 'showAbhaId',      label: 'ABHA ID',            defaultVal: false },
    { key: 'showBarcode',     label: 'Barcode',            defaultVal: true  },
  ];
  readonly timestampToggles: Array<{ key: keyof ReportTemplate; label: string }> = [
    { key: 'showRegistered',     label: 'Registered on' },
    { key: 'showCollectionDate', label: 'Collected on' },
    { key: 'showReportDate',     label: 'Reported on' },
  ];

  // The columns-tab editor; captured for future cross-pane wiring.
  readonly columnsEditor = viewChild(ReportColumnsEditorComponent);

  // ── Template state ──────────────────────────────────────────
  private readonly _tpl = signal<ReportTemplate>(this.defaultTemplate());
  readonly tpl = this._tpl.asReadonly();
  patch(p: Partial<ReportTemplate>) { this._tpl.update(v => ({ ...v, ...p })); }
  patchKey(key: keyof ReportTemplate, val: unknown) {
    this.patch({ [key]: val } as Partial<ReportTemplate>);
  }
  patchBool(key: keyof ReportTemplate, v: boolean) {
    this.patch({ [key]: v } as Partial<ReportTemplate>);
  }
  getBool(key: keyof ReportTemplate, dflt: boolean): boolean {
    const v = (this._tpl() as unknown as Record<string, unknown>)[key];
    return typeof v === 'boolean' ? v : dflt;
  }
  colorOf(key: keyof ReportTemplate): string {
    return (this._tpl() as unknown as Record<string, string>)[key as string] ?? '';
  }

  private defaultTemplate(): ReportTemplate {
    return {
      id: '', tenantId: '',
      labName: 'Prefrontal Pathology Lab',
      tagline: 'Accurate | Caring | Instant',
      address: '', phone: '', email: '', website: '', logoUrl: '',
      nablAccredited: false, nablNumber: '', nablLogoUrl: '',
      headerPreset: 'drlogy', logoPosition: 'left', logoSize: 'md', topAccentBar: true,
      primaryColor: '#1B3A6B', accentColor: '#0066CC',
      tableHeaderBg: '#ffffff', tableHeaderText: '#000000',
      bodyTextColor: '#1a1a1a', dividerColor: '#cccccc',
      fontFamily: 'helvetica', fontSize: 'md',
      tableStyle: 'plain', zebraRows: false,
      patientLayout: 'three-col',
      showPatientName: true, showAge: true, showRefDoctor: true,
      showOrderId: true, showAbhaId: false,
      showBarcode: true, showQrCode: true,
      dateFormat: 'dd MMM yyyy', timeFormat: '12h', dateTimeSeparator: ', ',
      showRegistered: true, showCollectionDate: true, showReportDate: true,
      showMethod: false, showInstrument: false,
      groupByDepartment: false, showCriticalFlag: true, flagStyle: 'bold', flagIndicator: 'letter', abnormalColor: '#dc2626', abnormalLowColor: '#2563eb',
      showPathologistName: true, showSignature: true,
      signatureUrl: '', signaturesJson: '[]',
      disclaimer: 'Test results should be correlated clinically.',
      footerText: '',
      watermarkText: '', watermarkOpacity: 0.08,
      showSampleCollectionBand: true,
      endOfReportText: '****End of Report****',
      showPoweredBy: true,
    };
  }

  // ── Signatures (de/serialised as JSON in signaturesJson) ──────
  readonly signatures = computed<ReportSignature[]>(() => {
    const raw = this._tpl().signaturesJson;
    if (!raw || !raw.trim()) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  });
  private setSignatures(arr: ReportSignature[]) {
    this.patch({ signaturesJson: JSON.stringify(arr) });
  }
  addSignature() {
    if (this.signatures().length >= 3) return;
    this.setSignatures([...this.signatures(), { name: '', title: '' }]);
  }
  removeSignature(i: number) {
    const next = this.signatures().slice();
    next.splice(i, 1);
    this.setSignatures(next);
  }
  updateSignature(i: number, patch: Partial<ReportSignature>) {
    const next = this.signatures().slice();
    next[i] = { ...next[i], ...patch };
    this.setSignatures(next);
  }

  // ── Live preview ─────────────────────────────────────────────
  private readonly _previewUrl = signal<string | null>(null);
  readonly previewUrl = this._previewUrl.asReadonly();
  /** Sanitised version of the blob URL — Angular blocks raw blob: URIs
   *  in `[src]` bindings otherwise. */
  readonly previewSafe = computed<SafeResourceUrl | null>(() => {
    const u = this._previewUrl();
    return u ? this.sanitizer.bypassSecurityTrustResourceUrl(u) : null;
  });
  readonly rendering = signal<boolean>(false);
  private renderTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Debounced live-preview render — every template change schedules a
    // 300ms tick that regenerates the blob URL (avoids hammering jsPDF
    // on every keystroke).
    effect(() => {
      const tpl = this._tpl();
      if (this.renderTimer) clearTimeout(this.renderTimer);
      this.rendering.set(true);
      this.renderTimer = setTimeout(() => this.renderPreview(tpl), 300);
    });
  }

  private async renderPreview(tpl: ReportTemplate) {
    try {
      const baseInput = {
        report: { id: 'preview-' + Date.now(), type: 'final',
                  createdAt: new Date().toISOString(), data: this.sampleSnapshot() },
        template: tpl,
      };
      // Preload uploaded images (logo, NABL, sig scans) as data URLs.
      // The sync renderer can't fetch images itself, so this step
      // hydrates an IMG_CACHE map keyed by the relative URL.
      const imageCache = await preloadReportImages(baseInput, this.platform.getApiUrl());
      const prev = this._previewUrl();
      if (prev) URL.revokeObjectURL(prev);
      const url = renderReportPdfBlobUrl({ ...baseInput, imageCache });
      // #view=FitH&toolbar=0 gives a clean top-fit preview in Chrome/FF.
      this._previewUrl.set(url + '#view=FitH&toolbar=0');
    } catch (e) {
      console.error('preview render failed', e);
    } finally {
      this.rendering.set(false);
    }
  }

  /** Sample report payload that exercises the visible chrome — patient
   *  block, multi-test grouping, sample type, multi-parameter test. */
  private sampleSnapshot(): string {
    return JSON.stringify({
      patient: { displayName: 'Sita Raman', age: 37, sex: 'Female', phone: '9080706050' },
      order:   { id: 'preview-order-12345',
                 createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
                 refDoctorName: 'Dr. A. Sharma' },
      type: 'final',
      tests: [
        { testId: 'd1', name: 'Complete Blood Count (CBC)', department: 'Hematology',
          sampleType: 'EDTA Whole Blood', method: 'Automated cell counter',
          result: { values: {
            'Hemoglobin':   { value: '11.4', unit: 'g/dL',     range: '12.0 – 16.0', flag: 'L' },
            'RBC Count':    { value: '4.6',  unit: 'mill/cmm',  range: '3.8 – 4.8' },
            'WBC Count':    { value: '12800', unit: '/cmm',     range: '4000 – 11000', flag: 'H' },
            'Platelets':    { value: '240000', unit: '/cmm',    range: '150000 – 410000' },
          } } },
        { testId: 'd2', name: 'Lipid Profile', department: 'Biochemistry',
          sampleType: 'Serum', method: 'Photometry',
          result: { values: {
            'Total Cholesterol': { value: '210', unit: 'mg/dL', range: '< 200', flag: 'H' },
            'HDL Cholesterol':   { value: '52',  unit: 'mg/dL', range: '> 40' },
            'LDL Cholesterol':   { value: '135', unit: 'mg/dL', range: '< 100', flag: 'H' },
            'Triglycerides':     { value: '120', unit: 'mg/dL', range: '< 150' },
          } } },
        { testId: 'd3', name: 'Vitamin D (25-OH)', department: 'Biochemistry',
          sampleType: 'Serum', nablScope: false, referralLab: 'Reference Labs Pvt. Ltd., Mumbai',
          result: { values: {
            '25-Hydroxy Vitamin D': { value: '18', unit: 'ng/mL', range: '30 – 100', flag: 'L' },
          } } },
      ],
    });
  }

  ngOnInit() {
    const initial = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (initial && this.tabOptions.some(o => o.value === initial)) {
      this._tab.set(initial);
    }
    this.api.get<ReportTemplate>('/api/config/report-template').subscribe({
      next: t => { if (t) this._tpl.set({ ...this._tpl(), ...t }); }
    });
  }

  ngOnDestroy() {
    const prev = this._previewUrl();
    if (prev) URL.revokeObjectURL(prev);
    if (this.renderTimer) clearTimeout(this.renderTimer);
  }

  // ── Save ────────────────────────────────────────────────────
  readonly saving = signal<boolean>(false);
  save() {
    if (this.saving()) return;
    this.saving.set(true);
    // Send every field — the server merges with defaults and writes one row.
    this.api.post('/api/config/report-template', this._tpl()).subscribe({
      next: () => { this.toasts.success('Template saved'); this.saving.set(false); },
      error: () => { this.saving.set(false); },
    });
  }
}
