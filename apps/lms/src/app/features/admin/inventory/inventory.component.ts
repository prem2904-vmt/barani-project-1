import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';

interface InvItem {
  id: string; sku: string; name: string; category: string; uom: string;
  reorderLevel: number; nearExpiryDays: number; isActive: boolean; onHand: number; lowStock: boolean;
}
interface InvBatch {
  id: string; lotNumber?: string | null; expiryDate?: string | null; unitCost: number;
  qtyReceived: number; qtyOnHand: number; receivedAt: string; expired: boolean;
}
const CATEGORIES = ['consumable', 'reagent', 'kit', 'disposable'];

/** Lab inventory admin: items + on-hand, goods-receipt, batches, adjustments, alerts. */
@Component({
  selector: 'pf-inventory',
  standalone: true,
  imports: [FormsModule, DecimalPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-6xl">
      <div class="flex items-center justify-between gap-3 mb-5">
        <div>
          <div class="text-[11px] font-bold uppercase tracking-wider" style="color:var(--violet-400)">Admin · Lab</div>
          <h1 class="text-2xl font-extrabold" style="color:var(--text-primary)">Inventory</h1>
          <p class="text-sm" style="color:var(--text-tertiary)">Stock for the active branch. Usage is auto-deducted per test at sample collection.</p>
        </div>
        <button class="px-4 py-2 rounded-xl text-sm font-bold text-white" style="background:var(--violet-600,#7c3aed)" (click)="startNew()">New item</button>
      </div>

      <!-- Alerts -->
      @if (lowStock().length || expiring().length) {
        <div class="grid md:grid-cols-2 gap-3 mb-5">
          <div class="p-4 rounded-xl border" style="background:var(--glass-bg);border-color:var(--glass-border)">
            <div class="text-[11px] font-bold uppercase tracking-wider mb-2" style="color:var(--amber,#f59e0b)">Low stock ({{ lowStock().length }})</div>
            @for (l of lowStock(); track l.id) {
              <div class="flex justify-between text-sm py-0.5"><span>{{ l.name }}</span><span class="font-mono" style="color:var(--text-tertiary)">{{ l.onHand | number:'1.0-2' }} / {{ l.reorderLevel | number:'1.0-2' }}</span></div>
            } @empty { <p class="text-sm" style="color:var(--text-muted)">All good.</p> }
          </div>
          <div class="p-4 rounded-xl border" style="background:var(--glass-bg);border-color:var(--glass-border)">
            <div class="text-[11px] font-bold uppercase tracking-wider mb-2" style="color:var(--red,#ef4444)">Expiring soon ({{ expiring().length }})</div>
            @for (e of expiring(); track e.id) {
              <div class="flex justify-between text-sm py-0.5"><span>{{ e.item }} <span style="color:var(--text-muted)">{{ e.lotNumber }}</span></span><span class="font-mono" [style.color]="e.daysLeft < 0 ? 'var(--red)' : 'var(--text-tertiary)'">{{ e.daysLeft < 0 ? 'expired' : e.daysLeft + 'd' }}</span></div>
            } @empty { <p class="text-sm" style="color:var(--text-muted)">Nothing expiring.</p> }
          </div>
        </div>
      }

      <!-- Edit / new item -->
      @if (editing()) {
        <div class="p-4 rounded-xl border mb-5" style="background:var(--bg-card-solid);border-color:var(--glass-border-hover)">
          <div class="text-sm font-bold mb-3">{{ form().id ? 'Edit item' : 'New item' }}</div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label class="block"><span class="lbl">SKU *</span><input class="inp" [ngModel]="form().sku" (ngModelChange)="setF('sku',$event)"/></label>
            <label class="block md:col-span-2"><span class="lbl">Name *</span><input class="inp" [ngModel]="form().name" (ngModelChange)="setF('name',$event)"/></label>
            <label class="block"><span class="lbl">Category</span>
              <select class="inp" [ngModel]="form().category" (ngModelChange)="setF('category',$event)">
                @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
              </select>
            </label>
            <label class="block"><span class="lbl">Unit (UoM)</span><input class="inp" [ngModel]="form().uom" (ngModelChange)="setF('uom',$event)" placeholder="piece"/></label>
            <label class="block"><span class="lbl">Reorder level</span><input class="inp" type="number" [ngModel]="form().reorderLevel" (ngModelChange)="setF('reorderLevel',+$event)"/></label>
            <label class="block"><span class="lbl">Near-expiry (days)</span><input class="inp" type="number" [ngModel]="form().nearExpiryDays" (ngModelChange)="setF('nearExpiryDays',+$event)"/></label>
            <label class="flex items-center gap-2 mt-5"><input type="checkbox" [ngModel]="form().isActive" (ngModelChange)="setF('isActive',$event)"/><span class="text-sm">Active</span></label>
          </div>
          <div class="flex gap-2 mt-4">
            <button class="px-3 py-2 rounded-lg text-sm font-bold text-white" style="background:var(--violet-600,#7c3aed)" [disabled]="!canSave()" (click)="saveItem()">Save</button>
            <button class="px-3 py-2 rounded-lg text-sm" style="background:var(--glass-bg)" (click)="editing.set(false)">Cancel</button>
          </div>
        </div>
      }

      <!-- Items -->
      @if (loading()) { <p class="text-sm" style="color:var(--text-tertiary)">Loading…</p> }
      @else {
        <div class="rounded-xl border overflow-hidden" style="border-color:var(--glass-border)">
          <table class="w-full text-sm">
            <thead><tr style="background:var(--glass-bg);color:var(--text-muted)">
              <th class="text-left p-3">Item</th><th class="text-left p-3">Category</th>
              <th class="text-right p-3">On hand</th><th class="text-right p-3">Reorder</th><th class="p-3"></th>
            </tr></thead>
            <tbody>
              @for (it of items(); track it.id) {
                <tr style="border-top:1px solid var(--glass-border)">
                  <td class="p-3"><b>{{ it.name }}</b> <span class="font-mono text-xs" style="color:var(--text-muted)">{{ it.sku }}</span>
                    @if (it.lowStock) { <span class="ml-2 text-[10px] px-2 py-0.5 rounded-full" style="background:rgba(245,158,11,.15);color:var(--amber,#f59e0b)">low</span> }
                  </td>
                  <td class="p-3" style="color:var(--text-tertiary)">{{ it.category }}</td>
                  <td class="p-3 text-right font-mono">{{ it.onHand | number:'1.0-2' }} <span style="color:var(--text-muted)">{{ it.uom }}</span></td>
                  <td class="p-3 text-right font-mono" style="color:var(--text-muted)">{{ it.reorderLevel | number:'1.0-2' }}</td>
                  <td class="p-3 text-right whitespace-nowrap">
                    <button class="text-xs font-semibold mr-3" style="color:var(--violet-400)" (click)="openReceive(it)">Receive</button>
                    <button class="text-xs font-semibold mr-3" style="color:var(--text-tertiary)" (click)="toggleBatches(it)">Batches</button>
                    <button class="text-xs font-semibold" style="color:var(--text-tertiary)" (click)="startEdit(it)">Edit</button>
                  </td>
                </tr>
                @if (expandedId() === it.id) {
                  <tr style="background:var(--glass-bg)"><td colspan="5" class="p-3">
                    @if (receiveFor() === it.id) {
                      <div class="flex flex-wrap items-end gap-2 mb-3 p-3 rounded-lg" style="background:var(--bg-card-solid)">
                        <label class="block"><span class="lbl">Lot #</span><input class="inp" [ngModel]="rcv().lot" (ngModelChange)="setR('lot',$event)"/></label>
                        <label class="block"><span class="lbl">Expiry</span><input class="inp" type="date" [ngModel]="rcv().expiry" (ngModelChange)="setR('expiry',$event)"/></label>
                        <label class="block"><span class="lbl">Unit cost</span><input class="inp" type="number" [ngModel]="rcv().cost" (ngModelChange)="setR('cost',+$event)"/></label>
                        <label class="block"><span class="lbl">Qty *</span><input class="inp" type="number" [ngModel]="rcv().qty" (ngModelChange)="setR('qty',+$event)"/></label>
                        <button class="px-3 py-2 rounded-lg text-sm font-bold text-white" style="background:var(--green,#10b981)" [disabled]="rcv().qty<=0" (click)="receive(it)">Add stock</button>
                      </div>
                    }
                    <div class="text-[11px] font-bold uppercase tracking-wider mb-1" style="color:var(--text-muted)">Batches (FEFO)</div>
                    @for (b of batches(); track b.id) {
                      <div class="flex items-center justify-between text-sm py-1 border-b" style="border-color:var(--glass-border)">
                        <span>{{ b.lotNumber || '—' }} <span style="color:var(--text-muted)">exp {{ b.expiryDate ? (b.expiryDate | date) : '—' }}</span>
                          @if (b.expired) { <span class="ml-1 text-[10px]" style="color:var(--red)">expired</span> }</span>
                        <span class="flex items-center gap-3 font-mono">
                          <span>{{ b.qtyOnHand | number:'1.0-2' }}</span>
                          <button class="text-xs" style="color:var(--text-tertiary)" (click)="adjust(b, -1)">−</button>
                          <button class="text-xs" style="color:var(--text-tertiary)" (click)="adjust(b, 1)">＋</button>
                        </span>
                      </div>
                    } @empty { <p class="text-sm" style="color:var(--text-muted)">No batches yet — receive stock.</p> }
                  </td></tr>
                }
              } @empty {
                <tr><td colspan="5" class="p-6 text-center" style="color:var(--text-muted)">No items yet. Add your first SKU.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: [`
    .lbl { display:block; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:var(--text-muted); margin-bottom:3px; }
    .inp { width:100%; padding:7px 10px; border-radius:9px; background:var(--glass-bg); border:1px solid var(--glass-border); color:var(--text-primary); font-size:13px; }
    .inp:focus { outline:none; border-color:var(--violet-500,#8b5cf6); }
  `]
})
export class InventoryComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  readonly categories = CATEGORIES;

  readonly items = signal<InvItem[]>([]);
  readonly batches = signal<InvBatch[]>([]);
  readonly loading = signal(true);
  readonly editing = signal(false);
  readonly expandedId = signal<string | null>(null);
  readonly receiveFor = signal<string | null>(null);

  readonly lowStock = signal<any[]>([]);
  readonly expiring = signal<any[]>([]);

  readonly form = signal<Partial<InvItem>>({});
  readonly rcv = signal<{ lot: string; expiry: string; cost: number; qty: number }>({ lot: '', expiry: '', cost: 0, qty: 0 });

  readonly canSave = computed(() => !!this.form().sku?.trim() && !!this.form().name?.trim());

  async ngOnInit() { await Promise.all([this.load(), this.loadAlerts()]); }

  private async load() {
    this.loading.set(true);
    try { this.items.set(await firstValueFrom(this.api.get<InvItem[]>('/api/inventory/items')) ?? []); }
    catch { /* */ }
    this.loading.set(false);
  }
  private async loadAlerts() {
    try {
      const a = await firstValueFrom(this.api.get<any>('/api/inventory/alerts'));
      this.lowStock.set(a?.lowStock ?? []); this.expiring.set(a?.expiring ?? []);
    } catch { /* */ }
  }

  setF(k: string, v: unknown) { this.form.update(f => ({ ...f, [k]: v })); }
  setR(k: string, v: unknown) { this.rcv.update(r => ({ ...r, [k]: v })); }

  startNew() { this.form.set({ category: 'consumable', uom: 'piece', reorderLevel: 0, nearExpiryDays: 30, isActive: true }); this.editing.set(true); }
  startEdit(it: InvItem) { this.form.set({ ...it }); this.editing.set(true); }

  async saveItem() {
    if (!this.canSave()) return;
    try {
      await firstValueFrom(this.api.post('/api/inventory/items', this.form()));
      this.editing.set(false); this.toasts.success('Item saved'); await this.load(); await this.loadAlerts();
    } catch { this.toasts.error('Save failed'); }
  }

  async toggleBatches(it: InvItem) {
    if (this.expandedId() === it.id) { this.expandedId.set(null); return; }
    this.expandedId.set(it.id); this.receiveFor.set(null);
    await this.loadBatches(it.id);
  }
  openReceive(it: InvItem) {
    this.expandedId.set(it.id); this.receiveFor.set(it.id);
    this.rcv.set({ lot: '', expiry: '', cost: 0, qty: 0 });
    this.loadBatches(it.id);
  }
  private async loadBatches(itemId: string) {
    try { this.batches.set(await firstValueFrom(this.api.get<InvBatch[]>(`/api/inventory/items/${itemId}/batches`)) ?? []); }
    catch { this.batches.set([]); }
  }

  async receive(it: InvItem) {
    const r = this.rcv();
    if (r.qty <= 0) return;
    try {
      await firstValueFrom(this.api.post(`/api/inventory/items/${it.id}/receive`, {
        lotNumber: r.lot || null, expiryDate: r.expiry ? r.expiry + 'T00:00:00Z' : null, unitCost: r.cost, qty: r.qty,
      }));
      this.toasts.success('Stock received'); this.receiveFor.set(null);
      await Promise.all([this.loadBatches(it.id), this.load(), this.loadAlerts()]);
    } catch { this.toasts.error('Receive failed'); }
  }

  async adjust(b: InvBatch, delta: number) {
    try {
      await firstValueFrom(this.api.post(`/api/inventory/batches/${b.id}/adjust`, { delta, reason: delta < 0 ? 'manual decrement' : 'manual increment' }));
      const id = this.expandedId(); if (id) await Promise.all([this.loadBatches(id), this.load(), this.loadAlerts()]);
    } catch { this.toasts.error('Adjust failed'); }
  }
}
