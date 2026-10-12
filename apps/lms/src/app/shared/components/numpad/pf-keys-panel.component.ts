import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, untracked, viewChild } from '@angular/core';
import { KeyTap } from './key-tap';
import { LONG_PRESS_MS, NumpadService, PfKeysField, isKeysField } from './numpad.service';
import { CODE_DIGITS, NUMBER_DIGITS, QWERTY_ROWS, keyAria, numericLayoutOf } from './pf-keys-layouts';

/**
 * PF Keys surface — ONE instance, mounted lazily on <body> by the shared
 * NumpadService the first time a `pfKeys` search field appears on a tablet.
 * Docked full width at the bottom (safe-area aware), like a keyboard; the
 * service publishes its height as `--pf-keys-h` so the page above resizes.
 *
 *  qwerty (B)   Q W E R T Y U I O P ⌫
 *                A S D F G H J K L
 *                 Z X C V B N M [↑ ↓]
 *               123 ⌨ [   space   ] [Add ↵] ⌄
 *
 *  code (C)     DEPARTMENT PREFIX │ 1 2 3 │ ⌄   ⌫
 *               CLP HEM IMS …     │ 4 5 6 │ ABC ⌨
 *                                 │ 7 8 9 │ Add ↵ [↑]
 *                                 │ – 0 . │       [↓]
 *
 *  number       1 2 3 │ ⌄   ⌫
 *               4 5 6 │ ABC ⌨
 *               7 8 9 │ Search ↵ [↑]
 *                 0   │          [↓]
 *
 * Focus never leaves the field: pointerdown on the surface is cancelled (and
 * kept from page-level outside-click listeners); keys are tabindex=-1
 * buttons with aria-labels (screen readers still reach and activate them).
 * Primary colour ONLY on the Enter key (PF-PATTERN §2); when the field says
 * its Enter REMOVES (order create: the highlighted test is already in the
 * order) the key reads "Remove ↵" in the neutral key colour with a muted-red
 * outline (ND danger: never a filled red, never the violet gradient).
 *
 * Fast typing (key-tap.ts): typing keys act on POINTERDOWN, once per
 * pointer, so rolled-over multi-finger taps all land; commit keys act on
 * pointerup; the click that follows is swallowed; a click with no pointer
 * press before it (keyboard / screen reader) still acts.
 */
/** Keys that act on release (see key-tap.ts). */
type PfKeysCommit = 'enter' | 'layout' | 'prefix' | 'hide' | 'system';

@Component({
  selector: 'pf-keys-panel',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (field(); as f) {
      <div #surface class="pf-k" role="group" data-keep-keyboard
           [attr.aria-label]="'Search keypad, ' + f.label()"
           [attr.data-layout]="svc.keysLayout()"
           [class.pf-k--still]="svc.reducedMotion()"
           (pointerdown)="guard($event)" (pointerup)="tap.up($event)" (pointercancel)="tap.up($event)"
           (mousedown)="$event.preventDefault()">
        @switch (svc.keysLayout()) {
          @case ('qwerty') {
            <div class="pf-k__qwerty">
              @for (row of rows; track $index; let r = $index) {
                <div class="pf-k__row" [attr.data-row]="r" [class.pf-k__row--arrows]="r === 2 && f.arrows()">
                  @for (ch of row; track ch) {
                    <button type="button" tabindex="-1" class="pf-k__key" [attr.data-key]="ch" [attr.aria-label]="aria(ch)"
                            [class.pf-k__key--nope]="svc.rejected() === ch"
                            (pointerdown)="typeDown($event, ch)" (click)="svc.press(ch)">{{ ch.toUpperCase() }}</button>
                  }
                  @if (r === 2 && f.arrows()) {
                    <ng-container *ngTemplateOutlet="arrowKeys"></ng-container>
                  }
                  @if (r === 0) {
                    <!-- Backspace at the RIGHT end of the top row, like the iPad's
                         own keyboard (owner 2026-09-28). -->
                    <ng-container *ngTemplateOutlet="backKey; context: { cls: 'pf-k__w2' }"></ng-container>
                  }
                </div>
              }
              <div class="pf-k__row pf-k__row--bottom">
                <button type="button" tabindex="-1" class="pf-k__key pf-k__key--fn pf-k__w3" [attr.data-key]="'layout-' + numericOf(f)"
                        [attr.aria-label]="numericOf(f) === 'code' ? 'Switch to the code pad' : 'Switch to the number pad'"
                        (pointerdown)="tap.arm($event)" (pointerup)="commitUp($event, 'layout', numericOf(f))"
                        (click)="run('layout', numericOf(f))">123</button>
                <ng-container *ngTemplateOutlet="sysKey; context: { cls: 'pf-k__w2' }"></ng-container>
                <button type="button" tabindex="-1" class="pf-k__key pf-k__space" data-key=" " aria-label="Space"
                        (pointerdown)="typeDown($event, ' ')" (click)="svc.press(' ')"><span aria-hidden="true">space</span></button>
                <ng-container *ngTemplateOutlet="enterKey; context: { f: f, cls: 'pf-k__w3' }"></ng-container>
                <ng-container *ngTemplateOutlet="hideKey; context: { cls: 'pf-k__w2' }"></ng-container>
              </div>
            </div>
          }
          @case ('code') {
            <div class="pf-k__pad pf-k__pad--code" [class.pf-k__pad--arrows]="f.arrows()">
              <div class="pf-k__prefix" role="group" aria-label="Department prefix">
                <span class="pf-k__eyebrow" aria-hidden="true">Department prefix</span>
                <div class="pf-k__prefix-grid">
                  @for (p of f.prefixes(); track p.label) {
                    <button type="button" tabindex="-1" class="pf-k__key pf-k__key--prefix" [attr.data-key]="'prefix-' + p.label"
                            [attr.aria-label]="'Prefix ' + p.label + (p.name && p.name !== p.label ? ', ' + p.name : '')"
                            [title]="p.name || p.label"
                            [class.pf-k__key--nope]="svc.rejected() === (p.insert ?? p.label)"
                            (pointerdown)="tap.arm($event)" (pointerup)="commitUp($event, 'prefix', p.insert ?? p.label)"
                            (click)="run('prefix', p.insert ?? p.label)">
                      <span class="pf-k__prefix-code">{{ p.label }}</span>
                      @if (p.hint) { <span class="pf-k__prefix-hint" aria-hidden="true">{{ p.hint }}</span> }
                    </button>
                  } @empty {
                    <span class="pf-k__prefix-empty">No department codes yet</span>
                  }
                </div>
              </div>
              @for (ch of codeDigits; track ch) {
                <button type="button" tabindex="-1" class="pf-k__key pf-k__key--digit" [attr.data-key]="ch" [attr.aria-label]="aria(ch)"
                        [class.pf-k__key--nope]="svc.rejected() === ch"
                        (pointerdown)="typeDown($event, ch)" (click)="svc.press(ch)">{{ ch === '-' ? '–' : ch }}</button>
              }
              <ng-container *ngTemplateOutlet="padSide; context: { f: f }"></ng-container>
            </div>
          }
          @case ('number') {
            <div class="pf-k__pad pf-k__pad--number" [class.pf-k__pad--arrows]="f.arrows()">
              @for (ch of numberDigits; track ch) {
                <button type="button" tabindex="-1" class="pf-k__key pf-k__key--digit" [class.pf-k__zero]="ch === '0'"
                        [attr.data-key]="ch" [attr.aria-label]="aria(ch)"
                        [class.pf-k__key--nope]="svc.rejected() === ch"
                        (pointerdown)="typeDown($event, ch)" (click)="svc.press(ch)">{{ ch }}</button>
              }
              <ng-container *ngTemplateOutlet="padSide; context: { f: f }"></ng-container>
            </div>
          }
        }
      </div>

      <!-- Right-hand column of the code / number pads. -->
      <ng-template #padSide let-f="f">
        <ng-container *ngTemplateOutlet="backKey; context: { cls: 'pf-k__at-back' }"></ng-container>
        <ng-container *ngTemplateOutlet="hideKey; context: { cls: 'pf-k__at-hide' }"></ng-container>
        <button type="button" tabindex="-1" class="pf-k__key pf-k__key--fn pf-k__at-abc" data-key="layout-qwerty"
                aria-label="Switch to letters (ABC)"
                (pointerdown)="tap.arm($event)" (pointerup)="commitUp($event, 'layout', 'qwerty')" (click)="run('layout', 'qwerty')">ABC</button>
        <ng-container *ngTemplateOutlet="sysKey; context: { cls: 'pf-k__at-sys' }"></ng-container>
        <ng-container *ngTemplateOutlet="enterKey; context: { f: f, cls: 'pf-k__at-enter' }"></ng-container>
        @if (f.arrows()) {
          <div class="pf-k__at-arrows"><ng-container *ngTemplateOutlet="arrowKeys"></ng-container></div>
        }
      </ng-template>

      <ng-template #arrowKeys>
        <button type="button" tabindex="-1" class="pf-k__key pf-k__key--fn pf-k__arrow" data-key="up" aria-label="Previous result"
                (pointerdown)="arrowDown($event, -1)" (click)="svc.arrow(-1)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
        </button>
        <button type="button" tabindex="-1" class="pf-k__key pf-k__key--fn pf-k__arrow" data-key="down" aria-label="Next result"
                (pointerdown)="arrowDown($event, 1)" (click)="svc.arrow(1)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>
        </button>
      </ng-template>

      <ng-template #backKey let-cls="cls">
        <button type="button" tabindex="-1" class="pf-k__key pf-k__key--fn {{ cls }}" data-key="backspace"
                aria-label="Backspace (hold to clear)"
                (pointerdown)="backDown($event)" (pointerup)="holdEnd()" (pointercancel)="holdEnd()" (pointerleave)="holdEnd()"
                (click)="svc.backspace()">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"/><path d="m16 9-5 6M11 9l5 6"/></svg>
        </button>
      </ng-template>

      <ng-template #sysKey let-cls="cls">
        <!-- Escape hatch: THIS field gets the system keyboard until blur. -->
        <button type="button" tabindex="-1" class="pf-k__key pf-k__key--fn {{ cls }}" data-key="system"
                aria-label="Use the system keyboard" title="System keyboard (paste, other characters)"
                (pointerdown)="tap.arm($event)" (pointerup)="commitUp($event, 'system')" (click)="run('system')">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/></svg>
        </button>
      </ng-template>

      <ng-template #hideKey let-cls="cls">
        <button type="button" tabindex="-1" class="pf-k__key pf-k__key--fn {{ cls }}" data-key="hide"
                aria-label="Hide keypad" title="Hide keypad"
                (pointerdown)="tap.arm($event)" (pointerup)="commitUp($event, 'hide')" (click)="run('hide')">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
      </ng-template>

      <ng-template #enterKey let-f="f" let-cls="cls">
        <!-- The ONE primary key: the field's own Enter. Its label follows
             what Enter will do (order create: "Remove ↵" when the
             highlighted test is already in the order). -->
        <button type="button" tabindex="-1" class="pf-k__enter {{ cls }}" data-key="enter"
                [class.pf-k__enter--remove]="f.enterTone() === 'remove'" [attr.data-tone]="f.enterTone()"
                [attr.aria-label]="f.enterAria()"
                (pointerdown)="tap.arm($event)" (pointerup)="commitUp($event, 'enter')" (click)="run('enter')">
          <span class="pf-k__enter-lbl">{{ f.enterLabel() }}</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 5v7a3 3 0 0 1-3 3H5"/><path d="m9 11-4 4 4 4"/></svg>
        </button>
      </ng-template>
    }
  `,
  styles: [`
    :host { display: contents; }
    .pf-k {
      /* Local tokens: slate keys on a slightly darker tray. */
      --k-tray: #e7eaee;
      --k-key: #ffffff;
      --k-key-fn: #d3d8de;
      --k-key-press: #c3c9d0;
      --k-text: var(--text-primary, #0f172a);
      --k-muted: var(--text-secondary, #475569);
      --k-shadow: 0 1px 0 rgba(15, 23, 42, 0.18);
      --k-gap: 6px;
      --k-row: clamp(44px, 6vh, 54px);
      position: fixed; z-index: 1300; left: 0; right: 0; bottom: 0; box-sizing: border-box;
      padding: 8px max(10px, env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) max(10px, env(safe-area-inset-left, 0px));
      background: var(--k-tray);
      border-top: 1px solid var(--pf-line, #e5e7eb);
      box-shadow: 0 -8px 24px rgba(15, 23, 42, 0.10);
      color: var(--k-text);
      font-family: inherit;
      touch-action: manipulation;
      user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      animation: pf-k-rise var(--pf-dur-sheet, 360ms) var(--pf-spring, ease-out) both;
    }
    :host-context(.dark) .pf-k, :host-context([data-theme='dark']) .pf-k {
      --k-tray: #14161c;
      --k-key: #3a3f4a;
      --k-key-fn: #262a33;
      --k-key-press: #4b5260;
      --k-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
      border-top-color: rgba(255, 255, 255, 0.08);
      box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
    }
    .pf-k[data-layout='code'], .pf-k[data-layout='number'] { --k-row: clamp(48px, 7vh, 60px); }

    /* ── Keys ── */
    .pf-k__key, .pf-k__enter {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      min-width: 0; min-height: 44px; height: 100%; padding: 0; border: 0;
      border-radius: var(--pf-radius-sm, 10px);
      font: inherit; cursor: pointer; color: var(--k-text);
      transition: transform 90ms ease-out, background-color 90ms ease-out;
      /* A keyboard: no double-tap zoom / pan / pinch on a key — a pinch
         would CANCEL two rolled-over fingers — and no text selection. */
      touch-action: none;
      user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
    }
    .pf-k__key { background: var(--k-key); box-shadow: var(--k-shadow); font-size: 20px; font-weight: 500; }
    .pf-k__key--fn { background: var(--k-key-fn); color: var(--k-muted); font-size: 15px; font-weight: 600; letter-spacing: 0.02em; }
    .pf-k__key:active { transform: scale(0.95); background: var(--k-key-press); }
    .pf-k__key--nope { animation: pf-k-nope 320ms ease-out; }
    .pf-k__enter {
      background: var(--gradient-primary, linear-gradient(90deg, #7c3aed, #c026d3));
      color: #fff; font-size: 17px; font-weight: 600; letter-spacing: 0.01em;
      box-shadow: 0 1px 0 rgba(15, 23, 42, 0.18);
    }
    .pf-k__enter:active { transform: scale(0.97); filter: brightness(1.06); }
    /* Enter REMOVES (the highlighted test is already in the order): the
       neutral key with a muted-red outline + text — ND danger, never a
       filled red, never the violet primary. */
    .pf-k__enter--remove {
      background: var(--k-key);
      color: var(--error-text, #dc2626);
      box-shadow: inset 0 0 0 1.5px var(--error-border, rgba(239, 68, 68, 0.45)), var(--k-shadow);
    }
    .pf-k__enter--remove:active { background: var(--k-key-press); filter: none; }

    /* ── QWERTY: 22 half-columns (Q–P + ⌫ on top), rows offset like a real keyboard ── */
    .pf-k__qwerty { display: grid; gap: var(--k-gap); max-width: 1040px; margin: 0 auto; }
    .pf-k__row { display: grid; grid-template-columns: repeat(22, minmax(0, 1fr)); gap: var(--k-gap); height: var(--k-row); }
    .pf-k__row > * { grid-column: span 2; }
    .pf-k__row[data-row='1'] > :first-child { grid-column: 2 / span 2; }
    .pf-k__row[data-row='2'] > :first-child { grid-column: 4 / span 2; }
    .pf-k__row[data-row='2'].pf-k__row--arrows > :first-child { grid-column: 2 / span 2; }
    .pf-k__row--bottom > .pf-k__w2 { grid-column: span 2; }
    .pf-k__row--bottom > .pf-k__w3 { grid-column: span 3; }
    .pf-k__space { grid-column: span 12 !important; background: var(--k-key); font-size: 14px; color: var(--k-muted); }

    /* ── Code / number pads ── */
    .pf-k__pad {
      display: grid; gap: var(--k-gap); margin: 0 auto;
      grid-template-rows: repeat(4, var(--k-row));
    }
    .pf-k__pad--code {
      max-width: 1000px;
      grid-template-columns: minmax(0, 2.1fr) repeat(3, minmax(0, 1fr)) minmax(0, 1.15fr) minmax(0, 0.85fr);
    }
    .pf-k__pad--code > .pf-k__key--digit:nth-of-type(3n + 1) { grid-column-start: 2; }
    .pf-k__pad--number {
      max-width: 640px;
      grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.15fr) minmax(0, 0.85fr);
    }
    .pf-k__pad--number > .pf-k__key--digit:nth-of-type(3n + 1) { grid-column-start: 1; }
    .pf-k__pad--number > .pf-k__zero { grid-column: 1 / span 3; }
    .pf-k__key--digit { font-size: 24px; font-variant-numeric: tabular-nums; }
    /* Right-hand column (last two grid columns). */
    .pf-k__at-back  { grid-column: -2 / span 1; grid-row: 1; }
    .pf-k__at-hide  { grid-column: -3 / span 1; grid-row: 1; }
    .pf-k__at-abc   { grid-column: -3 / span 1; grid-row: 2; }
    .pf-k__at-sys   { grid-column: -2 / span 1; grid-row: 2; }
    .pf-k__at-enter { grid-column: -3 / span 2; grid-row: 3 / span 2; font-size: 18px; }
    .pf-k__pad--arrows .pf-k__at-enter { grid-column: -3 / span 1; }
    .pf-k__at-arrows { grid-column: -2 / span 1; grid-row: 3 / span 2; display: grid; grid-template-rows: 1fr 1fr; gap: var(--k-gap); }

    .pf-k__prefix { grid-column: 1; grid-row: 1 / span 4; display: flex; flex-direction: column; gap: 6px; min-height: 0; min-width: 0; }
    .pf-k__eyebrow {
      flex: none; padding: 0 2px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--k-muted); line-height: 1.2;
    }
    .pf-k__prefix-grid {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
      display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); grid-auto-rows: minmax(44px, calc(var(--k-row) - 6px));
      gap: var(--k-gap); align-content: start;
    }
    /* The prefix grid scrolls: its keys allow a vertical pan (a scroll
       cancels the press — prefixes act on release). */
    .pf-k__key--prefix { touch-action: pan-y; }
    .pf-k__key--prefix { flex-direction: column; gap: 1px; font-size: 15px; font-weight: 600; letter-spacing: 0.04em; }
    .pf-k__prefix-hint { font-size: 10.5px; font-weight: 500; color: var(--k-muted); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
    .pf-k__prefix-empty { grid-column: 1 / -1; font-size: 13px; color: var(--k-muted); padding: 8px 2px; }

    @keyframes pf-k-rise { from { transform: translateY(100%); } to { transform: none; } }
    @keyframes pf-k-nope { 0%, 100% { transform: none; } 30% { transform: translateX(-3px); } 65% { transform: translateX(3px); } }
    .pf-k--still, .pf-k--still .pf-k__key, .pf-k--still .pf-k__enter { animation: none !important; transition: none !important; }
    .pf-k--still .pf-k__key:active, .pf-k--still .pf-k__enter:active { transform: none; }
    @media (prefers-reduced-motion: reduce) {
      .pf-k, .pf-k__key, .pf-k__enter { animation: none !important; transition: none !important; }
      .pf-k__key:active, .pf-k__enter:active { transform: none; }
    }
  `],
})
export class PfKeysPanelComponent {
  readonly svc = inject(NumpadService);
  readonly rows = QWERTY_ROWS;
  readonly codeDigits = CODE_DIGITS;
  readonly numberDigits = NUMBER_DIGITS;
  readonly field = computed<PfKeysField | null>(() => {
    const f = this.svc.current();
    return this.svc.open() && isKeysField(f) ? f : null;
  });
  private readonly surface = viewChild<ElementRef<HTMLElement>>('surface');
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pointer-press bookkeeping (rollover map + ghost-click swallow). */
  readonly tap = new KeyTap(inject(DOCUMENT, { optional: true }));

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.tap.destroy(); this.clearHold(); });
    effect(() => {
      const el = this.surface()?.nativeElement ?? null;
      this.svc.keysLayout();
      untracked(() => this.svc.registerSurface(el, 'keys'));
    });
  }

  aria(ch: string): string { return keyAria(ch); }
  numericOf(f: PfKeysField) { return numericLayoutOf(f.keysKind()); }

  /** Keep focus on the field, and keep the tap from page-level
   *  outside-click listeners (a search dropdown would close). */
  guard(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
  }

  /** A typing key: acts on pointerdown, once per pointer. */
  typeDown(e: PointerEvent, ch: string): void {
    if (this.tap.down(e)) this.svc.press(ch);
  }
  arrowDown(e: PointerEvent, dir: 1 | -1): void {
    if (this.tap.down(e)) this.svc.arrow(dir);
  }
  /** A commit key: acts when the same finger lifts on it. */
  commitUp(e: PointerEvent, act: PfKeysCommit, arg?: string): void {
    if (this.tap.release(e)) this.run(act, arg);
  }
  /** A commit key's action (also the keyboard / screen-reader click). */
  run(act: PfKeysCommit, arg?: string): void {
    switch (act) {
      case 'enter': this.svc.next(); break;
      case 'layout': if (arg) this.svc.setLayout(arg as ReturnType<typeof numericLayoutOf>); break;
      case 'prefix': if (arg) this.svc.press(arg); break;
      case 'hide': this.svc.dismiss(); break;
      case 'system': this.svc.systemKeyboard(); break;
    }
  }

  /** ⌫ deletes on touch-down (like the iPad's own keyboard); held for
   *  LONG_PRESS_MS it clears the rest of the field. */
  backDown(e: PointerEvent): void {
    if (!this.tap.down(e)) return;
    this.svc.backspace();
    this.clearHold();
    this.holdTimer = setTimeout(() => { this.holdTimer = null; this.svc.clear(); }, LONG_PRESS_MS);
  }
  holdEnd(): void { this.clearHold(); }
  private clearHold(): void {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
  }
}
