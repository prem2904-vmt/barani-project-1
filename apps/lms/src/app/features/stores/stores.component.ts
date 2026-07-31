import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ApiError } from '../../shared/models/api-response.model';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/auth/auth.service';
import { BarcodeDisplayComponent } from '../../shared/components/barcode-display/barcode-display.component';
import { BarcodeScannerModalComponent } from '../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { printLabelOnly } from '../../shared/utils/print-label';

interface InvItem { id: string; sku: string; barcode?: string; name: string; category?: string; uom: string; onHand: number; lowStock: boolean; reorderLevel: number; }
type StockStatus = 'all' | 'ok' | 'low' | 'out';
type Mode = 'home' | 'scan';
type StockAction = 'receive' | 'issue' | 'count';
interface InvBatch { id: string; lotNumber?: string; lotBarcode?: string; expiryDate?: string; qtyOnHand: number; expired: boolean; }

/**
 * Stores operator work area — scan-first. A store keeper scans a supplier/GS1
 * barcode (HID gun or camera) to receive stock (lot/expiry/qty auto-parsed),
 * issue/consume FEFO, or cycle-count a lot. Catalog config (items, per-test BOM,
 * the enable switch) stays in Admin → Inventory.
 *
 * Scan robustness: besides the focused scan input, a document-level keydown
 * listener captures HID-gun bursts even when focus has drifted to a button or
 * the body (the most common cause of "missed" scans). It only fires for rapid
 * key sequences outside editable fields, so it never fights manual typing.
 */
@Component({
  selector: 'pf-stores',
  standalone: true,
  imports: [FormsModule, DecimalPipe, DatePipe, BarcodeDisplayComponent, BarcodeScannerModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="wrap">
      <!-- Header -->
      <header class="head">
        <div>
          <div class="eyebrow">Stores · {{ branchName() }}</div>
          <h1 class="title">Inventory desk</h1>
        </div>
        @if (mode() === 'scan') {
          <div class="listen" title="Scanner active — point the gun and scan">
            <span class="listen__dot"></span> Listening for scanner
          </div>
        }
      </header>

      <!-- One tab bar: Overview + the three stock actions, all sharing the
           same scan surface below (only the post-resolve form differs). -->
      <nav class="tabs">
        <button class="tab" [class.tab--on]="mode()==='home'" (click)="goHome()">Overview</button>
        @for (a of allowedActions(); track a.key) {
          <button class="tab" [class.tab--on]="mode()==='scan' && action()===a.key" (click)="enterAction(a.key)">{{ a.label }}</button>
        }
      </nav>

      <div class="content">
      @if (mode() === 'home') {
        <!-- KPI strip -->
        <div class="kpis">
          <div class="kpi"><span class="kpi__v">{{ kpis().total | number }}</span><span class="kpi__l">Items</span></div>
          <div class="kpi kpi--green"><span class="kpi__v">{{ kpis().inStock | number }}</span><span class="kpi__l">In stock</span></div>
          <div class="kpi kpi--amber"><span class="kpi__v">{{ kpis().low | number }}</span><span class="kpi__l">Low stock</span></div>
          <div class="kpi kpi--red"><span class="kpi__v">{{ kpis().out | number }}</span><span class="kpi__l">Out of stock</span></div>
          <div class="kpi kpi--violet"><span class="kpi__v">{{ expiring().length | number }}</span><span class="kpi__l">Expiring soon</span></div>
        </div>

        <!-- Stock table toolbar -->
        <div class="toolbar">
          <div class="searchfield">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input [ngModel]="stockQuery()" (ngModelChange)="stockQuery.set($event)" placeholder="Search items by name or SKU" />
          </div>
          <div class="filters">
            @for (f of stockFilters; track f.key) {
              <button class="chip" [class.chip--on]="stockStatus()===f.key" (click)="stockStatus.set(f.key)">{{ f.label }}</button>
            }
          </div>
        </div>

        <!-- Stock-on-hand table -->
        <div class="tablecard">
          <table class="stock">
            <thead><tr><th>Item</th><th>Category</th><th class="r">On hand</th><th class="r">Reorder</th><th class="r">Status</th></tr></thead>
            <tbody>
              @for (it of stockRows(); track it.id) {
                <tr>
                  <td><span class="it-name">{{ it.name }}</span> <span class="it-sku">{{ it.sku }}</span></td>
                  <td class="dim">{{ it.category || '—' }}</td>
                  <td class="r mono">{{ it.onHand | number:'1.0-2' }} <span class="dim">{{ it.uom }}</span></td>
                  <td class="r mono dim">{{ it.reorderLevel | number:'1.0-2' }}</td>
                  <td class="r">
                    @switch (statusOf(it)) {
                      @case ('out') { <span class="pill pill--red"><span class="dot"></span>Out</span> }
                      @case ('low') { <span class="pill pill--amber"><span class="dot"></span>Low</span> }
                      @default { <span class="pill pill--green"><span class="dot"></span>In stock</span> }
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="empty">{{ items().length ? 'No items match.' : 'No inventory items yet — add them under Admin → Inventory.' }}</td></tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Alerts -->
        <div class="alerts">
          <div class="card">
            <div class="card__h card__h--amber">Low stock <span class="badge">{{ lowStock().length }}</span></div>
            @for (l of lowStock(); track l.id) {
              <div class="line"><span class="line__name">{{ l.name }}</span><span class="line__v">{{ l.onHand | number:'1.0-2' }} / {{ l.reorderLevel | number:'1.0-2' }}</span></div>
            } @empty { <p class="muted">All items above reorder level.</p> }
          </div>
          <div class="card">
            <div class="card__h card__h--red">Expiring soon <span class="badge">{{ expiring().length }}</span></div>
            @for (e of expiring(); track e.id) {
              <div class="line"><span class="line__name">{{ e.item }} <span class="muted">{{ e.lotNumber }}</span></span>
                <span class="line__v" [style.color]="e.daysLeft < 0 ? 'var(--red)' : 'var(--text-tertiary)'">{{ e.daysLeft < 0 ? 'expired' : e.daysLeft + 'd' }}</span></div>
            } @empty { <p class="muted">Nothing expiring within the window.</p> }
          </div>
        </div>
      } @else {
        <!-- One scan / search box, shared by every action -->
        <div class="scanbar">
          <div class="scanfield">
            <svg class="scanfield__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14"/></svg>
            <input #scan class="scanfield__in" autocomplete="off" spellcheck="false"
                   [ngModel]="term()" (ngModelChange)="term.set($event)"
                   (keyup.enter)="resolve(term())"
                   [placeholder]="action()==='receive' ? 'Scan supplier barcode, or type to search items' : 'Scan item / lot barcode, or type to search items'" />
          </div>
          <button class="btn btn--primary" (click)="resolve(term())">Resolve</button>
          <button class="btn btn--ghost" (click)="scanning.set(true)" title="Use device camera">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
        </div>
        @if (lastScan()) { <div class="lastscan">Last read: <code>{{ lastScan() }}</code></div> }

        @if (resolved(); as r) {
          <div class="result">
            <div class="result__head">
              <div>
                <div class="result__name">{{ r.item.name }}</div>
                <div class="result__meta">{{ r.item.sku }}</div>
              </div>
              <div class="onhand" [class.onhand--low]="r.item.onHand <= r.item.reorderLevel">
                <span class="onhand__v">{{ r.item.onHand | number:'1.0-2' }}</span>
                <span class="onhand__u">{{ r.item.uom }} on hand</span>
              </div>
            </div>

            @if (action() === 'receive') {
              <div class="form4">
                <label><span class="lbl">Lot #</span><input class="inp" [ngModel]="rcv().lot" (ngModelChange)="setR('lot',$event)"/></label>
                <label><span class="lbl">Expiry</span><input class="inp" type="date" [ngModel]="rcv().expiry" (ngModelChange)="setR('expiry',$event)"/></label>
                <label><span class="lbl">Unit cost</span><input class="inp" type="number" [ngModel]="rcv().cost" (ngModelChange)="setR('cost',+$event)"/></label>
                <label><span class="lbl">Qty *</span><input class="inp" type="number" [ngModel]="rcv().qty" (ngModelChange)="setR('qty',+$event)"/></label>
              </div>
              <button class="btn btn--green mt" [disabled]="busy() || rcv().qty<=0" (click)="doReceive(r.item)">Receive stock</button>
              @if (lastLabel()) {
                <div class="label-block">
                  <div class="label-block__head">
                    <span class="lbl">Label</span>
                    <div class="lseg">
                      <button class="lseg__i" [class.lseg__i--on]="labelMode()==='both'" (click)="labelMode.set('both')">Both</button>
                      <button class="lseg__i" [class.lseg__i--on]="labelMode()==='barcode'" (click)="labelMode.set('barcode')">Barcode</button>
                      <button class="lseg__i" [class.lseg__i--on]="labelMode()==='qr'" (click)="labelMode.set('qr')">QR</button>
                    </div>
                  </div>
                  <div class="label-print pf-print-label">
                    <pf-barcode-display [code]="lastLabel()!" [mode]="labelMode()" [showValue]="true"></pf-barcode-display>
                  </div>
                  <button class="link" (click)="printLabel()">Print label</button>
                </div>
              }
            }

            @if (action() === 'issue') {
              <div class="form-row">
                <label><span class="lbl">Qty to issue *</span><input class="inp" style="width:140px" type="number" [ngModel]="issueQty()" (ngModelChange)="issueQty.set(+$event)"/></label>
                <button class="btn btn--primary" [disabled]="busy() || issueQty()<=0" (click)="doIssue(r.item)">Issue (FEFO)</button>
              </div>
              <p class="hint">FEFO — the earliest-expiring non-expired lot is consumed first.</p>
            }

            @if (action() === 'count') {
              <div class="lbl mt">Batches — enter the counted quantity</div>
              @for (b of r.batches; track b.id) {
                <div class="batch">
                  <span class="batch__lot">{{ b.lotNumber || '—' }} <span class="muted">exp {{ b.expiryDate ? (b.expiryDate | date) : '—' }} · system {{ b.qtyOnHand | number:'1.0-2' }}</span></span>
                  <span class="batch__act">
                    <input class="inp" style="width:90px" type="number" [ngModel]="countDraft()[b.id]" (ngModelChange)="setCount(b.id,+$event)" placeholder="count"/>
                    <button class="link" [disabled]="busy()" (click)="doCount(b)">Save</button>
                  </span>
                </div>
              } @empty { <p class="muted">No batches at this branch yet.</p> }
            }
          </div>
        }

        <!-- Live item list — filtered by the same box; pick to act without a scan -->
        @if (!resolved()) {
          <div class="picker">
            <div class="picker__label">{{ term().trim() ? 'Matching items' : 'All items' }}</div>
            <div class="picker__grid">
              @for (it of filteredItems(); track it.id) {
                <button class="pick" (click)="pick(it)">
                  <span class="pick__name">{{ it.name }} <span class="muted">{{ it.sku }}</span></span>
                  <span class="pick__v">{{ it.onHand | number:'1.0-2' }} {{ it.uom }}</span>
                </button>
              } @empty { <p class="muted">No items match.</p> }
            </div>
          </div>
        }
      }
      </div>
    </section>

    @if (scanning()) {
      <pf-barcode-scanner-modal title="Scan inventory barcode"
        (matched)="onCameraScan($event)" (cancelled)="scanning.set(false)"></pf-barcode-scanner-modal>
    }
  `,
  styles: [`
    /* WORK page: fill the shell's main area and scroll inside the content
       panel, not the page. :host fills the flex:1 shell-main; .wrap is a
       flex column whose header + tabs are fixed and whose .content scrolls. */
    :host { display: block; height: 100%; }
    .wrap { display: flex; flex-direction: column; height: 100%; overflow: hidden;
      padding: 24px 16px 0; max-width: 1180px; margin: 0 auto; }
    @media (min-width: 768px) { .wrap { padding: 28px 32px 0; } }
    .head, .tabs { flex: 0 0 auto; }
    .content { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
      padding-bottom: max(24px, env(safe-area-inset-bottom)); }

    /* KPI strip */
    .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; }
    @media (min-width: 720px) { .kpis { grid-template-columns: repeat(5, 1fr); } }
    .kpi { position: relative; overflow: hidden; padding: 15px 16px; border-radius: 14px; border: 1px solid var(--glass-border); background: var(--bg-card-solid); }
    .kpi::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--gradient-primary); opacity: .55; }
    .kpi--green::after { background: #34d399; } .kpi--amber::after { background: #fbbf24; } .kpi--red::after { background: #f87171; } .kpi--violet::after { background: #a78bfa; }
    .kpi__v { display: block; font-size: 26px; font-weight: 800; letter-spacing: -.02em; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .kpi--green .kpi__v { color: var(--green-text); } .kpi--amber .kpi__v { color: var(--amber-text); } .kpi--red .kpi__v { color: var(--red-text); } .kpi--violet .kpi__v { color: var(--violet-text); }
    .kpi__l { display: block; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); margin-top: 3px; }

    /* Toolbar + filters */
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .searchfield { position: relative; display: flex; align-items: center; flex: 1; min-width: 220px; max-width: 420px; }
    .searchfield svg { position: absolute; left: 12px; width: 15px; height: 15px; color: var(--text-muted); pointer-events: none; }
    .searchfield input { width: 100%; padding: 9px 12px 9px 34px; border-radius: 10px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-primary); font-size: 13.5px; }
    .searchfield input:focus { outline: none; border-color: var(--violet-500); box-shadow: 0 0 0 3px rgba(124,58,237,.16); }
    .filters { display: inline-flex; gap: 3px; padding: 3px; border-radius: 10px; border: 1px solid var(--glass-border); background: var(--glass-bg); }
    .chip { font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 7px; border: 0; background: transparent; color: var(--text-tertiary); }
    .chip--on { color: #fff; background: var(--gradient-primary); }

    /* Stock table */
    .tablecard { border: 1px solid var(--glass-border); border-radius: 14px; overflow: hidden; background: var(--bg-card-solid); margin-bottom: 16px; }
    table.stock { width: 100%; border-collapse: collapse; }
    table.stock th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); padding: 11px 16px; border-bottom: 1px solid var(--glass-border); }
    table.stock td { padding: 12px 16px; border-bottom: 1px solid var(--glass-border); font-size: 13.5px; color: var(--text-secondary); }
    table.stock tbody tr:last-child td { border-bottom: 0; }
    table.stock tbody tr:hover td { background: rgba(139,92,246,.06); }
    .stock .r { text-align: right; } .stock th.r { text-align: right; }
    .it-name { font-weight: 700; color: var(--text-primary); }
    .it-sku { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-muted); margin-left: 6px; }
    .stock .dim { color: var(--text-muted); }
    .stock .mono { font-family: 'JetBrains Mono', monospace; color: var(--text-secondary); }
    .stock .empty { text-align: center; padding: 32px; color: var(--text-muted); }
    .pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
    .pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 7px currentColor; }
    .pill--green { color: #6ee7b7; background: rgba(16,185,129,.14); } .pill--amber { color: #fcd34d; background: rgba(245,158,11,.14); } .pill--red { color: #fca5a5; background: rgba(239,68,68,.14); }
    .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
    .eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: var(--violet-400); }
    .title { font-size: 24px; font-weight: 800; letter-spacing: -.02em; color: var(--text-primary); margin: 4px 0 0; }
    .listen { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 600; color: var(--text-tertiary);
      padding: 5px 11px; border-radius: 999px; border: 1px solid var(--glass-border); background: var(--glass-bg); }
    .listen__dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 8px #34d399; animation: pf-pulse 1.8s ease-in-out infinite; }
    @keyframes pf-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

    .tabs { display: inline-flex; gap: 3px; padding: 3px; border-radius: 11px; border: 1px solid var(--glass-border); background: var(--glass-bg); margin-bottom: 18px; flex-wrap: wrap; }
    .tab { font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 8px; border: 0; background: transparent; color: var(--text-tertiary); transition: background .14s, color .14s; }
    .tab:hover { color: var(--text-primary); }
    .tab--on { color: #fff; background: var(--gradient-primary); }

    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
    .stat { padding: 14px 16px; border-radius: 14px; border: 1px solid var(--glass-border); background: var(--bg-card-solid); }
    .stat__v { font-size: 26px; font-weight: 800; letter-spacing: -.02em; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .stat__l { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); margin-top: 3px; }
    .stat--amber .stat__v { color: var(--amber-text); } .stat--red .stat__v { color: var(--red-text); }

    .actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .action { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; padding: 18px;
      border-radius: 16px; border: 1px solid var(--glass-border); background: var(--bg-card-solid); transition: border-color .15s, transform .15s; }
    .action:hover { border-color: var(--violet-500); transform: translateY(-2px); }
    .action__ic { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; background: rgba(124,58,237,.14); color: var(--violet-300); margin-bottom: 6px; }
    .action__ic svg { width: 19px; height: 19px; }
    .action__t { font-size: 15px; font-weight: 700; color: var(--text-primary); }
    .action__s { font-size: 12.5px; color: var(--text-tertiary); }

    .alerts { display: grid; gap: 12px; } @media (min-width: 768px) { .alerts { grid-template-columns: 1fr 1fr; } }
    .card { padding: 16px; border-radius: 14px; border: 1px solid var(--glass-border); background: var(--glass-bg); }
    .card__h { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
    .card__h--amber { color: var(--amber-text); } .card__h--red { color: var(--red-text); }
    .badge { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: rgba(255,255,255,.08); color: var(--text-secondary); }
    .line { display: flex; justify-content: space-between; gap: 10px; font-size: 13.5px; padding: 4px 0; color: var(--text-secondary); }
    .line__name { min-width: 0; } .line__v { font-family: 'JetBrains Mono', monospace; color: var(--text-tertiary); white-space: nowrap; }
    .muted { color: var(--text-muted); font-size: 13px; }

    .actionseg { display: inline-flex; gap: 4px; padding: 4px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-bg); margin-bottom: 14px; flex-wrap: wrap; }
    .aseg { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 8px 16px; border-radius: 9px; border: 0; background: transparent; color: var(--text-tertiary); transition: background .14s, color .14s; }
    .aseg:hover { color: var(--text-primary); }
    .aseg--on { background: var(--gradient-primary); color: #fff; }
    .aseg__t { font-size: 13.5px; font-weight: 700; }
    .aseg__s { font-size: 10.5px; opacity: .8; }
    .picker__label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); margin-bottom: 4px; }
    .scanbar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .scanfield { position: relative; flex: 1; display: flex; align-items: center; }
    .scanfield__ic { position: absolute; left: 13px; width: 18px; height: 18px; color: var(--violet-400); pointer-events: none; }
    .scanfield__in { width: 100%; padding: 13px 14px 13px 40px; border-radius: 12px; background: var(--bg-card-solid);
      border: 1px solid var(--glass-border-hover); color: var(--text-primary); font-size: 15px; font-family: 'JetBrains Mono', monospace; transition: border-color .15s, box-shadow .15s; }
    .scanfield__in:focus { outline: none; border-color: var(--violet-500); box-shadow: 0 0 0 3px rgba(124,58,237,.18); }
    .lastscan { font-size: 11.5px; color: var(--text-muted); margin-bottom: 14px; } .lastscan code { color: var(--text-secondary); }

    .btn { padding: 12px 16px; border-radius: 11px; border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-secondary); font-weight: 700; font-size: 13.5px; transition: all .15s; display: inline-flex; align-items: center; gap: 6px; }
    .btn:hover:not(:disabled) { color: #fff; border-color: var(--glass-border-hover); }
    .btn:disabled { opacity: .5; }
    .btn--primary { background: var(--gradient-primary); border-color: transparent; color: #fff; }
    .btn--green { background: var(--green, #10b981); border-color: transparent; color: #fff; }
    .btn--ghost { background: var(--glass-bg); }
    .mt { margin-top: 14px; }

    .result { padding: 18px; border-radius: 16px; border: 1px solid var(--glass-border-hover); background: var(--bg-card-solid); margin-bottom: 16px; }
    .result__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .result__name { font-size: 16px; font-weight: 700; color: var(--text-primary); }
    .result__meta { font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--text-muted); margin-top: 2px; }
    .onhand { text-align: right; flex-shrink: 0; }
    .onhand__v { font-size: 22px; font-weight: 800; color: var(--text-primary); font-variant-numeric: tabular-nums; display: block; }
    .onhand--low .onhand__v { color: var(--amber-text); }
    .onhand__u { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); }
    .form4 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; } @media (min-width: 768px) { .form4 { grid-template-columns: repeat(4, 1fr); } }
    .form-row { display: flex; align-items: flex-end; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    .lbl { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); margin-bottom: 4px; }
    .inp { width: 100%; padding: 9px 11px; border-radius: 10px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-primary); font-size: 14px; }
    .inp:focus { outline: none; border-color: var(--violet-500); }
    .hint { font-size: 12px; color: var(--text-muted); margin: 10px 0 0; }
    .label-block { margin-top: 16px; }
    .label-block__head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .lseg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; border: 1px solid var(--glass-border); background: var(--glass-bg); }
    .lseg__i { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; border: 0; background: transparent; color: var(--text-tertiary); }
    .lseg__i--on { color: #fff; background: var(--gradient-primary); }
    .label-print { display: inline-block; padding: 12px; border-radius: 12px; background: #fff; }
    .link { display: block; margin-top: 8px; background: none; border: 0; font-size: 12.5px; font-weight: 700; color: var(--violet-400); }
    .link:disabled { opacity: .5; }
    .batch { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13.5px; padding: 9px 0; border-bottom: 1px solid var(--glass-border); }
    .batch__lot { min-width: 0; } .batch__act { display: flex; align-items: center; gap: 10px; }

    .picker { margin-top: 6px; }
    .picker__grid { margin-top: 10px; display: grid; gap: 8px; } @media (min-width: 640px) { .picker__grid { grid-template-columns: 1fr 1fr; } }
    .pick { display: flex; justify-content: space-between; align-items: center; gap: 10px; text-align: left; padding: 12px 14px;
      border-radius: 11px; border: 1px solid var(--glass-border); background: var(--glass-bg); transition: border-color .15s; }
    .pick:hover { border-color: var(--violet-500); }
    .pick__name { font-size: 13.5px; font-weight: 600; color: var(--text-primary); min-width: 0; }
    .pick__v { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }

    /* ─────────────────────────────────────────────────────────────────
       CROSS-PLATFORM OVERRIDES — additive only. Desktop-web (≥1280px) is
       intentionally untouched; every rule below is gated to a sub-desktop
       width or a touch/native context and scoped under .wrap, so it can
       never alter the established desktop layout. The shell's .shell-main
       already reserves --tab-nav-total-height and the iPad left-rail gap,
       so this page adds no bottom-nav clearance of its own.
       ───────────────────────────────────────────────────────────────── */

    /* Phone (≤640px) */
    @media (max-width: 640px) {
      /* Stock table can't reflow to one column meaningfully — let it scroll
         horizontally inside its own card instead of forcing page overflow. */
      .wrap .tablecard { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .wrap table.stock { min-width: 520px; }

      /* Header can wrap so the "Listening" pill drops below the title. */
      .wrap .head { flex-wrap: wrap; align-items: flex-start; }

      /* Tabs/chips: comfortable tap targets, allow horizontal scroll rather
         than wrapping into a tall stack. */
      .wrap .tabs { display: flex; flex-wrap: nowrap; overflow-x: auto;
        -webkit-overflow-scrolling: touch; max-width: 100%; }
      .wrap .tab { flex: 0 0 auto; min-height: 44px; padding: 10px 16px; }
      .wrap .filters { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .wrap .chip { min-height: 38px; padding: 8px 14px; }

      /* Toolbar: search takes the full width above the filter chips. */
      .wrap .toolbar { flex-direction: column; align-items: stretch; }
      .wrap .searchfield { max-width: none; }

      /* Scan bar: keep the input on its own row, action buttons below at
         full reach. Camera button gets a real tap target. */
      .wrap .scanbar { flex-wrap: wrap; }
      .wrap .scanfield { flex: 1 1 100%; }
      .wrap .scanbar .btn { flex: 1 1 auto; justify-content: center; min-height: 48px; }
      .wrap .scanbar .btn--ghost { flex: 0 0 auto; min-width: 48px; }

      /* Result header stacks so the on-hand figure sits under the name. */
      .wrap .result__head { flex-direction: column; align-items: flex-start; }
      .wrap .onhand { text-align: left; }

      /* Issue/count rows: the fixed inline widths overflow narrow screens —
         override to fluid. (Inline style:width set in template; this beats it
         only because it is more specific via .wrap and !important.) */
      .wrap .form-row { flex-direction: column; align-items: stretch; }
      .wrap .form-row .inp,
      .wrap .batch .inp { width: 100% !important; }
      .wrap .form-row .btn { width: 100%; justify-content: center; min-height: 48px; }
      .wrap .batch { flex-direction: column; align-items: stretch; gap: 8px; }
      .wrap .batch__act { width: 100%; }
      .wrap .batch__act .inp { flex: 1 1 auto; }

      /* iOS zooms any focused input under 16px — lift every field to 16px on
         phone only so the page never auto-zooms on tap. */
      .wrap .scanfield__in,
      .wrap .searchfield input,
      .wrap .inp { font-size: 16px; }
    }

    /* iPad band (641–1279px): the layout already uses available width well
       (KPIs 5-up ≥720, alerts 2-up ≥768, form4 4-up ≥768). Just make sure
       the wide stock table never forces page-level horizontal scroll. */
    @media (min-width: 641px) and (max-width: 1279px) {
      .wrap .tablecard { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    }

    /* Touch (coarse pointer): give the small inline action targets — Save
       links, label-mode segments — a usable hit area without changing look
       on mouse-driven desktops. */
    @media (pointer: coarse) {
      .wrap .link { min-height: 44px; display: inline-flex; align-items: center; }
      .wrap .lseg__i { min-height: 44px; }
      /* Camera-scan icon-only button needs a full 44px hit area. */
      .wrap .scanbar .btn--ghost { min-width: 44px; min-height: 44px; justify-content: center; }
      /* Filter chips reach a comfortable tap target. */
      .wrap .chip { min-height: 44px; }
      /* Save links inside count batches sit on their own touchable row. */
      .wrap .batch__act .link { min-width: 44px; justify-content: center; }
      /* Action/overview tabs and item-picker rows are touch targets at every
         touch width (the ≤640 rule only covers phones — tablets are coarse too). */
      .wrap .tab { min-height: 44px; }
      .wrap .pick { min-height: 44px; }
    }
  `]
})
export class StoresComponent implements OnInit, AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);

  @ViewChild('scan') private scanInput?: ElementRef<HTMLInputElement>;

  readonly mode = signal<Mode>('home');
  readonly action = signal<StockAction>('receive');
  readonly items = signal<InvItem[]>([]);
  readonly lowStock = signal<any[]>([]);
  readonly expiring = signal<any[]>([]);
  /** One box drives both scan-resolve (Enter) and live item filtering. */
  readonly term = signal('');
  readonly lastScan = signal('');
  private lastParsed: any = null;
  readonly scanning = signal(false);
  readonly busy = signal(false);
  readonly resolved = signal<{ item: InvItem; batches: InvBatch[] } | null>(null);
  readonly lastLabel = signal<string | null>(null);

  readonly rcv = signal<{ lot: string; expiry: string; cost: number; qty: number }>({ lot: '', expiry: '', cost: 0, qty: 0 });
  readonly issueQty = signal(0);
  readonly countDraft = signal<Record<string, number>>({});
  readonly labelMode = signal<'both' | 'barcode' | 'qr'>('both');

  // Document-level HID-gun capture buffer (used only when focus is NOT in an
  // editable field — the focused scan input handles its own Enter).
  private hidBuffer = '';
  private hidLastKey = 0;

  readonly branchName = () => this.auth.user()?.branchName ?? '';
  private can(p: string) { return this.auth.hasPermission(p) || this.auth.hasPermission('manage_inventory'); }
  readonly actions: Array<{ key: StockAction; label: string; sub: string; can: () => boolean }> = [
    { key: 'receive', label: 'Receive', sub: 'add stock', can: () => this.can('inventory_receive') },
    { key: 'issue', label: 'Issue / Consume', sub: 'deduct (FEFO)', can: () => this.can('inventory_issue') },
    { key: 'count', label: 'Stock count', sub: 'reconcile', can: () => this.can('inventory_count') },
  ];
  readonly allowedActions = computed(() => this.actions.filter(a => a.can()));

  readonly filteredItems = computed(() => {
    const s = this.term().trim().toLowerCase();
    const list = this.items();
    return (s ? list.filter(i => (i.name + ' ' + i.sku).toLowerCase().includes(s)) : list).slice(0, 12);
  });

  // ── Overview stock table ──────────────────────────────────────────
  readonly stockQuery = signal('');
  readonly stockStatus = signal<StockStatus>('all');
  readonly stockFilters: Array<{ key: StockStatus; label: string }> = [
    { key: 'all', label: 'All' }, { key: 'ok', label: 'In stock' },
    { key: 'low', label: 'Low' }, { key: 'out', label: 'Out' },
  ];

  statusOf(it: InvItem): 'ok' | 'low' | 'out' {
    if (it.onHand <= 0) return 'out';
    if (it.lowStock || it.onHand <= it.reorderLevel) return 'low';
    return 'ok';
  }

  readonly kpis = computed(() => {
    let inStock = 0, low = 0, out = 0;
    for (const it of this.items()) {
      const s = this.statusOf(it);
      if (s === 'out') out++; else if (s === 'low') low++; else inStock++;
    }
    return { total: this.items().length, inStock, low, out };
  });

  readonly stockRows = computed(() => {
    const s = this.stockQuery().trim().toLowerCase();
    const st = this.stockStatus();
    return this.items().filter(it => {
      if (st !== 'all' && this.statusOf(it) !== st) return false;
      return !s || (it.name + ' ' + it.sku).toLowerCase().includes(s);
    });
  });

  async ngOnInit() {
    this.action.set(this.allowedActions()[0]?.key ?? 'receive');
    await Promise.all([this.loadItems(), this.loadAlerts()]);
  }
  ngAfterViewInit() { this.focusScan(); }

  /** Global keystroke capture for HID scanner guns. Fires only when focus is
   *  outside an editable element and the keys arrive in a rapid burst — so a
   *  scan isn't lost just because the operator clicked a button first. */
  @HostListener('document:keydown', ['$event'])
  onDocKey(ev: KeyboardEvent) {
    if (this.mode() === 'home' || this.scanning()) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const t = ev.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;

    const now = Date.now();
    if (now - this.hidLastKey > 400) this.hidBuffer = '';
    this.hidLastKey = now;

    if (ev.key === 'Enter') {
      const code = this.hidBuffer;
      this.hidBuffer = '';
      if (code.length >= 2) { ev.preventDefault(); this.resolve(code); }
      return;
    }
    if (ev.key.length === 1) this.hidBuffer += ev.key;
  }

  private focusScan() {
    // Defer so the input exists after the mode switch renders.
    setTimeout(() => this.scanInput?.nativeElement?.focus(), 0);
  }

  private async loadItems() {
    try { this.items.set(await firstValueFrom(this.api.get<InvItem[]>('/api/inventory/items')) ?? []); } catch { /* */ }
  }
  private async loadAlerts() {
    try { const a = await firstValueFrom(this.api.get<any>('/api/inventory/alerts')); this.lowStock.set(a?.lowStock ?? []); this.expiring.set(a?.expiring ?? []); } catch { /* */ }
  }

  /** Tab click: enter the scan surface for an action. Coming from Overview
   *  starts fresh; switching between action tabs keeps the resolved item. */
  enterAction(a: StockAction) {
    if (this.mode() !== 'scan') { this.mode.set('scan'); this.resolved.set(null); this.term.set(''); this.lastLabel.set(''); }
    this.setAction(a);
  }
  /** Switch the action without losing the resolved item — scan once, then
   *  Receive / Issue / Count the same item. */
  setAction(a: StockAction) {
    this.action.set(a);
    const r = this.resolved();
    if (r) {
      if (a === 'count') this.loadBatchesFor(r.item.id);
      if (a === 'receive') this.rcv.set({
        lot: this.lastParsed?.lot ?? '',
        expiry: this.lastParsed?.expiry ? String(this.lastParsed.expiry).substring(0, 10) : '',
        cost: 0, qty: this.lastParsed?.qty ?? 1,
      });
    }
    this.focusScan();
  }
  goHome() { this.mode.set('home'); this.resolved.set(null); this.loadAlerts(); this.loadItems(); }
  setR(k: string, v: unknown) { this.rcv.update(r => ({ ...r, [k]: v })); }
  setCount(id: string, v: number) { this.countDraft.update(d => ({ ...d, [id]: v })); }

  onCameraScan(code: string) { this.scanning.set(false); this.resolve(code); }

  async resolve(code: string) {
    const c = (code ?? '').trim();
    if (!c) return;
    this.lastScan.set(c);
    // Guard against partial reads — a 1-char "scan" is almost certainly a
    // dropped burst, not a real barcode.
    if (c.length < 3) { this.toasts.warning('That scan looked incomplete — try again.'); this.focusScan(); return; }
    try {
      const r: any = await firstValueFrom(this.api.post('/api/inventory/scan/resolve', { code: c }));
      if (!r?.item) {
        this.toasts.warning(this.action() === 'receive'
          ? `No item for “${c}” — pick it below to link the barcode.`
          : `No item found for “${c}”.`);
        this.resolved.set(null);
        this.term.set('');
        this.focusScan();
        return;
      }
      this.lastParsed = r.parsed ?? null;
      this.resolved.set({ item: r.item, batches: r.batches ?? [] });
      this.lastLabel.set('');
      if (this.action() === 'count') this.loadBatchesFor(r.item.id);
      // Prefill receive form from parsed GS1 (lot/expiry/qty).
      if (this.action() === 'receive' && r.parsed) {
        this.rcv.set({
          lot: r.parsed.lot ?? '',
          expiry: r.parsed.expiry ? String(r.parsed.expiry).substring(0, 10) : '',
          cost: 0,
          qty: r.parsed.qty ?? 1,
        });
      }
      this.term.set('');
      this.focusScan();
    } catch (e) { this.toasts.error(ApiError.from(e).message); this.focusScan(); }
  }

  pick(it: InvItem) {
    this.lastParsed = null;
    this.resolved.set({ item: it, batches: [] });
    this.term.set('');
    if (this.action() === 'count') this.loadBatchesFor(it.id);
    if (this.action() === 'receive') this.rcv.set({ lot: '', expiry: '', cost: 0, qty: 1 });
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
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    this.busy.set(false);
  }

  async doIssue(item: InvItem) {
    const qty = this.issueQty(); if (qty <= 0) return;
    this.busy.set(true);
    try {
      const r: any = await firstValueFrom(this.api.post('/api/inventory/issue', { itemId: item.id, qty }));
      if (r?.success === false) { this.toasts.error(r?.error?.message ?? 'Issue failed'); }
      else { this.toasts.success(`Issued ${qty} ${item.uom} of ${item.name}`); this.issueQty.set(0); this.resolved.set(null); this.term.set(''); await this.loadItems(); this.focusScan(); }
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    this.busy.set(false);
  }

  async doCount(b: InvBatch) {
    const counted = this.countDraft()[b.id];
    if (counted == null || counted < 0) { this.toasts.warning('Enter a counted quantity'); return; }
    this.busy.set(true);
    try {
      const r: any = await firstValueFrom(this.api.post(`/api/inventory/batches/${b.id}/count`, { countedQty: counted }));
      const v = r?.variance ?? 0;
      this.toasts.success(v === 0 ? 'Count matches system' : `Adjusted by ${v > 0 ? '+' : ''}${v}`);
      const it = this.resolved()?.item; if (it) await this.loadBatchesFor(it.id);
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    this.busy.set(false);
  }

  printLabel() { printLabelOnly(); }
}
