import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderSample } from '../../../shared/models/order.model';
import { Department } from '../../../shared/models/tenant.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { NumPadComponent } from '../../../shared/primitives/num-pad.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

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
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">

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

      <!-- Scan hero -->
      <pf-tile tone="violet" padding="lg" class="block mb-6">
        <label class="text-[11px] font-mono uppercase tracking-[0.16em] mb-2 block"
               style="color: var(--text-muted);">Scan barcode</label>
        <div class="flex gap-2">
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

      @if (manualMode()) {
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

      <!-- In-transit header + batch actions -->
      <div class="flex items-center justify-between gap-2 flex-wrap mb-3 px-1">
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-mono uppercase tracking-[0.16em]"
                style="color: var(--text-secondary);">In transit</span>
          <span class="text-[11px] font-mono"
                style="color: var(--text-muted);">· {{ inTransit().length }}</span>
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
            Receive {{ selectedIds().size || 0 }}
          </pf-touch-btn>
        </div>
      </div>

      @if (inTransit().length === 0) {
        <pf-tile tone="default" padding="xl">
          <p class="text-center text-[14px]" style="color: var(--text-secondary);">
            Nothing in transit. Everything has been received.
          </p>
        </pf-tile>
      } @else {
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

                <pf-avatar [name]="s.order?.patient?.name ?? 'Patient'" [size]="40"></pf-avatar>

                <div class="flex-1 min-w-0">
                  <p class="font-semibold text-[14.5px] truncate"
                     style="color: var(--text-primary);">{{ s.order?.patient?.name ?? 'Patient' }}</p>
                  <p class="text-[11.5px] font-mono mt-0.5 truncate"
                     style="color: var(--text-tertiary);">
                    {{ s.department?.name }} · {{ s.barcode }}
                    · Picked {{ s.pickedUpAt ? (s.pickedUpAt | date:'shortTime') : '—' }}
                  </p>
                </div>

                <pf-touch-btn size="sm" variant="secondary" (pressed)="receiveOne(s.id)">
                  Receive
                </pf-touch-btn>
              </div>
            </pf-tile>
          }
        </div>
      }
    </section>
  `,
  styles: [`
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
  `]
})
export class ReceiveSamplesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly tenantState = inject(TenantStateService);

  private readonly _inTransit = signal<OrderSample[]>([]);
  private readonly _selectedIds = signal<Set<string>>(new Set());
  protected readonly scanValue = signal('');
  protected readonly busy = signal(false);

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
        error: e => { this.busy.set(false); this.toasts.error(e.message ?? 'Receive failed'); }
      }),
      error: () => { this.busy.set(false); this.toasts.error('Barcode not found'); }
    });
  }

  receiveOne(id: string) {
    this.api.patch<OrderSample>(`/api/samples/${id}/receive`).subscribe({
      next: () => { this.toasts.success('Received'); this.refresh(); }
    });
  }

  receiveSelected() {
    const ids = Array.from(this._selectedIds());
    if (ids.length === 0) return;
    this.busy.set(true);
    this.api.post<OrderSample[]>('/api/samples/receive-batch', { sampleIds: ids }).subscribe({
      next: () => { this.busy.set(false); this.toasts.success(`Received ${ids.length}`); this.refresh(); },
      error: e => { this.busy.set(false); this.toasts.error(e.message ?? 'Batch receive failed'); }
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
        error: e => { this.busy.set(false); this.toasts.error(e.message ?? 'Receive failed'); }
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
