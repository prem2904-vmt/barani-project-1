import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef,
  EventEmitter, HostListener, Input, OnDestroy, Output,
  ViewChild, computed, signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BarcodeDetector } from 'barcode-detector/ponyfill';
import { NumPadComponent } from '../../primitives/num-pad.component';

// Reusable barcode scanner modal. Two input channels:
//  1. Camera via @zxing/browser → live viewfinder + continuous decode
//  2. HID barcode gun → captured via a global keydown listener while open;
//     gun input ends with Enter, which finalises the buffered code
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
    <div class="pf-sc" role="dialog" aria-modal="true" [attr.aria-label]="title">
      <div class="pf-sc__backdrop" (click)="cancel()"></div>

      <div class="pf-sc__card" (click)="$event.stopPropagation()">
        <header class="pf-sc__head">
          <div class="pf-sc__eyebrow">
            <span class="pf-sc__dot" [class.pf-sc__dot--live]="cameraReady()"></span>
            Scanner · {{ cameraReady() ? 'LIVE' : 'STARTING' }}
          </div>
          <h2 class="pf-sc__title">{{ title }}</h2>
          @if (expectedBarcode) {
            <p class="pf-sc__sub">Expected: <span class="pf-sc__code">{{ expectedBarcode }}</span></p>
          } @else {
            <p class="pf-sc__sub">Aim at the barcode on the vial.</p>
          }
          <button type="button" class="pf-sc__close press" (click)="cancel()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </header>

        <div class="pf-sc__viewport" [hidden]="manualMode()">
          <video #video autoplay muted playsinline class="pf-sc__video" (click)="refocus()" title="Tap to focus"></video>
          <div class="pf-sc__frame" aria-hidden="true"></div>
          @if (torchAvailable()) {
            <button type="button" class="pf-sc__torch" [class.pf-sc__torch--on]="torchOn()"
                    (click)="toggleTorch()" [attr.aria-pressed]="torchOn()" aria-label="Toggle torch" title="Torch">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18h6M10 22h4M12 2a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.3V16h6v-1.2c0-.9.4-1.7 1-2.3A6 6 0 0 0 12 2z"/>
              </svg>
            </button>
          }
          @if (canSwitchCamera()) {
            <button type="button" class="pf-sc__torch pf-sc__switch" (click)="switchCamera()"
                    aria-label="Switch camera" title="Switch camera">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          }
          @if (!cameraReady()) {
            <div class="pf-sc__viewport-fallback">
              @if (cameraError()) {
                <p>{{ cameraError() }}</p>
                <p class="pf-sc__viewport-hint">You can still scan with a handheld gun — it types into this modal automatically.</p>
              } @else {
                <p>Waiting for camera…</p>
              }
            </div>
          }
        </div>

        @if (manualMode()) {
          <div class="pf-sc__manual">
            @if (parsedExpected(); as p) {
              <p class="pf-sc__manual-hint">Type the 5-digit sequence on the vial. Other parts are locked to the expected barcode.</p>
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
                       pattern="[0-9]*"
                       maxlength="5"
                       placeholder="00000"
                       [ngModel]="manualSeq()"
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
                      class="pf-sc__manual-confirm press"
                      [disabled]="manualSeq().length !== 5"
                      (click)="submitManual()">
                Confirm
              </button>
            } @else {
              <p class="pf-sc__manual-hint">Manual entry isn't available without an expected barcode. Use the search bar's manual option instead.</p>
            }
          </div>
        }

        @if (lastMismatch(); as code) {
          <div class="pf-sc__mismatch" role="alert">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
            </svg>
            Scanned <b>{{ code }}</b> — expected <b>{{ expectedBarcode }}</b>. Keep the correct vial and try again.
          </div>
        }

        <footer class="pf-sc__foot">
          @if (!manualMode()) {
            <div class="pf-sc__hid">
              <span class="pf-sc__hid-label">HID scanner input</span>
              <code class="pf-sc__hid-buffer">{{ hidBuffer() || '—' }}</code>
            </div>
          } @else {
            <div></div>
          }
          <div class="pf-sc__foot-actions">
            <button type="button" class="pf-sc__manual-toggle press" (click)="toggleManual()">
              {{ manualMode() ? 'Use camera' : 'Enter manually' }}
            </button>
            <button type="button" class="pf-sc__cancel press" (click)="cancel()">Cancel</button>
          </div>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .pf-sc {
      position: fixed; inset: 0;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      /* Promoted from z-80 to z-1000 so the modal sits ABOVE the floating
         bottom-nav pill (z-35) and any page-level FABs. Modal contract:
         once a modal is open, nothing else should be tappable. */
      z-index: 1000;
    }
    .pf-sc__backdrop {
      position: absolute; inset: 0;
      /* Bumped from 0.6 → 0.78 so the bottom-nav pill underneath isn't
         visible as a faint shape through the scrim — modal feels solid. */
      background: rgba(2, 4, 16, 0.82);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    /* Mobile: make the modal a true full-bleed bottom sheet so its action
       buttons (Manually / Cancel) sit comfortably above the safe area
       and never touch the bottom-nav pill. */
    @media (max-width: 640px) {
      .pf-sc { padding: 0; align-items: flex-end; }
      .pf-sc__card {
        max-width: 100%;
        width: 100%;
        border-radius: 18px 18px 0 0;
        max-height: 92dvh;
        padding-bottom: max(16px, env(safe-area-inset-bottom));
      }
    }
    .pf-sc__card {
      position: relative;
      width: 100%;
      max-width: 460px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 18px;
      box-shadow: 0 30px 90px rgba(0, 0, 0, 0.5);
      overflow: hidden;
      animation: pf-sc-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    @keyframes pf-sc-in {
      from { opacity: 0; transform: translateY(12px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .pf-sc__head { position: relative; padding: 18px 20px 14px; }
    .pf-sc__eyebrow {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-sc__dot {
      display: inline-block; width: 7px; height: 7px; border-radius: 9999px;
      background: var(--text-muted);
    }
    .pf-sc__dot--live {
      background: #34d399;
      box-shadow: 0 0 10px rgba(52, 211, 153, 0.6);
      animation: pf-sc-live 1.4s ease-in-out infinite;
    }
    @keyframes pf-sc-live {
      50% { opacity: 0.5; transform: scale(0.85); }
    }

    .pf-sc__title { margin: 4px 0 0; font-size: 18px; font-weight: 600; color: var(--text-primary); }
    .pf-sc__sub { margin: 4px 0 0; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-sc__code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: #c4b5fd;
      letter-spacing: 0.04em;
    }

    .pf-sc__close {
      position: absolute; top: 12px; right: 12px;
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 9999px;
      background: transparent; border: none; cursor: pointer;
      color: var(--text-muted);
    }
    .pf-sc__close:hover { background: var(--bg-hover); color: var(--text-primary); }

    .pf-sc__viewport {
      position: relative;
      aspect-ratio: 4 / 3;
      background: #0a0a10;
      overflow: hidden;
    }
    .pf-sc__video { width: 100%; height: 100%; object-fit: cover; }
    .pf-sc__torch {
      position: absolute; bottom: 12px; right: 12px; z-index: 2;
      width: 42px; height: 42px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(10, 12, 20, 0.55); color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.25); cursor: pointer;
      -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
      transition: background 0.15s ease, color 0.15s ease;
    }
    .pf-sc__torch--on { background: #fbbf24; color: #1f2937; border-color: #fbbf24; }
    .pf-sc__switch { right: auto; left: 12px; }
    .pf-sc__video { cursor: pointer; }
    .pf-sc__frame {
      position: absolute; inset: 12%;
      border: 2px dashed rgba(236, 72, 153, 0.55);
      border-radius: 12px;
      pointer-events: none;
      box-shadow: 0 0 0 9999px rgba(10, 10, 16, 0.35);
    }
    .pf-sc__viewport-fallback {
      position: absolute; inset: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px; padding: 20px;
      text-align: center;
      color: var(--violet-text);
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.15), rgba(236, 72, 153, 0.08));
      font-size: 13px;
    }
    .pf-sc__viewport-hint { color: var(--text-muted); font-size: 11.5px; margin: 0; }

    .pf-sc__mismatch {
      display: flex; align-items: center; gap: 8px;
      margin: 10px 16px 0;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: var(--red-text);
      font-size: 12px;
    }
    .pf-sc__mismatch b { color: #fff; font-weight: 600; }

    .pf-sc__foot {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; padding: 14px 16px 16px;
      border-top: 1px solid var(--glass-border);
    }
    .pf-sc__hid { display: flex; flex-direction: column; min-width: 0; }
    .pf-sc__hid-label {
      font-size: 10px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-sc__hid-buffer {
      font-size: 12.5px;
      color: var(--text-secondary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-sc__cancel {
      padding: 8px 14px; border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 12.5px; font-weight: 500;
      cursor: pointer;
    }
    .pf-sc__cancel:hover { background: var(--glass-bg-hover); }

    .pf-sc__foot-actions { display: flex; gap: 8px; align-items: center; }
    .pf-sc__manual-toggle {
      padding: 8px 14px; border-radius: 9999px;
      background: transparent; border: 1px solid var(--glass-border);
      color: var(--text-secondary); font-size: 12.5px; font-weight: 500; cursor: pointer;
    }
    .pf-sc__manual-toggle:hover { background: var(--glass-bg-hover); color: var(--text-primary); }

    /* Manual entry — replaces the camera viewport when active */
    .pf-sc__manual { padding: 16px; }
    /* Mobile: the native soft keyboard is suppressed (input is inputmode=none
       + readonly on touch), so the custom numpad is the sole input. Let the
       panel scroll within the sheet and reserve the home-bar safe area so the
       C / 0 / backspace row and the Confirm button are never clipped. */
    @media (max-width: 640px) {
      .pf-sc__manual {
        max-height: 78dvh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding-bottom: max(16px, env(safe-area-inset-bottom));
      }
    }
    .pf-sc__manual-hint { font-size: 12px; color: var(--text-tertiary); margin: 0 0 12px; }
    /* Shared centering width so the segment row, numpad grid and Confirm
       button form one balanced, centered column rather than stretching
       edge-to-edge or hugging a side. */
    .pf-sc__seg {
      display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap;
      max-width: 340px; margin-inline: auto;
      padding: 14px 16px; background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 14px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 17px; font-weight: 600; letter-spacing: 0.02em;
    }
    .pf-sc__seg-part { color: var(--text-primary); }
    .pf-sc__seg-sep { color: var(--text-muted); }
    .pf-sc__seg-part--locked { opacity: 0.7; }
    .pf-sc__seg-input {
      flex: 1 0 110px; min-width: 110px; max-width: 180px;
      background: rgba(168, 85, 247, 0.10); border: 1px solid rgba(168, 85, 247, 0.45);
      border-radius: 10px; padding: 6px 10px; outline: none;
      font: inherit; color: var(--text-primary); text-align: center; letter-spacing: 0.18em;
    }
    .pf-sc__seg-input:focus {
      border-color: rgba(168, 85, 247, 0.85);
      box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.18);
    }
    .pf-sc__seg-input::placeholder { color: var(--text-muted); letter-spacing: 0.18em; }

    /* Center the 3-column numpad grid: cap its width and auto-margin it so
       it sits centered in the modal. The inner pf-num-pad is forced to fill
       this capped track so the keys stay edge-aligned and the gaps even. */
    .pf-sc__numpad { margin-top: 14px; max-width: 340px; margin-inline: auto; }
    .pf-sc__numpad pf-num-pad { display: block; width: 100%; }

    .pf-sc__manual-confirm {
      margin-top: 14px; width: 100%; max-width: 340px; margin-inline: auto; display: block;
      padding: 12px 16px; border-radius: 14px; border: 0;
      background: var(--gradient-primary); color: #fff;
      font-size: 14px; font-weight: 600; cursor: pointer;
      box-shadow: 0 8px 22px rgba(124, 58, 237, 0.35);
      transition: transform 80ms ease, box-shadow 0.25s ease, filter 80ms ease;
    }
    .pf-sc__manual-confirm:hover:not(:disabled) {
      box-shadow: 0 14px 32px rgba(124, 58, 237, 0.45);
      transform: translateY(-1px);
    }
    .pf-sc__manual-confirm:active:not(:disabled) { transform: scale(0.98); filter: brightness(1.08); }
    .pf-sc__manual-confirm:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
  `]
})
export class BarcodeScannerModalComponent implements AfterViewInit, OnDestroy {
  @Input() title = 'Scan vial barcode';
  @Input() expectedBarcode?: string;

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

  // Manual entry: only available when expectedBarcode is set so we can
  // lock vendor/year/dept and just collect the 5-digit sequence. The
  // submit path runs through handleScan, so the existing match-or-flash
  // logic still protects against wrong vials.
  protected readonly manualMode = signal(false);
  protected readonly manualSeq = signal('');
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
    this.detector = new BarcodeDetector({
      // Every symbology a tube/label or requisition could carry, incl. the new
      // Data Matrix option and the existing QR + Code128.
      formats: ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13', 'ean_8',
        'itf', 'codabar', 'upc_a', 'upc_e', 'pdf417', 'aztec'],
    });
    await this.startCamera();
  }

  ngOnDestroy() {
    this.stopCamera();
    try { document.body.classList.remove('pf-scanner-open'); } catch { /* SSR */ }
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
      if (this.manualSeq().length === 5) {
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
      if (this._hidBuffer) this.handleScan(this._hidBuffer);
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
    const trimmed = (code || '').trim();
    if (!trimmed) return;

    if (this.expectedBarcode && trimmed.toLowerCase() !== this.expectedBarcode.toLowerCase()) {
      this.lastMismatch.set(trimmed);
      // Clear the mismatch flash after 2.5s so the tech can see the next scan.
      setTimeout(() => {
        if (this.lastMismatch() === trimmed) this.lastMismatch.set(null);
      }, 2500);
      return;
    }

    this.stopCamera();
    this.matched.emit(trimmed);
  }

  cancel() {
    this.stopCamera();
    this.cancelled.emit();
  }

  toggleManual() {
    const next = !this.manualMode();
    this.manualMode.set(next);
    // Release the camera while the manual panel is in front; reopen on close.
    if (next) {
      this.stopCamera();
      setTimeout(() => {
        this.manualInputEl?.nativeElement.focus();
      }, 50);
    } else {
      void this.startCamera();
    }
  }

  onManualSeqChange(v: string) {
    this.manualSeq.set((v ?? '').replace(/\D/g, '').slice(0, 5));
  }

  submitManual() {
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

  private friendlyError(err: unknown): string {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (msg.includes('permission')) return 'Camera permission denied. Allow access in your browser settings and retry.';
    if (msg.includes('not found') || msg.includes('no camera')) return 'No camera detected on this device.';
    if (msg.includes('not readable')) return 'Another app is using the camera. Close it and retry.';
    return 'Could not start the camera.';
  }
}
