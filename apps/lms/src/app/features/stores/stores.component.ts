import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ModuleRegistry, type ColDef } from 'ag-grid-community';
import { BusyDirective } from '../../shared/directives/busy.directive';
import { SkeletonTableComponent } from '../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../shared/utils/min-duration';
import { busyWhile } from '../../shared/utils/busy';
import { ApiService } from '../../core/services/api.service';
import { ApiError } from '../../shared/models/api-response.model';
import { ToastService } from '../../core/services/toast.service';
import { DialogService } from '../../core/services/dialog.service';
import { ThemeService } from '../../core/services/theme.service';
import { ScanService } from '../../core/services/scan.service';
import { AuthService } from '../../core/auth/auth.service';
import { BarcodeDisplayComponent } from '../../shared/components/barcode-display/barcode-display.component';
import { BarcodeScannerModalComponent } from '../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { NdDateComponent } from '../../shared/components/nd-date/nd-date.component';
import { SegmentedComponent, type SegmentedOption } from '../../shared/primitives/segmented.component';
import { printLabelOnly } from '../../shared/utils/print-label';
import { ScanIconComponent } from '../../shared/components/icons/scan-icon.component';
import { webPointerSignal } from '../../shared/utils/pointer-mode';
import { mediaSignal } from '../../shared/utils/media-query';
import { plural } from '../../shared/utils/plural';
import { gridThemeDark, gridThemeLight } from '../admin/tests/tests/grid-theme';
import {
  STOCK_LEVEL_LABEL, STOCK_LEVEL_TONE, dotCell, expiryView, itemCell, linkBarcodeBody, linkableCode, qty, stockLevel,
} from './inventory-view';

ModuleRegistry.registerModules([AllCommunityModule]);

interface InvItem { id: string; sku: string; barcode?: string; name: string; category?: string; uom: string; onHand: number; lowStock: boolean; reorderLevel: number; nearExpiryDays?: number; isActive?: boolean; }
type StockStatus = 'all' | 'ok' | 'low' | 'out';
type Mode = 'home' | 'scan';
type StockAction = 'receive' | 'issue' | 'count';
type StoresTab = 'home' | StockAction;
interface InvBatch { id: string; lotNumber?: string; lotBarcode?: string; expiryDate?: string; qtyOnHand: number; expired: boolean; }
/** A scan that matched no item: the code read, the code to link (a GS1
 *  scan's GTIN, else the raw code) and what the scan parsed (lot / expiry /
 *  qty) so picking the item still prefills Receive. */
interface UnknownScan { raw: string; code: string; parsed: any }

const ICON = {
  home: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  receive: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  issue: ['M12 21V9', 'm7 14 5-5 5 5', 'M5 3h14'],
  count: ['M9 4h6a1 1 0 0 1 1 1v2H8V5a1 1 0 0 1 1-1Z', 'M8 6H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2', 'm9 14 2 2 4-4'],
} as const;

/**
 * Stores — the inventory operator's work area (ND-PATTERN: band → main card
 * + side card). The band pill holds ONE field and the section tabs
 * (Overview · Receive · Issue · Count):
 *
 *  • Overview — the field searches the STOCK grid (AG-Grid, like Test
 *    Master); ATTENTION (low / out / expiring, neutral numbers with a status
 *    dot) is the side card, a sheet from the band on narrow widths.
 *  • Receive / Issue / Count — the field is the scan box: Enter resolves a
 *    supplier / GS1 / item / lot barcode, typing filters the ITEMS list.
 *    The picked item opens in the side card (a sheet on narrow widths) with
 *    the action's form and its ONE primary button.
 *
 * The lab's Scan / Manual setting (`ScanService.manualEntry`) is honoured:
 * manual mode drops the camera, the "scanner ready" mark and the
 * document-level gun capture, and the field reads "type".
 *
 * Scan robustness: besides the focused field, a document-level keydown
 * listener captures HID-gun bursts even when focus has drifted to a button
 * or the body. It only fires for rapid key sequences outside editable
 * fields, so it never fights manual typing.
 */
@Component({
  selector: 'pf-stores',
  standalone: true,
  imports: [DecimalPipe, DatePipe, NgTemplateOutlet, RouterLink, AgGridAngular, BarcodeDisplayComponent, BarcodeScannerModalComponent, ScanIconComponent,
    BusyDirective, SkeletonTableComponent, HeroBandComponent, NdDateComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./inv-layout.scss'],
  template: `
    <section class="pf-band-page st">
      <pf-hero-band [back]="true" [placeholder]="fieldPlaceholder()" [value]="fieldValue()"
                    (valueChange)="onField($event)" (submitted)="onSubmit($event)">
        <ng-container band-inline>
          @if (mode() === 'scan' && !manual()) {
            <button type="button" class="pf-hb-tool press" (click)="scanning.set(true)" title="Scan with camera" aria-label="Scan with camera">
              <pf-scan-icon [size]="18" />
            </button>
          }
        </ng-container>
        <ng-container band-tools>
          @if (narrow() && mode() === 'home') {
            <button type="button" class="nd-chip st-attn-chip press" (click)="attnOpen.set(true)" aria-haspopup="dialog"
                    [attr.aria-expanded]="attnOpen()" [attr.aria-label]="'Attention, ' + attentionCount()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>
              Attention <span class="nd-num inv-muted">{{ attentionCount() }}</span>
            </button>
          }
          <pf-segmented class="st-tabs" size="sm" [options]="tabOptions()" [value]="tab()" (valueChange)="onTab($event)"></pf-segmented>
        </ng-container>
        <ng-container band-actions>
          @if (canManage()) {
            <a class="pf-hb-btn pf-hb-btn--ghost press" routerLink="/admin/inventory" title="Manage items" aria-label="Manage items">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>
              Manage items
            </a>
          }
          @if (mode() === 'home' && canAction('receive')) {
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="enterAction('receive')" aria-label="Receive stock">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
              Receive stock
            </button>
          }
        </ng-container>
      </pf-hero-band>

      <div class="pf-band-body pf-band-body--fill">
        @if (mode() === 'home') {
          <div class="inv-body">
            <!-- MAIN: stock on hand -->
            <section class="nd-card" aria-labelledby="st-stock-t">
              <header class="nd-card__head">
                <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg></span>
                <span class="nd-card__label" id="st-stock-t">Stock</span>
                <div class="nd-seg st-filter" role="radiogroup" aria-label="Show">
                  @for (f of stockFilters; track f.key) {
                    <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="stockStatus() === f.key" (click)="stockStatus.set(f.key)">
                      {{ f.label }} <span class="nd-num inv-muted">{{ filterCount(f.key) }}</span>
                    </button>
                  }
                </div>
                <span class="nd-card__spacer"></span>
                <span class="inv-count nd-num">{{ itemsLabel() }}</span>
              </header>
              <div class="nd-card__body inv-main__body">
                @if (stockSkeleton()) {
                  <pf-skeleton-table [rows]="6" [cols]="4" label="Loading stock…"></pf-skeleton-table>
                } @else if (!items().length) {
                  <ng-container [ngTemplateOutlet]="noItems"></ng-container>
                } @else {
                  <ag-grid-angular class="inv-grid st-grid" [theme]="gridTheme()" [rowData]="stockRows()" [columnDefs]="stockCols()"
                                   [getRowId]="rowId" [animateRows]="true" [suppressCellFocus]="true"
                                   [overlayNoRowsTemplate]="noMatchHtml"></ag-grid-angular>
                }
              </div>
            </section>

            <!-- SIDE: what needs attention (a sheet on narrow widths) -->
            @if (!narrow()) {
              <aside class="nd-card" aria-labelledby="st-attn-t">
                <ng-container [ngTemplateOutlet]="attentionCard" [ngTemplateOutletContext]="{ sheet: false }"></ng-container>
              </aside>
            } @else if (attnOpen()) {
              <div class="inv-sheet-backdrop" (click)="attnOpen.set(false)"></div>
              <aside class="nd-card inv-side--sheet" role="dialog" aria-modal="true" aria-labelledby="st-attn-t" (keydown.escape)="attnOpen.set(false)">
                <span class="inv-sheet-handle" aria-hidden="true"></span>
                <ng-container [ngTemplateOutlet]="attentionCard" [ngTemplateOutletContext]="{ sheet: true }"></ng-container>
              </aside>
            }
          </div>
        } @else {
          <div class="inv-body">
            <!-- MAIN: the items to act on — the band field filters them -->
            <section class="nd-card" aria-labelledby="st-items-t">
              <header class="nd-card__head">
                <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg></span>
                <span class="nd-card__label" id="st-items-t">Items</span>
                <span class="nd-card__note">{{ manual() ? 'Type a name, SKU or code above — or pick an item' : 'Scan a barcode or type above — or pick an item' }}</span>
                @if (!manual()) {
                  <span class="nd-sdot st-listen" data-tone="done" title="Point the scanner and scan — no need to click the field first">Scanner ready</span>
                }
              </header>
              <div class="nd-card__body st-items-body">
                @if (unknown(); as u) {
                  <div class="inv-note" role="status">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14"/></svg>
                    <div class="inv-note__body">
                      No item has barcode <strong class="nd-num">{{ u.code }}</strong>.
                      @if (canManage()) {
                        Pick the item it belongs to — you can link the barcode to it from the side card, so the next scan finds it.
                      } @else {
                        Pick the item to {{ actionVerb() }} it. To make this barcode scan next time, ask an inventory admin to link it to the item.
                      }
                      <div class="inv-note__actions">
                        <button type="button" class="nd-btn nd-btn--quiet" (click)="unknown.set(null)">Dismiss</button>
                      </div>
                    </div>
                  </div>
                }
                @if (!items().length) {
                  <ng-container [ngTemplateOutlet]="noItems"></ng-container>
                } @else {
                  <ul class="inv-rows" role="list">
                    @for (it of filteredItems(); track it.id) {
                      <li>
                        <button type="button" class="inv-row" [attr.aria-pressed]="resolved()?.item?.id === it.id" (click)="pick(it)">
                          <span class="inv-row__main">
                            <span class="inv-row__name">{{ it.name }}</span>
                            <span class="inv-row__meta nd-num">{{ it.sku }}{{ it.category ? ' · ' + it.category : '' }}</span>
                          </span>
                          <span class="inv-row__end">
                            <span class="inv-row__qty">{{ it.onHand | number:'1.0-2' }} {{ it.uom }}</span>
                            @if (level(it) !== 'ok') { <span class="nd-sdot" [attr.data-tone]="tone(it)">{{ levelLabel(it) }}</span> }
                          </span>
                        </button>
                      </li>
                    } @empty {
                      <li class="nd-empty nd-empty--compact">
                        <p class="nd-empty__title">No items match “{{ term().trim() }}”</p>
                        <p class="nd-empty__body">Check the spelling, or scan the item's barcode.</p>
                      </li>
                    }
                  </ul>
                }
              </div>
            </section>

            <!-- SIDE: the picked item + this action (a sheet on narrow widths) -->
            @if (!narrow()) {
              <aside class="nd-card" aria-labelledby="st-act-t">
                <ng-container [ngTemplateOutlet]="actionCard" [ngTemplateOutletContext]="{ sheet: false }"></ng-container>
              </aside>
            } @else if (resolved()) {
              <div class="inv-sheet-backdrop" (click)="clearPick()"></div>
              <aside class="nd-card inv-side--sheet" role="dialog" aria-modal="true" aria-labelledby="st-act-t" (keydown.escape)="clearPick()">
                <span class="inv-sheet-handle" aria-hidden="true"></span>
                <ng-container [ngTemplateOutlet]="actionCard" [ngTemplateOutletContext]="{ sheet: true }"></ng-container>
              </aside>
            }
          </div>
        }
      </div>
    </section>

    <!-- No items at all: guide to creating them -->
    <ng-template #noItems>
      <div class="nd-empty">
        <span class="nd-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg></span>
        <p class="nd-empty__title">No inventory items yet</p>
        @if (canManage()) {
          <p class="nd-empty__body">Create the items this lab stocks — tubes, reagents, kits — in Inventory. Then receive, issue and count them here.</p>
          <a class="nd-btn nd-btn--secondary nd-empty__action" routerLink="/admin/inventory">Create items</a>
        } @else {
          <p class="nd-empty__body">Items are created in Admin → Inventory. Ask an inventory admin to add the items this lab stocks; they show here to receive, issue and count.</p>
        }
      </div>
    </ng-template>

    <!-- ATTENTION side card -->
    <ng-template #attentionCard let-sheet="sheet">
      <header class="nd-card__head">
        <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg></span>
        <span class="nd-card__label" id="st-attn-t">Attention</span>
        <span class="nd-card__spacer"></span>
        @if (sheet) {
          <button type="button" class="nd-btn nd-btn--icon inv-close" (click)="attnOpen.set(false)" aria-label="Close attention">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>
      <div class="nd-card__body">
        <div class="inv-kpis" role="list" aria-label="Stock summary">
          <div class="inv-kpi" role="listitem"><span class="inv-kpi__v">{{ kpis().low | number }}</span><span class="nd-sdot" data-tone="warn">Low</span></div>
          <div class="inv-kpi" role="listitem"><span class="inv-kpi__v">{{ kpis().out | number }}</span><span class="nd-sdot" data-tone="bad">Out</span></div>
          <div class="inv-kpi" role="listitem"><span class="inv-kpi__v">{{ expiring().length | number }}</span><span class="nd-sdot" data-tone="warn">Expiring</span></div>
        </div>

        <p class="inv-title">Expiring soon</p>
        <div>
          @for (e of expiring(); track e.id) {
            <div class="inv-line">
              <span class="inv-line__main">
                <span class="inv-line__name">{{ e.item }}</span>
                <span class="inv-line__meta nd-num">{{ e.lotNumber ? 'Lot ' + e.lotNumber : 'No lot' }}{{ e.qtyOnHand != null ? ' · ' + (e.qtyOnHand | number:'1.0-2') + ' left' : '' }}</span>
              </span>
              <span class="inv-line__end"><span class="nd-sdot" [attr.data-tone]="expiry(e.daysLeft).tone">{{ expiry(e.daysLeft).label }}</span></span>
            </div>
          } @empty { <p class="inv-sub">Nothing expiring within its item's near-expiry window.</p> }
        </div>

        <p class="inv-title">At or below reorder level</p>
        <div>
          @for (l of lowStock(); track l.id) {
            <div class="inv-line">
              <span class="inv-line__main">
                <span class="inv-line__name">{{ l.name }}</span>
                @if (l.sku) { <span class="inv-line__meta nd-num">{{ l.sku }}</span> }
              </span>
              <span class="inv-line__end nd-num"><span class="inv-strong">{{ l.onHand | number:'1.0-2' }}</span><span class="inv-muted">/ {{ l.reorderLevel | number:'1.0-2' }}</span></span>
            </div>
          } @empty { <p class="inv-sub">Every item is above its reorder level.</p> }
        </div>
      </div>
    </ng-template>

    <!-- ACTION side card: Receive / Issue / Count for the picked item -->
    <ng-template #actionCard let-sheet="sheet">
      <header class="nd-card__head">
        <span class="nd-card__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            @for (d of actionIcon(); track d) { <path [attr.d]="d"/> }
          </svg>
        </span>
        <span class="nd-card__label" id="st-act-t">{{ actionTitle() }}</span>
        <span class="nd-card__spacer"></span>
        @if (resolved()) {
          <button type="button" class="nd-btn nd-btn--icon inv-close" (click)="clearPick()" [attr.aria-label]="sheet ? 'Close' : 'Clear the picked item'" [title]="sheet ? 'Close' : 'Clear'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>

      @if (resolved(); as r) {
        <div class="nd-card__body">
          <div class="inv-subject">
            <div>
              <p class="inv-subject__name">{{ r.item.name }}</p>
              <p class="inv-subject__meta nd-num">{{ r.item.sku }}{{ r.item.category ? ' · ' + r.item.category : '' }}</p>
            </div>
            <div class="inv-onhand">
              <span class="inv-onhand__v">{{ r.item.onHand | number:'1.0-2' }}</span>
              <span class="inv-onhand__u">{{ r.item.uom }} on hand</span>
              @if (level(r.item) !== 'ok') { <span class="nd-sdot" [attr.data-tone]="tone(r.item)">{{ levelLabel(r.item) }}</span> }
            </div>
          </div>

          @if (unknown(); as u) {
            <div class="inv-note">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14"/></svg>
              <div class="inv-note__body">
                @if (canManage()) {
                  Link barcode <strong class="nd-num">{{ u.code }}</strong> to this item so the next scan finds it.
                  <div class="inv-note__actions">
                    <button type="button" class="nd-btn nd-btn--quiet" (click)="linkBarcode(r.item)" [disabled]="linking()" [pfBusy]="linking()" pfBusyLabel="Linking…">Link barcode</button>
                  </div>
                } @else {
                  Barcode <strong class="nd-num">{{ u.code }}</strong> isn't on any item. You can still {{ actionVerb() }} this item; an inventory admin can link the barcode in Admin → Inventory.
                }
              </div>
            </div>
          }

          @if (action() === 'receive') {
            <div class="inv-fields">
              <div class="nd-field"><label class="nd-field__lbl" for="st-lot">Lot no.</label>
                <input id="st-lot" class="nd-input nd-num" autocomplete="off" [value]="rcv().lot" (input)="setR('lot', $any($event.target).value)" /></div>
              <div class="nd-field"><span class="nd-field__lbl">Expiry</span>
                <pf-nd-date label="Expiry" [value]="rcv().expiry || null" (valueChange)="setR('expiry', $event ?? '')"></pf-nd-date></div>
              <div class="nd-field"><label class="nd-field__lbl" for="st-cost">Unit cost (₹)</label>
                <input id="st-cost" class="nd-input nd-num" type="number" min="0" step="0.01" inputmode="decimal" [value]="rcv().cost || ''" (input)="setR('cost', +$any($event.target).value)" /></div>
              <div class="nd-field"><label class="nd-field__lbl" for="st-qty">Quantity ({{ r.item.uom }}) <span class="nd-dot-unpriced" aria-label="required"></span></label>
                <input id="st-qty" class="nd-input nd-num" type="number" min="0" inputmode="decimal" [value]="rcv().qty || ''" (input)="setR('qty', +$any($event.target).value)" /></div>
            </div>
            @if (prefilled()) { <p class="inv-sub">Lot, expiry and quantity were read from the barcode — check them before receiving.</p> }
            @if (lastLabel()) {
              <p class="inv-title">Lot label</p>
              <div class="inv-label">
                <div class="nd-seg" role="radiogroup" aria-label="Label type">
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="labelMode() === 'both'" (click)="labelMode.set('both')">Both</button>
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="labelMode() === 'barcode'" (click)="labelMode.set('barcode')">Barcode</button>
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="labelMode() === 'qr'" (click)="labelMode.set('qr')">QR</button>
                </div>
                <div class="inv-label__paper pf-print-label">
                  <pf-barcode-display [code]="lastLabel()!" [mode]="labelMode()" [showValue]="true"></pf-barcode-display>
                </div>
              </div>
            }
          }

          @if (action() === 'issue') {
            <div class="inv-fields">
              <div class="nd-field inv-span"><label class="nd-field__lbl" for="st-iq">Quantity to issue ({{ r.item.uom }}) <span class="nd-dot-unpriced" aria-label="required"></span></label>
                <input id="st-iq" class="nd-input nd-num" type="number" min="0" inputmode="decimal" [value]="issueQty() || ''" (input)="issueQty.set(+$any($event.target).value)" /></div>
            </div>
            <p class="inv-sub">The earliest-expiring lot that isn't expired is used first (FEFO). Expired stock is never issued.</p>
          }

          @if (action() === 'count') {
            <p class="inv-title">Lots at this branch — enter what you counted</p>
            <div>
              @for (b of r.batches; track b.id) {
                <div class="inv-line st-count">
                  <span class="inv-line__main">
                    <span class="inv-line__name nd-num">{{ b.lotNumber || 'No lot no.' }}</span>
                    <span class="inv-line__meta nd-num">exp {{ b.expiryDate ? (b.expiryDate | date:'d MMM y') : '—' }} · system {{ b.qtyOnHand | number:'1.0-2' }}
                      @if (b.expired) { · <span class="nd-sdot" data-tone="bad">Expired</span> }</span>
                  </span>
                  <span class="inv-line__end">
                    <input class="nd-input nd-num st-count__in" type="number" min="0" inputmode="decimal" placeholder="Count"
                           [attr.aria-label]="'Counted quantity for lot ' + (b.lotNumber || 'without number')"
                           [value]="countValue(b.id)" (input)="setCount(b.id, +$any($event.target).value)" />
                    <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" [disabled]="busy()" [pfBusy]="busy() && countingId() === b.id" pfBusyLabel="Saving…"
                            (click)="doCount(b)" [attr.aria-label]="'Save count for lot ' + (b.lotNumber || 'without number')">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                      <span class="nd-rowact__t">Save</span>
                    </button>
                  </span>
                </div>
              } @empty { <p class="inv-sub">No lots of this item at this branch yet — receive stock first.</p> }
            </div>
            <p class="inv-sub">A count that differs from the system adjusts the lot and is kept in the item's ledger.</p>
          }
        </div>

        @if (action() === 'receive') {
          <div class="nd-card__foot">
            @if (lastLabel()) {
              <button type="button" class="nd-btn nd-btn--secondary" (click)="printLabel()">Print label</button>
            } @else {
              <button type="button" class="nd-btn nd-btn--secondary" (click)="clearPick()">Cancel</button>
            }
            <button type="button" class="nd-btn" [class.nd-btn--primary]="rcv().qty > 0" [class.nd-btn--secondary]="rcv().qty <= 0"
                    [disabled]="busy() || rcv().qty <= 0" [pfBusy]="busy()" pfBusyLabel="Receiving…" (click)="doReceive(r.item)">
              Receive {{ rcv().qty > 0 ? (rcv().qty | number:'1.0-2') + ' ' + r.item.uom : 'stock' }}
            </button>
          </div>
        }
        @if (action() === 'issue') {
          <div class="nd-card__foot">
            <button type="button" class="nd-btn nd-btn--secondary" (click)="clearPick()">Cancel</button>
            <button type="button" class="nd-btn" [class.nd-btn--primary]="issueQty() > 0" [class.nd-btn--secondary]="issueQty() <= 0"
                    [disabled]="busy() || issueQty() <= 0" [pfBusy]="busy()" pfBusyLabel="Issuing…" (click)="doIssue(r.item)">
              Issue {{ issueQty() > 0 ? (issueQty() | number:'1.0-2') + ' ' + r.item.uom : 'stock' }}
            </button>
          </div>
        }
      } @else {
        <div class="nd-card__body">
          <div class="nd-empty">
            <span class="nd-empty__icon" aria-hidden="true">
              @if (manual()) {
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              } @else { <pf-scan-icon [size]="20" /> }
            </span>
            <p class="nd-empty__title">{{ manual() ? 'Find an item' : 'Scan or pick an item' }}</p>
            <p class="nd-empty__body">{{ emptyHint() }}</p>
            @if (lastScan()) { <p class="nd-empty__body">Last read <span class="nd-num inv-strong">{{ lastScan() }}</span></p> }
          </div>
        </div>
      }
    </ng-template>

    @if (scanning()) {
      <pf-barcode-scanner-modal title="Scan inventory barcode" noun="item"
        (matched)="onCameraScan($event)" (cancelled)="scanning.set(false)"></pf-barcode-scanner-modal>
    }
  `,
  styles: [`
    .st-tabs { flex-shrink: 0; }
    .st-attn-chip { flex-shrink: 0; height: 32px; }
    .st-filter { flex: none; }
    .st-listen { font-size: 12px; }
    .st-items-body { padding: 10px 6px; }
    .st-items-body > .inv-note { margin: 0 8px; }
    .st-items-body .inv-rows { padding: 0 2px; }
    .st-count__in { width: 96px; height: 40px; }
    @media (max-width: 640px) {
      .st-filter { order: 10; flex: 1 1 100%; overflow-x: auto; scrollbar-width: none; }
      .st-filter .nd-seg__item { flex: 1 0 auto; min-height: 36px; }
      .st-count { flex-wrap: wrap; }
      .st-count .inv-line__end { flex: 1 1 100%; justify-content: flex-end; }
      .st-count__in { flex: 1 1 auto; width: auto; height: 44px; }
    }
    @media (pointer: coarse) { .st-filter .nd-seg__item { min-height: 40px; } }
  `],
})
export class StoresComponent implements OnInit, AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly scan = inject(ScanService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Row actions: text on web, icon on touch (ND-PATTERN). */
  protected readonly web = webPointerSignal();
  /** ≤900px: no side column — side cards become sheets. */
  protected readonly narrow = mediaSignal('(max-width: 900px)');
  private readonly phone = mediaSignal('(max-width: 640px)');
  /** The lab's Scan / Manual identification setting. */
  readonly manual = computed(() => this.scan.manualEntry());
  protected readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));

  readonly mode = signal<Mode>('home');
  readonly action = signal<StockAction>('receive');
  readonly items = signal<InvItem[]>([]);
  readonly lowStock = signal<any[]>([]);
  readonly expiring = signal<any[]>([]);
  /** One box drives both scan-resolve (Enter) and live item filtering. */
  readonly term = signal('');
  readonly lastScan = signal('');
  private lastParsed: any = null;
  /** The last scan matched no item (Receive / Issue / Count). */
  readonly unknown = signal<UnknownScan | null>(null);
  readonly scanning = signal(false);
  readonly busy = signal(false);
  readonly linking = signal(false);
  /** The narrow-width ATTENTION sheet. */
  readonly attnOpen = signal(false);
  /** The batch whose count is saving (its Save shows the busy state). */
  readonly countingId = signal<string | null>(null);
  /** Resolve (scan / typed code lookup) request in flight. */
  readonly resolving = signal(false);
  /** First-load skeleton for the stock grid (ND-PATTERN "Loading feedback"). */
  private readonly stockHold = createLoadHold(true);
  readonly stockSkeleton = this.stockHold.active;
  readonly resolved = signal<{ item: InvItem; batches: InvBatch[] } | null>(null);
  readonly lastLabel = signal<string | null>(null);
  /** The receive form was filled from a parsed GS1 scan. */
  readonly prefilled = signal(false);

  readonly rcv = signal<{ lot: string; expiry: string; cost: number; qty: number }>({ lot: '', expiry: '', cost: 0, qty: 0 });
  readonly issueQty = signal(0);
  readonly countDraft = signal<Record<string, number>>({});
  readonly labelMode = signal<'both' | 'barcode' | 'qr'>('both');

  // Document-level HID-gun capture buffer (used only when focus is NOT in an
  // editable field — the focused band field handles its own Enter).
  private hidBuffer = '';
  private hidLastKey = 0;

  readonly branchName = () => this.auth.user()?.branchName ?? '';
  private can(p: string) { return this.auth.hasPermission(p) || this.auth.hasPermission('manage_inventory'); }
  /** Item config (create items, link barcodes) is Admin → Inventory's permission. */
  readonly canManage = () => this.auth.hasPermission('manage_inventory');
  readonly actions: Array<{ key: StockAction; label: string; sub: string; can: () => boolean }> = [
    { key: 'receive', label: 'Receive', sub: 'add stock', can: () => this.can('inventory_receive') },
    { key: 'issue', label: 'Issue', sub: 'deduct (FEFO)', can: () => this.can('inventory_issue') },
    { key: 'count', label: 'Count', sub: 'reconcile', can: () => this.can('inventory_count') },
  ];
  readonly allowedActions = computed(() => this.actions.filter(a => a.can()));
  canAction(a: StockAction) { return this.allowedActions().some(x => x.key === a); }

  // ── Band: tabs + the one field ──────────────────────────────────
  readonly tab = computed<StoresTab>(() => (this.mode() === 'home' ? 'home' : this.action()));
  readonly tabOptions = computed<SegmentedOption<StoresTab>[]>(() => [
    { value: 'home', label: 'Overview', iconPath: [...ICON.home] },
    ...this.allowedActions().map(a => ({ value: a.key as StoresTab, label: a.label, iconPath: [...ICON[a.key]] })),
  ]);
  onTab(t: StoresTab) { if (t === 'home') this.goHome(); else this.enterAction(t); }
  readonly fieldValue = computed(() => (this.mode() === 'home' ? this.stockQuery() : this.term()));
  readonly fieldPlaceholder = computed(() => {
    if (this.mode() === 'home') return 'Search stock — name, SKU or category';
    if (this.manual()) return 'Type an item name, SKU or barcode';
    return this.action() === 'receive' ? 'Scan a supplier barcode, or type to find an item' : 'Scan an item or lot barcode, or type to find an item';
  });
  onField(v: string) { if (this.mode() === 'home') this.stockQuery.set(v); else this.term.set(v); }
  onSubmit(v: string) { if (this.mode() === 'scan') this.resolve(v); }

  readonly actionTitle = computed(() => ({ receive: 'Receive stock', issue: 'Issue stock', count: 'Stock count' })[this.action()]);
  readonly actionIcon = computed(() => ICON[this.action()]);
  readonly actionVerb = computed(() => ({ receive: 'receive', issue: 'issue', count: 'count' })[this.action()]);
  readonly emptyHint = computed(() => {
    const how = this.manual() ? 'Type its name, SKU or barcode in the bar above' : 'Scan its barcode with the scanner or the camera';
    return ({
      receive: `${how}, or pick it from the list. A supplier GS1 barcode fills in the lot, expiry and quantity.`,
      issue: `${how}, or pick it from the list, then enter how much is used.`,
      count: `${how}, or pick it from the list, then enter what you counted for each lot.`,
    })[this.action()];
  });

  readonly filteredItems = computed(() => {
    const s = this.term().trim().toLowerCase();
    const list = this.items();
    return s ? list.filter(i => (i.name + ' ' + i.sku + ' ' + (i.category ?? '') + ' ' + (i.barcode ?? '')).toLowerCase().includes(s)) : list;
  });

  // ── Overview stock grid ─────────────────────────────────────────
  readonly stockQuery = signal('');
  readonly stockStatus = signal<StockStatus>('all');
  readonly stockFilters: Array<{ key: StockStatus; label: string }> = [
    { key: 'all', label: 'All' }, { key: 'ok', label: 'In stock' },
    { key: 'low', label: 'Low' }, { key: 'out', label: 'Out' },
  ];

  statusOf(it: InvItem): 'ok' | 'low' | 'out' { return stockLevel(it); }
  level(it: InvItem) { return stockLevel(it); }
  tone(it: InvItem) { return STOCK_LEVEL_TONE[stockLevel(it)]; }
  levelLabel(it: InvItem) { return STOCK_LEVEL_LABEL[stockLevel(it)]; }
  expiry(daysLeft: number) { return expiryView(daysLeft); }

  readonly kpis = computed(() => {
    let inStock = 0, low = 0, out = 0;
    for (const it of this.items()) {
      const s = this.statusOf(it);
      if (s === 'out') out++; else if (s === 'low') low++; else inStock++;
    }
    return { total: this.items().length, inStock, low, out };
  });
  filterCount(k: StockStatus) {
    const k2 = this.kpis();
    return k === 'all' ? k2.total : k === 'ok' ? k2.inStock : k === 'low' ? k2.low : k2.out;
  }
  readonly attentionCount = computed(() => this.kpis().low + this.kpis().out + this.expiring().length);
  readonly itemsLabel = computed(() => plural(this.stockRows().length, 'item'));

  readonly stockRows = computed(() => {
    const s = this.stockQuery().trim().toLowerCase();
    const st = this.stockStatus();
    return this.items().filter(it => {
      if (st !== 'all' && this.statusOf(it) !== st) return false;
      return !s || (it.name + ' ' + it.sku + ' ' + (it.category ?? '')).toLowerCase().includes(s);
    });
  });

  readonly rowId = (p: { data: InvItem }) => p.data.id;
  readonly noMatchHtml = '<span class="inv-sub">No items match — clear the search or the filter.</span>';
  readonly stockCols = computed<ColDef<InvItem>[]>(() => {
    const phone = this.phone();
    return [
      { colId: 'item', headerName: 'Item', flex: 2, minWidth: 150, autoHeight: true, wrapText: true, sortable: true,
        valueGetter: p => p.data?.name ?? '',
        cellRenderer: (p: { data?: InvItem }) => itemCell(p.data?.name ?? '', [p.data?.sku, p.data?.category].filter(Boolean).join(' · ')) },
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

  async ngOnInit() {
    this.action.set(this.allowedActions()[0]?.key ?? 'receive');
    await Promise.all([this.loadItems(), this.loadAlerts()]);
    this.stockHold.done();
  }
  ngAfterViewInit() { this.focusScan(); }

  /** Global keystroke capture for HID scanner guns. Fires only when focus is
   *  outside an editable element and the keys arrive in a rapid burst — so a
   *  scan isn't lost just because the operator clicked a button first.
   *  Off in the lab's Manual mode (no scanning there). */
  @HostListener('document:keydown', ['$event'])
  onDocKey(ev: KeyboardEvent) {
    if (this.mode() === 'home' || this.scanning() || this.manual()) return;
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

  /** Focus the band field for the next scan — on web only: on touch it
   *  would raise the keyboard over the sheet after every action. */
  private focusScan() {
    if (!this.web()) return;
    setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.pf-hb__input')?.focus(), 0);
  }

  private async loadItems() {
    try { this.items.set(await firstValueFrom(this.api.get<InvItem[]>('/api/inventory/items')) ?? []); } catch { /* */ }
  }
  private async loadAlerts() {
    try { const a = await firstValueFrom(this.api.get<any>('/api/inventory/alerts')); this.lowStock.set(a?.lowStock ?? []); this.expiring.set(a?.expiring ?? []); } catch { /* */ }
  }

  /** Tab click: enter the scan surface for an action. Coming from Overview
   *  starts fresh; switching between action tabs keeps the picked item. */
  enterAction(a: StockAction) {
    if (this.mode() !== 'scan') { this.mode.set('scan'); this.resolved.set(null); this.term.set(''); this.lastLabel.set(''); this.unknown.set(null); }
    this.setAction(a);
  }
  /** Switch the action without losing the picked item — scan once, then
   *  Receive / Issue / Count the same item. */
  setAction(a: StockAction) {
    this.action.set(a);
    const r = this.resolved();
    if (r) {
      if (a === 'count') this.loadBatchesFor(r.item.id);
      if (a === 'receive') this.prefillReceive(this.lastParsed);
    }
    this.focusScan();
  }
  goHome() { this.mode.set('home'); this.resolved.set(null); this.unknown.set(null); this.loadAlerts(); this.loadItems(); }
  setR(k: string, v: unknown) { this.rcv.update(r => ({ ...r, [k]: v })); }
  countValue(id: string): number | '' { const v = this.countDraft()[id]; return v == null ? '' : v; }
  setCount(id: string, v: number) { this.countDraft.update(d => ({ ...d, [id]: v })); }
  clearPick() { this.resolved.set(null); this.lastLabel.set(''); this.focusScan(); }

  onCameraScan(code: string) { this.scanning.set(false); this.resolve(code); }

  private prefillReceive(parsed: any) {
    this.rcv.set({
      lot: parsed?.lot ?? '',
      expiry: parsed?.expiry ? String(parsed.expiry).substring(0, 10) : '',
      cost: 0,
      qty: parsed?.qty ?? 1,
    });
    this.prefilled.set(!!(parsed?.lot || parsed?.expiry || parsed?.qty));
  }

  async resolve(code: string) {
    const c = (code ?? '').trim();
    if (!c) return;
    this.lastScan.set(c);
    // Guard against partial reads — a 1-char "scan" is almost certainly a
    // dropped burst, not a real barcode.
    if (c.length < 3) { this.toasts.warning('That scan looked incomplete — try again.'); this.focusScan(); return; }
    try {
      const r: any = await firstValueFrom(this.api.post('/api/inventory/scan/resolve', { code: c }).pipe(busyWhile(this.resolving)));
      if (!r?.item) {
        // Truthful copy: picking an item does NOT link the barcode by
        // itself — the side card offers "Link barcode" (manage_inventory).
        this.unknown.set({ raw: c, code: linkableCode(c, r?.parsed), parsed: r?.parsed ?? null });
        this.lastParsed = r?.parsed ?? null;
        this.toasts.warning(`No item has barcode ${linkableCode(c, r?.parsed)} — pick the item from the list.`);
        this.resolved.set(null);
        this.term.set('');
        this.focusScan();
        return;
      }
      this.unknown.set(null);
      this.lastParsed = r.parsed ?? null;
      this.resolved.set({ item: r.item, batches: r.batches ?? [] });
      this.lastLabel.set('');
      if (this.action() === 'count') this.loadBatchesFor(r.item.id);
      // Prefill receive form from parsed GS1 (lot/expiry/qty).
      if (this.action() === 'receive' && r.parsed) this.prefillReceive(r.parsed);
      this.term.set('');
      this.focusScan();
    } catch (e) { this.toasts.error(ApiError.from(e).message); this.focusScan(); }
  }

  pick(it: InvItem) {
    // After an unknown scan the parsed lot / expiry / qty still apply.
    const parsed = this.unknown()?.parsed ?? null;
    this.lastParsed = parsed;
    this.resolved.set({ item: it, batches: [] });
    this.lastLabel.set('');
    this.term.set('');
    if (this.action() === 'count') this.loadBatchesFor(it.id);
    if (this.action() === 'receive') this.prefillReceive(parsed);
  }
  private async loadBatchesFor(itemId: string) {
    try {
      const b = await firstValueFrom(this.api.get<InvBatch[]>(`/api/inventory/items/${itemId}/batches`)) ?? [];
      this.resolved.update(r => r ? { ...r, batches: b } : r);
    } catch { /* */ }
  }

  /** Link the unknown scanned barcode to the picked item (Admin → Inventory's
   *  item upsert, `manage_inventory`). The item has ONE barcode, so an
   *  existing one is replaced — confirmed first; lot labels are unaffected. */
  async linkBarcode(item: InvItem) {
    const u = this.unknown(); if (!u || this.linking()) return;
    if (item.barcode && item.barcode !== u.code) {
      const ok = await this.dialog.confirm({
        title: `Link ${u.code} to ${item.name}?`,
        message: `It replaces the item's barcode ${item.barcode}. Item labels printed with the old barcode stop scanning; lot labels keep working.`,
        confirmLabel: 'Link barcode', tone: 'primary',
      });
      if (!ok) return;
    }
    this.linking.set(true);
    try {
      await firstValueFrom(this.api.post('/api/inventory/items', linkBarcodeBody(item, u.code)));
      this.toasts.success(`Barcode linked — scanning ${u.code} now finds ${item.name}`);
      this.unknown.set(null);
      const r = this.resolved();
      if (r?.item.id === item.id) this.resolved.set({ ...r, item: { ...r.item, barcode: u.code } });
      await this.loadItems();
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    this.linking.set(false);
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
      this.prefilled.set(false);
      await this.loadItems();
      const fresh = this.items().find(i => i.id === item.id);
      const cur = this.resolved();
      if (fresh && cur?.item.id === item.id) this.resolved.set({ ...cur, item: fresh });
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
    this.countingId.set(b.id);
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
