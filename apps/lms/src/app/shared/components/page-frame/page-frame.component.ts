import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ThemeService } from '../../../core/services/theme.service';
import { PageSkeleton } from '../../../core/navigation/page-skeleton';
import { HeroBandComponent } from '../hero-band/hero-band.component';
import { SkeletonComponent } from '../../primitives/skeleton.component';
import { SkeletonRowsComponent, SkeletonTilesComponent } from '../../primitives/skeleton-kit.component';
import { SkelTwoPanelComponent } from '../skeleton-frame/skeleton-frame.component';

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
    HeroBandComponent, SkeletonComponent, SkeletonRowsComponent, SkeletonTilesComponent, SkelTwoPanelComponent,
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
      <!-- The NEW frame (owner 2026-11-19): the shared skeleton-frame blocks in each screen's real geometry —
           side card LEFT at --pf-side-w, main card with its pf-card__head, both the band body's height. -->
      <div class="pf-band-body pf-band-body--fill pf-pgf__body">
        @switch (kind()) {
          @case ('grid') {
            <pf-skel-two-panel [side]="false" main="grid" [rows]="16" [cols]="6" [search]="false" [pills]="1" label=""></pf-skel-two-panel>
          }
          @case ('grid-side') {
            <pf-skel-two-panel main="grid" [sideRows]="9" [rows]="16" [cols]="6" [pills]="1" label=""></pf-skel-two-panel>
          }
          @case ('settings') {
            <pf-skel-two-panel main="rows" [sideRows]="6" [sideCounts]="false" [rows]="7" label=""></pf-skel-two-panel>
          }
          @case ('settings-tiles') {
            <pf-skel-two-panel main="tiles" [sideRows]="9" [sideHeadings]="[0, 3]" [rows]="10" [note]="true" phone="side" label=""></pf-skel-two-panel>
          }
          @case ('doc') {
            <pf-skel-two-panel main="designer" [sideRows]="7" [sideCounts]="false" [note]="true" [pills]="2" label=""></pf-skel-two-panel>
          }
          @case ('tiles') {
            <pf-skeleton-tiles [count]="8" min="220px" height="96px" label=""></pf-skeleton-tiles>
          }
          @case ('detail') {
            <pf-skel-two-panel main="detail" [sideRows]="6" [sideCounts]="false" label=""></pf-skel-two-panel>
          }
          @case ('form') {
            <pf-skel-two-panel main="form" [sideRows]="6" [sideCounts]="false" [rows]="8" label=""></pf-skel-two-panel>
          }
          @case ('chat') {
            <pf-skel-two-panel main="queue" [sideRows]="9" [sideCounts]="false" [rows]="6" phone="side" label=""></pf-skel-two-panel>
          }
          @case ('dashboard') {
            <pf-skeleton-tiles [count]="4" min="180px" height="84px" [lines]="2" label=""></pf-skeleton-tiles>
            <div class="pf-pgf__card pf-pgf__gap"><pf-skeleton-rows [rows]="6" label=""></pf-skeleton-rows></div>
          }
          @default {
            <pf-skel-two-panel [side]="false" main="queue" [rows]="8" label=""></pf-skel-two-panel>
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
    /* The body fills the band page (no page scroll); the two-panel blocks fill it. */
    .pf-pgf__body { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
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
