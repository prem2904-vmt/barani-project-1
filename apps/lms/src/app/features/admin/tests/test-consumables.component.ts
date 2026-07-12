import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';

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
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-xl border p-4 mt-5" style="border-color:var(--glass-border);background:var(--glass-bg)">
      <div class="flex items-center justify-between gap-3 mb-1">
        <h3 class="text-sm font-bold" style="color:var(--text-primary)">Consumables</h3>
        <span class="text-[11px]" style="color:var(--text-muted)">used by this test</span>
      </div>
      <p class="text-[13px] mb-3" style="color:var(--text-tertiary)">
        Items consumed per test (tubes, gloves, kits…). Auto-deducted at sample collection; if any is out of stock the test can't be ordered (when inventory is enabled).
      </p>

      @if (!testId()) {
        <p class="text-[13px]" style="color:var(--text-muted)">Save the test first, then add its consumables.</p>
      } @else if (loading()) {
        <p class="text-[13px]" style="color:var(--text-tertiary)">Loading…</p>
      } @else {
        <div class="space-y-2" style="max-width:560px">
          @for (line of lines(); track $index) {
            <div class="flex items-center gap-2">
              <select class="inp" [ngModel]="line.itemId" (ngModelChange)="setLine($index,'itemId',$event)">
                <option value="">Item…</option>
                @for (it of items(); track it.id) { <option [value]="it.id">{{ it.name }} ({{ it.uom }})</option> }
              </select>
              <input class="inp" style="width:110px" type="number" min="0" step="0.001" [ngModel]="line.qtyPerTest" (ngModelChange)="setLine($index,'qtyPerTest',+$event)" placeholder="qty/test"/>
              <button type="button" class="text-sm px-2" style="color:var(--red)" (click)="removeLine($index)">✕</button>
            </div>
          }
          @if (!items().length) {
            <p class="text-[13px]" style="color:var(--text-muted)">No inventory items yet — add them under Admin → Inventory first.</p>
          }
          <div class="flex gap-3 pt-1">
            <button type="button" class="text-xs font-semibold" style="color:var(--violet-400)" [disabled]="!items().length" (click)="addLine()">+ Add item</button>
          </div>
          <button type="button" class="mt-2 px-3 py-2 rounded-lg text-sm font-bold text-white" style="background:var(--violet-600,#7c3aed)" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save consumables' }}
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .inp { flex:1; padding:7px 10px; border-radius:9px; background:var(--bg-card-solid,#14141f); border:1px solid var(--glass-border); color:var(--text-primary); font-size:13px; }
    .inp:focus { outline:none; border-color:var(--violet-500,#8b5cf6); }
  `]
})
export class TestConsumablesComponent {
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);

  readonly testId = input<string | null>(null);
  readonly items = signal<InvItem[]>([]);
  readonly lines = signal<{ itemId: string; qtyPerTest: number }[]>([]);
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
    this.loading.set(false);
  }

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
      this.toasts.success('Consumables saved');
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    this.saving.set(false);
  }
}
