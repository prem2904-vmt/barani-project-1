import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Test } from '../../../shared/models/test.model';
import { Department } from '../../../shared/models/tenant.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { AuthService } from '../../../core/auth/auth.service';
import { TestPricingService } from '../../../core/services/test-pricing.service';
import {
  PriceWriteItem, TENANT_PRICE_SCOPE, effectivePrice, isOffered, isPriceDefault, priceListUrl,
} from '../../../shared/utils/test-pricing';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';

export interface PriceRow {
  id: string;
  name: string;
  deptName: string;
  deptId: string;
  /** Saved effective price for the viewed scope (₹1 when never priced). */
  orig: number;
  /** Still at the ₹1 default (nobody priced it for this scope). */
  notPriced: boolean;
  /** Saved "offered here" flag for the viewed scope. */
  offered: boolean;
}

/**
 * Admin test-PRICING screen — the per-tenant pricing table (Test Master
 * single source, phase 2). A flat, filterable list of every test with an
 * inline-editable price and an "Offered here" switch, plus a bulk percentage
 * change scoped to whatever is currently filtered. The page itself never
 * scrolls — only the rows region does (natural page scroll on phone).
 *
 * Prices live ONLY in the pricing table: every test starts at the ₹1 default
 * (shown as just "₹1") until priced here. Reads come from
 * GET /api/tests (the DTO carries the effective price + `priceIsDefault` +
 * `isOffered`); writes go through PATCH /api/tests/prices/bulk only.
 *
 * Branch isolation ON → a branch picker: each branch has its own prices, and
 * "All branches" edits the tenant default every branch inherits. Isolation
 * OFF → no picker, one tenant price.
 */
@Component({
  selector: 'pf-pricing',
  standalone: true,
  imports: [SkeletonTableComponent, FormsModule, ScreenHeaderComponent, SelectComponent, TileComponent, TouchButtonComponent],
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
          @if (isolationOn()) {
            <pf-select class="pf-pricing__branch"
              [options]="branchOptions()"
              [value]="scopeValue()"
              placeholder="Branch"
              (valueChange)="setScope($event)">
            </pf-select>
          }
          <pf-select class="pf-pricing__dept"
            [options]="deptOptions()"
            [value]="selectedDeptId()"
            placeholder="All departments"
            (valueChange)="selectedDeptId.set($event)">
          </pf-select>
          @if (bandQuery() === null) {
            <input type="search" class="nd-input pf-pricing__search" aria-label="Search test name"
                   placeholder="Search test name…"
                   [ngModel]="search()" (ngModelChange)="search.set($event)" />
          }
          <span class="pf-pricing__count ml-auto">
            <span class="nd-num">{{ filtered().length }}</span> test{{ filtered().length === 1 ? '' : 's' }}
          </span>
        </div>

        <!-- Bulk percentage increase -->
        <div class="pf-pricing__bulk">
          <span class="pf-pricing__bulk-k">Bulk change</span>
          <div class="flex items-center gap-1">
            <input type="number" class="nd-input nd-num pf-pricing__pct" [ngModel]="pct()" (ngModelChange)="pct.set($any($event))"
                   step="1" inputmode="decimal" aria-label="Percentage" />
            <span class="pf-pricing__unit">%</span>
          </div>
          <pf-touch-btn size="sm" variant="secondary" [disabled]="!filtered().length || !pct()" (pressed)="applyBulk()">
            Apply to {{ filtered().length }} filtered
          </pf-touch-btn>
          <span class="pf-pricing__hint">
            {{ scopeLabel() }} · enter a negative % to reduce.
          </span>
        </div>
      </div>

      <!-- ── Scrollable rows ─────────────────────────────────────── -->
      <div class="pf-pricing__scroll px-4 md:px-8">
        @if (loading()) {
          <div class="flex justify-center py-10">
            <pf-skeleton-table [rows]="10" [cols]="4" [header]="false" label="Loading prices…"></pf-skeleton-table>
          </div>
        } @else if (!filtered().length) {
          <pf-tile tone="default" padding="lg" class="block">
            <p class="pf-pricing__empty">No tests match this filter.</p>
          </pf-tile>
        } @else {
          <div class="pf-pricing__head">
            <span class="grow">Test</span>
            <span class="pf-pricing__offer-h">Offered</span>
            <span class="pf-pricing__price-h">Price (₹)</span>
          </div>
          <ul class="pf-pricing__list">
            @for (r of filtered(); track r.id) {
              <li class="nd-row pf-pricing__row" [class.pf-pricing__row--dirty]="isDirty(r.id)"
                  [class.pf-pricing__row--off]="!offeredNow(r.id)">
                <div class="grow min-w-0">
                  <p class="nd-row__name pf-pricing__name">{{ r.name }}</p>
                  <p class="pf-pricing__meta">
                    <span>{{ r.deptName || 'No department' }}</span>
                    @if (!offeredNow(r.id)) {
                      <span class="pf-price-flag pf-price-flag--off">Not offered here</span>
                    }
                  </p>
                </div>
                <div class="pf-pricing__offer">
                  <!-- Kit switch (violet ON). -->
                  <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="offeredNow(r.id)"
                          (click)="setOffered(r.id, !offeredNow(r.id))" [attr.aria-label]="'Offered here: ' + r.name">
                    <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
                  </button>
                </div>
                <div class="pf-pricing__price">
                  <span class="pf-pricing__unit">₹</span>
                  <input type="number" class="nd-input nd-num pf-pricing__price-in" [attr.aria-label]="'Price of ' + r.name" min="0" step="0.01" inputmode="decimal"
                         [ngModel]="edits()[r.id]" (ngModelChange)="setPrice(r.id, $any($event))" />
                </div>
              </li>
            }
          </ul>
          <div class="h-2"></div>
        }
      </div>

      <!-- ── Sticky save bar (only when there are unsaved edits) ──── -->
      <!-- In Test Master's new design the host's BAND carries Save / Discard
           (owner): no separate bar. -->
      @if (dirtyCount() > 0 && !bandActions()) {
        <div class="pf-pricing__savebar">
          <span class="nd-savestate"><span class="nd-savestate__dot" aria-hidden="true"></span>
            <span class="nd-num">{{ dirtyCount() }}</span> unsaved change{{ dirtyCount() === 1 ? '' : 's' }}
          </span>
          <div class="flex items-center gap-2 ml-auto">
            <button type="button" class="nd-btn nd-btn--tertiary press" [disabled]="saving()" (click)="discard()">Discard</button>
            <button type="button" class="nd-btn nd-btn--primary pf-pricing__save press" [disabled]="saving()" (click)="save()">
              @if (saving()) { Saving… } @else { Save changes }
            </button>
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
    .pf-pricing__branch { width: 220px; max-width: 100%; display: inline-block; }
    .pf-pricing__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; margin: 2px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .pf-pricing__offer-h { width: 64px; text-align: center; }
    .pf-pricing__offer { width: 64px; flex: 0 0 auto; display: flex; justify-content: center; }
    .pf-pricing__row--off { opacity: 0.6; }
    .pf-pricing__search { width: 260px; max-width: 100%; }

    .pf-pricing__bulk {
      display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
      padding: 10px 12px; margin-bottom: 12px;
      border: 1px solid var(--nd-line); border-radius: var(--nd-radius);
      background: var(--nd-card-bg);
    }
    .pf-pricing__bulk-k { font-size: 12.5px; font-weight: 600; white-space: nowrap; color: var(--text-primary); }
    .pf-pricing__unit { font-size: 13px; color: var(--text-tertiary); }
    .pf-pricing__hint { font-size: 12px; color: var(--text-tertiary); }
    .pf-pricing__count { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-pricing__empty { text-align: center; font-size: 13px; color: var(--text-tertiary); }
    .pf-pricing__name { margin: 0; font-size: 14px; font-weight: 500; }
    .pf-pricing__pct { width: 74px; text-align: right; }

    .pf-pricing__head {
      display: flex; align-items: center; gap: 12px;
      padding: 0 12px 8px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--text-tertiary); border-bottom: 1px solid var(--nd-line); margin-bottom: 8px;
    }
    .pf-pricing__head .grow { flex: 1; }
    .pf-pricing__price-h { width: 150px; text-align: right; }

    .pf-pricing__list { display: flex; flex-direction: column; gap: 6px; list-style: none; padding: 0; margin: 0; }
    .pf-pricing__row { gap: 12px; }
    /* Edited = the kit's "in" tint (subtle violet) + the neutral selected border. */
    .pf-pricing__row--dirty { border-color: var(--nd-sel-border); background: var(--nd-in-tint); }
    .pf-pricing__price { display: flex; align-items: center; gap: 6px; width: 150px; flex: 0 0 auto; }
    .pf-pricing__price-in { width: 120px; text-align: right; }

    .pf-pricing__savebar {
      flex: 0 0 auto; display: flex; align-items: center; gap: 12px;
      padding-top: 12px; padding-bottom: 12px; margin-top: 4px;
      padding-inline: 14px; border: 1px solid var(--nd-line); border-radius: var(--nd-radius);
      background: var(--nd-card-bg); box-shadow: var(--nd-shadow-sm);
    }

    /* Phone (<=640): the page scrolls naturally; the chrome isn't pinned so the
       list gets full height, and the save bar sticks above the bottom nav. */
    @media (max-width: 640px) {
      .pf-pricing { height: auto; overflow: visible; }
      .pf-pricing__scroll { flex: 0 1 auto; overflow-y: visible; }
      .pf-pricing__dept, .pf-pricing__search, .pf-pricing__branch { width: 100%; }
      .pf-pricing__savebar {
        position: sticky;
        bottom: 8px;   /* the shell already keeps in-flow pages above the navbar */
        border-radius: 14px;
        margin: 8px 0;
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
  private readonly auth = inject(AuthService);
  private readonly pricing = inject(TestPricingService);

  /** When rendered inside another screen (e.g. the Tests "Pricing" tab) hide the
   *  own header and flow naturally instead of the fixed-page / inner-scroll. */
  readonly embedded = input(false);
  /** The host band renders this table's Save (primary) + Discard; the
   *  sticky save bar is not shown (Test Master, new design). */
  readonly bandActions = input(false);
  /** Unsaved price edits: the host (Test Master's band) steps its Create
   *  down so this save bar's "Save changes" is the view's ONE primary. */
  readonly editingChange = output<boolean>();
  private readonly _emitEditing = effect(() => this.editingChange.emit(this.dirtyCount() > 0));

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly search = signal('');
  /** Bound by a host that owns the search (Test Master's band pill); it
   *  replaces the search box here. null = standalone page. */
  readonly bandQuery = input<string | null>(null);
  readonly selectedDeptId = signal<string>('');
  readonly pct = signal<number>(10);

  private readonly _rows = signal<PriceRow[]>([]);
  /** testId → current (possibly edited) price. */
  readonly edits = signal<Record<string, number>>({});
  /** testId → edited "offered here" flag (only rows the user flipped). */
  readonly offeredEdits = signal<Record<string, boolean>>({});

  /** Tenant runs branch isolation → prices are per branch (picker shown). */
  readonly isolationOn = this.pricing.isolationOn;
  /** Viewed pricing scope when isolation is ON: '' = the acting branch,
   *  a branch id, or TENANT_PRICE_SCOPE ("All branches" = tenant default). */
  readonly scope = signal<string>('');

  readonly branchOptions = computed<PfSelectOption[]>(() => [
    { value: TENANT_PRICE_SCOPE, label: 'All branches', hint: 'Tenant default' },
    ...((this.auth.user?.()?.branches ?? []).map(b => ({ value: b.id, label: b.name }))),
  ]);
  /** The picker's shown value ('' resolves to the acting branch). */
  readonly scopeValue = computed(() => this.scope() || (this.auth.activeBranchId?.() ?? TENANT_PRICE_SCOPE));


  private readonly _departments = signal<Department[]>([]);

  readonly deptOptions = computed<PfSelectOption[]>(() => [
    { value: '', label: 'All departments' },
    ...this.dedupeByCode(this._departments()).map(d => ({ value: d.id, label: d.name + (d.code ? ' · ' + d.code : '') })),
  ]);

  readonly filtered = computed<PriceRow[]>(() => {
    const s = (this.bandQuery() ?? this.search()).trim().toLowerCase();
    const dept = this.selectedDeptId();
    return this._rows().filter(r =>
      (!dept || r.deptId === dept) &&
      (!s || r.name.toLowerCase().includes(s))
    );
  });

  readonly dirtyCount = computed(() => {
    const e = this.edits();
    const o = this.offeredEdits();
    return this._rows().reduce((n, r) =>
      n + (this.round2(e[r.id]) !== this.round2(r.orig) || (r.id in o && o[r.id] !== r.offered) ? 1 : 0), 0);
  });

  scopeLabel(): string {
    const dept = this.selectedDeptId();
    const name = this._departments().find(d => d.id === dept)?.name;
    return dept && name ? `Applies to ${name}` : 'Applies to all departments';
  }

  isDirty(id: string): boolean {
    const row = this._rows().find(r => r.id === id);
    if (!row) return false;
    const o = this.offeredEdits();
    return this.round2(this.edits()[id]) !== this.round2(row.orig) || (id in o && o[id] !== row.offered);
  }

  /** Offered here, including an unsaved flip. */
  offeredNow(id: string): boolean {
    const o = this.offeredEdits();
    return id in o ? o[id] : (this._rows().find(r => r.id === id)?.offered ?? true);
  }

  setOffered(id: string, on: boolean) {
    this.offeredEdits.update(o => ({ ...o, [id]: !!on }));
  }

  /** Switch the viewed branch (isolation ON). Unsaved edits are dropped. */
  setScope(v: string) {
    if ((v ?? '') === this.scopeValue()) return;
    this.scope.set(v ?? '');
    this.load();
  }

  /** Branch the save writes: explicit branch when isolation is ON (the acting
   *  branch for ''), null for "All branches" and whenever isolation is OFF. */
  private writeBranchId(): string | null {
    if (!this.isolationOn()) return null;
    const v = this.scopeValue();
    return v && v !== TENANT_PRICE_SCOPE ? v : null;
  }

  ngOnInit() {
    this.pricing.ensureLoaded();
    this.load();
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: list => this._departments.set(list ?? []),
      error: () => { /* dept filter degrades to none */ },
    });
  }

  private load() {
    this.loading.set(true);
    // Isolation ON + a picked scope reads that scope's view; otherwise the
    // plain list (acting branch / tenant price).
    const url = this.isolationOn() && this.scope() ? priceListUrl(this.scope()) : priceListUrl();
    this.api.get<Test[]>(url).subscribe({
      next: list => {
        const rows: PriceRow[] = (list ?? []).map(t => ({
          id: t.id,
          name: t.name,
          deptName: t.department?.name ?? '',
          deptId: t.department?.id ?? t.departmentId ?? '',
          orig: effectivePrice(t),
          notPriced: isPriceDefault(t),
          offered: isOffered(t),
        })).sort((a, b) => (a.deptName || '~').localeCompare(b.deptName || '~') || a.name.localeCompare(b.name));
        this._rows.set(rows);
        this.edits.set(Object.fromEntries(rows.map(r => [r.id, r.orig])));
        this.offeredEdits.set({});
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
    this.offeredEdits.set({});
  }

  async save() {
    const e = this.edits();
    const o = this.offeredEdits();
    const updates: PriceWriteItem[] = [];
    for (const r of this._rows()) {
      const priceChanged = this.round2(e[r.id]) !== this.round2(r.orig);
      const offeredChanged = r.id in o && o[r.id] !== r.offered;
      if (!priceChanged && !offeredChanged) continue;
      const u: PriceWriteItem = { testId: r.id };
      if (priceChanged) u.price = this.round2(e[r.id]);
      if (offeredChanged) u.isOffered = o[r.id];
      updates.push(u);
    }
    if (updates.length === 0) return;
    this.saving.set(true);
    try {
      await firstValueFrom(this.pricing.save(updates, this.writeBranchId()));
      // Commit: new originals become the saved values (a priced row is no
      // longer at the default).
      this._rows.update(rows => rows.map(r => {
        const u = updates.find(x => x.testId === r.id);
        if (!u) return r;
        return {
          ...r,
          orig: u.price ?? r.orig,
          notPriced: u.price != null ? false : r.notPriced,
          offered: u.isOffered ?? r.offered,
        };
      }));
      this.offeredEdits.set({});
      this.toasts.success(`Updated ${updates.length} price${updates.length === 1 ? '' : 's'}`);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
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
