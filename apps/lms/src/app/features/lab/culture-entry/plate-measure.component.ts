import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { PlatformService } from '../../../core/services/platform.service';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { ToastService } from '../../../core/services/toast.service';
import { PlateMeasurement } from '../../../shared/models/culture.model';
import { ApiError } from '../../../shared/models/api-response.model';

type Pt = { x: number; y: number };
type Mode = 'capture' | 'calibrate' | 'measure';
interface Zone { cx: number; cy: number; r: number; abIndex: number | null; auto: boolean; conf?: number; }
type DragKind = 'move' | 'resize' | 'create';
type Box = { x: number; y: number; w: number; h: number };

interface AnalyzedCircle { cx: number; cy: number; r: number; }
interface AnalyzedZone { cx: number; cy: number; r: number; diameterMm: number; confidence: number; }
interface PlateAnalysis { imageWidth: number; imageHeight: number; dish?: AnalyzedCircle | null; mmPerPx?: number | null; zones: AnalyzedZone[]; }

/**
 * Plate measure-assist (popup + fullscreen). Capture/upload → calibrate (auto or
 * tap the rim) → measure. Auto-detect proposes unassigned circles; the tech fits
 * each (drag/resize), assigns by dragging an antibiotic from the right list, and
 * sees live S/I/R. Supports pinch/wheel zoom + pan, a magnifier loupe, undo/redo
 * and a low-confidence cue. Emits per-antibiotic zone mm + the uploaded photo.
 */
@Component({
  selector: 'pf-plate-measure',
  standalone: true,
  imports: [FormsModule],
  host: { '(window:keydown)': 'onKey($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pm-backdrop" [class.pm-backdrop--full]="fullscreen()" (click)="onBackdrop($event)">
      <div class="pm-panel" [class.pm-panel--full]="fullscreen()" (click)="$event.stopPropagation()">
        <div class="pm-head">
          <div class="min-w-0">
            <div class="text-sm font-bold" style="color: var(--text-primary);">Measure zones from plate</div>
            <div class="text-[11px]" style="color: var(--text-tertiary);">{{ stepHint() }}</div>
          </div>
          <button type="button" class="pm-icon" (click)="fullscreen.set(!fullscreen())" [title]="fullscreen() ? 'Exit full screen' : 'Full screen'">
            @if (fullscreen()) {
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3v6H3"/><path d="M15 21v-6h6"/><path d="M3 15h6v6"/><path d="M21 9h-6V3"/></svg>
            } @else {
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
            }
          </button>
          <button type="button" class="pm-x" (click)="close()" title="Close">×</button>
        </div>

        @if (mode() === 'capture') {
          <div class="pm-capture">
            @if (!isNative() && camStream()) {
              <video #cam class="pm-cam" autoplay playsinline muted></video>
              <p class="text-[12px] text-center mt-2 mb-3" style="color: var(--text-tertiary);">Frame the whole dish, top-down, then capture.</p>
              <div class="flex flex-col gap-2 w-full max-w-xs">
                <button type="button" class="pm-btn pm-btn--primary" (click)="captureFromVideo()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v11H4V7z"/><path d="M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>
                  Capture
                </button>
                <label class="pm-btn pm-btn--ghost text-center cursor-pointer">Upload a photo instead
                  <input type="file" accept="image/png,image/jpeg,image/webp" (change)="onFilePick($event)" hidden /></label>
              </div>
            } @else {
              <svg class="mb-2" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: var(--text-tertiary);">
                <path d="M4 7h4l2-3h4l2 3h4v11H4V7z"/><path d="M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>
              </svg>
              <p class="text-[13px] text-center mb-1" style="color: var(--text-secondary);">Take a clear, top-down photo of the plate with the whole dish in frame.</p>
              @if (camError()) { <p class="text-[12px] text-center mb-2" style="color: var(--red-text);">{{ camError() }}</p> }
              <div class="flex flex-col gap-2 w-full max-w-xs">
                @if (isNative()) { <button type="button" class="pm-btn pm-btn--primary" (click)="capturePhoto()">Take photo</button> }
                @else { <button type="button" class="pm-btn pm-btn--primary" (click)="startCamera()">Open camera</button> }
                <label class="pm-btn pm-btn--ghost text-center cursor-pointer">{{ isNative() ? 'Choose from gallery' : 'Upload a photo' }}
                  <input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" (change)="onFilePick($event)" hidden /></label>
              </div>
            }
          </div>
        }

        @if (mode() !== 'capture' && imageSrc()) {
          <div class="pm-body">
            <div class="pm-stage">
              <img class="pm-dim" [src]="imageSrc()" (load)="onImgLoad($event)" alt="" />
              <svg #svg class="pm-svg" [attr.viewBox]="viewBox()" preserveAspectRatio="xMidYMid meet"
                   (pointerdown)="onDown($event)" (pointermove)="onMove($event)" (pointerup)="onUp($event)" (pointercancel)="onUp($event)" (wheel)="onWheel($event)">
                <image [attr.href]="imageSrc()" x="0" y="0" [attr.width]="natW()" [attr.height]="natH()" preserveAspectRatio="none"></image>
                @if (calPts().length === 2) {
                  <line [attr.x1]="calPts()[0].x" [attr.y1]="calPts()[0].y" [attr.x2]="calPts()[1].x" [attr.y2]="calPts()[1].y"
                        stroke="#22d3ee" [attr.stroke-width]="unit()" [attr.stroke-dasharray]="(unit()*2) + ' ' + unit()" />
                  <text [attr.x]="(calPts()[0].x + calPts()[1].x)/2" [attr.y]="(calPts()[0].y + calPts()[1].y)/2 - unit()" fill="#22d3ee" [attr.font-size]="unit()*3" text-anchor="middle" font-weight="700">{{ dishMm() }} mm</text>
                }
                @for (p of calPts(); track $index) {
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="unit()*2.4" fill="rgba(34,211,238,0.25)" stroke="#22d3ee" [attr.stroke-width]="unit()*0.6" />
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="unit()*0.9" fill="#22d3ee" />
                }

                @if (mode() === 'measure') {
                  @for (z of zones(); track $index) {
                    <g [attr.opacity]="$index === selected() ? 1 : 0.85">
                      <circle [attr.cx]="z.cx" [attr.cy]="z.cy" [attr.r]="z.r" [attr.fill]="zoneFill($index)" [attr.stroke]="zoneStroke(z)"
                              [attr.stroke-width]="($index === selected() || $index === dropTarget()) ? unit()*2 : unit()"
                              [attr.stroke-dasharray]="lowConf(z) ? (unit()*1.8 + ' ' + unit()*1.4) : ''" />
                      <circle [attr.cx]="z.cx" [attr.cy]="z.cy" [attr.r]="unit()*1.5" [attr.fill]="zoneStroke(z)" />
                      @if ($index === selected()) {
                        <rect [attr.x]="z.cx + z.r - unit()*1.4" [attr.y]="z.cy - unit()*1.4" [attr.width]="unit()*2.8" [attr.height]="unit()*2.8" fill="#fff" [attr.stroke]="zoneStroke(z)" [attr.stroke-width]="unit()*0.5" />
                        <rect [attr.x]="z.cx - z.r - unit()*1.4" [attr.y]="z.cy - unit()*1.4" [attr.width]="unit()*2.8" [attr.height]="unit()*2.8" fill="#fff" [attr.stroke]="zoneStroke(z)" [attr.stroke-width]="unit()*0.5" />
                        <rect [attr.x]="z.cx - unit()*1.4" [attr.y]="z.cy + z.r - unit()*1.4" [attr.width]="unit()*2.8" [attr.height]="unit()*2.8" fill="#fff" [attr.stroke]="zoneStroke(z)" [attr.stroke-width]="unit()*0.5" />
                        <rect [attr.x]="z.cx - unit()*1.4" [attr.y]="z.cy - z.r - unit()*1.4" [attr.width]="unit()*2.8" [attr.height]="unit()*2.8" fill="#fff" [attr.stroke]="zoneStroke(z)" [attr.stroke-width]="unit()*0.5" />
                        <circle [attr.cx]="z.cx + z.r*0.71" [attr.cy]="z.cy - z.r*0.71" [attr.r]="unit()*2.8" fill="#ef4444" stroke="#fff" [attr.stroke-width]="unit()*0.6" />
                        <text [attr.x]="z.cx + z.r*0.71" [attr.y]="z.cy - z.r*0.71 + unit()*1.1" fill="#fff" [attr.font-size]="unit()*3.4" text-anchor="middle" font-weight="700">×</text>
                      }
                      <text [attr.x]="z.cx" [attr.y]="z.cy - z.r - unit()" [attr.fill]="zoneStroke(z)" [attr.font-size]="unit()*3" text-anchor="middle" font-weight="700">{{ mmOf(z) }}mm{{ sirOf(z) ? ' · ' + sirLabel(z) : '' }}</text>
                      @if (z.abIndex != null) {
                        <text [attr.x]="z.cx" [attr.y]="z.cy" dominant-baseline="middle" text-anchor="middle" [attr.font-size]="unit()*2.8" fill="#ffffff" stroke="#0a0a0a" [attr.stroke-width]="unit()*0.9" style="paint-order: stroke;" font-weight="800">{{ abLabel(z.abIndex) }}</text>
                      }
                    </g>
                  }
                }
              </svg>

              <!-- Magnifier loupe -->
              @if (loupe(); as lp) {
                <div class="pm-loupe" [style.left.px]="lp.sx - 130" [style.top.px]="lp.sy - 130"
                     [style.background-image]="'url(' + imageSrc() + ')'"
                     [style.background-size.px]="natW()*4" [style.background-position]="(-(lp.ix*4 - 55)) + 'px ' + (-(lp.iy*4 - 55)) + 'px'">
                  <span class="pm-loupe-x"></span>
                </div>
              }

              <!-- Zoom / pan / history toolbar -->
              @if (mode() === 'measure') {
                <div class="pm-toolbar">
                  <button type="button" class="pm-tool" [class.pm-tool--on]="panMode()" (click)="panMode.set(!panMode())" title="Pan">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9l-3 3 3 3"/><path d="M9 5l3-3 3 3"/><path d="M15 19l-3 3-3-3"/><path d="M19 9l3 3-3 3"/><path d="M2 12h20"/><path d="M12 2v20"/></svg>
                  </button>
                  <button type="button" class="pm-tool" (click)="zoomBtn(1.3)" title="Zoom in">＋</button>
                  <button type="button" class="pm-tool" (click)="zoomBtn(1/1.3)" title="Zoom out">－</button>
                  <button type="button" class="pm-tool" (click)="resetView()" title="Fit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
                  </button>
                  <span class="pm-tool-sep"></span>
                  <button type="button" class="pm-tool" [disabled]="history.length === 0" (click)="undo()" title="Undo">↶</button>
                  <button type="button" class="pm-tool" [disabled]="future.length === 0" (click)="redo()" title="Redo">↷</button>
                  <button type="button" class="pm-tool" [disabled]="zones().length === 0" (click)="clearAll()" title="Clear all">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                  </button>
                </div>
              }

              @if (showHint() && mode() === 'measure') {
                <div class="pm-hint" (click)="dismissHint()">
                  <div class="pm-hint-card" (click)="$event.stopPropagation()">
                    <div class="text-sm font-bold mb-2" style="color: var(--text-primary);">Quick guide</div>
                    <ul class="pm-hint-list">
                      <li><b>Pinch / scroll</b> to zoom · two-finger drag to pan</li>
                      <li><b>Drag</b> a circle's centre to move, edge to resize</li>
                      <li><b>Double-tap</b> a circle to auto-snap it to the zone edge</li>
                      <li><b>Drag an antibiotic</b> from the list onto a circle</li>
                      <li>Tap the red <b>×</b> on a selected circle to delete</li>
                    </ul>
                    <button type="button" class="pm-btn pm-btn--primary w-full mt-2" (click)="dismissHint()">Got it</button>
                  </div>
                </div>
              }
            </div>

            @if (mode() === 'measure') {
              <div class="pm-list">
                <div class="pm-list-hd">Antibiotics<br /><span style="font-weight:400; color:var(--text-tertiary);">drag onto a zone to assign</span></div>
                <input class="pm-search" type="text" placeholder="Search…" [ngModel]="search()" (ngModelChange)="search.set($event)" />
                @for (ab of filteredAbs(); track ab.i) {
                  <div class="pm-list-item" [class.pm-list-item--assigned]="hasZone(ab.i)" [class.pm-list-item--drag]="dragAb()?.index === ab.i"
                       (pointerdown)="abDown($event, ab.i)" (pointermove)="abMove($event)" (pointerup)="abUp($event)">
                    <span class="pm-grip">⠿</span>
                    <span class="flex-1 truncate">{{ ab.name || ('#' + (ab.i+1)) }}</span>
                    @if (hasZone(ab.i)) {
                      <span class="pm-list-mm">{{ mmFor(ab.i) }}mm</span>
                      <button type="button" class="pm-unassign" (pointerdown)="$event.stopPropagation()" (click)="unassign(ab.i)" title="Unassign">×</button>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }

        @if (mode() === 'calibrate') {
          <div class="pm-controls">
            <button type="button" class="pm-btn pm-btn--primary w-full mb-2" [disabled]="analyzing()" (click)="autoDetect()">
              @if (!analyzing()) { <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/></svg> }
              {{ analyzing() ? 'Analyzing…' : 'Auto-detect dish + zones' }}
            </button>
            <div class="text-[11px] text-center mb-2" style="color: var(--text-tertiary);">— or calibrate manually: tap the two rim edges —</div>
            <div class="flex items-center gap-2 mb-2">
              <label class="text-[12px]" style="color: var(--text-secondary);">Dish Ø</label>
              <input type="number" class="pf-input pf-input--compact w-20 text-center" [ngModel]="dishMm()" (ngModelChange)="dishMm.set($event || 90)" />
              <span class="text-[11px]" style="color: var(--text-tertiary);">mm (standard plate = 90)</span>
            </div>
            <div class="flex gap-2">
              <button type="button" class="pm-btn pm-btn--ghost flex-1" (click)="resetCalibration()">Re-tap rim</button>
              <button type="button" class="pm-btn pm-btn--primary flex-1" [disabled]="!calibrated()" (click)="goMeasure()">Measure</button>
            </div>
          </div>
        }

        @if (mode() === 'measure') {
          <div class="pm-controls">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-[11px]" style="color: var(--text-tertiary);">Drag centre to move, edge to resize · <b>double-tap = snap to edge</b> · pinch/scroll to zoom · drag an antibiotic onto a circle.</span>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="pm-btn pm-btn--ghost" (click)="mode.set('calibrate')">Recalibrate</button>
              <button type="button" class="pm-btn pm-btn--ghost" (click)="retake()">Retake</button>
              <button type="button" class="pm-btn pm-btn--ghost" [disabled]="analyzing()" (click)="autoDetect()">
                @if (!analyzing()) { <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/></svg> }
                {{ analyzing() ? '…' : 'Re-detect' }}
              </button>
              <button type="button" class="pm-btn pm-btn--ghost" [disabled]="!hasUnassigned()" (click)="smartFill()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg> Smart-fill</button>
              <button type="button" class="pm-btn pm-btn--primary flex-1" [disabled]="busy() || assignedCount() === 0" (click)="apply()">{{ busy() ? 'Saving…' : ('Apply ' + assignedCount() + ' zone' + (assignedCount() === 1 ? '' : 's')) }}</button>
            </div>
          </div>
        }
      </div>
    </div>

    @if (dragAb(); as d) { <div class="pm-ghost" [style.left.px]="d.x" [style.top.px]="d.y">{{ antibiotics[d.index] || ('#' + (d.index+1)) }}</div> }
  `,
  styles: [`
    .pm-backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.72); display: flex; align-items: center; justify-content: center; padding: 12px; }
    .pm-backdrop--full { padding: 0; }
    .pm-panel { width: 100%; max-width: 960px; max-height: 92dvh; display: flex; flex-direction: column; background: var(--surface-1, #14161c); border: 1px solid var(--glass-border); border-radius: 16px; overflow: hidden; }
    .pm-panel--full { max-width: none; width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
    .pm-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
    .pm-head .min-w-0 { flex: 1; }
    .pm-icon { font-size: 16px; line-height: 1; color: var(--text-secondary); background: none; border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; padding: 5px 8px; }
    .pm-x { font-size: 24px; line-height: 1; color: var(--text-tertiary); background: none; border: none; cursor: pointer; padding: 0 6px; }
    .pm-capture { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 20px; min-height: 320px; }
    .pm-cam { width: 100%; max-width: 520px; aspect-ratio: 4 / 3; border-radius: 12px; background: #000; object-fit: cover; border: 1px solid var(--glass-border); }
    .pm-body { flex: 1; display: flex; min-height: 360px; }
    .pm-stage { position: relative; flex: 1; min-width: 0; background: #000; touch-action: pan-y; overflow: hidden; }
    .pm-dim { display: none; }
    .pm-svg { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: pan-y; cursor: crosshair; }
    .pm-loupe { position: absolute; width: 110px; height: 110px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.5); background-repeat: no-repeat; pointer-events: none; z-index: 4; }
    .pm-loupe-x { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; transform: translate(-50%,-50%); }
    .pm-loupe-x::before, .pm-loupe-x::after { content: ''; position: absolute; background: rgba(255,0,0,0.7); }
    .pm-loupe-x::before { left: 50%; top: 0; width: 1.5px; height: 100%; transform: translateX(-50%); }
    .pm-loupe-x::after { top: 50%; left: 0; height: 1.5px; width: 100%; transform: translateY(-50%); }
    .pm-toolbar { position: absolute; left: 8px; bottom: 8px; display: flex; gap: 3px; padding: 3px; border-radius: 10px; background: rgba(20,22,28,0.85); border: 1px solid var(--glass-border); z-index: 3; }
    .pm-hint { position: absolute; inset: 0; z-index: 6; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .pm-hint-card { max-width: 340px; padding: 16px 18px; border-radius: 14px; background: var(--surface-1, #14161c); border: 1px solid var(--glass-border); }
    .pm-hint-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; font-size: 12.5px; color: var(--text-secondary); }
    .pm-hint-list b { color: var(--text-primary); }
    .pm-tool { width: 30px; height: 30px; border-radius: 7px; background: transparent; border: none; color: var(--text-secondary); font-size: 15px; cursor: pointer; }
    .pm-tool:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
    .pm-tool:disabled { opacity: 0.35; cursor: not-allowed; }
    .pm-tool--on { background: rgba(124,58,237,0.3); color: var(--violet-text); }
    .pm-tool-sep { width: 1px; background: var(--glass-border); margin: 4px 2px; }
    .pm-list { width: 220px; flex-shrink: 0; border-left: 1px solid var(--border-subtle); overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 5px; }
    .pm-list-hd { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-secondary); margin-bottom: 2px; line-height: 1.5; }
    .pm-search { width: 100%; padding: 6px 9px; border-radius: 8px; font-size: 12px; background: var(--glass-bg); border: 1px solid var(--border-subtle); color: var(--text-primary); margin-bottom: 4px; }
    .pm-list-item { display: flex; align-items: center; gap: 6px; padding: 7px 8px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1px solid var(--border-subtle); color: var(--text-secondary); background: var(--glass-bg); cursor: grab; touch-action: pan-y; user-select: none; }
    .pm-list-item--assigned { border-color: #10b981; color: var(--green-text); }
    .pm-list-item--drag { opacity: 0.4; }
    .pm-grip { color: var(--text-tertiary); font-size: 13px; }
    .pm-list-mm { font-size: 10px; padding: 1px 5px; border-radius: 6px; background: rgba(16,185,129,0.18); }
    .pm-unassign { color: var(--red-text); background: none; border: none; cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
    .pm-ghost { position: fixed; z-index: 1001; transform: translate(-50%, -50%); pointer-events: none; padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; color: #fff; background: #7c3aed; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
    .pm-controls { padding: 12px 14px; border-top: 1px solid var(--border-subtle); flex-shrink: 0; }
    .pm-btn { padding: 9px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
    .pm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .pm-btn--primary { background: #7c3aed; color: #fff; }
    .pm-btn--ghost { background: transparent; border-color: var(--border-subtle); color: var(--text-secondary); }
    .pf-input--compact { padding: 4px 8px; font-size: 12px; }
    @media (max-width: 820px) {
      .pm-backdrop { padding: 0; }
      .pm-panel { max-width: none; width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
      .pm-head { padding-top: max(10px, env(safe-area-inset-top)); }
      .pm-body { flex-direction: column; min-height: 0; }
      .pm-stage { min-height: 0; }
      .pm-list { width: auto; border-left: 0; border-top: 1px solid var(--border-subtle); flex-direction: row; flex-wrap: wrap; max-height: 26dvh; overflow-y: auto; }
      .pm-list-hd, .pm-search { width: 100%; }
      .pm-list-item { flex: 0 1 auto; padding: 8px 10px; }
      .pm-controls { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
    }
  `]
})
export class PlateMeasureComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  private readonly cap = inject(CapacitorService);
  private readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  @Input() antibiotics: string[] = [];
  @Input() existingImageUrl?: string | null;
  /** Live interpretation: maps (antibiotic, zone mm) → S/I/R for colour-coding. */
  @Input() srI?: (antibiotic: string, zoneMm: number) => 'S' | 'I' | 'R' | '';

  @Output() applied = new EventEmitter<{ measurements: PlateMeasurement[]; imageUrl: string | null }>();
  @Output() cancel = new EventEmitter<void>();

  readonly fullscreen = signal(false);
  readonly mode = signal<Mode>('capture');
  readonly imageSrc = signal<string | null>(null);
  private photoBlob: Blob | null = null;
  private uploadedUrl: string | null = null;

  readonly natW = signal(0);
  readonly natH = signal(0);
  readonly dishMm = signal(90);
  readonly calPts = signal<Pt[]>([]);
  readonly activeIndex = signal(0);
  readonly busy = signal(false);
  readonly analyzing = signal(false);
  readonly search = signal('');

  readonly zones = signal<Zone[]>([]);
  readonly selected = signal(-1);
  private drag: { kind: DragKind; i: number; offx: number; offy: number } | null = null;
  history: Zone[][] = [];
  future: Zone[][] = [];
  readonly showHint = signal(typeof localStorage !== 'undefined' && !localStorage.getItem('pf-plate-hint'));
  private lastTap = { t: 0, i: -1 };
  private lastKeyEdit = 0;

  readonly dragAb = signal<{ index: number; x: number; y: number; moved: boolean } | null>(null);
  readonly dropTarget = signal(-1);

  // Zoom / pan
  readonly view = signal<Box>({ x: 0, y: 0, w: 1, h: 1 });
  readonly panMode = signal(false);
  private panning: Pt | null = null;
  private calDrag: number | null = null;   // index of the calibration endpoint being dragged
  private pointers = new Map<number, Pt>();
  private pinchDist = 0;
  private pinchMid: Pt | null = null;
  readonly loupe = signal<{ sx: number; sy: number; ix: number; iy: number } | null>(null);

  private readonly svgEl = viewChild<ElementRef<SVGSVGElement>>('svg');
  private readonly camEl = viewChild<ElementRef<HTMLVideoElement>>('cam');
  private readonly _camStream = signal<MediaStream | null>(null);
  readonly camStream = this._camStream.asReadonly();
  readonly camError = signal('');

  constructor() {
    effect(() => {
      const v = this.camEl()?.nativeElement;
      const s = this._camStream();
      if (v && s && v.srcObject !== s) { v.srcObject = s; v.play().catch(() => undefined); }
    });
  }

  ngOnInit() {
    try { document.body.appendChild(this.host.nativeElement); } catch { /* */ }
    if (this.existingImageUrl) {
      this.uploadedUrl = this.existingImageUrl;
      this.imageSrc.set(this.resolve(this.existingImageUrl));
      this.mode.set('calibrate');
      return;
    }
    if (!this.isNative()) void this.startCamera();
  }
  ngOnDestroy() { this.stopCamera(); try { this.host.nativeElement.remove(); } catch { /* */ } }
  close() { this.stopCamera(); this.cancel.emit(); }
  onBackdrop(_ev: Event) { /* explicit close only */ }

  isNative(): boolean { return this.platform.isCapacitor(); }
  readonly viewBox = computed(() => { const v = this.view(); return `${v.x} ${v.y} ${v.w} ${v.h}`; });
  /** viewBox-relative so handles/strokes stay ~constant on screen as you zoom. */
  readonly unit = computed(() => Math.max(this.view().w, this.view().h) / 220 || 1);

  stepHint(): string {
    switch (this.mode()) {
      case 'capture': return 'Step 1 — capture the plate';
      case 'calibrate': return 'Step 2 — auto-detect, or tap the two opposite rim edges';
      case 'measure': return 'Step 3 — fit each circle, then drag its antibiotic from the list';
    }
  }

  // ── Camera ───────────────────────────────────────────────────────
  async capturePhoto() { const d = await this.cap.captureImage(); if (d) await this.setFromDataUrl(d); }
  onFilePick(ev: Event) {
    const input = ev.target as HTMLInputElement; const f = input.files?.[0]; input.value = '';
    if (!f) return;
    this.stopCamera(); this.photoBlob = f; this.uploadedUrl = null;
    this.imageSrc.set(URL.createObjectURL(f)); this.mode.set('calibrate');
  }
  private async setFromDataUrl(dataUrl: string) {
    this.imageSrc.set(dataUrl); this.uploadedUrl = null; this.mode.set('calibrate');
    this.photoBlob = await (await fetch(dataUrl)).blob();
  }
  retake() {
    this.imageSrc.set(null); this.photoBlob = null; this.uploadedUrl = null;
    this.calPts.set([]); this.zones.set([]); this.selected.set(-1); this.history = []; this.future = [];
    this.mode.set('capture');
    if (!this.isNative()) void this.startCamera();
  }
  async startCamera() {
    this.camError.set('');
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) { this.camError.set('Camera not supported here — upload a photo instead.'); return; }
    try { this._camStream.set(await md.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })); }
    catch { this.camError.set('Camera unavailable or blocked — upload a photo instead.'); }
  }
  stopCamera() { const s = this._camStream(); if (s) { s.getTracks().forEach(t => t.stop()); this._camStream.set(null); } }
  captureFromVideo() {
    const v = this.camEl()?.nativeElement; if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas'); canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.drawImage(v, 0, 0); this.stopCamera();
    void this.setFromDataUrl(canvas.toDataURL('image/jpeg', 0.92));
  }
  onImgLoad(ev: Event) {
    const img = ev.target as HTMLImageElement;
    this.natW.set(img.naturalWidth); this.natH.set(img.naturalHeight);
    this.view.set({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
    if (this.mode() === 'capture') this.mode.set('calibrate');
  }

  // ── Calibration ──────────────────────────────────────────────────
  readonly calibrated = computed(() => this.calPts().length === 2);
  readonly mmPerPx = computed(() => {
    const p = this.calPts(); if (p.length !== 2) return 0;
    const px = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    return px > 0 ? this.dishMm() / px : 0;
  });
  resetCalibration() { this.calPts.set([]); }
  goMeasure() { if (this.calibrated()) this.mode.set('measure'); }

  // ── Auto-detect ──────────────────────────────────────────────────
  async autoDetect() {
    const blob = this.photoBlob;
    if (!blob) { this.toasts.error('Take or upload a photo first.'); return; }
    this.analyzing.set(true);
    try {
      const fd = new FormData(); fd.append('file', blob, 'plate.jpg'); fd.append('dishMm', String(this.dishMm()));
      const resp = await firstValueFrom(this.http.post<{ success: boolean; data?: PlateAnalysis; message?: string }>(`${this.platform.getApiUrl()}/api/microbiology/analyze-plate`, fd));
      const data = resp?.data;
      if (!resp?.success || !data?.dish) { this.toasts.error(resp?.message || 'Could not find the dish — calibrate and measure manually.'); return; }
      this.snapshot();
      const d = data.dish;
      this.calPts.set([{ x: d.cx - d.r, y: d.cy }, { x: d.cx + d.r, y: d.cy }]);
      this.zones.set((data.zones ?? []).map(z => ({ cx: z.cx, cy: z.cy, r: z.r, abIndex: null, auto: true, conf: z.confidence } as Zone)));
      this.selected.set(-1); this.mode.set('measure');
      const n = this.zones().length;
      if (n) this.toasts.success(`Detected ${n} zone${n === 1 ? '' : 's'} — fit each, then drag its antibiotic on.`);
      else this.toasts.warning('Dish calibrated, but no zones detected — draw them manually.');
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    finally { this.analyzing.set(false); }
  }

  // ── Zoom / pan ───────────────────────────────────────────────────
  private toLocal(svg: SVGSVGElement, clientX: number, clientY: number): Pt | null {
    const ctm = svg.getScreenCTM(); if (!ctm) return null;
    const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }
  private zoomAt(factor: number, clientX: number, clientY: number) {
    const svg = this.svgEl()?.nativeElement; if (!svg) return;
    const p = this.toLocal(svg, clientX, clientY); if (!p) return;
    const v = this.view(), W = this.natW(), H = this.natH();
    let nw = v.w / factor; nw = Math.min(W, Math.max(W * 0.08, nw)); const nh = nw * (H / W);
    let nx = p.x - (p.x - v.x) * (nw / v.w), ny = p.y - (p.y - v.y) * (nh / v.h);
    nx = Math.min(W - nw, Math.max(0, nx)); ny = Math.min(H - nh, Math.max(0, ny));
    this.view.set({ x: nx, y: ny, w: nw, h: nh });
  }
  onWheel(ev: WheelEvent) { ev.preventDefault(); this.zoomAt(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX, ev.clientY); }
  zoomBtn(factor: number) { const svg = this.svgEl()?.nativeElement; const r = svg?.getBoundingClientRect(); if (r) this.zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2); }
  resetView() { this.view.set({ x: 0, y: 0, w: this.natW(), h: this.natH() }); }
  private panByClient(dx: number, dy: number) {
    const svg = this.svgEl()?.nativeElement; if (!svg) return;
    const ctm = svg.getScreenCTM(); if (!ctm) return;
    const v = this.view(), W = this.natW(), H = this.natH();
    const nx = Math.min(W - v.w, Math.max(0, v.x - dx / ctm.a));
    const ny = Math.min(H - v.h, Math.max(0, v.y - dy / ctm.d));
    this.view.set({ ...v, x: nx, y: ny });
  }

  // ── Circle editing + multi-touch ─────────────────────────────────
  private capture(el: Element, ev: PointerEvent) { try { el.setPointerCapture(ev.pointerId); } catch { /* */ } }

  onDown(ev: PointerEvent) {
    const svg = ev.currentTarget as SVGSVGElement;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pointers.size === 2) { this.drag = null; this.panning = null; this.loupe.set(null); this.startPinch(); this.capture(svg, ev); return; }

    const p = this.toLocal(svg, ev.clientX, ev.clientY); if (!p) return;

    // Calibration endpoints are draggable in BOTH modes — fine-tuning the dish
    // line re-calibrates px→mm and updates every zone's mm live.
    const cps = this.calPts();
    if (cps.length === 2) {
      const ct = this.unit() * 5;
      for (let k = 0; k < 2; k++) {
        if (Math.hypot(p.x - cps[k].x, p.y - cps[k].y) <= ct) { this.calDrag = k; this.setLoupe(ev.clientX, ev.clientY, p); this.capture(svg, ev); return; }
      }
    }

    if (this.mode() === 'calibrate') { this.calPts.set(this.calPts().length >= 2 ? [p] : [...this.calPts(), p]); return; }
    if (this.mode() !== 'measure') return;
    if (this.panMode()) { this.panning = { x: ev.clientX, y: ev.clientY }; this.capture(svg, ev); return; }

    const tol = this.unit() * 5, zs = this.zones(), sel = this.selected();
    if (sel >= 0 && sel < zs.length) {
      const z = zs[sel];
      if (Math.hypot(p.x - (z.cx + z.r * 0.71), p.y - (z.cy - z.r * 0.71)) <= this.unit() * 3.6) { this.snapshot(); this.deleteSelected(); return; }
    }
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i], d = Math.hypot(p.x - z.cx, p.y - z.cy);
      const center = d <= Math.max(tol, this.unit() * 2), edge = Math.abs(d - z.r) <= tol;
      if (!center && !edge) continue;
      // Double-tap a circle → snap-to-fit (backend refines it to the local edge).
      const now = Date.now();
      if (this.lastTap.i === i && now - this.lastTap.t < 350) { this.lastTap = { t: 0, i: -1 }; void this.refineZone(i); return; }
      this.lastTap = { t: now, i };
      this.snapshot(); this.selected.set(i);
      this.drag = center ? { kind: 'move', i, offx: p.x - z.cx, offy: p.y - z.cy } : { kind: 'resize', i, offx: 0, offy: 0 };
      this.setLoupe(ev.clientX, ev.clientY, p); this.capture(svg, ev); return;
    }
    this.snapshot();
    const next = [...zs, { cx: p.x, cy: p.y, r: 0, abIndex: null, auto: false } as Zone];
    this.zones.set(next); this.selected.set(next.length - 1);
    this.drag = { kind: 'create', i: next.length - 1, offx: 0, offy: 0 };
    this.setLoupe(ev.clientX, ev.clientY, p); this.capture(svg, ev);
  }

  onMove(ev: PointerEvent) {
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pointers.size >= 2) { this.doPinch(); return; }
    if (this.calDrag != null) {
      const p = this.toLocal(ev.currentTarget as SVGSVGElement, ev.clientX, ev.clientY);
      if (p) { const k = this.calDrag; this.calPts.update(c => c.map((pt, j) => j === k ? p : pt)); this.setLoupe(ev.clientX, ev.clientY, p); }
      return;
    }
    if (this.panning) { this.panByClient(ev.clientX - this.panning.x, ev.clientY - this.panning.y); this.panning = { x: ev.clientX, y: ev.clientY }; return; }
    if (!this.drag || this.mode() !== 'measure') return;
    const p = this.toLocal(ev.currentTarget as SVGSVGElement, ev.clientX, ev.clientY); if (!p) return;
    const i = this.drag.i;
    this.zones.update(zs => zs.map((z, k) => {
      if (k !== i) return z;
      if (this.drag!.kind === 'move') return { ...z, cx: p.x - this.drag!.offx, cy: p.y - this.drag!.offy };
      return { ...z, r: Math.max(1, Math.hypot(p.x - z.cx, p.y - z.cy)) };
    }));
    this.setLoupe(ev.clientX, ev.clientY, p);
  }

  onUp(ev: PointerEvent) {
    this.pointers.delete(ev.pointerId);
    if (this.pointers.size < 2) { this.pinchDist = 0; this.pinchMid = null; }
    this.panning = null; this.calDrag = null; this.loupe.set(null);
    if (!this.drag) return;
    const { kind, i } = this.drag; this.drag = null;
    if (kind === 'create' && (this.zones()[i]?.r ?? 0) < this.unit() * 2) {
      this.zones.update(zs => zs.filter((_, k) => k !== i)); this.selected.set(-1);
    }
  }

  private startPinch() {
    const pts = [...this.pointers.values()];
    this.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    this.pinchMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
  private doPinch() {
    const pts = [...this.pointers.values()]; if (pts.length < 2) return;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    if (this.pinchDist > 0) {
      this.zoomAt(dist / this.pinchDist, mid.x, mid.y);
      if (this.pinchMid) this.panByClient(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y);
    }
    this.pinchDist = dist; this.pinchMid = mid;
  }
  private setLoupe(sx: number, sy: number, img: Pt) { this.loupe.set({ sx, sy, ix: img.x, iy: img.y }); }

  // ── Antibiotic drag-drop ─────────────────────────────────────────
  readonly filteredAbs = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.antibiotics.map((name, i) => ({ name, i })).filter(a => !q || (a.name || '').toLowerCase().includes(q));
  });
  abDown(ev: PointerEvent, index: number) {
    this.activeIndex.set(index);
    this.dragAb.set({ index, x: ev.clientX, y: ev.clientY, moved: false });
    this.capture(ev.currentTarget as Element, ev);
  }
  abMove(ev: PointerEvent) {
    const d = this.dragAb(); if (!d) return;
    this.dragAb.set({ ...d, x: ev.clientX, y: ev.clientY, moved: true });
    this.dropTarget.set(this.zoneAtClient(ev.clientX, ev.clientY));
  }
  abUp(ev: PointerEvent) {
    const d = this.dragAb(); if (!d) return;
    this.dragAb.set(null); this.dropTarget.set(-1);
    const zi = this.zoneAtClient(ev.clientX, ev.clientY);
    if (zi >= 0) this.assignAbToZone(d.index, zi);
    else if (!d.moved && this.selected() >= 0) this.assignAbToZone(d.index, this.selected());
  }
  private zoneAtClient(clientX: number, clientY: number): number {
    const svg = this.svgEl()?.nativeElement; if (!svg) return -1;
    const p = this.toLocal(svg, clientX, clientY); if (!p) return -1;
    const zs = this.zones(); let best = -1, bestD = Infinity;
    for (let i = 0; i < zs.length; i++) {
      const dd = Math.hypot(p.x - zs[i].cx, p.y - zs[i].cy);
      if (dd <= zs[i].r * 1.15 && dd < bestD) { best = i; bestD = dd; }
    }
    return best;
  }
  private assignAbToZone(abIndex: number, zoneIdx: number) {
    this.snapshot();
    this.zones.update(zs => zs.map((z, k) => {
      if (k === zoneIdx) return { ...z, abIndex };
      if (z.abIndex === abIndex) return { ...z, abIndex: null };
      return z;
    }));
    this.selected.set(zoneIdx);
    void this.cap.impact();
  }
  unassign(i: number) { this.snapshot(); this.zones.update(zs => zs.map(z => z.abIndex === i ? { ...z, abIndex: null } : z)); }
  deleteSelected() { const sel = this.selected(); if (sel < 0) return; this.snapshot(); this.zones.update(zs => zs.filter((_, k) => k !== sel)); this.selected.set(-1); }

  // ── Undo / redo / clear ──────────────────────────────────────────
  private snapshot() { this.history.push(this.zones().map(z => ({ ...z }))); if (this.history.length > 40) this.history.shift(); this.future = []; }
  undo() { const prev = this.history.pop(); if (!prev) return; this.future.push(this.zones().map(z => ({ ...z }))); this.zones.set(prev); this.selected.set(-1); }
  redo() { const nxt = this.future.pop(); if (!nxt) return; this.history.push(this.zones().map(z => ({ ...z }))); this.zones.set(nxt); this.selected.set(-1); }
  clearAll() { if (!this.zones().length) return; this.snapshot(); this.zones.set([]); this.selected.set(-1); }

  // ── Snap-to-fit (double-tap a circle) ────────────────────────────
  async refineZone(i: number) {
    const z = this.zones()[i]; if (!z || !this.photoBlob) return;
    const mmpp = this.mmPerPx();
    if (!mmpp) { this.toasts.warning('Calibrate the dish first.'); return; }
    try {
      const fd = new FormData();
      fd.append('file', this.photoBlob, 'plate.jpg');
      fd.append('seedX', String(z.cx)); fd.append('seedY', String(z.cy)); fd.append('mmPerPx', String(mmpp));
      const resp = await firstValueFrom(this.http.post<{ success: boolean; data?: { cx: number; cy: number; r: number } | null }>(
        `${this.platform.getApiUrl()}/api/microbiology/refine-zone`, fd));
      const c = resp?.data;
      if (resp?.success && c && c.r > 0) {
        this.snapshot();
        this.zones.update(zs => zs.map((zz, k) => k === i ? { ...zz, cx: c.cx, cy: c.cy, r: c.r } : zz));
        this.selected.set(i); void this.cap.impact();
      } else { this.toasts.warning('Could not snap — adjust the circle manually.'); }
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
  }

  // ── Keyboard (desktop power-use) ─────────────────────────────────
  onKey(ev: KeyboardEvent) {
    const tag = (ev.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ctrl && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? this.redo() : this.undo(); return; }
    if (ctrl && ev.key.toLowerCase() === 'y') { ev.preventDefault(); this.redo(); return; }
    if (this.mode() !== 'measure') return;
    const sel = this.selected();
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel >= 0) { ev.preventDefault(); this.snapshot(); this.deleteSelected(); return; }
    if (sel < 0) return;
    const step = ev.shiftKey ? 5 : 1;
    let dx = 0, dy = 0, dr = 0;
    switch (ev.key) {
      case 'ArrowLeft': dx = -step; break; case 'ArrowRight': dx = step; break;
      case 'ArrowUp': dy = -step; break; case 'ArrowDown': dy = step; break;
      case '[': dr = -step; break; case ']': dr = step; break;
      default: return;
    }
    ev.preventDefault();
    const now = Date.now();
    if (now - this.lastKeyEdit > 600) this.snapshot();   // debounce history during a burst
    this.lastKeyEdit = now;
    this.zones.update(zs => zs.map((z, k) => k === sel ? { ...z, cx: z.cx + dx, cy: z.cy + dy, r: Math.max(1, z.r + dr) } : z));
  }

  // ── Smart-fill (propose antibiotic mapping by reading order) ─────
  smartFill() {
    const zs = this.zones();
    const unassigned = zs.filter(z => z.abIndex == null);
    if (!unassigned.length) return;
    this.snapshot();
    const rowTol = (this.natH() || 100) * 0.06;
    const order = zs.map((z, i) => ({ z, i })).sort((a, b) =>
      Math.abs(a.z.cy - b.z.cy) > rowTol ? a.z.cy - b.z.cy : a.z.cx - b.z.cx);
    const used = new Set(zs.map(z => z.abIndex).filter((v): v is number => v != null));
    const map = new Map<number, number>();
    let next = 0;
    for (const { z, i } of order) {
      if (z.abIndex != null) continue;
      while (next < this.antibiotics.length && used.has(next)) next++;
      if (next >= this.antibiotics.length) break;
      map.set(i, next); used.add(next); next++;
    }
    this.zones.update(list => list.map((z, k) => map.has(k) ? { ...z, abIndex: map.get(k)! } : z));
    this.toasts.success('Proposed a mapping — check each and adjust.');
  }

  dismissHint() { try { localStorage.setItem('pf-plate-hint', '1'); } catch { /* */ } this.showHint.set(false); }

  // ── Derived / display ────────────────────────────────────────────
  mmOf(z: Zone): number { return Math.round(2 * z.r * this.mmPerPx()); }
  sirOf(z: Zone): 'S' | 'I' | 'R' | '' { return z.abIndex == null || !this.srI ? '' : this.srI(this.antibiotics[z.abIndex] ?? '', this.mmOf(z)); }
  sirLabel(z: Zone): string { const s = this.sirOf(z); return s === 'I' ? 'M' : s; }
  zoneFor(i: number): Zone | undefined { return this.zones().find(z => z.abIndex === i); }
  hasZone(i: number): boolean { return this.zones().some(z => z.abIndex === i); }
  mmFor(i: number): number { const z = this.zoneFor(i); return z ? this.mmOf(z) : 0; }
  lowConf(z: Zone): boolean { return z.abIndex == null && z.auto && (z.conf ?? 100) < 70; }
  abShort(i: number | null): string { if (i == null) return ''; const n = this.antibiotics[i] ?? ''; return n ? n.slice(0, 10) : '#' + (i + 1); }
  abLabel(i: number | null): string { if (i == null) return ''; const n = this.antibiotics[i] ?? ('#' + (i + 1)); return n.length > 16 ? n.slice(0, 15) + '…' : n; }
  zoneStroke(z: Zone): string {
    const s = this.sirOf(z);
    if (s === 'S') return '#10b981'; if (s === 'R') return '#ef4444'; if (s === 'I') return '#f59e0b';
    return z.abIndex == null ? '#f59e0b' : '#10b981';
  }
  zoneFill(i: number): string {
    if (i === this.dropTarget()) return 'rgba(124,58,237,0.25)';
    return i === this.selected() ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
  }
  readonly assignedCount = computed(() => this.zones().filter(z => z.abIndex != null && z.r > 0).length);
  readonly hasUnassigned = computed(() => this.zones().some(z => z.abIndex == null && z.r > 0));

  // ── Apply ────────────────────────────────────────────────────────
  async apply() {
    this.busy.set(true);
    try { if (this.photoBlob && !this.uploadedUrl) this.uploadedUrl = await this.upload(this.photoBlob); }
    catch (e) { this.toasts.error(ApiError.from(e).message); this.busy.set(false); return; }
    const measurements: PlateMeasurement[] = this.zones().filter(z => z.abIndex != null && z.r > 0).map(z => ({ index: z.abIndex as number, zoneMm: this.mmOf(z) }));
    this.applied.emit({ measurements, imageUrl: this.uploadedUrl });
    this.busy.set(false);
  }
  private async upload(blob: Blob): Promise<string> {
    const fd = new FormData(); fd.append('file', blob, 'plate.jpg');
    const resp = await firstValueFrom(this.http.post<{ success: boolean; data?: { url: string }; message?: string }>(`${this.platform.getApiUrl()}/api/uploads/culture-plate`, fd));
    if (!resp?.success || !resp.data?.url) throw new Error(resp?.message ?? 'upload failed');
    return resp.data.url;
  }
  private resolve(u: string): string {
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return u;
    return `${this.platform.getApiUrl()}${u}`;
  }
}
