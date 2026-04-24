import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef,
  EventEmitter, HostListener, Input, OnDestroy, Output,
  ViewChild, computed, signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
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
          <video #video autoplay muted playsinline class="pf-sc__video"></video>
          <div class="pf-sc__frame" aria-hidden="true"></div>
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
                <input class="pf-sc__seg-part pf-sc__seg-input"
                       inputmode="numeric"
                       pattern="[0-9]*"
                       maxlength="5"
                       placeholder="00000"
                       [ngModel]="manualSeq()"
                       (ngModelChange)="onManualSeqChange($event)" />
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
              <button type="button"
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
      z-index: 80;
    }
    .pf-sc__backdrop {
      position: absolute; inset: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
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
      color: #c4b5fd;
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
      color: #fca5a5;
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
    .pf-sc__manual-hint { font-size: 12px; color: var(--text-tertiary); margin: 0 0 12px; }
    .pf-sc__seg {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
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

    .pf-sc__numpad { margin-top: 14px; max-width: 320px; }

    .pf-sc__manual-confirm {
      margin-top: 14px; width: 100%;
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

  private reader: BrowserMultiFormatReader | null = null;
  private controls: IScannerControls | null = null;

  protected readonly cameraReady = signal(false);
  protected readonly cameraError = signal<string | null>(null);
  protected readonly lastMismatch = signal<string | null>(null);

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
    try {
      this.reader = new BrowserMultiFormatReader();
      // decodeFromVideoDevice(null, …) picks the default / back camera.
      this.controls = await this.reader.decodeFromVideoDevice(
        undefined,
        this.videoEl.nativeElement,
        (result, _err, controls) => {
          if (!result) return;
          this.cameraReady.set(true);
          const text = result.getText();
          this.handleScan(text, controls);
        }
      );
      // If decodeFromVideoDevice starts the stream successfully, the video
      // metadata fires loadedmetadata pretty quickly; mark ready optimistically.
      this.videoEl.nativeElement.onloadedmetadata = () => this.cameraReady.set(true);
    } catch (err) {
      // getUserMedia denied / no camera / running on http without permission.
      this.cameraError.set(this.friendlyError(err));
    }
  }

  ngOnDestroy() {
    try { this.controls?.stop(); } catch { /* ignore */ }
  }

  @HostListener('document:keydown', ['$event'])
  onKey(ev: KeyboardEvent) {
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

  private handleScan(code: string, controls?: IScannerControls) {
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

    try { (controls ?? this.controls)?.stop(); } catch { /* ignore */ }
    this.matched.emit(trimmed);
  }

  cancel() {
    try { this.controls?.stop(); } catch { /* ignore */ }
    this.cancelled.emit();
  }

  toggleManual() {
    const next = !this.manualMode();
    this.manualMode.set(next);
    // Pause the camera while the manual panel is in front, resume on close.
    if (next) {
      try { this.controls?.stop(); } catch { /* ignore */ }
      this.cameraReady.set(false);
    } else {
      // Reattach the camera if the user goes back to scanning.
      this.restartCamera();
    }
  }

  onManualSeqChange(v: string) {
    this.manualSeq.set((v ?? '').replace(/\D/g, '').slice(0, 5));
  }

  submitManual() {
    const p = this.parsedExpected();
    if (!p) return;
    if (this.manualSeq().length !== 5) return;
    const assembled = `PF-${p.vendor}-${p.year}-${this.manualSeq().padStart(5, '0')}-${p.dept}`;
    // Same path as scan/HID — the mismatch-flash logic still applies if
    // the typed seq doesn't match the expected one, so we never claim the
    // wrong vial by typo.
    this.handleScan(assembled);
  }

  private async restartCamera() {
    if (!this.reader || !this.videoEl?.nativeElement) return;
    try {
      this.controls = await this.reader.decodeFromVideoDevice(
        undefined,
        this.videoEl.nativeElement,
        (result, _err, controls) => {
          if (!result) return;
          this.cameraReady.set(true);
          this.handleScan(result.getText(), controls);
        }
      );
      this.videoEl.nativeElement.onloadedmetadata = () => this.cameraReady.set(true);
    } catch (err) {
      this.cameraError.set(this.friendlyError(err));
    }
  }

  private friendlyError(err: unknown): string {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (msg.includes('permission')) return 'Camera permission denied. Allow access in your browser settings and retry.';
    if (msg.includes('not found') || msg.includes('no camera')) return 'No camera detected on this device.';
    if (msg.includes('not readable')) return 'Another app is using the camera. Close it and retry.';
    return 'Could not start the camera.';
  }
}
