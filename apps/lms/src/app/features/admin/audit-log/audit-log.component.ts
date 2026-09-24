import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ToastService } from '../../../core/services/toast.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { AUDIT_ENTITY_TYPES, AuditLog, AuditLogPage } from '../../../shared/models/audit.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ThemeService } from '../../../core/services/theme.service';

/** Quick date windows for the band pill ('' = any time). */
type RangeKey = '' | 'today' | '7d' | '30d' | 'custom';

interface Filters {
  entityType: string;
  entityId: string;
  action: string;
  from: string;
  to: string;
}

interface DiffRow {
  field: string;
  kind: 'set' | 'change';
  value?: string;
  old?: string;
  new?: string;
}

const EMPTY_FILTERS: Filters = { entityType: '', entityId: '', action: '', from: '', to: '' };

@Component({
  selector: 'pf-audit-log',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, TileComponent, TouchButtonComponent, LoadingLogoComponent, HeroBandComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* Phone (<=640): the log-row header packs 5 children in one non-wrapping
       flex row; let it wrap and reflow the meta (user/time) so it never forces
       horizontal overflow. Desktop layout (>=641) is untouched. */
    @media (max-width: 640px) {
      :host .audit-row {
        flex-wrap: wrap;
        row-gap: 0.25rem;
        column-gap: 0.5rem;
        min-height: 44px;          /* comfortable tap target */
      }
      /* Drop the ml-auto push so meta wraps onto its own line instead of being
         squeezed; keep it left-aligned under the badge/type. */
      :host .audit-row .audit-user {
        margin-left: 0;
      }
      :host .audit-row .audit-when {
        margin-left: auto;          /* time sits at the end of the wrapped line */
      }
      /* Stack the field-diff: a fixed 140px label column is too wide on a
         ~320px screen — let label + value stack full-width. */
      :host .audit-diff {
        grid-template-columns: 1fr;
        row-gap: 0.125rem;
      }
      /* Long diff values (JSON blobs, free text) and the full entity id must
         break instead of forcing the card/page to scroll sideways on phone. */
      :host .audit-diff-row { overflow-wrap: anywhere; word-break: break-word; }
      :host .audit-full-id  { overflow-wrap: anywhere; word-break: break-all; }
      /* Pagination footer: let the range label + buttons wrap on narrow phones
         instead of crowding into one line. */
      :host .audit-pager { flex-wrap: wrap; row-gap: 0.5rem; }
    }
    /* Touch devices of any width (iPad/touch laptops): the collapsible log row
       is the primary control — guarantee a 44px tap target without altering the
       mouse/desktop layout. */
    @media (pointer: coarse) {
      :host .audit-row { min-height: 44px; }
    }
    /* ── Band pill filters (new design) ── */
    .audit-bandsel { display: block; min-width: 150px; }
    .audit-bandsel--type { min-width: 180px; }
    .audit-dates { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .audit-date {
      height: 32px; padding: 0 8px; border-radius: 9px; font-size: 12.5px; font-family: inherit;
      background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-primary);
      color-scheme: light dark;
    }
    .audit-date:focus { outline: none; border-color: rgba(139, 92, 246, 0.55); }
    .audit-dates__sep { font-size: 12px; color: var(--text-tertiary); }
    @media (max-width: 640px) {
      .audit-bandsel, .audit-bandsel--type { min-width: 140px; }
      .audit-date { height: 40px; font-size: 16px; }
    }
    /* Web-below-desktop band (641–1279, behind the 64px icon rail): at >=1024
       Tailwind's lg:grid-cols-5 packs all 5 filters into one row, which leaves
       the date inputs cramped next to the rail. Cap at 3 columns so the filter
       fields reflow with comfortable widths; desktop (>=1280) keeps 5-up. */
    @media (min-width: 641px) and (max-width: 1279px) {
      :host .audit-filter-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
  `],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): the record id is the search; record type,
             action and the date window ride in the pill and apply at once. -->
        <pf-hero-band [back]="true" placeholder="Search by record id…"
                      [value]="filters().entityId" (valueChange)="onIdInput($event)" (submitted)="apply()">
          <ng-container band-tools>
            <pf-select class="audit-bandsel audit-bandsel--type" size="sm" [options]="entityTypeOptions"
                       [value]="filters().entityType" (valueChange)="setFilter({ entityType: $event })"
                       aria-label="Record type"></pf-select>
            <pf-select class="audit-bandsel" size="sm" [options]="actionOptions"
                       [value]="filters().action" (valueChange)="setFilter({ action: $event })"
                       aria-label="Action"></pf-select>
            <pf-select class="audit-bandsel" size="sm" [options]="rangeOptions"
                       [value]="range()" (valueChange)="setRange($event)"
                       aria-label="When"></pf-select>
            @if (range() === 'custom') {
              <span class="audit-dates">
                <input type="date" class="audit-date" aria-label="From"
                       [ngModel]="filters().from" (ngModelChange)="setFilter({ from: $event })" />
                <span class="audit-dates__sep">to</span>
                <input type="date" class="audit-date" aria-label="To"
                       [ngModel]="filters().to" (ngModelChange)="setFilter({ to: $event })" />
              </span>
            }
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="!hasFilters()" (click)="clearAll()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              Clear
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Audit trail"
        subtitle="Every change to results, samples, patients, reports, billing and access — who did it, when, and exactly what changed. Append-only.">
      </pf-screen-header>

      <div class="pf-band-body">
      <!-- Filters (classic; the new design has them in the band pill) -->
      <pf-tile tone="default" padding="lg" class="block mb-4 pf-classic-only">
        <div class="audit-filter-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label class="pf-label">Record type</label>
            <select class="pf-input" [ngModel]="filters().entityType"
                    (ngModelChange)="patch({ entityType: $event })">
              @for (t of entityTypes; track t.value) {
                <option [value]="t.value">{{ t.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="pf-label">Action</label>
            <select class="pf-input" [ngModel]="filters().action"
                    (ngModelChange)="patch({ action: $event })">
              <option value="">Any action</option>
              <option value="create">Created</option>
              <option value="update">Updated</option>
              <option value="delete">Deleted</option>
            </select>
          </div>
          <div>
            <label class="pf-label">Record ID</label>
            <input type="text" class="pf-input" placeholder="Exact id"
                   [ngModel]="filters().entityId" (ngModelChange)="patch({ entityId: $event })"/>
          </div>
          <div>
            <label class="pf-label">From</label>
            <input type="date" class="pf-input"
                   [ngModel]="filters().from" (ngModelChange)="patch({ from: $event })"/>
          </div>
          <div>
            <label class="pf-label">To</label>
            <input type="date" class="pf-input"
                   [ngModel]="filters().to" (ngModelChange)="patch({ to: $event })"/>
          </div>
        </div>
        <div class="mt-3 flex gap-2 justify-end">
          <pf-touch-btn size="sm" variant="ghost" (pressed)="reset()">Clear</pf-touch-btn>
          <pf-touch-btn size="sm" variant="primary" (pressed)="apply()">Apply</pf-touch-btn>
        </div>
      </pf-tile>

      @if (loading()) {
        <pf-tile tone="default" padding="lg" class="block">
          <div class="flex justify-center py-6">
            <pf-loading-logo size="lg" color="purple" [showDna]="true"
                             [showText]="true" text="Loading audit trail…"></pf-loading-logo>
          </div>
        </pf-tile>
      } @else if (logs().length === 0) {
        <pf-tile tone="default" padding="xl" class="block">
          <p class="text-center text-[13px]" style="color: var(--text-tertiary);">
            No audit entries match these filters.
          </p>
        </pf-tile>
      } @else {
        <div class="space-y-2">
          @for (log of logs(); track log.id) {
            <pf-tile tone="default" padding="md" class="block">
              <button type="button" class="audit-row w-full flex items-center gap-3 text-left"
                      (click)="toggle(log.id)">
                <span class="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0"
                      [style.background]="badgeBg(log.action)"
                      [style.color]="badgeFg(log.action)">
                  {{ actionLabel(log.action) }}
                </span>
                <span class="text-[13px] font-semibold shrink-0">{{ typeLabel(log.entityType) }}</span>
                <span class="text-[12px] font-mono truncate min-w-0" style="color: var(--text-tertiary);">
                  {{ shortId(log.entityId) }}
                </span>
                <span class="audit-user ml-auto text-[12px] shrink-0" style="color: var(--text-secondary);">
                  {{ log.userName || 'System' }}
                </span>
                <span class="audit-when text-[11px] shrink-0" style="color: var(--text-tertiary);">
                  {{ when(log.at) }}
                </span>
              </button>

              @if (expanded() === log.id) {
                <div class="mt-3 pt-3 border-t" style="border-color: var(--border-subtle);">
                  @if (diff(log).length === 0) {
                    <p class="text-[12px]" style="color: var(--text-tertiary);">
                      @if (log.entityType === 'Auth') {
                        <!-- Older auth rows predate the event description; a
                             sign-in has no field diff by nature. -->
                        Sign-in / security event — there are no record fields to compare.
                      } @else {
                        No field-level detail recorded.
                      }
                    </p>
                  } @else {
                    <div class="space-y-1.5">
                      @for (d of diff(log); track d.field) {
                        <div class="audit-diff grid grid-cols-[140px_1fr] gap-2 text-[12px] audit-diff-row">
                          <span class="font-mono font-semibold" style="color: var(--text-secondary);">{{ d.field }}</span>
                          @if (d.kind === 'change') {
                            <span>
                              <span class="line-through" style="color: var(--text-tertiary);">{{ d.old }}</span>
                              <span class="mx-1" style="color: var(--text-tertiary);">→</span>
                              <span class="font-semibold">{{ d.new }}</span>
                            </span>
                          } @else {
                            <span class="font-semibold">{{ d.value }}</span>
                          }
                        </div>
                      }
                    </div>
                  }
                  <p class="audit-full-id mt-2 text-[11px] font-mono" style="color: var(--text-tertiary);">id {{ log.entityId }}</p>
                </div>
              }
            </pf-tile>
          }
        </div>

        <!-- Pagination -->
        <div class="audit-pager mt-4 flex items-center justify-between text-[12px]" style="color: var(--text-secondary);">
          <span>{{ rangeLabel() }} of {{ total() }}</span>
          <div class="flex gap-2">
            <pf-touch-btn size="sm" variant="ghost" [disabled]="page() <= 1" (pressed)="prev()">Previous</pf-touch-btn>
            <pf-touch-btn size="sm" variant="ghost" [disabled]="!hasNext()" (pressed)="next()">Next</pf-touch-btn>
          </div>
        </div>
      }
      </div>
    </section>
  `
})
export class AuditLogComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly entityTypes = AUDIT_ENTITY_TYPES;
  protected readonly theme = inject(ThemeService);

  // ── Band pill filters ────────────────────────────────────────────────
  readonly entityTypeOptions: PfSelectOption<string>[] = AUDIT_ENTITY_TYPES.map(t => ({ value: t.value, label: t.label }));
  readonly actionOptions: PfSelectOption<string>[] = [
    { value: '', label: 'Any action' },
    { value: 'create', label: 'Created' },
    { value: 'update', label: 'Updated' },
    { value: 'delete', label: 'Deleted' },
  ];
  readonly rangeOptions: PfSelectOption<RangeKey>[] = [
    { value: '', label: 'Any time' },
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: 'custom', label: 'Custom dates…' },
  ];
  readonly range = signal<RangeKey>('');
  private idTimer: ReturnType<typeof setTimeout> | null = null;

  /** Pill filter change → apply immediately (no Apply button in the band). */
  setFilter(p: Partial<Filters>) {
    this.patch(p);
    this.apply();
  }

  /** Record-id search: debounced while typing; Enter applies at once. */
  onIdInput(v: string) {
    this.patch({ entityId: v ?? '' });
    if (this.idTimer) clearTimeout(this.idTimer);
    this.idTimer = setTimeout(() => { this.idTimer = null; this.apply(); }, 400);
  }

  setRange(r: RangeKey) {
    this.range.set(r);
    if (r === 'custom') return; // the two date inputs appear; they apply on change
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date();
    const back = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
    const from = r === 'today' ? iso(today) : r === '7d' ? back(6) : r === '30d' ? back(29) : '';
    this.setFilter({ from, to: r ? iso(today) : '' });
  }

  readonly hasFilters = computed(() => {
    const f = this._filters();
    return !!(f.entityType || f.entityId || f.action || f.from || f.to);
  });

  clearAll() {
    if (this.idTimer) { clearTimeout(this.idTimer); this.idTimer = null; }
    this.range.set('');
    this.reset();
  }

  private readonly _filters = signal<Filters>({ ...EMPTY_FILTERS });
  readonly filters = this._filters.asReadonly();

  private readonly _logs = signal<AuditLog[]>([]);
  readonly logs = this._logs.asReadonly();
  private readonly _total = signal(0);
  readonly total = this._total.asReadonly();
  private readonly _page = signal(1);
  readonly page = this._page.asReadonly();
  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();
  private readonly _expanded = signal<string | null>(null);
  readonly expanded = this._expanded.asReadonly();

  private readonly pageSize = 50;

  readonly hasNext = computed(() => this._page() * this.pageSize < this._total());
  readonly rangeLabel = computed(() => {
    const total = this._total();
    if (total === 0) return '0';
    const start = (this._page() - 1) * this.pageSize + 1;
    const end = Math.min(this._page() * this.pageSize, total);
    return `${start}–${end}`;
  });

  ngOnInit(): void {
    this.load();
  }

  patch(p: Partial<Filters>) {
    this._filters.update(f => ({ ...f, ...p }));
  }

  apply() {
    if (this.idTimer) { clearTimeout(this.idTimer); this.idTimer = null; }
    this._page.set(1);
    this.load();
  }

  reset() {
    this._filters.set({ ...EMPTY_FILTERS });
    this._page.set(1);
    this.load();
  }

  prev() {
    if (this._page() <= 1) return;
    this._page.update(p => p - 1);
    this.load();
  }

  next() {
    if (!this.hasNext()) return;
    this._page.update(p => p + 1);
    this.load();
  }

  toggle(id: string) {
    this._expanded.update(cur => (cur === id ? null : id));
  }

  private load() {
    const f = this._filters();
    const params = new URLSearchParams();
    if (f.entityType) params.set('entityType', f.entityType);
    if (f.entityId.trim()) params.set('entityId', f.entityId.trim());
    if (f.action) params.set('action', f.action);
    if (f.from) params.set('from', new Date(f.from).toISOString());
    // `to` is exclusive on the backend; push to end-of-day so the picked day is included.
    if (f.to) { const d = new Date(f.to); d.setDate(d.getDate() + 1); params.set('to', d.toISOString()); }
    params.set('page', String(this._page()));
    params.set('pageSize', String(this.pageSize));

    this._loading.set(true);
    this.api.get<AuditLogPage>(`/api/audit/logs?${params.toString()}`).subscribe({
      next: res => {
        this._logs.set(res.items ?? []);
        this._total.set(res.total ?? 0);
        this._loading.set(false);
      },
      error: (e) => {
        this._loading.set(false);
        this.toast.error(ApiError.from(e).message);
      }
    });
  }

  // ── display helpers ─────────────────────────────────────────────────────

  diff(log: AuditLog): DiffRow[] {
    if (!log.changes) return [];
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(log.changes); } catch { return []; }
    const rows: DiffRow[] = [];
    for (const [field, val] of Object.entries(parsed)) {
      if (val && typeof val === 'object' && ('old' in val || 'new' in val)) {
        const o = val as { old?: unknown; new?: unknown };
        rows.push({ field, kind: 'change', old: this.show(o.old), new: this.show(o.new) });
      } else {
        rows.push({ field, kind: 'set', value: this.show(val) });
      }
    }
    return rows;
  }

  private show(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  typeLabel(t: string): string {
    return this.entityTypes.find(e => e.value === t)?.label ?? t.replace(/Entity$/, '');
  }
  actionLabel(a: string): string {
    switch (a) {
      case 'create': return 'CREATED';
      case 'update': return 'UPDATED';
      case 'delete': return 'DELETED';
      // Auth events written by AuthController — not entity mutations.
      case 'login': return 'SIGNED IN';
      case 'login_failed': return 'SIGN-IN FAILED';
      case 'password_changed': return 'PASSWORD';
      case 'pin_changed': return 'PIN CHANGED';
      case 'pin_failed': return 'PIN FAILED';
      default: return a.toUpperCase();
    }
  }
  badgeBg(a: string): string {
    if (a === 'create' || a === 'login') return 'rgba(16,185,129,0.15)';
    if (a === 'delete' || a === 'login_failed' || a === 'pin_failed') return 'rgba(244,63,94,0.15)';
    return 'rgba(245,158,11,0.15)';
  }
  badgeFg(a: string): string {
    if (a === 'create' || a === 'login') return '#10b981';
    if (a === 'delete' || a === 'login_failed' || a === 'pin_failed') return '#f43f5e';
    return '#f59e0b';
  }
  shortId(id: string): string {
    return id.length > 12 ? id.slice(0, 8) + '…' : id;
  }
  when(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
