import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { printLabelOnly } from '../../../shared/utils/print-label';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { testListUrl } from '../../../shared/utils/test-list-url';

type InvTab = 'items' | 'bom';

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
  imports: [SkeletonTableComponent, FormsModule, DecimalPipe, DatePipe, BarcodeDisplayComponent, HeroBandComponent, SegmentedComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10 max-w-6xl">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): Items / Test consumables switch. Items: item
             search + category filter in the pill, "New item" in the band.
             Test consumables: the test picker rides the pill (no free-text
             search), "Save consumables" in the band. -->
        <pf-hero-band [back]="true" [tabsOnly]="tab() === 'bom'"
                      placeholder="Search items — name, SKU, unit…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            <pf-segmented size="sm" [options]="tabOptions" [value]="tab()" (valueChange)="setTab($event)"></pf-segmented>
            @if (tab() === 'items') {
              <pf-select class="pf-inv-bandsel" size="sm" [options]="categoryFilterOptions" [value]="category()"
                         (valueChange)="category.set($event)" aria-label="Category"></pf-select>
            } @else {
              <pf-select class="pf-inv-bandsel pf-inv-bandsel--test" size="sm" [options]="testOptions()" [value]="bomTestId()"
                         [searchable]="true" placeholder="Pick a test…"
                         (valueChange)="selectTest($event)" aria-label="Test"></pf-select>
            }
          </ng-container>
          <ng-container band-actions>
            @if (tab() === 'items') {
              <button type="button" class="pf-hb-btn press" [class.pf-hb-btn--primary]="!editing()" [class.pf-hb-btn--ghost]="editing()"
                      (click)="startNew()" aria-label="New item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                New item
              </button>
            } @else if (bomTestId()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="bomSaving()" (click)="saveBom()"
                      aria-label="Save consumables">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                {{ bomSaving() ? 'Saving…' : 'Save consumables' }}
              </button>
            }
          </ng-container>
        </pf-hero-band>
      }
      <div class="pf-classic-only flex items-center justify-between gap-3 mb-5">
        <div>
          <div class="text-[11px] font-bold uppercase tracking-wider" style="color:var(--violet-400)">Admin · Lab</div>
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
        <button class="px-4 py-2 rounded-xl text-sm font-bold text-white" style="background:var(--violet-600,#7c3aed)" (click)="startNew()">New item</button>
      </div>

      <div class="pf-band-body">
      @if (showItems()) {
      <!-- Alerts -->
      @if (lowStock().length || expiring().length) {
        <div class="grid md:grid-cols-2 gap-3 mb-5">
          <div class="nd-card pf-inv-alert">
            <div class="nd-card__head"><span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg></span><span class="nd-card__label">Low stock</span><span class="nd-card__spacer"></span><span class="pf-inv-count nd-num">{{ lowStock().length }}</span></div>
            @for (l of lowStock(); track l.id) {
              <div class="flex justify-between text-sm py-0.5 alert-row"><span class="alert-row__name">{{ l.name }}</span><span class="nd-num" style="color:var(--text-tertiary)">{{ l.onHand | number:'1.0-2' }} / {{ l.reorderLevel | number:'1.0-2' }}</span></div>
            } @empty { <p class="pf-inv-muted">All good.</p> }
          </div>
          <div class="nd-card pf-inv-alert">
            <div class="nd-card__head"><span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span><span class="nd-card__label">Expiring soon</span><span class="nd-card__spacer"></span><span class="pf-inv-count nd-num">{{ expiring().length }}</span></div>
            @for (e of expiring(); track e.id) {
              <div class="flex justify-between text-sm py-0.5 alert-row"><span class="alert-row__name">{{ e.item }} <span style="color:var(--text-muted)">{{ e.lotNumber }}</span></span><span class="nd-num" [style.color]="e.daysLeft < 0 ? 'var(--red-text, #b91c1c)' : 'var(--text-tertiary)'">{{ e.daysLeft < 0 ? 'expired' : e.daysLeft + 'd' }}</span></div>
            } @empty { <p class="pf-inv-muted">Nothing expiring.</p> }
          </div>
        </div>
      }

      <!-- Edit / new item -->
      @if (editing()) {
        <section class="nd-card nd-anim-in pf-inv-editor" [attr.aria-label]="form().id ? 'Edit item' : 'New item'">
          <div class="nd-card__head"><span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg></span><h3 class="nd-card__label">{{ form().id ? 'Edit item' : 'New item' }}</h3>
            @if (form().id && form().name) { <span class="nd-card__note">{{ form().name }}</span> }</div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 pf-inv-editor__body">
            <label class="block"><span class="nd-field__lbl lbl">SKU *</span><input class="nd-input" [class.nd-input--error]="itemError()?.field==='sku'||itemError()?.field==='code'" [ngModel]="form().sku" (ngModelChange)="setF('sku',$event)"/>
              @if (itemError()?.field==='sku'||itemError()?.field==='code') { <span class="fld-err">{{ itemError()!.message }}</span> }
            </label>
            <label class="block md:col-span-2"><span class="nd-field__lbl lbl">Name *</span><input class="nd-input" [class.nd-input--error]="itemError()?.field==='name'" [ngModel]="form().name" (ngModelChange)="setF('name',$event)"/>
              @if (itemError()?.field==='name') { <span class="fld-err">{{ itemError()!.message }}</span> }
            </label>
            <label class="block"><span class="nd-field__lbl lbl">Category</span>
              <pf-select [options]="categoryOptions" [value]="form().category ?? 'consumable'"
                         (valueChange)="setF('category',$event)" aria-label="Category"></pf-select>
            </label>
            <label class="block"><span class="nd-field__lbl lbl">Unit (UoM)</span><input class="nd-input" [ngModel]="form().uom" (ngModelChange)="setF('uom',$event)" placeholder="piece"/></label>
            <label class="block"><span class="nd-field__lbl lbl">Reorder level</span><input class="nd-input nd-num" type="number" [ngModel]="form().reorderLevel" (ngModelChange)="setF('reorderLevel',+$event)"/></label>
            <label class="block"><span class="nd-field__lbl lbl">Near-expiry (days)</span><input class="nd-input nd-num" type="number" [ngModel]="form().nearExpiryDays" (ngModelChange)="setF('nearExpiryDays',+$event)"/></label>
            <div class="flex items-end pb-2">
              <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="!!form().isActive" (click)="setF('isActive', !form().isActive)">
                <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span><span>Active</span>
              </button>
            </div>
          </div>
          <div class="nd-card__foot">
            <button type="button" class="nd-btn nd-btn--tertiary press" (click)="editing.set(false)">Cancel</button>
            <button type="button" class="nd-btn nd-btn--primary press" [disabled]="!canSave()" (click)="saveItem()">{{ form().id ? 'Save item' : 'Create item' }}</button>
          </div>
        </section>
      }

      <!-- Items -->
      @if (loading()) { <div class="nd-card inv-table-wrap"><pf-skeleton-table [rows]="8" [cols]="5" label="Loading inventory…"></pf-skeleton-table></div> }
      @else {
        <div class="nd-card inv-table-wrap">
          <table class="w-full text-sm">
            <thead><tr>
              <th class="text-left p-3">Item</th><th class="text-left p-3">Category</th>
              <th class="text-right p-3">On hand</th><th class="text-right p-3">Reorder</th><th class="p-3"></th>
            </tr></thead>
            <tbody>
              @for (it of visibleItems(); track it.id) {
                <tr class="pf-inv-row">
                  <td class="p-3"><span class="pf-inv-name">{{ it.name }}</span> <span class="nd-num pf-inv-sku">{{ it.sku }}</span>
                    @if (it.lowStock) { <span class="nd-chip nd-chip--static pf-inv-low">Low stock</span> }
                  </td>
                  <td class="p-3" style="color:var(--text-tertiary)">{{ it.category }}</td>
                  <td class="p-3 text-right nd-num">{{ it.onHand | number:'1.0-2' }} <span style="color:var(--text-muted)">{{ it.uom }}</span></td>
                  <td class="p-3 text-right nd-num" style="color:var(--text-muted)">{{ it.reorderLevel | number:'1.0-2' }}</td>
                  <td class="p-3 text-right whitespace-nowrap">
                    <!-- Row actions: text on web, icon on touch. -->
                    <span class="pf-inv-acts">
                      <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="openReceive(it)" aria-label="Receive stock" title="Receive"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg><span class="nd-rowact__t">Receive</span></button>
                      <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="showLabel(it)" aria-label="Label" title="Label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14"/></svg><span class="nd-rowact__t">Label</span></button>
                      <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="toggleBatches(it)" [attr.aria-expanded]="expandedId() === it.id" aria-label="Batches" title="Batches"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg><span class="nd-rowact__t">Batches</span></button>
                      <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="startEdit(it)" aria-label="Edit item" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg><span class="nd-rowact__t">Edit</span></button>
                    </span>
                  </td>
                </tr>
                @if (expandedId() === it.id) {
                  <tr class="pf-inv-expand"><td colspan="5" class="p-3">
                    @if (receiveFor() === it.id) {
                      <div class="flex flex-wrap items-end gap-2 mb-3 p-3 rcv-form">
                        <label class="block"><span class="nd-field__lbl lbl">Lot #</span><input class="nd-input" [ngModel]="rcv().lot" (ngModelChange)="setR('lot',$event)"/></label>
                        <label class="block"><span class="nd-field__lbl lbl">Expiry</span><input class="nd-input nd-num" type="date" [ngModel]="rcv().expiry" (ngModelChange)="setR('expiry',$event)"/></label>
                        <label class="block"><span class="nd-field__lbl lbl">Unit cost</span><input class="nd-input nd-num" type="number" [ngModel]="rcv().cost" (ngModelChange)="setR('cost',+$event)"/></label>
                        <label class="block"><span class="nd-field__lbl lbl">Qty *</span><input class="nd-input" [class.nd-input--error]="rcvError()?.field==='qty'||rcvError()?.field==='quantity'" type="number" [ngModel]="rcv().qty" (ngModelChange)="setR('qty',+$event)"/>
                          @if (rcvError()?.field==='qty'||rcvError()?.field==='quantity') { <span class="fld-err">{{ rcvError()!.message }}</span> }
                        </label>
                        <button type="button" class="nd-btn nd-btn--secondary press" [disabled]="rcv().qty<=0" (click)="receive(it)">Add stock</button>
                      </div>
                    }

                    <!-- Barcode / QR label generator -->
                    @if (labelCode() && expandedId() === it.id) {
                      <div class="label-wrap">
                        <div class="label-wrap__head">
                          <span class="pf-inv-sec">Label</span>
                          <span class="nd-seg" role="radiogroup" aria-label="Label type">
                            <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="labelMode()==='both'" (click)="labelMode.set('both')">Both</button>
                            <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="labelMode()==='barcode'" (click)="labelMode.set('barcode')">Barcode</button>
                            <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="labelMode()==='qr'" (click)="labelMode.set('qr')">QR</button>
                          </span>
                        </div>
                        <div class="label-print pf-print-label">
                          <pf-barcode-display [code]="labelCode()!" [mode]="labelMode()" [showValue]="true"></pf-barcode-display>
                        </div>
                        <div class="flex gap-3 mt-2">
                          <button type="button" class="nd-btn nd-btn--secondary press" (click)="printLabel()">Print label</button>
                          <button type="button" class="nd-btn nd-btn--tertiary press" (click)="labelCode.set(null)">Hide</button>
                        </div>
                      </div>
                    }

                    <div class="pf-inv-sec mb-1">Batches (FEFO)</div>
                    @for (b of batches(); track b.id) {
                      <div class="flex items-center justify-between text-sm py-1 border-b" style="border-color:var(--nd-line)">
                        <span><span class="nd-num">{{ b.lotNumber || '—' }}</span> <span style="color:var(--text-muted)">exp <span class="nd-num">{{ b.expiryDate ? (b.expiryDate | date) : '—' }}</span></span>
                          @if (b.expired) { <span class="ml-1 text-[11px]" style="color:var(--red-text, #b91c1c)">expired</span> }</span>
                        <span class="flex items-center gap-3 nd-num">
                          <span>{{ b.qtyOnHand | number:'1.0-2' }}</span>
                          <button class="text-xs iconbtn" style="color:var(--text-tertiary)" (click)="adjust(b, -1)" aria-label="Decrease">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>
                          </button>
                          <button class="text-xs iconbtn" style="color:var(--text-tertiary)" (click)="adjust(b, 1)" aria-label="Increase">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                          </button>
                        </span>
                      </div>
                    } @empty { <p class="text-sm" style="color:var(--text-muted)">No batches yet — receive stock.</p> }
                  </td></tr>
                }
              } @empty {
                <tr><td colspan="5" class="p-6 text-center" style="color:var(--text-muted)">
                  @if (items().length) { <span class="pf-band-empty-inline">No items match{{ q() ? ' "' + q() + '"' : ' this category' }}.</span> }
                  @else { No items yet. Add your first SKU. }
                </td></tr>
              }
            </tbody>
          </table>
        </div>
      }
      }

      <!-- Per-test consumables (BOM) — drives auto-deduction at collection -->
      @if (showBom()) {
      <div class="pf-inv-bom nd-card">
        <div class="nd-card__head"><span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6"/></svg></span><span class="nd-card__label">Per-test consumables</span></div>
        <div class="pf-inv-bom__body">
        <p class="pf-inv-muted mb-3">Map which items a test consumes. These are auto-deducted (FEFO) from this branch's stock when a sample is collected.</p>
        <!-- New design: the test picker rides the band pill. -->
        <pf-select class="pf-classic-only block" style="max-width:340px" [options]="testOptions()" [value]="bomTestId()"
                   [searchable]="true" placeholder="Select a test…" (valueChange)="selectTest($event)"
                   aria-label="Test"></pf-select>
        @if (theme.isNewDesign() && !bomTestId()) {
          <p class="pf-inv-muted">Pick a test in the bar above to edit what it consumes.</p>
        }

        @if (bomTestId()) {
          <div class="mt-3 space-y-2" style="max-width:560px">
            @for (line of bomLines(); track $index) {
              <div class="flex items-center gap-2 bom-line">
                <pf-select class="bom-line__item" [options]="itemOptions()" [value]="line.itemId" [searchable]="true"
                           placeholder="Item…" (valueChange)="setLine($index,'itemId',$event)" aria-label="Item"></pf-select>
                <input class="nd-input nd-num bom-line__qty" style="width:110px" type="number" min="0" step="0.001" [ngModel]="line.qtyPerTest" (ngModelChange)="setLine($index,'qtyPerTest',+$event)" placeholder="qty/test"/>
                <button type="button" class="text-sm px-2 iconbtn pf-inv-x" (click)="removeLine($index)" aria-label="Remove item" title="Remove item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </div>
            }
            <div class="flex gap-2 pt-1">
              <button type="button" class="nd-btn nd-btn--tertiary touch-link" (click)="addLine()">+ Add item</button>
            </div>
            <button class="pf-classic-only mt-2 px-3 py-2 rounded-lg text-sm font-bold text-white" style="background:var(--violet-600,#7c3aed)" [disabled]="bomSaving()" (click)="saveBom()">{{ bomSaving() ? 'Saving…' : 'Save consumables' }}</button>
          </div>
        }
        </div>
      </div>
      }
      </div>
    </section>
  `,
  styles: [`
    @use '../../../shared/styles/device-tier' as dt;
    .lbl { display:block; margin-bottom:6px; }
    /* ── ND audit: kit cards / rows ── */
    .pf-inv-alert { padding-bottom: 10px; }
    .pf-inv-alert > :not(.nd-card__head) { margin: 0 14px; }
    .pf-inv-alert > .alert-row:first-of-type { margin-top: 8px; }
    .pf-inv-count { font-size: 12px; color: var(--text-tertiary); }
    .pf-inv-muted { margin: 0; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-inv-alert .pf-inv-muted { margin-top: 10px; }
    .pf-inv-editor { margin-bottom: 20px; }
    .pf-inv-editor__body { padding: 16px 18px; }
    .pf-inv-name { font-weight: 600; color: var(--text-primary); }
    .pf-inv-sku { font-size: 12px; color: var(--text-tertiary); }
    .pf-inv-low { height: 22px; margin-left: 8px; font-size: 11px; }
    .pf-inv-row { border-top: 1px solid var(--nd-line); }
    .pf-inv-expand { background: var(--nd-chip-bg); }
    .pf-inv-acts { display: inline-flex; gap: 6px; }
    .pf-inv-sec { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); }
    .pf-inv-x { color: var(--text-tertiary); }
    .pf-inv-x:hover { color: var(--red-text, #b91c1c); }
    .pf-inv-bom__body { padding: 14px 18px 18px; }
    .rcv-form { border-radius: var(--nd-radius); background: var(--nd-card-bg); border: 1px solid var(--nd-line); }
    .rcv-form .nd-btn { height: 40px; min-height: 40px; }
    .inp { width:100%; padding:9px 11px; border-radius:10px; background:var(--glass-bg); border:1px solid var(--glass-border); color:var(--text-primary); font-size:13.5px; }
    .inp:focus { outline:none; border-color:var(--violet-500,#8b5cf6); box-shadow:0 0 0 3px rgba(124,58,237,.16); }
    .inp--err { border-color:var(--red,#ef4444); }
    .fld-err { display:block; font-size:11px; color:var(--red,#ef4444); margin-top:4px; }
    table tbody tr.pf-inv-row:hover td { background:var(--nd-chip-bg); }
    thead th { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.08em; color:var(--text-tertiary);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 3%, var(--nd-card-bg)); }
    .rowbtn { font-size:12px; font-weight:700; padding:5px 10px; border-radius:8px; margin-left:6px; border:1px solid var(--glass-border); background:var(--glass-bg); color:var(--text-secondary); transition:color .14s, border-color .14s; }
    .rowbtn:hover { color:var(--text-primary); border-color:var(--glass-border-hover); }
    .rowbtn--accent { color:var(--violet-300); border-color:rgba(124,58,237,.4); background:rgba(124,58,237,.12); }
    .seg { display:inline-flex; gap:2px; padding:2px; border-radius:8px; border:1px solid var(--glass-border); background:var(--glass-bg); }
    .seg__i { font-size:11px; font-weight:700; padding:4px 10px; border-radius:6px; border:0; background:transparent; color:var(--text-tertiary); }
    .seg__i--on { color:#fff; background:var(--gradient-primary); }
    .label-wrap { margin:4px 0 14px; padding:14px; border-radius:var(--nd-radius); border:1px solid var(--nd-line); background:var(--nd-card-bg); }
    .label-wrap__head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; }
    .label-print { display:inline-block; padding:12px; border-radius:12px; background:#fff; }

    /* Classic stacks the two sections; new design shows one per pill tab. */
    .pf-inv-bom { margin-top: 2rem; }
    :host-context(.design-new) .pf-inv-bom { margin-top: 0; }
    .pf-inv-bandsel { flex-shrink: 0; width: 160px; }
    .pf-inv-bandsel--test { width: 260px; }
    @media (max-width: 640px) {
      .pf-inv-bandsel { width: 150px; }
      .pf-inv-bandsel--test { width: 220px; }
    }

    .pf-hdr-back { width:38px; height:38px; margin-left:-8px; border-radius:11px; color:var(--text-primary); background:transparent; border:0; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background .15s ease, transform .08s ease; }
    .pf-hdr-back:active { transform:scale(0.9); background:var(--glass-bg, rgba(255,255,255,0.06)); }
    @media (hover:hover){ .pf-hdr-back:hover{ background:var(--glass-bg, rgba(255,255,255,0.06)); } }

    /* ---------- Cross-platform additive overrides (do not touch desktop >=1280) ---------- */

    /* The items table is dense (4 row actions + numeric columns). Below desktop, let it
       scroll horizontally inside its own card instead of forcing page-wide overflow. */
    @include dt.tablet-tier {
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
    @include dt.tablet-tier {
      :host .bom-line__item { min-width: 0; }
      :host .alert-row { gap: 12px; }
      :host .alert-row__name { min-width: 0; overflow-wrap: anywhere; }
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

    }
  `]
})
export class InventoryComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  protected readonly navBack = inject(NavBackService);
  protected readonly theme = inject(ThemeService);
  /** Row actions: text on web, icon on touch (ND-PATTERN). */
  protected readonly web = webPointerSignal();
  readonly categories = CATEGORIES;
  readonly categoryOptions: PfSelectOption[] = CATEGORIES.map(c => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }));

  // ── Band pill ────────────────────────────────────────────────
  /** Items vs Test consumables (new design shows one at a time). */
  readonly tab = signal<InvTab>('items');
  readonly tabOptions: SegmentedOption<InvTab>[] = [
    { value: 'items', label: 'Items' },
    { value: 'bom', label: 'Test consumables' },
  ];
  setTab(t: InvTab) { this.tab.set(t); }
  readonly showItems = computed(() => !this.theme.isNewDesign() || this.tab() === 'items');
  readonly showBom = computed(() => !this.theme.isNewDesign() || this.tab() === 'bom');
  /** Item search + category filter ('' = all categories). */
  readonly q = signal('');
  readonly category = signal('');
  readonly categoryFilterOptions: PfSelectOption[] = [{ value: '', label: 'All categories' }, ...this.categoryOptions];
  readonly visibleItems = computed(() => {
    const cat = this.category();
    const rows = cat ? this.items().filter(i => i.category === cat) : this.items();
    return bandFilter(rows, this.q(), i => [i.name, i.sku, i.category, i.uom]);
  });
  readonly testOptions = computed<PfSelectOption[]>(() => this.tests().map(t => ({ value: t.id, label: t.name })));
  readonly itemOptions = computed<PfSelectOption[]>(() =>
    this.items().map(it => ({ value: it.id, label: `${it.name} (${it.uom})` })));

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

  // Field-aware API failures: a matching `.field` highlights the input inline;
  // anything else falls back to a toast with the real backend message.
  readonly itemError = signal<{ field?: string; message: string } | null>(null);
  readonly rcvError = signal<{ field?: string; message: string } | null>(null);

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
    try { this.tests.set(await firstValueFrom(this.api.get<{ id: string; name: string }[]>(testListUrl())) ?? []); }
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
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
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

  startNew() { this.itemError.set(null); this.form.set({ category: 'consumable', uom: 'piece', reorderLevel: 0, nearExpiryDays: 30, isActive: true }); this.editing.set(true); }
  startEdit(it: InvItem) { this.itemError.set(null); this.form.set({ ...it }); this.editing.set(true); }

  async saveItem() {
    if (!this.canSave()) return;
    this.itemError.set(null);
    try {
      await firstValueFrom(this.api.post('/api/inventory/items', this.form()));
      this.editing.set(false); this.toasts.success('Item saved'); await this.load(); await this.loadAlerts();
    } catch (e) {
      const err = ApiError.from(e);
      if (err.field === 'sku' || err.field === 'code' || err.field === 'name') this.itemError.set({ field: err.field, message: err.message });
      else this.toasts.error(err.message);
    }
  }

  async toggleBatches(it: InvItem) {
    if (this.expandedId() === it.id) { this.expandedId.set(null); return; }
    this.expandedId.set(it.id); this.receiveFor.set(null);
    await this.loadBatches(it.id);
  }
  openReceive(it: InvItem) {
    this.expandedId.set(it.id); this.receiveFor.set(it.id);
    this.rcv.set({ lot: '', expiry: '', cost: 0, qty: 0 });
    this.rcvError.set(null);
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
    this.rcvError.set(null);
    try {
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
    }
  }

  async adjust(b: InvBatch, delta: number) {
    try {
      await firstValueFrom(this.api.post(`/api/inventory/batches/${b.id}/adjust`, { delta, reason: delta < 0 ? 'manual decrement' : 'manual increment' }));
      const id = this.expandedId(); if (id) await Promise.all([this.loadBatches(id), this.load(), this.loadAlerts()]);
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
  }
}
