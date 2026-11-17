import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridApi, type GridReadyEvent, type RowClassParams, type RowClickedEvent } from 'ag-grid-community';
import { ApiService } from '../../../core/services/api.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService, DialogChoice } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { printLabelOnly } from '../../../shared/utils/print-label';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { PfDateComponent } from '../../../shared/components/pf-date/pf-date.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { mediaSignal } from '../../../shared/utils/media-query';
import { plural } from '../../../shared/utils/plural';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { InventoryEnableCardComponent } from './inventory-enable-card.component';
import { gridThemeDark, gridThemeLight } from '../tests/tests/grid-theme';
import {
  STOCK_LEVEL_LABEL, STOCK_LEVEL_TONE, dotCell, expiryView, itemCell, ledgerWord, qty, signedQty, stockLevel,
} from '../../stores/inventory-view';

ModuleRegistry.registerModules([AllCommunityModule]);

/** What the ITEM side card shows for the picked item. */
type ItemSection = 'batches' | 'receive' | 'label' | 'ledger';

type LabelMode = 'both' | 'barcode' | 'qr';

interface InvItem {
  id: string; sku: string; barcode?: string | null; name: string; category: string; uom: string;
  reorderLevel: number; nearExpiryDays: number; isActive: boolean; onHand: number; lowStock: boolean;
}
interface InvBatch {
  id: string; lotNumber?: string | null; expiryDate?: string | null; unitCost: number;
  qtyReceived: number; qtyOnHand: number; receivedAt: string; expired: boolean;
}
/** One `GET /api/inventory/items/{id}/ledger` row (InventoryTxnEntity). */
interface InvTxn { id: string; type: string; delta: number; reason?: string | null; at: string; batchId?: string | null }
/** A `?view=summary` test row (TestSummaryDto) — only what the list shows / searches. */
const CATEGORIES = ['consumable', 'reagent', 'kit', 'disposable'];
/** Rows the test list renders at once; the band search narrows the rest. */

/**
 * Admin → Inventory (PF-PATTERN: band → main card + side card).
 *
 *  • Items — the item grid (AG-Grid, like Test Master) is the MAIN card; the
 *    picked item opens the ITEM side card: Batches · Receive · Label ·
 *    Ledger, with ONE primary in its footer. New / Edit item open in the
 *    same side card. Nothing picked: the side card shows what needs
 *    attention (low stock, expiring lots). ≤900px: the side card is a sheet.
 *  • Test consumables — the test list (band search) is the LEFT navigation
 *    card; the picked test's CONSUMABLES are the main card, with how many
 *    tests this branch's stock still covers.
 *
 * Usage is auto-deducted per test (FEFO) at sample collection.
 */
@Component({
  selector: 'pf-inventory',
  standalone: true,
  imports: [BusyDirective, SkeletonTableComponent, DecimalPipe, DatePipe, NgTemplateOutlet, AgGridAngular, BarcodeDisplayComponent,
    HeroBandComponent, PfDateComponent, SelectComponent, InventoryEnableCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../stores/inv-layout.scss'],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10 max-w-6xl">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): the search + Items / Test consumables switch
             (+ the category filter on Items). Items: "New item" in the band. -->
        <pf-hero-band [back]="true" placeholder="Search items — name, SKU, unit…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            @if (narrow()) {
              <button type="button" class="pf-chip pf-inv-attnchip press" (click)="attnOpen.set(true)" aria-haspopup="dialog"
                      [attr.aria-expanded]="attnOpen()" [attr.aria-label]="'Attention, ' + attentionCount()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>
                <span class="pf-num">{{ attentionCount() }}</span>
              </button>
            }
            <pf-select class="pf-inv-bandsel" size="sm" [options]="categoryFilterOptions" [value]="category()"
                       (valueChange)="category.set($event)" aria-label="Category"></pf-select>
          </ng-container>
          <ng-container band-actions>
              <button type="button" class="pf-hb-btn press" [class.pf-hb-btn--primary]="bandNewPrimary()" [class.pf-hb-btn--ghost]="!bandNewPrimary()"
                      (click)="startNew()" aria-label="New item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                New item
              </button>
          </ng-container>
        </pf-hero-band>
      }
      <div class="pf-classic-only flex items-center justify-between gap-3 mb-5">
        <div>
          <div class="flex items-center gap-2">
            @if (navBack.showBack()) {
              <button type="button" class="pf-hdr-back shrink-0 inline-flex items-center justify-center" (click)="navBack.back()" aria-label="Go back">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
              </button>
            }
            <h1 class="text-2xl font-extrabold" style="color:var(--text-primary)">Inventory</h1>
          </div>
          <p class="text-sm" style="color:var(--text-tertiary)">Stock for the active branch. Usage is auto-deducted per test at sample collection.</p>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="pf-btn pf-btn--secondary" (click)="startNew()">New item</button>
        </div>
      </div>

      <div class="pf-band-body pf-band-body--fill">
      <pf-inventory-enable-card></pf-inventory-enable-card>
      <div class="inv-body">
          <!-- MAIN: the item grid -->
          <section class="pf-card" aria-labelledby="pf-inv-items-t">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg></span>
              <span class="pf-card__label" id="pf-inv-items-t">Items</span>
              <span class="pf-card__note">{{ web() ? 'Click' : 'Tap' }} an item for its batches, stock, label and ledger</span>
              <span class="inv-count pf-num">{{ itemsLabel() }}</span>
            </header>
            <div class="pf-card__body inv-main__body">
              @if (loading()) {
                <pf-skeleton-table [rows]="8" [cols]="4" label="Loading inventory…"></pf-skeleton-table>
              } @else if (!items().length) {
                <div class="pf-empty">
                  <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg></span>
                  <p class="pf-empty__title">No items yet</p>
                  <p class="pf-empty__body">Add the tubes, reagents and kits this lab stocks. Each gets a scannable barcode; the Stores desk receives, issues and counts them.</p>
                  <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="startNew()">Add the first item</button>
                </div>
              } @else {
                @if (!visibleItems().length) {
                  <p class="pf-band-empty">No items match{{ q() ? ' "' + q() + '"' : ' this category' }}.</p>
                }
                <ag-grid-angular class="inv-grid pf-inv-grid" [class.pf-inv-grid--hidden]="!visibleItems().length"
                                 [theme]="gridTheme()" [rowData]="visibleItems()" [columnDefs]="itemCols()"
                                 [getRowId]="rowId" [rowClassRules]="rowClassRules" [animateRows]="true" [suppressCellFocus]="true"
                                 (gridReady)="onGridReady($event)" (rowClicked)="onRowClicked($event)"></ag-grid-angular>
              }
            </div>
          </section>

          <!-- SIDE: the picked item / the item editor / attention -->
          @if (!narrow()) {
            <aside class="pf-card pf-inv-side" aria-labelledby="pf-inv-side-t">
              <ng-container [ngTemplateOutlet]="sideCard" [ngTemplateOutletContext]="{ sheet: false }"></ng-container>
            </aside>
          } @else if (editing() || sel() || attnOpen()) {
            <div class="inv-sheet-backdrop" (click)="closeSide()"></div>
            <aside class="pf-card inv-side--sheet pf-inv-side" role="dialog" aria-modal="true" aria-labelledby="pf-inv-side-t" (keydown.escape)="closeSide()">
              <span class="inv-sheet-handle" aria-hidden="true"></span>
              <ng-container [ngTemplateOutlet]="sideCard" [ngTemplateOutletContext]="{ sheet: true }"></ng-container>
            </aside>
          }
      </div>
      </div>
    </section>

    <!-- ══ Side card: editor / picked item / attention ══ -->
    <ng-template #sideCard let-sheet="sheet">
      @if (editing()) {
        <header class="pf-card__head">
          <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></span>
          <h3 class="pf-card__label" id="pf-inv-side-t">{{ form().id ? 'Edit item' : 'New item' }}</h3>
          <span class="pf-card__spacer"></span>
          <button type="button" class="pf-btn pf-btn--icon inv-close" (click)="editing.set(false)" aria-label="Close the item form">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>
        <div class="pf-card__body pf-inv-editor">
          <div class="inv-fields">
            <div class="pf-field"><label class="pf-field__lbl" for="pf-inv-sku">SKU <span class="pf-dot-unpriced" aria-label="required"></span></label>
              <input id="pf-inv-sku" class="pf-input pf-num" [class.pf-input--error]="itemError()?.field==='sku'||itemError()?.field==='code'" [value]="form().sku ?? ''" (input)="setF('sku', $any($event.target).value)"/>
              @if (itemError()?.field==='sku'||itemError()?.field==='code') { <span class="inv-err">{{ itemError()!.message }}</span> }
            </div>
            <div class="pf-field"><label class="pf-field__lbl" for="pf-inv-uom">Unit</label>
              <input id="pf-inv-uom" class="pf-input" [value]="form().uom ?? ''" (input)="setF('uom', $any($event.target).value)" placeholder="piece"/></div>
            <div class="pf-field inv-span"><label class="pf-field__lbl" for="pf-inv-name">Name <span class="pf-dot-unpriced" aria-label="required"></span></label>
              <input id="pf-inv-name" class="pf-input" [class.pf-input--error]="itemError()?.field==='name'" [value]="form().name ?? ''" (input)="setF('name', $any($event.target).value)"/>
              @if (itemError()?.field==='name') { <span class="inv-err">{{ itemError()!.message }}</span> }
            </div>
            <div class="pf-field"><span class="pf-field__lbl">Category</span>
              <pf-select [options]="categoryOptions" [value]="form().category ?? 'consumable'" (valueChange)="setF('category', $event)" aria-label="Category"></pf-select></div>
            <div class="pf-field"><label class="pf-field__lbl" for="pf-inv-reorder">Reorder level</label>
              <input id="pf-inv-reorder" class="pf-input pf-num" type="number" min="0" inputmode="decimal" [value]="form().reorderLevel ?? 0" (input)="setF('reorderLevel', +$any($event.target).value)"/></div>
            <div class="pf-field"><label class="pf-field__lbl" for="pf-inv-near">Near-expiry (days)</label>
              <input id="pf-inv-near" class="pf-input pf-num" type="number" min="1" inputmode="numeric" [value]="form().nearExpiryDays ?? 30" (input)="setF('nearExpiryDays', +$any($event.target).value)"/></div>
            <div class="pf-field pf-inv-active">
              <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="!!form().isActive" (click)="setF('isActive', !form().isActive)">
                <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span><span>Active</span>
              </button>
            </div>
            <div class="pf-field inv-span"><label class="pf-field__lbl" for="pf-inv-barcode">Barcode</label>
              <input id="pf-inv-barcode" class="pf-input pf-num" autocomplete="off" [class.pf-input--error]="itemError()?.field==='barcode'" [value]="form().barcode ?? ''" (input)="setF('barcode', $any($event.target).value)" placeholder="Supplier barcode (GTIN)"/>
              @if (itemError()?.field==='barcode') { <span class="inv-err">{{ itemError()!.message }}</span> }
              <span class="pf-field__hint">Scan or type the supplier's barcode so the Stores desk finds this item by scan. Left blank, a new item gets its own.</span>
            </div>
          </div>
        </div>
        <div class="pf-card__foot">
          <button type="button" class="pf-btn pf-btn--secondary press" (click)="editing.set(false)">Cancel</button>
          <button type="button" class="pf-btn pf-btn--primary press" [disabled]="!canSave() || itemSaving()" [pfBusy]="itemSaving()" pfBusyLabel="Saving…" (click)="saveItem()">{{ form().id ? 'Save item' : 'Create item' }}</button>
        </div>
      } @else if (sel(); as it) {
        <header class="pf-card__head">
          <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg></span>
          <span class="pf-card__label" id="pf-inv-side-t">Item</span>
          <span class="pf-card__spacer"></span>
          <button type="button" class="pf-btn pf-btn--icon inv-close" (click)="closeSide()" [attr.aria-label]="sheet ? 'Close' : 'Close the item'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>
        <div class="pf-card__body">
          <div class="inv-subject">
            <div>
              <p class="inv-subject__name">{{ it.name }}</p>
              <p class="inv-subject__meta pf-num">{{ it.sku }} · {{ it.category }}{{ it.isActive ? '' : ' · Off' }}</p>
              @if (it.barcode) { <p class="inv-subject__meta pf-num">Barcode {{ it.barcode }}</p> }
            </div>
            <div class="inv-onhand">
              <span class="inv-onhand__v">{{ it.onHand | number:'1.0-2' }}</span>
              <span class="inv-onhand__u">{{ it.uom }} · reorder at {{ it.reorderLevel | number:'1.0-2' }}</span>
              @if (level(it) !== 'ok') { <span class="pf-sdot" [attr.data-tone]="tone(it)">{{ levelLabel(it) }}</span> }
            </div>
          </div>
          <div class="pf-seg pf-inv-sections" role="radiogroup" aria-label="Item section">
            @for (s of sections; track s.v) {
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="section() === s.v" (click)="setSection(it, s.v)">{{ s.l }}</button>
            }
          </div>

          @switch (section()) {
            @case ('receive') {
              <div class="inv-fields rcv-form">
                <div class="pf-field"><label class="pf-field__lbl" for="pf-inv-lot">Lot no.</label>
                  <input id="pf-inv-lot" class="pf-input pf-num" autocomplete="off" [value]="rcv().lot" (input)="setR('lot', $any($event.target).value)"/></div>
                <div class="pf-field"><span class="pf-field__lbl">Expiry</span>
                  <pf-date label="Expiry" [value]="rcv().expiry || null" (valueChange)="setR('expiry', $event ?? '')"></pf-date></div>
                <div class="pf-field"><label class="pf-field__lbl" for="pf-inv-cost">Unit cost (₹)</label>
                  <input id="pf-inv-cost" class="pf-input pf-num" type="number" min="0" step="0.01" inputmode="decimal" [value]="rcv().cost || ''" (input)="setR('cost', +$any($event.target).value)"/></div>
                <div class="pf-field"><label class="pf-field__lbl" for="pf-inv-qty">Quantity ({{ it.uom }}) <span class="pf-dot-unpriced" aria-label="required"></span></label>
                  <input id="pf-inv-qty" class="pf-input pf-num" [class.pf-input--error]="rcvError()?.field==='qty'||rcvError()?.field==='quantity'" type="number" min="0" inputmode="decimal" [value]="rcv().qty || ''" (input)="setR('qty', +$any($event.target).value)"/>
                  @if (rcvError()?.field==='qty'||rcvError()?.field==='quantity') { <span class="inv-err">{{ rcvError()!.message }}</span> }
                </div>
              </div>
              <p class="inv-sub">Adds a new lot at this branch with its own printable lot barcode.</p>
            }
            @case ('label') {
              <div class="inv-label label-wrap">
                <div class="pf-seg" role="radiogroup" aria-label="Label type">
                  <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="labelMode()==='both'" (click)="labelMode.set('both')">Both</button>
                  <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="labelMode()==='barcode'" (click)="labelMode.set('barcode')">Barcode</button>
                  <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="labelMode()==='qr'" (click)="labelMode.set('qr')">QR</button>
                </div>
                <div class="inv-label__paper pf-print-label">
                  <pf-barcode-display [code]="labelCode() || it.barcode || it.sku" [mode]="labelMode()" [showValue]="true"></pf-barcode-display>
                </div>
                <p class="inv-sub">{{ labelCode() && labelCode() !== (it.barcode || it.sku) ? 'The lot just received — stick it on the box.' : 'The item barcode — scanning it at the Stores desk finds this item.' }}</p>
              </div>
            }
            @case ('ledger') {
              <div>
                @for (t of ledger(); track t.id) {
                  <div class="inv-line">
                    <span class="inv-line__main">
                      <span class="inv-line__name">{{ ledgerWord(t.type) }}</span>
                      <span class="inv-line__meta pf-num">{{ t.at | date:'d MMM y, h:mm a' }}{{ t.reason ? ' · ' + t.reason : '' }}</span>
                    </span>
                    <span class="inv-line__end pf-num" [class.inv-strong]="t.delta > 0">{{ signedQty(t.delta) }}</span>
                  </div>
                } @empty { <p class="inv-sub">{{ ledgerLoading() ? 'Loading…' : 'No stock movements yet.' }}</p> }
              </div>
            }
            @default {
              <div>
                @for (b of batches(); track b.id) {
                  <div class="inv-line pf-inv-batch">
                    <span class="inv-line__main">
                      <span class="inv-line__name pf-num">{{ b.lotNumber || 'No lot no.' }}</span>
                      <span class="inv-line__meta pf-num">exp {{ b.expiryDate ? (b.expiryDate | date:'d MMM y') : '—' }}
                        @if (b.expired) { · <span class="pf-sdot" data-tone="bad">Expired</span> }</span>
                    </span>
                    <span class="inv-line__end">
                      <button type="button" class="pf-btn pf-btn--icon pf-inv-adj" (click)="adjust(b, -1)" aria-label="Decrease">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>
                      </button>
                      <span class="inv-strong pf-inv-batch__q">{{ b.qtyOnHand | number:'1.0-2' }}</span>
                      <button type="button" class="pf-btn pf-btn--icon pf-inv-adj" (click)="adjust(b, 1)" aria-label="Increase">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                      </button>
                    </span>
                  </div>
                } @empty { <p class="inv-sub">No lots at this branch yet — receive stock.</p> }
              </div>
              @if (batches().length) { <p class="inv-sub">Earliest expiry is used first (FEFO). Every change is kept in the ledger.</p> }
            }
          }
        </div>
        <div class="pf-card__foot">
          @switch (section()) {
            @case ('receive') {
              <button type="button" class="pf-btn pf-btn--secondary press" (click)="setSection(it, 'batches')">Cancel</button>
              <button type="button" class="pf-btn press" [class.pf-btn--primary]="rcv().qty > 0" [class.pf-btn--secondary]="rcv().qty <= 0"
                      [disabled]="rcv().qty<=0 || receiving()" [pfBusy]="receiving()" pfBusyLabel="Adding stock…" (click)="doReceive(it)">Add stock</button>
            }
            @case ('label') {
              <button type="button" class="pf-btn pf-btn--secondary press" (click)="startEdit(it)">Edit item</button>
              <button type="button" class="pf-btn pf-btn--primary press" (click)="printLabel()">Print label</button>
            }
            @default {
              <button type="button" class="pf-btn pf-btn--secondary press" (click)="startEdit(it)">Edit item</button>
              <button type="button" class="pf-btn pf-btn--primary press" (click)="openReceive(it)">Receive stock</button>
            }
          }
        </div>
      } @else {
        <header class="pf-card__head">
          <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg></span>
          <span class="pf-card__label" id="pf-inv-side-t">Attention</span>
          <span class="pf-card__spacer"></span>
          @if (sheet) {
            <button type="button" class="pf-btn pf-btn--icon inv-close" (click)="closeSide()" aria-label="Close attention">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          }
        </header>
        <div class="pf-card__body">
          <div class="inv-kpis" role="list" aria-label="Stock summary">
            <div class="inv-kpi" role="listitem"><span class="inv-kpi__v">{{ items().length | number }}</span><span class="pf-sdot">Items</span></div>
            <div class="inv-kpi" role="listitem"><span class="inv-kpi__v">{{ lowStock().length | number }}</span><span class="pf-sdot" data-tone="warn">Low</span></div>
            <div class="inv-kpi" role="listitem"><span class="inv-kpi__v">{{ expiring().length | number }}</span><span class="pf-sdot" data-tone="warn">Expiring</span></div>
          </div>
          <p class="inv-title">At or below reorder level</p>
          <div class="pf-inv-alert">
            @for (l of lowStock(); track l.id) {
              <div class="inv-line alert-row">
                <span class="inv-line__main"><span class="inv-line__name alert-row__name">{{ l.name }}</span></span>
                <span class="inv-line__end pf-num"><span class="inv-strong">{{ l.onHand | number:'1.0-2' }}</span><span class="inv-muted">/ {{ l.reorderLevel | number:'1.0-2' }}</span></span>
              </div>
            } @empty { <p class="inv-sub">Every item is above its reorder level.</p> }
          </div>
          <p class="inv-title">Expiring soon</p>
          <div class="pf-inv-alert">
            @for (e of expiring(); track e.id) {
              <div class="inv-line alert-row">
                <span class="inv-line__main">
                  <span class="inv-line__name alert-row__name">{{ e.item }}</span>
                  <span class="inv-line__meta pf-num">{{ e.lotNumber ? 'Lot ' + e.lotNumber : 'No lot' }}</span>
                </span>
                <span class="inv-line__end"><span class="pf-sdot" [attr.data-tone]="expiry(e.daysLeft).tone">{{ expiry(e.daysLeft).label }}</span></span>
              </div>
            } @empty { <p class="inv-sub">Nothing expiring within its item's near-expiry window.</p> }
          </div>
          <p class="inv-sub">{{ web() ? 'Click' : 'Tap' }} an item in the list for its batches, to receive stock, print its label or read its ledger.</p>
        </div>
      }
    </ng-template>
  `,
  styles: [`
    /* Band pill (new design). */
    .pf-inv-bandsel { flex-shrink: 0; width: 160px; }
    .pf-inv-attnchip { flex-shrink: 0; height: 32px; }
    @media (max-width: 640px) { .pf-inv-bandsel { width: 150px; } }

    /* Classic: the cards need a height of their own (no band page). */
    :host-context(.design-classic) .inv-body { min-height: 620px; }

    .pf-inv-grid--hidden { display: none; }
    .pf-inv-side .pf-inv-sections { align-self: flex-start; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
    .pf-inv-active { justify-content: flex-end; padding-bottom: 10px; }
    .pf-inv-batch__q { min-width: 44px; text-align: center; }
    .pf-inv-adj { width: 36px; min-width: 36px; height: 36px; min-height: 36px; }

    .pf-hdr-back { width:38px; height:38px; margin-left:-8px; border-radius:11px; color:var(--text-primary); background:transparent; border:0; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background .15s ease, transform .08s ease; }
    .pf-hdr-back:active { transform:scale(0.9); background:var(--glass-bg, rgba(255,255,255,0.06)); }
    @media (hover:hover){ .pf-hdr-back:hover{ background:var(--glass-bg, rgba(255,255,255,0.06)); } }

    @media (pointer: coarse) {
      .pf-inv-adj { width: 44px; min-width: 44px; height: 44px; min-height: 44px; }
    }
  `]
})
export class InventoryComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  protected readonly navBack = inject(NavBackService);
  protected readonly theme = inject(ThemeService);
  /** Row actions: text on web, icon on touch (PF-PATTERN). */
  protected readonly web = webPointerSignal();
  /** ≤900px: no side column — the side card is a sheet. */
  protected readonly narrow = mediaSignal('(max-width: 900px)');
  private readonly phone = mediaSignal('(max-width: 640px)');
  protected readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  protected readonly plural = plural;
  protected readonly ledgerWord = ledgerWord;
  protected readonly signedQty = signedQty;
  readonly categories = CATEGORIES;
  readonly categoryOptions: PfSelectOption[] = CATEGORIES.map(c => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }));

  /** Item search + category filter ('' = all categories). */
  readonly q = signal('');
  readonly category = signal('');
  readonly categoryFilterOptions: PfSelectOption[] = [{ value: '', label: 'All categories' }, ...this.categoryOptions];
  readonly visibleItems = computed(() => {
    const cat = this.category();
    const rows = cat ? this.items().filter(i => i.category === cat) : this.items();
    return bandFilter(rows, this.q(), i => [i.name, i.sku, i.category, i.uom, i.barcode ?? '']);
  });
  readonly itemsLabel = computed(() => plural(this.visibleItems().length, 'item'));
  readonly items = signal<InvItem[]>([]);
  readonly batches = signal<InvBatch[]>([]);
  readonly loading = signal(true);
  readonly editing = signal(false);
  /** The picked item (its ITEM side card is open). */
  readonly expandedId = signal<string | null>(null);
  readonly receiveFor = signal<string | null>(null);
  readonly section = signal<ItemSection>('batches');
  readonly sections: { v: ItemSection; l: string }[] = [
    { v: 'batches', l: 'Batches' }, { v: 'receive', l: 'Receive' }, { v: 'label', l: 'Label' }, { v: 'ledger', l: 'Ledger' },
  ];
  readonly sel = computed(() => this.items().find(i => i.id === this.expandedId()) ?? null);
  readonly ledger = signal<InvTxn[]>([]);
  readonly ledgerLoading = signal(false);
  /** Narrow widths: the ATTENTION sheet (nothing picked). */
  readonly attnOpen = signal(false);
  /** "New item" is the band's primary only while the side card has none. */
  readonly bandNewPrimary = computed(() => !this.editing() && !this.sel());

  readonly lowStock = signal<any[]>([]);
  readonly expiring = signal<any[]>([]);
  readonly attentionCount = computed(() => this.lowStock().length + this.expiring().length);

  readonly form = signal<Partial<InvItem>>({});
  readonly rcv = signal<{ lot: string; expiry: string; cost: number; qty: number }>({ lot: '', expiry: '', cost: 0, qty: 0 });

  // Field-aware API failures: a matching `.field` highlights the input inline;
  // anything else falls back to a toast with the real backend message.
  readonly itemError = signal<{ field?: string; message: string } | null>(null);
  readonly rcvError = signal<{ field?: string; message: string } | null>(null);

  // Printable barcode/QR label — set after a receive (the lot barcode) or via
  // the item's "Label" section. `labelMode` lets the operator pick the symbology.
  readonly labelCode = signal<string | null>(null);
  readonly labelMode = signal<LabelMode>('both');

  readonly canSave = computed(() => !!this.form().sku?.trim() && !!this.form().name?.trim());

  /** Loading feedback: Save item / Add stock running. */
  readonly itemSaving = signal(false);
  readonly receiving = signal(false);

  // ── Item grid ─────────────────────────────────────────────────
  private gridApi: GridApi<InvItem> | null = null;
  readonly rowId = (p: { data: InvItem }) => p.data.id;
  readonly rowClassRules = { 'inv-row--sel': (p: RowClassParams<InvItem>) => !!p.data && p.data.id === this.expandedId() };
  readonly itemCols = computed<ColDef<InvItem>[]>(() => {
    const phone = this.phone();
    return [
      { colId: 'item', headerName: 'Item', flex: 2, minWidth: 150, autoHeight: true, wrapText: true, sortable: true,
        valueGetter: p => p.data?.name ?? '',
        cellRenderer: (p: { data?: InvItem }) => itemCell(p.data?.name ?? '', [p.data?.sku, p.data?.isActive === false ? 'Off' : ''].filter(Boolean).join(' · ')) },
      { colId: 'category', headerName: 'Category', width: 130, hide: phone, sortable: true,
        valueGetter: p => p.data?.category ?? '', valueFormatter: p => (p.value ? String(p.value)[0].toUpperCase() + String(p.value).slice(1) : '') },
      { colId: 'onHand', headerName: 'On hand', width: phone ? 104 : 130, type: 'rightAligned', sortable: true, cellClass: 'inv-num',
        valueGetter: p => p.data?.onHand ?? 0, valueFormatter: p => `${qty(p.value)} ${p.data?.uom ?? ''}`.trim() },
      { colId: 'reorder', headerName: 'Reorder at', width: 110, type: 'rightAligned', cellClass: 'inv-num', hide: phone,
        valueGetter: p => p.data?.reorderLevel ?? 0, valueFormatter: p => qty(p.value) },
      { colId: 'status', headerName: 'Status', width: phone ? 96 : 132, sortable: true,
        valueGetter: p => (p.data ? stockLevel(p.data) : 'ok'),
        comparator: (a: string, b: string) => ['out', 'low', 'ok'].indexOf(a) - ['out', 'low', 'ok'].indexOf(b),
        cellRenderer: (p: { data?: InvItem }) => {
          const l = p.data ? stockLevel(p.data) : 'ok';
          return dotCell(phone && l === 'out' ? 'Out' : STOCK_LEVEL_LABEL[l], STOCK_LEVEL_TONE[l]);
        } },
    ];
  });
  onGridReady(e: GridReadyEvent<InvItem>) { this.gridApi = e.api; }
  onRowClicked(e: RowClickedEvent<InvItem>) { if (e.data) this.selectItem(e.data); }
  private redrawSel() { try { this.gridApi?.redrawRows(); } catch { /* grid gone */ } }

  level(it: InvItem) { return stockLevel(it); }
  tone(it: InvItem) { return STOCK_LEVEL_TONE[stockLevel(it)]; }
  levelLabel(it: InvItem) { return STOCK_LEVEL_LABEL[stockLevel(it)]; }
  expiry(daysLeft: number) { return expiryView(daysLeft); }

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
  private async loadLedger(itemId: string) {
    this.ledgerLoading.set(true);
    try { this.ledger.set(await firstValueFrom(this.api.get<InvTxn[]>(`/api/inventory/items/${itemId}/ledger?take=50`)) ?? []); }
    catch { this.ledger.set([]); }
    this.ledgerLoading.set(false);
  }

  setF(k: string, v: unknown) { this.form.update(f => ({ ...f, [k]: v })); }
  setR(k: string, v: unknown) { this.rcv.update(r => ({ ...r, [k]: v })); }

  startNew() { this.itemError.set(null); this.form.set({ category: 'consumable', uom: 'piece', reorderLevel: 0, nearExpiryDays: 30, isActive: true }); this.editing.set(true); this.attnOpen.set(false); }
  startEdit(it: InvItem) { this.itemError.set(null); this.form.set({ ...it }); this.editing.set(true); }

  async saveItem() {
    if (!this.canSave() || this.itemSaving()) return;
    this.itemError.set(null);
    this.itemSaving.set(true);
    try {
      await firstValueFrom(this.api.post('/api/inventory/items', this.form()));
      this.editing.set(false); this.toasts.success('Item saved'); await this.load(); await this.loadAlerts();
    } catch (e) {
      const err = ApiError.from(e);
      if (err.field === 'sku' || err.field === 'code' || err.field === 'name' || err.field === 'barcode') this.itemError.set({ field: err.field, message: err.message });
      else this.toasts.error(err.message);
    } finally {
      this.itemSaving.set(false);
    }
  }

  /** Pick an item: its ITEM side card opens on Batches. */
  selectItem(it: InvItem) {
    this.editing.set(false); this.attnOpen.set(false);
    this.expandedId.set(it.id); this.receiveFor.set(null);
    this.section.set('batches'); this.labelCode.set(null); this.ledger.set([]);
    this.redrawSel();
    this.loadBatches(it.id);
  }
  /** Close the side card (or its sheet). */
  closeSide() {
    if (this.editing()) { this.editing.set(false); return; }
    this.attnOpen.set(false);
    this.expandedId.set(null); this.receiveFor.set(null);
    this.redrawSel();
  }
  setSection(it: InvItem, s: ItemSection) {
    if (s === 'receive') { this.openReceive(it); return; }
    if (s === 'label') { this.showLabel(it); return; }
    this.section.set(s);
    if (s === 'ledger') this.loadLedger(it.id);
  }
  async toggleBatches(it: InvItem) {
    if (this.expandedId() === it.id && this.section() === 'batches') { this.closeSide(); return; }
    this.selectItem(it);
  }
  openReceive(it: InvItem) {
    if (this.expandedId() !== it.id) this.selectItem(it);
    this.section.set('receive');
    this.expandedId.set(it.id); this.receiveFor.set(it.id);
    this.rcv.set({ lot: '', expiry: '', cost: 0, qty: 0 });
    this.rcvError.set(null);
  }
  /** Show a printable barcode/QR label for the item itself (its barcode, or SKU
   *  as a fallback). The lot label is shown automatically after a receive. */
  showLabel(it: InvItem) {
    if (this.expandedId() !== it.id) this.selectItem(it);
    this.section.set('label');
    this.labelCode.set((it as any).barcode || it.sku || it.id);
  }
  /** Add stock, then show the new lot's label to print. */
  async doReceive(it: InvItem) {
    await this.receive(it);
    if (this.receiveFor() === null) {   // receive() clears it only on success
      this.section.set(this.labelCode() ? 'label' : 'batches');
    }
  }
  printLabel() { printLabelOnly(); }
  private async loadBatches(itemId: string) {
    try { this.batches.set(await firstValueFrom(this.api.get<InvBatch[]>(`/api/inventory/items/${itemId}/batches`)) ?? []); }
    catch { this.batches.set([]); }
  }

  async receive(it: InvItem) {
    const r = this.rcv();
    if (r.qty <= 0 || this.receiving()) return;
    this.rcvError.set(null);
    this.receiving.set(true);
    try {
      // Contract (fix 7 — expiry = end of day IST): send the <input type=date>
      // / pf-date value as a literal "<YYYY-MM-DD>T00:00:00Z" string —
      // never through `new Date(...)` first, which would shift the date by
      // the browser's local timezone. The server stores the date part
      // VERBATIM and treats it as an IST calendar date: a lot dated 31 Oct is
      // usable through 23:59:59 IST 31 Oct (InventoryService.ExpiryCutoffUtc).
      // "Is this expired / in stock" is always read back from the server
      // (`expired`, `onHand`, `lowStock` — see inventory-view.ts `stockLevel`'s
      // doc comment) — never recomputed client-side.
      const res: any = await firstValueFrom(this.api.post(`/api/inventory/items/${it.id}/receive`, {
        lotNumber: r.lot || null, expiryDate: r.expiry ? r.expiry + 'T00:00:00Z' : null, unitCost: r.cost, qty: r.qty,
      }));
      this.toasts.success('Stock received'); this.receiveFor.set(null);
      // Surface the freshly-minted lot barcode so the operator can print a label.
      if (res?.lotBarcode) this.labelCode.set(res.lotBarcode);
      await Promise.all([this.loadBatches(it.id), this.load(), this.loadAlerts()]);
    } catch (e) {
      const err = ApiError.from(e);
      if (err.field === 'qty' || err.field === 'quantity') this.rcvError.set({ field: err.field, message: err.message });
      else this.toasts.error(err.message);
    } finally {
      this.receiving.set(false);
    }
  }

  /** Reason codes for a manual stock adjustment (fix 8) — server-validated;
   *  the ledger records the code itself rather than always "wastage". No
   *  native <select>: a DialogService pick (and a follow-up note for "other"). */
  private static readonly ADJUST_REASONS: DialogChoice[] = [
    { value: 'wastage', label: 'Wastage' },
    { value: 'damage', label: 'Damage' },
    { value: 'qc', label: 'QC' },
    { value: 'calibration', label: 'Calibration' },
    { value: 'correction', label: 'Correction' },
    { value: 'other', label: 'Other' },
  ];

  async adjust(b: InvBatch, delta: number) {
    const reasonCode = await this.dialog.choose({
      title: delta < 0 ? 'Reduce stock' : 'Increase stock',
      message: `${delta < 0 ? 'Remove' : 'Add'} ${Math.abs(delta)} unit from this batch — pick a reason.`,
      choices: InventoryComponent.ADJUST_REASONS,
      confirmLabel: delta < 0 ? 'Remove' : 'Add',
    });
    if (!reasonCode) return;
    let note: string | null = null;
    if (reasonCode === 'other') {
      note = await this.dialog.prompt({ title: 'What happened?', placeholder: 'Short note…', required: true });
      if (!note) return;
    }
    try {
      await firstValueFrom(this.api.post(`/api/inventory/batches/${b.id}/adjust`, { delta, reasonCode, note }));
      const id = this.expandedId(); if (id) await Promise.all([this.loadBatches(id), this.load(), this.loadAlerts()]);
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
  }
}
