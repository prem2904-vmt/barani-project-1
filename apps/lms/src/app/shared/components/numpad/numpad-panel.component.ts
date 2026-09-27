import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, untracked, viewChild } from '@angular/core';
import { NumpadChar } from './numpad-keys';
import { LONG_PRESS_MS, NumpadService } from './numpad.service';

interface PadKey { ch: NumpadChar; glyph: string; aria: string; sym: boolean; wide?: boolean; }

const SYM_ROW: PadKey[] = [
  { ch: '<', glyph: '<', aria: 'Less than', sym: true },
  { ch: '>', glyph: '>', aria: 'Greater than', sym: true },
  { ch: '-', glyph: '−', aria: 'Minus', sym: true },
];
const d = (n: NumpadChar): PadKey => ({ ch: n, glyph: n, aria: n, sym: false });
const BODY: PadKey[] = [
  d('7'), d('8'), d('9'),
  d('4'), d('5'), d('6'),
  d('1'), d('2'), d('3'),
  { ...d('0'), wide: true },
  { ch: '.', glyph: '.', aria: 'Decimal point', sym: true },
];

/**
 * The result numpad surface (one instance, mounted on <body> by the
 * service; docked bottom-right / bottom-left on tablets, a bottom sheet on
 * phones). Layout — a compact 4-column pad:
 *
 *   <   >   −   ⌫
 *   7   8   9   ┐
 *   4   5   6   │ Enter (Next / Done) — tall, the one violet key
 *   1   2   3   │
 *   0 0     .   ┘
 *
 * Focus never leaves the field: pointerdown on the pad is cancelled, keys
 * are `tabindex=-1` buttons (screen readers still reach and activate them).
 */
@Component({
  selector: 'pf-numpad-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (svc.open() && svc.current(); as f) {
      <div #surface class="pf-np" role="group" aria-label="Number pad"
           data-keep-keyboard
           [class.pf-np--sheet]="svc.mode() === 'sheet'"
           [class.pf-np--corner]="svc.mode() === 'corner'"
           [class.pf-np--left]="svc.mode() === 'corner' && svc.corner() === 'left'"
           [class.pf-np--still]="svc.reducedMotion()"
           [attr.data-placement]="svc.mode() === 'corner' ? 'corner-' + svc.corner() : 'sheet'"
           (pointerdown)="$event.preventDefault()"
           (mousedown)="$event.preventDefault()">
        <div class="pf-np__head">
          @if (svc.mode() === 'corner') {
            <!-- Grip: swap corners (left-handed techs); remembered per user. -->
            <button type="button" class="pf-np__grip" tabindex="-1"
                    [attr.aria-label]="svc.corner() === 'right' ? 'Move number pad to the bottom-left corner' : 'Move number pad to the bottom-right corner'"
                    [title]="svc.corner() === 'right' ? 'Move to the left corner' : 'Move to the right corner'"
                    (click)="svc.toggleCorner()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 8 3 12l4 4M17 8l4 4-4 4M3 12h18"/></svg>
            </button>
          }
          <!-- Two fixed rows (name, then value + flag) so the docked pad keeps
               ONE height from field to field — it never shifts while typing. -->
          <div class="pf-np__id">
            <span class="pf-np__label">{{ f.label() }}</span>
            <span class="pf-np__line">
              <span class="pf-np__value" aria-hidden="true">{{ svc.value() || '—' }}@if (f.unit(); as u) {<span class="pf-np__unit">{{ u }}</span>}</span>
              @if (f.flag(); as fl) {
                <span class="pf-np__flag" [attr.data-tone]="fl.tone" role="status">{{ fl.label }}</span>
              }
            </span>
          </div>
          <button type="button" class="pf-np__hide" tabindex="-1" aria-label="Hide number pad" title="Hide number pad"
                  (click)="svc.dismiss()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </button>
        </div>
        <div class="pf-np__grid">
          @for (k of symRow; track k.ch) {
            @if (svc.keys().has(k.ch)) {
              <button type="button" tabindex="-1" class="pf-np__key pf-np__key--sym"
                      [class.pf-np__key--off]="!svc.accepts().has(k.ch)"
                      [class.pf-np__key--nope]="svc.rejected() === k.ch"
                      [attr.aria-disabled]="!svc.accepts().has(k.ch) ? 'true' : null"
                      [attr.aria-label]="k.aria" [attr.data-key]="k.ch"
                      (click)="svc.press(k.ch)">{{ k.glyph }}</button>
            } @else {
              <span class="pf-np__gap" aria-hidden="true"></span>
            }
          }
          <button type="button" tabindex="-1" class="pf-np__key pf-np__key--sym pf-np__back"
                  aria-label="Delete (hold to clear)" data-key="backspace"
                  (pointerdown)="holdStart()" (pointerup)="holdEnd()" (pointercancel)="holdEnd()" (pointerleave)="holdEnd()"
                  (click)="backTap()">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"/><path d="m16 9-5 6M11 9l5 6"/></svg>
          </button>
          @for (k of body; track k.ch) {
            @if (!k.sym || svc.keys().has(k.ch)) {
              <button type="button" tabindex="-1" class="pf-np__key"
                      [class.pf-np__key--sym]="k.sym"
                      [class.pf-np__zero]="k.wide"
                      [class.pf-np__key--off]="k.sym && !svc.accepts().has(k.ch)"
                      [class.pf-np__key--nope]="svc.rejected() === k.ch"
                      [attr.aria-disabled]="k.sym && !svc.accepts().has(k.ch) ? 'true' : null"
                      [attr.aria-label]="k.aria" [attr.data-key]="k.ch"
                      (click)="svc.press(k.ch)">{{ k.glyph }}</button>
            } @else {
              <span class="pf-np__gap" aria-hidden="true"></span>
            }
          }
          <button type="button" tabindex="-1" class="pf-np__next" data-key="next"
                  [attr.aria-label]="svc.isLast() ? 'Enter: done, go to Submit' : 'Enter: next result'"
                  (click)="svc.next()">
            <!-- "Enter" is the promise; the small line says where it goes. -->
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 5v7a3 3 0 0 1-3 3H5"/><path d="m9 11-4 4 4 4"/></svg>
            <span class="pf-np__enter">Enter</span>
            <span class="pf-np__then">{{ svc.isLast() ? 'Done' : 'Next' }}</span>
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .pf-np {
      position: fixed; z-index: 1300; box-sizing: border-box;
      width: 272px; padding: 8px 10px 10px;
      background: var(--nd-card-bg, #fff);
      border: 1px solid var(--nd-line, #e5e7eb);
      border-radius: var(--nd-radius-card, 16px);
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08);
      color: var(--text-primary);
      font-family: inherit;
      touch-action: manipulation;
      user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      animation: pf-np-in var(--nd-dur-fast, 200ms) var(--nd-spring, ease-out) both;
    }
    /* Tablet / wide: docked in a bottom corner, above the navbar, same spot
       for every field (no jumping while techs type → Enter → type). */
    .pf-np--corner {
      right: max(16px, env(safe-area-inset-right, 0px));
      bottom: calc(max(var(--nd-nav-h, 0px), env(safe-area-inset-bottom, 0px)) + 16px);
      transform-origin: bottom right;
    }
    .pf-np--corner.pf-np--left {
      right: auto; left: max(16px, env(safe-area-inset-left, 0px));
      transform-origin: bottom left;
    }
    .pf-np--sheet {
      left: 0; right: 0; bottom: 0; width: auto;
      border-radius: 18px 18px 0 0; border-bottom: 0;
      padding: 8px max(12px, env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px));
      box-shadow: 0 -10px 30px rgba(15, 23, 42, 0.16);
      animation: pf-np-rise var(--nd-dur-sheet, 360ms) var(--nd-spring, ease-out) both;
    }
    .pf-np--sheet .pf-np__head, .pf-np--sheet .pf-np__grid { max-width: 520px; margin-left: auto; margin-right: auto; }

    .pf-np__head { display: flex; align-items: center; gap: 6px; min-height: 58px; padding: 0 0 6px 4px; }
    .pf-np__id { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .pf-np__line { display: flex; align-items: center; gap: 8px; min-height: 22px; }
    .pf-np__label {
      overflow-wrap: anywhere;
      font-size: 12px; font-weight: 500; line-height: 1.3; color: var(--text-secondary);
    }
    .pf-np__value {
      flex: none; font-size: 18px; font-weight: 600; line-height: 1;
      font-variant-numeric: tabular-nums; letter-spacing: 0.01em; color: var(--text-primary);
    }
    .pf-np__unit { margin-left: 4px; font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    .pf-np__flag {
      flex: none; display: inline-flex; align-items: center; height: 20px; padding: 0 8px;
      border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; white-space: nowrap;
      background: var(--nd-chip-bg); color: var(--text-secondary); border: 1px solid var(--nd-line);
    }
    .pf-np__flag[data-tone='low'] { background: rgba(59, 130, 246, 0.14); color: var(--blue-text, #1d4ed8); border-color: rgba(59, 130, 246, 0.35); }
    .pf-np__flag[data-tone='high'] { background: rgba(245, 158, 11, 0.14); color: var(--amber-text, #b45309); border-color: rgba(245, 158, 11, 0.4); }
    .pf-np__flag[data-tone='critical'] { background: rgba(239, 68, 68, 0.14); color: var(--red-text, #b91c1c); border-color: rgba(239, 68, 68, 0.4); }
    .pf-np__hide {
      flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 44px; height: 44px; margin: -4px -6px -4px 0; border: 0; border-radius: var(--nd-radius, 12px);
      background: transparent; color: var(--text-secondary); cursor: pointer;
    }
    .pf-np__hide:active, .pf-np__grip:active { background: var(--nd-chip-bg); }
    .pf-np__grip {
      flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 44px; height: 44px; margin: -4px 0 -4px -8px; border: 0; border-radius: var(--nd-radius, 12px);
      background: transparent; color: var(--text-muted, #9ca3af); cursor: grab;
    }

    .pf-np__grid {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
      grid-auto-rows: 50px; gap: 6px;
    }
    .pf-np--sheet .pf-np__grid { grid-auto-rows: 52px; gap: 8px; }
    .pf-np__key, .pf-np__next {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 44px; min-height: 44px; padding: 0; border: 0;
      border-radius: var(--nd-radius, 12px);
      font: inherit; cursor: pointer;
      transition: transform 90ms ease-out, background-color 90ms ease-out, opacity 120ms ease-out;
    }
    .pf-np__key {
      background: var(--nd-chip-bg, #f3f4f6); color: var(--text-primary);
      font-size: 21px; font-weight: 500; font-variant-numeric: tabular-nums;
    }
    .pf-np__key--sym { color: var(--text-secondary); font-size: 19px; }
    .pf-np__key:active { transform: scale(0.94); background: var(--nd-sel-bg, #eceff2); }
    .pf-np__key--off { opacity: 0.38; }
    .pf-np__key--nope { animation: pf-np-nope 320ms ease-out; }
    .pf-np__zero { grid-column: span 2; }
    .pf-np__next {
      grid-column: 4; grid-row: 2 / span 4;
      flex-direction: column; gap: 4px;
      background: var(--gradient-primary, linear-gradient(90deg, #7c3aed, #c026d3));
      color: #fff;
    }
    .pf-np__enter { font-size: 17px; font-weight: 600; letter-spacing: 0.01em; line-height: 1.1; }
    .pf-np__then { font-size: 12px; font-weight: 500; opacity: 0.85; line-height: 1.1; }
    .pf-np__next:active { transform: scale(0.97); filter: brightness(1.06); }

    @keyframes pf-np-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: none; } }
    @keyframes pf-np-rise { from { transform: translateY(100%); } to { transform: none; } }
    @keyframes pf-np-nope { 0%, 100% { transform: none; } 30% { transform: translateX(-3px); } 65% { transform: translateX(3px); } }

    .pf-np--still, .pf-np--still .pf-np__key, .pf-np--still .pf-np__next { animation: none !important; transition: none !important; }
    .pf-np--still .pf-np__key:active, .pf-np--still .pf-np__next:active { transform: none; }
    @media (prefers-reduced-motion: reduce) {
      .pf-np, .pf-np__key, .pf-np__next { animation: none !important; transition: none !important; }
      .pf-np__key:active, .pf-np__next:active { transform: none; }
    }
  `],
})
export class NumpadPanelComponent {
  readonly svc = inject(NumpadService);
  readonly symRow = SYM_ROW;
  readonly body = BODY;
  private readonly surface = viewChild<ElementRef<HTMLElement>>('surface');

  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private held = false;

  constructor() {
    effect(() => {
      const el = this.surface()?.nativeElement ?? null;
      untracked(() => this.svc.registerSurface(el));
    });
  }

  holdStart(): void {
    this.held = false;
    this.clearHold();
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.held = true;
      this.svc.clear();
    }, LONG_PRESS_MS);
  }

  holdEnd(): void { this.clearHold(); }

  /** A tap deletes one character; the click that ends a long-press (which
   *  already cleared the field) is swallowed. */
  backTap(): void {
    this.clearHold();
    if (this.held) { this.held = false; return; }
    this.svc.backspace();
  }

  private clearHold(): void {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
  }
}
