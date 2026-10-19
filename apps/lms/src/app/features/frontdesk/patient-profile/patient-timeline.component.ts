import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService } from '../../../core/services/api.service';
import { Order, OrderTest } from '../../../shared/models/order.model';
import { Report } from '../../../shared/models/report.model';
import { reportByOrderSummaryUrl } from '../../../shared/utils/report-summary';
import { PdfCanvasComponent } from './pdf-canvas.component';
import { PatientTimelineService } from './patient-timeline.service';
import { ToastService } from '../../../core/services/toast.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { isAuthedApiFilePath } from '../../../shared/utils/upload-fetch';
import { JourneyAxisComponent } from '../../../shared/components/journey-axis/journey-axis.component';
import type { JourneyAxisEvent } from '../../../shared/components/journey-axis/journey-axis';

interface TimelineDoc {
  id: string; fileName: string; contentType: string; url: string; uploadedAt: string; isImage: boolean;
}
interface OpdRec {
  id: string; date: string; doctorName?: string; department?: string; diagnosis?: string;
  symptoms?: string[]; notes?: string;
  prescriptions?: Array<{ name: string; dosage?: string; frequency?: string; duration?: string; status?: string }>;
}
interface IpdAdm {
  id: string; admissionDate: string; dischargeDate?: string; roomWard?: string; admittingDoctor?: string;
  diagnosis?: string; reason?: string; status?: string;
  dailyProgress?: Array<{ date: string; note?: string; doctor?: string }>;
}
interface PharmRec { name: string; date: string; status?: string; dosage?: string; frequency?: string; duration?: string; }
interface Visit {
  key: string; date: string;
  orders: Order[]; docs: TimelineDoc[]; opd: OpdRec[]; ipd: IpdAdm[]; pharmacy: PharmRec[];
  labCount: number; docCount: number;
}
/** A single viewable artifact (report / image / other document). */
export interface TimelineItem {
  id: string;                        // 'rep:'+orderId | 'doc:'+docId
  kind: 'report' | 'image' | 'doc';
  name: string;
  date: string;                      // the visit day (for compare labels)
  url?: string;                      // direct URL (image/doc)
  report?: Report; order?: Order;    // for report kind
}

/**
 * Patient Timeline — full-screen, our own take on TimelineJS. Two-panel stage:
 * a minimal file list (reports + documents of the selected visit) on the LEFT,
 * a large viewer on the RIGHT — clicking a file opens it in the right panel (no
 * popups). A Compare button turns the right panel into a GRID: pick images/
 * reports across different dates and view them together. The bottom is a
 * proportional time axis with zoom (pinch + buttons). Rendered at shell root so
 * it covers the nav; theme-adaptive (light/dark).
 */
@Component({
  selector: 'pf-patient-timeline',
  standalone: true,
  imports: [DatePipe, PdfCanvasComponent, JourneyAxisComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-tl" [class.pf-tl--embedded]="embedded()" [class.pf-tl--viewer]="viewerOnly()">
      <header class="pf-tl__bar">
        @if (!embedded()) {
          <button type="button" class="pf-tl__back" (click)="close.emit()" aria-label="Exit timeline">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            <span>Timeline</span>
          </button>
        }
        @if (!hideTitle()) { <span class="pf-tl__bar-title">Patient Journey</span> }
        <ng-content select="[tl-bar]"></ng-content>
        @if (leftItems().length || picked().length) {
          <button type="button" class="pf-tl__cmp-btn" [class.on]="compareMode()" (click)="toggleCompare()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/></svg>
            {{ compareMode() ? 'Done' : 'Compare' }}
          </button>
        }
        @if (!embedded()) {
          <button type="button" class="pf-tl__x pf-tl__x--bar" (click)="close.emit()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>

      @if (visits().length === 0) {
        <div class="pf-tl__stage-empty pf-empty">
          <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg></span>
          <p class="pf-empty__title">No lab reports or documents yet</p>
          <p class="pf-empty__body">This timeline shows the patient's real lab reports and uploaded documents.</p>
        </div>
      } @else {
        <!-- Two-panel stage -->
        <div class="pf-tl__main">
          <!-- Left: minimal file list of the selected visit -->
          <aside class="pf-tl__left">
            <div class="pf-tl__left-head">
              <span class="pf-tl__left-date">{{ selectedVisit()?.date | date:'EEE, MMM d, y' }}</span>
              @if (compareMode()) { <span class="pf-tl__left-hint">Tap to add to compare</span> }
            </div>
            <div class="pf-tl__filters">
              <button type="button" [class.on]="filter() === 'all'" (click)="filter.set('all')">All</button>
              <button type="button" [class.on]="filter() === 'report'" (click)="filter.set('report')">Reports</button>
              <button type="button" [class.on]="filter() === 'image'" (click)="filter.set('image')">Images</button>
            </div>
            @if (!compareMode()) {
              @for (x of extraNav(); track x.id) {
                <button type="button" class="pf-tl__item pf-tl__item--extra"
                        [class.on]="viewMode() === 'extra' && extraSel() === x.id" (click)="showExtra(x.id)">
                  <span class="pf-tl__item-ico extra">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2v2M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/></svg>
                  </span>
                  <span class="pf-tl__item-body">
                    <span class="pf-tl__item-name">{{ x.label }}</span>
                    <span class="pf-tl__item-kind">{{ x.kind || 'Consult' }}</span>
                  </span>
                </button>
              }
              <button type="button" class="pf-tl__item pf-tl__item--journey"
                      [class.on]="viewMode() === 'journey'" (click)="showJourney()">
                <span class="pf-tl__item-ico journey">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 6h5a4 4 0 0 1 4 4M7 18h5a4 4 0 0 0 4-4"/></svg>
                </span>
                <span class="pf-tl__item-body">
                  <span class="pf-tl__item-name">Visit journey</span>
                  <span class="pf-tl__item-kind">Flow</span>
                </span>
              </button>
            }
            @for (it of leftItemsView(); track it.id) {
              <button type="button" class="pf-tl__item"
                      [class.on]="!compareMode() && viewMode() === 'file' && active()?.id === it.id"
                      [class.picked]="isPicked(it)"
                      (click)="onItem(it)">
                @if (it.kind === 'image') {
                  <img class="pf-tl__item-thumb" [src]="uploads.src(it.url)" [alt]="it.name" loading="lazy" />
                } @else {
                  <span class="pf-tl__item-ico" [class.report]="it.kind === 'report'">
                    @if (busyItem() === it.id) { <span class="pf-tl__spin pf-tl__spin--sm"></span> }
                    @else if (it.kind === 'report') {
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/></svg>
                    } @else {
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                    }
                  </span>
                }
                <span class="pf-tl__item-body">
                  <span class="pf-tl__item-name">{{ it.name }}</span>
                  <span class="pf-tl__item-kind">{{ it.kind === 'report' ? 'Report' : (it.kind === 'image' ? 'Image' : 'Document') }}</span>
                </span>
                @if (compareMode() && isPicked(it)) {
                  <span class="pf-tl__item-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                }
              </button>
            } @empty {
              <p class="pf-tl__left-none">No files on this visit.</p>
            }
          </aside>

          <!-- Right: single viewer OR compare grid -->
          <section class="pf-tl__right">
            @if (compareMode()) {
              @if (picked().length) {
                <div class="pf-tl__cmp-wrap">
                  <div class="pf-tl__cmp-bar">
                    <span class="pf-tl__cmp-count">{{ picked().length }} selected</span>
                    @if (canOverlay()) {
                      <button type="button" class="pf-tl__cmp-mode" [class.on]="overlay()" (click)="overlay.set(!overlay())">
                        {{ overlay() ? 'Grid view' : 'Overlay blend' }}
                      </button>
                    }
                  </div>
                  @if (canOverlay() && overlay()) {
                    <div class="pf-tl__ov">
                      <div class="pf-tl__ov-stage">
                        <img [src]="urlOf(picked()[0])" [alt]="picked()[0].name" />
                        <img class="pf-tl__ov-top" [src]="urlOf(picked()[1])" [alt]="picked()[1].name" [style.opacity]="overlayOpacity()" />
                      </div>
                      <div class="pf-tl__ov-ctl">
                        <span>{{ picked()[0].date | date:'MMM d, yy' }}</span>
                        <input type="range" min="0" max="1" step="0.01" [value]="overlayOpacity()"
                               (input)="overlayOpacity.set(+$any($event.target).value)" aria-label="Blend" />
                        <span>{{ picked()[1].date | date:'MMM d, yy' }}</span>
                      </div>
                    </div>
                  } @else {
                    <div class="pf-tl__grid" [style.--cols]="gridCols()">
                      @for (it of picked(); track it.id) {
                        <figure class="pf-tl__cell">
                          <button type="button" class="pf-tl__cell-x" (click)="unpick(it)" aria-label="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                          <div class="pf-tl__cell-media" [class.pdf]="it.kind !== 'image'">
                            @if (it.kind === 'image') { <img [src]="urlOf(it)" [alt]="it.name" /> }
                            @else if (urlOf(it); as u) { <pf-pdf-canvas [src]="u" [maxPages]="1"></pf-pdf-canvas> }
                            @else { <span class="pf-tl__spin"></span> }
                          </div>
                          <figcaption>{{ it.name }} · {{ it.date | date:'MMM d, yy' }}</figcaption>
                        </figure>
                      }
                    </div>
                  }
                </div>
              } @else {
                <div class="pf-tl__hint-pane">Pick images or reports from any date on the timeline to compare them here.</div>
              }
            } @else if (viewMode() === 'extra') {
              <div class="pf-tl__extra"><ng-content></ng-content></div>
            } @else if (viewMode() === 'journey') {
              <div class="pf-tl__journey">
                <div class="pf-tl__journey-title">Visit journey · {{ selectedVisit()?.date | date:'MMM d, y' }}</div>
                @if (encounterSummary()) { <div class="pf-tl__enc">{{ encounterSummary() }}</div> }
                @if (journeyTat().length) {
                  <div class="pf-tl__tat">
                    @for (s of journeyTat(); track s.label) {
                      <span class="pf-tl__tat-chip"><span class="pf-tl__tat-lbl">{{ s.label }}</span><span class="pf-tl__tat-dur">{{ s.dur }}</span></span>
                    }
                  </div>
                }
                @if (journeyModel().links.length) {
                  <div class="pf-tl__journey-chart" #journeyEl></div>
                } @else {
                  <div class="pf-tl__hint-pane">No journey to plot for this visit yet.</div>
                }
              </div>
            } @else if (active(); as it) {
              <div class="pf-tl__file">
                <div class="pf-tl__file-bar">
                  <span class="pf-tl__file-name">{{ it.name }}</span>
                  @if (urlOf(it)) {
                    <button type="button" class="pf-tl__file-act" (click)="shareFile(it)" title="Share or save">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M12 3v13M7 8l5-5 5 5"/></svg>
                      Share
                    </button>
                  }
                </div>
                <div class="pf-tl__viewer" [class.pf-tl__viewer--pdf]="it.kind !== 'image'">
                  @if (it.kind === 'image') { <img [src]="urlOf(it)" [alt]="it.name" /> }
                  @else if (urlOf(it); as u) { <pf-pdf-canvas [src]="u"></pf-pdf-canvas> }
                  @else { <span class="pf-tl__spin"></span> }
                </div>
              </div>
            } @else {
              <div class="pf-tl__hint-pane">Select a file on the left to view it here.</div>
            }
          </section>
        </div>

        <!-- Bottom: proportional time axis with zoom -->
        <footer class="pf-tl__foot" #footRef [style.height.px]="footH()">
          <div class="pf-tl__grip" (pointerdown)="startResize($event)" title="Drag to resize the timeline"><span></span></div>
          <div class="pf-tl__typefilter">
            <button type="button" [class.on]="isTypeOn('all')" (click)="toggleType('all')">All</button>
            @if (typesPresent().lab) { <button type="button" [class.on]="isTypeOn('lab')" (click)="toggleType('lab')">Lab</button> }
            @if (typesPresent().opd) { <button type="button" [class.on]="isTypeOn('opd')" (click)="toggleType('opd')">OPD</button> }
            @if (typesPresent().ipd) { <button type="button" [class.on]="isTypeOn('ipd')" (click)="toggleType('ipd')">IPD</button> }
            @if (typesPresent().pharmacy) { <button type="button" [class.on]="isTypeOn('pharmacy')" (click)="toggleType('pharmacy')">Pharmacy</button> }
          </div>
          <div class="pf-tl__zoom">
            <button type="button" (click)="axis.zoomBy(1/1.4)" aria-label="Zoom out" title="Zoom out">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>
            </button>
            <button type="button" (click)="axis.zoomBy(1.4)" aria-label="Zoom in" title="Zoom in">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
          <pf-journey-axis #axis class="pf-tl__scroll" [events]="axisEvents()" [selectedKey]="selectedVisit()?.key" [maxLanes]="maxLanes()"
                           (select)="selectKey($event)"></pf-journey-axis>
        </footer>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    :host:has(.pf-tl--embedded) { height: 100%; }
    .pf-tl:not(.pf-tl--embedded) {
      position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column;
      background:
        radial-gradient(ellipse 900px 520px at 10% -4%, rgba(124, 58, 237, 0.20) 0%, transparent 60%),
        radial-gradient(ellipse 820px 520px at 94% 6%, rgba(219, 39, 119, 0.13) 0%, transparent 60%),
        radial-gradient(ellipse 960px 620px at 82% 104%, rgba(168, 85, 247, 0.15) 0%, transparent 62%),
        linear-gradient(135deg, #0a0612 0%, #0d0818 30%, #12091f 55%, #0d0818 78%, #0a0612 100%);
    }
    .pf-tl { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    /* Embedded (Consult Room): contained card, same visual world, no overlay. */
    .pf-tl--embedded {
      position: relative;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(168, 85, 247, 0.18);
      background:
        radial-gradient(ellipse 700px 420px at 10% -4%, rgba(124, 58, 237, 0.18) 0%, transparent 60%),
        radial-gradient(ellipse 640px 420px at 94% 6%, rgba(219, 39, 119, 0.11) 0%, transparent 60%),
        linear-gradient(135deg, #0a0612 0%, #0d0818 35%, #12091f 60%, #0a0612 100%);
    }
    .pf-tl--embedded .pf-tl__bar { padding: 10px 16px; }
    .pf-tl__item-ico.extra { color: #c4b5fd; }
    .pf-tl__item--extra.on { border-color: rgba(168, 85, 247, 0.55); }
    .pf-tl__extra { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px; }

    .pf-tl__bar {
      flex: 0 0 auto; display: flex; align-items: center; gap: 12px;
      padding: max(env(safe-area-inset-top), 10px) 16px 10px;
      border-bottom: 1px solid rgba(168, 85, 247, 0.18);
      background: rgba(18, 12, 30, 0.66); backdrop-filter: blur(14px);
    }
    .pf-tl__back { display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px 7px 8px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); }
    .pf-tl__back:hover { color: var(--text-primary); border-color: rgba(168,85,247,0.4); }
    .pf-tl__bar-title { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; background: linear-gradient(135deg, #a855f7, #ec4899); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
    .pf-tl__cmp-btn { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 9px; font-size: 12px; font-weight: 600; cursor: pointer; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); }
    .pf-tl__cmp-btn:hover { color: var(--text-primary); border-color: rgba(168,85,247,0.4); }
    .pf-tl__cmp-btn.on { background: rgba(168,85,247,0.18); border-color: rgba(168,85,247,0.55); color: var(--text-primary); }
    .pf-tl__x { width: 32px; height: 32px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); cursor: pointer; }
    .pf-tl__x:hover { color: var(--text-primary); }
    .pf-tl__x--bar { margin-left: 0; }
    .pf-tl__bar:not(:has(.pf-tl__cmp-btn)) .pf-tl__x--bar { margin-left: auto; }

    /* Viewer only (OPD consult centre): just the stage. */
    .pf-tl--viewer .pf-tl__bar, .pf-tl--viewer .pf-tl__left, .pf-tl--viewer .pf-tl__foot { display: none !important; }
    .pf-tl__stage-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px; }
    .pf-tl__empty-title { font-size: 15px; font-weight: 600; color: var(--text-secondary); }
    .pf-tl__empty-sub { font-size: 12.5px; color: var(--text-tertiary); margin-top: 6px; max-width: 420px; }

    /* Two-panel stage */
    .pf-tl__main { flex: 1 1 auto; min-height: 0; display: flex; }
    .pf-tl__left {
      flex: 0 0 268px; min-width: 0; overflow-y: auto; padding: 14px;
      display: flex; flex-direction: column; gap: 8px;
      border-right: 1px solid var(--glass-border);
    }
    .pf-tl__left-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
    .pf-tl__left-date { font-size: 12.5px; font-weight: 700; color: var(--text-primary); }
    .pf-tl__left-hint { font-size: 10.5px; color: var(--violet-text); }
    .pf-tl__left-none { font-size: 12px; color: var(--text-tertiary); padding: 8px 2px; }
    .pf-tl__filters { display: flex; gap: 5px; margin-bottom: 4px; }
    .pf-tl__filters button { flex: 1; padding: 5px 6px; border-radius: 8px; font-size: 11px; font-weight: 600; cursor: pointer; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-tertiary); }
    .pf-tl__filters button.on { background: rgba(168,85,247,0.16); border-color: rgba(168,85,247,0.5); color: var(--text-primary); }
    .pf-tl__file { flex: 1 1 auto; min-width: 0; min-height: 0; width: 100%; display: flex; flex-direction: column; }
    .pf-tl__file-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .pf-tl__file-name { min-width: 0; font-size: 12.5px; font-weight: 600; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-tl__file-act { margin-left: auto; flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; padding: 6px 11px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); }
    .pf-tl__file-act:hover { color: var(--text-primary); border-color: rgba(168,85,247,0.4); }
    .pf-tl__item { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 11px; cursor: pointer; text-align: left; background: var(--glass-bg); border: 1px solid var(--glass-border); transition: border-color .12s; }
    .pf-tl__item:hover { border-color: rgba(168,85,247,0.45); }
    .pf-tl__item.on { border-color: #a855f7; box-shadow: 0 0 0 2px rgba(168,85,247,0.3); }
    .pf-tl__item.picked { border-color: rgba(168,85,247,0.6); background: rgba(124,58,237,0.12); }
    .pf-tl__item-thumb { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; flex-shrink: 0; background: rgba(255,255,255,0.04); }
    .pf-tl__item-ico { width: 44px; height: 44px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); background: rgba(255,255,255,0.04); }
    .pf-tl__item-ico.report { color: var(--violet-text); background: rgba(124,58,237,0.14); }
    .pf-tl__item-body { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .pf-tl__item-name { font-size: 12px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-tl__item-kind { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
    .pf-tl__item-check { margin-left: auto; flex-shrink: 0; width: 20px; height: 20px; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: #a855f7; color: #fff; }

    .pf-tl__right { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; padding: 14px; display: flex; }
    .pf-tl__viewer { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; }
    .pf-tl__viewer img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; }
    /* PDFs render as fit-width canvases stacked top→down; scroll vertically.
       Block (not flex) so the child fills the width and never overflows. */
    .pf-tl__viewer--pdf { display: block; }
    .pf-tl__viewer pf-pdf-canvas { display: block; width: 100%; max-width: 820px; margin: 0 auto; }
    .pf-tl__hint-pane { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; color: var(--text-tertiary); font-size: 13px; padding: 24px; }
    .pf-tl__item--journey .pf-tl__item-ico.journey { color: #a855f7; background: rgba(124,58,237,0.14); }
    .pf-tl__journey { flex: 1; min-width: 0; display: flex; flex-direction: column; width: 100%; }
    .pf-tl__journey-title { font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px; }
    .pf-tl__journey-chart { flex: 1; min-height: 300px; width: 100%; }
    .pf-tl__tat { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .pf-tl__tat-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 999px; background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-tl__tat-lbl { font-size: 10.5px; color: var(--text-tertiary); }
    .pf-tl__tat-dur { font-size: 11px; font-weight: 700; color: #a855f7; }
    .pf-tl__cmp-wrap { flex: 1; min-width: 0; min-height: 0; width: 100%; display: flex; flex-direction: column; }
    .pf-tl__cmp-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .pf-tl__cmp-count { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .pf-tl__cmp-mode { margin-left: auto; padding: 5px 11px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); }
    .pf-tl__cmp-mode.on { background: rgba(168,85,247,0.16); border-color: rgba(168,85,247,0.5); color: var(--text-primary); }
    .pf-tl__ov { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .pf-tl__ov-stage { flex: 1; min-height: 300px; position: relative; display: flex; align-items: center; justify-content: center; background: #0a0a0f; border-radius: 10px; overflow: hidden; }
    .pf-tl__ov-stage img { position: absolute; max-width: 100%; max-height: 100%; object-fit: contain; }
    .pf-tl__ov-ctl { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; padding-top: 12px; font-size: 11px; color: var(--text-tertiary); }
    .pf-tl__ov-ctl input[type=range] { flex: 1; accent-color: #a855f7; }
    .pf-tl__grid { display: grid; grid-template-columns: repeat(var(--cols, 2), 1fr); gap: 10px; width: 100%; align-content: start; }
    .pf-tl__cell { margin: 0; position: relative; display: flex; flex-direction: column; border-radius: 12px; overflow: hidden; background: var(--bg-card-solid); border: 1px solid var(--glass-border); }
    .pf-tl__cell-media { position: relative; height: clamp(220px, 42dvh, 460px); display: flex; align-items: center; justify-content: center; background: #0a0a0f; }
    .pf-tl__cell-media img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .pf-tl__cell-media.pdf { display: block; overflow: auto; padding: 6px; }
    .pf-tl__cell-media.pdf pf-pdf-canvas { display: block; width: 100%; }
    .pf-tl__cell-x { position: absolute; top: 6px; right: 6px; z-index: 2; width: 24px; height: 24px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; background: rgba(10,10,16,0.75); border: 1px solid rgba(255,255,255,0.2); color: #fff; cursor: pointer; }
    .pf-tl__cell figcaption { padding: 7px 10px; font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Footer axis + zoom */
    .pf-tl__foot { position: relative; flex: 0 0 auto; overflow: hidden; padding: 18px 0 calc(env(safe-area-inset-bottom) + 8px); background: rgba(10, 6, 18, 0.55); backdrop-filter: blur(10px); border-top: 1px solid rgba(168, 85, 247, 0.16); box-shadow: inset 0 1px 0 rgba(168, 85, 247, 0.06); display: flex; flex-direction: column; justify-content: flex-end; }
    .pf-tl__grip { position: absolute; top: 0; left: 0; right: 0; height: 14px; display: flex; align-items: center; justify-content: center; cursor: row-resize; z-index: 6; touch-action: none; }
    .pf-tl__grip span { width: 44px; height: 3px; border-radius: 2px; background: var(--glass-border); transition: background .12s; }
    .pf-tl__grip:hover span { background: rgba(168,85,247,0.7); }
    .pf-tl__scroll { flex: 0 0 auto; }
    .pf-tl__zoom { position: absolute; top: 16px; right: 16px; z-index: 5; display: inline-flex; gap: 4px; }
    .pf-tl__typefilter { position: absolute; top: 16px; left: 20px; z-index: 5; display: inline-flex; gap: 4px; }
    .pf-tl__typefilter button { padding: 5px 11px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; background: var(--bg-card-solid); border: 1px solid var(--glass-border); color: var(--text-tertiary); }
    .pf-tl__typefilter button.on { background: rgba(168,85,247,0.16); border-color: rgba(168,85,247,0.5); color: var(--text-primary); }
    .pf-tl__enc { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; }
    .pf-tl__zoom button { width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: var(--bg-card-solid); border: 1px solid var(--glass-border); color: var(--text-secondary); cursor: pointer; }
    .pf-tl__zoom button:hover { color: var(--text-primary); border-color: rgba(168,85,247,0.45); }

    .pf-tl__spin { width: 26px; height: 26px; border-radius: 50%; border: 2.5px solid rgba(168,85,247,0.3); border-top-color: #a855f7; animation: pf-tl-spin .7s linear infinite; }
    .pf-tl__spin--sm { width: 18px; height: 18px; border-width: 2px; }
    @keyframes pf-tl-spin { to { transform: rotate(360deg); } }

    /* Light-mode theming (html.light). */
    :host-context(html.light) {
      background:
        radial-gradient(ellipse 900px 520px at 10% -4%, rgba(124, 58, 237, 0.10) 0%, transparent 60%),
        radial-gradient(ellipse 820px 520px at 94% 6%, rgba(219, 39, 119, 0.07) 0%, transparent 60%),
        linear-gradient(135deg, #f5f0fc 0%, #ece1f8 25%, #e2d4f2 50%, #ece1f8 75%, #f5f0fc 100%);
    }
    :host-context(html.light) .pf-tl__bar { background: rgba(246, 244, 252, 0.74); border-bottom-color: rgba(124, 58, 237, 0.16); }
    :host-context(html.light) .pf-tl__foot { background: rgba(246, 244, 252, 0.5); border-top-color: rgba(124, 58, 237, 0.16); box-shadow: inset 0 1px 0 rgba(124, 58, 237, 0.05); }

    @media (max-width: 760px) {
      /* The absolute filter + zoom clusters collided inside the clipped foot
         at <=375px, hiding the Pharmacy pill entirely. Flow the filter as a
         scrollable row instead. */
      .pf-tl__typefilter { position: static; display: flex; overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 60%; }

      /* Stack the two panels: left becomes a horizontal file strip. */
      .pf-tl__main { flex-direction: column; }
      .pf-tl__left { flex: 0 0 auto; flex-direction: row; overflow-x: auto; overflow-y: hidden; border-right: 0; border-bottom: 1px solid var(--glass-border); gap: 8px; padding: 10px 12px; }
      .pf-tl__left-head { display: none; }
      .pf-tl__item { flex: 0 0 auto; width: 168px; }
      .pf-tl__filters { display: none; }
      .pf-tl__grid { grid-template-columns: 1fr; }
      .pf-tl__bar-title { display: none; }
    }
  `],
})
export class PatientTimelineComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly injector = inject(Injector);
  private readonly toasts = inject(ToastService);
  private readonly svc = inject(PatientTimelineService);
  protected readonly uploads = inject(UploadsService);

  readonly patientId = input.required<string>();
  /** Embedded mode (Consult Room): the journey lives INSIDE a host layout —
   *  no fixed overlay, no exit chrome; it fills its container instead. */
  readonly embedded = input(false);
  /** Host-supplied nav entries (Consult Room: Vitals / Notes / Prescription).
   *  They join the LEFT rail above the visit items; selecting one swaps the
   *  stage to the projected <ng-content> pane. */
  readonly extraNav = input<Array<{ id: string; label: string; kind?: string }>>([]);
  /** Hide the built-in "Patient Journey" bar title (host projects its own). */
  readonly hideTitle = input(false);
  /** Viewer only (OPD consult centre): just the right-hand stage — the file
   *  viewer / compare grid / visit journey. No bar, no file list, no axis;
   *  the host drives it (openSingle / setPicked / selectKey). Default off. */
  readonly viewerOnly = input(false);
  readonly extraChange = output<string | null>();
  readonly extraSel = signal<string | null>(null);
  readonly close = output<void>();

  readonly ordersData = signal<Order[]>([]);
  readonly docs = signal<TimelineDoc[]>([]);
  /** Day-keys that had an abnormal/critical result (from lab-trends flags). */
  readonly abnormalDays = signal<Set<string>>(new Set());
  readonly selectedKey = signal<string | null>(null);
  readonly reportCache = signal<Record<string, Report | null>>({});

  // Viewing state.
  readonly active = signal<TimelineItem | null>(null);   // single-view item
  readonly compareMode = signal(false);
  readonly picked = signal<TimelineItem[]>([]);          // compare grid
  readonly overlay = signal(false);                      // blend two images
  readonly overlayOpacity = signal(0.5);
  readonly urlCache = signal<Record<string, string>>({}); // itemId -> viewable url
  readonly busyItem = signal<string | null>(null);        // report being built
  /** User-dragged footer height (px); null = auto/compact. */
  readonly footH = signal<number | null>(null);
  /** Right panel: the visit journey (Sankey) or a single file. */
  readonly viewMode = signal<'journey' | 'file' | 'extra'>('journey');
  /** Left-list filter. */
  readonly filter = signal<'all' | 'report' | 'image'>('all');

  private readonly journeyEl = viewChild<ElementRef<HTMLDivElement>>('journeyEl');
  private readonly footRef = viewChild<ElementRef<HTMLElement>>('footRef');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _echarts: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _journeyChart: any = null;
  private _journeyHost: HTMLElement | null = null;
  private readonly _resize = () => this._journeyChart?.resize();
  private _boundResize = false;

  private readonly reportBlobs = new Map<string, string>();
  private readonly blobUrls = new Set<string>();

  readonly visits = computed<Visit[]>(() => {
    const map = new Map<string, Visit>();
    const bucket = (iso: string): Visit => {
      const k = this.dayKey(iso);
      let v = map.get(k);
      if (!v) { v = { key: k, date: iso, orders: [], docs: [], opd: [], ipd: [], pharmacy: [], labCount: 0, docCount: 0 }; map.set(k, v); }
      if (iso < v.date) v.date = iso;
      return v;
    };
    for (const o of this.ordersData()) bucket(o.createdAt).orders.push(o);
    for (const d of this.docs()) bucket(d.uploadedAt).docs.push(d);
    for (const e of (this.svc.opd() as OpdRec[])) if (e?.date) bucket(e.date).opd.push(e);
    for (const e of (this.svc.ipd() as IpdAdm[])) if (e?.admissionDate) bucket(e.admissionDate).ipd.push(e);
    for (const e of (this.svc.pharmacy() as PharmRec[])) if (e?.date) bucket(e.date).pharmacy.push(e);
    const arr = [...map.values()];
    for (const v of arr) { v.labCount = v.orders.length; v.docCount = v.docs.length; }
    arr.sort((a, b) => a.date.localeCompare(b.date));
    return arr;
  });

  /** Which encounter types the patient actually has (drives the filter chips). */
  readonly typesPresent = computed(() => {
    const vs = this.visits();
    return {
      lab: vs.some(v => v.orders.length > 0 || v.docs.length > 0),
      opd: vs.some(v => v.opd.length > 0),
      ipd: vs.some(v => v.ipd.length > 0),
      pharmacy: vs.some(v => v.pharmacy.length > 0),
    };
  });
  /** Multi-select type filter — empty set = All. */
  readonly selectedTypes = signal<Set<string>>(new Set());
  private matchesType(v: Visit, t: string): boolean {
    if (t === 'lab') return v.orders.length > 0 || v.docs.length > 0;
    if (t === 'opd') return v.opd.length > 0;
    if (t === 'ipd') return v.ipd.length > 0;
    if (t === 'pharmacy') return v.pharmacy.length > 0;
    return false;
  }
  readonly visitsFiltered = computed<Visit[]>(() => {
    const sel = this.selectedTypes();
    const vs = this.visits();
    if (!sel.size) return vs;                              // All
    return vs.filter(v => [...sel].some(t => this.matchesType(v, t)));  // union
  });
  isTypeOn(t: string): boolean { return t === 'all' ? this.selectedTypes().size === 0 : this.selectedTypes().has(t); }
  toggleType(t: string) {
    if (t === 'all') { this.selectedTypes.set(new Set()); return; }
    this.selectedTypes.update(s => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });
  }

  readonly selectedVisit = computed<Visit | null>(() => {
    const list = this.visitsFiltered();
    if (!list.length) return null;
    const k = this.selectedKey();
    return list.find(v => v.key === k) ?? list[list.length - 1];
  });

  /** Primary type of a visit (for the axis dot/icon). */
  evType(v: Visit): 'lab' | 'opd' | 'ipd' | 'pharmacy' | 'doc' {
    if (v.ipd.length) return 'ipd';
    if (v.opd.length) return 'opd';
    if (v.orders.length) return 'lab';
    if (v.pharmacy.length) return 'pharmacy';
    return 'doc';
  }

  /** Files (reports + docs) of the selected visit — the left list. */
  readonly leftItems = computed<TimelineItem[]>(() => {
    const v = this.selectedVisit();
    if (!v) return [];
    const items: TimelineItem[] = [];
    for (const o of v.orders) {
      const rep = this.reportFor(o.id);
      if (rep) items.push({ id: 'rep:' + o.id, kind: 'report', name: this.orderPanelName(o), date: v.date, report: rep, order: o });
    }
    for (const d of v.docs) {
      items.push({ id: 'doc:' + d.id, kind: d.isImage ? 'image' : 'doc', name: d.fileName, date: v.date, url: d.url });
    }
    return items;
  });

  /** Left list after the filter chips. */
  readonly leftItemsView = computed<TimelineItem[]>(() => {
    const f = this.filter();
    const items = this.leftItems();
    if (f === 'all') return items;
    if (f === 'report') return items.filter(i => i.kind === 'report');
    return items.filter(i => i.kind === 'image');
  });

  readonly gridCols = computed(() => Math.min(this.picked().length, 3) || 1);
  /** Overlay-blend is available when exactly two images are picked. */
  readonly canOverlay = computed(() => { const p = this.picked(); return p.length === 2 && p.every(i => i.kind === 'image'); });

  /** The visit's journey as a Sankey flow: Registered → panel(s) →
   *  Validated / In progress → Report, plus a Documents branch. */
  readonly journeyModel = computed<{ nodes: { name: string }[]; links: { source: string; target: string; value: number }[] }>(() => {
    const v = this.selectedVisit();
    const nodes: { name: string }[] = [];
    const links: { source: string; target: string; value: number }[] = [];
    if (!v) return { nodes, links };
    const seen = new Set<string>();
    const add = (name: string) => { if (!seen.has(name)) { seen.add(name); nodes.push({ name }); } };
    // OPD encounters: Arrival → Doctor → Diagnosis → Prescription.
    for (const e of v.opd) {
      add('Arrival');
      const dr = 'Dr ' + (e.doctorName || 'Consult');
      add(dr); links.push({ source: 'Arrival', target: dr, value: 1 });
      const meds = e.prescriptions?.length ?? 0;
      if (e.diagnosis) {
        const dx = 'Dx: ' + e.diagnosis;
        add(dx); links.push({ source: dr, target: dx, value: 1 });
        if (meds) { const rx = `Rx (${meds})`; add(rx); links.push({ source: dx, target: rx, value: meds }); }
      } else if (meds) {
        const rx = `Rx (${meds})`; add(rx); links.push({ source: dr, target: rx, value: meds });
      }
    }
    // IPD admissions: Admission → Ward → Rounds → Discharge.
    for (const e of v.ipd) {
      add('Admission');
      const ward = e.roomWard || 'Ward';
      add(ward); links.push({ source: 'Admission', target: ward, value: 1 });
      const rounds = e.dailyProgress?.length ?? 0;
      const disc = e.dischargeDate ? 'Discharged' : (e.status || 'Admitted');
      if (rounds) { const r = `Rounds (${rounds})`; add(r); links.push({ source: ward, target: r, value: rounds }); add(disc); links.push({ source: r, target: disc, value: 1 }); }
      else { add(disc); links.push({ source: ward, target: disc, value: 1 }); }
    }
    if (v.orders.length) add('Registered');
    let reportTotal = 0;
    for (const o of v.orders) {
      const panel = this.orderPanelName(o);
      const ts = this.tests(o);
      const cnt = Math.max(ts.length, 1);
      add(panel);
      links.push({ source: 'Registered', target: panel, value: cnt });
      const validated = ts.filter(t => (t.status || '').toLowerCase().includes('validat') || !!t.validatedAt).length
        || (this.reportFor(o.id) ? cnt : 0);
      const pending = Math.max(cnt - validated, 0);
      if (validated > 0) { add('Validated'); links.push({ source: panel, target: 'Validated', value: validated }); }
      if (pending > 0) { add('In progress'); links.push({ source: panel, target: 'In progress', value: pending }); }
      if (this.reportFor(o.id) && validated > 0) reportTotal += validated;
    }
    if (v.docs.length) { add('Registered'); add('Documents'); links.push({ source: 'Registered', target: 'Documents', value: v.docs.length }); }
    if (reportTotal > 0) { add('Report ready'); links.push({ source: 'Validated', target: 'Report ready', value: reportTotal }); }
    // Pharmacy: dispensed meds flow from the prescription (if any) into Pharmacy.
    if (v.pharmacy.length) {
      add('Pharmacy');
      const rx = nodes.find(n => n.name.startsWith('Rx ('))?.name;
      const src = rx ?? 'Arrival';
      add(src);
      links.push({ source: src, target: 'Pharmacy', value: v.pharmacy.length });
    }
    return { nodes, links };
  });

  /** One-line encounter summary shown above the journey for OPD/IPD visits. */
  readonly encounterSummary = computed<string>(() => {
    const v = this.selectedVisit();
    if (!v) return '';
    const parts: string[] = [];
    for (const e of v.opd) parts.push(`OPD${e.doctorName ? ' · Dr ' + e.doctorName : ''}${e.diagnosis ? ' · ' + e.diagnosis : ''}`);
    for (const e of v.ipd) parts.push(`IPD${e.roomWard ? ' · ' + e.roomWard : ''}${e.diagnosis ? ' · ' + e.diagnosis : ''}${e.dischargeDate ? ' · Discharged' : ''}`);
    if (v.pharmacy.length) parts.push(`Pharmacy · ${v.pharmacy.length} med${v.pharmacy.length === 1 ? '' : 's'}`);
    return parts.join('   |   ');
  });

  /** Turnaround times between the visit's lab lifecycle stages (real stamps). */
  readonly journeyTat = computed<{ label: string; dur: string }[]>(() => {
    const v = this.selectedVisit();
    if (!v || !v.orders.length) return [];
    const samples = v.orders.flatMap(o => o.samples ?? []);
    const tests = v.orders.flatMap(o => this.tests(o));
    const ms = (x?: string | null): number => x ? new Date(x).getTime() : NaN;
    const minOf = (xs: (string | null | undefined)[]): number | null => {
      const ns = xs.map(ms).filter(n => !isNaN(n)); return ns.length ? Math.min(...ns) : null;
    };
    const maxOf = (xs: (string | null | undefined)[]): number | null => {
      const ns = xs.map(ms).filter(n => !isNaN(n)); return ns.length ? Math.max(...ns) : null;
    };
    const stages: { name: string; at: number | null }[] = [
      { name: 'Registered', at: minOf(v.orders.map(o => o.createdAt)) },
      { name: 'Collected', at: minOf(samples.map(s => s.collectedAt)) },
      { name: 'At lab', at: minOf(samples.map(s => s.receivedAtLab)) },
      { name: 'Resulted', at: maxOf(tests.map(t => t.resultedAt)) },
      { name: 'Validated', at: maxOf(tests.map(t => t.validatedAt)) },
    ];
    const present = stages.filter(s => s.at != null);
    const out: { label: string; dur: string }[] = [];
    for (let i = 1; i < present.length; i++) {
      const d = (present[i].at as number) - (present[i - 1].at as number);
      if (d >= 0) out.push({ label: `${present[i - 1].name} → ${present[i].name}`, dur: this.fmtDur(d) });
    }
    return out;
  });
  private fmtDur(msTotal: number): string {
    const m = Math.round(msTotal / 60000);
    if (m < 1) return '<1m';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60), rm = m % 60;
    if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
    const d = Math.floor(h / 24), rh = h % 24;
    return rh ? `${d}d ${rh}h` : `${d}d`;
  }

  /** The visible visits as dates on the shared journey axis (pf-journey-axis). */
  readonly axisEvents = computed<JourneyAxisEvent[]>(() => {
    const abn = this.abnormalDays();
    return this.visitsFiltered().map(v => ({
      key: v.key, date: v.date, type: this.evType(v), alert: abn.has(v.key),
      title: `${this.fmtTitleDate(v.date)} — ${this.labelFor(v)}`,
    }));
  });
  /** The lane cap grows with the dragged footer height — drag the timeline
   *  taller and more lanes show (less overlap). */
  readonly maxLanes = computed(() => { const fh = this.footH(); return fh ? Math.max(2, Math.min(12, Math.floor((fh - 56) / 34))) : 4; });

  constructor() {
    effect(() => { const id = this.patientId(); if (id) { this.loadOrders(id); this.loadDocs(id); this.loadTrends(id); } });
    // Fetch reports for the selected visit's orders (untracked cache read).
    effect(() => {
      const v = this.selectedVisit();
      if (!v) return;
      untracked(() => this.loadReports(v.orders));
    });
    // On visit change, default the right panel to the visit journey (not a file).
    effect(() => {
      this.selectedVisit();
      untracked(() => {
        if (this.compareMode()) return;
        this.viewMode.set('journey');
        this.active.set(null);
      });
    });
    // Render the journey Sankey whenever it's shown / its data changes.
    effect(() => {
      this.viewMode(); this.compareMode(); this.journeyModel(); this.journeyEl();
      queueMicrotask(() => this.renderJourney());
    });
  }

  private loadOrders(id: string) {
    this.api.get<{ history?: Order[] }>(`/api/patients/${id}`).subscribe({
      next: r => this.ordersData.set(r?.history ?? []),
      error: () => this.ordersData.set([]),
    });
  }
  private loadDocs(id: string) {
    this.api.get<{ data: Array<Omit<TimelineDoc, 'isImage'>> }>(`/api/patients/${id}/documents`).subscribe({
      next: r => this.docs.set((r?.data ?? []).map(d => ({ ...d, isImage: (d.contentType || '').startsWith('image/') }))),
      error: () => this.docs.set([]),
    });
  }
  /** Server-computed abnormal flags per result date → mark those visit days. */
  private loadTrends(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.api.get<any>(`/api/patients/${id}/lab-trends`).subscribe({
      next: r => {
        const days = new Set<string>();
        for (const t of (r?.tests ?? [])) {
          for (const p of (t.parameters ?? [])) {
            for (const pt of (p.points ?? [])) {
              const f = String(pt.flag ?? '').trim().toUpperCase();
              if (f && f !== 'N' && pt.date) days.add(this.dayKey(pt.date));
            }
          }
        }
        this.abnormalDays.set(days);
      },
      error: () => { /* no flags */ },
    });
  }

  private dayKey(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  /** Fetch the report summary of these orders once each (the list only needs
   *  "is there a report"; opening one reads the full report). Public so a
   *  host (the OPD consult's compare presets) can ask for every visit's. */
  loadReports(orders: readonly Order[]) {
    for (const o of orders) {
      if (o.id in this.reportCache()) continue;
      this.reportCache.update(m => ({ ...m, [o.id]: null }));
      this.api.get<Report | null>(reportByOrderSummaryUrl(o.id)).subscribe({
        next: r => { if (r) this.reportCache.update(m => ({ ...m, [o.id]: r })); },
        error: () => { /* leave null */ },
      });
    }
  }
  tests(o: Order): OrderTest[] { return (o.samples ?? []).flatMap(s => s.tests ?? []); }
  reportFor(orderId: string): Report | null { return this.reportCache()[orderId] ?? null; }
  orderPanelName(o: Order): string {
    const ts = this.tests(o);
    if (!ts.length) return 'Lab report';
    return ts.length === 1 ? ts[0].name : `${ts[0].name} +${ts.length - 1}`;
  }
  labelFor(v: Visit): string {
    const parts: string[] = [];
    if (v.labCount) parts.push(`${v.labCount} lab`);
    if (v.docCount) parts.push(`${v.docCount} doc`);
    return parts.join(' · ') || '—';
  }

  private fmtTitleDate(iso: string): string { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

  // ── Interaction ──────────────────────────────────────────────────────
  selectKey(key: string) { this.selectedKey.set(key); }

  onItem(it: TimelineItem) {
    if (this.compareMode()) this.togglePick(it);
    else this.openSingle(it);
  }
  showJourney() {
    this.viewMode.set('journey');
    this.active.set(null);
    if (this.extraSel() !== null) { this.extraSel.set(null); this.extraChange.emit(null); }
  }
  showExtra(id: string) {
    this.viewMode.set('extra');
    this.active.set(null);
    if (this.extraSel() !== id) { this.extraSel.set(id); this.extraChange.emit(id); }
  }
  async openSingle(it: TimelineItem | null) {
    this.viewMode.set('file');
    if (this.extraSel() !== null) { this.extraSel.set(null); this.extraChange.emit(null); }
    this.active.set(it);
    if (it) await this.ensureUrl(it);
  }
  isPicked(it: TimelineItem): boolean { return this.picked().some(p => p.id === it.id); }
  private togglePick(it: TimelineItem) {
    if (this.isPicked(it)) { this.picked.update(l => l.filter(p => p.id !== it.id)); return; }
    this.picked.update(l => [...l, it]);
    this.ensureUrl(it);
  }
  unpick(it: TimelineItem) { this.picked.update(l => l.filter(p => p.id !== it.id)); }
  /** Host-driven compare (viewer-only mode): exactly these items, in compare. */
  setPicked(items: TimelineItem[]) {
    if (!this.compareMode()) { this.compareMode.set(true); this.active.set(null); }
    this.picked.set(items);
    for (const it of items) void this.ensureUrl(it);
  }

  /** Native share sheet (with the file) where supported, else a download. */
  async shareFile(it: TimelineItem) {
    const url = this.urlOf(it);
    if (!url) return;
    const name = it.name || 'file';
    try {
      const blob = await fetch(url).then(r => r.blob());
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      if (nav.canShare && nav.canShare({ files: [file] })) { await nav.share({ files: [file], title: name }); return; }
    } catch { /* fall through to download */ }
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
  toggleCompare() {
    const on = !this.compareMode();
    this.compareMode.set(on);
    if (on) { this.active.set(null); }
    else { this.picked.set([]); this.overlay.set(false); this.showJourney(); }
  }

  urlOf(it: TimelineItem): string | undefined { return this.urlCache()[it.id]; }

  private async ensureUrl(it: TimelineItem) {
    if (this.urlCache()[it.id]) return;
    if (it.kind !== 'report') {
      if (!it.url) return;
      // A patient document is an AUTHENTICATED file path (logic audit) — its
      // bytes come through the session, never a bare link.
      const url = isAuthedApiFilePath(it.url) ? await this.uploads.objectUrl(it.url) : it.url;
      if (url) this.urlCache.update(m => ({ ...m, [it.id]: url }));
      return;
    }
    if (!it.report) return;
    this.busyItem.set(it.id);
    try {
      const url = await this.buildReportUrl(it.report, it.order);
      if (url) this.urlCache.update(m => ({ ...m, [it.id]: url }));
    } finally { this.busyItem.set(null); }
  }

  /** The report's STORED PDF → object URL, cached (rendered + stored once
   *  from its saved snapshot when it has none yet). */
  private async buildReportUrl(rep: Report, o?: Order): Promise<string> {
    const cached = this.reportBlobs.get(rep.id);
    if (cached) return cached;
    try {
      const { storedReportBlob } = await import('../../../shared/utils/report-blob');
      const url = URL.createObjectURL(await storedReportBlob(rep, this.api, this.injector));
      this.reportBlobs.set(rep.id, url); this.blobUrls.add(url);
      return url;
    } catch (err) {
      // Never fall back to a template-less render: it looks like a different
      // lab's report. Say so instead.
      console.error('[timeline] report load failed', err);
      const { reportRenderErrorMessage } = await import('../../../shared/utils/report-render-input');
      this.toasts.error(reportRenderErrorMessage(err, 'Could not open the report'));
      return '';
    }
  }

  // ── Resize the timeline footer by dragging its top edge ──────────────
  private _resizeStartY = 0; private _resizeStartH = 0;
  startResize(ev: PointerEvent) {
    ev.preventDefault();
    const foot = this.footRef()?.nativeElement;
    this._resizeStartH = this.footH() ?? (foot?.offsetHeight ?? 200);
    this._resizeStartY = ev.clientY;
    window.addEventListener('pointermove', this._onResize);
    window.addEventListener('pointerup', this._endResize);
  }
  private readonly _onResize = (e: PointerEvent) => {
    const dy = this._resizeStartY - e.clientY;   // drag up → taller footer
    const max = Math.round(window.innerHeight * 0.72);
    this.footH.set(Math.max(140, Math.min(max, this._resizeStartH + dy)));
  };
  private readonly _endResize = () => {
    window.removeEventListener('pointermove', this._onResize);
    window.removeEventListener('pointerup', this._endResize);
  };

  // ── Visit journey (Sankey) ───────────────────────────────────────────
  private async renderJourney() {
    if (this.compareMode() || this.viewMode() !== 'journey') return;
    const el = this.journeyEl()?.nativeElement;
    const model = this.journeyModel();
    if (!el || !model.links.length) return;
    this._echarts ??= await import('echarts');
    const ec = this._echarts;
    if (this._journeyChart && this._journeyHost !== el) { this._journeyChart.dispose(); this._journeyChart = null; }
    if (!this._journeyChart) { this._journeyChart = ec.init(el, undefined, { renderer: 'canvas' }); this._journeyHost = el; }
    if (!this._boundResize) { window.addEventListener('resize', this._resize); this._boundResize = true; }
    this._journeyChart.setOption(this.buildSankey(model), true);
    this._journeyChart.resize();
  }

  private buildSankey(model: { nodes: { name: string }[]; links: { source: string; target: string; value: number }[] }) {
    const light = document.documentElement.classList.contains('light');
    const textColor = light ? '#334155' : '#e5e7eb';
    const PALETTE = ['#7c3aed', '#a855f7', '#c084fc', '#ec4899', '#f472b6', '#38bdf8', '#34d399', '#fbbf24'];
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', triggerOn: 'mousemove', confine: true },
      series: [{
        type: 'sankey', nodeAlign: 'right', top: 8, bottom: 16, left: 6, right: 92,
        nodeGap: 14, nodeWidth: 12, draggable: false,
        data: model.nodes.map((n, i) => ({ name: n.name, itemStyle: { color: PALETTE[i % PALETTE.length], borderColor: 'transparent' } })),
        links: model.links,
        emphasis: { focus: 'adjacency' },
        label: { color: textColor, fontSize: 12, fontWeight: 600 },
        lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.32 },
      }],
    };
  }

  ngOnDestroy() {
    for (const u of this.blobUrls) { try { URL.revokeObjectURL(u); } catch { /* */ } }
    if (this._boundResize) window.removeEventListener('resize', this._resize);
    this._journeyChart?.dispose();
    window.removeEventListener('pointermove', this._onResize);
    window.removeEventListener('pointerup', this._endResize);
  }
}
