import { stableJson } from '../../../shared/utils/dirty-snapshot';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';

interface InvItem { id: string; name: string; uom: string; }

/**
 * Per-test consumable editor embedded in the test editor: map which inventory
 * items a test uses (item + qty). Drives FEFO auto-deduction at collection and
 * the "can't order if kit isn't in stock" gate. Only rendered for users with
 * manage_inventory. Requires the test to be saved (needs a real id).
 */
@Component({
  selector: 'pf-test-consumables',
  standalone: true,
  imports: [SkeletonRowsComponent, BusyDirective, FormsModule, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-tc">
      <p class="pf-tc__hint">
        Items consumed per test (tubes, gloves, kits…). Auto-deducted at sample collection; if any is out of stock the test can't be ordered (when inventory is enabled).
      </p>

      @if (!testId()) {
        <p class="pf-tc__hint">Save the test first, then add its consumables.</p>
      } @else if (loading()) {
        <pf-skeleton-rows [rows]="3" [dense]="true" [avatar]="false" label="Loading consumables…"></pf-skeleton-rows>
      } @else {
        <div class="pf-tc__list">
          @for (line of lines(); track $index) {
            <div class="pf-row pf-tc__row">
              <pf-select class="pf-tc__item" [options]="itemOptions()" [searchable]="true" [value]="line.itemId || null"
                         placeholder="Item…" (valueChange)="setLine($index, 'itemId', $any($event) ?? '')"></pf-select>
              <input class="pf-input pf-num pf-tc__qty" type="number" min="0" step="0.001" inputmode="decimal"
                     [ngModel]="line.qtyPerTest" (ngModelChange)="setLine($index, 'qtyPerTest', +$event)"
                     placeholder="qty / test" aria-label="Quantity per test" />
              <button type="button" class="pf-tc__x press" (click)="removeLine($index)" aria-label="Remove item" title="Remove item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
          }
          @if (!items().length) {
            <p class="pf-tc__hint">No inventory items yet — add them under Admin → Inventory first.</p>
          }
          <div class="pf-tc__acts">
            <button type="button" class="pf-btn pf-btn--tertiary press" [disabled]="!items().length" (click)="addLine()">+ Add item</button>
            <!-- Secondary: the editor's band owns the ONE primary (Save). -->
            <button type="button" class="pf-btn pf-btn--secondary press" [disabled]="saving() || !changed()" [pfBusyInactive]="saving() || !changed()" [attr.title]="changed() || saving() ? null : 'No changes to save'"
                    [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">
              {{ saving() ? 'Saving…' : 'Save consumables' }}
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .pf-tc { display: flex; flex-direction: column; gap: 12px; }
    .pf-tc__hint { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-tertiary); max-width: 640px; }
    .pf-tc__list { display: flex; flex-direction: column; gap: 8px; max-width: 640px; }
    .pf-tc__row { gap: 8px; padding: 6px 8px; }
    .pf-tc__item { flex: 1 1 auto; min-width: 0; }
    .pf-tc__qty { width: 120px; flex: none; text-align: right; }
    .pf-tc__x { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 36px; height: 36px;
      border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .pf-tc__x:hover { color: var(--red-text, #b91c1c); border-color: var(--pf-line); }
    .pf-tc__acts { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 4px; }
    @media (max-width: 640px) { .pf-tc__row { flex-wrap: wrap; } .pf-tc__qty { flex: 1 1 auto; width: auto; } }
  `]
})
export class TestConsumablesComponent {
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);

  readonly testId = input<string | null>(null);
  readonly items = signal<InvItem[]>([]);
  readonly lines = signal<{ itemId: string; qtyPerTest: number }[]>([]);
  /** pf-select options (no native select): "Name (uom)". */
  readonly itemOptions = computed<PfSelectOption[]>(() =>
    this.items().map(it => ({ value: it.id, label: `${it.name} (${it.uom})` })));
  readonly loading = signal(true);
  readonly saving = signal(false);

  constructor() { queueMicrotask(() => this.load()); }

  private async load() {
    const id = this.testId();
    this.loading.set(true);
    try {
      this.items.set(await firstValueFrom(this.http.get<any>(`${environment.apiUrl}/api/inventory/items`)).then(r => r?.data ?? []));
      if (id) {
        const rows = await firstValueFrom(this.http.get<any>(`${environment.apiUrl}/api/inventory/tests/${id}/consumables`)).then(r => r?.data ?? []);
        this.lines.set(rows.map((x: any) => ({ itemId: x.itemId, qtyPerTest: x.qtyPerTest })));
      }
    } catch { /* inventory may be unconfigured */ }
    this.savedLines.set(stableJson(this.lines()));
    this.loading.set(false);
  }
  /** Save only when something changed (owner 2026-11-19): the lines compared with the loaded / last saved ones. */
  private readonly savedLines = signal('[]');
  readonly changed = computed(() => stableJson(this.lines()) !== this.savedLines());

  addLine() { this.lines.update(l => [...l, { itemId: '', qtyPerTest: 1 }]); }
  removeLine(i: number) { this.lines.update(l => l.filter((_, idx) => idx !== i)); }
  setLine(i: number, field: 'itemId' | 'qtyPerTest', value: unknown) {
    this.lines.update(l => l.map((ln, idx) => idx === i ? { ...ln, [field]: value } : ln));
  }
  async save() {
    const id = this.testId(); if (!id) return;
    this.saving.set(true);
    try {
      const lines = this.lines().filter(l => l.itemId && l.qtyPerTest > 0);
      await firstValueFrom(this.http.put(`${environment.apiUrl}/api/inventory/tests/${id}/consumables`, { lines }));
      this.savedLines.set(stableJson(this.lines()));
      this.toasts.success('Consumables saved');
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    this.saving.set(false);
  }
}
