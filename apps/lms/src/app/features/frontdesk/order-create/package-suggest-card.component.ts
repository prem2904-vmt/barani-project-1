import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import type { PackageSuggestion, SuggestCatalogItem } from './package-suggest';

/**
 * The package / profile suggestions under the cart (Order & Payments).
 * Two honest cards (see package-suggest.ts):
 *  - SAVING: "Save ₹X" + ~~what your tests cost now~~ → the bundle price,
 *    a secondary "Switch" button. The only place a price is struck through.
 *  - UPGRADE: quiet neutral card, "+₹X · adds N more tests (worth ₹Y
 *    individually)" + "₹A instead of ₹B if ordered separately", a text
 *    "Upgrade" button — never a strike-through, never the primary.
 * Each card has a "What's included" disclosure: tests already in the cart
 * are ticked, the extra ones are listed with their individual prices.
 * ND pattern: violet + neutrals only, 44px targets, names wrap (no
 * truncation), stroked SVG icons, light + dark via theme tokens.
 */
@Component({
  selector: 'pf-package-suggest',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyInrPipe],
  template: `
    @if (suggestions().length > 0) {
    <div class="pf-psg-head">
      <span>Package suggestions</span>
      @if (suggestions().length > 1) {
      <div class="pf-psg-nav" aria-label="Browse package suggestions">
        <button type="button" aria-label="Previous package suggestion" (click)="scrollSuggestions(-1, suggestionsRail)" [disabled]="!canGoPrevious()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <button type="button" aria-label="Next package suggestion" (click)="scrollSuggestions(1, suggestionsRail)" [disabled]="!canGoNext()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>
      }
    </div>
    <section class="pf-psg" #suggestionsRail (scroll)="updateSuggestionNav(suggestionsRail)" aria-label="Packages that include your tests">
      @for (s of suggestions(); track s.bundle.id) {
      <article class="pf-psg__card" [class.pf-psg__card--saving]="s.kind === 'saving'"
        [class.pf-psg__card--upgrade]="s.kind === 'upgrade'" [attr.data-kind]="s.kind">
        <div class="pf-psg__main">
          <div class="pf-psg__text">
            @if (s.kind === 'saving') {
            <p class="pf-psg__lead">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <circle cx="7" cy="7" r="1.5" />
              </svg>
              @if (s.savings > 0) {
              <span class="pf-psg__save">Save {{ s.savings | inr }}</span>
              } @else {
              <span class="pf-psg__save">Same price, {{ s.extraCount }} more test{{ s.extraCount === 1 ? '' : 's' }}</span>
              }
            </p>
            <p class="pf-psg__name">{{ nameOf()(s.bundle) }} <span class="pf-psg__kind">{{ kindLabel(s.bundle) }}</span></p>
            <p class="pf-psg__line">
              @if (s.savings > 0) {
              <s class="pf-psg__was" [attr.aria-label]="'was ' + (s.coveredAmount | inr)">{{ s.coveredAmount | inr }}</s>
              }
              <strong class="pf-psg__now">{{ s.bundleAmount | inr }}</strong>
              <span>for your {{ testsWord(coveredCount(s)) }}@if (s.extraCount > 0) { + {{ s.extraCount }} more}</span>
            </p>
            } @else {
            <p class="pf-psg__lead pf-psg__lead--quiet">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="m16 12-4-4-4 4" /><path d="M12 16V8" />
              </svg>
              <span>Upgrade to {{ nameOf()(s.bundle) }} <span class="pf-psg__kind">{{ kindLabel(s.bundle) }}</span></span>
            </p>
            <p class="pf-psg__line">
              <strong class="pf-psg__extra">+{{ s.extraCost | inr }}</strong>
              <span class="pf-psg__sep" aria-hidden="true">·</span>
              <span>adds {{ s.extraCount }} more test{{ s.extraCount === 1 ? '' : 's' }} (worth {{ s.extraMembersAmount | inr }} individually)</span>
            </p>
            <p class="pf-psg__line pf-psg__line--muted">
              {{ s.bundleAmount | inr }} instead of {{ s.membersAmount | inr }} if ordered separately
            </p>
            }
          </div>
          @if (s.kind === 'saving') {
          <button type="button" class="nd-btn nd-btn--secondary pf-psg__act" (click)="apply.emit(s)"
            [attr.aria-label]="'Switch to ' + nameOf()(s.bundle) + (s.savings > 0 ? ', save ' + (s.savings | inr) : '')">Switch</button>
          } @else {
          <button type="button" class="nd-btn nd-btn--tertiary pf-psg__act" (click)="apply.emit(s)"
            [attr.aria-label]="'Upgrade to ' + nameOf()(s.bundle) + ' for ' + (s.extraCost | inr) + ' more'">Upgrade</button>
          }
        </div>
        <button type="button" class="pf-psg__more" [attr.aria-expanded]="isOpen(s.bundle.id)"
          [attr.aria-controls]="'pf-psg-m-' + s.bundle.id" (click)="toggle(s.bundle.id)">
          <span>What's included · {{ testsWord(s.members.length) }}</span>
          <svg class="pf-psg__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        @if (isOpen(s.bundle.id)) {
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
        }
      </article>
      }
    </section>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .pf-psg-head { display: none; }
    .pf-psg { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
    .pf-psg__card {
      border-radius: var(--nd-radius, 12px); border: 1px solid var(--nd-line);
      background: var(--nd-card-bg); padding: 10px 12px 4px;
      min-width: 0;
    }
    .pf-psg__card--saving {
      background: var(--nd-in-tint);
      border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 32%, var(--nd-line));
    }
    .pf-psg__main { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
    .pf-psg__text { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .pf-psg__text p { margin: 0; }
    .pf-psg__lead {
      display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700;
      color: var(--violet-text, #6d28d9); overflow-wrap: anywhere;
    }
    .pf-psg__lead > svg { flex: none; }
    .pf-psg__lead--quiet { font-size: 13px; font-weight: 600; color: var(--text-primary); align-items: flex-start; }
    .pf-psg__lead--quiet > svg { color: var(--text-tertiary); margin-top: 1px; }
    .pf-psg__name { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-psg__kind {
      display: inline-block; margin-left: 4px; padding: 0 6px; border-radius: 6px;
      background: var(--nd-chip-bg); color: var(--text-secondary);
      font-size: 10.5px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; vertical-align: 1px;
    }
    .pf-psg__line {
      font-size: 12px; line-height: 1.45; color: var(--text-secondary); font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .pf-psg__line--muted { color: var(--text-tertiary); }
    .pf-psg__was { color: var(--text-tertiary); text-decoration: line-through; }
    .pf-psg__now { color: var(--text-primary); font-weight: 700; font-size: 13px; }
    .pf-psg__extra { color: var(--text-primary); font-weight: 700; }
    .pf-psg__sep { opacity: 0.6; margin-right: 5px; }
    /* Angular drops whitespace-only nodes between elements: space by margin. */
    .pf-psg__was, .pf-psg__now, .pf-psg__extra { margin-right: 5px; }
    .pf-psg__act { flex: none; }
    .pf-psg__more {
      display: flex; align-items: center; gap: 6px; width: 100%; min-height: 44px; margin-top: 2px; padding: 0 2px;
      border: 0; border-top: 1px solid var(--nd-line); background: transparent; color: var(--text-secondary);
      font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; text-align: left;
    }
    .pf-psg__more:hover { color: var(--text-primary); }
    .pf-psg__more:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; border-radius: 6px; }
    .pf-psg__chev { margin-left: auto; flex: none; transition: transform var(--nd-dur-fast, 200ms) ease; }
    .pf-psg__more[aria-expanded='true'] .pf-psg__chev { transform: rotate(180deg); }
    .pf-psg__members { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-psg__m { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 4px 2px; font-size: 12.5px; color: var(--text-primary); }
    .pf-psg__tick {
      display: inline-flex; align-items: center; justify-content: center; flex: none; width: 20px; height: 20px;
      border-radius: 50%; border: 1px solid var(--nd-line); color: var(--text-tertiary);
    }
    .pf-psg__m--in .pf-psg__tick {
      border-color: transparent; color: #fff; background: var(--color-primary, #7c3aed);
    }
    .pf-psg__mname { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; line-height: 1.3; }
    .pf-psg__mtag {
      flex: none; padding: 1px 6px; border-radius: 6px; background: var(--nd-chip-bg);
      color: var(--text-secondary); font-size: 10.5px; font-weight: 600;
    }
    .pf-psg__mprice { flex: none; margin-left: auto; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
    .pf-psg__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    /* Billing can be a narrow phone sheet or a desktop side card. Keep its
       suggestions in a horizontal, peekable rail when vertical space is at
       a premium, so the cart and pinned payment actions remain in view. */
    @container (max-width: 600px) {
      .pf-psg-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 44px;
        color: var(--text-tertiary);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: .04em;
        text-transform: uppercase;
      }
      .pf-psg-nav { display: flex; align-items: center; gap: 4px; }
      .pf-psg-nav button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border: 1px solid var(--nd-line);
        border-radius: 10px;
        background: var(--nd-card-bg);
        color: var(--text-secondary);
        cursor: pointer;
      }
      .pf-psg-nav button:disabled { opacity: .45; cursor: default; }
      .pf-psg-nav button:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
      .pf-psg {
        flex-direction: row;
        overflow-x: auto;
        overscroll-behavior-inline: contain;
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
        padding: 0 12px 2px 0;
        margin-right: -12px;
      }
      .pf-psg::-webkit-scrollbar { display: none; }
      .pf-psg__card {
        flex: 0 0 min(86%, 320px);
        scroll-snap-align: start;
      }
    }
    @media (prefers-reduced-motion: reduce) { .pf-psg__chev { transition: none; } }
  `],
})
export class PackageSuggestCardComponent {
  readonly suggestions = input<PackageSuggestion<any>[]>([]);
  /** How the host names a test (e.g. "Thyroid Profile (TFT)"). */
  readonly nameOf = input<(t: SuggestCatalogItem) => string>(t => t.name);
  readonly apply = output<PackageSuggestion<any>>();

  private readonly open = signal<ReadonlySet<string>>(new Set());
  readonly canGoPrevious = signal(false);
  readonly canGoNext = signal(true);
  updateSuggestionNav(rail: HTMLElement): void {
    this.canGoPrevious.set(rail.scrollLeft > 1);
    this.canGoNext.set(rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1);
  }
  scrollSuggestions(direction: -1 | 1, rail: HTMLElement): void {
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const step = rail.querySelector<HTMLElement>('.pf-psg__card')?.offsetWidth ?? rail.clientWidth;
    rail.scrollBy({ left: direction * (step + 8), behavior });
  }
  isOpen(id: string): boolean { return this.open().has(id); }
  toggle(id: string): void {
    this.open.update(cur => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  kindLabel(t: SuggestCatalogItem): string { return t.type === 'profile' ? 'Profile' : 'Package'; }
  coveredCount(s: PackageSuggestion<any>): number { return s.members.filter(m => m.inCart).length || s.coveredIds.length; }
  testsWord(n: number): string { return `${n} test${n === 1 ? '' : 's'}`; }
}
