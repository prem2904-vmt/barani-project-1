import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, computed, effect, inject, signal, viewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription, firstValueFrom } from 'rxjs';
import { PlatformService } from '../../../core/services/platform.service';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { ToastService } from '../../../core/services/toast.service';
import { PlateMeasurement, PlateMeasureSession } from '../../../shared/models/culture.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { LogoMarkComponent } from '../../../shared/primitives/logo-mark.component';
import { loadOpenCv } from './opencv-loader';
import { PlateVision, RejectedCircle } from './plate-detect';
import {
  Circle, DISK_MM, PLATE_SIZES, ScaleReport, consensusShape, ellipseRadiusAt, localDisk, measureZone,
  readingOrder, reconcileScale, scaleWarning, tiltCheck,
} from './plate-vision';
import { DiskCandidate, drugForCode, normCode, panelCandidates } from './disk-codes';
import { AiUsage, CodeSlot, DiskReadApi, aiFallbackMessage, buildMosaic, formatTokens, mapAiRead } from './disk-read';

type Pt = { x: number; y: number };
type Mode = 'capture' | 'calibrate' | 'measure' | 'review';
type Shape = { rx: number; ry: number; angle: number };
type Box = { x: number; y: number; w: number; h: number };
type DragKind = 'move' | 'resize' | 'create';

/** One paper disk on the plate (image px). The zone ring is the local
 *  ruler ellipse × k — k = 1 is "no zone" (6 mm). */
export interface DiskRow extends CodeSlot {
  n: number;
  cx: number; cy: number;
  own: Shape;          // the paper's fitted outline
  ruler: Shape;        // local 6 mm ruler (own + neighbours' size + shape)
  k: number;           // zone radius in ruler units → mm = 6·k
  zoneFound: boolean;
}

type PlateState = 'idle' | 'loading' | 'finding' | 'found' | 'not-found' | 'unavailable' | 'load-failed';
type AiState = 'idle' | 'pending' | 'done' | 'failed';

const NOT_A_DISK = '__not_a_disk';

/**
 * Measure zones from plate. Capture → Calibrate → Measure & read → Review.
 *
 * OpenCV.js (lazy, from the CDN) does ALL the measuring: the plate rim, the
 * paper disks (glare filtered), every disk as a 6 mm ruler (local tilt
 * correction), zone diameters by radial profile. ONE background AI call
 * reads the printed disk codes off a mosaic — suggestions only. Nothing
 * reaches the AST table until the technician presses Apply.
 */
@Component({
  selector: 'pf-plate-measure',
  standalone: true,
  imports: [SelectComponent, LogoMarkComponent],
  host: { '(window:keydown)': 'onKey($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pm-backdrop" [class.pm-backdrop--full]="fullscreen()">
      <div class="pm-panel nd-sheet" [class.pm-panel--full]="fullscreen()" role="dialog" aria-modal="true"
           aria-label="Measure zones from plate" (click)="$event.stopPropagation()">
        <span class="nd-sheet__handle" aria-hidden="true"></span>
        <div class="pm-head">
          <span class="nd-card__icon pm-head__ico" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/></svg>
          </span>
          <span class="nd-card__label pm-head__label">Measure zones</span>
          <span class="pm-head__grow"></span>
          <button type="button" class="pm-icon" (click)="fullscreen.set(!fullscreen())"
                  [attr.aria-label]="fullscreen() ? 'Exit full screen' : 'Full screen'" [title]="fullscreen() ? 'Exit full screen' : 'Full screen'">
            @if (fullscreen()) {
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3v6H3"/><path d="M15 21v-6h6"/><path d="M3 15h6v6"/><path d="M21 9h-6V3"/></svg>
            } @else {
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
            }
          </button>
          <button type="button" class="pm-icon pm-x" (click)="close()" aria-label="Close" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="pm-titles">
          <h2 class="pm-title">Measure zones from plate</h2>
          <ol class="pm-steps" aria-label="Steps">
            @for (st of steps; track st.key; let si = $index) {
              <li class="pm-step" [attr.data-state]="stepState(si)" [attr.aria-current]="stepState(si) === 'active' ? 'step' : null">
                <span class="pm-step__dot" aria-hidden="true">
                  @if (stepState(si) === 'done') {
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  }
                </span>
                <span class="pm-step__lbl">{{ st.label }}</span>
              </li>
            }
          </ol>
          <p class="pm-sub">Step {{ stepIndex() + 1 }} of {{ steps.length }} · {{ stepHint() }}</p>
        </div>

        @if (mode() === 'capture') {
          <div class="pm-capture">
            @if (!isNative() && camStream()) {
              <div class="pm-camwrap">
                <video #cam class="pm-cam" autoplay playsinline muted></video>
                <svg class="pm-guide" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                  <path d="M0 0H400V300H0Z M200 150 m-122 0 a122 122 0 1 0 244 0 a122 122 0 1 0 -244 0 Z"
                        fill="rgba(0,0,0,0.45)" fill-rule="evenodd"/>
                  <circle class="pm-reticle" cx="200" cy="150" r="122" fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="1.5"/>
                  <g class="pm-sweep"><circle cx="200" cy="150" r="122" fill="none" stroke="#a78bfa" stroke-width="2.5"
                          stroke-linecap="round" stroke-dasharray="70 697" opacity="0.9"/></g>
                  <path class="pm-cross" d="M192 150h16M200 142v16" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                @if (tilt() !== null) {
                  <div class="pm-level" [class.pm-level--ok]="tiltOk()" [title]="tiltOk() ? 'Level' : 'Tilt the phone flat'">
                    <span class="pm-level__bubble" [style.transform]="bubbleTransform()"></span>
                  </div>
                }
              </div>
              <p class="pm-hinttext">
                {{ tilt() === null ? 'Fit the whole dish inside the circle, straight from above, then capture.'
                   : (tiltOk() ? 'Level — fit the dish inside the circle, then capture.' : 'Tilt the phone flat — shoot straight down at the plate.') }}
              </p>
              <div class="pm-actions">
                <button type="button" class="nd-btn nd-btn--primary pm-btn pm-btn--primary" (click)="captureFromVideo()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v11H4V7z"/><path d="M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>
                  Capture
                </button>
                <label class="nd-btn nd-btn--secondary pm-btn pm-btn--ghost">Upload a photo instead
                  <input type="file" accept="image/png,image/jpeg,image/webp" (change)="onFilePick($event)" hidden /></label>
              </div>
            } @else {
              <svg class="pm-capture__ico" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 7h4l2-3h4l2 3h4v11H4V7z"/><path d="M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>
              </svg>
              <p class="pm-hinttext pm-hinttext--lead">Take a clear photo of the plate from directly above, with the whole dish in frame.</p>
              @if (camError()) { <p class="pm-hinttext">{{ camError() }}</p> }
              <div class="pm-actions">
                @if (isNative()) { <button type="button" class="nd-btn nd-btn--primary pm-btn pm-btn--primary" (click)="capturePhoto()">Take photo</button> }
                @else { <button type="button" class="nd-btn nd-btn--primary pm-btn pm-btn--primary" (click)="startCamera()">Open camera</button> }
                <label class="nd-btn nd-btn--secondary pm-btn pm-btn--ghost">{{ isNative() ? 'Choose from gallery' : 'Upload a photo' }}
                  <input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" (change)="onFilePick($event)" hidden /></label>
              </div>
            }
          </div>
        }

        @if (mode() !== 'capture' && imageSrc()) {
          <div class="pm-body" [class.pm-body--cal]="mode() === 'calibrate'">
            <div class="pm-stage nd-ai-glow nd-ai-glow--inset" [attr.data-ai-working]="aiWorking() ? 'true' : null">
              <img #img class="pm-dim" [src]="imageSrc()" (load)="onImgLoad($event)" alt="" />
              <svg #svg class="pm-svg" [attr.viewBox]="viewBox()" preserveAspectRatio="xMidYMid meet"
                   role="img" [attr.aria-label]="stageLabel()"
                   (pointerdown)="onDown($event)" (pointermove)="onMove($event)" (pointerup)="onUp($event)" (pointercancel)="onUp($event)" (wheel)="onWheel($event)">
                <image [attr.href]="imageSrc()" x="0" y="0" [attr.width]="natW()" [attr.height]="natH()" preserveAspectRatio="none"></image>
                @if (plateCircle(); as pc) {
                  @if (mode() === 'calibrate') {
                    <circle class="pm-plate" [attr.cx]="pc.cx" [attr.cy]="pc.cy" [attr.r]="pc.r" fill="none" stroke="#a78bfa"
                            [attr.stroke-width]="unit() * 0.8" [attr.stroke-dasharray]="(unit()*3) + ' ' + (unit()*2)" />
                  }
                }
                @if (mode() === 'calibrate') {
                  @if (calPts().length === 2) {
                    <line [attr.x1]="calPts()[0].x" [attr.y1]="calPts()[0].y" [attr.x2]="calPts()[1].x" [attr.y2]="calPts()[1].y"
                          stroke="#a78bfa" [attr.stroke-width]="unit()*0.6" />
                    <text class="pm-svgtxt" [attr.x]="(calPts()[0].x + calPts()[1].x)/2" [attr.y]="(calPts()[0].y + calPts()[1].y)/2 - unit()*1.5" fill="#ffffff"
                          stroke="rgba(15,17,24,0.8)" [attr.stroke-width]="unit()*0.7" style="paint-order: stroke;"
                          [attr.font-size]="unit()*3.2" text-anchor="middle" font-weight="600">{{ dishMm() }} mm</text>
                  }
                  @for (p of calPts(); track $index) {
                    <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="unit()*2.4" fill="rgba(167,139,250,0.25)" stroke="#a78bfa" [attr.stroke-width]="unit()*0.6" />
                    <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="unit()*0.9" fill="#a78bfa" />
                  }
                }

                @if (mode() === 'measure' || mode() === 'review') {
                  @if (showRejected()) {
                    @for (rj of rejected(); track $index) {
                      <circle class="pm-rej" [attr.cx]="rj.cx" [attr.cy]="rj.cy" [attr.r]="rj.r" fill="none" stroke="rgba(255,255,255,0.55)"
                              [attr.stroke-width]="unit()*0.5" [attr.stroke-dasharray]="(unit()*1.4) + ' ' + (unit()*1.2)" />
                    }
                  }
                  @for (d of rows(); track d.id) {
                    <g class="pm-disk" [attr.data-n]="d.n" [attr.opacity]="d.notDisk ? 0.45 : 1">
                      <ellipse class="pm-ring" [attr.cx]="d.cx" [attr.cy]="d.cy" [attr.rx]="d.ruler.rx * d.k" [attr.ry]="d.ruler.ry * d.k"
                               [attr.transform]="'rotate(' + deg(d.ruler.angle) + ' ' + d.cx + ' ' + d.cy + ')'"
                               [attr.fill]="d.id === selectedId() ? 'rgba(167,139,250,0.10)' : 'transparent'"
                               [attr.stroke]="ringStroke(d)" [attr.stroke-width]="d.id === selectedId() ? unit()*1.1 : unit()*0.6" />
                      @if (d.id === selectedId() && mode() === 'measure') {
                        <circle [attr.cx]="d.cx + ringR(d, 0)" [attr.cy]="d.cy" [attr.r]="unit()*1.6" fill="#ffffff" stroke="#7c3aed" [attr.stroke-width]="unit()*0.5" />
                        <circle [attr.cx]="d.cx + ringR(d, -0.785) * 0.707" [attr.cy]="d.cy - ringR(d, -0.785) * 0.707" [attr.r]="unit()*2.6" fill="#7c3aed" stroke="#fff" [attr.stroke-width]="unit()*0.5" />
                        <path [attr.d]="delPath(d)" stroke="#fff" [attr.stroke-width]="unit()*0.6" stroke-linecap="round" />
                      }
                      <!-- numbered neutral badge -->
                      <circle class="pm-badge nd-ai-glow-mark" [attr.data-ai-working]="isPending(d) ? 'true' : null" [attr.cx]="badgeX(d)" [attr.cy]="badgeY(d)" [attr.r]="unit()*2.7" fill="#ffffff" stroke="rgba(15,17,24,0.35)" [attr.stroke-width]="unit()*0.3" />
                      <text class="pm-svgtxt" [attr.x]="badgeX(d)" [attr.y]="badgeY(d)" dominant-baseline="central" text-anchor="middle"
                            [attr.font-size]="unit()*3" font-weight="600" fill="#111827">{{ d.n }}</text>
                      <!-- mm label chip -->
                      @if (!d.notDisk) {
                        <rect class="pm-mmchip" [attr.x]="d.cx - unit()*5.2" [attr.y]="d.cy + ringR(d, 1.571) + unit()*0.8" [attr.width]="unit()*10.4" [attr.height]="unit()*4.2" [attr.rx]="unit()*2.1"
                              [attr.fill]="chipFill(d)" />
                        <text class="pm-svgtxt" [attr.x]="d.cx" [attr.y]="d.cy + ringR(d, 1.571) + unit()*2.9" dominant-baseline="central" text-anchor="middle"
                              [attr.font-size]="unit()*2.8" font-weight="600" fill="#ffffff">{{ mmOf(d) }} mm</text>
                      }
                    </g>
                  }
                }
              </svg>

              @if (loupe(); as lp) {
                <div class="pm-loupe" [style.left.px]="lp.sx - 130" [style.top.px]="lp.sy - 130"
                     [style.background-image]="'url(' + imageSrc() + ')'"
                     [style.background-size.px]="natW()*4" [style.background-position]="(-(lp.ix*4 - 55)) + 'px ' + (-(lp.iy*4 - 55)) + 'px'">
                  <span class="pm-loupe-x"></span>
                </div>
              }

              @if (mode() === 'measure') {
                <div class="pm-toolbar" role="toolbar" aria-label="View">
                  <button type="button" class="pm-tool" [attr.aria-pressed]="panMode()" (click)="panMode.set(!panMode())" aria-label="Pan" title="Pan">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9l-3 3 3 3"/><path d="M9 5l3-3 3 3"/><path d="M15 19l-3 3-3-3"/><path d="M19 9l3 3-3 3"/><path d="M2 12h20"/><path d="M12 2v20"/></svg>
                  </button>
                  <button type="button" class="pm-tool" (click)="zoomBtn(1.3)" aria-label="Zoom in" title="Zoom in">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                  <button type="button" class="pm-tool" (click)="zoomBtn(1/1.3)" aria-label="Zoom out" title="Zoom out">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>
                  </button>
                  <button type="button" class="pm-tool" (click)="resetView()" aria-label="Fit" title="Fit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
                  </button>
                  <span class="pm-tool-sep"></span>
                  <button type="button" class="pm-tool" [disabled]="history.length === 0" (click)="undo()" aria-label="Undo" title="Undo">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>
                  </button>
                  <button type="button" class="pm-tool" [disabled]="future.length === 0" (click)="redo()" aria-label="Redo" title="Redo">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>
                  </button>
                </div>
              }

              @if (busyMsg()) {
                <div class="pm-busy" role="status"><span class="pm-busy__dot" aria-hidden="true"></span>{{ busyMsg() }}</div>
              }

              @if (showHint() && mode() === 'measure') {
                <div class="pm-hint" (click)="dismissHint()">
                  <div class="pm-hint-card" (click)="$event.stopPropagation()">
                    <div class="pm-hint-title">Quick guide</div>
                    <ul class="pm-hint-list">
                      <li><b>Drag a ring's edge</b> to fit the zone · its centre to move it</li>
                      <li><b>Double-tap</b> a ring to re-measure it</li>
                      <li><b>Tap an empty spot</b> and drag to add a missed disk</li>
                      <li><b>Pinch / scroll</b> to zoom · Pan to move around</li>
                      <li>Codes fill in while you work — tap one to change it</li>
                    </ul>
                    <button type="button" class="nd-btn nd-btn--secondary pm-btn pm-btn--wide" (click)="dismissHint()">Got it</button>
                  </div>
                </div>
              }
            </div>

            @if (mode() === 'measure' || mode() === 'review') {
              <aside class="pm-list nd-ai-glow nd-ai-glow--inset" aria-label="Disks" [attr.data-ai-working]="aiWorking() ? 'true' : null">
               <div class="pm-list__in">
                <div class="pm-list__hd">
                  <span class="pm-list__ttl">{{ mode() === 'review' ? 'Review' : 'Disks' }}</span>
                  @if (aiWorking()) {
                    <span class="pm-sense nd-ai-glow" data-ai-working="true" role="status">
                      <span class="pm-pf" aria-hidden="true"><pf-logo-mark variant="mono" size="xs" aria-hidden="true" /></span>
                      PF Sense · {{ aiSlow() ? 'still reading…' : 'reading…' }}
                    </span>
                  }
                  <span class="pm-list__count nd-num">{{ activeRows().length }} {{ activeRows().length === 1 ? 'disk' : 'disks' }}</span>
                </div>
                @if (manualHint(); as hint) {
                  <div class="pm-note pm-note--manual" role="status">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    <span class="pm-note__t">{{ hint }}</span>
                  </div>
                } @else if (aiLine()) {
                  <p class="pm-status" [attr.data-ai]="ai()">{{ aiLine() }}</p>
                }
                @for (w of warnings(); track w.text) {
                  <div class="pm-note" role="note">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>
                    <span class="pm-note__t">{{ w.text }}</span>
                    @if (w.action === 'dish' && scale()?.suggestedDishMm; as s) {
                      <button type="button" class="nd-btn nd-btn--tertiary pm-note__btn" (click)="setDish(s)">Use {{ s }} mm</button>
                    } @else if (w.action === 'retake') {
                      <button type="button" class="nd-btn nd-btn--tertiary pm-note__btn" (click)="retake()">Retake</button>
                    }
                  </div>
                }
                <ul class="pm-disks">
                  @for (d of rows(); track d.id) {
                    <li class="pm-drow" [attr.aria-selected]="d.id === selectedId()" [class.pm-drow--off]="d.notDisk" [class.pm-drow--settle]="justRead().has(d.id)"
                        [attr.data-n]="d.n" (click)="select(d.id)">
                      <span class="pm-drow__n nd-num" aria-hidden="true">{{ d.n }}</span>
                      <div class="pm-drow__code">
                        <div class="pm-drow__pick">
                          <pf-select class="pm-codesel nd-ai-glow nd-ai-glow--ring" [attr.data-ai-working]="isPending(d) ? 'true' : null" [class.pm-codesel--pending]="isPending(d)" [class.pm-codesel--set]="!!d.code || d.notDisk"
                                     [options]="codeOptions().get(d.id) ?? []" [value]="codeValue(d)" [searchable]="true" size="sm"
                                     [placeholder]="isPending(d) ? (aiSlow() ? 'Still reading…' : 'Reading…') : 'Unknown — tap to pick'"
                                     [attr.aria-label]="'Disk ' + d.n + ' code'"
                                     (valueChange)="pickCode(d.id, $any($event))"></pf-select>
                          @if (d.codeSrc === 'ai' && d.code) {
                            <span class="pm-pf" role="img" aria-label="Read by PF Sense" title="Read by PF Sense — check it"><pf-logo-mark variant="mono" size="xs" aria-hidden="true" /></span>
                          }
                        </div>
                        @if (!d.code && !d.notDisk && d.suggested) {
                          <button type="button" class="pm-sug" (click)="$event.stopPropagation(); pickCode(d.id, d.suggested)"
                                  [attr.aria-label]="'Probably ' + d.suggested + ' — confirm for disk ' + d.n">
                            <span class="pm-sug__t">Probably <b class="nd-num">{{ d.suggested }}</b></span>
                            <span class="pm-sug__ok">Confirm</span>
                          </button>
                        }
                        @if (mode() === 'review' && !d.notDisk) {
                          <span class="pm-drow__drug" [class.pm-drow__drug--none]="!drugOf(d)">{{ drugOf(d) || 'Not applied — pick a code' }}</span>
                        }
                      </div>
                      @if (!d.notDisk) {
                        @if (mode() === 'measure') {
                          <label class="pm-drow__mm" (click)="$event.stopPropagation()">
                            <input class="pm-mm nd-num" type="text" inputmode="decimal" [value]="mmOf(d)"
                                   [attr.aria-label]="'Zone for disk ' + d.n + ' in mm'"
                                   (focus)="select(d.id)" (change)="setMm(d.id, $any($event.target).value)"
                                   (keydown.enter)="nextMm($event)" />
                            <span class="pm-mm__u">mm</span>
                          </label>
                        } @else {
                          <span class="pm-drow__mmro nd-num">{{ mmOf(d) }} mm</span>
                        }
                        <span class="pm-sir" [attr.data-sir]="sirOf(d) || null" [attr.aria-label]="sirOf(d) ? 'Result ' + sirWord(d) : 'No result'">{{ sirOf(d) || '–' }}</span>
                      }
                    </li>
                  } @empty {
                    <li class="pm-empty">No disks found. Tap each disk on the plate to add it.</li>
                  }
                </ul>
                @if (usageLine()) { <p class="pm-usage nd-num">{{ usageLine() }}</p> }
               </div>
              </aside>
            }
          </div>
        }

        @if (mode() === 'calibrate') {
          <div class="pm-controls">
            <div class="pm-calrow">
              <span class="pm-calrow__lbl" id="pm-dish-lbl">Plate size</span>
              <div class="nd-seg pm-seg" role="radiogroup" aria-labelledby="pm-dish-lbl">
                @for (s of plateSizes; track s) {
                  <button type="button" class="nd-seg__item nd-num" role="radio" [attr.aria-checked]="dishMm() === s" (click)="setDish(s)">{{ s }} mm</button>
                }
              </div>
            </div>
            <p class="pm-hinttext" role="status">{{ plateLine() }}</p>
            <div class="pm-row">
              <button type="button" class="nd-btn nd-btn--secondary pm-btn" (click)="resetCalibration()">Re-tap rim</button>
              <button type="button" class="nd-btn nd-btn--primary pm-btn pm-btn--primary" [disabled]="!calibrated() || measuring()" (click)="goMeasure()">{{ measuring() ? 'Measuring…' : 'Measure' }}</button>
            </div>
          </div>
        }

        @if (mode() === 'measure') {
          <div class="pm-controls">
            <div class="pm-row pm-row--wrap">
              <button type="button" class="nd-toggle pm-rejtoggle" role="switch" [attr.aria-checked]="showRejected()" (click)="showRejected.set(!showRejected())">
                <span class="nd-toggle__track"><span class="nd-toggle__knob"></span></span>
                <span><span class="pm-wide">Show rejected</span><span class="pm-narrow">Rejected</span>{{ rejected().length ? ' (' + rejected().length + ')' : '' }}</span>
              </button>
              <span class="pm-grow"></span>
              <button type="button" class="nd-btn nd-btn--secondary pm-btn pm-btn--aux" (click)="recalibrate()">Recalibrate</button>
              <button type="button" class="nd-btn nd-btn--secondary pm-btn pm-btn--aux" (click)="retake()">Retake</button>
              <button type="button" class="nd-btn nd-btn--primary pm-btn pm-btn--primary pm-apply" [disabled]="!activeRows().length" (click)="goReview()">Review</button>
            </div>
          </div>
        }

        @if (mode() === 'review') {
          <div class="pm-controls">
            <p class="pm-hinttext">{{ reviewLine() }}</p>
            <div class="pm-row pm-row--wrap">
              <button type="button" class="nd-btn nd-btn--secondary pm-btn" (click)="mode.set('measure')">Back</button>
              <span class="pm-grow"></span>
              <button type="button" class="nd-btn nd-btn--primary pm-btn pm-btn--primary pm-apply" [disabled]="busy() || applyCount() === 0" (click)="apply()">
                {{ busy() ? 'Saving…' : 'Apply to table' }}
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .pm-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 12px;
      background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
    .pm-backdrop--full { padding: 0; bottom: var(--nd-nav-h, 0px); }
    .pm-panel { width: 100%; max-width: 1100px; max-height: 92dvh; display: flex; flex-direction: column; overflow: hidden;
      background: var(--nd-card-bg, var(--bg-card-solid)); border: 1px solid var(--nd-line, var(--glass-border));
      border-radius: var(--nd-radius-card, 16px); box-shadow: 0 24px 64px rgba(15, 23, 42, 0.22); font-family: inherit;
      animation: pm-in var(--nd-dur, 320ms) var(--nd-spring, ease) both; }
    .pm-panel--full { max-width: none; width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
    @keyframes pm-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }
    .pm-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 0; flex-shrink: 0; }
    .pm-head__grow, .pm-grow { flex: 1 1 auto; }
    .pm-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0;
      border-radius: 8px; border: 0; background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .pm-icon:hover { background: var(--nd-chip-bg); color: var(--text-primary); }
    .pm-titles { padding: 10px 16px 12px; border-bottom: 1px solid var(--nd-line); flex-shrink: 0; }
    .pm-title { margin: 0; font-size: 18px; font-weight: 600; color: var(--text-primary); line-height: 1.3; }
    .pm-steps { list-style: none; margin: 10px 0 0; padding: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .pm-step { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-tertiary); }
    .pm-step + .pm-step::before { content: ''; width: 18px; height: 1px; background: var(--nd-line); margin-right: 2px; }
    .pm-step__dot { width: 14px; height: 14px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
      border: 1.5px solid var(--nd-sel-border, #9aa4ae); background: transparent; color: var(--text-secondary); }
    .pm-step[data-state='active'] { color: var(--text-primary); font-weight: 500; }
    .pm-step[data-state='active'] .pm-step__dot { border-color: var(--color-violet-600, #7c3aed); background: var(--color-violet-600, #7c3aed);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 18%, transparent); }
    .pm-step[data-state='done'] .pm-step__dot { border-color: transparent; background: var(--nd-chip-bg); }
    .pm-sub { margin: 8px 0 0; font-size: 12px; color: var(--text-tertiary); }

    /* Capture */
    .pm-capture { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px; gap: 12px; min-height: 320px; }
    .pm-capture__ico { color: var(--text-tertiary); }
    .pm-camwrap { position: relative; width: 100%; max-width: 560px; }
    .pm-cam { width: 100%; aspect-ratio: 4 / 3; border-radius: var(--nd-radius, 12px); background: #000; object-fit: cover; display: block; }
    .pm-guide { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: var(--nd-radius, 12px); pointer-events: none; }
    .pm-sweep { transform-origin: 200px 150px; animation: pm-sweep 3.2s linear infinite; }
    @keyframes pm-sweep { to { transform: rotate(360deg); } }
    .pm-level { position: absolute; right: 10px; bottom: 10px; width: 52px; height: 52px; border-radius: 50%; pointer-events: none;
      border: 1.5px solid rgba(255,255,255,0.6); background: rgba(8,10,16,0.4); display: flex; align-items: center; justify-content: center; }
    .pm-level::after { content: ''; position: absolute; width: 16px; height: 16px; border-radius: 50%; border: 1px dashed rgba(255,255,255,0.55); }
    .pm-level__bubble { width: 10px; height: 10px; border-radius: 50%; background: #ffffff; transition: transform 0.12s linear, background 0.2s ease; }
    .pm-level--ok { border-color: #a78bfa; }
    .pm-level--ok .pm-level__bubble { background: #a78bfa; }
    .pm-hinttext { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text-tertiary); text-align: center; text-wrap: pretty; }
    .pm-hinttext--lead { color: var(--text-secondary); }
    .pm-controls .pm-hinttext { text-align: left; margin-bottom: 10px; }
    .pm-actions { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 340px; }

    /* Buttons: the kit owns colour + border; this sets shape only. */
    .pm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 9px 14px; border-radius: 10px;
      font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
    .pm-btn.nd-btn { height: 44px; min-height: 44px; }
    .pm-btn svg { flex-shrink: 0; }
    .pm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    label.pm-btn { cursor: pointer; }
    .pm-btn--wide { width: 100%; }
    .pm-row { display: flex; gap: 8px; align-items: center; }
    .pm-row > .nd-btn { flex: 1 1 0; }
    .pm-row--wrap { flex-wrap: wrap; }
    .pm-row--wrap > .nd-btn { flex: 0 0 auto; }
    .pm-row--wrap > .pm-apply { flex: 0 1 200px; }
    .pm-controls { padding: 12px 16px 14px; border-top: 1px solid var(--nd-line); background: var(--nd-card-bg); flex-shrink: 0; }
    .pm-calrow { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    .pm-calrow__lbl { font-size: 13px; color: var(--text-secondary); }
    .pm-seg .nd-seg__item { min-width: 72px; font-variant-numeric: tabular-nums; }

    /* Stage */
    .pm-body { flex: 1; display: flex; min-height: 380px; }
    .pm-stage { position: relative; flex: 1; min-width: 0; background: #000; touch-action: none; overflow: hidden; }
    .pm-dim { display: none; }
    .pm-svg { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
    .pm-svgtxt { font-family: 'Noto Sans', var(--font-sans, sans-serif); font-variant-numeric: tabular-nums; pointer-events: none; }
    .pm-badge { pointer-events: none; }
    .pm-mmchip { pointer-events: none; }
    .pm-rej { pointer-events: none; }
    .pm-loupe { position: absolute; width: 110px; height: 110px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.5); background-repeat: no-repeat; pointer-events: none; z-index: 4; }
    .pm-loupe-x { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; transform: translate(-50%,-50%); }
    .pm-loupe-x::before, .pm-loupe-x::after { content: ''; position: absolute; background: rgba(167,139,250,0.9); }
    .pm-loupe-x::before { left: 50%; top: 0; width: 1.5px; height: 100%; transform: translateX(-50%); }
    .pm-loupe-x::after { top: 50%; left: 0; height: 1.5px; width: 100%; transform: translateY(-50%); }
    .pm-toolbar { position: absolute; left: 8px; bottom: 8px; display: flex; gap: 3px; padding: 3px; border-radius: 10px; z-index: 3;
      background: rgba(15,17,24,0.72); border: 1px solid rgba(255,255,255,0.14); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
    .pm-tool { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 7px;
      background: transparent; border: none; color: #e5e7eb; cursor: pointer; }
    .pm-tool:hover:not(:disabled) { background: rgba(255,255,255,0.1); }
    .pm-tool:disabled { opacity: 0.35; cursor: not-allowed; }
    .pm-tool[aria-pressed='true'] { background: rgba(255,255,255,0.18); color: #fff; }
    .pm-tool-sep { width: 1px; background: rgba(255,255,255,0.14); margin: 4px 2px; }
    .pm-busy { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 3; display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 12px; border-radius: 999px; font-size: 13px; color: #fff; background: rgba(15,17,24,0.78); }
    .pm-busy__dot { width: 7px; height: 7px; border-radius: 999px; background: #a78bfa; animation: pm-pulse 1.2s ease-in-out infinite; flex: none; }
    @keyframes pm-pulse { 50% { opacity: 0.35; } }
    .pm-hint { position: absolute; inset: 0; z-index: 6; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .pm-hint-card { max-width: 340px; padding: 16px 18px; border-radius: var(--nd-radius, 12px); background: var(--nd-card-bg); border: 1px solid var(--nd-line); }
    .pm-hint-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; }
    .pm-hint-list { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 7px; font-size: 12.5px; color: var(--text-secondary); }
    .pm-hint-list b { color: var(--text-primary); font-weight: 600; }

    /* Disk list (side on web, under the plate on phones) */
    .pm-list { width: 400px; flex-shrink: 0; border-left: 1px solid var(--nd-line); overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
    .pm-list__in { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .pm-list__hd { display: flex; align-items: center; gap: 8px; min-height: 28px; }
    .pm-list__ttl { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }
    .pm-list__count { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
    .pm-status { margin: 0; display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text-secondary); }
    .pm-note { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--nd-radius-sm, 10px);
      background: var(--nd-chip-bg); border: 1px solid var(--nd-line); font-size: 12.5px; color: var(--text-primary); }
    .pm-note svg { color: var(--text-tertiary); flex: none; }
    .pm-note__t { flex: 1; min-width: 0; }
    .pm-note__btn { height: 32px; padding: 0 8px; font-size: 13px; flex: none; }
    .pm-disks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .pm-drow { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto 32px; align-items: center; gap: 8px; min-height: 52px;
      padding: 6px 8px; border-radius: var(--nd-radius-sm, 10px); border: 1px solid transparent; cursor: pointer; }
    .pm-drow:hover { background: var(--nd-chip-bg); }
    .pm-drow[aria-selected='true'] { background: var(--nd-sel-bg); border-color: var(--nd-sel-border); }
    .pm-drow--off { opacity: 0.6; }
    .pm-drow__n { width: 24px; height: 24px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 600; color: var(--text-primary); background: var(--nd-card-bg); border: 1px solid var(--nd-line); }
    .pm-drow__code { display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-width: 0; }
    .pm-drow__pick { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .pm-drow__code > .pm-sug { align-self: flex-start; }
    .pm-drow__drug { font-size: 12.5px; color: var(--text-secondary); min-width: 0; padding-left: 2px; }
    .pm-drow__drug--none { color: var(--text-tertiary); }
    .pm-codesel { display: block; flex: 1 1 auto; min-width: 0; border-radius: var(--nd-radius-chip, 999px); }
    /* A row the AI just coded: a brief shimmer that settles. */
    .pm-drow--settle { animation: pm-settle 900ms var(--nd-spring, ease) both; }
    @keyframes pm-settle {
      0% { background: linear-gradient(90deg, transparent, var(--nd-sel-bg), transparent) -100% 0 / 200% 100% no-repeat; }
      70% { background: linear-gradient(90deg, transparent, var(--nd-sel-bg), transparent) 100% 0 / 200% 100% no-repeat; }
      100% { background: transparent; } }
    /* PF Sense mark (the brand glyph, mono) — never the letters "AI". */
    .pm-pf { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; color: var(--color-violet-600, #7c3aed); }
    :host-context(.dark) .pm-pf { color: #a78bfa; }
    .pm-pf pf-logo-mark ::ng-deep .pill { width: 14px; height: 14px; }
    .pm-pf pf-logo-mark ::ng-deep .glyph { width: 11px; height: 14px; }
    .pm-sense { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px 0 7px; border-radius: 999px;
      font-size: 12px; font-weight: 500; color: var(--text-primary); background: var(--nd-card-bg); border: 1px solid var(--nd-line); white-space: nowrap; }
    .pm-sug { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 4px 0 10px; border-radius: var(--nd-radius-chip, 999px);
      border: 1px solid var(--nd-line); background: var(--nd-chip-bg); color: var(--text-secondary); font: inherit; font-size: 12.5px; cursor: pointer; }
    .pm-sug b { font-weight: 600; color: var(--text-primary); }
    .pm-sug__t { white-space: nowrap; }
    .pm-sug__ok { padding: 3px 8px; border-radius: 999px; background: var(--nd-card-bg); border: 1px solid var(--nd-line); color: var(--text-primary); font-weight: 500; }
    .pm-drow__mm { display: inline-flex; align-items: center; gap: 4px; }
    .pm-mm { width: 52px; height: 36px; padding: 0 6px; text-align: center; border-radius: var(--nd-radius-sm, 10px); border: 1px solid var(--nd-line);
      background: var(--nd-card-bg); color: var(--text-primary); font: inherit; font-size: 14px; font-variant-numeric: tabular-nums; outline: none; }
    .pm-mm:focus { border-color: var(--color-violet-600, #7c3aed); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .pm-mm__u, .pm-drow__mmro { font-size: 12.5px; color: var(--text-tertiary); }
    .pm-drow__mmro { color: var(--text-primary); font-weight: 500; }
    /* S / I / R: neutral in light mode (a 5px red dot on R is the one colour). */
    .pm-sir { position: relative; width: 30px; height: 26px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 600; color: var(--text-tertiary); background: transparent; border: 1px solid var(--nd-line); }
    .pm-sir[data-sir] { color: var(--text-primary); background: var(--nd-sel-bg); border-color: var(--nd-sel-border); }
    .pm-sir[data-sir='R']::after { content: ''; position: absolute; top: 3px; right: 3px; width: 5px; height: 5px; border-radius: 999px; background: #dc2626; }
    :host-context(.dark) .pm-sir[data-sir='S'] { color: #34d399; }
    :host-context(.dark) .pm-sir[data-sir='I'] { color: #fbbf24; }
    :host-context(.dark) .pm-sir[data-sir='R'] { color: #f87171; }
    .pm-empty { font-size: 13px; color: var(--text-tertiary); padding: 12px 4px; }
    .pm-usage { margin: auto 0 0; padding-top: 6px; font-size: 11.5px; color: var(--text-tertiary); }
    .pm-rejtoggle { min-height: 36px; font-size: 13px; }
    .pm-narrow { display: none; }

    /* The code picker trigger IS the code chip. */
    .pm-codesel ::ng-deep .pf-dd__trigger { min-height: 34px; height: auto; border-radius: var(--nd-radius-chip, 999px); padding: 0 10px;
      background: var(--nd-chip-bg); border-color: transparent; font-weight: 600; font-variant-numeric: tabular-nums; }
    .pm-codesel:not(.pm-codesel--set) ::ng-deep .pf-dd__trigger { font-weight: 500; background: transparent; border: 1px dashed var(--nd-sel-border, #9aa4ae); }
    .pm-codesel--pending ::ng-deep .pf-dd__trigger { border-style: solid; border-color: transparent;
      background: linear-gradient(90deg, var(--nd-chip-bg) 0%, var(--nd-sel-bg) 50%, var(--nd-chip-bg) 100%); background-size: 200% 100%;
      animation: pm-shimmer 1.4s linear infinite; }
    @keyframes pm-shimmer { to { background-position: -200% 0; } }

    @media (hover: none), (pointer: coarse) {
      .pm-codesel ::ng-deep .pf-dd__trigger { min-height: 44px; }
      .pm-mm { height: 44px; width: 60px; font-size: 16px; }
      .pm-tool { width: 44px; height: 44px; }
      .pm-rejtoggle { min-height: 44px; }
      .pm-note__btn { height: 44px; }
      .pm-sug { min-height: 44px; }
    }
    @media (max-width: 820px) {
      .pm-backdrop { padding: 0; }
      .pm-panel { max-width: none; width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
      .pm-body { flex-direction: column; min-height: 0; }
      .pm-stage { flex: 0 0 auto; height: 46dvh; min-height: 240px; }
      .pm-body--cal .pm-stage { flex: 1 1 auto; height: auto; }
      .pm-list { width: auto; border-left: 0; border-top: 1px solid var(--nd-line); flex: 1 1 auto; min-height: 0; }
      .pm-controls { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
    }
    /* Phones: a tall sheet ABOVE the always-visible navbar. */
    @media (max-width: 640px) {
      .pm-backdrop { bottom: var(--nd-nav-h, 0px); align-items: flex-end; padding: 0; }
      .pm-panel, .pm-panel--full { position: relative; top: auto; bottom: auto; left: auto; right: auto; width: 100%; max-width: none;
        height: min(92dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--nd-nav-h, 0px) - 8px)); max-height: none;
        border-radius: 20px 20px 0 0; border-bottom: 0; }
      .pm-head { padding-top: 6px; }
      .pm-titles { padding: 8px 16px 10px; }
      .pm-capture { padding: 12px; justify-content: flex-start; }
      .pm-camwrap { max-width: none; }
      .pm-actions { max-width: none; }
      .pm-icon { width: 44px; height: 44px; }
      .pm-sub { display: none; }
      .pm-steps { margin-top: 6px; }
      .pm-stage { height: 34dvh; min-height: 200px; }
      .pm-list__in { padding: 10px 12px; }
      .pm-controls { padding: 8px 12px 10px; }
      .pm-row--wrap { gap: 6px; }
      .pm-row--wrap > .pm-btn--aux { height: 44px; padding: 0 12px; font-size: 13px; }
      .pm-row--wrap > .pm-grow { display: none; }
      .pm-rejtoggle { flex: 1 1 auto; }
      .pm-wide { display: none; }
      .pm-narrow { display: inline; }
      .pm-row--wrap > .pm-apply { flex: 1 1 100%; }
      .pm-drow { grid-template-columns: 24px minmax(0, 1fr) auto 30px; gap: 6px; padding: 6px 2px; }
      .pm-mm__u { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pm-sweep, .pm-panel, .pm-busy__dot { animation: none; }
      .pm-sweep { display: none; }
      .pm-codesel--pending ::ng-deep .pf-dd__trigger { animation: none; }
      .pm-drow--settle { animation: none; }
      .pm-level__bubble { transition: none; }
    }
  `]
})
export class PlateMeasureComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  private readonly cap = inject(CapacitorService);
  private readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly diskApi = inject(DiskReadApi);

  /** The organism's panel (antibiotic names) — codes map back to these rows. */
  @Input() antibiotics: string[] = [];
  /** Drug → breakpoint short label ("AZA 30") for drugs the code table lacks. */
  @Input() codeHints: Record<string, string> = {};
  /** The candidate codes, given outright (the plate read BEFORE an organism:
   *  the lab's whole antibiotic master). Null = derive from `antibiotics`. */
  @Input() candidateList: DiskCandidate[] | null = null;
  /** The culture case (order test) — sent with the AI read for the audit. */
  @Input() orderTestId: string | null = null;
  /** The lab's default plate size (mm). */
  @Input() defaultDishMm: number | null = null;
  @Input() existingImageUrl?: string | null;
  /** A previously saved session — restores calibration + every ring. */
  @Input() existingSession?: PlateMeasureSession | null;
  /** Live interpretation: (antibiotic, zone mm) → S/I/R (existing breakpoint logic). */
  @Input() srI?: (antibiotic: string, zoneMm: number) => 'S' | 'I' | 'R' | '';

  @Output() applied = new EventEmitter<{ measurements: PlateMeasurement[]; imageUrl: string | null; session: PlateMeasureSession; auditId?: string | null }>();
  @Output() cancel = new EventEmitter<void>();

  readonly fullscreen = signal(false);
  readonly mode = signal<Mode>('capture');
  readonly imageSrc = signal<string | null>(null);
  private photoBlob: Blob | null = null;
  private uploadedUrl: string | null = null;

  readonly natW = signal(0);
  readonly natH = signal(0);
  readonly dishMm = signal(90);
  readonly plateSizes = PLATE_SIZES;
  readonly calPts = signal<Pt[]>([]);
  readonly busy = signal(false);
  readonly measuring = signal(false);

  readonly rows = signal<DiskRow[]>([]);
  readonly rejected = signal<RejectedCircle[]>([]);
  readonly showRejected = signal(false);
  readonly selectedId = signal<number>(-1);
  readonly scale = signal<ScaleReport | null>(null);
  readonly tiltWarn = signal(false);
  private nextId = 1;

  readonly plateState = signal<PlateState>('idle');
  readonly ai = signal<AiState>('idle');
  readonly aiMsg = signal('');
  /** The read is taking longer than usual (> 15 s). */
  readonly aiSlow = signal(false);
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  readonly usage = signal<AiUsage | null>(null);
  private auditId: string | null = null;
  private aiSub: Subscription | null = null;

  private vision: PlateVision | null = null;
  private plateCircleAuto = false;

  private drag: { kind: DragKind; id: number; offx: number; offy: number } | null = null;
  history: DiskRow[][] = [];
  future: DiskRow[][] = [];
  readonly showHint = signal(typeof localStorage !== 'undefined' && !safeGet('pf-plate-hint2'));
  private lastTap = { t: 0, id: -1 };
  private lastKeyEdit = 0;

  readonly view = signal<Box>({ x: 0, y: 0, w: 1, h: 1 });
  readonly panMode = signal(false);
  private panning: Pt | null = null;
  private calDrag: number | null = null;
  private pointers = new Map<number, Pt>();
  private pinchDist = 0;
  private pinchMid: Pt | null = null;
  readonly loupe = signal<{ sx: number; sy: number; ix: number; iy: number } | null>(null);

  private readonly svgEl = viewChild<ElementRef<SVGSVGElement>>('svg');
  private readonly imgEl = viewChild<ElementRef<HTMLImageElement>>('img');
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
    const saved = Number(safeGet('pf-plate-mm'));
    this.dishMm.set(this.existingSession?.dishMm || this.defaultDishMm || ((PLATE_SIZES as readonly number[]).includes(saved) ? saved : 90));
    this.diskApi.usage().subscribe({ next: u => this.usage.set(u), error: () => { /* no usage line */ } });
    if (this.existingImageUrl) {
      this.uploadedUrl = this.existingImageUrl;
      this.imageSrc.set(this.resolve(this.existingImageUrl));
      void this.loadExistingBlob(this.existingImageUrl);
      const s = this.existingSession;
      if (s?.calPts?.length === 2) { this.calPts.set(s.calPts.map(pt => ({ x: pt.x, y: pt.y }))); this.restoreRows(s); this.mode.set('measure'); }
      else this.mode.set('calibrate');
      return;
    }
    if (!this.isNative()) void this.startCamera();
  }
  ngOnDestroy() {
    this.stopCamera();
    this.aiSub?.unsubscribe();
    if (this.slowTimer) clearTimeout(this.slowTimer);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.vision?.dispose();
    try { this.host.nativeElement.remove(); } catch { /* */ }
  }
  private async loadExistingBlob(url: string) {
    try {
      this.photoBlob = await (await fetch(this.resolve(url))).blob();
      // A same-origin blob URL keeps the canvas readable for OpenCV.
      this.imageSrc.set(URL.createObjectURL(this.photoBlob));
    } catch { /* offline → manual rings only */ }
  }
  close() { this.stopCamera(); this.cancel.emit(); }

  isNative(): boolean { return this.platform.isCapacitor(); }
  readonly viewBox = computed(() => { const v = this.view(); return `${v.x} ${v.y} ${v.w} ${v.h}`; });
  readonly unit = computed(() => Math.max(this.view().w, this.view().h) / 220 || 1);

  readonly steps: { key: Mode; label: string }[] = [
    { key: 'capture', label: 'Capture' },
    { key: 'calibrate', label: 'Calibrate' },
    { key: 'measure', label: 'Measure & read' },
    { key: 'review', label: 'Review' },
  ];
  stepIndex(): number { return Math.max(0, this.steps.findIndex(st => st.key === this.mode())); }
  stepState(i: number): 'done' | 'active' | 'todo' {
    const cur = this.stepIndex();
    return i < cur ? 'done' : i === cur ? 'active' : 'todo';
  }
  stepHint(): string {
    switch (this.mode()) {
      case 'capture': return 'Capture the plate';
      case 'calibrate': return 'Check the plate rim and size';
      case 'measure': return 'Check each zone — codes fill in as they are read';
      case 'review': return 'Check, then apply to the table';
    }
  }
  stageLabel(): string {
    const n = this.activeRows().length;
    return this.mode() === 'calibrate' ? 'Plate photo — tap two opposite rim edges to calibrate' : `Plate photo with ${n} ${n === 1 ? 'disk' : 'disks'}`;
  }

  // ── Camera ───────────────────────────────────────────────────────
  async capturePhoto() { const d = await this.cap.captureImage(); if (d) await this.setFromDataUrl(d); }
  onFilePick(ev: Event) {
    const input = ev.target as HTMLInputElement; const f = input.files?.[0]; input.value = '';
    if (!f) return;
    this.stopCamera(); this.photoBlob = f; this.uploadedUrl = null;
    this.resetAnalysis();
    this.imageSrc.set(URL.createObjectURL(f)); this.mode.set('calibrate');
  }
  private async setFromDataUrl(dataUrl: string) {
    this.resetAnalysis();
    this.imageSrc.set(dataUrl); this.uploadedUrl = null; this.mode.set('calibrate');
    this.photoBlob = await (await fetch(dataUrl)).blob();
  }
  retake() {
    this.aiSub?.unsubscribe();
    this.imageSrc.set(null); this.photoBlob = null; this.uploadedUrl = null;
    this.resetAnalysis();
    this.mode.set('capture');
    if (!this.isNative()) void this.startCamera();
  }
  private resetAnalysis() {
    this.vision?.dispose(); this.vision = null;
    this.calPts.set([]); this.rows.set([]); this.rejected.set([]); this.selectedId.set(-1);
    this.scale.set(null); this.tiltWarn.set(false); this.plateState.set('idle');
    this.ai.set('idle'); this.aiMsg.set(''); this.auditId = null;
    this.history = []; this.future = [];
  }
  readonly tilt = signal<{ beta: number; gamma: number } | null>(null);
  private readonly onOrient = (ev: DeviceOrientationEvent) => {
    if (ev.beta == null || ev.gamma == null) return;
    this.tilt.set({ beta: ev.beta, gamma: ev.gamma });
  };
  tiltOk(): boolean { const t = this.tilt(); return !!t && Math.abs(t.beta) <= 10 && Math.abs(t.gamma) <= 10; }
  bubbleTransform(): string {
    const t = this.tilt(); if (!t) return '';
    const clamp = (v: number) => Math.max(-20, Math.min(20, v * 1.6));
    return `translate(${clamp(t.gamma)}px, ${clamp(t.beta)}px)`;
  }
  async startCamera() {
    this.camError.set('');
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) { this.camError.set('Camera not supported here — upload a photo instead.'); return; }
    try {
      this._camStream.set(await md.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }));
      window.addEventListener('deviceorientation', this.onOrient);
    } catch { this.camError.set('Camera unavailable or blocked — upload a photo instead.'); }
  }
  stopCamera() {
    window.removeEventListener('deviceorientation', this.onOrient);
    this.tilt.set(null);
    const s = this._camStream(); if (s) { s.getTracks().forEach(t => t.stop()); this._camStream.set(null); }
  }
  captureFromVideo() {
    const v = this.camEl()?.nativeElement; if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas'); canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.drawImage(v, 0, 0); this.stopCamera();
    void this.setFromDataUrl(canvas.toDataURL('image/jpeg', 0.92));
  }
  onImgLoad(ev: Event) {
    const img = ev.target as HTMLImageElement;
    const sameSize = this.natW() === img.naturalWidth && this.natH() === img.naturalHeight;
    this.natW.set(img.naturalWidth); this.natH.set(img.naturalHeight);
    if (!sameSize) this.resetView();
    if (this.mode() === 'capture') this.mode.set('calibrate');
    if (this.mode() === 'calibrate' && this.calPts().length === 0) void this.findPlate();
  }

  // ── OpenCV: plate ────────────────────────────────────────────────
  private async ensureVision(): Promise<PlateVision | null> {
    if (this.vision) return this.vision;
    const img = this.imgEl()?.nativeElement;
    if (!img || !img.naturalWidth) return null;
    const cv = await loadOpenCv();
    try { this.vision = new PlateVision(cv, img, img.naturalWidth, img.naturalHeight); }
    catch { this.vision = null; }     // tainted canvas (remote photo) → manual
    return this.vision;
  }
  async findPlate() {
    this.plateState.set('loading');
    try {
      let v: PlateVision | null;
      try { v = await this.ensureVision(); }
      catch { this.plateState.set('load-failed'); return; }   // the bundled asset didn't load
      if (!v) { this.plateState.set('unavailable'); return; }
      this.plateState.set('finding');
      await nextFrame();
      const p = v.findPlate();
      if (!p || this.calPts().length) { this.plateState.set(p ? 'found' : 'not-found'); return; }
      const f = v.factor;
      this.plateCircleAuto = true;
      this.calPts.set([{ x: (p.cx - p.r) * f, y: p.cy * f }, { x: (p.cx + p.r) * f, y: p.cy * f }]);
      this.plateState.set('found');
    } catch { this.plateState.set('unavailable'); }
  }
  plateLine(): string {
    switch (this.plateState()) {
      case 'loading': return 'Loading the measuring tools…';
      case 'finding': return 'Finding the plate rim…';
      case 'found': return 'Plate rim found. Drag an end to adjust, or tap two opposite rim edges.';
      case 'not-found': return 'Couldn’t find the rim — tap two opposite rim edges.';
      case 'unavailable': return 'Auto-measure is unavailable here — tap two opposite rim edges, then draw each zone.';
      case 'load-failed': return 'Couldn’t load the measuring tools — tap two opposite rim edges, then draw each zone.';
      default: return 'Tap two opposite rim edges.';
    }
  }
  /** The plate as a circle (image px), from the two rim points. */
  readonly plateCircle = computed<Circle | null>(() => {
    const p = this.calPts(); if (p.length !== 2) return null;
    return { cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2, r: Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) / 2 };
  });
  readonly calibrated = computed(() => this.calPts().length === 2);
  /** Plate scale (mm per image px). */
  readonly plateMmPerPx = computed(() => { const c = this.plateCircle(); return c && c.r > 0 ? this.dishMm() / (2 * c.r) : 0; });
  resetCalibration() { this.calPts.set([]); this.plateCircleAuto = false; this.plateState.set('idle'); }
  recalibrate() { this.mode.set('calibrate'); void nextFrame().then(() => nextFrame()).then(() => this.resetView()); }
  setDish(mm: number) {
    this.dishMm.set(mm);
    try { localStorage.setItem('pf-plate-mm', String(mm)); } catch { /* */ }
    this.updateScale();
  }

  // ── OpenCV: disks + zones ────────────────────────────────────────
  async goMeasure() {
    if (!this.calibrated()) return;
    this.measuring.set(true);
    try {
      const v = await this.ensureVision().catch(() => null);
      if (v) await this.detectDisks(v);
      else if (!this.rows().length) this.toasts.info?.('Auto-measure unavailable — tap each disk and drag out its zone.');
      this.mode.set('measure');
      this.startAiRead();
      void nextFrame().then(() => nextFrame()).then(() => this.resetView());
    } finally { this.measuring.set(false); }
  }
  private async detectDisks(v: PlateVision) {
    const pc = this.plateCircle()!; const f = v.factor;
    await nextFrame();
    const bounds = { cx: pc.cx / f, cy: pc.cy / f, r: pc.r / f };
    const expectR = (DISK_MM / 2) / this.plateMmPerPx() / f;
    const { disks, rejected } = v.findDisks(bounds, expectR);
    const order = readingOrder(disks, expectR * 1.5);
    const el = disks.map(d => ({ ...d.ellipse, r: d.r }));
    const rows: DiskRow[] = order.map((i, k) => {
      const d = disks[i];
      const ld = localDisk(el, i);
      const z = measureZone(v.gray, d.ellipse, ld, { plate: bounds });
      return {
        id: this.nextId++, n: k + 1, cx: d.cx * f, cy: d.cy * f,
        own: { rx: d.ellipse.rx * f, ry: d.ellipse.ry * f, angle: d.ellipse.angle },
        ruler: { rx: ld.rx * f, ry: ld.ry * f, angle: ld.angle },
        k: z.found ? z.k : 1, zoneFound: z.found,
        code: null, codeSrc: null, aiConf: null, notDisk: false, suggested: null,
      };
    });
    this.snapshot();
    this.rows.set(rows);
    this.rejected.set(rejected.map(r => ({ ...r, cx: r.cx * f, cy: r.cy * f, r: r.r * f })));
    this.tiltWarn.set(tiltCheck(disks.map(d => d.ellipse)).warn);
    this.selectedId.set(-1);
    this.updateScale();
    if (!rows.length) this.toasts.info?.('No disks found — tap each disk and drag out its zone.');
  }
  private updateScale() {
    const pc = this.plateCircle();
    const rows = this.rows().filter(r => !r.notDisk);
    this.scale.set(reconcileScale(pc ? 2 * pc.r : null, this.dishMm(), rows.map(r => r.own.rx + r.own.ry)));
  }
  /** Default ruler (image px) for a disk added by hand: the disks' median
   *  size + shared shape, else the plate scale. */
  private defaultRuler(): Shape {
    const rows = this.rows().filter(r => !r.notDisk);
    const s = this.scale();
    const mmpp = s?.mmPerPx || this.plateMmPerPx() || 0.1;
    const r = (DISK_MM / 2) / mmpp;
    const shape = consensusShape(rows.map(x => x.ruler));
    const ry = (2 * r) / (1 + shape.ratio);
    return { rx: ry * shape.ratio, ry, angle: shape.angle };
  }
  warnings = computed<{ text: string; action?: 'dish' | 'retake' }[]>(() => {
    const out: { text: string; action?: 'dish' | 'retake' }[] = [];
    const s = this.scale();
    const sw = s ? scaleWarning(s) : null;
    if (sw) out.push({ text: sw, action: 'dish' });
    if (this.tiltWarn()) out.push({ text: 'The photo is at an angle — zones may read wrong. Retake from directly above.', action: 'retake' });
    return out;
  });

  // ── AI: ONE background read of the printed codes ─────────────────
  readonly candidates = computed<DiskCandidate[]>(() => this.candidateList ?? panelCandidates(this.antibiotics, this.codeHints));
  /** Each row's pick list: the panel's codes; a code already on another
   *  disk is marked "on disk n" (picking it moves it here). */
  readonly codeOptions = computed(() => {
    const rows = this.rows();
    // By DRUG: a printed alias of a drug already on a disk is "on disk n" too.
    const where = new Map(rows.filter(r => r.code).map(r => [this.drugOf(r) ?? (r.code as string), r]));
    const out = new Map<number, PfSelectOption<string>[]>();
    for (const r of rows) {
      out.set(r.id, [
        ...this.candidates().map(c => {
          const other = where.get(c.drug);
          return { value: c.code, label: c.code, hint: other && other.id !== r.id ? `${c.drug} · on disk ${other.n}` : c.drug };
        }),
        { value: NOT_A_DISK, label: 'Not a disk' },
      ]);
    }
    return out;
  });
  startAiRead() {
    this.aiSub?.unsubscribe();
    const rows = this.rows().filter(r => !r.notDisk);
    const img = this.imgEl()?.nativeElement;
    if (!rows.length) { this.ai.set('idle'); return; }
    // The case's own panel, minus codes the technician already placed.
    const placed = new Set(this.rows().filter(r => r.codeSrc === 'tech' && r.code).map(r => r.code));
    const cands = this.candidates().filter(c => !placed.has(c.code));
    if (!cands.length || !img) { this.ai.set('failed'); this.aiMsg.set('Codes: pick manually'); return; }
    let mosaic;
    try { mosaic = buildMosaic(img, rows.map(r => ({ cx: r.cx, cy: r.cy, r: (r.own.rx + r.own.ry) / 2, n: r.n }))); }
    catch { this.ai.set('failed'); this.aiMsg.set('Codes: pick manually'); return; }
    const tileToId = new Map(rows.map(r => [r.n, r.id]));
    this.ai.set('pending'); this.aiMsg.set(''); this.aiSlow.set(false);
    if (this.slowTimer) clearTimeout(this.slowTimer);
    this.slowTimer = setTimeout(() => { if (this.ai() === 'pending') this.aiSlow.set(true); }, 15_000);
    this.aiSub = this.diskApi.read({
      orderTestId: this.orderTestId ?? '', image: mosaic.base64, tiles: mosaic.tiles, candidates: cands.map(c => c.code),
    }).subscribe({
      next: res => {
        this.auditId = res.auditId || null;
        const before = new Map(this.rows().map(r => [r.id, r.code]));
        this.rows.update(list => mapAiRead(list, res, tileToId, this.candidates()));
        this.justRead.set(new Set(this.rows().filter(r => r.code && r.code !== before.get(r.id)).map(r => r.id)));
        if (this.settleTimer) clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => this.justRead.set(new Set()), 1000);
        this.ai.set('done');
        this.diskApi.usage().subscribe({ next: u => this.usage.set(u), error: () => { /* */ } });
      },
      error: e => { this.ai.set('failed'); this.aiMsg.set(aiFallbackMessage(e)); },
    });
  }
  /** The AI read is in flight — drives the rainbow glow (nd-ai-glow). */
  readonly aiWorking = computed(() => this.ai() === 'pending');
  /** Rows the AI just coded — a brief shimmer-to-settled. */
  readonly justRead = signal<Set<number>>(new Set());
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  isPending(d: DiskRow): boolean { return this.ai() === 'pending' && !d.code && !d.notDisk && d.codeSrc !== 'tech'; }
  aiLine(): string {
    const rows = this.activeRows();
    const coded = rows.filter(r => r.code).length;
    switch (this.ai()) {
      case 'pending': return 'Keep checking the zones — codes fill in as they are read.';
      case 'done': return `${coded} of ${rows.length} codes read by PF Sense — check each one.`;
      case 'failed': return this.aiMsg() || 'Codes: pick manually';
      default: return rows.length ? 'Codes: pick manually' : '';
    }
  }
  /** Manual fallback: a short neutral hint at the top of the list. */
  manualHint(): string | null {
    if (this.ai() !== 'failed') return null;
    return this.aiMsg().startsWith('PF Sense limit')
      ? 'PF Sense limit reached this month — pick each disk’s code'
      : 'PF Sense isn’t available — pick each disk’s code';
  }
  readonly usageLine = computed(() => {
    const u = this.usage();
    return u && u.capTokens > 0 ? `PF Sense this month: ${formatTokens(u.monthTokens)} / ${formatTokens(u.capTokens)} tokens` : '';
  });

  // ── Rows ─────────────────────────────────────────────────────────
  readonly activeRows = computed(() => this.rows().filter(r => !r.notDisk));
  select(id: number) { this.selectedId.set(id); }
  codeValue(d: DiskRow): string { return d.notDisk ? NOT_A_DISK : (d.code ?? ''); }
  pickCode(id: number, value: string) {
    this.snapshot();
    const code = value === NOT_A_DISK ? null : normCode(value) || null;
    const drug = code ? drugForCode(code, this.candidates()) ?? code : null;
    const drugOfCode = (c: string | null | undefined) => (c ? drugForCode(c, this.candidates()) ?? c : null);
    this.rows.update(list => list.map(r => {
      if (r.id === id) return { ...r, code, codeSrc: 'tech' as const, aiConf: null, notDisk: value === NOT_A_DISK, suggested: null };
      // One disk per code: a code picked here leaves any other disk (and
      // stops being anyone's "probably").
      if (drug && drugOfCode(r.code) === drug) return { ...r, code: null, codeSrc: 'tech' as const, aiConf: null };
      if (drug && drugOfCode(r.suggested) === drug) return { ...r, suggested: null };
      return r;
    }));
    this.selectedId.set(id);
    this.updateScale();
  }
  setMm(id: number, raw: string) {
    const mm = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(mm) || mm <= 0) return;
    this.snapshot();
    const k = Math.max(1, Math.min(60, mm) / DISK_MM);
    this.rows.update(list => list.map(r => r.id === id ? { ...r, k, zoneFound: k > 1 } : r));
  }
  nextMm(ev: Event) {
    ev.preventDefault();
    const inputs = [...this.host.nativeElement.querySelectorAll<HTMLInputElement>('.pm-mm')];
    const i = inputs.indexOf(ev.target as HTMLInputElement);
    (ev.target as HTMLInputElement).dispatchEvent(new Event('change'));
    inputs[i + 1]?.focus(); inputs[i + 1]?.select();
  }
  mmOf(d: DiskRow): number { return Math.round(DISK_MM * d.k); }
  drugOf(d: DiskRow): string | null { return drugForCode(d.code, this.candidates()); }
  abIndexOf(d: DiskRow): number { const drug = this.drugOf(d); return drug ? this.antibiotics.indexOf(drug) : -1; }
  sirOf(d: DiskRow): 'S' | 'I' | 'R' | '' {
    const drug = this.drugOf(d);
    return drug && this.srI ? this.srI(drug, this.mmOf(d)) : '';
  }
  sirWord(d: DiskRow): string { return ({ S: 'susceptible', I: 'intermediate', R: 'resistant' } as Record<string, string>)[this.sirOf(d)] ?? ''; }
  ringStroke(d: DiskRow): string {
    if (d.id === this.selectedId() || !d.code) return '#a78bfa';
    if (this.isLight()) return '#ffffff';
    const s = this.sirOf(d);
    return s === 'S' ? '#34d399' : s === 'R' ? '#f87171' : s === 'I' ? '#fbbf24' : '#ffffff';
  }
  chipFill(d: DiskRow): string { return d.id === this.selectedId() || !d.code ? '#7c3aed' : 'rgba(15,17,24,0.78)'; }
  isLight(): boolean {
    try { const r = document.documentElement; return r.classList.contains('light') || r.getAttribute('data-theme') === 'light'; }
    catch { return false; }
  }
  deg(rad: number): number { return (rad * 180) / Math.PI; }
  ringShape(d: DiskRow): Shape { return { rx: d.ruler.rx * d.k, ry: d.ruler.ry * d.k, angle: d.ruler.angle }; }
  ringR(d: DiskRow, theta: number): number { return ellipseRadiusAt(this.ringShape(d), theta); }
  badgeX(d: DiskRow): number { return d.cx - ((d.own.rx + d.own.ry) / 2) * 1.05 - this.unit() * 1.6; }
  badgeY(d: DiskRow): number { return d.cy - ((d.own.rx + d.own.ry) / 2) * 1.05 - this.unit() * 1.6; }
  delPath(d: DiskRow): string {
    const r = this.ringR(d, -0.785) * 0.707, x = d.cx + r, y = d.cy - r, u = this.unit() * 1.1;
    return `M${x - u} ${y - u}L${x + u} ${y + u}M${x + u} ${y - u}L${x - u} ${y + u}`;
  }

  // ── Review + Apply ───────────────────────────────────────────────
  goReview() { this.selectedId.set(-1); this.mode.set('review'); }
  readonly applyCount = computed(() => this.activeRows().filter(r => this.abIndexOf(r) >= 0).length);
  reviewLine(): string {
    const n = this.applyCount(), rest = this.activeRows().length - n;
    const a = `${n} ${n === 1 ? 'zone goes' : 'zones go'} to the AST table.`;
    return rest > 0 ? `${a} ${rest} without a code ${rest === 1 ? 'is' : 'are'} left out.` : a;
  }
  /** The ONLY place anything leaves this modal — the technician pressed Apply. */
  async apply() {
    this.busy.set(true);
    try { if (this.photoBlob && !this.uploadedUrl) this.uploadedUrl = await this.upload(this.photoBlob); }
    catch (e) { this.toasts.error(ApiError.from(e).message); this.busy.set(false); return; }
    const measurements: PlateMeasurement[] = this.activeRows()
      .map(r => ({ index: this.abIndexOf(r), zoneMm: this.mmOf(r) }))
      .filter(m => m.index >= 0);
    const session: PlateMeasureSession = {
      dishMm: this.dishMm(),
      calPts: this.calPts().map(pt => ({ x: pt.x, y: pt.y })),
      zones: this.activeRows().map(r => {
        const rr = (r.ruler.rx + r.ruler.ry) / 2;
        return { cx: r.cx, cy: r.cy, r: rr * r.k, abName: this.drugOf(r), code: r.code, diskR: rr, mm: this.mmOf(r), n: r.n };
      }),
    };
    if (this.auditId) {
      const disks = this.rows().map(r => ({ n: r.n, code: r.notDisk ? null : r.code }));
      this.diskApi.confirm(this.auditId, disks).subscribe({ error: () => { /* audit only */ } });
    }
    this.applied.emit({ measurements, imageUrl: this.uploadedUrl, session, auditId: this.auditId });
    this.busy.set(false);
  }
  private upload(blob: Blob): Promise<string> {
    const fd = new FormData(); fd.append('file', blob, 'plate.jpg');
    return firstValueFrom(this.http.post<{ success: boolean; data?: { url: string }; message?: string }>(`${this.platform.getApiUrl()}/api/uploads/culture-plate`, fd))
      .then(resp => { if (!resp?.success || !resp.data?.url) throw new Error(resp?.message ?? 'upload failed'); return resp.data.url; });
  }
  /** Rebuild rows from a saved session (disk-ruler or legacy rings). */
  private restoreRows(s: PlateMeasureSession) {
    const p = s.calPts;
    const mmpp = (s.dishMm || 90) / Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    const cands = this.candidates();
    this.rows.set((s.zones ?? []).map((z, i) => {
      const rr = z.diskR && z.diskR > 0 ? z.diskR : (DISK_MM / 2) / mmpp;
      const code = z.code ? normCode(z.code) : (cands.find(c => c.drug === z.abName)?.code ?? null);
      return {
        id: this.nextId++, n: z.n ?? i + 1, cx: z.cx, cy: z.cy,
        own: { rx: rr, ry: rr, angle: 0 }, ruler: { rx: rr, ry: rr, angle: 0 },
        k: Math.max(1, z.r / rr), zoneFound: z.r / rr > 1.05,
        code, codeSrc: code ? 'tech' as const : null, aiConf: null, notDisk: false,
      };
    }));
    this.updateScale();
  }

  // ── Zoom / pan ───────────────────────────────────────────────────
  private toLocal(svg: SVGSVGElement, clientX: number, clientY: number): Pt | null {
    const ctm = svg.getScreenCTM(); if (!ctm) return null;
    const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }
  /** The stage's aspect (h / w) — the view box follows it so the plate
   *  fills the stage instead of the photo's own (often portrait) shape. */
  private stageAspect(): number {
    const r = this.svgEl()?.nativeElement.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? r.height / r.width : (this.natH() / this.natW() || 1);
  }
  private zoomAt(factor: number, clientX: number, clientY: number) {
    const svg = this.svgEl()?.nativeElement; if (!svg) return;
    const p = this.toLocal(svg, clientX, clientY); if (!p) return;
    const v = this.view(), W = this.natW(), H = this.natH(), a = v.h / v.w;
    const nw = Math.min(Math.max(W, H / a) * 1.1, Math.max(W * 0.08, v.w / factor)), nh = nw * a;
    this.view.set(this.clampView({ x: p.x - (p.x - v.x) * (nw / v.w), y: p.y - (p.y - v.y) * (nh / v.h), w: nw, h: nh }));
  }
  /** Keep at least half the view on the photo. */
  private clampView(v: Box): Box {
    const W = this.natW(), H = this.natH();
    return { ...v, x: Math.min(W - v.w / 2, Math.max(-v.w / 2, v.x)), y: Math.min(H - v.h / 2, Math.max(-v.h / 2, v.y)) };
  }
  onWheel(ev: WheelEvent) { ev.preventDefault(); this.zoomAt(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX, ev.clientY); }
  zoomBtn(factor: number) { const r = this.svgEl()?.nativeElement.getBoundingClientRect(); if (r) this.zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2); }
  /** Fit: the plate (with a margin) once measuring, else the whole photo. */
  resetView() {
    const W = this.natW(), H = this.natH(), pc = this.plateCircle(), a = this.stageAspect();
    if (!W || !H) return;
    const plate = pc && this.mode() !== 'calibrate';
    const cx = plate ? pc!.cx : W / 2, cy = plate ? pc!.cy : H / 2;
    const bw = plate ? pc!.r * 2.24 : W, bh = plate ? pc!.r * 2.24 : H;
    const w = Math.max(bw, bh / a), h = w * a;
    this.view.set({ x: cx - w / 2, y: cy - h / 2, w, h });
  }
  private panByClient(dx: number, dy: number) {
    const svg = this.svgEl()?.nativeElement; if (!svg) return;
    const ctm = svg.getScreenCTM(); if (!ctm) return;
    const v = this.view();
    this.view.set(this.clampView({ ...v, x: v.x - dx / ctm.a, y: v.y - dy / ctm.d }));
  }


  // ── Ring editing + multi-touch ───────────────────────────────────
  private capture(el: Element, ev: PointerEvent) { try { el.setPointerCapture(ev.pointerId); } catch { /* */ } }
  private rowById(id: number): DiskRow | undefined { return this.rows().find(r => r.id === id); }

  onDown(ev: PointerEvent) {
    const svg = ev.currentTarget as SVGSVGElement;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pointers.size === 2) { this.drag = null; this.panning = null; this.loupe.set(null); this.startPinch(); this.capture(svg, ev); return; }
    const p = this.toLocal(svg, ev.clientX, ev.clientY); if (!p) return;

    const cps = this.calPts();
    if (this.mode() === 'calibrate') {
      for (let k = 0; k < cps.length; k++) {
        if (Math.hypot(p.x - cps[k].x, p.y - cps[k].y) <= this.unit() * 5) { this.calDrag = k; this.setLoupe(ev.clientX, ev.clientY, p); this.capture(svg, ev); return; }
      }
      this.plateCircleAuto = false;
      this.calPts.set(cps.length >= 2 ? [p] : [...cps, p]);
      return;
    }
    if (this.mode() !== 'measure') return;
    if (this.panMode()) { this.panning = { x: ev.clientX, y: ev.clientY }; this.capture(svg, ev); return; }

    const tol = this.unit() * 4;
    const sel = this.rowById(this.selectedId());
    if (sel) {
      const r = this.ringR(sel, -0.785) * 0.707;
      if (Math.hypot(p.x - (sel.cx + r), p.y - (sel.cy - r)) <= this.unit() * 3.2) { this.deleteRow(sel.id); return; }
    }
    const rows = this.rows();
    for (let i = rows.length - 1; i >= 0; i--) {
      const d = rows[i];
      const dist = Math.hypot(p.x - d.cx, p.y - d.cy);
      const edgeR = this.ringR(d, Math.atan2(p.y - d.cy, p.x - d.cx));
      const ownR = (d.own.rx + d.own.ry) / 2;
      const edge = Math.abs(dist - edgeR) <= tol, center = dist <= Math.max(ownR * 0.8, tol);
      if (!edge && !center) continue;
      const now = Date.now();
      if (this.lastTap.id === d.id && now - this.lastTap.t < 350) { this.lastTap = { t: 0, id: -1 }; this.remeasure(d.id); return; }
      this.lastTap = { t: now, id: d.id };
      this.snapshot(); this.selectedId.set(d.id);
      this.drag = edge && !center ? { kind: 'resize', id: d.id, offx: 0, offy: 0 } : { kind: 'move', id: d.id, offx: p.x - d.cx, offy: p.y - d.cy };
      this.setLoupe(ev.clientX, ev.clientY, p); this.capture(svg, ev); return;
    }
    // A rejected circle (when shown) → promote it to a disk.
    if (this.showRejected()) {
      const rj = this.rejected().find(c => Math.hypot(p.x - c.cx, p.y - c.cy) <= c.r);
      if (rj) { this.addDisk(rj.cx, rj.cy, rj.r, true); this.rejected.update(l => l.filter(c => c !== rj)); return; }
    }
    // Empty spot → a new disk here; drag out its zone.
    this.snapshot();
    const row = this.addDisk(p.x, p.y, null, false);
    this.drag = { kind: 'create', id: row.id, offx: 0, offy: 0 };
    this.setLoupe(ev.clientX, ev.clientY, p); this.capture(svg, ev);
  }
  private addDisk(cx: number, cy: number, r: number | null, measure: boolean): DiskRow {
    const ruler = this.defaultRuler();
    const rr = r ?? (ruler.rx + ruler.ry) / 2;
    const n = Math.max(0, ...this.rows().map(x => x.n)) + 1;
    const row: DiskRow = {
      id: this.nextId++, n, cx, cy, own: { rx: rr, ry: rr, angle: 0 }, ruler, k: 1, zoneFound: false,
      code: null, codeSrc: null, aiConf: null, notDisk: false,
    };
    if (!measure) this.rows.update(l => [...l, row]);
    else { this.snapshot(); this.rows.update(l => [...l, row]); this.remeasure(row.id); }
    this.selectedId.set(row.id);
    return row;
  }
  /** Double-tap: re-measure one zone with OpenCV's gray at the ring's centre. */
  remeasure(id: number) {
    const v = this.vision, d = this.rowById(id), pc = this.plateCircle();
    if (!v || !d) return;
    const f = v.factor;
    const z = measureZone(v.gray,
      { cx: d.cx / f, cy: d.cy / f, rx: d.own.rx / f, ry: d.own.ry / f, angle: d.own.angle },
      { cx: d.cx / f, cy: d.cy / f, rx: d.ruler.rx / f, ry: d.ruler.ry / f, angle: d.ruler.angle },
      { plate: pc ? { cx: pc.cx / f, cy: pc.cy / f, r: pc.r / f } : null });
    this.rows.update(l => l.map(r => r.id === id ? { ...r, k: z.found ? z.k : 1, zoneFound: z.found } : r));
    this.selectedId.set(id);
    void this.cap.impact?.();
  }
  deleteRow(id: number) {
    this.snapshot();
    this.rows.update(l => l.filter(r => r.id !== id));
    this.selectedId.set(-1);
    this.updateScale();
  }

  onMove(ev: PointerEvent) {
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pointers.size >= 2) { this.doPinch(); return; }
    const svg = ev.currentTarget as SVGSVGElement;
    if (this.calDrag != null) {
      const p = this.toLocal(svg, ev.clientX, ev.clientY);
      if (p) { const k = this.calDrag; this.plateCircleAuto = false; this.calPts.update(c => c.map((pt, j) => j === k ? p : pt)); this.setLoupe(ev.clientX, ev.clientY, p); }
      return;
    }
    if (this.panning) { this.panByClient(ev.clientX - this.panning.x, ev.clientY - this.panning.y); this.panning = { x: ev.clientX, y: ev.clientY }; return; }
    if (!this.drag || this.mode() !== 'measure') return;
    const p = this.toLocal(svg, ev.clientX, ev.clientY); if (!p) return;
    const { id, kind, offx, offy } = this.drag;
    this.rows.update(list => list.map(d => {
      if (d.id !== id) return d;
      if (kind === 'move') return { ...d, cx: p.x - offx, cy: p.y - offy };
      const theta = Math.atan2(p.y - d.cy, p.x - d.cx);
      const k = Math.max(1, Math.hypot(p.x - d.cx, p.y - d.cy) / ellipseRadiusAt(d.ruler, theta));
      return { ...d, k, zoneFound: k > 1 };
    }));
    this.setLoupe(ev.clientX, ev.clientY, p);
  }
  onUp(ev: PointerEvent) {
    this.pointers.delete(ev.pointerId);
    if (this.pointers.size < 2) { this.pinchDist = 0; this.pinchMid = null; }
    if (this.calDrag != null) this.updateScale();
    this.panning = null; this.calDrag = null; this.loupe.set(null);
    this.drag = null;
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

  // ── Undo / redo ──────────────────────────────────────────────────
  private snapshot() { this.history.push(this.rows().map(r => ({ ...r }))); if (this.history.length > 40) this.history.shift(); this.future = []; }
  undo() { const prev = this.history.pop(); if (!prev) return; this.future.push(this.rows().map(r => ({ ...r }))); this.rows.set(prev); this.selectedId.set(-1); }
  redo() { const nxt = this.future.pop(); if (!nxt) return; this.history.push(this.rows().map(r => ({ ...r }))); this.rows.set(nxt); this.selectedId.set(-1); }

  // ── Keyboard ─────────────────────────────────────────────────────
  onKey(ev: KeyboardEvent) {
    const tag = (ev.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ctrl && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) this.redo(); else this.undo(); return; }
    if (ctrl && ev.key.toLowerCase() === 'y') { ev.preventDefault(); this.redo(); return; }
    if (this.mode() !== 'measure') return;
    const sel = this.rowById(this.selectedId());
    if (!sel) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.deleteRow(sel.id); return; }
    const step = ev.shiftKey ? 5 : 1;
    let dx = 0, dy = 0, dk = 0;
    switch (ev.key) {
      case 'ArrowLeft': dx = -step; break; case 'ArrowRight': dx = step; break;
      case 'ArrowUp': dy = -step; break; case 'ArrowDown': dy = step; break;
      case '[': dk = -step / DISK_MM; break; case ']': dk = step / DISK_MM; break;
      default: return;
    }
    ev.preventDefault();
    const now = Date.now();
    if (now - this.lastKeyEdit > 600) this.snapshot();
    this.lastKeyEdit = now;
    this.rows.update(list => list.map(d => d.id === sel.id ? { ...d, cx: d.cx + dx, cy: d.cy + dy, k: Math.max(1, d.k + dk) } : d));
  }

  dismissHint() { try { localStorage.setItem('pf-plate-hint2', '1'); } catch { /* */ } this.showHint.set(false); }

  readonly busyMsg = computed(() => this.measuring() ? 'Measuring the disks and zones…'
    : this.mode() === 'calibrate' && (this.plateState() === 'loading' || this.plateState() === 'finding') ? 'Finding the plate…' : '');

  private resolve(u: string): string {
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return u;
    return `${this.platform.getApiUrl()}${u}`;
  }
}

function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function nextFrame(): Promise<void> { return new Promise(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0))); }
