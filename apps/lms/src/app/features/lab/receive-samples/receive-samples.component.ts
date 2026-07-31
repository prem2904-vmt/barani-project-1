import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { Order, OrderSample } from '../../../shared/models/order.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { patientDisplayName, formatPatientInfo } from '../../../shared/models/patient.model';
import { Department } from '../../../shared/models/tenant.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { NumPadComponent } from '../../../shared/primitives/num-pad.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';

const LAST_DEPT_KEY = 'pf-lms.receive.last-dept-code';

@Component({
  selector: 'pf-receive-samples',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    AvatarComponent,
    NumPadComponent,
    ScreenHeaderComponent,
    SelectComponent,
    TileComponent,
    TouchButtonComponent,
    KpiStripComponent,
    BarcodeScannerModalComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section [class.px-4]="!embedded" [class.md:px-8]="!embedded" [class.pt-6]="!embedded" [class.pb-10]="!embedded"
             [class.pf-rs-page]="!embedded">

      @if (!embedded) {
        <div class="pf-rs-chrome">
          <pf-kpi-strip screen="receive_samples"></pf-kpi-strip>
          <pf-screen-header
            eyebrow="Lab intake"
            title="Receive samples"
            subtitle="Scan incoming barcodes or batch-receive the in-transit list.">
            <pf-touch-btn actions size="sm" variant="secondary" (pressed)="refresh()">
              <span icon-left aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/>
                  <path d="M21 3v5h-5"/>
                  <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/>
                  <path d="M3 21v-5h5"/>
                </svg>
              </span>
              Refresh
            </pf-touch-btn>
          </pf-screen-header>
        </div>
      }

      <div [class.pf-rs-scroll]="!embedded">

      <!-- Scan hero — hidden when embedded (the parent pane header
           hosts a camera-icon shortcut that opens the same scanner via
           openBarcodeScanner(); barcode auto-intakes on match). -->
      @if (!embedded) {
      <pf-tile tone="violet" padding="lg" class="block mb-6">
        <label class="text-[11px] font-mono uppercase tracking-[0.16em] mb-2 block"
               style="color: var(--text-muted);">Scan barcode</label>
        <div class="flex gap-2 pf-rs-scanrow">
          <div class="scan-field">
            <svg class="scan-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
              <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
              <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
              <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
              <path d="M7 8v8M11 8v8M15 8v8M19 8v3"/>
            </svg>
            <input type="text"
                   placeholder="PF-AP-2026-00001-HAEM"
                   [ngModel]="scanValue()" (ngModelChange)="scanValue.set($event)"
                   (keydown.enter)="receiveByBarcode()"
                   autofocus />
          </div>
          <pf-touch-btn size="md" variant="primary"
                        [disabled]="!scanValue() || busy()"
                        (pressed)="receiveByBarcode()">
            Receive
            <span icon-right aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14"/>
                <path d="m12 5 7 7-7 7"/>
              </svg>
            </span>
          </pf-touch-btn>
        </div>

        <div class="manual-toggle">
          <button type="button" class="manual-link" (click)="toggleManual()">
            @if (manualMode()) { ✕ Close manual entry } @else { Or enter manually → }
          </button>
        </div>
      </pf-tile>
      }

      <!-- ─── Package intake (PKG-XXXX) — hidden when embedded ─────
           Receive an entire bundle of orders in one tap by scanning /
           typing the dispatch package code reception generated. -->
      @if (!embedded) {
      <pf-tile tone="default" padding="lg" class="block mb-6">
        <div class="flex items-center justify-between mb-2">
          <label class="text-[11px] font-mono uppercase tracking-[0.16em] block"
                 style="color: var(--text-muted);">Package intake</label>
          <span class="text-[10.5px] font-mono" style="color: var(--text-tertiary);">
            Bulk receive · 1 scan handles many orders
          </span>
        </div>
        <div class="flex gap-2 pf-rs-scanrow pf-rs-scanrow--pkg">
          <div class="scan-field">
            <svg class="scan-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <path d="M14 14h3v3h-3zM20 14h1M14 20h3v1h-3zM20 17v4"/>
            </svg>
            <input type="text"
                   placeholder="PKG-7XQ4M2"
                   [ngModel]="pkgCode()"
                   (ngModelChange)="pkgCode.set($event); clearPackagePreview()"
                   (keydown.enter)="previewPackage()"
                   autocomplete="off"/>
          </div>
          <pf-touch-btn size="md" variant="secondary"
                        (pressed)="openPackageScanner()"
                        title="Open camera to scan the package QR">
            <span icon-left aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <path d="M14 14h3v3h-3zM20 14h1M14 20h3v1h-3zM20 17v4"/>
              </svg>
            </span>
            Scan QR
          </pf-touch-btn>
          <pf-touch-btn size="md" variant="primary"
                        [disabled]="!pkgCode() || pkgBusy()"
                        (pressed)="previewPackage()">
            Look up
          </pf-touch-btn>
        </div>
        @if (pkgError()) {
          <p class="text-[12px] mt-3" style="color: var(--red-text);">{{ pkgError() }}</p>
        }
        @if (pkgPreview(); as pkg) {
          <div class="pkg-preview">
            <div class="flex items-center justify-between gap-3 mb-2">
              <div>
                <p class="pkg-preview__code">{{ pkg.code }}</p>
                <p class="pkg-preview__sub">
                  {{ pkg.orderCount }} order{{ pkg.orderCount === 1 ? '' : 's' }}
                  @if (pkg.receivedAt) {
                    · <span style="color: var(--green-text);">already received</span>
                  }
                </p>
              </div>
              <pf-touch-btn size="md" variant="primary"
                            [disabled]="pkgBusy() || !!pkg.receivedAt"
                            (pressed)="receivePackage()">
                @if (pkg.receivedAt) { Received } @else { Receive {{ pkg.orderCount }} order{{ pkg.orderCount === 1 ? '' : 's' }} }
              </pf-touch-btn>
            </div>
            <ul class="pkg-preview__list">
              @for (o of pkg.orders; track o.id) {
                <li class="pkg-preview__row">
                  <span class="pkg-preview__name">{{ o.patientName }}</span>
                  <span class="pkg-preview__meta">
                    #{{ o.id.slice(0, 8) }} · {{ o.sampleCount }} sample{{ o.sampleCount === 1 ? '' : 's' }} · {{ o.status }}
                  </span>
                </li>
              }
            </ul>
          </div>
        }
      </pf-tile>
      }

      @if (manualMode() && !embedded) {
        <pf-tile tone="default" padding="lg" class="block mb-6">
          <label class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3 block"
                 style="color: var(--text-muted);">Manual barcode entry</label>

          <div class="seg-row">
            <span class="seg seg--locked">PF</span>
            <span class="seg-sep">·</span>
            <span class="seg seg--locked">{{ vendorCode() || '??' }}</span>
            <span class="seg-sep">·</span>
            <span class="seg seg--locked">{{ currentYear }}</span>
            <span class="seg-sep">·</span>
            <input class="seg seg--input"
                   inputmode="numeric"
                   pattern="[0-9]*"
                   maxlength="5"
                   placeholder="00000"
                   [ngModel]="seqValue()"
                   (ngModelChange)="onSeqChange($event)" />
            <span class="seg-sep">·</span>
            <span class="seg seg--locked seg--dept">{{ selectedDeptCode() || '—' }}</span>
          </div>

          <div class="manual-meta">
            <div class="dept-picker">
              <label class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1.5 block"
                     style="color: var(--text-muted);">Department</label>
              <pf-select
                [options]="deptOptions()"
                [value]="selectedDeptCode()"
                placeholder="Select department"
                (valueChange)="onDeptChange($event)"></pf-select>
            </div>
            <div class="preview">
              <label class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1.5 block"
                     style="color: var(--text-muted);">Preview</label>
              <div class="preview-code">{{ fullBarcode() }}</div>
            </div>
          </div>

          @if (isTouch()) {
            <div class="numpad-wrap">
              <pf-num-pad
                [value]="seqValue()"
                [allowDecimal]="false"
                [allowNegative]="false"
                [maxLength]="5"
                (valueChange)="onSeqChange($event)"></pf-num-pad>
            </div>
          }

          <div class="manual-actions">
            @if (seqValue().length > 0 && seqValue().length < 5) {
              <span class="seq-hint">{{ 5 - seqValue().length }} more digit{{ seqValue().length === 4 ? '' : 's' }}</span>
            }
            <pf-touch-btn size="md" variant="primary"
                          [disabled]="!canManualConfirm() || busy()"
                          (pressed)="receiveByManual()">
              Receive
              <span icon-right aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14"/>
                  <path d="m12 5 7 7-7 7"/>
                </svg>
              </span>
            </pf-touch-btn>
          </div>
        </pf-tile>
      }

      <!-- ─── Dispatched orders (FD has handed off, awaiting arrival) ─── -->
      @if (dispatchedOrders().length > 0) {
        @if (!embedded) {
          <div class="flex items-center justify-between gap-2 flex-wrap mb-3 px-1">
            <div class="flex items-center gap-2">
              <span class="text-[11px] font-mono uppercase tracking-[0.16em]"
                    style="color: var(--text-secondary);">Dispatched · awaiting arrival</span>
              <span class="text-[11px] font-mono" style="color: var(--text-muted);">· {{ dispatchedOrders().length }} orders</span>
            </div>
            <p class="text-[10.5px] font-mono" style="color: var(--text-muted);">
              Counter staff: log incoming batches as Arrived. Bench tech picks tubes off the arrived queue below.
            </p>
          </div>
        }
        <ul class="pf-rs-list" [class.pf-rs-list--compact]="embedded">
          @for (g of dispatchedOrders(); track g.orderId) {
            @if (embedded) {
              <!-- Compact row: avatar + name + Intake button only. -->
              <li class="pf-rs-row" [class.pf-rs-row--awaiting]="g.state === 'awaiting'">
                <pf-avatar [name]="g.patientName" [size]="32"></pf-avatar>
                <!-- Desktop view (single line) -->
                <span class="pf-rs-row__name pf-rs-row__name--desktop" [title]="g.patientInfo">{{ g.patientInfo }}</span>
                <!-- Mobile view (split into 2 lines) -->
                <div class="pf-rs-row__name-group--mobile">
                  <span class="pf-rs-row__name-main" [title]="g.patientNameAndAgeSex">{{ g.patientNameAndAgeSex }}</span>
                  @if (g.patientMrn) {
                    <span class="pf-rs-row__name-sub">{{ g.patientMrn }}</span>
                  }
                </div>
                @if (g.state === 'awaiting') {
                  <span class="pf-rs-row__chip" title="Tubes still at FD counter — ask reception to dispatch.">
                    Awaiting
                  </span>
                } @else {
                  <button type="button" class="pf-rs-row__btn press" [disabled]="busy()"
                          (click)="markArrived(g.orderId)">Intake</button>
                }
              </li>
            } @else {
              <li>
                <pf-tile [tone]="g.state === 'awaiting' ? 'amber' : 'violet'" padding="md" class="block"
                         [class.opacity-60]="g.state === 'awaiting'">
                  <div class="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                      <pf-avatar [name]="g.patientName" [size]="44"></pf-avatar>
                      <div class="flex-1 min-w-0">
                        <p class="font-semibold text-[15px] truncate" style="color: var(--text-primary);" [title]="g.patientInfo">{{ g.patientInfo }}</p>
                        <p class="text-[11.5px] font-mono mt-0.5" style="color: var(--text-tertiary);">
                          #{{ g.orderId.slice(0,8) }}
                          @if (g.tubeCount > 0) {
                            <span class="ml-1">· {{ g.tubeCount }}/{{ g.totalTubes }} dispatched</span>
                          }
                          @if (g.receivedCount > 0) {
                            <span class="ml-1" style="color: var(--text-tertiary);">· {{ g.receivedCount }} already received</span>
                          }
                          @if (g.notReadyCount > 0) {
                            <span class="ml-1" style="color: var(--amber-text);">· {{ g.notReadyCount }} not dispatched yet</span>
                          }
                          @for (lbl of g.testLabels; track lbl) { <span class="ml-1">· {{ lbl }}</span> }
                        </p>
                      </div>
                    </div>
                    @switch (g.state) {
                      @case ('ready') {
                        <pf-touch-btn size="sm" variant="primary" [disabled]="busy()" (pressed)="markArrived(g.orderId)"
                                      class="w-full sm:w-auto">
                          Mark Arrived
                        </pf-touch-btn>
                      }
                      @case ('partial') {
                        <pf-touch-btn size="sm" variant="primary" [disabled]="busy()" (pressed)="markArrived(g.orderId)"
                                      class="w-full sm:w-auto">
                          Mark Arrived ({{ g.tubeCount }})
                        </pf-touch-btn>
                      }
                      @case ('awaiting') {
                        <span class="px-3 py-1.5 text-[12px] font-medium rounded-md text-center w-full sm:w-auto"
                              style="background: rgba(245, 158, 11, 0.15); color: var(--amber-text);"
                              title="Tubes are still at the FD counter — ask reception to mark them dispatched.">
                          ⚠ Not dispatched yet
                        </span>
                      }
                    }
                  </div>
                </pf-tile>
              </li>
            }
          }
        </ul>
      }

      <!-- ─── Legacy "arrived → pickup" queue ──────────────────────────
           The intermediate in_transit step was dropped (Mark Arrived
           now goes straight to received + TAT-start). This block is
           only rendered if legacy in_transit rows still exist from
           pre-cutover orders so techs can drain them. New orders skip
           it entirely. -->
      @if (inTransit().length > 0) {
        <div class="flex items-center justify-between gap-2 flex-wrap mb-3 px-1">
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-mono uppercase tracking-[0.16em]"
                  style="color: var(--text-secondary);">Legacy queue · awaiting pickup</span>
            <span class="text-[11px] font-mono"
                  style="color: var(--text-muted);">· {{ inTransit().length }} tubes</span>
          </div>
          <div class="flex gap-2">
            <pf-touch-btn size="sm" variant="ghost"
                          [disabled]="inTransit().length === 0"
                          (pressed)="toggleAll()">
              {{ allSelected() ? 'Deselect all' : 'Select all' }}
            </pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary"
                          [disabled]="selectedIds().size === 0 || busy()"
                          (pressed)="receiveSelected()">
              Pick up {{ selectedIds().size || 0 }} · TAT starts
            </pf-touch-btn>
          </div>
        </div>
      } @else {
        <!-- intentionally empty — no in-transit queue any more. -->
      }

      @if (inTransit().length > 0) {
        <div class="space-y-2.5">
          @for (s of inTransit(); track s.id) {
            <pf-tile [tone]="isSelected(s.id) ? 'violet' : 'default'" padding="md">
              <div class="flex items-center gap-3 flex-wrap md:flex-nowrap">
                <label class="pf-check" (click)="$event.stopPropagation()">
                  <input type="checkbox" [checked]="isSelected(s.id)" (change)="toggle(s.id)" />
                  <span class="pf-check-box" aria-hidden="true">
                    @if (isSelected(s.id)) {
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m5 12 4 4L19 6"/>
                      </svg>
                    }
                  </span>
                </label>

                <pf-avatar [name]="s.order?.patient?.displayName ?? 'Patient'" [size]="40"></pf-avatar>

                <div class="flex-1 min-w-0">
                  <p class="font-semibold text-[14.5px] truncate"
                     style="color: var(--text-primary);">{{ s.order?.patient?.displayName ?? 'Patient' }}</p>
                  <p class="text-[11.5px] font-mono mt-0.5 truncate"
                     style="color: var(--text-tertiary);">
                    {{ s.department?.name }} · {{ s.barcode }}
                    · Arrived {{ s.pickedUpAt ? (s.pickedUpAt | date:'shortTime') : '—' }}
                  </p>
                </div>

                <pf-touch-btn size="sm" variant="primary" (pressed)="receiveOne(s.id)">
                  Pick up · TAT starts
                </pf-touch-btn>
              </div>
            </pf-tile>
          }
        </div>
      }

      </div><!-- /pf-rs-scroll -->
    </section>

    @if (pkgScannerOpen()) {
      <pf-barcode-scanner-modal
        title="Scan dispatch package QR"
        (matched)="onPackageScanned($event)"
        (cancelled)="closePackageScanner()">
      </pf-barcode-scanner-modal>
    }

    @if (barScannerOpen()) {
      <pf-barcode-scanner-modal
        title="Scan tube barcode to intake"
        (matched)="onBarcodeScanned($event)"
        (cancelled)="closeBarcodeScanner()">
      </pf-barcode-scanner-modal>
    }
  `,
  styles: [`
    /* ── Embedded compact list (used inside the my-work Lab Intake pane).
     * Each row is a single-line tile with avatar + name + Intake button. */
    .pf-rs-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pf-rs-list--compact { gap: 6px; }
    .pf-rs-row {
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 8px 10px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .pf-rs-row:hover {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.36);
    }
    .pf-rs-row--awaiting { opacity: 0.65; }
    .pf-rs-row__name {
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pf-rs-row__name-group--mobile { display: none; }
    
    @media (max-width: 640px) {
      .pf-rs-row__name--desktop { display: none; }
      .pf-rs-row__name-group--mobile {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .pf-rs-row__name-main {
        font-size: 13.5px;
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pf-rs-row__name-sub {
        font-size: 11px;
        font-weight: 500;
        color: var(--text-tertiary);
      }
    }
    .pf-rs-row__btn {
      padding: 5px 14px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      border-radius: 9999px;
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: #fff;
      border: 0;
      cursor: pointer;
      transition: filter 0.15s ease, transform 0.06s ease;
    }
    .pf-rs-row__btn:hover { filter: brightness(1.08); }
    .pf-rs-row__btn:active { transform: scale(0.98); }
    .pf-rs-row__btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .pf-rs-row__chip {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      border-radius: 9999px;
      background: rgba(245, 158, 11, 0.15);
      color: var(--amber-text);
      border: 1px solid rgba(245, 158, 11, 0.32);
    }

    /* Scan field: glass input with icon prefix, matching patient-search look */
    .scan-field {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
      height: 56px;
      padding: 0 16px 0 44px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 18px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
    }
    .scan-field:hover { border-color: var(--glass-border-hover); }
    .scan-field:focus-within {
      border-color: rgba(168, 85, 247, 0.55);
      background: var(--glass-bg-hover);
      box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.15);
    }
    .scan-field input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text-primary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 14px;
      letter-spacing: 0.02em;
    }
    .scan-field input::placeholder { color: var(--text-muted); }
    .scan-icon {
      position: absolute;
      left: 16px;
      width: 18px;
      height: 18px;
      color: var(--text-muted);
      pointer-events: none;
    }

    /* Package preview card — manifest of orders inside the package */
    .pkg-preview {
      margin-top: 14px;
      padding: 12px;
      background: var(--glass-bg);
      border: 1px solid rgba(168, 85, 247, 0.32);
      border-radius: 12px;
    }
    .pkg-preview__code {
      margin: 0;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 18px; font-weight: 700;
      letter-spacing: 0.04em;
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      -webkit-background-clip: text; background-clip: text;
      color: transparent;
    }
    .pkg-preview__sub {
      margin: 2px 0 0;
      font-size: 11.5px;
      color: var(--text-secondary);
    }
    .pkg-preview__list {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 4px;
    }
    .pkg-preview__row {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 8px;
      font-size: 12px;
    }
    .pkg-preview__name { font-weight: 600; color: var(--text-primary); }
    .pkg-preview__meta {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px; color: var(--text-tertiary);
    }

    /* Custom checkbox */
    .pf-check { position: relative; display: inline-flex; cursor: pointer; }
    .pf-check input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .pf-check-box {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: transparent;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .pf-check input:checked + .pf-check-box {
      background: var(--gradient-primary);
      border-color: transparent;
      color: #ffffff;
      box-shadow: 0 3px 10px rgba(124, 58, 237, 0.35);
    }

    /* Manual entry */
    .manual-toggle { margin-top: 12px; display: flex; justify-content: flex-end; }
    .manual-link {
      background: transparent; border: 0; padding: 4px 8px;
      color: var(--text-secondary); font-size: 12.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.02em; cursor: pointer; transition: color 0.15s ease;
    }
    .manual-link:hover { color: var(--text-primary); }

    .seg-row {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      padding: 14px 16px; background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 18px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 18px; font-weight: 600; letter-spacing: 0.02em;
    }
    .seg { color: var(--text-primary); }
    .seg-sep { color: var(--text-muted); }
    .seg--locked { opacity: 0.7; }
    .seg--dept { min-width: 48px; text-align: center; }
    .seg--input {
      flex: 1 0 110px; min-width: 110px; max-width: 180px;
      background: rgba(45, 212, 191, 0.10); border: 1px solid rgba(45, 212, 191, 0.45);
      border-radius: 10px; padding: 6px 10px; outline: none;
      font: inherit; color: var(--text-primary); text-align: center;
      letter-spacing: 0.18em;
    }
    .seg--input:focus {
      border-color: rgba(45, 212, 191, 0.85);
      box-shadow: 0 0 0 4px rgba(45, 212, 191, 0.15);
    }
    .seg--input::placeholder { color: var(--text-muted); letter-spacing: 0.18em; }

    .manual-meta {
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px;
    }
    @media (max-width: 640px) { .manual-meta { grid-template-columns: 1fr; } }
    .preview-code {
      padding: 9px 12px; background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 12px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 13.5px; color: var(--text-secondary); letter-spacing: 0.02em;
      overflow-x: auto; white-space: nowrap;
    }

    .numpad-wrap { margin-top: 16px; max-width: 320px; }

    .manual-actions {
      display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 16px;
    }
    .seq-hint {
      font-size: 12px; color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }

    /* ───────────────────────────────────────────────────────────────
     * NON-SCROLL WORK LAYOUT (applies on ALL sizes — approved desktop
     * change). The page fills the shell's main area exactly; the page
     * itself never scrolls. The screen chrome (KPI strip + header) is
     * fixed; scrolling happens inside .pf-rs-scroll only. Gated to the
     * standalone (non-embedded) page via .pf-rs-page so the embedded
     * tab inside my-work keeps flowing in its host.
     * ─────────────────────────────────────────────────────────────── */
    /* Only the standalone page fills the shell's main area. When embedded
     * (no .pf-rs-page child) the host keeps its default auto height so it
     * flows naturally inside the my-work Lab Intake pane body. */
    :host:has(.pf-rs-page) { display: block; height: 100%; }

    section.pf-rs-page {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      min-height: 0;
      /* The base section uses pt-6/pb-10 utilities; in non-scroll mode
       * the vertical padding moves onto the inner regions so the column
       * math (chrome + scroll = 100%) stays exact. The element selector
       * out-specifies the Tailwind pt-6/pb-10 single-class utilities. */
      padding-top: 0;
      padding-bottom: 0;
    }
    .pf-rs-page .pf-rs-chrome {
      flex: 0 0 auto;
      padding-top: 24px;          /* replaces pt-6 */
    }
    .pf-rs-page .pf-rs-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      /* breathing room at the bottom of the scroll region + safe-area
       * for this page's own scroll chrome on notched devices. */
      padding-bottom: calc(40px + env(safe-area-inset-bottom, 0px));
      /* smooth momentum scrolling inside the panel on touch devices */
      -webkit-overflow-scrolling: touch;
    }

    /* ───────────────────────────────────────────────────────────────
     * CROSS-PLATFORM ADDITIVE OVERRIDES (do not touch base rules above)
     * Desktop-web >=1280px is unaffected: every rule below is gated by a
     * max-width media query, a touch/pointer query, or a hover query.
     * ─────────────────────────────────────────────────────────────── */

    /* Touch & coarse-pointer: gate the decorative hover states so they
     * don't "stick" on tap, and grow the small inline tap targets. */
    @media (hover: none) {
      .pf-rs-row:hover { background: var(--glass-bg); border-color: var(--glass-border); }
      .pf-rs-row__btn:hover { filter: none; }
      .scan-field:hover { border-color: var(--glass-border); }
      .manual-link:hover { color: var(--text-secondary); }
    }
    @media (pointer: coarse) {
      .pf-rs-row__btn { min-height: 44px; padding: 8px 18px; }
      .pf-rs-row__chip { min-height: 32px; display: inline-flex; align-items: center; }
      .manual-link { min-height: 44px; display: inline-flex; align-items: center; }
      .pf-check-box { width: 24px; height: 24px; }
      /* Grow the legacy in-transit checkbox hit area to the 44px touch
       * floor (the visible box stays 24px; the invisible input fills the
       * wrapper). Scoped to this page's .pf-check + coarse pointers only. */
      .pf-check { min-width: 44px; min-height: 44px; align-items: center; justify-content: center; }
      .seg--input { padding: 10px 10px; }
    }

    /* iPad / mid-width (641–1279): scan rows have room — keep the inline
     * layout. No change needed beyond the phone fixes below. */

    /* Phone (<=640): stack the scan rows so the input + buttons don't
     * overflow horizontally, and lift input font to 16px to stop iOS
     * auto-zoom on focus. */
    @media (max-width: 640px) {
      .scan-field input { font-size: 16px; }
      .seg--input { font-size: 16px; }
      /* The scan/package action rows are .flex.gap-2 wrappers with an
       * input + one or more buttons. Stack them so the buttons (esp. the
       * package row's two buttons) don't squeeze the input or overflow. */
      .pf-rs-scanrow { flex-direction: column; align-items: stretch; }
      .pf-rs-scanrow .scan-field { width: 100%; }
      /* Make the action buttons within these rows fill the width when
       * stacked (scoped to this page's rows only). */
      .pf-rs-scanrow pf-touch-btn { width: 100%; }
      .scan-field { height: 52px; }
      .pkg-preview__row { flex-wrap: wrap; }
      .pkg-preview__meta { width: 100%; }
    }
  `]
})
export class ReceiveSamplesComponent implements OnInit {
  /**
   * When the component is embedded as a tab inside another screen
   * (currently the "Lab Intake" tab on /lab/my-work), the host already
   * supplies the page chrome (screen header, outer padding). Setting
   * embedded=true suppresses our own header + outer section padding so
   * we don't render two stacked headers.
   */
  @Input() embedded = false;
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly tenantState = inject(TenantStateService);

  private readonly _inTransit = signal<OrderSample[]>([]);
  private readonly _dispatched = signal<Order[]>([]);
  /**
   * Order-level groups for the new dispatched queue. Lab tech reads this as
   * "patient X — N tubes — list of tests" instead of per-tube rows so they
   * can scan/click once to mark the whole order received and start TAT.
   */
  readonly dispatchedOrders = computed(() => this._dispatched().map(o => {
    const samples = o.samples ?? [];
    const dispatched = samples.filter(s => s.status === 'dispatched').length;
    const received = samples.filter(s => s.status === 'received' || s.status === 'processing').length;
    const notReady = samples.filter(s => s.status === 'pending' || s.status === 'collected').length;
    const total = samples.length;
    // State drives the action button + the row badge:
    //  • 'ready'         — at least one dispatched tube → enable Receive
    //  • 'partial'       — some dispatched, some already received → enable Receive (intake the rest)
    //  • 'awaiting'      — every tube still at the counter → disable, show warning
    //  • 'received'      — every tube already received → hidden (out of queue)
    let state: 'ready' | 'partial' | 'awaiting' | 'received';
    if (dispatched === 0 && received === total && total > 0) state = 'received';
    else if (dispatched === 0 && notReady > 0) state = 'awaiting';
    else if (received > 0) state = 'partial';
    else state = 'ready';
    return {
      orderId: o.id,
      patientName: patientDisplayName(o.patient ?? null) || 'Patient',
      patientInfo: o.patient ? formatPatientInfo(o.patient) : 'Patient',
      patientMrn: o.patient?.mrn?.trim() || '',
      patientNameAndAgeSex: o.patient ? formatPatientNameAgeSex(o.patient) : 'Patient',
      tubeCount: dispatched,
      receivedCount: received,
      notReadyCount: notReady,
      totalTubes: total,
      state,
      testLabels: this.uniqueTestNames(o)
    };
  }).filter(g => g.state !== 'received'));
  private readonly _selectedIds = signal<Set<string>>(new Set());
  protected readonly scanValue = signal('');
  protected readonly busy = signal(false);

  // ── Package intake (bulk receive via PKG-XXXX code) ─────
  /** Code reception generated when bundling orders. Lab types or
   *  scans it to bulk-receive every order in the package at once. */
  protected readonly pkgCode = signal<string>('');
  protected readonly pkgPreview = signal<{
    code: string;
    orderCount: number;
    orders: Array<{ id: string; patientName: string; sampleCount: number; status: string }>;
    receivedAt?: string | null;
  } | null>(null);
  protected readonly pkgBusy = signal(false);
  protected readonly pkgError = signal<string | null>(null);
  /** Camera scanner open state for the package code. The shared
   *  BarcodeScannerModalComponent handles HID gun input AND camera
   *  decoding via @zxing/browser, so we get both for free. */
  protected readonly pkgScannerOpen = signal(false);
  /** Tube-barcode camera scanner state. Triggered from outside when
   *  embedded (via the Lab Intake pane's header camera icon) — opens
   *  a fullscreen camera that decodes a tube barcode and auto-intakes. */
  readonly barScannerOpen = signal(false);
  /** Public — called from the parent component (e.g., my-work) so the
   *  Lab Intake pane header can host a camera icon. */
  openBarcodeScanner() { this.barScannerOpen.set(true); }
  closeBarcodeScanner() { this.barScannerOpen.set(false); }
  /** Camera matched a tube barcode → drop it into the scan input and
   *  auto-receive immediately, no extra tap needed. */
  onBarcodeScanned(code: string) {
    this.barScannerOpen.set(false);
    this.scanValue.set(code);
    this.receiveByBarcode();
  }
  /** Public — call from a parent to receive a barcode the parent typed
   *  (e.g., the Lab Intake pane's inline input in my-work). Sets the
   *  scan value then triggers the receive flow. */
  receiveByCode(code: string) {
    if (!code) return;
    this.scanValue.set(code);
    this.receiveByBarcode();
  }

  // Manual entry state
  protected readonly manualMode = signal(false);
  protected readonly seqValue = signal('');
  protected readonly departments = signal<Department[]>([]);
  protected readonly selectedDeptCode = signal<string>('');
  protected readonly isTouch = signal<boolean>(
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  );
  readonly currentYear = new Date().getFullYear();

  readonly inTransit = this._inTransit.asReadonly();
  readonly selectedIds = this._selectedIds.asReadonly();
  readonly allSelected = computed(() =>
    this._inTransit().length > 0 && this._selectedIds().size === this._inTransit().length
  );

  readonly vendorCode = computed(() => this.tenantState.tenant()?.vendorCode ?? '');

  readonly deptOptions = computed<PfSelectOption<string>[]>(() =>
    this.departments().map(d => ({ value: d.code, label: `${d.code} · ${d.name}` }))
  );

  readonly fullBarcode = computed(() => {
    const v = this.vendorCode() || '??';
    const seq = (this.seqValue() || '').padStart(5, '0');
    const d = this.selectedDeptCode() || '——';
    return `PF-${v}-${this.currentYear}-${seq}-${d}`;
  });

  readonly canManualConfirm = computed(() =>
    this.seqValue().length === 5 &&
    !!this.selectedDeptCode() &&
    !!this.vendorCode()
  );

  ngOnInit() {
    this.refresh();
    this.tenantState.ensureLoaded();
  }

  refresh() {
    this.api.get<OrderSample[]>('/api/samples/in-transit').subscribe({
      next: l => {
        this._inTransit.set(l ?? []);
        this._selectedIds.set(new Set());
      }
    });
    this.api.get<Order[]>('/api/orders/dispatched').subscribe({
      next: l => this._dispatched.set(l ?? [])
    });
  }

  /**
   * Lab counter staff click "Mark Arrived" — flips every dispatched tube on
   * the order to in_transit (i.e. arrived at the lab counter, awaiting
   * bench-tech pickup). TAT does NOT start here; it starts when a tech
   * picks up an individual tube and marks it received below.
   */
  // ── Package intake actions ──────────────────────────────
  /** Look up a package by code without committing the receive. Lets
   *  the lab tech eyeball the manifest (orders + sample counts)
   *  before they tap the green button. */
  previewPackage() {
    const code = this.normalisedPkgCode();
    if (!code) return;
    this.pkgBusy.set(true);
    this.pkgError.set(null);
    this.pkgPreview.set(null);
    this.api.get<{
      code: string; orderCount: number;
      orders: Array<{ id: string; patientName: string; sampleCount: number; status: string }>;
      receivedAt?: string | null;
    }>(`/api/dispatch-packages/${encodeURIComponent(code)}`).subscribe({
      next: pkg => {
        this.pkgBusy.set(false);
        if (!pkg) { this.pkgError.set(`No package found for ${code}`); return; }
        this.pkgPreview.set(pkg);
      },
      error: e => {
        this.pkgBusy.set(false);
        this.pkgError.set(e?.error?.message ?? e?.message ?? `Could not look up ${code}`);
      }
    });
  }

  /** Commit the bulk receive — every order in the package flips to
   *  arrived, TAT starts on each tube, auto-assign fans out per
   *  sample on the backend. */
  receivePackage() {
    const code = this.normalisedPkgCode();
    if (!code) return;
    const preview = this.pkgPreview();
    if (preview?.receivedAt) {
      this.toasts.info(`Package ${code} was already received.`);
      return;
    }
    this.pkgBusy.set(true);
    this.api.post<{ ordersTouched: number; arrivedSamples: number; alreadyReceived?: boolean }>(
      `/api/dispatch-packages/${encodeURIComponent(code)}/receive`, {}
    ).subscribe({
      next: res => {
        this.pkgBusy.set(false);
        if (res?.alreadyReceived) {
          this.toasts.info(`Package ${code} was already received.`);
        } else {
          this.toasts.success(
            `${code} received — ${res.arrivedSamples} sample${res.arrivedSamples === 1 ? '' : 's'} across ${res.ordersTouched} order${res.ordersTouched === 1 ? '' : 's'}, TAT clocks started`
          );
        }
        this.pkgCode.set('');
        this.pkgPreview.set(null);
        this.refresh();
      },
      error: e => {
        this.pkgBusy.set(false);
        this.pkgError.set(ApiError.from(e).message);
      }
    });
  }

  /** Normalise reception's input — uppercase + trim. Accept the bare
   *  short suffix (e.g. "7XQ4M2") by prefixing PKG- so scanning a
   *  printed slip with just the suffix still works. */
  protected normalisedPkgCode(): string {
    const v = this.pkgCode().trim().toUpperCase();
    if (!v) return '';
    return v.startsWith('PKG-') ? v : `PKG-${v}`;
  }

  clearPackagePreview() { this.pkgPreview.set(null); this.pkgError.set(null); }

  openPackageScanner() { this.pkgScannerOpen.set(true); }
  closePackageScanner() { this.pkgScannerOpen.set(false); }
  /** Camera / HID gun emitted a code → drop it into the input,
   *  close the scanner, and run preview right away so the lab tech
   *  sees the manifest without having to tap "Look up". */
  onPackageScanned(code: string) {
    this.pkgScannerOpen.set(false);
    this.pkgCode.set(code.trim().toUpperCase());
    this.pkgPreview.set(null);
    this.pkgError.set(null);
    this.previewPackage();
  }

  markArrived(orderId: string) {
    const order = this._dispatched().find(o => o.id === orderId);
    if (!order) return;
    this.busy.set(true);
    this.api.patch<{ arrived: number }>(`/api/orders/${orderId}/arrive`, {}).subscribe({
      next: r => {
        this.busy.set(false);
        const n = r?.arrived ?? 0;
        // Backend now flips dispatched → received in one step (no
        // intermediate in_transit). TAT starts at this moment.
        this.toasts.success(`${order.patient?.firstName ?? 'Patient'} · ${n} tube${n === 1 ? '' : 's'} received — TAT clock started`);
        this.refresh();
      },
      error: e => {
        this.busy.set(false);
        this.toasts.error(ApiError.from(e).message);
      }
    });
  }

  /** Legacy fast-path: receive every dispatched tube directly (skips the
   *  arrived queue). Kept for one-stage labs that don't want the formal
   *  arrival step. */
  receiveOrder(orderId: string) {
    const order = this._dispatched().find(o => o.id === orderId);
    if (!order) return;
    const ids = (order.samples ?? [])
      .filter(s => s.status === 'dispatched')
      .map(s => s.id);
    if (ids.length === 0) return;
    this.busy.set(true);
    this.api.post<OrderSample[]>('/api/samples/receive-batch', { sampleIds: ids }).subscribe({
      next: () => {
        this.busy.set(false);
        this.toasts.success(`${order.patient?.firstName ?? 'Patient'} · ${ids.length} tube${ids.length === 1 ? '' : 's'} received — TAT started`);
        this.refresh();
      },
      error: e => {
        this.busy.set(false);
        this.toasts.error(ApiError.from(e).message);
      }
    });
  }

  /** Dedup test names across all the order's samples for the meta line. */
  private uniqueTestNames(o: Order): string[] {
    const names = new Set<string>();
    for (const s of o.samples ?? []) {
      for (const t of s.tests ?? []) {
        const n = t.test?.name;
        if (n) names.add(n);
      }
    }
    return Array.from(names).slice(0, 4);
  }

  isSelected(id: string): boolean { return this._selectedIds().has(id); }
  toggle(id: string) {
    const next = new Set(this._selectedIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this._selectedIds.set(next);
  }
  toggleAll() {
    if (this.allSelected()) this._selectedIds.set(new Set());
    else this._selectedIds.set(new Set(this._inTransit().map(s => s.id)));
  }

  receiveByBarcode() {
    const code = this.scanValue().trim();
    if (!code) return;
    this.busy.set(true);
    this.api.get<OrderSample>(`/api/samples/by-barcode/${encodeURIComponent(code)}`).subscribe({
      next: s => this.api.patch<OrderSample>(`/api/samples/${s.id}/receive`).subscribe({
        next: () => { this.busy.set(false); this.scanValue.set(''); this.toasts.success(`Received ${s.barcode}`); this.refresh(); },
        error: e => { this.busy.set(false); this.toasts.error(ApiError.from(e).message); }
      }),
      error: () => { this.busy.set(false); this.toasts.error('Barcode not found'); }
    });
  }

  receiveOne(id: string) {
    this.api.patch<OrderSample>(`/api/samples/${id}/receive`).subscribe({
      next: () => { this.toasts.success('Received'); this.refresh(); },
      error: e => { this.toasts.error(ApiError.from(e).message); }
    });
  }

  receiveSelected() {
    const ids = Array.from(this._selectedIds());
    if (ids.length === 0) return;
    this.busy.set(true);
    this.api.post<OrderSample[]>('/api/samples/receive-batch', { sampleIds: ids }).subscribe({
      next: () => { this.busy.set(false); this.toasts.success(`Received ${ids.length}`); this.refresh(); },
      error: e => { this.busy.set(false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  // ── Manual entry ──────────────────────────────────────────────────────
  toggleManual() {
    const next = !this.manualMode();
    this.manualMode.set(next);
    if (next && this.departments().length === 0) this.loadDepartments();
  }

  onSeqChange(v: string) {
    // Strip non-digits and clamp to 5 chars
    const cleaned = (v ?? '').replace(/\D/g, '').slice(0, 5);
    this.seqValue.set(cleaned);
  }

  onDeptChange(code: string) {
    this.selectedDeptCode.set(code);
    try { localStorage.setItem(LAST_DEPT_KEY, code); } catch { /* ignore */ }
  }

  receiveByManual() {
    if (!this.canManualConfirm()) return;
    const code = this.fullBarcode();
    this.busy.set(true);
    this.api.get<OrderSample>(`/api/samples/by-barcode/${encodeURIComponent(code)}`).subscribe({
      next: s => this.api.patch<OrderSample>(`/api/samples/${s.id}/receive`).subscribe({
        next: () => {
          this.busy.set(false);
          this.toasts.success(`Received ${s.barcode}`);
          this.seqValue.set('');
          this.refresh();
        },
        error: e => { this.busy.set(false); this.toasts.error(ApiError.from(e).message); }
      }),
      error: () => { this.busy.set(false); this.toasts.error(`Barcode ${code} not found`); }
    });
  }

  private loadDepartments() {
    const branchId = this.auth.user()?.branchId;
    if (!branchId) return;
    this.api.get<Department[]>(`/api/tenants/departments?branchId=${branchId}`).subscribe({
      next: list => {
        const arr = list ?? [];
        this.departments.set(arr);
        // Restore last-picked dept if still in the list, else default to first
        let last = '';
        try { last = localStorage.getItem(LAST_DEPT_KEY) ?? ''; } catch { /* ignore */ }
        const match = arr.find(d => d.code === last);
        if (match) this.selectedDeptCode.set(match.code);
        else if (arr.length > 0) this.selectedDeptCode.set(arr[0].code);
      }
    });
  }
}

function formatPatientNameAgeSex(
  p: { firstName?: string; fathersName?: string; displayName?: string; age?: number; sex?: string } | null | undefined
): string {
  if (!p) return '—';
  const name = patientDisplayName(p as any);
  const truncatedName = name.length > 15 ? name.substring(0, 15) + '..' : name;
  const age = p.age != null ? p.age : '—';
  let sexCode = '—';
  if (p.sex) {
    const s = p.sex.trim().toLowerCase();
    if (s.startsWith('m')) sexCode = 'M';
    else if (s.startsWith('f')) sexCode = 'F';
    else if (s.startsWith('o')) sexCode = 'O';
    else sexCode = p.sex.charAt(0).toUpperCase();
  }
  return `${truncatedName} | ${age}/${sexCode}`;
}
