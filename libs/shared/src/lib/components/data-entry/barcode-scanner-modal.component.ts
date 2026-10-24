import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef,
  EventEmitter, HostListener, Input, OnDestroy, Output,
  ViewChild, computed, inject, signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BarcodeDetector } from 'barcode-detector/ponyfill';
import { NumPadComponent } from '../../primitives/num-pad.component.js';
import { normalizeTubeScan } from '../../scan/tube-scan.js';
import { ScanInputMode, ScanInputPrefService } from '../../scan/scan-input-pref.service.js';
import { HardwareScanService } from '../../scan/hardware-scan.service.js';

// Reusable barcode scanner modal. Three ways in, picked with the switch at
// the top and remembered per device (ScanInputPrefService; nothing chosen →
// the lab default: manualOnly → Type, else Camera):
//  1. Camera — live viewfinder + continuous decode (QR / barcode)
//  2. Scanner — a hardware (USB / Bluetooth) barcode scanner: no camera,
//     a "Ready — scan now" panel. Bursts come through HardwareScanService
//     (this window registers on top of its screen while open); a slower
//     scanner still lands through the document keydown buffer below.
//  3. Type — type the number
// A tube QR (`MRN|SampleID`) is reduced to the Sample ID before anything
// compares it (normalizeTubeScan).
//
// Emits (matched) with the decoded string only when it equals the
// caller's expectedBarcode (if one is provided). If no expected code is
// given, any scan emits.
//
// Failure path: if the caller passed an expectedBarcode and the scan
// doesn't match, we flash a "mismatch" state and keep the camera live
// so the tech can try the next vial without closing the modal.

@Component({
  selector: 'pf-barcode-scanner-modal',
  standalone: true,
  imports: [FormsModule, NumPadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-sc" role="dialog" aria-modal="true" [attr.aria-label]="displayTitle">
      <div class="pf-sc__backdrop" (click)="cancel()"></div>

      <!-- pf-card modal on web; the kit's .pf-sheet turns it into a tall
           sheet ABOVE the always-visible bottom navbar on phones. -->
      <div class="pf-sc__card pf-sheet" (click)="$event.stopPropagation()">
        <span class="pf-sheet__handle" aria-hidden="true"></span>

        <header class="pf-sc__head">
          <div class="pf-sc__bar">
            <span class="pf-card__icon pf-sc__ico" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
                <path d="M7 8v8M10.5 8v8M14 8v8M17 8v8"/>
              </svg>
            </span>
            <span class="pf-card__label pf-sc__label">{{ manualMode() ? 'Enter ' + noun : 'Scan ' + noun }}</span>
            <button type="button" class="pf-sc__close press" (click)="cancel()" aria-label="Close" title="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          </div>
          <h2 class="pf-sc__title">{{ displayTitle }}</h2>
          @if (expectedBarcode) {
            <div class="pf-sc__expect">
              <span class="pf-sc__expect-label">Expected</span>
              <span class="pf-sc__expect-id">{{ expectedBarcode }}</span>
            </div>
          } @else if (manualMode()) {
            <p class="pf-sc__sub">Type the {{ noun }} ID{{ noun === 'sample' ? ' from the container' : '' }}.</p>
          }
        </header>

        <div class="pf-sc__body">
          <div class="pf-seg pf-sc__modes" role="radiogroup" aria-label="How to read the code">
            <button type="button" class="pf-seg__item pf-sc__mode" role="radio" data-mode="camera"
                    [attr.aria-checked]="mode() === 'camera'" (click)="setMode('camera')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
                <circle cx="12" cy="13" r="3"/>
              </svg>
              Camera
            </button>
            <button type="button" class="pf-seg__item pf-sc__mode" role="radio" data-mode="scanner"
                    [attr.aria-checked]="mode() === 'scanner'" (click)="setMode('scanner')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 7V5h3M17 5h3v2M20 17v2h-3M7 19H4v-2"/>
                <path d="M8 9v6M11 9v6M14 9v6M17 9v6"/>
              </svg>
              Scanner
            </button>
            <button type="button" class="pf-seg__item pf-sc__mode" role="radio" data-mode="type"
                    [attr.aria-checked]="mode() === 'type'" (click)="setMode('type')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="2" y="6" width="20" height="12" rx="2"/>
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>
              </svg>
              Type
            </button>
          </div>

          <div class="pf-sc__viewport" [hidden]="mode() !== 'camera'">
            <video #video autoplay muted playsinline class="pf-sc__video" (click)="refocus()" title="Tap to focus"></video>
            @if (cameraReady()) {
              <div class="pf-sc__reticle" [class.pf-sc__reticle--bad]="!!lastMismatch()"
                   [class.pf-sc__reticle--ok]="!!matchedCode()" aria-hidden="true">
                <span class="pf-sc__corner pf-sc__corner--tl"></span>
                <span class="pf-sc__corner pf-sc__corner--tr"></span>
                <span class="pf-sc__corner pf-sc__corner--bl"></span>
                <span class="pf-sc__corner pf-sc__corner--br"></span>
                @if (!matchedCode()) { <span class="pf-sc__line"></span> }
                @if (matchedCode()) {
                  <span class="pf-sc__ok">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
                  </span>
                }
              </div>
            }
            <div class="pf-sc__tools">
              @if (canSwitchCamera()) {
                <button type="button" class="pf-sc__glass press" (click)="switchCamera()"
                        aria-label="Switch camera" title="Switch camera">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M23 4v6h-6M1 20v-6h6"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                </button>
              }
              @if (torchAvailable()) {
                <button type="button" class="pf-sc__glass press" [attr.data-on]="torchOn() ? '' : null"
                        (click)="toggleTorch()" [attr.aria-pressed]="torchOn()" aria-label="Toggle torch" title="Torch">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 18h6M10 22h4M12 2a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.3V16h6v-1.2c0-.9.4-1.7 1-2.3A6 6 0 0 0 12 2z"/>
                  </svg>
                </button>
              }
            </div>
            @if (!cameraReady()) {
              <div class="pf-sc__fallback">
                @if (cameraError()) {
                  <span class="pf-sc__fallback-ico" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         stroke-linecap="round" stroke-linejoin="round">
                      <path d="M2 2l20 20"/><path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14"/>
                      <path d="M9.5 4h5L17 7h3a2 2 0 0 1 2 2v7.5"/><path d="M14.1 14.1A3 3 0 0 1 9.9 9.9"/>
                    </svg>
                  </span>
                  <p class="pf-sc__fallback-title">{{ cameraError() }}</p>
                  <p class="pf-sc__fallback-hint">A handheld scanner still works — scan the vial and it lands here.</p>
                  <button type="button" class="pf-btn pf-btn--secondary press" (click)="setMode('type')">Type the number</button>
                } @else {
                  <p class="pf-sc__fallback-hint">Starting camera…</p>
                }
              </div>
            }
          </div>

          @if (mode() === 'scanner') {
            <div class="pf-sc__ready" role="status" aria-live="polite">
              <span class="pf-sc__ready-ico" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 7V5h3M17 5h3v2M20 17v2h-3M7 19H4v-2"/>
                  <path d="M8 9v6M11 9v6M14 9v6M17 9v6"/>
                </svg>
              </span>
              <p class="pf-sc__ready-title">
                <span class="pf-sc__pulse pf-sc__pulse--live" aria-hidden="true"></span>
                Ready — scan now
              </p>
              <p class="pf-sc__ready-hint">Scan the {{ noun }} barcode with the handheld scanner. No need to tap anything first.</p>
              @if (hidShown(); as hid) {
                <div class="pf-sc__hid">
                  <span class="pf-sc__hid-label">Last read</span>
                  <span class="pf-sc__chip">{{ hid }}</span>
                </div>
              }
            </div>
          }

          @if (mode() === 'camera') {
            <p class="pf-sc__status" aria-live="polite">
              <span class="pf-sc__pulse" [class.pf-sc__pulse--live]="cameraReady()" aria-hidden="true"></span>
              {{ cameraReady() ? 'Point the camera at the ' + noun + ' barcode, or scan with a handheld scanner.'
                               : 'Scan with a handheld scanner, or wait for the camera.' }}
            </p>
            @if (hidShown(); as hid) {
              <div class="pf-sc__hid">
                <span class="pf-sc__hid-label">Handheld scanner</span>
                <span class="pf-sc__chip">{{ hid }}</span>
              </div>
            }
          }

          @if (manualMode()) {
            <div class="pf-sc__manual">
              @if (parsedExpected(); as p) {
                <p class="pf-sc__manual-hint">Type the 5-digit sequence on the vial. The rest is locked to the expected barcode.</p>
                <div class="pf-sc__seg">
                  <span class="pf-sc__seg-part pf-sc__seg-part--locked">PF</span>
                  <span class="pf-sc__seg-sep">·</span>
                  <span class="pf-sc__seg-part pf-sc__seg-part--locked">{{ p.vendor }}</span>
                  <span class="pf-sc__seg-sep">·</span>
                  <span class="pf-sc__seg-part pf-sc__seg-part--locked">{{ p.year }}</span>
                  <span class="pf-sc__seg-sep">·</span>
                  <input #manualInput
                         class="pf-sc__seg-part pf-sc__seg-input"
                         [attr.inputmode]="isTouch() ? 'none' : 'numeric'"
                         [readonly]="isTouch()"
                         placeholder="00000"
                         aria-label="Sequence number"
                         [ngModel]="manualFull() || manualSeq()"
                         (ngModelChange)="onManualSeqChange($event)"
                         (keydown.enter)="submitManual()" />
                  <span class="pf-sc__seg-sep">·</span>
                  <span class="pf-sc__seg-part pf-sc__seg-part--locked">{{ p.dept }}</span>
                </div>
                @if (isTouch()) {
                  <div class="pf-sc__numpad">
                    <pf-num-pad
                      [value]="manualSeq()"
                      [allowDecimal]="false"
                      [allowNegative]="false"
                      [maxLength]="5"
                      (valueChange)="onManualSeqChange($event)"></pf-num-pad>
                  </div>
                }
                <button #confirmBtn
                        type="button"
                        class="pf-btn pf-btn--primary pf-sc__confirm press"
                        [disabled]="manualSeq().length !== 5 && !manualFull()"
                        (click)="submitManual()">
                  Confirm
                </button>
              } @else {
                <!-- Short sample IDs (LAB26001, BIO260800003…) don't segment —
                     type the full number off the container. Same handleScan path,
                     so the wrong-vial guard still applies. -->
                <label class="pf-sc__manual-hint" for="pf-sc-free">Type the {{ noun }} ID{{ noun === 'sample' ? ' written on the container' : '' }}.</label>
                <input #manualInput id="pf-sc-free"
                       class="pf-sc__free-input uppercase"
                       type="text" autocapitalize="characters" autocomplete="off" spellcheck="false"
                       [placeholder]="expectedBarcode || nounId"
                       [ngModel]="manualFree()"
                       (ngModelChange)="manualFree.set($event)"
                       (keydown.enter)="submitManualFree()" />
                <button type="button"
                        class="pf-btn pf-btn--primary pf-sc__confirm press"
                        [disabled]="!manualFree().trim()"
                        (click)="submitManualFree()">
                  Confirm
                </button>
              }
            </div>
          }

          @if (lastMismatch(); as code) {
            <div class="pf-sc__mismatch" role="alert">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
              </svg>
              <span>Scanned <b>{{ code }}</b> — this isn't the expected sample (<b>{{ expectedBarcode }}</b>).</span>
            </div>
          }
        </div>

        <footer class="pf-sc__foot">
          <button type="button" class="pf-btn pf-btn--tertiary pf-sc__cancel press" (click)="cancel()">Cancel</button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    /* New-design scanner (owner): pf-card modal / phone sheet, BILLING
       header, readable expected-ID chip, Apple-style corner reticle, calm
       status line, red ONLY for the wrong-vial warning. One font family
       (Noto Sans, tabular numbers for IDs) — never monospace. */
    :host { display: block; }

    .pf-sc {
      position: fixed; inset: 0;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      /* Above page FABs and the floating nav; a modal owns the screen. */
      z-index: 1000;
      font-family: inherit;
    }
    .pf-sc__backdrop {
      position: absolute; inset: 0;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    .pf-sc__card {
      position: relative;
      width: 100%; max-width: 460px; max-height: calc(100dvh - 32px);
      display: flex; flex-direction: column;
      background: var(--pf-card-bg, var(--bg-card-solid));
      border: 1px solid var(--pf-line, var(--glass-border));
      border-radius: var(--pf-radius-card, 16px);
      box-shadow: 0 24px 64px rgba(15, 23, 42, 0.22), var(--pf-shadow-sm, none);
      overflow: hidden;
      animation: pf-sc-in var(--pf-dur, 320ms) var(--pf-spring, ease) both;
    }
    @keyframes pf-sc-in {
      from { opacity: 0; transform: translateY(10px) scale(0.98); }
      to   { opacity: 1; transform: none; }
    }

    /* ── Header: exactly the BILLING card header ── */
    .pf-sc__head { flex: none; padding: 14px 16px 12px; }
    .pf-sc__bar { display: flex; align-items: center; gap: 10px; }
    .pf-sc__label { flex: 1 1 auto; min-width: 0; }
    .pf-sc__close {
      flex: none; width: 32px; height: 32px; margin-right: -4px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 8px; border: 0; background: transparent; cursor: pointer;
      color: var(--text-tertiary);
    }
    .pf-sc__close:hover { background: var(--pf-chip-bg); color: var(--text-primary); }
    .pf-sc__title {
      margin: 12px 0 0; font-size: 18px; font-weight: 600; line-height: 1.3;
      color: var(--text-primary); text-wrap: balance;
    }
    .pf-sc__sub { margin: 4px 0 0; font-size: 13px; color: var(--text-tertiary); }
    .pf-sc__expect {
      display: inline-flex; align-items: center; gap: 8px; margin-top: 8px;
      padding: 5px 10px; border-radius: var(--pf-radius-chip, 8px);
      background: var(--pf-chip-bg);
    }
    .pf-sc__expect-label { font-size: 12px; color: var(--text-tertiary); }
    .pf-sc__expect-id {
      font-size: 14px; font-weight: 600; color: var(--text-primary);
      font-variant-numeric: tabular-nums; letter-spacing: 0.01em;
    }

    .pf-sc__body {
      flex: 1 1 auto; min-height: 0; overflow-y: auto;
      padding: 0 16px 14px; display: flex; flex-direction: column; gap: 10px;
    }

    /* ── Camera · Scanner · Type switch (kit .pf-seg, neutral selected) ── */
    .pf-sc__modes { display: flex; width: 100%; flex: none; }
    .pf-sc__mode {
      flex: 1 1 0; min-width: 0; height: 36px;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      white-space: nowrap;
    }
    @media (pointer: coarse) { .pf-sc__mode { height: 44px; } }

    /* ── Hardware scanner: ready panel (no camera) ── */
    .pf-sc__ready {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 28px 20px; text-align: center;
      border-radius: var(--pf-radius, 12px);
      background: var(--pf-chip-bg); border: 1px solid var(--pf-line);
    }
    .pf-sc__ready-ico {
      width: 52px; height: 52px; border-radius: 14px; margin-bottom: 4px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--pf-card-bg); color: var(--text-secondary);
      border: 1px solid var(--pf-line);
    }
    .pf-sc__ready-title {
      display: inline-flex; align-items: center; gap: 8px; margin: 0;
      font-size: 16px; font-weight: 600; color: var(--text-primary);
    }
    .pf-sc__ready-title .pf-sc__pulse { margin-top: 0; }
    .pf-sc__ready-hint { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text-tertiary); text-wrap: pretty; max-width: 320px; }
    .pf-sc__ready .pf-sc__hid { justify-content: center; margin-top: 6px; }

    /* ── Camera viewport ── */
    .pf-sc__viewport {
      position: relative; flex: none;
      aspect-ratio: 4 / 3;
      border-radius: var(--pf-radius, 12px);
      background: #0b0d12;
      overflow: hidden;
    }
    .pf-sc__viewport[hidden] { display: none; }
    .pf-sc__video { display: block; width: 100%; height: 100%; object-fit: cover; cursor: pointer; }

    /* The scan window: four white corner brackets; everything outside is
       dimmed by the reticle's own oversized shadow. */
    .pf-sc__reticle {
      position: absolute; inset: 16% 12%;
      border-radius: 14px; pointer-events: none;
      box-shadow: 0 0 0 9999px rgba(8, 10, 16, 0.45);
      --pf-sc-corner: #ffffff;
    }
    .pf-sc__corner {
      position: absolute; width: 26px; height: 26px;
      border: 3px solid var(--pf-sc-corner);
      transition: border-color var(--pf-dur-fast, 200ms) ease;
    }
    .pf-sc__corner--tl { top: 0; left: 0; border-right: 0; border-bottom: 0; border-top-left-radius: 14px; }
    .pf-sc__corner--tr { top: 0; right: 0; border-left: 0; border-bottom: 0; border-top-right-radius: 14px; }
    .pf-sc__corner--bl { bottom: 0; left: 0; border-right: 0; border-top: 0; border-bottom-left-radius: 14px; }
    .pf-sc__corner--br { bottom: 0; right: 0; border-left: 0; border-top: 0; border-bottom-right-radius: 14px; }
    .pf-sc__reticle--bad { --pf-sc-corner: #ef4444; animation: pf-sc-shake 0.32s ease both; }
    .pf-sc__reticle--ok { --pf-sc-corner: var(--color-primary, #7c3aed); }
    @keyframes pf-sc-shake {
      25% { transform: translateX(-4px); } 75% { transform: translateX(4px); }
    }
    .pf-sc__line {
      position: absolute; left: 10px; right: 10px; top: 8%; height: 2px; border-radius: 2px;
      background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-primary, #7c3aed) 85%, #fff), transparent);
      opacity: 0.8;
      animation: pf-sc-sweep 2.4s ease-in-out infinite alternate;
    }
    @keyframes pf-sc-sweep { from { top: 8%; } to { top: 92%; } }
    .pf-sc__ok {
      position: absolute; top: 50%; left: 50%;
      width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 9999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--color-primary, #7c3aed); color: #fff;
      box-shadow: 0 8px 24px rgba(124, 58, 237, 0.4);
      animation: pf-sc-pop 0.28s var(--pf-spring-bounce, ease) both;
    }
    @keyframes pf-sc-pop { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: none; } }

    .pf-sc__tools {
      position: absolute; top: 10px; right: 10px; z-index: 2;
      display: flex; flex-direction: column; gap: 8px;
    }
    .pf-sc__glass {
      width: 40px; height: 40px; border-radius: 9999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(255, 255, 255, 0.16); color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.28); cursor: pointer;
      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
      transition: background var(--pf-dur-fast, 200ms) ease;
    }
    .pf-sc__glass:hover { background: rgba(255, 255, 255, 0.26); }
    .pf-sc__glass[data-on] { background: #fff; color: #111827; }

    .pf-sc__fallback {
      position: absolute; inset: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px; padding: 20px; text-align: center;
      background: var(--pf-chip-bg); color: var(--text-secondary);
    }
    .pf-sc__fallback-ico {
      width: 40px; height: 40px; border-radius: 12px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--pf-card-bg); color: var(--text-tertiary);
    }
    .pf-sc__fallback-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); text-wrap: balance; }
    .pf-sc__fallback-hint { margin: 0 0 4px; font-size: 13px; color: var(--text-tertiary); text-wrap: pretty; }

    /* ── Live status line (app font, sentence case) ── */
    .pf-sc__status {
      display: flex; align-items: flex-start; gap: 8px; margin: 2px 0 0;
      font-size: 13px; line-height: 1.45; color: var(--text-secondary);
    }
    .pf-sc__pulse {
      flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 9999px;
      background: var(--text-muted, #9ca3af);
    }
    .pf-sc__pulse--live {
      background: var(--color-primary, #7c3aed);
      animation: pf-sc-pulse 1.6s ease-in-out infinite;
    }
    @keyframes pf-sc-pulse {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary, #7c3aed) 45%, transparent); }
      50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--color-primary, #7c3aed) 0%, transparent); }
    }
    .pf-sc__hid { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-sc__hid-label { font-size: 12px; color: var(--text-tertiary); }
    .pf-sc__chip {
      display: inline-flex; align-items: center; max-width: 100%;
      padding: 3px 9px; border-radius: var(--pf-radius-chip, 8px);
      background: var(--pf-chip-bg); color: var(--text-primary);
      font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }

    /* ── Wrong vial: the one red thing on the modal ── */
    .pf-sc__mismatch {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 10px 12px; border-radius: var(--pf-radius-sm, 10px);
      background: color-mix(in srgb, #ef4444 9%, var(--pf-card-bg, #fff));
      border: 1px solid color-mix(in srgb, #ef4444 35%, transparent);
      color: var(--red-text, #b91c1c);
      font-size: 13px; line-height: 1.45;
    }
    .pf-sc__mismatch svg { flex: none; margin-top: 2px; }
    .pf-sc__mismatch b { font-weight: 600; font-variant-numeric: tabular-nums; }

    /* ── Manual entry (kit inputs) ── */
    .pf-sc__manual { display: flex; flex-direction: column; gap: 12px; padding-top: 2px; }
    .pf-sc__manual-hint { margin: 0; font-size: 13px; color: var(--text-tertiary); }
    .pf-sc__seg {
      display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap;
      width: 100%; max-width: 360px; margin-inline: auto;
      padding: 12px 14px; border-radius: var(--pf-radius, 12px);
      background: var(--pf-chip-bg); border: 1px solid var(--pf-line);
      font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums;
    }
    .pf-sc__seg-part { color: var(--text-primary); }
    .pf-sc__seg-sep { color: var(--text-muted); }
    .pf-sc__seg-part--locked { color: var(--text-tertiary); }
    .pf-sc__seg-input {
      flex: 1 0 110px; min-width: 110px; max-width: 170px; height: 40px;
      background: var(--pf-card-bg); border: 1px solid var(--pf-line);
      border-radius: var(--pf-radius-sm, 10px); padding: 0 10px; outline: none;
      font: inherit; color: var(--text-primary); text-align: center; letter-spacing: 0.12em;
    }
    .pf-sc__seg-input:focus, .pf-sc__free-input:focus {
      border-color: var(--color-violet-600, #7c3aed);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent);
    }
    .pf-sc__seg-input::placeholder { color: var(--text-muted); }
    .pf-sc__numpad { width: 100%; max-width: 360px; margin-inline: auto; }
    .pf-sc__numpad pf-num-pad { display: block; width: 100%; }
    .pf-sc__free-input {
      width: 100%; height: 48px; padding: 0 14px; outline: none;
      background: var(--pf-card-bg); border: 1px solid var(--pf-line);
      border-radius: var(--pf-radius-sm, 10px); color: var(--text-primary);
      font: inherit; font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums;
    }
    .pf-sc__confirm { width: 100%; max-width: 360px; margin-inline: auto; }

    /* ── Footer: pf-card sticky foot — secondary + tertiary, no primary ── */
    .pf-sc__foot {
      flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 8px;
      padding: 12px 16px; border-top: 1px solid var(--pf-line);
      background: var(--pf-card-bg);
    }
    .pf-sc__cancel { color: var(--text-secondary); padding: 0 12px; }
    .pf-sc__cancel:hover { color: var(--text-primary); }

    /* ── Phones: tall sheet above the always-visible bottom navbar ── */
    @media (max-width: 640px) {
      .pf-sc { padding: 0; bottom: var(--pf-nav-h, 0px); align-items: flex-end; }
      .pf-sc__card {
        max-width: none; max-height: none; border-radius: 20px 20px 0 0;
        border-bottom: 0;
      }
      :host-context(html.cap-native) .pf-sc__card {
        width: 100%; height: 100%;
        border: 0; border-radius: 0; box-shadow: none;
      }
      .pf-sc__viewport { aspect-ratio: auto; flex: 1 1 260px; min-height: 240px; }
      .pf-sc__ready { flex: 1 1 auto; justify-content: center; }
      .pf-sc__foot { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
      .pf-sc__foot .pf-btn { flex: 1 1 0; }
      .pf-sc__glass { width: 44px; height: 44px; }
    }
    @media (pointer: coarse) {
      .pf-sc__close { width: 44px; height: 44px; margin-right: -8px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pf-sc__card, .pf-sc__ok, .pf-sc__reticle--bad { animation: none; }
      .pf-sc__line { display: none; }
      .pf-sc__pulse--live { animation: none; }
    }
`]
})
export class BarcodeScannerModalComponent implements AfterViewInit, OnDestroy {
  @Input() title = 'Scan vial barcode';
  @Input() expectedBarcode?: string;
  /** The lab's default for this window: the tenant runs in Manual mode, so
   *  the window opens on Type (no camera starts) unless THIS device chose
   *  another way with the Camera · Scanner · Type switch (remembered per
   *  device). The title/hints read as "enter" while Type is on. */
  @Input() manualOnly = false;
  /** What is being scanned, for the header / hints ("sample" by default;
   *  the billing counter passes "invoice or order"). Additive. */
  @Input() noun = 'sample';
  protected get nounId(): string { return this.noun.charAt(0).toUpperCase() + this.noun.slice(1) + ' ID'; }

  /** Caller titles say "Scan vial to claim" etc. — reword for typing-only. */
  protected get displayTitle(): string {
    return this.manualMode() ? this.title.replace(/^Scan\b/i, 'Enter') : this.title;
  }

  private readonly prefs = inject(ScanInputPrefService);
  private readonly hardware = inject(HardwareScanService);
  private hardwareOff: (() => void) | null = null;

  @Output() matched = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('video') videoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('manualInput') manualInputEl?: ElementRef<HTMLInputElement>;
  @ViewChild('confirmBtn') confirmBtnEl?: ElementRef<HTMLButtonElement>;

  // Camera stream owned directly (not by a decoding library) so we can request
  // a high-resolution feed + continuous autofocus + torch — the levers that let
  // a code be read at arm's length instead of pressed against the lens.
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  // Native BarcodeDetector when the browser has it (hardware-accelerated),
  // otherwise a ZXing-C++ WebAssembly fallback — both far stronger than the old
  // pure-JS decoder.
  private detector: BarcodeDetector | null = null;
  private rafId: number | null = null;
  private active = false;
  private lastDetectAt = 0;
  // Auto-refocus: continuous AF (Chrome/Android) gets stuck when the scene
  // changes (an object comes near then leaves), so we re-trigger focus when the
  // decoder has seen nothing for a beat — that's the "out of focus" signal.
  private focusSupported = false;
  private lastCodeSeenAt = 0;
  private lastFocusKickAt = 0;
  private focusKicking = false;
  private static readonly FOCUS_STALE_MS = 1200;   // no code seen → likely blurry
  private static readonly FOCUS_KICK_GAP_MS = 1600; // min gap between kicks

  protected readonly cameraReady = signal(false);
  protected readonly cameraError = signal<string | null>(null);
  protected readonly lastMismatch = signal<string | null>(null);
  protected readonly torchAvailable = signal(false);
  protected readonly torchOn = signal(false);
  /** Which camera to open, and whether a second one exists to switch to. */
  private readonly facing = signal<'environment' | 'user'>('environment');
  protected readonly canSwitchCamera = signal(false);

  // HID barcode guns emit keystrokes and terminate with Enter. We buffer
  // recent keys while the modal is open and treat the buffer as a scanned
  // code when Enter fires.
  private _hidBuffer = '';
  private _hidLastKeyAt = 0;
  protected readonly hidBuffer = signal<string>('');
  /** Last complete handheld read — shown as a chip once one arrives. */
  protected readonly lastHid = signal<string>('');
  /** What the "Handheld scanner" row shows: keys as they stream, then the read. */
  protected readonly hidShown = computed(() => this.hidBuffer() || this.lastHid());
  /** Set on a match: the reticle shows a violet check for a beat, then emits. */
  protected readonly matchedCode = signal<string | null>(null);
  /** How long the match check stays up before the caller takes over. */
  static MATCH_HOLD_MS = 320;

  /** Camera · Scanner · Type — set in ngAfterViewInit from the device's
   *  remembered choice (else the lab default), changed by the switch. */
  protected readonly mode = signal<ScanInputMode>('camera');
  // Manual entry: with a segmentable expectedBarcode we lock
  // vendor/year/dept and just collect the 5-digit sequence. The
  // submit path runs through handleScan, so the existing match-or-flash
  // logic still protects against wrong vials.
  protected readonly manualMode = computed(() => this.mode() === 'type');
  protected readonly manualSeq = signal('');
  /** A whole code typed / scanned into the 5-digit box (a scanner that types
   *  the full PF-… ID, or a tube QR) — submitted as is. */
  protected readonly manualFull = signal('');
  /** Free-text sample ID for short codes that don't segment (LAB26001…). */
  protected readonly manualFree = signal('');
  protected readonly isTouch = signal<boolean>(
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  );

  protected readonly parsedExpected = computed<{ vendor: string; year: string; seq: string; dept: string } | null>(() => {
    const ex = (this.expectedBarcode ?? '').trim();
    if (!ex) return null;
    // Format: PF-{vendor}-{year}-{seq}-{dept}
    const m = ex.match(/^PF-([A-Za-z0-9]+)-(\d{4})-(\d+)-([A-Za-z0-9]+)$/);
    if (!m) return null;
    return { vendor: m[1].toUpperCase(), year: m[2], seq: m[3], dept: m[4].toUpperCase() };
  });

  async ngAfterViewInit() {
    // Mark the scanner as open so the shell can hide the floating bottom-nav
    // pill while it's up (the modal is rendered inside a page, so its fixed
    // positioning can't cover the root-level nav — hide it instead). Removed
    // again in ngOnDestroy. The component only exists while open (@if).
    try { document.body.classList.add('pf-scanner-open'); } catch { /* SSR */ }
    // While open, hardware-scanner bursts come to THIS window (on top of the
    // screen's own handler) whichever way is picked.
    this.hardwareOff = this.hardware.register(code => this.onHardwareScan(code));
    await this.applyMode(this.prefs.modeFor(this.manualOnly));
  }

  ngOnDestroy() {
    this.hardwareOff?.();
    this.hardwareOff = null;
    this.stopCamera();
    try { document.body.classList.remove('pf-scanner-open'); } catch { /* SSR */ }
  }

  /** The switch: pick a way in and remember it on this device. */
  async setMode(m: ScanInputMode) {
    if (m === this.mode() && (m !== 'camera' || this.stream)) return;
    this.prefs.set(m);
    await this.applyMode(m);
  }

  /** Show the chosen way: only Camera holds the camera; Type focuses the box. */
  private async applyMode(m: ScanInputMode) {
    this.mode.set(m);
    if (m !== 'camera') {
      this.stopCamera();
      this.cameraError.set(null);
      if (m === 'type') setTimeout(() => this.manualInputEl?.nativeElement.focus(), 50);
      return;
    }
    if (this.stream || this.cameraStarting) return;
    if (!this.detector) {
      this.detector = new BarcodeDetector({
        // Every symbology a tube/label or requisition could carry, incl. the new
        // Data Matrix option and the existing QR + Code128.
        formats: ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13', 'ean_8',
          'itf', 'codabar', 'upc_a', 'upc_e', 'pdf417', 'aztec'],
      });
    }
    this.cameraStarting = true;
    try { await this.startCamera(); } finally { this.cameraStarting = false; }
  }
  /** getUserMedia in flight — a second tap on Camera must not open a second stream. */
  private cameraStarting = false;

  /** A hardware-scanner burst (HardwareScanService) — already normalised. */
  private onHardwareScan(code: string) {
    this._hidBuffer = '';
    this.hidBuffer.set('');
    this.lastHid.set(code);
    this.handleScan(code);
  }

  /** Open a high-res back-camera stream, enable continuous autofocus + detect
   *  torch support, then start the detection loop. */
  private async startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: this.facing() },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      // The switch moved off Camera while the permission prompt was up.
      if (this.mode() !== 'camera') { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      this.track = stream.getVideoTracks()[0] ?? null;
      const video = this.videoEl.nativeElement;
      video.srcObject = stream;
      video.onloadedmetadata = () => { this.cameraReady.set(true); video.play().catch(() => { /* ignore */ }); };
      await video.play().catch(() => { /* autoplay may need the metadata event */ });
      // Continuous autofocus keeps codes sharp across distances (best-effort;
      // silently ignored where the platform doesn't expose focusMode).
      try { await this.track?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }); } catch { /* unsupported */ }
      try {
        const caps = this.track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }) | undefined;
        this.torchAvailable.set(!!caps && 'torch' in caps);
        // Only run the auto-refocus loop where the platform actually exposes
        // focus control (Chrome/Android); elsewhere it's a harmless no-op.
        this.focusSupported = !!caps?.focusMode && (caps.focusMode.includes('single-shot') || caps.focusMode.includes('continuous'));
      } catch { /* unsupported */ }
      this.lastCodeSeenAt = performance.now();
      this.lastFocusKickAt = performance.now();
      // Show the camera-switch button only if a second camera exists (labels
      // are populated once permission is granted, which it now is).
      try {
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        this.canSwitchCamera.set(cams.length > 1);
      } catch { /* unsupported */ }
      this.active = true;
      this.lastDetectAt = 0;
      this.rafId = requestAnimationFrame(this.scanTick);
    } catch (err) {
      this.cameraError.set(this.friendlyError(err));
    }
  }

  /** rAF detection loop, throttled to ~8 detections/sec (a full-rate detect is
   *  wasteful and can starve the decoder). */
  private scanTick = () => {
    if (!this.active) return;
    const video = this.videoEl?.nativeElement;
    if (this.detector && video && video.readyState >= 2) {
      const now = performance.now();
      if (now - this.lastDetectAt >= 120) {
        this.lastDetectAt = now;
        this.detector.detect(video).then(codes => {
          if (this.active && codes && codes.length) {
            this.lastCodeSeenAt = performance.now(); // a code is visible → in focus
            if (codes[0].rawValue) this.handleScan(codes[0].rawValue);
          }
        }).catch(() => { /* transient decode error — keep scanning */ });
      }
      // Nothing decoded for a beat ⇒ likely out of focus (continuous AF stuck
      // after the scene changed). Re-trigger focus, rate-limited.
      if (this.focusSupported && !this.focusKicking
          && now - this.lastCodeSeenAt > BarcodeScannerModalComponent.FOCUS_STALE_MS
          && now - this.lastFocusKickAt > BarcodeScannerModalComponent.FOCUS_KICK_GAP_MS) {
        this.lastFocusKickAt = now;
        void this.kickFocus();
      }
    }
    if (this.active) this.rafId = requestAnimationFrame(this.scanTick);
  };

  /** Stop the detection loop and release the camera. */
  private stopCamera() {
    this.active = false;
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    this.stream = null;
    this.track = null;
    this.torchOn.set(false);
    this.cameraReady.set(false);
  }

  /** Toggle the camera torch (labs are dim and tubes are glossy). */
  async toggleTorch() {
    if (!this.track) return;
    const next = !this.torchOn();
    try {
      await this.track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      this.torchOn.set(next);
    } catch { /* torch not supported on this device */ }
  }

  /** Switch between the front/back cameras (mobile devices). */
  async switchCamera() {
    this.facing.update(f => (f === 'environment' ? 'user' : 'environment'));
    this.stopCamera();
    await this.startCamera();
  }

  /** Tap-to-focus: manual re-trigger. */
  async refocus() {
    this.lastCodeSeenAt = performance.now(); // avoid an immediate auto-kick on top
    await this.kickFocus();
  }

  /** Re-trigger the camera's autofocus. The reliable "kick" across Android
   *  devices is single-shot → back to continuous (a plain re-apply of
   *  'continuous' often doesn't force a re-hunt once it's stuck). Falls back to
   *  a focusDistance sweep, then to re-applying continuous. */
  private async kickFocus() {
    const track = this.track;
    if (!track || this.focusKicking) return;
    this.focusKicking = true;
    try {
      const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[]; focusDistance?: { min: number; max: number } }) | undefined;
      const modes = caps?.focusMode ?? [];
      if (modes.includes('single-shot')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' } as MediaTrackConstraintSet] });
        await new Promise(r => setTimeout(r, 500));
        if (modes.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => { /* noop */ });
        }
      } else if (caps?.focusDistance && modes.includes('manual')) {
        // Sweep the focus distance to force a re-hunt, then return to continuous.
        const { min, max } = caps.focusDistance;
        await track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: min } as MediaTrackConstraintSet] });
        await new Promise(r => setTimeout(r, 250));
        await track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: max } as MediaTrackConstraintSet] });
        await new Promise(r => setTimeout(r, 250));
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => { /* noop */ });
      } else {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => { /* noop */ });
      }
    } catch { /* unsupported on this platform */ }
    finally { this.focusKicking = false; }
  }

  @HostListener('document:keydown', ['$event'])
  onKey(ev: KeyboardEvent) {
    if (this.manualMode() && ev.key === 'Enter') {
      if (this.manualSeq().length === 5 || this.manualFull()) {
        ev.preventDefault();
        this.submitManual();
        return;
      }
    }

    const target = ev.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    // Ignore modifier-only keys and typical navigation keys.
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;

    const now = Date.now();
    // If more than 600 ms passed since the last keystroke, start a fresh
    // buffer — this stops accidental human typing from piling up between
    // scans. Scanner guns emit their whole string in a few dozen ms.
    if (now - this._hidLastKeyAt > 600) this._hidBuffer = '';
    this._hidLastKeyAt = now;

    if (ev.key === 'Enter') {
      if (this._hidBuffer) {
        this.lastHid.set(this._hidBuffer);
        this.handleScan(this._hidBuffer);
      }
      this._hidBuffer = '';
      this.hidBuffer.set('');
      return;
    }
    if (ev.key.length === 1) {
      this._hidBuffer += ev.key;
      this.hidBuffer.set(this._hidBuffer);
    }
  }

  private handleScan(code: string) {
    // A tube QR carries `MRN|SampleID` — compare / emit the Sample ID.
    const trimmed = normalizeTubeScan(code);
    if (!trimmed) return;

    if (this.expectedBarcode && trimmed.toLowerCase() !== this.expectedBarcode.toLowerCase()) {
      this.lastMismatch.set(trimmed);
      // Clear the mismatch flash after 2.5s so the tech can see the next scan.
      setTimeout(() => {
        if (this.lastMismatch() === trimmed) this.lastMismatch.set(null);
      }, 2500);
      return;
    }

    if (this.matchedCode()) return; // already matched — ignore repeat frames
    this.lastMismatch.set(null);
    // Camera mode: pop the violet check over the reticle for a beat, then
    // hand off exactly as before. Manual / camera-less: hand off at once.
    const showCheck = this.cameraReady() && !this.manualMode();
    if (!showCheck) { this.stopCamera(); this.matched.emit(trimmed); return; }
    // Stop decoding now (no double-emit) but keep the frame on screen under
    // the check; the stream is released just before the hand-off.
    this.active = false;
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.matchedCode.set(trimmed);
    setTimeout(() => { this.stopCamera(); this.matched.emit(trimmed); },
      BarcodeScannerModalComponent.MATCH_HOLD_MS);
  }

  cancel() {
    this.stopCamera();
    this.cancelled.emit();
  }

  /** Type ↔ Camera (kept for callers / the camera-error panel). */
  toggleManual() {
    void this.setMode(this.manualMode() ? 'camera' : 'type');
  }

  onManualSeqChange(v: string) {
    const raw = (v ?? '').trim();
    // More than the 5-digit tail, or letters / dashes / a "|": a whole code
    // (a scanner typing the full PF-… ID, a tube QR) — keep it whole.
    if (raw.length > 5 || /[^0-9]/.test(raw)) {
      this.manualFull.set(raw);
      this.manualSeq.set('');
      return;
    }
    this.manualFull.set('');
    this.manualSeq.set(raw);
  }

  submitManual() {
    const full = this.manualFull();
    if (full) { this.handleScan(full); return; }
    const p = this.parsedExpected();
    if (!p) return;
    if (this.manualSeq().length !== 5) return;

    // Focus confirm button to show active/focus state
    this.confirmBtnEl?.nativeElement.focus();

    const assembled = `PF-${p.vendor}-${p.year}-${this.manualSeq().padStart(5, '0')}-${p.dept}`;
    // Same path as scan/HID — the mismatch-flash logic still applies if
    // the typed seq doesn't match the expected one, so we never claim the
    // wrong vial by typo.
    this.handleScan(assembled);
  }

  /** Free-text sample-ID confirm (short codes) — same handleScan path, so the
   *  wrong-vial mismatch guard still applies. */
  submitManualFree() {
    const v = this.manualFree().trim().toUpperCase();
    if (!v) return;
    this.handleScan(v);
  }

  private friendlyError(err: unknown): string {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (msg.includes('permission')) return 'Camera permission denied. Allow access in your browser settings and retry.';
    if (msg.includes('not found') || msg.includes('no camera')) return 'No camera detected on this device.';
    if (msg.includes('not readable')) return 'Another app is using the camera. Close it and retry.';
    return 'Could not start the camera.';
  }
}
