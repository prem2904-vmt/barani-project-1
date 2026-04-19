import { ChangeDetectionStrategy, Component, HostBinding, Input, OnDestroy, OnInit, signal } from '@angular/core';

export type ClockSize = 'sm' | 'md' | 'lg';
export type ClockVariant = 'tile' | 'bare';

/**
 * Live clock. Two variants:
 *  - tile:  glass panel with icon + stacked time/date (use inside forms/tiles).
 *  - bare:  ambient text-only — no bg, no border, muted. Meant to feel like
 *           watermark metadata, not a widget. Use when floating near content.
 *
 * Ticks every 15s — no seconds shown, so no need to burn renders.
 */
@Component({
  selector: 'pf-clock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (variant === 'tile') {
      <div class="tile">
        <svg class="tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 7v5l3 2"/>
        </svg>
        <div class="stack">
          <span class="tile-time">{{ time() }}</span>
          <span class="tile-date">{{ date() }}</span>
        </div>
      </div>
    } @else {
      <span class="bare">
        <span class="bare-time">{{ time() }}</span>
        <span class="bare-sep" aria-hidden="true">·</span>
        <span class="bare-date">{{ date() }}</span>
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; line-height: 1; }

    /* Tile variant ------------------------------------------- */
    .tile {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    :host([data-size='sm']) .tile { padding: 6px 10px; gap: 8px; border-radius: 12px; }
    :host([data-size='lg']) .tile { padding: 10px 16px; gap: 12px; border-radius: 16px; }

    .tile-icon { width: 18px; height: 18px; color: #c4b5fd; flex-shrink: 0; }
    :host([data-size='sm']) .tile-icon { width: 16px; height: 16px; }
    :host([data-size='lg']) .tile-icon { width: 22px; height: 22px; }

    .stack { display: flex; flex-direction: column; line-height: 1.05; }
    .tile-time {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: 0.04em;
      font-variant-numeric: tabular-nums;
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
    }
    :host([data-size='sm']) .tile-time { font-size: 14px; }
    :host([data-size='lg']) .tile-time { font-size: 22px; }

    .tile-date {
      margin-top: 2px;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    :host([data-size='lg']) .tile-date { font-size: 11px; }

    /* Bare variant — ambient metadata, no chrome. ------------ */
    .bare {
      display: inline-flex;
      align-items: baseline;
      gap: 8px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .bare-time {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      font-size: 12px;
      color: var(--text-secondary);
    }
    :host([data-size='sm']) .bare-time { font-size: 11px; }
    :host([data-size='lg']) .bare-time { font-size: 13px; }

    .bare-sep {
      color: var(--text-muted);
      opacity: 0.5;
      font-weight: 400;
    }

    .bare-date {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
    }
    :host([data-size='sm']) .bare-date { font-size: 9.5px; }
    :host([data-size='lg']) .bare-date { font-size: 11px; }
  `]
})
export class ClockComponent implements OnInit, OnDestroy {
  @Input() @HostBinding('attr.data-size') size: ClockSize = 'md';
  @Input() @HostBinding('attr.data-variant') variant: ClockVariant = 'tile';
  @Input() hour12 = false;

  readonly time = signal<string>('');
  readonly date = signal<string>('');

  private _timer?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.tick();
    this._timer = setInterval(() => this.tick(), 15_000);
  }

  ngOnDestroy() {
    if (this._timer) clearInterval(this._timer);
  }

  private tick() {
    const now = new Date();
    this.time.set(now.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: this.hour12
    }));
    this.date.set(now.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short'
    }));
  }
}
