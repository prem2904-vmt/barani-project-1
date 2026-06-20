import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/auth/auth.service';
import { BarcodeDisplayComponent } from '../../shared/components/barcode-display/barcode-display.component';
import { BarcodeScannerModalComponent } from '../../shared/components/barcode-scanner/barcode-scanner-modal.component';

interface InvItem { id: string; sku: string; barcode?: string; name: string; uom: string; onHand: number; lowStock: boolean; reorderLevel: number; }
interface InvBatch { id: string; lotNumber?: string; lotBarcode?: string; expiryDate?: string; qtyOnHand: number; expired: boolean; }
type Mode = 'home' | 'receive' | 'issue' | 'count';

/**
 * Stores operator work area — scan-first. A store keeper scans a supplier/GS1
 * barcode (HID gun → focused input, or camera) to receive stock (lot/expiry/qty
 * auto-parsed), issue/consume FEFO, or cycle-count a lot. Catalog config (items,
 * per-test BOM, enable switch) stays in Admin → Inventory.
 */
@Component({
  selector: 'pf-stores',
  standalone: true,
  imports: [FormsModule, DecimalPipe, DatePipe, BarcodeDisplayComponent, BarcodeScannerModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-12 max-w-5xl">
      <div class="flex items-center justify-between gap-3 mb-4">
        <div>
          <div class="text-[11px] font-bold uppercase tracking-wider" style="color:var(--violet-400)">Stores · {{ branchName() }}</div>
          <h1 class="text-2xl font-extrabold" style="color:var(--text-primary)">Inventory desk</h1>
        </div>
        @if (mode() !== 'home') {
          <button class="text-sm font-semibold" style="color:var(--text-tertiary)" (click)="goHome()">← Back</button>
        }
      </div>

      @if (mode() === 'home') {
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          @for (a of actions; track a.mode) {
            @if (a.can()) {
              <button class="p-5 rounded-2xl text-left border transition-colors" style="background:var(--bg-card-solid);border-color:var(--glass-border)"
                      (click)="enter(a.mode)">
                <div class="text-base font-bold" style="color:var(--text-primary)">{{ a.label }}</div>
                <div class="text-[13px] mt-1" style="color:var(--text-tertiary)">{{ a.sub }}</div>
              </button>
            }
          }
        </div>

        <div class="grid md:grid-cols-2 gap-3">
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
      } @else {
        <!-- Scan bar (shared by receive/issue/count) -->
        <div class="flex items-center gap-2 mb-4">
          <input #scan class="inp flex-1" autofocus [ngModel]="scanCode()" (ngModelChange)="scanCode.set($event)"
                 (keyup.enter)="resolve(scanCode())"
                 [placeholder]="mode() === 'receive' ? 'Scan supplier barcode (or pick an item below)' : 'Scan item / lot barcode'" />
          <button class="px-3 py-2 rounded-lg text-sm font-bold text-white" style="background:var(--violet-600,#7c3aed)" (click)="resolve(scanCode())">Go</button>
          <button class="px-3 py-2 rounded-lg text-sm" style="background:var(--glass-bg);color:var(--text-secondary)" (click)="scanning.set(true)" title="Use camera">📷</button>
        </div>

        @if (resolved(); as r) {
          <div class="p-4 rounded-xl border mb-4" style="background:var(--bg-card-solid);border-color:var(--glass-border-hover)">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-base font-bold" style="color:var(--text-primary)">{{ r.item.name }}</div>
                <div class="text-xs font-mono" style="color:var(--text-muted)">{{ r.item.sku }} · on hand {{ r.item.onHand | number:'1.0-2' }} {{ r.item.uom }}</div>
              </div>
            </div>

            @if (mode() === 'receive') {
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                <label class="block"><span class="lbl">Lot #</span><input class="inp" [ngModel]="rcv().lot" (ngModelChange)="setR('lot',$event)"/></label>
                <label class="block"><span class="lbl">Expiry</span><input class="inp" type="date" [ngModel]="rcv().expiry" (ngModelChange)="setR('expiry',$event)"/></label>
                <label class="block"><span class="lbl">Unit cost</span><input class="inp" type="number" [ngModel]="rcv().cost" (ngModelChange)="setR('cost',+$event)"/></label>
                <label class="block"><span class="lbl">Qty *</span><input class="inp" type="number" [ngModel]="rcv().qty" (ngModelChange)="setR('qty',+$event)"/></label>
              </div>
              <button class="mt-3 px-4 py-2 rounded-lg text-sm font-bold text-white" style="background:var(--green,#10b981)" [disabled]="busy() || rcv().qty<=0" (click)="doReceive(r.item)">Receive stock</button>
              @if (lastLabel()) {
                <div class="mt-4 p-3 rounded-lg inline-block" style="background:#fff">
                  <pf-barcode-display [code]="lastLabel()!" [showValue]="true"></pf-barcode-display>
                  <button class="mt-2 text-xs font-semibold block" style="color:var(--violet-600)" (click)="printLabel()">Print label</button>
                </div>
              }
            }

            @if (mode() === 'issue') {
              <div class="flex items-end gap-3 mt-4">
                <label class="block"><span class="lbl">Qty to issue *</span><input class="inp" style="width:140px" type="number" [ngModel]="issueQty()" (ngModelChange)="issueQty.set(+$event)"/></label>
                <button class="px-4 py-2 rounded-lg text-sm font-bold text-white" style="background:var(--violet-600,#7c3aed)" [disabled]="busy() || issueQty()<=0" (click)="doIssue(r.item)">Issue (FEFO)</button>
              </div>
            }

            @if (mode() === 'count') {
              <div class="text-[11px] font-bold uppercase tracking-wider mt-4 mb-1" style="color:var(--text-muted)">Batches — enter counted qty</div>
              @for (b of r.batches; track b.id) {
                <div class="flex items-center justify-between gap-3 text-sm py-1 border-b" style="border-color:var(--glass-border)">
                  <span>{{ b.lotNumber || '—' }} <span style="color:var(--text-muted)">exp {{ b.expiryDate ? (b.expiryDate | date) : '—' }} · system {{ b.qtyOnHand | number:'1.0-2' }}</span></span>
                  <span class="flex items-center gap-2">
                    <input class="inp" style="width:90px" type="number" [ngModel]="countDraft()[b.id]" (ngModelChange)="setCount(b.id,+$event)" placeholder="count"/>
                    <button class="text-xs font-bold" style="color:var(--violet-400)" [disabled]="busy()" (click)="doCount(b)">Save</button>
                  </span>
                </div>
              } @empty { <p class="text-sm" style="color:var(--text-muted)">No batches at this branch.</p> }
            }
          </div>
        }

        <!-- Item picker (manual, when no scanner) -->
        <div class="mt-2">
          <input class="inp" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="…or search an item" style="max-width:340px"/>
          <div class="mt-2 grid sm:grid-cols-2 gap-2">
            @for (it of filteredItems(); track it.id) {
              <button class="p-3 rounded-lg border text-left flex justify-between items-center" style="background:var(--glass-bg);border-color:var(--glass-border)" (click)="pick(it)">
                <span><b>{{ it.name }}</b> <span class="font-mono text-xs" style="color:var(--text-muted)">{{ it.sku }}</span></span>
                <span class="font-mono text-xs" style="color:var(--text-tertiary)">{{ it.onHand | number:'1.0-2' }} {{ it.uom }}</span>
              </button>
            }
          </div>
        </div>
      }
    </section>

    @if (scanning()) {
      <pf-barcode-scanner-modal title="Scan inventory barcode"
        (matched)="onCameraScan($event)" (cancelled)="scanning.set(false)"></pf-barcode-scanner-modal>
    }
  `,
  styles: [`
    .lbl { display:block; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:var(--text-muted); margin-bottom:3px; }
    .inp { width:100%; padding:8px 11px; border-radius:10px; background:var(--glass-bg); border:1px solid var(--glass-border); color:var(--text-primary); font-size:14px; }
    .inp:focus { outline:none; border-color:var(--violet-500,#8b5cf6); }
  `]
})
export class StoresComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly mode = signal<Mode>('home');
  readonly items = signal<InvItem[]>([]);
  readonly lowStock = signal<any[]>([]);
  readonly expiring = signal<any[]>([]);
  readonly q = signal('');
  readonly scanCode = signal('');
  readonly scanning = signal(false);
  readonly busy = signal(false);
  readonly resolved = signal<{ item: InvItem; batches: InvBatch[] } | null>(null);
  readonly lastLabel = signal<string | null>(null);

  readonly rcv = signal<{ lot: string; expiry: string; cost: number; qty: number }>({ lot: '', expiry: '', cost: 0, qty: 0 });
  readonly issueQty = signal(0);
  readonly countDraft = signal<Record<string, number>>({});

  readonly branchName = () => this.auth.user()?.branchName ?? '';
  private can(p: string) { return this.auth.hasPermission(p) || this.auth.hasPermission('manage_inventory'); }
  readonly actions = [
    { mode: 'receive' as Mode, label: 'Receive', sub: 'Scan supplier barcode → add stock', can: () => this.can('inventory_receive') },
    { mode: 'issue' as Mode, label: 'Issue / Consume', sub: 'Scan item → deduct (FEFO)', can: () => this.can('inventory_issue') },
    { mode: 'count' as Mode, label: 'Stock count', sub: 'Scan lot → reconcile', can: () => this.can('inventory_count') },
  ];

  readonly filteredItems = computed(() => {
    const s = this.q().trim().toLowerCase();
    const list = this.items();
    return (s ? list.filter(i => (i.name + ' ' + i.sku).toLowerCase().includes(s)) : list).slice(0, 12);
  });

  async ngOnInit() { await Promise.all([this.loadItems(), this.loadAlerts()]); }

  private async loadItems() {
    try { this.items.set(await firstValueFrom(this.api.get<InvItem[]>('/api/inventory/items')) ?? []); } catch { /* */ }
  }
  private async loadAlerts() {
    try { const a = await firstValueFrom(this.api.get<any>('/api/inventory/alerts')); this.lowStock.set(a?.lowStock ?? []); this.expiring.set(a?.expiring ?? []); } catch { /* */ }
  }

  enter(m: Mode) { this.mode.set(m); this.resolved.set(null); this.scanCode.set(''); this.lastLabel.set(null); }
  goHome() { this.mode.set('home'); this.resolved.set(null); this.loadAlerts(); this.loadItems(); }
  setR(k: string, v: unknown) { this.rcv.update(r => ({ ...r, [k]: v })); }
  setCount(id: string, v: number) { this.countDraft.update(d => ({ ...d, [id]: v })); }

  onCameraScan(code: string) { this.scanning.set(false); this.resolve(code); }

  async resolve(code: string) {
    const c = (code ?? '').trim();
    if (!c) return;
    try {
      const r: any = await firstValueFrom(this.api.post('/api/inventory/scan/resolve', { code: c }));
      if (!r?.item) {
        // Unknown code: in receive mode, let them pick an item to alias; else error.
        this.toasts.warning(this.mode() === 'receive' ? 'Unknown barcode — pick the item below.' : 'No item found for that barcode.');
        this.resolved.set(null);
        return;
      }
      this.resolved.set({ item: r.item, batches: r.batches ?? [] });
      this.lastLabel.set(null);
      // Prefill receive form from parsed GS1 (lot/expiry/qty).
      if (this.mode() === 'receive' && r.parsed) {
        this.rcv.set({
          lot: r.parsed.lot ?? '',
          expiry: r.parsed.expiry ? String(r.parsed.expiry).substring(0, 10) : '',
          cost: 0,
          qty: r.parsed.qty ?? 1,
        });
      }
      this.scanCode.set('');
    } catch { this.toasts.error('Lookup failed'); }
  }

  pick(it: InvItem) {
    this.resolved.set({ item: it, batches: [] });
    if (this.mode() === 'count') this.loadBatchesFor(it.id);
    if (this.mode() === 'receive') this.rcv.set({ lot: '', expiry: '', cost: 0, qty: 1 });
  }
  private async loadBatchesFor(itemId: string) {
    try {
      const b = await firstValueFrom(this.api.get<InvBatch[]>(`/api/inventory/items/${itemId}/batches`)) ?? [];
      this.resolved.update(r => r ? { ...r, batches: b } : r);
    } catch { /* */ }
  }

  async doReceive(item: InvItem) {
    const r = this.rcv(); if (r.qty <= 0) return;
    this.busy.set(true);
    try {
      const res: any = await firstValueFrom(this.api.post(`/api/inventory/items/${item.id}/receive`, {
        lotNumber: r.lot || null, expiryDate: r.expiry ? r.expiry + 'T00:00:00Z' : null, unitCost: r.cost, qty: r.qty,
      }));
      this.toasts.success(`Received ${r.qty} ${item.uom} of ${item.name}`);
      if (res?.lotBarcode) this.lastLabel.set(res.lotBarcode);
      this.rcv.set({ lot: '', expiry: '', cost: 0, qty: 0 });
      await this.loadItems();
    } catch (e: any) { this.toasts.error(e?.error?.error?.message ?? 'Receive failed'); }
    this.busy.set(false);
  }

  async doIssue(item: InvItem) {
    const qty = this.issueQty(); if (qty <= 0) return;
    this.busy.set(true);
    try {
      const r: any = await firstValueFrom(this.api.post('/api/inventory/issue', { itemId: item.id, qty }));
      if (r?.success === false) { this.toasts.error(r?.error?.message ?? 'Issue failed'); }
      else { this.toasts.success(`Issued ${qty} ${item.uom} of ${item.name}`); this.issueQty.set(0); this.resolved.set(null); this.scanCode.set(''); await this.loadItems(); }
    } catch (e: any) { this.toasts.error(e?.error?.error?.message ?? 'Issue failed — out of stock?'); }
    this.busy.set(false);
  }

  async doCount(b: InvBatch) {
    const counted = this.countDraft()[b.id];
    if (counted == null || counted < 0) { this.toasts.warning('Enter a counted quantity'); return; }
    this.busy.set(true);
    try {
      const r: any = await firstValueFrom(this.api.post(`/api/inventory/batches/${b.id}/count`, { countedQty: counted }));
      const v = r?.variance ?? 0;
      this.toasts.success(v === 0 ? 'Count matches' : `Adjusted by ${v > 0 ? '+' : ''}${v}`);
      const it = this.resolved()?.item; if (it) await this.loadBatchesFor(it.id);
    } catch { this.toasts.error('Count failed'); }
    this.busy.set(false);
  }

  printLabel() { try { window.print(); } catch { /* */ } }
}
