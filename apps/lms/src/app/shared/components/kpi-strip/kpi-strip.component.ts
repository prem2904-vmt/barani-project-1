import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, OnInit,
  SimpleChanges, computed, inject, signal
} from '@angular/core';
import { ApiService } from '../../../core/services/api.service';

interface KpiTile {
  assignmentId: string;
  branchId: string | null;
  kpiId: string;
  code: string;
  label: string;
  icon?: string;
  color?: string;
  /** count | currency | percent | duration_minutes */
  valueType: string;
  value: number;
  sortOrder: number;
}

@Component({
  selector: 'pf-kpi-strip',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tiles().length > 0) {
      <div class="pf-kpis"
           [class.pf-kpis--loading]="loading() && !hasLoaded()"
           [attr.aria-label]="'Quick stats for ' + screen">
        @for (t of tiles(); track t.kpiId) {
          <span class="pf-kpi" [attr.data-color]="t.color || 'violet'">
            <span class="pf-kpi__dot" aria-hidden="true"></span>
            <span class="pf-kpi__label">{{ t.label }}</span>
            <span class="pf-kpi__value">{{ formatValue(t) }}</span>
          </span>
        }
      </div>
    } @else if (!loading() && hasLoaded() && _failed()) {
      <!-- Stay quiet on a fetch error — strip is auxiliary, not primary. -->
    }
  `,
  styles: [`
    :host { display: block; }

    /* Segmented stat bar — full width, each stat owns an equal slice
     * separated by a hairline divider. Reads as a single structural
     * element (like a status bar), not 5 floating items lost on a
     * wide page. ~28px tall. */
    .pf-kpis {
      display: flex;
      flex-wrap: wrap;
      align-items: stretch;
      width: 100%;
      margin: 2px 0 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      overflow: hidden;
      transition: opacity 0.2s ease;
    }
    .pf-kpis--loading { opacity: 0.55; }

    .pf-kpi {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 7px 14px;
      line-height: 1.2;
      flex: 1 1 0;
      min-width: 0;
      border-right: 1px solid var(--glass-border);
    }
    .pf-kpi:last-child { border-right: none; }
    .pf-kpi__dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      align-self: center;
      background: var(--kpi-dot);
      box-shadow: 0 0 6px var(--kpi-glow);
      flex: 0 0 6px;
    }
    .pf-kpi__label {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-tertiary);
      letter-spacing: 0.01em;
    }
    .pf-kpi__value {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: -0.01em;
    }
    .pf-kpi:hover .pf-kpi__value {
      color: var(--kpi-dot);
      transition: color 0.18s ease;
    }
    /* Per-tone dot palette. Mirrors the old top-stripe colors so the
     * visual mapping carries over even though the cards are gone. */
    .pf-kpi[data-color='violet']  { --kpi-dot: #a78bfa; --kpi-glow: rgba(168, 85, 247, 0.45); }
    .pf-kpi[data-color='emerald'] { --kpi-dot: #34d399; --kpi-glow: rgba(16, 185, 129, 0.45); }
    .pf-kpi[data-color='amber']   { --kpi-dot: #fbbf24; --kpi-glow: rgba(245, 158, 11, 0.45); }
    .pf-kpi[data-color='rose']    { --kpi-dot: #fb7185; --kpi-glow: rgba(244, 63, 94, 0.45); }
    .pf-kpi[data-color='sky']     { --kpi-dot: #38bdf8; --kpi-glow: rgba(14, 165, 233, 0.45); }
    .pf-kpi:not([data-color]),
    .pf-kpi[data-color='']        { --kpi-dot: #a78bfa; --kpi-glow: rgba(168, 85, 247, 0.45); }

    @media (max-width: 720px) {
      /* On phones / iPad portrait the segmented row gets too cramped;
       * collapse to a chip strip — each stat wraps as its own pill. */
      .pf-kpis {
        background: transparent; border: none; border-radius: 0;
        gap: 4px 8px; padding: 0;
      }
      .pf-kpi {
        border-right: none;
        padding: 4px 10px;
        flex: 0 1 auto;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        border-radius: 999px;
      }
      .pf-kpi__label { font-size: 10.5px; }
      .pf-kpi__value { font-size: 12px; }
    }
  `]
})
export class KpiStripComponent implements OnInit, OnChanges, OnDestroy {
  private readonly api = inject(ApiService);

  /** Screen identifier — must match a tab id in the admin configurator. */
  @Input({ required: true }) screen!: string;
  /** Polling interval in ms. 30s default keeps tiles fresh without hammering
   *  the DB. Set to 0 to disable polling. */
  @Input() pollIntervalMs = 30_000;

  private readonly _tiles = signal<KpiTile[]>([]);
  private readonly _loading = signal(false);
  private readonly _hasLoaded = signal(false);
  protected readonly _failed = signal(false);

  readonly tiles = this._tiles.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly hasLoaded = this._hasLoaded.asReadonly();

  private _pollHandle: ReturnType<typeof setInterval> | null = null;

  ngOnInit() {
    this.fetchTiles();
    this.startPolling();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['screen'] && !changes['screen'].firstChange) {
      this._tiles.set([]);
      this._hasLoaded.set(false);
      this.fetchTiles();
    }
    if (changes['pollIntervalMs'] && !changes['pollIntervalMs'].firstChange) {
      this.stopPolling();
      this.startPolling();
    }
  }

  ngOnDestroy() {
    this.stopPolling();
  }

  // ── Lifecycle helpers ───────────────────────────────────────
  private startPolling() {
    if (this.pollIntervalMs <= 0) return;
    this._pollHandle = setInterval(() => {
      // Skip while the tab is hidden so we don't burn requests against an
      // inactive window.
      if (typeof document !== 'undefined' && document.hidden) return;
      this.fetchTiles();
    }, this.pollIntervalMs);
  }
  private stopPolling() {
    if (this._pollHandle) {
      clearInterval(this._pollHandle);
      this._pollHandle = null;
    }
  }

  private fetchTiles() {
    if (!this.screen) return;
    this._loading.set(true);
    this.api.get<KpiTile[]>(`/api/kpis/screens/${encodeURIComponent(this.screen)}`).subscribe({
      next: list => {
        this._tiles.set((list ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder));
        this._loading.set(false);
        this._hasLoaded.set(true);
        this._failed.set(false);
      },
      error: () => {
        this._loading.set(false);
        this._hasLoaded.set(true);
        this._failed.set(true);
      }
    });
  }

  // ── Formatting ──────────────────────────────────────────────
  formatValue(t: KpiTile): string {
    switch (t.valueType) {
      case 'currency':         return this.formatCurrency(t.value);
      case 'percent':          return `${this.round(t.value, 1)}%`;
      case 'duration_minutes': return this.formatDuration(t.value);
      case 'count':
      default:                 return this.formatCount(t.value);
    }
  }

  private formatCount(v: number): string {
    if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return Math.round(v).toString();
  }

  private formatCurrency(v: number): string {
    if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(1).replace(/\.0$/, '')}Cr`;
    if (v >= 100_000)    return `₹${(v / 100_000).toFixed(1).replace(/\.0$/, '')}L`;
    if (v >= 1000)       return `₹${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }

  private formatDuration(minutes: number): string {
    if (minutes >= 1440) return `${this.round(minutes / 1440, 1)}d`;
    if (minutes >= 60)   return `${this.round(minutes / 60, 1)}h`;
    return `${Math.round(minutes)}m`;
  }

  private round(v: number, p: number): string {
    return v.toFixed(p).replace(/\.0+$/, '');
  }
}
