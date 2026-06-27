import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { printLabelOnly } from '../../../shared/utils/print-label';

type LabelMode = 'both' | 'barcode' | 'qr';

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
  imports: [FormsModule, DecimalPipe, DatePipe, BarcodeDisplayComponent],
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
              <div class="flex justify-between text-sm py-0.5 alert-row"><span class="alert-row__name">{{ l.name }}</span><span class="font-mono" style="color:var(--text-tertiary)">{{ l.onHand | number:'1.0-2' }} / {{ l.reorderLevel | number:'1.0-2' }}</span></div>
            } @empty { <p class="text-sm" style="color:var(--text-muted)">All good.</p> }
          </div>
          <div class="p-4 rounded-xl border" style="background:var(--glass-bg);border-color:var(--glass-border)">
            <div class="text-[11px] font-bold uppercase tracking-wider mb-2" style="color:var(--red,#ef4444)">Expiring soon ({{ expiring().length }})</div>
            @for (e of expiring(); track e.id) {
              <div class="flex justify-between text-sm py-0.5 alert-row"><span class="alert-row__name">{{ e.item }} <span style="color:var(--text-muted)">{{ e.lotNumber }}</span></span><span class="font-mono" [style.color]="e.daysLeft < 0 ? 'var(--red)' : 'var(--text-tertiary)'">{{ e.daysLeft < 0 ? 'expired' : e.daysLeft + 'd' }}</span></div>
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
        <div class="rounded-xl border overflow-hidden inv-table-wrap" style="border-color:var(--glass-border)">
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
                    <button class="rowbtn rowbtn--accent" (click)="openReceive(it)">Receive</button>
                    <button class="rowbtn" (click)="showLabel(it)">Label</button>
                    <button class="rowbtn" (click)="toggleBatches(it)">Batches</button>
                    <button class="rowbtn" (click)="startEdit(it)">Edit</button>
                  </td>
                </tr>
                @if (expandedId() === it.id) {
                  <tr style="background:var(--glass-bg)"><td colspan="5" class="p-3">
                    @if (receiveFor() === it.id) {
                      <div class="flex flex-wrap items-end gap-2 mb-3 p-3 rounded-lg rcv-form" style="background:var(--bg-card-solid)">
                        <label class="block"><span class="lbl">Lot #</span><input class="inp" [ngModel]="rcv().lot" (ngModelChange)="setR('lot',$event)"/></label>
                        <label class="block"><span class="lbl">Expiry</span><input class="inp" type="date" [ngModel]="rcv().expiry" (ngModelChange)="setR('expiry',$event)"/></label>
                        <label class="block"><span class="lbl">Unit cost</span><input class="inp" type="number" [ngModel]="rcv().cost" (ngModelChange)="setR('cost',+$event)"/></label>
                        <label class="block"><span class="lbl">Qty *</span><input class="inp" type="number" [ngModel]="rcv().qty" (ngModelChange)="setR('qty',+$event)"/></label>
                        <button class="px-3 py-2 rounded-lg text-sm font-bold text-white" style="background:var(--green,#10b981)" [disabled]="rcv().qty<=0" (click)="receive(it)">Add stock</button>
                      </div>
                    }

                    <!-- Barcode / QR label generator -->
                    @if (labelCode() && expandedId() === it.id) {
                      <div class="label-wrap">
                        <div class="label-wrap__head">
                          <span class="text-[11px] font-bold uppercase tracking-wider" style="color:var(--text-muted)">Label</span>
                          <div class="seg">
                            <button class="seg__i" [class.seg__i--on]="labelMode()==='both'" (click)="labelMode.set('both')">Both</button>
                            <button class="seg__i" [class.seg__i--on]="labelMode()==='barcode'" (click)="labelMode.set('barcode')">Barcode</button>
                            <button class="seg__i" [class.seg__i--on]="labelMode()==='qr'" (click)="labelMode.set('qr')">QR</button>
                          </div>
                        </div>
                        <div class="label-print pf-print-label">
                          <pf-barcode-display [code]="labelCode()!" [mode]="labelMode()" [showValue]="true"></pf-barcode-display>
                        </div>
                        <div class="flex gap-3 mt-2">
                          <button class="rowbtn rowbtn--accent" (click)="printLabel()">Print label</button>
                          <button class="rowbtn" (click)="labelCode.set(null)">Hide</button>
                        </div>
                      </div>
                    }

                    <div class="text-[11px] font-bold uppercase tracking-wider mb-1" style="color:var(--text-muted)">Batches (FEFO)</div>
                    @for (b of batches(); track b.id) {
                      <div class="flex items-center justify-between text-sm py-1 border-b" style="border-color:var(--glass-border)">
                        <span>{{ b.lotNumber || '—' }} <span style="color:var(--text-muted)">exp {{ b.expiryDate ? (b.expiryDate | date) : '—' }}</span>
                          @if (b.expired) { <span class="ml-1 text-[10px]" style="color:var(--red)">expired</span> }</span>
                        <span class="flex items-center gap-3 font-mono">
                          <span>{{ b.qtyOnHand | number:'1.0-2' }}</span>
                          <button class="text-xs iconbtn" style="color:var(--text-tertiary)" (click)="adjust(b, -1)">−</button>
                          <button class="text-xs iconbtn" style="color:var(--text-tertiary)" (click)="adjust(b, 1)">＋</button>
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

      <!-- Per-test consumables (BOM) — drives auto-deduction at collection -->
      <div class="mt-8 p-4 rounded-xl border" style="background:var(--glass-bg);border-color:var(--glass-border)">
        <div class="text-sm font-bold mb-1" style="color:var(--text-primary)">Per-test consumables</div>
        <p class="text-sm mb-3" style="color:var(--text-tertiary)">Map which items a test consumes. These are auto-deducted (FEFO) from this branch's stock when a sample is collected.</p>
        <select class="inp" style="max-width:340px" [ngModel]="bomTestId()" (ngModelChange)="selectTest($event)">
          <option value="">Select a test…</option>
          @for (t of tests(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }
        </select>

        @if (bomTestId()) {
          <div class="mt-3 space-y-2" style="max-width:560px">
            @for (line of bomLines(); track $index) {
              <div class="flex items-center gap-2 bom-line">
                <select class="inp bom-line__item" [ngModel]="line.itemId" (ngModelChange)="setLine($index,'itemId',$event)">
                  <option value="">Item…</option>
                  @for (it of items(); track it.id) { <option [value]="it.id">{{ it.name }} ({{ it.uom }})</option> }
                </select>
                <input class="inp bom-line__qty" style="width:110px" type="number" min="0" step="0.001" [ngModel]="line.qtyPerTest" (ngModelChange)="setLine($index,'qtyPerTest',+$event)" placeholder="qty/test"/>
                <button class="text-sm px-2 iconbtn" style="color:var(--red)" (click)="removeLine($index)">✕</button>
              </div>
            }
            <div class="flex gap-2 pt-1">
              <button class="text-xs font-semibold touch-link" style="color:var(--violet-400)" (click)="addLine()">+ Add item</button>
            </div>
            <button class="mt-2 px-3 py-2 rounded-lg text-sm font-bold text-white" style="background:var(--violet-600,#7c3aed)" [disabled]="bomSaving()" (click)="saveBom()">{{ bomSaving() ? 'Saving…' : 'Save consumables' }}</button>
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    .lbl { display:block; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:var(--text-muted); margin-bottom:4px; }
    .inp { width:100%; padding:9px 11px; border-radius:10px; background:var(--glass-bg); border:1px solid var(--glass-border); color:var(--text-primary); font-size:13.5px; }
    .inp:focus { outline:none; border-color:var(--violet-500,#8b5cf6); box-shadow:0 0 0 3px rgba(124,58,237,.16); }
    table tbody tr:hover td { background:rgba(139,92,246,.06); }
    thead th { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
    .rowbtn { font-size:12px; font-weight:700; padding:5px 10px; border-radius:8px; margin-left:6px; border:1px solid var(--glass-border); background:var(--glass-bg); color:var(--text-secondary); transition:color .14s, border-color .14s; }
    .rowbtn:hover { color:var(--text-primary); border-color:var(--glass-border-hover); }
    .rowbtn--accent { color:var(--violet-300); border-color:rgba(124,58,237,.4); background:rgba(124,58,237,.12); }
    .seg { display:inline-flex; gap:2px; padding:2px; border-radius:8px; border:1px solid var(--glass-border); background:var(--glass-bg); }
    .seg__i { font-size:11px; font-weight:700; padding:4px 10px; border-radius:6px; border:0; background:transparent; color:var(--text-tertiary); }
    .seg__i--on { color:#fff; background:var(--gradient-primary); }
    .label-wrap { margin:4px 0 14px; padding:14px; border-radius:12px; border:1px solid var(--glass-border-hover); background:var(--bg-card-solid); }
    .label-wrap__head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; }
    .label-print { display:inline-block; padding:12px; border-radius:12px; background:#fff; }

    /* ---------- Cross-platform additive overrides (do not touch desktop >=1280) ---------- */

    /* The items table is dense (4 row actions + numeric columns). Below desktop, let it
       scroll horizontally inside its own card instead of forcing page-wide overflow. */
    @media (max-width: 1279px) {
      :host .inv-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      :host .inv-table-wrap table { min-width: 640px; }
    }

    /* Phone: keep inputs at >=16px so iOS doesn't zoom on focus. Slightly larger
       row-action tap targets. Reduce wasted horizontal padding so the table fits.
       Let the header "New item" button keep its size and wrap the BOM line. */
    @media (max-width: 640px) {
      :host .inp { font-size: 16px; padding: 11px 12px; }
      :host .rowbtn { padding: 9px 12px; }
      :host .label-wrap__head { flex-wrap: wrap; }
      /* BOM editor row: stop the two selects + qty input from crushing each other.
         Let the item select take the row, with qty + remove sitting beside it. */
      :host .bom-line { flex-wrap: wrap; }
      :host .bom-line__item { flex: 1 1 100%; min-width: 0; }
      :host .bom-line__qty { width: 120px !important; }
      /* Goods-receipt inline form: stack Lot/Expiry/Cost/Qty single-column so the
         content-sized inputs don't crowd; the "Add stock" button drops below. */
      :host .rcv-form > label { flex: 1 1 100%; min-width: 0; }
    }

    /* The item select is a flex child whose option text can be long; allow it to
       shrink instead of overflowing the BOM row at any width below desktop.
       Same for alert rows: gap + min-width:0 so a long item/lot name truncates
       instead of colliding with the right-aligned mono value. */
    @media (max-width: 1279px) {
      :host .bom-line__item { min-width: 0; }
      :host .alert-row { gap: 12px; }
      :host .alert-row__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    }

    /* Touch devices (any width): give every interactive element a comfortable
       >=44px hit area without changing the visual padding on hover/pointer devices. */
    @media (pointer: coarse) {
      :host .rowbtn { min-height: 44px; display: inline-flex; align-items: center; }
      :host .seg__i { min-height: 44px; display: inline-flex; align-items: center; }
      /* Icon-only batch +/- and remove-line ✕ buttons need a real hit area. */
      :host .iconbtn { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }
      /* Primary/secondary padded action buttons (New item, Save, Cancel, Add stock,
         Save consumables) — guarantee a 44px tall hit target on touch. */
      :host button.rounded-xl, :host button.rounded-lg {
        min-height: 44px; display: inline-flex; align-items: center; justify-content: center;
      }
      /* Inline text actions ("+ Add item") get a tappable height without changing look. */
      :host .touch-link { min-height: 44px; display: inline-flex; align-items: center; }
    }

    /* Hover affordances only where a real pointer exists (prevents sticky :hover on touch). */
    @media (hover: none) {
      :host table tbody tr:hover td { background: transparent; }
      :host .rowbtn:hover { color: var(--text-secondary); border-color: var(--glass-border); }
    }
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

  // Printable barcode/QR label — set after a receive (the lot barcode) or via
  // the per-item "Label" action. `labelMode` lets the operator pick the symbology.
  readonly labelCode = signal<string | null>(null);
  readonly labelMode = signal<LabelMode>('both');

  readonly canSave = computed(() => !!this.form().sku?.trim() && !!this.form().name?.trim());

  // Per-test consumable BOM
  readonly tests = signal<{ id: string; name: string }[]>([]);
  readonly bomTestId = signal('');
  readonly bomLines = signal<{ itemId: string; qtyPerTest: number }[]>([]);
  readonly bomSaving = signal(false);

  async ngOnInit() { await Promise.all([this.load(), this.loadAlerts(), this.loadTests()]); }

  private async loadTests() {
    try { this.tests.set(await firstValueFrom(this.api.get<{ id: string; name: string }[]>('/api/tests/')) ?? []); }
    catch { /* */ }
  }

  async selectTest(id: string) {
    this.bomTestId.set(id);
    this.bomLines.set([]);
    if (!id) return;
    try {
      const rows = await firstValueFrom(this.api.get<any[]>(`/api/inventory/tests/${id}/consumables`)) ?? [];
      this.bomLines.set(rows.map(r => ({ itemId: r.itemId, qtyPerTest: r.qtyPerTest })));
    } catch { /* */ }
  }
  addLine() { this.bomLines.update(l => [...l, { itemId: '', qtyPerTest: 1 }]); }
  removeLine(i: number) { this.bomLines.update(l => l.filter((_, idx) => idx !== i)); }
  setLine(i: number, field: 'itemId' | 'qtyPerTest', value: unknown) {
    this.bomLines.update(l => l.map((ln, idx) => idx === i ? { ...ln, [field]: value } : ln));
  }
  async saveBom() {
    const id = this.bomTestId(); if (!id) return;
    this.bomSaving.set(true);
    try {
      const lines = this.bomLines().filter(l => l.itemId && l.qtyPerTest > 0);
      await firstValueFrom(this.api.put(`/api/inventory/tests/${id}/consumables`, { lines }));
      this.toasts.success('Consumables saved');
    } catch { this.toasts.error('Save failed'); }
    this.bomSaving.set(false);
  }

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
  /** Show a printable barcode/QR label for the item itself (its barcode, or SKU
   *  as a fallback). The lot label is shown automatically after a receive. */
  showLabel(it: InvItem) {
    this.expandedId.set(it.id);
    this.labelCode.set((it as any).barcode || it.sku || it.id);
    this.loadBatches(it.id);
  }
  printLabel() { printLabelOnly(); }
  private async loadBatches(itemId: string) {
    try { this.batches.set(await firstValueFrom(this.api.get<InvBatch[]>(`/api/inventory/items/${itemId}/batches`)) ?? []); }
    catch { this.batches.set([]); }
  }

  async receive(it: InvItem) {
    const r = this.rcv();
    if (r.qty <= 0) return;
    try {
      const res: any = await firstValueFrom(this.api.post(`/api/inventory/items/${it.id}/receive`, {
        lotNumber: r.lot || null, expiryDate: r.expiry ? r.expiry + 'T00:00:00Z' : null, unitCost: r.cost, qty: r.qty,
      }));
      this.toasts.success('Stock received'); this.receiveFor.set(null);
      // Surface the freshly-minted lot barcode so the operator can print a label.
      if (res?.lotBarcode) this.labelCode.set(res.lotBarcode);
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
