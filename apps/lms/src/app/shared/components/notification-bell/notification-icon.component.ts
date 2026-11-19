import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NOTIF_ICON_PATHS, NotifIcon, NotifTone } from './notification-kinds';

/**
 * A kind's icon tile: a rounded tile tinted by the kind's tone with a REAL stroked SVG inside (real <path> elements —
 * the old tile injected markup through innerHTML on an <svg>, which Angular renders as nothing, so the tiles were
 * empty). `label` is the tile's screen-reader name.
 */
@Component({
  selector: 'pf-notif-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-type-icon', '[attr.data-tone]': 'tone()', '[attr.data-icon]': 'icon()', '[style.width.px]': 'tile()', '[style.height.px]': 'tile()' },
  template: `
    <svg [attr.width]="glyph()" [attr.height]="glyph()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      @for (d of paths(); track $index) { <path [attr.d]="d"/> }
    </svg>
    @if (label()) { <span class="pf-sr-only">{{ label() }}</span> }
  `,
  styles: [`
    :host {
      display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 10px; box-sizing: border-box;
      color: var(--pf-nt-tone); background: color-mix(in srgb, var(--pf-nt-tone) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--pf-nt-tone) 28%, transparent);
    }
    :host([data-tone='rose'])    { --pf-nt-tone: var(--red-text); }
    /* "amber" is the late / warning tone — a dusty rose (never yellow). */
    :host([data-tone='amber'])   { --pf-nt-tone: color-mix(in srgb, var(--red-text) 62%, var(--pf-card-bg, var(--bg-card-solid))); }
    :host([data-tone='emerald']) { --pf-nt-tone: var(--green-text); }
    :host([data-tone='violet'])  { --pf-nt-tone: var(--violet-text); }
    :host([data-tone='sky'])     { --pf-nt-tone: var(--sky-text); }
    .pf-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    :host { position: relative; }
  `],
})
export class NotificationIconComponent {
  readonly icon = input.required<NotifIcon>();
  readonly tone = input<NotifTone>('violet');
  readonly label = input<string>('');
  readonly tile = input<number>(36);
  readonly glyph = computed(() => Math.round(this.tile() * 0.47));
  readonly paths = computed(() => NOTIF_ICON_PATHS[this.icon()] ?? NOTIF_ICON_PATHS.bell);
}
