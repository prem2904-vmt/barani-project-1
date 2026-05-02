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
      <section class="pf-kpis"
               [class.pf-kpis--loading]="loading() && !hasLoaded()"
               [attr.aria-label]="'KPI cards for ' + screen">
        @for (t of tiles(); track t.kpiId) {
          <article class="pf-kpi" [attr.data-color]="t.color || 'violet'">
            <span class="pf-kpi__label">{{ t.label }}</span>
            <span class="pf-kpi__value">{{ formatValue(t) }}</span>
          </article>
        }
      </section>
    } @else if (!loading() && hasLoaded() && _failed()) {
      <!-- Stay quiet on a fetch error — KPI strip is auxiliary, not the
           primary content. The error gets logged on the network panel. -->
    }
  `,
  styles: [`
    :host { display: block; }

    /* Adaptive layout:
     * - auto-fit (not auto-fill) collapses empty tracks so 3 cards on a
     *   wide screen stretch to fill the row instead of leaving a void.
     * - minmax(min(200px, 100%), 1fr) keeps cards from outgrowing the
     *   container on narrow widths (avoids horizontal overflow).
     * - max-width per card via the inline-clamp below caps a single
     *   card from ballooning past ~360px on very wide screens, which
     *   keeps the value readable rather than spread out.
     */
    .pf-kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
      gap: 12px;
      padding: 4px 0 12px;
      transition: opacity 0.2s ease;
    }
    .pf-kpis--loading { opacity: 0.7; }

    /* Glass-card aesthetic to match the rest of the shell:
     *   - Semi-translucent background (--glass-bg) so the page mood
     *     bleeds through, instead of a hard solid card.
     *   - Subtle border + backdrop blur to read as a glass pane.
     *   - The tone stripe at the top stays, but the per-tone glow now
     *     leaks into a soft radial wash inside the card so the card
     *     itself picks up the colour rather than a single hard line.
     *   - Larger border-radius (16px) lines up with the search bar /
     *     button pills used elsewhere on the page. */
    .pf-kpi {
      position: relative;
      padding: 16px 18px 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      overflow: hidden;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: border-color 0.18s ease, background 0.18s ease;
    }
    .pf-kpi:hover {
      border-color: rgba(168, 85, 247, 0.32);
      background: var(--glass-bg-hover);
    }
    /* Hairline tone stripe — soft fade-out at the edges so it doesn't
     * read as a hard rectangular box. */
    .pf-kpi::before {
      content: '';
      position: absolute;
      top: 0; left: 12%; right: 12%;
      height: 1.5px;
      background: linear-gradient(90deg, transparent 0%, var(--kpi-stripe-start) 30%, var(--kpi-stripe-end) 70%, transparent 100%);
      opacity: 0.85;
    }
    /* Ambient inner glow tinted to the KPI tone — picks up the page
     * gradient mood without dominating the card. */
    .pf-kpi::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(120% 80% at 0% 0%, var(--kpi-glow), transparent 60%);
      opacity: 0.5;
    }

    /* Per-tone stripe + glow palette. Glow is a softer rgba of the
     * same colour. Default to violet when no tone is set. */
    .pf-kpi[data-color='violet']  { --kpi-stripe-start: #8b5cf6; --kpi-stripe-end: #ec4899; --kpi-glow: rgba(168, 85, 247, 0.10); }
    .pf-kpi[data-color='emerald'] { --kpi-stripe-start: #10b981; --kpi-stripe-end: #34d399; --kpi-glow: rgba(16, 185, 129, 0.10); }
    .pf-kpi[data-color='amber']   { --kpi-stripe-start: #f59e0b; --kpi-stripe-end: #fbbf24; --kpi-glow: rgba(245, 158, 11, 0.10); }
    .pf-kpi[data-color='rose']    { --kpi-stripe-start: #f43f5e; --kpi-stripe-end: #fb7185; --kpi-glow: rgba(244, 63, 94, 0.10); }
    .pf-kpi[data-color='sky']     { --kpi-stripe-start: #0ea5e9; --kpi-stripe-end: #38bdf8; --kpi-glow: rgba(14, 165, 233, 0.10); }
    .pf-kpi:not([data-color]),
    .pf-kpi[data-color='']        { --kpi-stripe-start: #8b5cf6; --kpi-stripe-end: #ec4899; --kpi-glow: rgba(168, 85, 247, 0.10); }

    /* Label + value sit ABOVE the ambient glow pseudo-element. */
    .pf-kpi__label,
    .pf-kpi__value { position: relative; z-index: 1; }

    .pf-kpi__label {
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-tertiary);
    }
    .pf-kpi__value {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary);
      line-height: 1.05;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }

    @media (max-width: 540px) {
      .pf-kpis { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
      .pf-kpi { padding: 11px 13px 10px; }
      .pf-kpi__value { font-size: 22px; }
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
