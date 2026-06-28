import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Test } from '../../../shared/models/test.model';
import { Department } from '../../../shared/models/tenant.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

interface PriceRow {
  id: string;
  name: string;
  deptName: string;
  deptId: string;
  orig: number;
}

/**
 * Admin test-PRICING screen. A flat, filterable list of every test with an
 * inline-editable price, plus a bulk percentage increase scoped to whatever is
 * currently filtered (a department and/or a search). The page itself never
 * scrolls — only the rows region does (reverts to natural page scroll on phone).
 *
 * Backend: reuses GET /api/tests (price + department) and commits all edits
 * (inline + bulk %) through PATCH /api/tests/prices/bulk. No new endpoint.
 */
@Component({
  selector: 'pf-pricing',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, SelectComponent, TileComponent, TouchButtonComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-pricing" [class.pf-pricing--embedded]="embedded()">

      <!-- ── Fixed chrome: header + filters + bulk bar ───────────── -->
      <div class="pf-pricing__chrome px-4 md:px-8 pt-6">
        @if (!embedded()) {
          <pf-screen-header eyebrow="Admin" title="Pricing"
            subtitle="Edit test prices by department. Bulk-raise a whole department or the filtered list.">
          </pf-screen-header>
        }

        <!-- Filters -->
        <div class="flex flex-wrap items-center gap-3 mb-3">
          <pf-select class="pf-pricing__dept"
            [options]="deptOptions()"
            [value]="selectedDeptId()"
            placeholder="All departments"
            (valueChange)="selectedDeptId.set($event)">
          </pf-select>
          <input type="text" class="pf-input pf-pricing__search"
                 placeholder="Search test name…"
                 [ngModel]="search()" (ngModelChange)="search.set($event)" />
          <span class="text-[12px] ml-auto" style="color: var(--text-tertiary);">
            {{ filtered().length }} test{{ filtered().length === 1 ? '' : 's' }}
          </span>
        </div>

        <!-- Bulk percentage increase -->
        <div class="pf-pricing__bulk">
          <span class="text-[12.5px] font-semibold whitespace-nowrap" style="color: var(--text-primary);">Bulk change</span>
          <div class="flex items-center gap-1">
            <input type="number" class="pf-input pf-pricing__pct" [ngModel]="pct()" (ngModelChange)="pct.set($any($event))"
                   step="1" inputmode="decimal" aria-label="Percentage" />
            <span class="text-[13px]" style="color: var(--text-tertiary);">%</span>
          </div>
          <pf-touch-btn size="sm" variant="secondary" [disabled]="!filtered().length || !pct()" (pressed)="applyBulk()">
            Apply to {{ filtered().length }} filtered
          </pf-touch-btn>
          <span class="text-[11.5px]" style="color: var(--text-tertiary);">
            {{ scopeLabel() }} · enter a negative % to reduce.
          </span>
        </div>
      </div>

      <!-- ── Scrollable rows ─────────────────────────────────────── -->
      <div class="pf-pricing__scroll px-4 md:px-8">
        @if (loading()) {
          <div class="flex justify-center py-10">
            <pf-loading-logo size="md" color="purple" [showDna]="true" [showText]="true" text="Loading prices…"></pf-loading-logo>
          </div>
        } @else if (!filtered().length) {
          <pf-tile tone="default" padding="lg" class="block">
            <p class="text-center text-[13px]" style="color: var(--text-tertiary);">No tests match this filter.</p>
          </pf-tile>
        } @else {
          <div class="pf-pricing__head">
            <span class="grow">Test</span>
            <span class="pf-pricing__price-h">Price (₹)</span>
          </div>
          <ul class="pf-pricing__list">
            @for (r of filtered(); track r.id) {
              <li class="pf-pricing__row" [class.pf-pricing__row--dirty]="isDirty(r.id)">
                <div class="grow min-w-0">
                  <p class="font-semibold text-[14.5px] truncate" style="color: var(--text-primary);">{{ r.name }}</p>
                  <p class="text-[12px] truncate" style="color: var(--text-tertiary);">{{ r.deptName || 'No department' }}</p>
                </div>
                <div class="pf-pricing__price">
                  <span class="text-[13px]" style="color: var(--text-tertiary);">₹</span>
                  <input type="number" class="pf-input pf-pricing__price-in" min="0" step="0.01" inputmode="decimal"
                         [ngModel]="edits()[r.id]" (ngModelChange)="setPrice(r.id, $any($event))" />
                </div>
              </li>
            }
          </ul>
          <div class="h-2"></div>
        }
      </div>

      <!-- ── Sticky save bar (only when there are unsaved edits) ──── -->
      @if (dirtyCount() > 0) {
        <div class="pf-pricing__savebar px-4 md:px-8">
          <span class="text-[13px] font-medium" style="color: var(--text-primary);">
            {{ dirtyCount() }} unsaved change{{ dirtyCount() === 1 ? '' : 's' }}
          </span>
          <div class="flex items-center gap-2 ml-auto">
            <pf-touch-btn size="sm" variant="ghost" [disabled]="saving()" (pressed)="discard()">Discard</pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary" [disabled]="saving()" (pressed)="save()">
              @if (saving()) { Saving… } @else { Save changes }
            </pf-touch-btn>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .pf-pricing { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
    .pf-pricing__chrome { flex: 0 0 auto; }
    .pf-pricing__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; }

    /* Embedded in the Tests "Pricing" tab: flow naturally, no own padding/header,
       and keep the save bar pinned to the bottom of the viewport while scrolling. */
    :host { display: block; }
    .pf-pricing--embedded { height: auto; overflow: visible; }
    .pf-pricing--embedded .pf-pricing__chrome,
    .pf-pricing--embedded .pf-pricing__scroll { padding-left: 0; padding-right: 0; }
    .pf-pricing--embedded .pf-pricing__chrome { padding-top: 0; }
    .pf-pricing--embedded .pf-pricing__scroll { overflow-y: visible; flex: 0 1 auto; }
    .pf-pricing--embedded .pf-pricing__savebar { position: sticky; bottom: 0; border-radius: 12px; }

    .pf-pricing__dept { width: 240px; max-width: 100%; display: inline-block; }
    .pf-pricing__search { width: 260px; max-width: 100%; }

    .pf-pricing__bulk {
      display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
      padding: 10px 12px; margin-bottom: 12px;
      border: 1px solid var(--glass-border); border-radius: 12px;
      background: var(--glass-bg);
    }
    .pf-pricing__pct { width: 74px; text-align: right; }

    .pf-pricing__head {
      display: flex; align-items: center; gap: 12px;
      padding: 0 12px 8px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
      color: var(--text-muted); border-bottom: 1px dashed var(--glass-border); margin-bottom: 8px;
    }
    .pf-pricing__head .grow { flex: 1; }
    .pf-pricing__price-h { width: 150px; text-align: right; }

    .pf-pricing__list { display: flex; flex-direction: column; gap: 6px; list-style: none; padding: 0; margin: 0; }
    .pf-pricing__row {
      display: flex; align-items: center; gap: 12px; padding: 8px 12px;
      background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 12px;
    }
    .pf-pricing__row--dirty { border-color: rgba(168, 85, 247, 0.55); background: rgba(168, 85, 247, 0.07); }
    .pf-pricing__price { display: flex; align-items: center; gap: 6px; width: 150px; flex: 0 0 auto; }
    .pf-pricing__price-in { width: 120px; text-align: right; }

    .pf-pricing__savebar {
      flex: 0 0 auto; display: flex; align-items: center; gap: 12px;
      padding-top: 12px; padding-bottom: 12px; margin-top: 4px;
      border-top: 1px solid var(--glass-border);
      background: var(--bg-elevated, rgba(20, 20, 28, 0.92));
      backdrop-filter: blur(8px);
    }

    /* Phone (<=640): the page scrolls naturally; the chrome isn't pinned so the
       list gets full height, and the save bar sticks above the bottom nav. */
    @media (max-width: 640px) {
      .pf-pricing { height: auto; overflow: visible; }
      .pf-pricing__scroll { flex: 0 1 auto; overflow-y: visible; }
      .pf-pricing__dept, .pf-pricing__search { width: 100%; }
      .pf-pricing__savebar {
        position: sticky;
        bottom: calc(var(--tab-nav-total-height, 0px));
        border-radius: 14px; border: 1px solid var(--glass-border);
        margin: 8px 0 calc(var(--tab-nav-total-height, 0px) + 8px);
      }
    }

    /* Touch + iOS: 44px targets, 16px inputs (no zoom). */
    @media (pointer: coarse) { :host input { min-height: 44px; } }
    @media (max-width: 768px) { :host input { font-size: 16px; } }
  `]
})
export class PricingComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  /** When rendered inside another screen (e.g. the Tests "Pricing" tab) hide the
   *  own header and flow naturally instead of the fixed-page / inner-scroll. */
  readonly embedded = input(false);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly search = signal('');
  readonly selectedDeptId = signal<string>('');
  readonly pct = signal<number>(10);

  private readonly _rows = signal<PriceRow[]>([]);
  /** testId → current (possibly edited) price. */
  readonly edits = signal<Record<string, number>>({});

  private readonly _departments = signal<Department[]>([]);

  readonly deptOptions = computed<PfSelectOption[]>(() => [
    { value: '', label: 'All departments' },
    ...this.dedupeByCode(this._departments()).map(d => ({ value: d.id, label: d.name + (d.code ? ' · ' + d.code : '') })),
  ]);

  readonly filtered = computed<PriceRow[]>(() => {
    const s = this.search().trim().toLowerCase();
    const dept = this.selectedDeptId();
    return this._rows().filter(r =>
      (!dept || r.deptId === dept) &&
      (!s || r.name.toLowerCase().includes(s))
    );
  });

  readonly dirtyCount = computed(() => {
    const e = this.edits();
    return this._rows().reduce((n, r) => n + (this.round2(e[r.id]) !== this.round2(r.orig) ? 1 : 0), 0);
  });

  scopeLabel(): string {
    const dept = this.selectedDeptId();
    const name = this._departments().find(d => d.id === dept)?.name;
    return dept && name ? `Applies to ${name}` : 'Applies to all departments';
  }

  isDirty(id: string): boolean {
    return this.round2(this.edits()[id]) !== this.round2(this._rows().find(r => r.id === id)?.orig ?? 0);
  }

  ngOnInit() {
    this.load();
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: list => this._departments.set(list ?? []),
      error: () => { /* dept filter degrades to none */ },
    });
  }

  private load() {
    this.loading.set(true);
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: list => {
        const rows: PriceRow[] = (list ?? []).map(t => ({
          id: t.id,
          name: t.name,
          deptName: t.department?.name ?? '',
          deptId: t.department?.id ?? t.departmentId ?? '',
          orig: Number(t.price ?? 0),
        })).sort((a, b) => (a.deptName || '~').localeCompare(b.deptName || '~') || a.name.localeCompare(b.name));
        this._rows.set(rows);
        this.edits.set(Object.fromEntries(rows.map(r => [r.id, r.orig])));
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.toasts.error('Failed to load tests'); },
    });
  }

  setPrice(id: string, val: number) {
    const n = Number(val);
    this.edits.update(e => ({ ...e, [id]: Number.isFinite(n) ? Math.max(0, n) : 0 }));
  }

  /** Apply the percentage to every CURRENTLY FILTERED row (department + search). */
  applyBulk() {
    const p = Number(this.pct());
    if (!Number.isFinite(p) || p === 0) return;
    const factor = 1 + p / 100;
    const ids = new Set(this.filtered().map(r => r.id));
    this.edits.update(e => {
      const next = { ...e };
      for (const id of ids) next[id] = this.round2(Math.max(0, (next[id] ?? 0) * factor));
      return next;
    });
    this.toasts.info(`${p > 0 ? '+' : ''}${p}% applied to ${ids.size} test${ids.size === 1 ? '' : 's'} — review and Save.`);
  }

  discard() {
    this.edits.set(Object.fromEntries(this._rows().map(r => [r.id, r.orig])));
  }

  async save() {
    const e = this.edits();
    const updates = this._rows()
      .filter(r => this.round2(e[r.id]) !== this.round2(r.orig))
      .map(r => ({ testId: r.id, price: this.round2(e[r.id]) }));
    if (updates.length === 0) return;
    this.saving.set(true);
    try {
      await firstValueFrom(this.api.patch('/api/tests/prices/bulk', { updates }));
      // Commit: new originals become the saved prices.
      this._rows.update(rows => rows.map(r => {
        const u = updates.find(x => x.testId === r.id);
        return u ? { ...r, orig: u.price } : r;
      }));
      this.toasts.success(`Updated ${updates.length} price${updates.length === 1 ? '' : 's'}`);
    } catch {
      this.toasts.error('Failed to save prices');
    } finally {
      this.saving.set(false);
    }
  }

  private round2(n: number | undefined): number {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  private dedupeByCode(list: Department[]): Department[] {
    const byKey = new Map<string, Department>();
    for (const d of list) {
      const key = (d.code?.trim() || d.name?.trim() || d.id).toUpperCase();
      const existing = byKey.get(key);
      if (!existing) { byKey.set(key, d); continue; }
      if (existing.branchId && !d.branchId) byKey.set(key, d);
    }
    return [...byKey.values()];
  }
}
