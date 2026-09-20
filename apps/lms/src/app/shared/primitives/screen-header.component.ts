import { ChangeDetectionStrategy, Component, Input, inject } from "@angular/core";
import { Router } from "@angular/router";
import { NavBackService } from "../../core/services/nav-back.service";

@Component({
  selector: "pf-screen-header",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* Phone-only leading back chevron. Hidden at md+ (md:hidden in the
       template) so the desktop/iPad header is byte-for-byte unchanged. A bare
       chevron with a generous tap target, pulled toward the screen edge like
       the native iOS back affordance. */
    .pf-hdr-back {
      width: 38px;
      height: 38px;
      margin-left: -8px;
      border-radius: 11px;
      color: var(--text-primary);
      background: transparent;
      border: 0;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: background .15s ease, transform .08s ease;
    }
    .pf-hdr-back:active {
      transform: scale(0.9);
      background: var(--glass-bg, rgba(255, 255, 255, 0.06));
    }
    @media (hover: hover) {
      .pf-hdr-back:hover { background: var(--glass-bg, rgba(255, 255, 255, 0.06)); }
    }
  `],
  template: `
    <!-- Title and actions share one row on every width. The title sits in its
         own flex-1/min-w-0 track so a compact (icon-only) actions cluster can
         never squeeze it down to a 1-char-per-line vertical column, while the
         actions stay pinned right and shrink-0 (wrapping within their own
         column if there are many). This restores the inline layout on phone —
         the icons sit beside the title, not on a new line below it. -->
    <header class="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 md:gap-4 mb-2 md:mb-3">
      @if ((parentRoute || navBack.showBack()) && !noBack) {
        <button
          type="button"
          class="pf-hdr-back shrink-0 inline-flex items-center justify-center"
          (click)="onBack()"
          aria-label="Go back"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      }
      <div class="min-w-fit max-w-full flex-1">
        <!--
        @if (eyebrow) {
          <p
            class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1.5"
            style="color: var(--text-muted);"
          >
            {{ eyebrow }}
          </p>
        }
        -->
        <h1
          class="text-[20px] md:text-[32px] leading-[1.05] font-semibold tracking-tight break-normal"
          style="color: var(--text-primary);"
        >
          <ng-content></ng-content>
          @if (!hasProjectedTitle && title) {
            {{ title }}
          }
        </h1>
        <!--
        @if (subtitle) {
          <p
            class="mt-1.5 md:mt-2 text-[14px] md:text-[15px] max-w-[720px]"
            style="color: var(--text-secondary);"
          >
            {{ subtitle }}
          </p>
        }
        -->
      </div>
      <div class="flex-1 sm:flex-initial flex items-center gap-2 flex-wrap justify-start sm:justify-end max-w-full">
        <ng-content select="[actions]"></ng-content>
      </div>
    </header>
  `,
})
export class ScreenHeaderComponent {
  protected readonly navBack = inject(NavBackService);
  private readonly router = inject(Router);

  @Input() eyebrow: string | null = null;
  @Input() title: string | null = null;
  @Input() subtitle: string | null = null;
  @Input() parentRoute: string | null = null;

  /** Force-hide the back chevron even on a secondary route (rare — for a
   *  screen that is logically a root but doesn't sit on the primary nav). */
  @Input() noBack = false;

  protected onBack(): void {
    if (this.parentRoute) {
      // Pop-or-replace via the shared service so browser-back from the
      // parent never bounces back down to this screen.
      this.navBack.backTo(this.parentRoute);
    } else {
      this.navBack.back();
    }
  }

  /**
   * The default slot takes priority — consumers can project rich HTML for the title
   * (gradient highlight, italics, etc.).  If the default slot is empty, the `title`
   * @Input acts as fallback text.
   */
  get hasProjectedTitle(): boolean {
    // We cannot reliably check projection from template without ContentChild,
    // so we render the fallback only when title is set AND trust callers to
    // use either the slot or the input, not both.
    return false;
  }
}
