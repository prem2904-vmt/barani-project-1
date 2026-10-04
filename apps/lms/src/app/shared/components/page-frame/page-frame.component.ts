import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ThemeService } from '../../../core/services/theme.service';
import { PageSkeleton } from '../../../core/navigation/page-skeleton';
import { HeroBandComponent } from '../hero-band/hero-band.component';
import { SkeletonComponent } from '../../primitives/skeleton.component';
import {
  SkeletonCardComponent, SkeletonDetailComponent, SkeletonFormComponent, SkeletonRowsComponent,
  SkeletonTableComponent, SkeletonTilesComponent,
} from '../../primitives/skeleton-kit.component';

/**
 * `<pf-page-frame>` — the DESTINATION's frame while a navigation is on its
 * way (PageOpenService): the screen's band + a skeleton of its body in that
 * screen's layout (core/navigation/page-skeleton.ts), easing in over the
 * screen you are leaving. Mounted by the shell inside <main>; nothing per
 * screen. The shapes are the skeleton kit's, so when the real screen lands
 * (with its own first-load skeleton) the view transition cross-fades like
 * for like.
 *
 * Accessibility: ONE polite status ("Opening Test Master…"); the shapes are
 * aria-hidden. Reduced motion: it simply appears.
 */
@Component({
  selector: 'pf-page-frame',
  standalone: true,
  imports: [
    HeroBandComponent, SkeletonComponent, SkeletonRowsComponent, SkeletonTableComponent, SkeletonTilesComponent,
    SkeletonDetailComponent, SkeletonFormComponent, SkeletonCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pf-page-frame',
    '[attr.data-kind]': 'kind()',
    'aria-busy': 'true',
  },
  template: `
    <span class="pf-pgf__sr" role="status" aria-live="polite">{{ skeleton().label }}</span>
    <section class="pf-band-page pf-pgf" aria-hidden="true" inert>
      @if (theme.isNewDesign()) {
        <pf-hero-band [tabsOnly]="true">
          <div band-tools class="pf-pgf__pill">
            <pf-skeleton variant="line" width="38%" height="12px"></pf-skeleton>
          </div>
        </pf-hero-band>
      } @else {
        <div class="pf-pgf__head">
          <pf-skeleton variant="line" width="72px" height="9px"></pf-skeleton>
          <pf-skeleton variant="line" width="220px" height="20px"></pf-skeleton>
          <pf-skeleton variant="line" width="320px" height="10px"></pf-skeleton>
        </div>
      }
      <div class="pf-band-body pf-pgf__body">
        @switch (kind()) {
          @case ('grid') {
            <div class="pf-pgf__card"><pf-skeleton-table [rows]="10" [cols]="6" label=""></pf-skeleton-table></div>
          }
          @case ('grid-side') {
            <div class="pf-pgf__split pf-pgf__split--lead">
              <div class="pf-pgf__side pf-pgf__card"><pf-skeleton-rows [rows]="7" [avatar]="false" [dense]="true" [trailing]="false" label=""></pf-skeleton-rows></div>
              <div class="pf-pgf__card"><pf-skeleton-table [rows]="10" [cols]="6" label=""></pf-skeleton-table></div>
            </div>
          }
          @case ('tiles') {
            <pf-skeleton-tiles [count]="8" min="220px" height="96px" label=""></pf-skeleton-tiles>
          }
          @case ('detail') {
            <div class="pf-pgf__split">
              <div class="pf-pgf__card pf-pgf__pad"><pf-skeleton-detail [fields]="6" [sections]="2" label=""></pf-skeleton-detail></div>
              <div class="pf-pgf__side"><pf-skeleton-card [lines]="4" label=""></pf-skeleton-card></div>
            </div>
          }
          @case ('form') {
            <div class="pf-pgf__split">
              <div class="pf-pgf__card pf-pgf__pad"><pf-skeleton-form [fields]="8" label=""></pf-skeleton-form></div>
              <div class="pf-pgf__side"><pf-skeleton-card [lines]="5" label=""></pf-skeleton-card></div>
            </div>
          }
          @case ('chat') {
            <div class="pf-pgf__split pf-pgf__split--chat">
              <div class="pf-pgf__card"><pf-skeleton-rows [rows]="8" [trailing]="false" label=""></pf-skeleton-rows></div>
              <div class="pf-pgf__side pf-pgf__card pf-pgf__pad"><pf-skeleton-card [lines]="6" [boxed]="false" label=""></pf-skeleton-card></div>
            </div>
          }
          @case ('dashboard') {
            <pf-skeleton-tiles [count]="4" min="180px" height="84px" [lines]="2" label=""></pf-skeleton-tiles>
            <div class="pf-pgf__card pf-pgf__gap"><pf-skeleton-rows [rows]="6" label=""></pf-skeleton-rows></div>
          }
          @default {
            <div class="pf-pgf__card"><pf-skeleton-rows [rows]="8" label=""></pf-skeleton-rows></div>
          }
        }
      </div>
    </section>
  `,
  styles: [`
    /* Over the screen being left (which the shell eases out underneath). */
    :host {
      position: absolute; left: 0; right: 0;
      top: var(--pf-po-top, 0px); height: var(--pf-po-h, 100%);
      z-index: 29;
      display: block; overflow: hidden;
      animation: pf-pgf-in 240ms cubic-bezier(0.32, 0.72, 0, 1) both;
    }
    @keyframes pf-pgf-in { from { opacity: 0; transform: translateY(10px) scale(0.992); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { :host { animation: none; } }

    /* Classic design has no band page: give the frame the same gutter the
       classic screens use. */
    .pf-pgf { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 24px 16px 24px; }
    @media (min-width: 768px) { .pf-pgf { padding-inline: 32px; } }
    @media (min-width: 1024px) { .pf-pgf { padding-inline: 40px; } }
    .pf-pgf__head { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
    .pf-pgf__body { overflow: hidden !important; }
    .pf-pgf__pill { display: flex; align-items: center; flex: 1 1 auto; min-width: 0; padding-left: 8px; }

    .pf-pgf__card {
      border-radius: 18px; border: 1px solid var(--glass-border, rgba(127, 127, 127, 0.14));
      background: var(--glass-bg, transparent); overflow: hidden; min-width: 0;
    }
    .pf-pgf__pad { padding: 18px; }
    .pf-pgf__gap { margin-top: 14px; }
    .pf-pgf__split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); gap: 16px; align-items: start; }
    .pf-pgf__split--chat { grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); }
    .pf-pgf__split--lead { grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); }
    /* Phones / narrow tablets: one column, the side card steps aside (the
       screens themselves stack it below the fold). */
    @media (max-width: 900px) {
      .pf-pgf__split, .pf-pgf__split--chat, .pf-pgf__split--lead { grid-template-columns: minmax(0, 1fr); }
      .pf-pgf__side { display: none; }
    }
    .pf-pgf__sr {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
  `],
})
export class PageFrameComponent {
  protected readonly theme = inject(ThemeService);
  readonly skeleton = input.required<PageSkeleton>();
  protected readonly kind = computed(() => this.skeleton().kind);
}
