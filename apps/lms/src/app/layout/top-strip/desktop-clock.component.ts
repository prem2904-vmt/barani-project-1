import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { CLOCK_LOCALE, formatClock, localeUses12h, startMinuteTicker } from '../../core/services/desktop-clock';

/**
 * Time + date at the right end of the top strip while the desktop app is
 * full screen (the OS clock is hidden then), styled like the Windows taskbar
 * clock (owner): two right-aligned lines, "12:39 PM" over "30/09/2026".
 * Rendered by the top strip only when DesktopWindowService.showClock()
 * (Electron + full screen), so web and the iPad app never create it. Ticks
 * on the minute, never per second; IST (the lab's clock); Indian locale
 * (12 h, dd/mm/yyyy).
 */
@Component({
  selector: 'pf-desktop-clock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <time class="pf-dclock" [attr.datetime]="face().iso" aria-live="off"
          [attr.aria-label]="face().label" [attr.title]="face().label">
      <span class="pf-dclock__time">{{ face().time }}</span>
      <span class="pf-dclock__date">{{ face().date }}</span>
    </time>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; align-self: center; flex-shrink: 0; }
    .pf-dclock {
      display: inline-flex; flex-direction: column; align-items: flex-end; justify-content: center;
      gap: 3px;
      padding: 0 2px 0 6px;
      font-size: 12px; line-height: 1.1; font-weight: 500;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      cursor: default; user-select: none;
    }
    .pf-dclock__time { color: var(--text-primary); }
    .pf-dclock__date { color: var(--text-secondary); font-size: 11.5px; }
  `],
})
export class DesktopClockComponent {
  /** Indian locale (owner: like the Windows taskbar in India — "12:39 PM"
   *  over "30/09/2026"), not the browser's UI language: Electron reports
   *  en-GB on an en_IN Mac, which would flip the clock to 24 h. */
  private readonly hour12 = localeUses12h(CLOCK_LOCALE);
  readonly face = signal(formatClock(new Date(), this.hour12));

  constructor() {
    const stop = startMinuteTicker(now => this.face.set(formatClock(now, this.hour12)));
    inject(DestroyRef).onDestroy(stop);
  }
}
