import { ChangeDetectionStrategy, Component, Input } from "@angular/core";

@Component({
  selector: "pf-screen-header",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Phone: stack the title above the actions (flex-col) so a wide actions
         cluster can't squeeze the title down to a 1-char-per-line vertical
         column. md:+ keeps the original side-by-side row. -->
    <header class="flex flex-col md:flex-row md:items-start md:justify-between gap-2 md:gap-4 mb-2 md:mb-3">
      <div class="min-w-0 flex-1">
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
          class="text-[20px] md:text-[32px] leading-[1.05] font-semibold tracking-tight break-words"
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
      <div class="shrink-0 flex items-center gap-2 flex-wrap justify-end max-w-full overflow-x-auto">
        <ng-content select="[actions]"></ng-content>
      </div>
    </header>
  `,
})
export class ScreenHeaderComponent {
  @Input() eyebrow: string | null = null;
  @Input() title: string | null = null;
  @Input() subtitle: string | null = null;

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
