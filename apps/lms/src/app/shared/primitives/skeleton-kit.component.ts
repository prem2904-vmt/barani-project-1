import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SkeletonComponent } from './skeleton.component';

/**
 * SKELETON KIT — the only loading look in the app (owner, 2026-09-27: "I
 * don't want the PF loading anywhere, just an animation and skeleton
 * loading in that part").
 *
 * Each preset draws the SHAPE of the area that is loading, so content lands
 * where the placeholder was instead of popping in:
 *
 *   <pf-skeleton-rows>    list / queue rows (avatar · two lines · pill)
 *   <pf-skeleton-table>   a grid / table (header + rows × cols)
 *   <pf-skeleton-card>    a card (title + lines)
 *   <pf-skeleton-detail>  a detail pane (identity header, fields, a card)
 *   <pf-skeleton-form>    a form (label + field pairs)
 *   <pf-skeleton-tiles>   tiles / slots in an adaptive grid
 *   <pf-busy>             inline "working" dots for a button or a chip
 *
 * Accessibility: every preset is the loading REGION — role=status,
 * aria-busy=true, aria-live=polite and a visually hidden label ("Loading
 * vendors…"), so a screen reader hears one calm announcement while the
 * shapes themselves stay aria-hidden. Reduced motion: no shimmer, no rise.
 * The logo (pf-loading-logo) is branding for the sign-in screen only.
 */

const WIDTHS = ['62%', '48%', '71%', '55%', '66%', '44%', '58%', '69%'];
const SUBS = ['38%', '52%', '31%', '45%', '36%', '49%', '41%', '33%'];

/** Shared host behaviour: the preset is the loading region. */
const REGION_HOST = {
  role: 'status',
  'aria-busy': 'true',
  'aria-live': 'polite',
  class: 'pf-skel-region',
};

const REGION_CSS = `
  :host { display: block; width: 100%; min-width: 0; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  .pf-skel-rise { animation: pf-skel-rise 320ms cubic-bezier(0.32, 0.72, 0, 1) both; animation-delay: calc(var(--i, 0) * 18ms); }
  @keyframes pf-skel-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .pf-skel-rise { animation: none; } }
`;

function range(n: number): number[] {
  const c = Math.max(0, Math.min(40, Math.floor(n || 0)));
  return Array.from({ length: c }, (_, i) => i);
}

// ── Rows ───────────────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skeleton-rows',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: REGION_HOST,
  template: `
    <span class="sr-only">{{ label() }}</span>
    <ul class="rows" [class.rows--dense]="dense()" aria-hidden="true">
      @for (i of items(); track i) {
        <li class="row pf-skel-rise" [style.--i]="i">
          @if (avatar()) { <pf-skeleton variant="circle" [width]="dense() ? '28px' : '36px'"></pf-skeleton> }
          <div class="txt">
            <pf-skeleton variant="line" [width]="w(i)"></pf-skeleton>
            @if (!dense()) { <pf-skeleton variant="line" height="9px" [width]="s(i)"></pf-skeleton> }
          </div>
          @if (trailing()) { <pf-skeleton variant="pill" width="84px" [height]="dense() ? '22px' : '28px'"></pf-skeleton> }
        </li>
      }
    </ul>
  `,
  styles: [REGION_CSS + `
    .rows { list-style: none; margin: 0; padding: 0; }
    .row {
      display: flex; align-items: center; gap: 12px;
      min-height: 60px; padding: 10px 14px;
      border-bottom: 1px solid var(--glass-border, rgba(127, 127, 127, 0.14));
    }
    .row:last-child { border-bottom: 0; }
    .rows--dense .row { min-height: 44px; padding: 6px 12px; }
    .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  `],
})
export class SkeletonRowsComponent {
  readonly rows = input(5);
  readonly avatar = input(true);
  readonly trailing = input(true);
  readonly dense = input(false);
  readonly label = input('Loading…');
  protected readonly items = computed(() => range(this.rows()));
  protected w(i: number) { return WIDTHS[i % WIDTHS.length]; }
  protected s(i: number) { return SUBS[i % SUBS.length]; }
}

// ── Table ──────────────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skeleton-table',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: REGION_HOST,
  template: `
    <span class="sr-only">{{ label() }}</span>
    <div class="tbl" aria-hidden="true">
      @if (header()) {
        <div class="tr th" [style.grid-template-columns]="gridCols()">
          @for (c of colList(); track c) { <pf-skeleton variant="line" height="9px" [width]="c === 0 ? '46%' : '38%'"></pf-skeleton> }
        </div>
      }
      @for (r of rowList(); track r) {
        <div class="tr pf-skel-rise" [style.--i]="r" [style.grid-template-columns]="gridCols()">
          @for (c of colList(); track c) {
            <pf-skeleton variant="line" [width]="cell(r, c)"></pf-skeleton>
          }
        </div>
      }
    </div>
  `,
  styles: [REGION_CSS + `
    .tbl { display: flex; flex-direction: column; }
    .tr {
      display: grid;
      align-items: center; gap: 16px; min-height: 44px; padding: 0 14px;
      border-bottom: 1px solid var(--glass-border, rgba(127, 127, 127, 0.14));
    }
    .th { min-height: 36px; }
    .tr:last-child { border-bottom: 0; }
  `],
})
export class SkeletonTableComponent {
  readonly rows = input(6);
  readonly cols = input(4);
  readonly header = input(true);
  readonly label = input('Loading…');
  protected readonly rowList = computed(() => range(this.rows()));
  protected readonly colList = computed(() => range(Math.max(1, this.cols())));
  protected readonly gridCols = computed(() => {
    const n = this.colList().length;
    return n > 1 ? `minmax(0, 1.6fr) repeat(${n - 1}, minmax(0, 1fr))` : 'minmax(0, 1fr)';
  });
  protected cell(r: number, c: number) { return c === 0 ? WIDTHS[r % WIDTHS.length] : SUBS[(r + c) % SUBS.length]; }
}

// ── Card ───────────────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skeleton-card',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: REGION_HOST,
  template: `
    <span class="sr-only">{{ label() }}</span>
    <div class="card pf-skel-rise" [class.card--flat]="!boxed()" aria-hidden="true">
      @if (title()) {
        <div class="head">
          <pf-skeleton variant="block" width="32px" height="32px"></pf-skeleton>
          <pf-skeleton variant="line" width="38%" height="14px"></pf-skeleton>
        </div>
      }
      @for (i of lineList(); track i) {
        <pf-skeleton variant="line" [width]="i === lineList().length - 1 ? '46%' : w(i)"></pf-skeleton>
      }
    </div>
  `,
  styles: [REGION_CSS + `
    .card {
      display: flex; flex-direction: column; gap: 12px; padding: 18px;
      border-radius: 16px; border: 1px solid var(--glass-border, rgba(127, 127, 127, 0.14));
      background: var(--glass-bg, transparent);
    }
    .card--flat { border: 0; background: none; padding: 4px 0; }
    .head { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
  `],
})
export class SkeletonCardComponent {
  readonly lines = input(3);
  readonly title = input(true);
  readonly boxed = input(true);
  readonly label = input('Loading…');
  protected readonly lineList = computed(() => range(this.lines()));
  protected w(i: number) { return ['92%', '84%', '76%', '88%'][i % 4]; }
}

// ── Detail pane ────────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skeleton-detail',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: REGION_HOST,
  template: `
    <span class="sr-only">{{ label() }}</span>
    <div class="det" aria-hidden="true">
      <div class="id pf-skel-rise">
        <pf-skeleton variant="circle" width="52px"></pf-skeleton>
        <div class="id__txt">
          <pf-skeleton variant="line" width="44%" height="16px"></pf-skeleton>
          <pf-skeleton variant="line" width="30%" height="10px"></pf-skeleton>
        </div>
        <pf-skeleton variant="pill" width="96px"></pf-skeleton>
      </div>
      <div class="kv">
        @for (i of fieldList(); track i) {
          <div class="kv__cell pf-skel-rise" [style.--i]="i + 1">
            <pf-skeleton variant="line" width="40%" height="9px"></pf-skeleton>
            <pf-skeleton variant="line" [width]="w(i)"></pf-skeleton>
          </div>
        }
      </div>
      @if (sections() > 0) {
        @for (s of sectionList(); track s) {
          <div class="sec pf-skel-rise" [style.--i]="fieldList().length + s + 1">
            <pf-skeleton variant="line" width="28%" height="13px"></pf-skeleton>
            <pf-skeleton variant="line" width="92%"></pf-skeleton>
            <pf-skeleton variant="line" width="78%"></pf-skeleton>
          </div>
        }
      }
    </div>
  `,
  styles: [REGION_CSS + `
    .det { display: flex; flex-direction: column; gap: 18px; }
    .id { display: flex; align-items: center; gap: 14px; }
    .id__txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .kv { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px 18px; }
    .kv__cell { display: flex; flex-direction: column; gap: 8px; }
    .sec {
      display: flex; flex-direction: column; gap: 10px; padding: 16px;
      border-radius: 14px; border: 1px solid var(--glass-border, rgba(127, 127, 127, 0.14));
    }
  `],
})
export class SkeletonDetailComponent {
  readonly fields = input(6);
  readonly sections = input(1);
  readonly label = input('Loading…');
  protected readonly fieldList = computed(() => range(this.fields()));
  protected readonly sectionList = computed(() => range(this.sections()));
  protected w(i: number) { return WIDTHS[i % WIDTHS.length]; }
}

// ── Form ───────────────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skeleton-form',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: REGION_HOST,
  template: `
    <span class="sr-only">{{ label() }}</span>
    <div class="form" aria-hidden="true" [style.--cols]="cols()">
      @for (i of fieldList(); track i) {
        <div class="fld pf-skel-rise" [style.--i]="i">
          <pf-skeleton variant="line" height="9px" [width]="i % 2 ? '34%' : '26%'"></pf-skeleton>
          <pf-skeleton variant="block" height="40px"></pf-skeleton>
        </div>
      }
    </div>
  `,
  styles: [REGION_CSS + `
    .form { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 16px 18px; }
    @media (max-width: 640px) { .form { grid-template-columns: 1fr; } }
    .fld { display: flex; flex-direction: column; gap: 8px; }
  `],
})
export class SkeletonFormComponent {
  readonly fields = input(6);
  readonly cols = input(2);
  readonly label = input('Loading…');
  protected readonly fieldList = computed(() => range(this.fields()));
}

// ── Tiles ──────────────────────────────────────────────────────────────────
@Component({
  selector: 'pf-skeleton-tiles',
  standalone: true,
  imports: [SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: REGION_HOST,
  template: `
    <span class="sr-only">{{ label() }}</span>
    <div class="tiles" aria-hidden="true" [style.--min]="min()">
      @for (i of tileList(); track i) {
        <div class="tile pf-skel-rise" [style.--i]="i" [style.min-height]="height()">
          <pf-skeleton variant="line" [width]="w(i)" height="13px"></pf-skeleton>
          <pf-skeleton variant="line" width="52%" height="9px"></pf-skeleton>
          @if (lines() > 2) { <pf-skeleton variant="line" width="36%" height="9px"></pf-skeleton> }
        </div>
      }
    </div>
  `,
  styles: [REGION_CSS + `
    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--min, 220px), 1fr)); gap: 12px; }
    .tile {
      display: flex; flex-direction: column; gap: 10px; padding: 14px 16px;
      border-radius: 14px; border: 1px solid var(--glass-border, rgba(127, 127, 127, 0.14));
      background: var(--glass-bg, transparent);
    }
  `],
})
export class SkeletonTilesComponent {
  readonly count = input(6);
  readonly min = input('220px');
  readonly height = input('88px');
  readonly lines = input(3);
  readonly label = input('Loading…');
  protected readonly tileList = computed(() => range(this.count()));
  protected w(i: number) { return WIDTHS[i % WIDTHS.length]; }
}

// ── Inline busy (buttons, chips, search fields) ────────────────────────────
@Component({
  selector: 'pf-busy',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-busy', role: 'status', 'aria-live': 'polite' },
  template: `
    <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
    @if (label()) { <span class="sr-only">{{ label() }}</span> }
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; vertical-align: middle; color: currentColor; }
    .dots { display: inline-flex; gap: 3px; align-items: center; height: 1em; }
    .dots i {
      width: 5px; height: 5px; border-radius: 999px; background: currentColor; opacity: 0.35;
      animation: pf-busy 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    .dots i:nth-child(2) { animation-delay: 0.15s; }
    .dots i:nth-child(3) { animation-delay: 0.3s; }
    @keyframes pf-busy { 0%, 100% { opacity: 0.3; transform: none; } 40% { opacity: 1; transform: translateY(-2px); } }
    @media (prefers-reduced-motion: reduce) { .dots i { animation: none; opacity: 0.7; } }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
  `],
})
export class BusyComponent {
  readonly label = input('');
}

/** Everything a loading state needs, for one `imports:` entry. */
export const SKELETON_KIT = [
  SkeletonComponent,
  SkeletonRowsComponent,
  SkeletonTableComponent,
  SkeletonCardComponent,
  SkeletonDetailComponent,
  SkeletonFormComponent,
  SkeletonTilesComponent,
  BusyComponent,
] as const;
