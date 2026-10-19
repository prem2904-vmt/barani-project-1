import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EmbeddedViewRef,
  HostListener,
  OnDestroy,
  TemplateRef,
  ViewChild,
  ViewEncapsulation,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import type { PackageSuggestion, SuggestCatalogItem } from './package-suggest';

/**
 * The package / profile suggestions under the cart (Order & Payments).
 * Compact 1-line info design (ND pattern):
 *  - SAVING: "Save ₹X" + ~~what your tests cost now~~ → the bundle price,
 *    a secondary "Apply" button. The only place a price is struck through.
 *  - UPGRADE: quiet neutral card, "+₹X · adds N more tests (worth ₹Y
 *    individually)" + "₹A instead of ₹B if ordered separately", a text
 *    "Upgrade" button — never a strike-through, never the primary.
 *
 * Clipping fix: "What's included" menu is portalled into a singleton overlay host
 * on <body> (#pf-overlay-host, matching pf-select), preventing any clipping from
 * .pf-card { overflow: hidden } or ancestral transforms.
 * On desktop/tablet, it floats freely to the left of the billing card.
 * On mobile, it opens as an accessible bottom sheet modal with backdrop.
 *
 * ViewEncapsulation.None: required because the portalled menu lives outside
 * this component's host element on <body>.
 */
@Component({
  selector: 'pf-package-suggest',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [CurrencyInrPipe],
  template: `
    @if (suggestions().length > 0) {
    <div class="pf-psg-head">
      <span class="pf-psg-title">Package suggestions</span>
      @if (suggestions().length > 1) {
      <div class="pf-psg-nav" aria-label="Browse package suggestions">
        <button type="button" aria-label="Previous package suggestion" (click)="scrollSuggestions(-1, suggestionsRail)" [disabled]="!canGoPrevious()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <button type="button" aria-label="Next package suggestion" (click)="scrollSuggestions(1, suggestionsRail)" [disabled]="!canGoNext()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>
      }
    </div>
    <section class="pf-psg" #suggestionsRail (scroll)="updateSuggestionNav(suggestionsRail)" aria-label="Packages that include your tests">
      @for (s of suggestions(); track s.bundle.id) {
      <article class="pf-psg__card" [class.pf-psg__card--saving]="s.kind === 'saving'"
        [class.pf-psg__card--upgrade]="s.kind === 'upgrade'" [attr.data-kind]="s.kind">
        <div class="pf-psg__main">
          <!-- Icon -->
          <span class="pf-psg__icon" aria-hidden="true">
            @if (s.kind === 'saving') {
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <circle cx="7" cy="7" r="1.5" />
            </svg>
            } @else {
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="m16 12-4-4-4 4" /><path d="M12 16V8" />
            </svg>
            }
          </span>

          <!-- Package/Profile Name, Test Count & Accordion trigger -->
          <button type="button" class="pf-psg__more pf-psg__accordion" [attr.aria-expanded]="isOpen(s.bundle.id)"
            [attr.aria-controls]="'pf-psg-m-' + s.bundle.id" (click)="toggle(s.bundle.id, $event, moreBtn)"
            [attr.aria-label]="nameOf()(s.bundle) + ' (' + testsWord(s.members.length) + ')'" #moreBtn>
            <span class="pf-psg__name">{{ nameOf()(s.bundle) }}</span>
            <span class="pf-psg__kind">{{ kindLabel(s.bundle) }}</span>
            <span class="pf-psg__count">({{ testsWord(s.members.length) }})</span>
            <svg class="pf-psg__chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>

          <!-- Price -->
          <div class="pf-psg__price">
            @if (s.kind === 'saving') {
              @if (s.savings > 0) {
              <s class="pf-psg__was" [attr.aria-label]="'was ' + (s.coveredAmount | inr)">{{ s.coveredAmount | inr }}</s>
              }
              <strong class="pf-psg__now">{{ s.bundleAmount | inr }}</strong>
            } @else {
              <strong class="pf-psg__extra">+{{ s.extraCost | inr }}</strong>
            }
          </div>

          <!-- Action button -->
          @if (s.kind === 'saving') {
          <button type="button" class="pf-btn pf-btn--secondary pf-psg__act" (click)="apply.emit(s)"
            [attr.aria-label]="'Apply ' + nameOf()(s.bundle)">Apply</button>
          } @else {
          <button type="button" class="pf-btn pf-btn--tertiary pf-psg__act" (click)="apply.emit(s)"
            [attr.aria-label]="'Upgrade to ' + nameOf()(s.bundle) + ' for ' + (s.extraCost | inr) + ' more'">Upgrade</button>
          }
        </div>
      </article>
      }
    </section>

    <ng-template #menuTpl let-s>
      <div class="pf-psg-backdrop" [class.pf-psg-backdrop--subtle]="menuPos().mode === 'flyout-left'" (click)="closeMenu($event)"></div>
      <div class="pf-psg-menu"
        [class.pf-psg-menu--sheet]="menuPos().mode === 'bottom-sheet'"
        [class.pf-psg-menu--popover]="menuPos().mode === 'popover-above'"
        [class.pf-psg-menu--flyout]="menuPos().mode === 'flyout-left'"
        [style.right.px]="menuPos().mode !== 'bottom-sheet' ? menuPos().right : null"
        [style.bottom.px]="menuPos().mode !== 'bottom-sheet' ? menuPos().bottom : null"
        [style.width.px]="menuPos().mode !== 'bottom-sheet' ? menuPos().width : null"
        role="dialog" aria-modal="true" [attr.aria-label]="'Tests in ' + nameOf()(s.bundle)"
        (click)="$event.stopPropagation()">

        <div class="pf-psg-menu__drag" aria-hidden="true"></div>

        <div class="pf-psg-menu__head">
          <div class="pf-psg-menu__title-group">
            <h3 class="pf-psg-menu__title">What's included</h3>
            <span class="pf-psg-menu__badge">{{ testsWord(s.members.length) }}</span>
          </div>
          <button type="button" class="pf-psg-menu__close" aria-label="Close" (click)="closeMenu($event)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="pf-psg-menu__bundle-summary" [class.pf-psg-menu__bundle-summary--saving]="s.kind === 'saving'">
          <div class="pf-psg-menu__bundle-top">
            <span class="pf-psg-menu__bundle-name">{{ nameOf()(s.bundle) }}</span>
            <span class="pf-psg__kind">{{ kindLabel(s.bundle) }}</span>
          </div>
          @if (s.kind === 'saving') {
          <p class="pf-psg-menu__bundle-lead">
            @if (s.savings > 0) {
            <strong>Save {{ s.savings | inr }}</strong>
            <span class="pf-psg__sep" aria-hidden="true">·</span>
            <s class="pf-psg__was">{{ s.coveredAmount | inr }}</s>
            <strong class="pf-psg__now">{{ s.bundleAmount | inr }}</strong>
            } @else {
            <strong>Same price</strong>
            <span class="pf-psg__sep" aria-hidden="true">·</span>
            <span>{{ s.bundleAmount | inr }} (adds {{ s.extraCount }} more tests)</span>
            }
          </p>
          } @else {
          <p class="pf-psg-menu__bundle-lead">
            <strong class="pf-psg__extra">+{{ s.extraCost | inr }}</strong>
            <span class="pf-psg__sep" aria-hidden="true">·</span>
            <span>adds {{ s.extraCount }} more tests</span>
          </p>
          <p class="pf-psg-menu__sub-note">
            {{ s.bundleAmount | inr }} instead of {{ s.membersAmount | inr }} if ordered separately
          </p>
          }
        </div>

        <ul class="pf-psg__members" [id]="'pf-psg-m-' + s.bundle.id">
          @for (m of s.members; track m.id) {
          <li class="pf-psg__m" [class.pf-psg__m--in]="m.inCart">
            <span class="pf-psg__tick" aria-hidden="true">
              @if (m.inCart) {
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
                stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              } @else {
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
              }
            </span>
            <span class="pf-psg__mname">{{ m.name }}@if (m.inCart) {<span class="pf-psg__sr">, in your cart</span>}</span>
            @if (m.inCart) { <span class="pf-psg__mtag">In cart</span> }
            <span class="pf-psg__mprice">{{ m.amount | inr }}</span>
          </li>
          }
        </ul>

        <div class="pf-psg-menu__foot">
          <div class="pf-psg-menu__total-box">
            <span class="pf-psg-menu__total-lbl">Bundle Price</span>
            <span class="pf-psg-menu__total-val">{{ s.bundleAmount | inr }}</span>
          </div>
          @if (s.kind === 'saving') {
          <button type="button" class="pf-btn pf-btn--secondary pf-psg-menu__act"
            (click)="applySuggestion(s, $event)">Apply</button>
          } @else {
          <button type="button" class="pf-btn pf-btn--tertiary pf-psg-menu__act"
            (click)="applySuggestion(s, $event)">Upgrade</button>
          }
        </div>
      </div>
    </ng-template>
    }
  `,
  styles: [`
    pf-package-suggest { display: block; min-width: 0; container-type: inline-size; }
    .pf-psg-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 22px;
      margin-top: 8px;
      margin-bottom: 4px;
      color: var(--text-tertiary);
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .pf-psg-nav { display: flex; align-items: center; gap: 4px; }
    .pf-psg-nav button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border: 1px solid var(--pf-line);
      border-radius: 6px;
      background: var(--pf-card-bg);
      color: var(--text-secondary);
      cursor: pointer;
      padding: 0;
      transition: background var(--pf-dur-fast, 150ms) ease, color var(--pf-dur-fast, 150ms) ease;
    }
    .pf-psg-nav button:hover:not(:disabled) { background: var(--pf-chip-bg); color: var(--text-primary); }
    .pf-psg-nav button:disabled { opacity: .35; cursor: default; }
    .pf-psg-nav button:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }

    .pf-psg {
      display: flex;
      flex-direction: row;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
      scroll-snap-type: x mandatory;
      scrollbar-width: none;
      gap: 8px;
      padding-bottom: 2px;
    }
    .pf-psg::-webkit-scrollbar { display: none; }

    .pf-psg__card {
      flex: 0 0 100%;
      scroll-snap-align: start;
      border-radius: var(--pf-radius, 10px);
      border: 1px solid var(--pf-line);
      background: var(--pf-card-bg);
      padding: 6px 10px;
      min-width: 0;
      box-sizing: border-box;
      transition: border-color var(--pf-dur-fast, 150ms) ease;
    }
    .pf-psg__card--saving {
      background: var(--pf-in-tint);
      border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 28%, var(--pf-line));
    }
    .pf-psg__main {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      min-height: 28px;
    }
    .pf-psg__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      color: var(--violet-text, #6d28d9);
    }
    .pf-psg__card--upgrade .pf-psg__icon {
      color: var(--text-tertiary);
    }
    .pf-psg__more {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex: 1 1 auto;
      min-width: 0;
      height: auto;
      min-height: 24px;
      padding: 2px 4px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      text-align: left;
      overflow: hidden;
      transition: background var(--pf-dur-fast, 150ms) ease, border-color var(--pf-dur-fast, 150ms) ease;
    }
    .pf-psg__more:hover {
      background: var(--pf-chip-bg);
      border-color: var(--pf-line);
    }
    .pf-psg__more:focus-visible {
      outline: 2px solid var(--color-violet-600, #7c3aed);
      outline-offset: 1px;
    }
    .pf-psg__name {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .pf-psg__kind {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 4px;
      background: var(--pf-chip-bg);
      color: var(--text-secondary);
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      flex: none;
      vertical-align: 1px;
    }
    .pf-psg__count {
      font-size: 11.5px;
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      flex: none;
    }
    .pf-psg__chev {
      flex: none;
      color: var(--text-tertiary);
      transition: transform var(--pf-dur-fast, 200ms) ease, color var(--pf-dur-fast, 150ms) ease;
    }
    .pf-psg__more:hover .pf-psg__chev {
      color: var(--text-primary);
    }
    .pf-psg__more[aria-expanded='true'] .pf-psg__chev {
      transform: rotate(180deg);
    }
    .pf-psg__price {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex: none;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      margin-left: auto;
    }
    .pf-psg__was { color: var(--text-tertiary); text-decoration: line-through; font-size: 11px; }
    .pf-psg__now { color: var(--text-primary); font-weight: 700; font-size: 13px; }
    .pf-psg__extra { color: var(--text-primary); font-weight: 700; font-size: 13px; }
    .pf-psg__act {
      flex: none;
      height: 26px;
      min-height: 26px;
      padding: 0 10px;
      font-size: 11.5px;
      font-weight: 600;
      border-radius: 6px;
    }

    /* Backdrop */
    .pf-psg-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(2px);
      z-index: 10000;
      pointer-events: auto;
      animation: pf-psg-fade-in 180ms ease;
    }
    .pf-psg-backdrop--subtle {
      background: transparent;
      backdrop-filter: none;
    }

    /* Menu container */
    .pf-psg-menu {
      position: fixed;
      z-index: 10001;
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      background: var(--pf-card-bg);
      border: 1px solid var(--pf-line);
      box-shadow: 0 18px 40px -4px rgba(15, 23, 42, 0.25), 0 8px 18px -2px rgba(15, 23, 42, 0.12);
      box-sizing: border-box;
      overflow: hidden;
      max-height: min(520px, calc(100vh - 36px));
    }

    .pf-psg-menu__drag { display: none; }

    /* Desktop Wide flyout (left of billing card) */
    .pf-psg-menu--flyout {
      border-radius: var(--pf-radius, 12px);
      padding: 12px 14px;
      animation: pf-psg-flyout-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* Narrow desktop / tablet popover (above suggestion card) */
    .pf-psg-menu--popover {
      border-radius: var(--pf-radius, 12px);
      padding: 12px 14px;
      animation: pf-psg-popover-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* Mobile bottom sheet */
    .pf-psg-menu--sheet {
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100% !important;
      max-height: 82dvh;
      border-radius: 18px 18px 0 0;
      border-bottom: none;
      padding: 10px 16px max(16px, env(safe-area-inset-bottom, 16px));
      animation: pf-psg-sheet-up 240ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .pf-psg-menu--sheet .pf-psg-menu__drag {
      display: block;
      width: 36px;
      height: 4px;
      border-radius: 2px;
      background: var(--pf-line);
      margin: 0 auto 10px;
    }

    .pf-psg-menu__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .pf-psg-menu__title-group {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pf-psg-menu__title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      color: var(--text-primary);
    }
    .pf-psg-menu__badge {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      background: var(--pf-chip-bg);
      padding: 1px 6px;
      border-radius: 6px;
    }
    .pf-psg-menu__close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: 1px solid var(--pf-line);
      border-radius: 6px;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 0;
      transition: background var(--pf-dur-fast, 150ms) ease, color var(--pf-dur-fast, 150ms) ease;
    }
    .pf-psg-menu__close:hover {
      background: var(--pf-chip-bg);
      color: var(--text-primary);
    }

    .pf-psg-menu__bundle-summary {
      background: var(--pf-chip-bg);
      border: 1px solid var(--pf-line);
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 8px;
    }
    .pf-psg-menu__bundle-summary--saving {
      background: var(--pf-in-tint);
      border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 28%, var(--pf-line));
    }
    .pf-psg-menu__bundle-top {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 3px;
    }
    .pf-psg-menu__bundle-name {
      font-size: 12.5px;
      font-weight: 700;
      color: var(--text-primary);
    }
    .pf-psg-menu__bundle-lead {
      margin: 0;
      font-size: 11.5px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 4px;
      font-variant-numeric: tabular-nums;
    }
    .pf-psg-menu__sub-note {
      margin: 2px 0 0;
      font-size: 11px;
      color: var(--text-tertiary);
    }

    .pf-psg__members {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 220px;
      overflow-y: auto;
    }
    .pf-psg__m {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 28px;
      padding: 2px;
      font-size: 12px;
      color: var(--text-primary);
    }
    .pf-psg__tick {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 1px solid var(--pf-line);
      color: var(--text-tertiary);
    }
    .pf-psg__m--in .pf-psg__tick {
      border-color: transparent;
      color: #fff;
      background: var(--color-primary, #7c3aed);
    }
    .pf-psg__mname { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; line-height: 1.3; }
    .pf-psg__mtag {
      flex: none;
      padding: 1px 5px;
      border-radius: 4px;
      background: var(--pf-chip-bg);
      color: var(--text-secondary);
      font-size: 10px;
      font-weight: 600;
    }
    .pf-psg__mprice { flex: none; margin-left: auto; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
    .pf-psg__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    .pf-psg-menu__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--pf-line);
    }
    .pf-psg-menu__total-box {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .pf-psg-menu__total-lbl {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-tertiary);
    }
    .pf-psg-menu__total-val {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
    }
    .pf-psg-menu__act {
      height: 32px;
      min-height: 32px;
      padding: 0 14px;
      font-size: 12.5px;
      font-weight: 600;
      border-radius: 6px;
    }

    @keyframes pf-psg-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes pf-psg-flyout-in {
      from { opacity: 0; transform: scale(0.96) translateX(8px); }
      to { opacity: 1; transform: scale(1) translateX(0); }
    }
    @keyframes pf-psg-popover-in {
      from { opacity: 0; transform: scale(0.96) translateY(8px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes pf-psg-sheet-up {
      from { transform: translateY(100%); }
      to { transform: none; }
    }

    @container (max-width: 480px) {
      .pf-psg__more-hint { display: none; }
      .pf-psg__line-note { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pf-psg__chev { transition: none; }
      .pf-psg-menu, .pf-psg-backdrop { animation: none; }
    }
  `],
})
export class PackageSuggestCardComponent implements OnDestroy {
  @ViewChild('menuTpl') private menuTpl?: TemplateRef<any>;
  private menuRef?: EmbeddedViewRef<any>;

  private readonly appRef = inject(ApplicationRef);
  private readonly el = inject(ElementRef);

  readonly suggestions = input<PackageSuggestion<any>[]>([]);
  /** How the host names a test (e.g. "Thyroid Profile (TFT)"). */
  readonly nameOf = input<(t: SuggestCatalogItem) => string>(t => t.name);
  readonly apply = output<PackageSuggestion<any>>();

  readonly openId = signal<string | null>(null);
  readonly canGoPrevious = signal(false);
  readonly canGoNext = signal(true);
  readonly menuPos = signal<{
    right?: number;
    bottom?: number;
    width?: number;
    mode: 'bottom-sheet' | 'flyout-left' | 'popover-above';
  }>({ mode: 'flyout-left' });

  private static overlayHost: HTMLElement | null = null;
  private static getOverlayHost(): HTMLElement {
    if (typeof document === 'undefined') return null as any;
    if (!PackageSuggestCardComponent.overlayHost || !document.body.contains(PackageSuggestCardComponent.overlayHost)) {
      let host = document.getElementById('pf-overlay-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'pf-overlay-host';
        document.body.appendChild(host);
      }
      PackageSuggestCardComponent.overlayHost = host;
    }
    return PackageSuggestCardComponent.overlayHost;
  }

  updateSuggestionNav(rail: HTMLElement): void {
    this.canGoPrevious.set(rail.scrollLeft > 1);
    this.canGoNext.set(rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1);
  }
  scrollSuggestions(direction: -1 | 1, rail: HTMLElement): void {
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const step = rail.querySelector<HTMLElement>('.pf-psg__card')?.offsetWidth ?? rail.clientWidth;
    rail.scrollBy({ left: direction * (step + 8), behavior });
  }

  isOpen(id: string): boolean {
    return this.openId() === id;
  }

  toggle(id: string, ev?: Event, btn?: HTMLElement): void {
    if (ev) {
      ev.stopPropagation();
      ev.preventDefault();
    }
    if (this.isOpen(id)) {
      this.closeMenu();
    } else {
      this.openMenu(id, btn);
    }
  }

  private openMenu(id: string, btn?: HTMLElement): void {
    this.closeMenu();
    this.openId.set(id);
    const s = this.suggestions().find(item => item.bundle.id === id);
    if (!s || !this.menuTpl) return;

    this.calcMenuPos(btn);

    this.menuRef = this.menuTpl.createEmbeddedView({ $implicit: s });
    this.appRef.attachView(this.menuRef);
    this.menuRef.detectChanges();

    const host = PackageSuggestCardComponent.getOverlayHost() ?? this.el.nativeElement;
    for (const node of this.menuRef.rootNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        host.appendChild(node);
      }
    }
    this.addScrollListeners();
  }

  closeMenu(ev?: Event): void {
    if (ev) ev.stopPropagation();
    this.removeScrollListeners();
    if (this.menuRef) {
      for (const node of this.menuRef.rootNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
      this.appRef.detachView(this.menuRef);
      this.menuRef.destroy();
      this.menuRef = undefined;
    }
    this.openId.set(null);
  }

  applySuggestion(s: PackageSuggestion<any>, ev?: Event): void {
    if (ev) ev.stopPropagation();
    this.closeMenu();
    this.apply.emit(s);
  }

  calcMenuPos(btn?: HTMLElement): void {
    if (typeof window === 'undefined') return;
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      this.menuPos.set({ mode: 'bottom-sheet' });
      this.menuRef?.detectChanges();
      return;
    }
    const trigger = btn ?? (this.el.nativeElement.querySelector('.pf-psg__more') as HTMLElement | null);
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const sideCard = trigger.closest('.pf-oc-side') ?? trigger.closest('.pf-card') ?? trigger;
    const cardRect = sideCard ? sideCard.getBoundingClientRect() : r;

    // Available space to the left of the billing card
    const spaceOnLeft = cardRect.left - 16;
    const desiredWidth = 360;

    if (spaceOnLeft >= 340) {
      // Wide desktop: float to the left of the billing card (matches yellow highlighted area)
      const menuWidth = Math.min(desiredWidth, spaceOnLeft);
      const right = Math.max(16, window.innerWidth - cardRect.left + 12);
      const menuMaxH = Math.min(500, window.innerHeight - 32);
      let bottom = window.innerHeight - r.bottom;
      bottom = Math.max(16, Math.min(bottom, window.innerHeight - menuMaxH - 16));

      this.menuPos.set({
        mode: 'flyout-left',
        right,
        bottom,
        width: menuWidth,
      });
    } else {
      // Narrow desktop or tablet where space on the left is limited (<340px)
      // Popover directly above the package suggestion card within the billing card column
      const menuWidth = Math.min(desiredWidth, cardRect.width, window.innerWidth - 32);
      const right = Math.max(16, window.innerWidth - cardRect.right);
      const menuMaxH = Math.min(480, window.innerHeight - 32);
      let bottom = window.innerHeight - r.top + 8;
      bottom = Math.max(16, Math.min(bottom, window.innerHeight - menuMaxH - 16));

      this.menuPos.set({
        mode: 'popover-above',
        right,
        bottom,
        width: menuWidth,
      });
    }
    this.menuRef?.detectChanges();
  }

  private readonly onCaptureScroll = (ev: Event): void => {
    if (!this.openId()) return;
    const menuEl = document.querySelector('.pf-psg-menu');
    if (menuEl && ev.target && menuEl.contains(ev.target as Node)) {
      return;
    }
    this.calcMenuPos();
  };

  private addScrollListeners(): void {
    window.addEventListener('scroll', this.onCaptureScroll, { capture: true, passive: true });
    window.addEventListener('resize', this.onCaptureScroll, { capture: true, passive: true });
  }

  private removeScrollListeners(): void {
    window.removeEventListener('scroll', this.onCaptureScroll, true);
    window.removeEventListener('resize', this.onCaptureScroll, true);
  }

  @HostListener('document:click', ['$event.target'])
  onDocClick(target: EventTarget | null): void {
    if (!this.openId()) return;
    const clickedInsideTrigger = (target as HTMLElement)?.closest?.('.pf-psg__more');
    const clickedInsideMenu = (target as HTMLElement)?.closest?.('.pf-psg-menu');
    if (!clickedInsideTrigger && !clickedInsideMenu) {
      this.closeMenu();
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.closeMenu();
  }

  ngOnDestroy(): void {
    this.closeMenu();
  }

  kindLabel(t: SuggestCatalogItem): string { return t.type === 'profile' ? 'Profile' : 'Package'; }
  coveredCount(s: PackageSuggestion<any>): number { return s.members.filter(m => m.inCart).length || s.coveredIds.length; }
  testsWord(n: number): string { return `${n} test${n === 1 ? '' : 's'}`; }
}
