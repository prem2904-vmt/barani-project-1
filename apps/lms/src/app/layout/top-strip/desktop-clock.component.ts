import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { formatClock, localeUses12h, startMinuteTicker } from '../../core/services/desktop-clock';

/**
 * Date + time on the top strip while the desktop app is full screen (the
 * OS clock is hidden then) — "Wed, 30 Sep · 4:32 PM". Rendered by the top
 * strip only when DesktopWindowService.showClock() (Electron + full screen),
 * so web and the iPad app never create it. Ticks on the minute, never per
 * second; IST (the lab's clock); 12 / 24 h per locale. Narrow bars drop the
 * date and keep the time (the full text stays in the accessible name).
 */
@Component({
  selector: 'pf-desktop-clock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <time class="pf-dclock" [attr.datetime]="face().iso" aria-live="off"
          [attr.aria-label]="face().label" [attr.title]="face().label">
      <span class="pf-dclock__date">{{ face().date }}</span>
      <span class="pf-dclock__sep" aria-hidden="true">·</span>
      <span class="pf-dclock__time">{{ face().time }}</span>
    </time>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; flex-shrink: 0; }
    .pf-dclock {
      display: inline-flex; align-items: baseline; gap: 6px;
      padding: 0 4px;
      font-size: 13px; line-height: 1; font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--text-secondary);
      white-space: nowrap;
      cursor: default; user-select: none;
    }
    .pf-dclock__time { color: var(--text-primary); font-weight: 600; }
    .pf-dclock__sep { color: var(--text-muted); }
    /* Compact: time only on a narrow bar. */
    @media (max-width: 1099.98px) {
      .pf-dclock__date, .pf-dclock__sep { display: none; }
    }
  `],
})
export class DesktopClockComponent {
  private readonly hour12 = localeUses12h(typeof navigator !== 'undefined' ? navigator.languages : undefined);
  readonly face = signal(formatClock(new Date(), this.hour12));

  constructor() {
    const stop = startMinuteTicker(now => this.face.set(formatClock(now, this.hour12)));
    inject(DestroyRef).onDestroy(stop);
  }
}
