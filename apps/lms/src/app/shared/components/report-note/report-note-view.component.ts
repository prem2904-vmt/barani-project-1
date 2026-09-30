import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { parseNote } from '../../utils/report-note-markup';

/**
 * A technician report note rendered read-only — bold / italic / underline
 * and lists — from the parsed markup through template text bindings only
 * (never innerHTML), so nothing the tech typed can become markup.
 */
@Component({
  selector: 'pf-report-note-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #runs let-line>
      @for (r of line; track $index) {
        <span class="pf-rnv__run" [class.pf-rnv__b]="r.b" [class.pf-rnv__i]="r.i" [class.pf-rnv__u]="r.u">{{ r.text }}</span>
      }
    </ng-template>
    @for (b of blocks(); track $index) {
      @switch (b.kind) {
        @case ('p') {
          <p class="pf-rnv__p">
            @for (l of $any(b).lines; track $index; let last = $last) {
              <ng-container *ngTemplateOutlet="runs; context: { $implicit: l }"></ng-container>@if (!last) {<br />}
            }
          </p>
        }
        @case ('ul') {
          <ul class="pf-rnv__list">
            @for (it of $any(b).items; track $index) {
              <li><ng-container *ngTemplateOutlet="runs; context: { $implicit: it }"></ng-container></li>
            }
          </ul>
        }
        @case ('ol') {
          <ol class="pf-rnv__list" [attr.start]="$any(b).start">
            @for (it of $any(b).items; track $index) {
              <li><ng-container *ngTemplateOutlet="runs; context: { $implicit: it }"></ng-container></li>
            }
          </ol>
        }
      }
    }
  `,
  imports: [NgTemplateOutlet],
  styles: [`
    :host { display: block; font-size: 13px; line-height: 1.5; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-rnv__p { margin: 0; }
    .pf-rnv__p + .pf-rnv__p, .pf-rnv__p + .pf-rnv__list, .pf-rnv__list + .pf-rnv__p { margin-top: 4px; }
    .pf-rnv__list { margin: 2px 0 0; padding-left: 20px; }
    ul.pf-rnv__list { list-style: disc outside; }
    ol.pf-rnv__list { list-style: decimal outside; }
    .pf-rnv__list li { display: list-item; }
    .pf-rnv__list li { margin: 1px 0; }
    .pf-rnv__b { font-weight: 700; }
    .pf-rnv__i { font-style: italic; }
    .pf-rnv__u { text-decoration: underline; text-underline-offset: 2px; }
  `],
})
export class ReportNoteViewComponent {
  readonly text = input<string | null | undefined>('');
  readonly blocks = computed(() => parseNote(this.text()));
}
