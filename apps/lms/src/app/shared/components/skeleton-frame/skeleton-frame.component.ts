import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { SkeletonComponent } from '../../primitives/skeleton.component';
import { SkeletonDetailComponent, SkeletonRowsComponent } from '../../primitives/skeleton-kit.component';

/**
 * SKELETON FRAME BLOCKS — the loading look of the NEW frame (owner 2026-11-19: "the skeletons still draw the old
 * layouts"). Every block is drawn with the frame's OWN classes, so a skeleton occupies exactly the boxes the real
 * content lands in (no layout shift):
 *
 *   <pf-skel-two-panel>     side card (--pf-side-w, .pf-side-list rows) + main card (.pf-card__head + body), both the
 *                           same height, filling the band body; phone = ONE card (main, or the side list).
 *   <pf-skel-side-list>     the side card's rows (.pf-side-list / .pf-side-item: 44px, Test Master's department rows)
 *   <pf-skel-card-head>     a card head: icon tile + title + pills / search shapes (.pf-card__head)
 *   <pf-skel-grid>          an AG-Grid / pf-data-grid: header + N rows at the theme's row height
 *                           (--pf-grid-head-h / --pf-grid-row-h: web 56 / 40, touch 64 / 48 — read, never re-declared)
 *   <pf-skel-setting-rows>  Settings rows (.pf-srow geometry: label + hint left, control right, hairline)
 *   <pf-skel-tiles>         Settings tiles (.pf-ov__tile geometry: icon + title + subtitle)
 *   <pf-skel-doc>           a document / preview sheet (A4 page: letterhead, title, a table, lines)
 *
 * ONE shimmer: every shape is the kit's `pf-skeleton` (one viewport-anchored sweep, light + dark from the theme).
 * Reduced motion: static (no sweep — pf-skeleton — and no rise here). Accessibility: a block given a `label` is the
 * loading REGION (role=status, aria-busy, polite, visually hidden label); the shapes stay aria-hidden.
 */

const W = ['62%', '48%', '71%', '55%', '66%', '44%', '58%', '69%', '52%', '64%'];
const S = ['38%', '52%', '31%', '45%', '36%', '49%', '41%', '33%'];
function range(n: number, max = 60): number[] {
  const c = Math.max(0, Math.min(max, Math.floor(Number(n) || 0)));
  return Array.from({ length: c }, (_, i) => i);
}

/** Host bindings of a block: a region only when it carries a label (nested blocks stay silent). */
const REGION = {
  '[attr.role]': "label() ? 'status' : null",
  '[attr.aria-busy]': "label() ? 'true' : null",
  '[attr.aria-live]': "label() ? 'polite' : null",
};
const SR = `.pf-skf-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }`;
const RISE = `
  .pf-skf-rise { animation: pf-skf-rise 320ms cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay: calc(var(--i, 0) * 18ms); }
  @keyframes pf-skf-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .pf-skf-rise { animation: none !important; } }`;

// ── Side list ──────────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skel-side-list',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-skel-side-list', ...REGION },
  template: `
    @if (label()) { <span class="pf-skf-sr">{{ label() }}</span> }
    <ul class="pf-side-list" aria-hidden="true">
      @for (i of items(); track i) {
        @if (headingAt(i)) {
          <li class="pf-skf-heading"><pf-skeleton variant="line" width="34%" height="9px"></pf-skeleton></li>
        }
        <li><span class="pf-side-item pf-skf-item pf-skf-rise" [style.--i]="i" data-skel="side-row">
          <pf-skeleton variant="line" [width]="w(i)" height="11px"></pf-skeleton>
          @if (counts()) { <pf-skeleton class="pf-skf-count" variant="line" width="22px" height="10px"></pf-skeleton> }
        </span></li>
      }
    </ul>
  `,
  styles: [SR, RISE, `
    :host { display: block; min-width: 0; }
    .pf-side-list { margin: 0; }
    .pf-skf-item { cursor: default; pointer-events: none; }
    .pf-skf-count { margin-left: auto; }
    .pf-skf-heading { padding: 10px 10px 4px; list-style: none; }
  `],
})
export class SkelSideListComponent {
  readonly rows = input(8);
  /** Row indexes that start a group (a heading line drawn above them). */
  readonly headings = input<number[]>([]);
  readonly counts = input(true);
  readonly label = input('');
  protected readonly items = computed(() => range(this.rows()));
  protected headingAt(i: number): boolean { return this.headings().includes(i); }
  protected w(i: number): string { return W[i % W.length]; }
}

// ── Card head ──────────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skel-card-head',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-card__head pf-skel-card-head', 'aria-hidden': 'true', 'data-skel': 'card-head' },
  template: `
    @if (icon()) { <pf-skeleton class="pf-skf-icon" variant="block" width="28px" height="28px"></pf-skeleton> }
    <pf-skeleton variant="line" [width]="title()" height="12px"></pf-skeleton>
    @if (note()) { <pf-skeleton class="pf-skf-note" variant="line" width="22%" height="10px"></pf-skeleton> }
    <span class="pf-card__spacer"></span>
    @if (search()) { <pf-skeleton class="pf-skf-search" variant="block" width="220px" height="34px"></pf-skeleton> }
    @for (p of pillList(); track p) { <pf-skeleton class="pf-skf-pill" variant="pill" [width]="p === 0 ? '96px' : '76px'" height="34px"></pf-skeleton> }
  `,
  styles: [`
    :host { display: flex; flex-wrap: nowrap; min-height: 52px; }
    .pf-skf-icon { border-radius: 8px; }
    .pf-skf-search { border-radius: 10px; max-width: 34%; }
    .pf-skf-pill { flex: none; }
    @media (max-width: 767px) { .pf-skf-search, .pf-skf-note { display: none; } .pf-skf-pill:nth-of-type(n+2) { display: none; } }
  `],
})
export class SkelCardHeadComponent {
  /** Width of the title line (the label). */
  readonly title = input('26%');
  readonly icon = input(true);
  readonly note = input(false);
  readonly search = input(false);
  /** Pill / button shapes on the right (34px — the head buttons' height). */
  readonly pills = input(0);
  protected readonly pillList = computed(() => range(this.pills(), 4));
}

// ── Grid ───────────────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skel-grid',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-skel-grid', '[class.pf-skel-grid--fill]': 'fill()', ...REGION },
  template: `
    @if (label()) { <span class="pf-skf-sr">{{ label() }}</span> }
    <div class="pf-skf-grid" aria-hidden="true">
      @if (header()) {
        <div class="pf-skf-tr pf-skf-th" data-skel="grid-head" [style.grid-template-columns]="cols()">
          @for (c of colList(); track c) { <pf-skeleton variant="line" height="9px" [width]="c === 0 ? '44%' : '36%'"></pf-skeleton> }
        </div>
      }
      @for (r of rowList(); track r) {
        <div class="pf-skf-tr pf-skf-rise" data-skel="grid-row" [style.--i]="r" [style.grid-template-columns]="cols()">
          @for (c of colList(); track c) { <pf-skeleton variant="line" height="11px" [width]="cell(r, c)"></pf-skeleton> }
        </div>
      }
    </div>
  `,
  styles: [SR, RISE, `
    :host { display: block; min-width: 0; overflow: hidden; }
    :host(.pf-skel-grid--fill) { flex: 1 1 auto; min-height: 0; }
    .pf-skf-grid { display: flex; flex-direction: column; }
    /* The theme's row metrics, read from :root (styles.scss: web 56 / 40, touch 64 / 48). */
    .pf-skf-tr { display: grid; align-items: center; gap: 16px; height: var(--pf-grid-row-h); padding: 0 14px; flex: none;
      border-bottom: 1px solid var(--pf-line, var(--glass-border)); box-sizing: border-box; }
    .pf-skf-th { height: var(--pf-grid-head-h); }
  `],
})
export class SkelGridComponent {
  readonly rows = input(12);
  readonly columns = input(6);
  readonly header = input(true);
  /** Grow to the parent's height (extra rows are clipped, the box never grows past its card). */
  readonly fill = input(false);
  readonly label = input('');
  protected readonly rowList = computed(() => range(this.rows()));
  protected readonly colList = computed(() => range(Math.max(1, this.columns()), 12));
  protected readonly cols = computed(() => {
    const n = this.colList().length;
    return n > 1 ? `minmax(0, 1.6fr) repeat(${n - 1}, minmax(0, 1fr))` : 'minmax(0, 1fr)';
  });
  protected cell(r: number, c: number): string { return c === 0 ? W[r % W.length] : S[(r + c) % S.length]; }
}

// ── Setting rows ───────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skel-setting-rows',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-skel-setting-rows', ...REGION },
  template: `
    @if (label()) { <span class="pf-skf-sr">{{ label() }}</span> }
    <div aria-hidden="true">
      @for (i of items(); track i) {
        <div class="pf-skf-srow pf-skf-rise" data-skel="setting-row" [style.--i]="i">
          <div class="pf-skf-srow__t">
            <pf-skeleton variant="line" [width]="w(i)" height="12px"></pf-skeleton>
            <pf-skeleton variant="line" [width]="s(i)" height="10px"></pf-skeleton>
          </div>
          <pf-skeleton class="pf-skf-srow__c" [variant]="i % 3 === 1 ? 'block' : 'pill'" [width]="i % 3 === 1 ? '180px' : '44px'" [height]="i % 3 === 1 ? '36px' : '24px'"></pf-skeleton>
        </div>
      }
    </div>
  `,
  styles: [SR, RISE, `
    :host { display: block; min-width: 0; }
    /* .pf-srow: min-height 56px, 10px 0, a hairline under each row. */
    .pf-skf-srow { display: flex; align-items: center; gap: 16px; min-height: 56px; padding: 10px 0; box-sizing: border-box;
      border-bottom: 1px solid var(--pf-line, var(--glass-border)); }
    .pf-skf-srow:last-child { border-bottom: 0; }
    .pf-skf-srow__t { flex: 1 1 300px; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
    .pf-skf-srow__c { flex: none; margin-left: auto; max-width: 40%; }
  `],
})
export class SkelSettingRowsComponent {
  readonly rows = input(6);
  readonly label = input('');
  protected readonly items = computed(() => range(this.rows()));
  protected w(i: number): string { return ['34%', '42%', '28%', '38%', '46%', '31%'][i % 6]; }
  protected s(i: number): string { return ['58%', '64%', '49%', '61%', '53%', '67%'][i % 6]; }
}

// ── Settings tiles ─────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skel-tiles',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-skel-tiles', ...REGION },
  template: `
    @if (label()) { <span class="pf-skf-sr">{{ label() }}</span> }
    <div class="pf-skf-tiles" aria-hidden="true" [style.--min]="min()">
      @for (i of items(); track i) {
        <div class="pf-skf-tile pf-skf-rise" data-skel="tile" [style.--i]="i">
          <pf-skeleton variant="block" width="32px" height="32px" class="pf-skf-tile__ic"></pf-skeleton>
          <div class="pf-skf-tile__t">
            <pf-skeleton variant="line" [width]="w(i)" height="13px"></pf-skeleton>
            <pf-skeleton variant="line" width="86%" height="10px"></pf-skeleton>
            <pf-skeleton variant="line" width="58%" height="10px"></pf-skeleton>
          </div>
        </div>
      }
    </div>
  `,
  styles: [SR, RISE, `
    :host { display: block; min-width: 0; }
    /* .pf-ov__tiles / .pf-ov__tile */
    .pf-skf-tiles { display: grid; gap: 10px; align-content: start; grid-template-columns: repeat(auto-fill, minmax(var(--min, 250px), 1fr)); }
    .pf-skf-tile { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; border-radius: 12px; min-height: 82px; box-sizing: border-box;
      border: 1px solid var(--pf-line, var(--glass-border)); background: var(--pf-card-bg, transparent); }
    .pf-skf-tile__ic { border-radius: 9px; }
    .pf-skf-tile__t { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 7px; padding-top: 2px; }
    @media (max-width: 767px) { .pf-skf-tiles { grid-template-columns: 1fr; } }
  `],
})
export class SkelTilesComponent {
  readonly count = input(8);
  readonly min = input('250px');
  readonly label = input('');
  protected readonly items = computed(() => range(this.count(), 24));
  protected w(i: number): string { return ['46%', '58%', '40%', '52%', '62%', '44%'][i % 6]; }
}

// ── Document / preview ─────────────────────────────────────────────────────
@Component({
  selector: 'pf-skel-doc',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-skel-doc', ...REGION },
  template: `
    @if (label()) { <span class="pf-skf-sr">{{ label() }}</span> }
    <div class="pf-skf-sheet" data-skel="doc" aria-hidden="true">
      <div class="pf-skf-lh">
        <pf-skeleton variant="block" width="44px" height="44px"></pf-skeleton>
        <div class="pf-skf-lh__t">
          <pf-skeleton variant="line" width="46%" height="13px"></pf-skeleton>
          <pf-skeleton variant="line" width="64%" height="9px"></pf-skeleton>
        </div>
      </div>
      <div class="pf-skf-kv">
        @for (i of kv; track i) { <pf-skeleton variant="line" [width]="i % 2 ? '58%' : '72%'" height="9px"></pf-skeleton> }
      </div>
      <pf-skeleton variant="line" width="32%" height="12px" class="pf-skf-h"></pf-skeleton>
      @for (r of tableRows(); track r) {
        <div class="pf-skf-trow">
          <pf-skeleton variant="line" [width]="w(r)" height="9px"></pf-skeleton>
          <pf-skeleton variant="line" width="60%" height="9px"></pf-skeleton>
          <pf-skeleton variant="line" width="48%" height="9px"></pf-skeleton>
          <pf-skeleton variant="line" width="70%" height="9px"></pf-skeleton>
        </div>
      }
    </div>
  `,
  styles: [SR, `
    :host { display: flex; justify-content: center; min-width: 0; padding: 16px; box-sizing: border-box; }
    .pf-skf-sheet { width: 100%; max-width: 640px; aspect-ratio: 210 / 297; box-sizing: border-box; padding: 6% 7%;
      display: flex; flex-direction: column; gap: 14px; border-radius: 6px; overflow: hidden;
      background: var(--pf-card-bg, #fff); border: 1px solid var(--pf-line, var(--glass-border)); box-shadow: var(--pf-shadow-sm, none); }
    .pf-skf-lh { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--pf-line, var(--glass-border)); }
    .pf-skf-lh__t { flex: 1 1 auto; display: flex; flex-direction: column; gap: 8px; }
    .pf-skf-kv { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px 18px; }
    .pf-skf-h { margin-top: 6px; }
    .pf-skf-trow { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1.2fr; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--pf-line, var(--glass-border)); }
  `],
})
export class SkelDocComponent {
  readonly rows = input(9);
  readonly label = input('');
  protected readonly kv = [0, 1, 2, 3, 4, 5];
  protected readonly tableRows = computed(() => range(this.rows(), 30));
  protected w(i: number): string { return W[i % W.length]; }
}

/** What the main card of a two-panel skeleton holds. */
export type SkelMain = 'grid' | 'rows' | 'tiles' | 'doc' | 'designer' | 'form' | 'list' | 'detail' | 'queue';

// ── Two-panel frame ────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skel-two-panel',
  standalone: true,
  imports: [SkeletonComponent, SkeletonDetailComponent, SkeletonRowsComponent, SkelSideListComponent, SkelCardHeadComponent, SkelGridComponent, SkelSettingRowsComponent, SkelTilesComponent, SkelDocComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pf-skel-two-panel',
    '[class.pf-skp--noside]': '!side()',
    '[class.pf-skp--narrow]': 'isNarrow()',
    '[class.pf-skp--phone-side]': "phone() === 'side'",
    '[class.pf-skp--phone-strip]': "phone() === 'strip'",
    '[attr.data-main]': 'main()',
    ...REGION,
  },
  template: `
    @if (label()) { <span class="pf-skf-sr">{{ label() }}</span> }
    @if (side()) {
      <aside class="pf-card pf-skp__side" data-skel="side" aria-hidden="true">
        <pf-skel-card-head [title]="sideTitle()" [pills]="sidePills()"></pf-skel-card-head>
        <div class="pf-card__body pf-skp__sidebody">
          <pf-skel-side-list [rows]="sideRows()" [headings]="sideHeadings()" [counts]="sideCounts()"></pf-skel-side-list>
        </div>
      </aside>
    }
    <section class="pf-card pf-skp__main" data-skel="main" aria-hidden="true">
      @if (head()) {
        <pf-skel-card-head [title]="mainTitle()" [note]="note()" [search]="search()" [pills]="pills()"></pf-skel-card-head>
      }
      <div class="pf-skp__body" [class.pf-skp__body--pad]="main() !== 'grid' && main() !== 'list' && main() !== 'queue' && main() !== 'designer'">
        @switch (main()) {
          @case ('grid') { <pf-skel-grid [rows]="rows()" [columns]="cols()" [fill]="true"></pf-skel-grid> }
          @case ('rows') { <pf-skel-setting-rows [rows]="rows()"></pf-skel-setting-rows> }
          @case ('tiles') { <pf-skel-tiles [count]="rows()"></pf-skel-tiles> }
          @case ('doc') { <pf-skel-doc></pf-skel-doc> }
          @case ('designer') {
            <!-- Report design: the section's settings column (380px) beside the live page. -->
            <div class="pf-skp__designer">
              <div class="pf-skp__designer-col"><pf-skel-setting-rows [rows]="9"></pf-skel-setting-rows></div>
              <pf-skel-doc class="pf-skp__designer-doc"></pf-skel-doc>
            </div>
          }
          @case ('form') {
            <div class="pf-skp__form">
              @for (i of formList(); track i) {
                <div class="pf-skp__fld"><pf-skeleton variant="line" height="9px" [width]="i % 2 ? '34%' : '26%'"></pf-skeleton><pf-skeleton variant="block" height="44px"></pf-skeleton></div>
              }
            </div>
          }
          @case ('detail') { <pf-skeleton-detail [fields]="6" [sections]="2" label=""></pf-skeleton-detail> }
          @case ('queue') { <pf-skeleton-rows [rows]="rows()" label=""></pf-skeleton-rows> }
          @default { <pf-skel-side-list [rows]="rows()" [counts]="false"></pf-skel-side-list> }
        }
      </div>
    </section>
  `,
  styles: [SR, `
    /* pf-two-panel / Test Master's .pf-2p: side card 340px (--pf-side-w) + main card, 16px apart, the SAME height,
       filling the band body (flex child of .pf-band-body--fill); only the bodies would scroll. */
    :host { display: grid; grid-template-columns: var(--pf-side-w, 340px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
      gap: 16px; align-items: stretch; flex: 1 1 auto; min-height: 0; min-width: 0; }
    :host(.pf-skp--noside) { grid-template-columns: minmax(0, 1fr); }
    .pf-skp__side, .pf-skp__main { min-width: 0; min-height: 0; overflow: hidden; }
    .pf-skp__sidebody { padding: 0; overflow: hidden; }
    .pf-skp__body { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
    .pf-skp__body--pad { padding: 14px; }
    :host([data-main='rows']) .pf-skp__body--pad { padding: 4px 24px 24px; }
    .pf-skp__designer { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 380px minmax(0, 1fr); }
    .pf-skp__designer-col { padding: 4px 14px; border-right: 1px solid var(--pf-line, var(--glass-border)); overflow: hidden; }
    .pf-skp__designer-doc { align-items: flex-start; overflow: hidden; }
    .pf-skp__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 18px; }
    .pf-skp__fld { display: flex; flex-direction: column; gap: 8px; }
    /* Phone (and a host that says it is narrow): ONE card — the main one, or the side list where the screen opens on it. */
    @media (max-width: 767px) {
      :host { grid-template-columns: minmax(0, 1fr); }
      :host(:not(.pf-skp--phone-side)) .pf-skp__side { display: none; }
      :host(.pf-skp--phone-side) .pf-skp__main { display: none; }
      .pf-skp__form { grid-template-columns: 1fr; }
      .pf-skp__designer { grid-template-columns: minmax(0, 1fr); }
      .pf-skp__designer-doc { display: none; }
      :host([data-main='rows']) .pf-skp__body--pad { padding: 4px 14px 16px; }
    }
    :host(.pf-skp--narrow) { grid-template-columns: minmax(0, 1fr); }
    /* Strip: the sections as a chip row (the side list laid out in one line — Report design's 36px chips, 6px card padding). */
    :host(.pf-skp--narrow.pf-skp--phone-strip) { grid-template-rows: auto minmax(0, 1fr); gap: 18px; }
    :host(.pf-skp--narrow.pf-skp--phone-strip) .pf-skp__side { display: flex !important; }
    :host(.pf-skp--narrow.pf-skp--phone-strip) .pf-skp__side > pf-skel-card-head { display: none; }
    :host(.pf-skp--narrow.pf-skp--phone-strip) .pf-skp__side ::ng-deep .pf-side-list { flex-direction: row; padding: 6px; overflow: hidden; }
    :host(.pf-skp--narrow.pf-skp--phone-strip) .pf-skp__side ::ng-deep .pf-side-item { width: auto; min-width: 128px; min-height: 36px; }
    @media (max-width: 767px) {
      :host(.pf-skp--phone-strip) { grid-template-rows: auto minmax(0, 1fr); gap: 18px; }
      :host(.pf-skp--phone-strip) .pf-skp__side { display: flex !important; }
      :host(.pf-skp--phone-strip) .pf-skp__side > pf-skel-card-head { display: none; }
      :host(.pf-skp--phone-strip) .pf-skp__side ::ng-deep .pf-side-list { flex-direction: row; padding: 6px; overflow: hidden; }
      :host(.pf-skp--phone-strip) .pf-skp__side ::ng-deep .pf-side-item { width: auto; min-width: 128px; min-height: 36px; }
    }
    :host(.pf-skp--narrow:not(.pf-skp--phone-side)) .pf-skp__side { display: none; }
    :host(.pf-skp--narrow.pf-skp--phone-side) .pf-skp__main { display: none; }
  `],
})
export class SkelTwoPanelComponent {
  readonly label = input('Loading…');
  /** Draw the side card (false = one full-width main card). */
  readonly side = input(true);
  readonly sideRows = input(8);
  readonly sideHeadings = input<number[]>([]);
  readonly sideCounts = input(true);
  readonly sideTitle = input('38%');
  readonly sidePills = input(0);
  readonly main = input<SkelMain>('grid');
  /** Main card head shapes. */
  readonly head = input(true);
  readonly mainTitle = input('22%');
  readonly note = input(false);
  readonly search = input(false);
  readonly pills = input(0);
  /** Grid rows / setting rows / tiles / list rows. */
  readonly rows = input(14);
  readonly cols = input(6);
  /** One column whatever the width (the host's own narrow breakpoint, e.g. Test Master's 900px). */
  readonly narrow = input(false);
  /** The host's own narrow breakpoint as a media query (Test Master / Report design: '(max-width: 900px)'). */
  readonly narrowAt = input<string | null>(null);
  /** Phone / narrow: which card shows. */
  /** 'strip' = the side card becomes a one-line row of chips above the main card (Report design's sections). */
  readonly phone = input<'main' | 'side' | 'strip'>('main');
  private readonly mq = signal(false);
  protected readonly isNarrow = computed(() => this.narrow() || this.mq());
  private readonly _mq = (() => {
    let off: (() => void) | null = null;
    inject(DestroyRef).onDestroy(() => off?.());
    effect(() => {
      off?.(); off = null;
      const q = this.narrowAt();
      if (!q || typeof window === 'undefined' || !window.matchMedia) { this.mq.set(false); return; }
      try {
        const m = window.matchMedia(q);
        this.mq.set(!!m.matches);
        const fn = (e: MediaQueryListEvent) => this.mq.set(e.matches);
        m.addEventListener?.('change', fn);
        off = () => m.removeEventListener?.('change', fn);
      } catch { this.mq.set(false); }
    });
    return true;
  })();
  protected readonly formList = computed(() => range(Math.min(12, this.rows())));
}

/** Every block, for one `imports:` entry. */
export const SKELETON_FRAME = [
  SkelTwoPanelComponent, SkelSideListComponent, SkelCardHeadComponent, SkelGridComponent,
  SkelSettingRowsComponent, SkelTilesComponent, SkelDocComponent,
] as const;
