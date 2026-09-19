import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ReportTemplate } from '../../../shared/models/report.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { ReportColumn } from '../../../shared/models/report-layout.model';
import { ResolvedReportLayout } from '../../../shared/models/report-layout.model';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { ToggleComponent } from '../../../shared/primitives/toggle.component';
import { SelectComponent } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { ReportColumnsEditorComponent } from './report-columns-editor.component';
import { ImageUploadComponent } from './image-upload.component';
import { preloadReportImages, renderReportPdfBlobUrl } from '../../../shared/utils/report-pdf';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PlatformService } from '../../../core/services/platform.service';

type Tab = 'letterhead' | 'patient' | 'table' | 'columns' | 'footer';

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
    DragDropModule,
    SegmentedComponent,
    SelectComponent,
    ToggleComponent,
    TouchButtonComponent,
    ReportColumnsEditorComponent,
    ImageUploadComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-6 lg:px-8 pt-3 pb-10 pf-rt-page">
      <header class="pf-rt-head">
        <div class="min-w-0">
          <h1 class="pf-rt-title">Report designer</h1>
          <p class="pf-rt-sub">How every printed report looks — edit on the left, watch the page on the right.</p>
        </div>
        <pf-touch-btn size="sm" variant="primary" (pressed)="save()" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </header>

      <div class="pf-rt-grid">
        <!-- ── Section rail: one part of the report at a time. ── -->
        <nav class="pf-rt-rail" aria-label="Report template sections">
          @for (sec of sections; track sec.value) {
            <button type="button" class="pf-rt-rail__item press"
                    [class.pf-rt-rail__item--on]="tab() === sec.value"
                    (click)="setTab(sec.value)" [title]="sec.desc">
              <span class="pf-rt-rail__txt">{{ sec.label }}</span>
            </button>
          }
        </nav>

        <!-- ── Focused section panel. ── -->
        <div class="pf-rt-work">
          @if (activeSection(); as sec) {
            <div class="pf-rt-work__hdr">
              <h2 class="pf-rt-work__title">{{ sec.label }}</h2>
              <p class="pf-rt-work__sub">{{ sec.desc }}</p>
            </div>
          }
          @switch (tab()) {

            <!-- ══ LETTERHEAD — everything printed at the top of the page ══ -->
            @case ('letterhead') {
              <div class="pf-rt-flat">
                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Branding</h4>
                  <p class="pf-rtb-s">The name and tagline printed at the top of every report — live below.</p>
                  <div class="pf-wys-paper pf-wys-masthead">
                    <span class="pf-wys-masthead__name" [style.color]="colorOf('primaryColor') || '#1B3A6B'">
                      {{ tpl().labName || 'Your Lab Name' }}
                    </span>
                    <span class="pf-wys-masthead__tag">{{ tpl().tagline || 'Tagline appears here' }}</span>
                    <span class="pf-wys-masthead__bar" [style.background]="colorOf('accentColor') || '#0066CC'"></span>
                  </div>
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
                  </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Contact</h4>
                  <p class="pf-rtb-s">Shown in the letterhead's right column.</p>
                  <div class="space-y-3">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div><label class="pf-label">Phone</label>
                        <input type="tel" class="pf-input"
                               [ngModel]="tpl().phone"
                               (ngModelChange)="patch({ phone: $event })" /></div>
                      <div><label class="pf-label">Email</label>
                        <input type="email" autocapitalize="none" class="pf-input"
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
                  </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Accreditation</h4>
                  <div class="space-y-3">
                  <div class="pf-toggle-row">
                    <div>
                      <p class="font-semibold text-[13px]" style="color: var(--text-primary);">NABL accredited</p>
                      <p class="text-[11.5px] mt-0.5" style="color: var(--text-tertiary);">Display NABL badge on the report header.</p>
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
                </div>
              </div>

              <div class="pf-rt-flat">
                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Logo</h4>
                  <p class="pf-rtb-s">Upload once — position and size control where it sits in the letterhead.</p>
                  <div class="space-y-3">
                  <div>
                    <pf-image-upload [url]="tpl().logoUrl"
                                     (urlChange)="patch({ logoUrl: $event })">
                    </pf-image-upload>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div class="md:col-span-3">
                      <label class="pf-label">Header style</label>
                      <div class="pf-wys-thumbs">
                        @for (o of headerPresetOptions; track o.value) {
                          <button type="button" class="pf-wys-thumb press"
                                  [class.pf-wys-thumb--on]="(tpl().headerPreset ?? 'drlogy') === o.value"
                                  (click)="patch({ headerPreset: $any(o.value) })">
                            <span class="pf-wys-thumb__paper" [class]="'pf-wys-thumb__paper--' + o.value">
                              <span class="pf-wys-thumb__logo"></span>
                              <span class="pf-wys-thumb__lines"><i></i><i></i></span>
                              <span class="pf-wys-thumb__accent"></span>
                            </span>
                            <span class="pf-wys-thumb__name">{{ o.label }}</span>
                          </button>
                        }
                      </div>
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
                  </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Header extras</h4>
                  <div class="space-y-3">
                  <div class="pf-toggle-row">
                    <div>
                      <p class="font-semibold text-[13px]" style="color: var(--text-primary);">Top accent bar</p>
                      <p class="text-[11.5px] mt-0.5" style="color: var(--text-tertiary);">Thin colored strip beneath the letterhead.</p>
                    </div>
                    <pf-toggle [checked]="tpl().topAccentBar ?? true"
                               (checkedChange)="patch({ topAccentBar: $event })">
                    </pf-toggle>
                  </div>

                  <!-- ── Pre-printed letterpad mode ── -->
                  <div class="pf-toggle-row">
                    <div>
                      <p class="font-semibold text-[13px]" style="color: var(--text-primary);">Pre-printed letterpad</p>
                      <p class="text-[11.5px] mt-0.5" style="color: var(--text-tertiary);">Print onto your own letterhead stationery — leaves the header &amp; footer blank on every page and prints only the results in between.</p>
                    </div>
                    <pf-toggle [checked]="tpl().letterpadMode ?? false"
                               (checkedChange)="patch({ letterpadMode: $event })">
                    </pf-toggle>
                  </div>
                  @if (tpl().letterpadMode) {
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div><label class="pf-label">Header blank space (mm)</label>
                        <input type="number" min="0" max="120" class="pf-input"
                               [ngModel]="tpl().letterpadHeaderMm ?? 45"
                               (ngModelChange)="patch({ letterpadHeaderMm: +$event })" /></div>
                      <div><label class="pf-label">Footer blank space (mm)</label>
                        <input type="number" min="0" max="120" class="pf-input"
                               [ngModel]="tpl().letterpadFooterMm ?? 30"
                               (ngModelChange)="patch({ letterpadFooterMm: +$event })" /></div>
                    </div>
                  }
                  </div>
                </div>
              </div>

              <div class="pf-rt-flat">
                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Brand colours</h4>
                  <p class="pf-rtb-s">The lab name and accent bar pick these up — live in the masthead above.</p>
                  <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                    @for (c of brandColorFields; track c.key) {
                      <div>
                        <label class="pf-label">{{ c.label }}</label>
                        <label class="pf-color-field">
                          <input type="color"
                                 [ngModel]="colorOf(c.key) || c.fallback"
                                 (ngModelChange)="patchKey(c.key, $event)" />
                          <span class="pf-color-field__hex">{{ colorOf(c.key) || c.fallback }}</span>
                        </label>
                      </div>
                    }
                  </div>
                </div>
              </div>
            }

            <!-- ══ PATIENT STRIP ══ -->
            @case ('patient') {
              <div class="pf-rt-flat">
                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Who is this strip for?</h4>
                  <p class="pf-rtb-s">Default prints on every report. A department's own arrangement prints when a report holds ONLY that department's tests — e.g. Microbiology showing just name, age and sex.</p>
                  <div class="pf-pt-scope">
                    <div class="pf-pt-scope__sel">
                      <pf-select [options]="$any(patientScopeOptions())" [value]="patientScope()"
                                 (valueChange)="onPatientScopeChange($any($event))"></pf-select>
                    </div>
                    @if (patientScope() !== 'default') {
                      @if (deptPatientConfigured()) { <span class="pf-pt-chip">CONFIGURED</span> }
                      <button type="button" class="pf-pt-btn press"
                              [disabled]="!deptPatientConfigured()"
                              (click)="resetDeptPatient()">Reset to default</button>
                      <button type="button" class="pf-pt-btn pf-pt-btn--primary press"
                              [disabled]="!deptPatientDirty() || deptPatientSaving()"
                              (click)="saveDeptPatient()">{{ deptPatientSaving() ? 'Saving…' : 'Save for department' }}</button>
                    }
                  </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Patient block</h4>
                  <p class="pf-rtb-s">Choose the layout, then drag fields between the columns — exactly how they print in the report's patient strip.</p>
                <div class="space-y-3">
                  <div>
                    <label class="pf-label">Patient block layout</label>
                    <pf-segmented
                      [options]="patientLayoutOptions"
                      [value]="patientLayoutValue()"
                      size="md"
                      (valueChange)="setPatientLayout($event)">
                    </pf-segmented>
                  </div>

                </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Date &amp; time format</h4>
                  <p class="pf-rtb-s">The date fields print inside the patient block using this format.
                    @if (patientScope() !== 'default') { <strong>Shared across departments — edits here change the Default.</strong> }
                  </p>
                  <div class="pf-rt-datesgrid">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label class="pf-label">Date format</label>
                      <pf-select [options]="$any(dateFormatOptions)" [value]="dateFormatValue()"
                                 (valueChange)="patch({ dateFormat: $any($event) })"></pf-select>
                    </div>
                    <div>
                      <label class="pf-label">Time format</label>
                      <pf-segmented [options]="timeFormatOptions" [value]="tpl().timeFormat ?? '12h'" size="sm"
                                    (valueChange)="patch({ timeFormat: $event })"></pf-segmented>
                    </div>
                  </div>
                  <div>
                    <label class="pf-label">Joiner between date and time</label>
                    <pf-select [options]="$any(separatorOptions)" [value]="separatorValue()"
                               (valueChange)="patch({ dateTimeSeparator: $any($event) })"></pf-select>
                  </div>

                  </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Arrange the fields</h4>
                  <p class="pf-rtb-s">
                    Drag a field <strong>into a column</strong> to print it (placement &amp; order = how it prints); drag it to <strong>Unused</strong> to hide it. The layout above sets the number of columns.</p>
                  <div cdkDropListGroup>
                    <div class="pf-pcols" [style.grid-template-columns]="'repeat(' + patientCols().length + ', minmax(0, 1fr))'">
                      @for (col of patientCols(); track $index; let i = $index) {
                        <div class="pf-pcol">
                          <span class="pf-pcol-h">Column {{ i + 1 }}</span>
                          <div class="pf-pcol-drop" cdkDropList [id]="'pcol-' + i"
                               [cdkDropListData]="col"
                               (cdkDropListDropped)="dropPatientItem($event)">
                            @for (k of col; track k) {
                              <div class="pf-pchip" cdkDrag>
                                <svg class="pf-pchip-grip" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/></svg>{{ patientItemLabel(k) }}
                              </div>
                            }
                            @if (col.length === 0) { <span class="pf-pcol-empty">Drop here</span> }
                          </div>
                        </div>
                      }
                    </div>
                    <p class="text-[11px] mt-3 mb-1" style="color: var(--text-muted);">Unused — not printed</p>
                    <div class="pf-ppool" cdkDropList id="pcol-pool" [cdkDropListData]="patientPool()"
                         (cdkDropListDropped)="dropPatientItem($event)">
                      @for (k of patientPool(); track k) {
                        <div class="pf-pchip pf-pchip--pool" cdkDrag>
                          <svg class="pf-pchip-grip" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/></svg>{{ patientItemLabel(k) }}
                        </div>
                      }
                      @if (patientPool().length === 0) { <span class="pf-pcol-empty">All fields are in columns — drag one here to hide it.</span> }
                    </div>
                  </div>
                </div>
              </div>
            }

            <!-- ══ RESULTS TABLE — style ══ -->
            @case ('table') {
              <div class="pf-rt-flat">
                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Table colours</h4>
                  <p class="pf-rtb-s">Header row, body text and hairlines of the results table.</p>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                  @for (c of tableColorFields; track c.key) {
                    <div>
                      <label class="pf-label">{{ c.label }}</label>
                      <label class="pf-color-field">
                        <input type="color"
                               [ngModel]="colorOf(c.key) || c.fallback"
                               (ngModelChange)="patchKey(c.key, $event)" />
                        <span class="pf-color-field__hex">{{ colorOf(c.key) || c.fallback }}</span>
                      </label>
                    </div>
                  }
                </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Typography &amp; table</h4>
                  <p class="pf-rtb-s">Font, table lines and department behaviour.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label class="pf-label">Font family</label>
                    <div class="pf-wys-fonts">
                      @for (o of fontOptions; track o.value) {
                        <button type="button" class="pf-wys-font press"
                                [class.pf-wys-font--on]="(tpl().fontFamily ?? 'helvetica') === o.value"
                                [style.fontFamily]="fontCss($any(o.value))"
                                (click)="patch({ fontFamily: $any(o.value) })">
                          <span class="pf-wys-font__sample">AaBb123</span>
                          <span class="pf-wys-font__name">{{ o.label }}</span>
                        </button>
                      }
                    </div>
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
                    <div class="pf-wys-thumbs">
                      @for (o of tableStyleOptions; track o.value) {
                        <button type="button" class="pf-wys-thumb press"
                                [class.pf-wys-thumb--on]="(tpl().tableStyle ?? 'plain') === o.value"
                                (click)="patch({ tableStyle: $any(o.value) })">
                          <span class="pf-wys-mini" [class]="'pf-wys-mini--' + o.value">
                            <i></i><i></i><i></i><i></i>
                          </span>
                          <span class="pf-wys-thumb__name">{{ o.label }}</span>
                        </button>
                      }
                    </div>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">Zebra rows</span>
                    <pf-toggle [checked]="tpl().zebraRows ?? false"
                               (checkedChange)="patch({ zebraRows: $event })">
                    </pf-toggle>
                  </div>
                </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Abnormal results</h4>
                  <p class="pf-rtb-s">How out-of-range values are marked — this row is live:</p>
                  <div class="pf-wys-paper pf-wys-demo">
                    <span>Hemoglobin</span>
                    <span [style.fontWeight]="(tpl().flagIndicator ?? 'letter') === 'none' ? '400' : '700'"
                          [style.color]="(tpl().flagStyle ?? 'bold') === 'bold_color' && (tpl().flagIndicator ?? 'letter') !== 'none' ? (tpl().abnormalLowColor || '#2563eb') : '#111'">
                      11.4 g/dL
                      @if ((tpl().flagIndicator ?? 'letter') === 'letter') { <span>&nbsp;L</span> }
                      @else if ((tpl().flagIndicator ?? 'letter') === 'arrow') { <span>&nbsp;▼</span> }
                    </span>
                    <span class="pf-wys-demo__range">12.0 – 16.0</span>
                  </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div [style.opacity]="(tpl().flagIndicator ?? 'letter') === 'none' ? '0.4' : null"
                       [style.pointerEvents]="(tpl().flagIndicator ?? 'letter') === 'none' ? 'none' : null">
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
                      Mark high/low with H&nbsp;/&nbsp;L letters or ↑&nbsp;/&nbsp;↓ arrows. Choose <b>None</b> for a plain report — no letters, arrows, bold or colour.
                    </p>
                  </div>
                  @if ((tpl().flagStyle ?? 'bold') === 'bold_color') {
                    <div class="pf-toggle-row"
                         [style.opacity]="(tpl().flagIndicator ?? 'letter') === 'none' ? '0.4' : null"
                         [style.pointerEvents]="(tpl().flagIndicator ?? 'letter') === 'none' ? 'none' : null">
                      <span class="text-[13px]" style="color: var(--text-primary);">High value colour</span>
                      <input type="color"
                             style="width:46px;height:30px;border:1px solid var(--glass-border);border-radius:8px;background:transparent;cursor:pointer;padding:2px"
                             [ngModel]="tpl().abnormalColor || '#dc2626'"
                             (ngModelChange)="patch({ abnormalColor: $event })" />
                    </div>
                    <div class="pf-toggle-row"
                         [style.opacity]="(tpl().flagIndicator ?? 'letter') === 'none' ? '0.4' : null"
                         [style.pointerEvents]="(tpl().flagIndicator ?? 'letter') === 'none' ? 'none' : null">
                      <span class="text-[13px]" style="color: var(--text-primary);">Low value colour</span>
                      <input type="color"
                             style="width:46px;height:30px;border:1px solid var(--glass-border);border-radius:8px;background:transparent;cursor:pointer;padding:2px"
                             [ngModel]="tpl().abnormalLowColor || '#2563eb'"
                             (ngModelChange)="patch({ abnormalLowColor: $event })" />
                    </div>
                  }
                </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Departments &amp; details</h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">Group by department</span>
                    <pf-toggle [checked]="tpl().groupByDepartment"
                               (checkedChange)="patch({ groupByDepartment: $event })">
                    </pf-toggle>
                  </div>
                  <div class="pf-toggle-row">
                    <div class="flex flex-col pr-3">
                      <span class="text-[13px]" style="color: var(--text-primary);">Each department on a new page</span>
                      <span class="text-[12px]" style="color: var(--text-tertiary);">Start every department's tests on a fresh page.</span>
                    </div>
                    <pf-toggle [checked]="tpl().departmentPageBreak ?? false"
                               (checkedChange)="patch({ departmentPageBreak: $event })">
                    </pf-toggle>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">Show method line</span>
                    <pf-toggle [checked]="tpl().showMethod"
                               (checkedChange)="patch({ showMethod: $event })">
                    </pf-toggle>
                  </div>
                </div>
                </div>
              </div>
            }

            <!-- ══ TABLE COLUMNS — per department ══ -->
            @case ('columns') {
              <pf-report-columns-editor (stateChange)="onColumnsState($event)">
              </pf-report-columns-editor>
            }

            <!-- ══ FOOTER ══ -->
            @case ('footer') {
              <div class="pf-rt-flat">
                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Footer</h4>
                  <p class="pf-rtb-s">
                    Signatures are configured per department (Report columns → Signatories) and print at
                    the end of each department's section — nothing signs in the footer. The texts below
                    close the page.
                  </p>

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

                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Page extras</h4>
                  <p class="pf-rtb-s">Optional bands and marks around the report body.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">Sample Collection band</span>
                    <pf-toggle [checked]="tpl().showSampleCollectionBand ?? true"
                               (checkedChange)="patch({ showSampleCollectionBand: $event })">
                    </pf-toggle>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">"Powered by Prefrontal" line</span>
                    <pf-toggle [checked]="tpl().showPoweredBy"
                               (checkedChange)="patch({ showPoweredBy: $event })">
                    </pf-toggle>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">QR code (verify online)</span>
                    <pf-toggle [checked]="tpl().showQrCode"
                               (checkedChange)="patch({ showQrCode: $event })">
                    </pf-toggle>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">Show pathologist name (legacy)</span>
                    <pf-toggle [checked]="tpl().showPathologistName"
                               (checkedChange)="patch({ showPathologistName: $event })">
                    </pf-toggle>
                  </div>
                </div>
              </div>
              </div>
            }
          }
        </div>

        <!-- ── Right: live PDF preview, shared by every section. ─────── -->
        <aside class="pf-rt-aside">
          <p class="pf-rt-aside__k">Live preview ({{ rendering() ? 'rendering…' : 'PDF' }})</p>
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
          <p class="pf-rt-aside__hint">Preview uses a sample order. Save to apply this template to real reports.</p>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    /* ── WYSIWYG paper insets: light "print" surfaces on the dark page ── */
    .pf-wys-paper { background: #ffffff; color: #111; border-radius: 10px; padding: 12px 14px;
      border: 1px solid rgba(0,0,0,0.08); box-shadow: 0 1px 6px rgba(0,0,0,0.35); }
    .pf-wys-masthead { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
    .pf-wys-masthead__name { font-size: 20px; font-weight: 800; letter-spacing: 0.02em; }
    .pf-wys-masthead__tag { font-size: 11.5px; color: #555; }
    .pf-wys-masthead__bar { height: 4px; border-radius: 2px; margin-top: 8px; }

    .pf-wys-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
    .pf-wys-thumb { display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 8px; border-radius: 12px; cursor: pointer; background: transparent;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.25)); }
    .pf-wys-thumb--on { border-color: var(--violet-500, #8b5cf6); background: rgba(139,92,246,0.12); }
    .pf-wys-thumb__name { font-size: 11px; font-weight: 600; color: var(--text-secondary, #cbd5e1); }
    .pf-wys-thumb__paper { position: relative; width: 116px; height: 62px; border-radius: 6px; background: #fff;
      display: block; overflow: hidden; border: 1px solid rgba(0,0,0,0.1); }
    .pf-wys-thumb__logo { position: absolute; top: 8px; left: 8px; width: 14px; height: 14px; border-radius: 3px; background: #94a3b8; }
    .pf-wys-thumb__lines { position: absolute; top: 9px; left: 28px; right: 10px; display: flex; flex-direction: column; gap: 4px; }
    .pf-wys-thumb__lines i { height: 5px; border-radius: 2px; background: #cbd5e1; display: block; }
    .pf-wys-thumb__lines i:first-child { background: #64748b; width: 70%; }
    .pf-wys-thumb__accent { position: absolute; left: 0; right: 0; top: 30px; height: 3px; background: #3b82f6; }
    .pf-wys-thumb__paper--banner .pf-wys-thumb__accent { top: 0; height: 10px; }
    .pf-wys-thumb__paper--banner .pf-wys-thumb__logo { top: 16px; }
    .pf-wys-thumb__paper--banner .pf-wys-thumb__lines { top: 18px; }
    .pf-wys-thumb__paper--classic .pf-wys-thumb__accent { display: none; }
    .pf-wys-thumb__paper--minimal .pf-wys-thumb__accent { display: none; }
    .pf-wys-thumb__paper--minimal .pf-wys-thumb__logo { display: none; }
    .pf-wys-thumb__paper--minimal .pf-wys-thumb__lines { left: 10px; }

    .pf-wys-fonts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .pf-wys-font { display: flex; flex-direction: column; align-items: center; gap: 1px;
      padding: 8px 6px; border-radius: 11px; cursor: pointer; background: transparent;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.25)); color: var(--text-primary, #e2e8f0); }
    .pf-wys-font--on { border-color: var(--violet-500, #8b5cf6); background: rgba(139,92,246,0.12); }
    .pf-wys-font__sample { font-size: 15px; }
    .pf-wys-font__name { font-size: 10.5px; color: var(--text-tertiary, #94a3b8); font-family: system-ui, sans-serif; }

    .pf-wys-mini { display: flex; flex-direction: column; gap: 3px; width: 100%; padding: 7px;
      background: #fff; border-radius: 6px; border: 1px solid rgba(0,0,0,0.1); }
    .pf-wys-mini i { display: block; height: 6px; border-radius: 2px; background: #e2e8f0; }
    .pf-wys-mini i:first-child { background: #64748b; }
    .pf-wys-mini--bordered i { border: 1px solid #94a3b8; background: #fff; height: 8px; }
    .pf-wys-mini--bordered i:first-child { background: #cbd5e1; }
    .pf-wys-mini--striped i:nth-child(odd) { background: #cbd5e1; }

    .pf-wys-demo { display: flex; align-items: center; gap: 18px; margin-bottom: 12px; font-size: 13px; }
    .pf-wys-demo__range { color: #777; font-size: 12px; }

    .pf-wys-sigs { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
    .pf-wys-sig { display: flex; flex-direction: column; align-items: center; gap: 1px; flex: 1; min-width: 120px; font-size: 12px; }
    .pf-wys-sig__img { max-height: 30px; max-width: 90px; object-fit: contain; }
    .pf-wys-sig__scribble { font-size: 20px; color: #999; }
    .pf-wys-sig i { color: #666; font-size: 11px; }
    .pf-wys-sig small { color: #888; font-size: 10px; }
    .pf-wys-sig--empty { font-size: 11.5px; color: #666; text-align: center; }

    /* Patient drag area framed like the printed patient strip */
    .pf-pcols { position: relative; padding-top: 26px !important; border: 1px solid var(--glass-border, rgba(148,163,184,0.2));
      border-radius: 12px; padding: 26px 10px 10px; }
    .pf-pcols::before { content: 'PATIENT BLOCK — AS PRINTED'; position: absolute; top: 6px; left: 12px;
      font-size: 9.5px; letter-spacing: 0.14em; color: var(--text-tertiary, #94a3b8); font-weight: 700; }

    /* ── Titled setting groups — FLAT on the panel surface. The work panel
       already provides the card; boxing each group again read as
       card-in-card clutter. Groups separate with hairlines instead. ── */
    .pf-rtb { margin: 0; padding: 16px 0; border: 0; border-radius: 0; background: transparent;
      border-top: 1px solid var(--glass-border, rgba(148,163,184,0.14)); }
    .pf-rtb:first-child { border-top: 0; padding-top: 2px; }
    .pf-rtb:last-child { padding-bottom: 0; }
    .pf-rtb-h { margin: 0 0 2px; font-size: 13px; font-weight: 700; color: var(--text-primary, #e2e8f0); }
    .pf-rtb-s { margin: 0 0 12px; font-size: 11.5px; line-height: 1.45; color: var(--text-tertiary, #94a3b8); }

    /* Compact field vocabulary inside the panel (test-editor density). */
    .pf-rt-work .pf-label { display: block; margin-bottom: 5px; font-size: 11px; font-weight: 600;
      color: var(--text-tertiary, #94a3b8); }
    .pf-rt-work .pf-input { padding: 8px 12px; font-size: 13.5px; border-radius: 10px; }
    .pf-rt-work textarea.pf-input { font-size: 13px; line-height: 1.5; }
    .pf-rt-work .pf-rtb .grid { row-gap: 12px; }

    /* ── Workspace shell: rail | focused panel | preview (test-editor kin). ── */
    .pf-rt-head { display: flex; align-items: flex-start; gap: 12px; padding: 6px 0 10px; }
    .pf-rt-head > .min-w-0 { flex: 1; }
    .pf-rt-title { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.01em; color: var(--text-primary); }
    .pf-rt-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-tertiary, #94a3b8); }

    .pf-rt-grid { display: grid; grid-template-columns: 188px minmax(0, 1fr) minmax(400px, 40%); gap: 18px; align-items: start; }
    @media (max-width: 1180px) { .pf-rt-grid { grid-template-columns: 1fr; } }

    /* ── Section list (left panel). ── */
    .pf-rt-rail { display: flex; flex-direction: column; gap: 2px; position: sticky; top: 70px; }
    .pf-rt-rail__item { display: flex; align-items: center; height: 40px; padding: 0 14px;
      border-radius: 11px; border: none; background: transparent; color: var(--text-secondary);
      font-size: 13px; font-weight: 600; cursor: pointer; text-align: left;
      transition: color .15s, background .15s; }
    .pf-rt-rail__txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media (hover: hover) {
      .pf-rt-rail__item:hover { color: var(--text-primary); background: var(--glass-bg-hover, rgba(255,255,255,.05)); }
    }
    .pf-rt-rail__item--on { color: var(--text-primary); font-weight: 700;
      background: color-mix(in srgb, #a855f7 14%, transparent); }
    @media (max-width: 1180px) {
      .pf-rt-rail { position: sticky; top: 58px; z-index: 4; flex-direction: row; overflow-x: auto;
        scrollbar-width: none; padding: 6px 0; background: var(--bg-primary, #0a0a15); }
      .pf-rt-rail::-webkit-scrollbar { display: none; }
      .pf-rt-rail__item { flex: 0 0 auto; height: 34px; }
    }

    .pf-rt-work { min-width: 0; background: var(--glass-bg, rgba(255,255,255,.03));
      border: 1px solid var(--glass-border); border-radius: 16px; padding: 16px 20px 20px;
      animation: rt-sec-in .18s cubic-bezier(0, 0, 0.2, 1); }
    @media (prefers-reduced-motion: reduce) { .pf-rt-work { animation: none; } }
    @keyframes rt-sec-in { from { opacity: .4; transform: translateY(5px); } to { opacity: 1; transform: none; } }
    .pf-rt-work__hdr { padding-bottom: 10px; margin-bottom: 14px; border-bottom: 1px solid var(--glass-border); }
    .pf-rt-work__title { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -0.01em; color: var(--text-primary); }
    .pf-rt-work__sub { margin: 3px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-tertiary, #94a3b8); }
    .pf-rt-flat + .pf-rt-flat .pf-rtb:first-child { border-top: 1px solid var(--glass-border); }

    .pf-rt-aside { min-width: 0; }
    .pf-rt-aside__k { margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: .12em;
      text-transform: uppercase; color: var(--text-tertiary); font-family: ui-monospace, monospace; }
    .pf-rt-aside__hint { margin: 8px 0 0; font-size: 10.5px; color: var(--text-tertiary); }

    /* Desktop: the page holds still; work panel + preview scroll internally. */
    @media (min-width: 1181px) {
      :host { display: block; height: 100%; overflow: hidden; }
      .pf-rt-page { height: 100%; display: flex; flex-direction: column; overflow: hidden; padding-bottom: 12px; }
      .pf-rt-head { flex: 0 0 auto; }
      .pf-rt-grid { flex: 1 1 auto; min-height: 0; align-items: stretch; }
      .pf-rt-rail { position: static; overflow-y: auto; min-height: 0; }
      .pf-rt-work { height: 100%; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
      .pf-rt-aside { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
      .pf-pdf-frame { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
      .pf-pdf-iframe { flex: 1 1 auto; min-height: 0; height: auto; }
    }

    /* Colour field: swatch + hex as ONE 38px control. */
    .pf-color-field { display: flex; align-items: center; height: 38px; border-radius: 10px;
      border: 1px solid var(--input-border, var(--glass-border)); background: var(--input-bg, rgba(255,255,255,.03));
      overflow: hidden; cursor: pointer; }
    .pf-color-field input[type="color"] { width: 42px; height: 46px; margin: -4px 0 -4px -4px;
      border: 0; padding: 0; background: transparent; cursor: pointer; }
    .pf-color-field__hex { padding: 0 10px; font-family: ui-monospace, monospace; font-size: 12px;
      color: var(--text-secondary, #cbd5e1); }

    .pf-rt-work input[type="range"] { width: 100%; accent-color: #a855f7; }
    .pf-rt-datesgrid { display: flex; flex-direction: column; gap: 12px; }

    /* Department scope row for the patient strip */
    .pf-pt-scope { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .pf-pt-scope__sel { flex: 1 1 240px; min-width: 220px; }
    .pf-pt-chip { font-size: 10px; font-weight: 800; letter-spacing: .1em; padding: 4px 9px;
      border-radius: 999px; color: #34d399; border: 1px solid rgba(52,211,153,.4);
      background: rgba(52,211,153,.08); font-family: ui-monospace, monospace; }
    .pf-pt-btn { height: 34px; padding: 0 14px; border-radius: 10px; font-size: 12.5px;
      font-weight: 700; cursor: pointer; border: 1px solid var(--glass-border);
      background: var(--glass-bg); color: var(--text-primary); }
    .pf-pt-btn:disabled { opacity: .45; cursor: default; }
    .pf-pt-btn--primary { border-color: transparent; color: #fff;
      background: linear-gradient(135deg, #8b5cf6, #ec4899); }

    .pf-color-picker { height: 36px; width: 56px; border-radius: 8px;
      border: 1px solid var(--glass-border); cursor: pointer;
      background: var(--glass-bg); }

    /* ── Drag-arrange patient columns ── */
    .pf-pcols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    @media (max-width: 640px) { .pf-pcols { grid-template-columns: 1fr; } }
    .pf-pcol { display: flex; flex-direction: column; gap: 6px; }
    .pf-pcol-h { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); }
    .pf-pcol-drop { display: flex; flex-direction: column; gap: 6px; min-height: 64px; padding: 8px;
      border-radius: 12px; border: 1px dashed var(--glass-border); background: rgba(255,255,255,0.02); }
    .pf-pcol-empty { font-size: 11.5px; color: var(--text-tertiary); text-align: center; padding: 8px 0; }
    .pf-ppool { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border-radius: 12px;
      border: 1px dashed var(--glass-border); background: rgba(255,255,255,0.02); min-height: 44px; }
    .pf-pchip { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-radius: 9px;
      background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-primary);
      font-size: 12.5px; font-weight: 600; cursor: grab; }
    .pf-pchip--pool { background: rgba(124,58,237,0.10); border-color: rgba(168,85,247,0.30); }
    .pf-pchip-grip { color: var(--text-muted); font-size: 12px; }
    .pf-pchip.cdk-drag-preview { box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    .pf-pchip.cdk-drag-placeholder { opacity: 0.4; }
    .cdk-drop-list-dragging .pf-pchip:not(.cdk-drag-placeholder) { transition: transform 180ms cubic-bezier(0.2,0.8,0.2,1); }
    .pf-toggle-row { display: flex; align-items: center; align-self: start; gap: 12px;
      justify-content: space-between; min-height: 40px; padding: 8px 12px; border-radius: 10px;
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

  /** Section cards for the left nav — a plain-words label + what it changes,
   *  so the admin never has to guess what lives behind a tab. */
  readonly sections: Array<{ value: Tab; label: string; desc: string }> = [
    { value: 'letterhead', label: 'Letterhead',    desc: 'Name, tagline, logo, brand colours, NABL — everything at the top of the page' },
    { value: 'patient',    label: 'Patient strip', desc: 'Which patient fields print, arranged how, with the date format' },
    { value: 'columns',    label: 'Table columns', desc: 'Per-department table columns & widths' },
    { value: 'table',      label: 'Results table', desc: 'Font, table colours, zebra rows, abnormal marking, departments' },
    { value: 'footer',     label: 'Footer',        desc: 'Disclaimer, end-of-report, watermark, page extras' },
  ];
  readonly activeSection = () => this.sections.find(s => s.value === this._tab()) ?? null;
  private readonly _tab = signal<Tab>('letterhead');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) {
    this._tab.set(t);
    // Re-pull the form-flow fields when entering the Patient tab so the list
    // reflects the latest saved Patient Registration flow (not a stale copy).
    if (t === 'patient') this.loadCustomPatientFields();
  }

  readonly headerPresetOptions: SegmentedOption<string>[] = [
    { value: 'drlogy',   label: 'Classic'  },
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
    { value: 'none',   label: 'None' },
  ];
  readonly flagStyleOptions: SegmentedOption<string>[] = [
    { value: 'bold',       label: 'Bold (H/L)'   },
    { value: 'bold_color', label: 'Bold + colour' },
  ];
  readonly patientLayoutOptions: SegmentedOption<string>[] = [
    { value: 'three-col',     label: '3-column (Classic)' },
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

  /** Colours are homed by WHERE they print: brand in the letterhead,
   *  the rest on the results table. */
  readonly brandColorFields: Array<{ key: keyof ReportTemplate; label: string; fallback: string }> = [
    { key: 'primaryColor',    label: 'Lab name colour',   fallback: '#1B3A6B' },
    { key: 'accentColor',     label: 'Accent bar',        fallback: '#0066CC' },
  ];
  readonly tableColorFields: Array<{ key: keyof ReportTemplate; label: string; fallback: string }> = [
    { key: 'tableHeaderBg',   label: 'Header row bg',     fallback: '#ffffff' },
    { key: 'tableHeaderText', label: 'Header row text',   fallback: '#000000' },
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

  // ── Template state ──────────────────────────────────────────
  private readonly _tpl = signal<ReportTemplate>(this.defaultTemplate());
  readonly tpl = this._tpl.asReadonly();
  patch(p: Partial<ReportTemplate>) { this._tpl.update(v => ({ ...v, ...p })); }

  /** Browser stand-ins for the PDF font families, so the picker cards render
   *  IN the face they select. */
  fontCss(v: string): string {
    if (v === 'times') return "'Times New Roman', Georgia, serif";
    if (v === 'courier') return "'Courier New', ui-monospace, monospace";
    return 'Arial, Helvetica, sans-serif';
  }

  // Live columns being edited in the Columns tab + their department, so the
  // preview can apply them to that department's sample tests before save.
  private readonly editedCols = signal<ReportColumn[]>([]);
  private readonly editedDeptName = signal<string>('');
  private readonly editedDeptCode = signal<string>('');
  onColumnsState(s: { departmentName: string; departmentCode: string; columns: ReportColumn[] }) {
    this.editedDeptName.set(s.departmentName);
    this.editedDeptCode.set(s.departmentCode);
    this.editedCols.set(s.columns);
  }
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

  // (Dead signature-editor UI removed — the "Sign-off & Footer" tab never bound
  //  add/remove/updateSignature; the PDF renderer reads signaturesJson directly.)

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
      // Also depend on the columns being edited so the preview reflects the
      // Columns tab live (per-department), and on the patient-strip scope
      // draft so a department arrangement previews as you drag.
      this.editedCols(); this.editedDeptName(); this.editedDeptCode();
      this.patientScope(); this.patientCols(); this.deptPatientLayout();
      if (this.renderTimer) clearTimeout(this.renderTimer);
      this.rendering.set(true);
      this.renderTimer = setTimeout(() => this.renderPreview(tpl), 300);
    });
  }

  /** Build resolved layouts for the sample tests so the preview applies the
   *  columns being edited to that department's tests (other departments fall
   *  back to the default layout — demonstrating per-department sections). */
  private buildPreviewLayouts(): Record<string, ResolvedReportLayout> {
    const cols = this.editedCols();
    if (!cols.length) return {};
    const dn = this.editedDeptName().trim().toLowerCase();
    const dc = this.editedDeptCode().trim().toLowerCase();
    if (!dn && !dc) return {};
    let snap: { tests?: { testId: string; name?: string; department?: string; departmentCode?: string; sampleType?: string }[] };
    try { snap = JSON.parse(this.sampleSnapshot()); } catch { return {}; }
    const out: Record<string, ResolvedReportLayout> = {};
    const apply = (t: { testId: string; name?: string; sampleType?: string }) => {
      out[t.testId] = {
        testId: t.testId, testName: t.name ?? '', sampleType: t.sampleType ?? '',
        columns: cols, sections: [], configured: true, version: 1,
      } as unknown as ResolvedReportLayout;
    };
    // Columns tab: the preview mirrors the department being edited — every
    // sample test takes the edited columns (the render step also relabels the
    // department bands), so what you see IS what you're configuring.
    if (this.tab() === 'columns') {
      for (const t of snap.tests ?? []) apply(t);
      return out;
    }
    let matched = 0;
    for (const t of snap.tests ?? []) {
      const td = (t.department ?? '').trim().toLowerCase();
      const tc = (t.departmentCode ?? '').trim().toLowerCase();
      const match = (!!td && (td === dn || td === dc)) || (!!tc && (tc === dn || tc === dc));
      if (match) { apply(t); matched++; }
    }
    // When the edited department isn't in the sample data, apply to every test
    // so the edit is ALWAYS visible instead of silently no-oping.
    if (matched === 0) for (const t of snap.tests ?? []) apply(t);
    return out;
  }

  private async renderPreview(tpl: ReportTemplate) {
    try {
      // Columns tab: relabel the whole sample report to the department being
      // edited so ONE section — titled with that department — previews the
      // strip exactly; empty configured columns stay visible.
      let data = this.sampleSnapshot();
      const onColumns = this.tab() === 'columns';
      if (onColumns && (this.editedDeptName() || this.editedDeptCode())) {
        try {
          const snap = JSON.parse(data);
          for (const t of snap.tests ?? []) {
            t.department = this.editedDeptName() || t.department;
            t.departmentCode = this.editedDeptCode() || t.departmentCode;
          }
          data = JSON.stringify(snap);
        } catch { /* keep the raw sample */ }
      }
      // A department scope previews ITS draft arrangement — swap the strip
      // fields on a copy so the preview shows what that department prints.
      const effTpl = this.patientScope() === 'default' ? tpl : {
        ...tpl,
        patientLayout: this.deptPatientLayout(),
        patientColumnsJson: JSON.stringify(this.patientCols()),
      };
      const baseInput = {
        report: { id: 'preview-' + Date.now(), type: 'final',
                  createdAt: new Date().toISOString(), data },
        template: effTpl,
        resolvedLayouts: this.buildPreviewLayouts(),
        previewKeepEmptyColumns: onColumns,
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
                 // A realistic order number so the preview's barcode is a true
                 // Code-128 of a scannable value, not a placeholder.
                 orderNumber: 'LAB-2608-000042',
                 createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
                 refDoctorName: 'Dr. A. Sharma',
                 refHospitalName: 'Apollo Speciality Hospital',
                 branchName: 'Chennai Main',
                 collectedBy: 'S. Priya',
                 departments: 'Haematology, Biochemistry' },
      type: 'final',
      tests: [
        { testId: 'd1', name: 'Complete Blood Count (CBC)', department: 'Haematology', departmentCode: 'HAEM',
          sampleType: 'EDTA Whole Blood', method: 'Automated cell counter',
          result: { values: {
            'Hemoglobin':   { value: '11.4', unit: 'g/dL',     range: '12.0 – 16.0', flag: 'L', description: 'Low in anaemia / blood loss' },
            'RBC Count':    { value: '4.6',  unit: 'mill/cmm',  range: '3.8 – 4.8' },
            'WBC Count':    { value: '12800', unit: '/cmm',     range: '4000 – 11000', flag: 'H', description: 'Raised in acute infection' },
            'Platelets':    { value: '240000', unit: '/cmm',    range: '150000 – 410000' },
          } } },
        { testId: 'd2', name: 'Lipid Profile', department: 'Biochemistry', departmentCode: 'BIO',
          sampleType: 'Serum', method: 'Photometry',
          result: { values: {
            'Total Cholesterol': { value: '210', unit: 'mg/dL', range: '< 200', flag: 'H', description: 'Dietary review advised' },
            'HDL Cholesterol':   { value: '52',  unit: 'mg/dL', range: '> 40' },
            'LDL Cholesterol':   { value: '135', unit: 'mg/dL', range: '< 100', flag: 'H' },
            'Triglycerides':     { value: '120', unit: 'mg/dL', range: '< 150' },
          } } },
        { testId: 'd3', name: 'Vitamin D (25-OH)', department: 'Biochemistry', departmentCode: 'BIO',
          sampleType: 'Serum', nablScope: false, referralLab: 'Reference Labs Pvt. Ltd., Mumbai',
          result: { values: {
            '25-Hydroxy Vitamin D': { value: '18', unit: 'ng/mL', range: '30 – 100', flag: 'L' },
          } } },
      ],
    });
  }

  ngOnInit() {
    const initial = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (initial && this.sections.some(o => o.value === initial)) {
      this._tab.set(initial);
    }
    this.api.get<ReportTemplate>('/api/config/report-template').subscribe({
      next: t => { if (t) this._tpl.set({ ...this._tpl(), ...t }); this.initPatientCols(); }
    });
    this.loadCustomPatientFields();
    this.initPatientCols();
    this.api.get<{ id: string; name: string }[]>('/api/tenants/departments').subscribe({
      next: d => this.departments.set((d ?? []).map(x => ({ id: x.id, name: x.name }))),
    });
  }

  // ── Custom patient fields (from the Patient Registration form flow) ──
  readonly customPatientFields = signal<{ name: string; title: string }[]>([]);

  /** Pull the non-standard fields defined in the patient_registration form flow
   *  so the lab can choose which to print on the report. */
  private loadCustomPatientFields() {
    this.api.get<{ configJson?: string }>('/api/workflows/patient_registration').subscribe({
      next: rec => {
        try {
          const cfg = rec?.configJson ? JSON.parse(rec.configJson) : null;
          // Offer EVERY registration field that isn't already a built-in patient
          // toggle (matched by name) — so "whatever is there" in the form flow
          // becomes an option, regardless of the isStandard flag.
          const builtIn = new Set([
            'first_name', 'fathers_name', 'father_name', 'last_name', 'middle_name',
            'displayname', 'display_name', 'name', 'full_name',
            'sex', 'gender', 'age', 'date_of_birth', 'dob',
            'phone', 'mobile', 'abha_id', 'mrn', 'patient_id', 'order_id',
            'barcode', 'ref_doctor', 'referring_doctor', 'ref_doctor_name', 'refdoctor',
          ]);
          const fields: { name: string; title: string }[] = [];
          const seen = new Set<string>();
          for (const step of cfg?.steps ?? []) {
            for (const f of step?.fields ?? []) {
              if (f && f.name && !builtIn.has(String(f.name).toLowerCase()) && !seen.has(f.name)) {
                seen.add(f.name);
                fields.push({ name: f.name, title: f.title || f.name });
              }
            }
          }
          this.customPatientFields.set(fields);
        } catch { this.customPatientFields.set([]); }
      },
      error: () => this.customPatientFields.set([]),
    });
  }

  private enabledPatientFields(): { name: string; title: string }[] {
    try {
      const arr = JSON.parse(this._tpl().patientFieldsJson || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  isPatientFieldOn(name: string): boolean {
    return this.enabledPatientFields().some(f => f.name === name);
  }
  togglePatientField(field: { name: string; title: string }, on: boolean) {
    const cur = this.enabledPatientFields().filter(f => f.name !== field.name);
    if (on) cur.push({ name: field.name, title: field.title });
    this.patch({ patientFieldsJson: JSON.stringify(cur) });
  }

  // ── Drag-arranged 3-column patient block ──
  private readonly ALL_PATIENT_ITEMS = [
    'name', 'age', 'sex', 'mrn', 'phone', 'orderid', 'refdoctor',
    // Referral + collection details. Sourced from the ORDER (not the patient
    // record), so they arrive via the report snapshot's `order` block.
    'refhospital', 'collectedby', 'department', 'branch',
    'specimen', 'barcode', 'registered', 'collected', 'reported',
  ];
  private readonly DEFAULT_PATIENT_COLS: string[][] = [
    ['name', 'age', 'sex', 'mrn'],
    ['specimen', 'refdoctor'],
    ['barcode', 'registered', 'collected', 'reported'],
  ];
  private readonly PATIENT_ITEM_LABELS: Record<string, string> = {
    name: 'Patient name', age: 'Age', sex: 'Sex', mrn: 'MRN', phone: 'Phone',
    orderid: 'Order ID', refdoctor: 'Referring doctor', specimen: 'Specimen(s)',
    barcode: 'Barcode', registered: 'Registered date', collected: 'Collected date',
    reported: 'Reported date',
    refhospital: 'Referring hospital', collectedby: 'Collected by',
    department: 'Department', branch: 'Branch / collection centre',
  };

  readonly patientCols = signal<string[][]>([[], [], []]);

  /** Items not currently placed in any column (built-ins + ALL custom fields).
   *  In a column = printed; here in Unused = hidden. */
  readonly patientPool = computed<string[]>(() => {
    const placed = new Set(this.patientCols().flat());
    const custom = this.customPatientFields().map(f => f.name);
    const all = [...this.ALL_PATIENT_ITEMS, ...custom];
    return all.filter((k, i) => all.indexOf(k) === i && !placed.has(k));
  });

  patientItemLabel(k: string): string {
    return this.PATIENT_ITEM_LABELS[k]
      ?? this.customPatientFields().find(f => f.name === k)?.title
      ?? this.enabledPatientFields().find(f => f.name === k)?.title
      ?? k;
  }

  /** Number of patient-block columns for a layout. */
  private colCountFor(layout: string | undefined): number {
    return layout === 'four-col-grid' ? 4 : layout === 'stacked' ? 1 : 3;
  }

  // ── Department-specific patient strip ─────────────────────
  // 'default' edits the tenant template (autosaved with the page's Save);
  // a department id edits that department's own arrangement, stored via
  // /api/report-layout/department/{id}/patient and applied by the PDF
  // renderer when a report holds only that department's tests.
  readonly departments = signal<{ id: string; name: string }[]>([]);
  readonly patientScope = signal<string>('default');
  readonly patientScopeOptions = computed(() => [
    { value: 'default', label: 'Default — all departments' },
    ...this.departments().map(d => ({ value: d.id, label: d.name })),
  ]);
  readonly deptPatientConfigured = signal(false);
  readonly deptPatientDirty = signal(false);
  readonly deptPatientSaving = signal(false);
  private readonly deptPatientLayout = signal<string>('three-col');

  patientLayoutValue(): string {
    return this.patientScope() === 'default'
      ? (this._tpl().patientLayout ?? 'three-col')
      : this.deptPatientLayout();
  }

  onPatientScopeChange(scope: string) {
    this.patientScope.set(scope);
    this.deptPatientDirty.set(false);
    if (scope === 'default') { this.deptPatientConfigured.set(false); this.initPatientCols(); return; }
    this.api.get<{ patient?: { layout?: string; columns?: string[][] } | null; configured?: boolean }>(
      `/api/report-layout/department/${scope}/patient`).subscribe({
      next: r => {
        this.deptPatientConfigured.set(!!r?.configured);
        const cols = r?.patient?.columns;
        if (cols && cols.length && cols.some(c => Array.isArray(c))) {
          const layout = r!.patient!.layout ?? 'three-col';
          this.deptPatientLayout.set(layout);
          this.patientCols.set(this.fitColumns(cols.map(c => [...(c ?? [])]), this.colCountFor(layout)));
        } else {
          // No override yet — the draft starts from the tenant default.
          this.deptPatientLayout.set(this._tpl().patientLayout ?? 'three-col');
          this.seedPatientColsFromTemplate();
        }
      },
      error: () => { this.patientScope.set('default'); this.deptPatientConfigured.set(false); this.initPatientCols(); },
    });
  }

  saveDeptPatient() {
    const dept = this.patientScope();
    if (dept === 'default' || this.deptPatientSaving()) return;
    this.deptPatientSaving.set(true);
    this.api.post(`/api/report-layout/department/${dept}/patient`, {
      patient: { layout: this.deptPatientLayout(), columns: this.patientCols() },
    }).subscribe({
      next: () => {
        this.deptPatientSaving.set(false);
        this.deptPatientConfigured.set(true);
        this.deptPatientDirty.set(false);
        this.toasts.success('Department patient strip saved');
      },
      error: (e: ApiError) => { this.deptPatientSaving.set(false); this.toasts.error(e?.message || 'Save failed'); },
    });
  }

  resetDeptPatient() {
    const dept = this.patientScope();
    if (dept === 'default') return;
    this.api.post(`/api/report-layout/department/${dept}/patient`, { patient: null }).subscribe({
      next: () => {
        this.deptPatientConfigured.set(false);
        this.deptPatientDirty.set(false);
        this.deptPatientLayout.set(this._tpl().patientLayout ?? 'three-col');
        this.seedPatientColsFromTemplate();
        this.toasts.success('Back to the default strip');
      },
      error: (e: ApiError) => this.toasts.error(e?.message || 'Reset failed'),
    });
  }

  /** Load the tenant-default arrangement into the editor WITHOUT touching
   *  scope state — used to seed a fresh department draft. */
  private seedPatientColsFromTemplate() {
    const n = this.colCountFor(this.deptPatientLayout());
    let cols: string[][] | null = null;
    const saved = this._tpl().patientColumnsJson;
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.every(Array.isArray)) cols = arr;
      } catch { cols = null; }
    }
    cols = cols ?? this.DEFAULT_PATIENT_COLS.map(c => [...c]);
    this.patientCols.set(this.fitColumns(cols, n));
  }

  private initPatientCols() {
    if (this.patientScope() !== 'default') return;
    const n = this.colCountFor(this._tpl().patientLayout);
    let cols: string[][] | null = null;
    const saved = this._tpl().patientColumnsJson;
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.every(Array.isArray)) cols = arr;
      } catch { cols = null; }
    }
    cols = cols ?? this.DEFAULT_PATIENT_COLS.map(c => [...c]);
    this.patientCols.set(this.fitColumns(cols, n));
  }

  /** Reshape a column set to exactly n columns, preserving item placement
   *  (pad with empty columns, or merge overflow into the last kept column). */
  private fitColumns(cols: string[][], n: number): string[][] {
    const out = cols.map(c => [...c]);
    if (out.length < n) while (out.length < n) out.push([]);
    else if (out.length > n) {
      const extra = out.slice(n).flat();
      out.length = n;
      out[n - 1] = [...out[n - 1], ...extra];
    }
    return out;
  }

  /** Always show a valid option in the date-format / separator selects, even if
   *  the saved value is empty or no longer a known option. */
  dateFormatValue(): string {
    const v = this._tpl().dateFormat;
    return this.dateFormatOptions.some(o => o.value === v) ? v! : 'dd MMM yyyy';
  }
  separatorValue(): string {
    const v = this._tpl().dateTimeSeparator;
    return this.separatorOptions.some(o => o.value === v) ? v! : ', ';
  }

  /** Per-column-count cache so switching layouts (e.g. 3 → stacked → 3) restores
   *  the previous arrangement instead of dumping everything into column 1. */
  private patientColsCache = new Map<number, string[][]>();

  /** Switch layout → set the column count and reshape the arrangement, keeping
   *  the previous arrangement for that count if we've seen it this session. */
  setPatientLayout(layout: string) {
    const curN = this.patientCols().length;
    this.patientColsCache.set(curN, this.patientCols().map(c => [...c]));
    const n = this.colCountFor(layout);
    const cols = this.patientColsCache.has(n)
      ? this.patientColsCache.get(n)!.map(c => [...c])
      : this.redistribute(this.patientCols(), n);
    this.patientCols.set(cols);
    this.patientColsCache.set(n, cols.map(c => [...c]));
    if (this.patientScope() !== 'default') {
      this.deptPatientLayout.set(layout);
      this.deptPatientDirty.set(true);
      return;
    }
    const placed = new Set(cols.flat());
    const placedCustom = this.customPatientFields().filter(f => placed.has(f.name));
    this.patch({
      patientLayout: layout,
      patientColumnsJson: JSON.stringify(cols),
      patientFieldsJson: JSON.stringify(placedCustom),
    });
  }

  /** Spread the currently-placed items into n columns as contiguous chunks
   *  (preserves order; for n=1 everything stacks into one column). */
  private redistribute(cols: string[][], n: number): string[][] {
    const flat = cols.flat();
    const out: string[][] = Array.from({ length: n }, () => []);
    const per = Math.max(1, Math.ceil(flat.length / n));
    flat.forEach((item, i) => out[Math.min(n - 1, Math.floor(i / per))].push(item));
    return out;
  }

  dropPatientItem(ev: CdkDragDrop<string[]>) {
    const cols = this.patientCols().map(c => [...c]);
    const pool = [...this.patientPool()];
    const arrOf = (id: string) => id === 'pcol-pool' ? pool : cols[Number(id.replace('pcol-', ''))];
    const from = arrOf(ev.previousContainer.id);
    const to = arrOf(ev.container.id);
    if (ev.previousContainer === ev.container) {
      moveItemInArray(to, ev.previousIndex, ev.currentIndex);
    } else {
      transferArrayItem(from, to, ev.previousIndex, ev.currentIndex);
    }
    this.patientCols.set(cols);                    // pool is derived → recomputes
    if (this.patientScope() !== 'default') { this.deptPatientDirty.set(true); return; }
    // Persist the arrangement + the titles of any custom fields now placed in a
    // column (so the PDF can label them; placement is the single shown/hidden
    // control — no separate toggle).
    const placed = new Set(cols.flat());
    const placedCustom = this.customPatientFields().filter(f => placed.has(f.name));
    this.patch({
      patientColumnsJson: JSON.stringify(cols),
      patientFieldsJson: JSON.stringify(placedCustom),
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
      error: (e) => { this.toasts.error(ApiError.from(e).message); this.saving.set(false); },
    });
  }
}
