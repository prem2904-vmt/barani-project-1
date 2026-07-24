import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { ApiService } from "../../../core/services/api.service";
import { CurrencyInrPipe } from "../../../shared/pipes/currency-inr.pipe";
import { NumPadComponent } from "../../../shared/primitives/num-pad.component";

export type PayMode = "upi" | "card" | "cash" | "wallet" | "split" | "later";

export interface InlinePaymentResult {
  mode: PayMode;
  referenceNo?: string;
  cashTendered?: number;
  vendorId?: string;
  splitParts?: Array<{ mode: PayMode; amount: number }>;
  /** Pay-later mode only: an optional advance collected now (rest stays
   *  outstanding) and how it was tendered. */
  advanceAmount?: number;
  advanceMode?: PayMode;
}

interface VendorWallet {
  id: string;
  name: string;
  code?: string;
  balance: number;
  outstanding: number;
  isActive: boolean;
}

interface ModeDef {
  id: PayMode;
  label: string;
  iconPath: string;
}

/**
 * Live payment pane for the order screen — driven by the cart total (no bill
 * yet). Mirrors the billing screen's mode tiles + per-mode entry (cash num-pad,
 * UPI QR, …) but persists nothing: it emits the chosen payment via (confirm)
 * and the host (order-create) creates the order + bill + records payment.
 */
@Component({
  selector: "pf-inline-payment-panel",
  standalone: true,
  imports: [NumPadComponent, CurrencyInrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-ipp">
      <p class="pf-ipp__eyebrow">Payment mode</p>
      <div class="pf-ipp__modes">
        @for (m of modes; track m.id) {
          <button
            type="button"
            class="pf-mode pf-mode--compact"
            [class.pf-mode--on]="mode() === m.id"
            (click)="setMode(m.id)"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path [attr.d]="m.iconPath" />
            </svg>
            <span class="pf-mode__label">{{ m.label }}</span>
          </button>
        }
      </div>

      <!-- Selected mode's entry renders directly below the tiles (no collapse). -->
      <div class="pf-ipp__body">
        @switch (mode()) {
          @case ("upi") {
            <div class="pf-ipp__center">
              <p class="pf-ipp__eyebrow">Scan to pay</p>
              <p class="pf-ipp__big">{{ amount() | inr }}</p>
              <div class="pf-ipp__qr">
                <img
                  [src]="upiQrUrl()"
                  alt="Scan to pay via UPI"
                  width="160"
                  height="160"
                />
              </div>
              <p class="pf-ipp__hint">prefrontal&#64;upi</p>
            </div>
          }
          @case ("card") {
            <div class="pf-ipp__center">
              <p class="pf-ipp__eyebrow">Tap or insert card</p>
              <p class="pf-ipp__big">{{ amount() | inr }}</p>
              <input
                class="pf-ipp__input"
                placeholder="Reference no. (optional)"
                [value]="refNo()"
                (input)="refNo.set(asVal($event))"
              />
            </div>
          }
          @case ("cash") {
            <div class="pf-cash">
              <div class="pf-cash__head">
                <span class="pf-cash__label">Cash received</span>
                <span
                  class="pf-cash__amt"
                  [class.pf-cash__amt--empty]="cashNum() === 0"
                  >{{ cashNum() | inr }}</span
                >
              </div>
              <!-- Quick set: exact, or add a note the patient handed over. -->
              <div class="pf-cash__quick">
                <button type="button" (click)="setExactCash()">Exact</button>
                @for (n of cashNotes; track n) {
                  <button type="button" (click)="addCash(n)">+{{ n }}</button>
                }
              </div>
              <!-- The whole point: how much to hand back. -->
              <div
                class="pf-cash__change"
                [attr.data-kind]="
                  cashNum() === 0
                    ? 'idle'
                    : change() > 0
                      ? 'change'
                      : change() === 0
                        ? 'exact'
                        : 'short'
                "
              >
                @if (cashNum() === 0) {
                  <span
                    >Enter the amount received · due {{ amount() | inr }}</span
                  >
                } @else if (change() > 0) {
                  <span>Return to patient</span
                  ><strong>{{ changeAbs() | inr }}</strong>
                } @else if (change() === 0) {
                  <span>Exact — no change due</span>
                } @else {
                  <span>Short by</span><strong>{{ changeAbs() | inr }}</strong>
                }
              </div>
              <pf-num-pad
                [value]="cash()"
                [allowDecimal]="false"
                [compact]="true"
                (valueChange)="cash.set($event)"
              ></pf-num-pad>
            </div>
          }
          @case ("wallet") {
            <div class="pf-ipp__wallet">
              @if (vendorId(); as vid) {
                <div class="pf-ipp__vendor">
                  <span>{{ vendorName(vid) }}</span>
                  <button
                    type="button"
                    class="pf-ipp__link"
                    (click)="vendorId.set(null)"
                  >
                    Change
                  </button>
                </div>
                <!-- Live balance: current outstanding, and where it lands after
                     this order is charged to the tab. -->
                @if (selectedVendor(vid); as sv) {
                  <div class="pf-ipp__vbalance">
                    <span class="pf-ipp__vbalance-now">Current: {{ outstandingLabel(sv.outstanding) }}</span>
                    <span class="pf-ipp__vbalance-arrow" aria-hidden="true">→</span>
                    <span class="pf-ipp__vbalance-after">After this order: {{ outstandingLabel(sv.outstanding + amount()) }}</span>
                  </div>
                }
              } @else {
                <input
                  class="pf-ipp__input"
                  placeholder="Search vendor…"
                  [value]="vendorQuery()"
                  (input)="vendorQuery.set(asVal($event))"
                />
                @if (vendors() === null) {
                  <p class="pf-ipp__muted">Loading vendors…</p>
                } @else if (filteredVendors().length === 0) {
                  <p class="pf-ipp__muted">No vendors.</p>
                } @else {
                  <ul class="pf-ipp__vlist">
                    @for (v of filteredVendors(); track v.id) {
                      <li>
                        <button
                          type="button"
                          class="pf-ipp__vrow"
                          (click)="vendorId.set(v.id)"
                        >
                          <span>{{ v.name }}</span
                          ><span class="pf-ipp__vbal">{{
                            outstandingLabel(v.outstanding)
                          }}</span>
                        </button>
                      </li>
                    }
                  </ul>
                }
              }
            </div>
          }
          @case ("split") {
            <div class="pf-ipp__split">
              @for (p of splitParts(); track $index) {
                <div class="pf-ipp__splitrow">
                  <select
                    class="pf-ipp__input"
                    [value]="p.mode"
                    (change)="setSplitMode($index, asVal($event))"
                  >
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                  </select>
                  <input
                    class="pf-ipp__input"
                    type="number"
                    min="0"
                    [value]="p.amount || ''"
                    (input)="setSplitAmount($index, +asVal($event))"
                    placeholder="0"
                  />
                </div>
              }
              <p
                class="pf-ipp__muted"
                [attr.data-kind]="splitOk() ? 'ok' : 'short'"
              >
                Allocated {{ splitSum() | inr }} of {{ amount() | inr }}
              </p>
            </div>
          }
          @case ("later") {
            <!-- Advance payment (optional): collect a partial amount now; the
                 rest stays outstanding and is due on the report. -->
            <div class="pf-adv">
              <div class="pf-adv__row">
                <span class="pf-adv__title">Advance now</span>
                <input
                  type="number"
                  inputmode="numeric"
                  min="0"
                  [attr.max]="amount()"
                  class="pf-ipp__input pf-adv__input"
                  [value]="advance()"
                  (input)="setAdvance(asVal($event))"
                  placeholder="0"
                />
              </div>
              @if (advanceNum() > 0) {
                <div class="pf-adv__tenders">
                  @for (t of advanceModes; track t.id) {
                    <button
                      type="button"
                      class="pf-adv__tender"
                      [class.pf-adv__tender--on]="advanceMode() === t.id"
                      (click)="setAdvanceMode(t.id)"
                    >
                      {{ t.label }}
                    </button>
                  }
                </div>
                <p class="pf-adv__hint">
                  Collect <strong>{{ advanceNum() | inr }}</strong> now ·
                  <strong>{{ amount() - advanceNum() | inr }}</strong> stays
                  outstanding
                </p>
              } @else {
                <p class="pf-adv__hint pf-adv__hint--muted">
                  No advance — the full {{ amount() | inr }} is due on the
                  report.
                </p>
              }
            </div>
          }
          @default {
            <p class="pf-ipp__muted">
              Payment will be collected later (on report).
            </p>
          }
        }
      </div>

      <button
        type="button"
        class="pf-ipp__confirm"
        [disabled]="busy() || blocked() || !canConfirm()"
        (click)="emit()"
      >
        @if (mode() === "later") {
          @if (advanceNum() > 0) {
            Collect advance · {{ advanceNum() | inr }}
          } @else {
            Place order (pay later)
          }
        } @else {
          {{ busy() ? "Processing…" : "Confirm payment" }}
        }
      </button>
    </div>
  `,
  styles: [
    `
      .pf-ipp {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .pf-ipp__eyebrow {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--text-muted);
      }
      .pf-ipp__modes {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      @media (min-width: 480px) {
        .pf-ipp__modes {
          grid-template-columns: repeat(6, 1fr);
        }
      }
      .pf-mode {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 10px 4px;
        border-radius: 12px;
        background: var(--glass-bg, rgba(255, 255, 255, 0.04));
        border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
        color: var(--text-primary);
        cursor: pointer;
        transition: all 0.15s;
      }
      .pf-mode:hover:not(.pf-mode--on) {
        background: var(--glass-bg-hover, rgba(255, 255, 255, 0.07));
      }
      .pf-mode svg {
        width: 18px;
        height: 18px;
        color: var(--text-secondary);
      }
      .pf-mode__label {
        font-size: 11px;
        font-weight: 600;
      }
      .pf-mode--on {
        background: color-mix(
          in srgb,
          var(--color-primary, #7c3aed) 15%,
          transparent
        );
        border-color: color-mix(
          in srgb,
          var(--color-primary, #7c3aed) 45%,
          transparent
        );
        box-shadow: inset 0 0 0 1px
          color-mix(in srgb, var(--color-primary, #7c3aed) 45%, transparent);
      }
      .pf-mode--on svg {
        color: var(--color-primary, #7c3aed);
      }
      .pf-ipp__body {
        min-height: 80px;
      }
      .pf-ipp__center {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
      }
      .pf-ipp__big {
        font-size: 24px;
        font-weight: 800;
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }
      .pf-ipp__qr {
        background: #fff;
        padding: 8px;
        border-radius: 12px;
      }
      .pf-ipp__qr img {
        display: block;
      }
      .pf-ipp__hint {
        font-size: 11px;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        color: var(--text-tertiary);
      }
      .pf-ipp__input {
        width: 100%;
        padding: 9px 12px;
        border-radius: 10px;
        border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
        background: var(--glass-bg, rgba(255, 255, 255, 0.04));
        color: var(--text-primary);
        font-size: 13px;
      }
      .pf-cash {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .pf-cash__head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }
      .pf-cash__label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--text-muted);
      }
      .pf-cash__amt {
        font-size: 22px;
        font-weight: 800;
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }
      .pf-cash__amt--empty {
        color: var(--text-muted);
      }
      .pf-cash__quick {
        display: flex;
        gap: 6px;
      }
      .pf-cash__quick button {
        flex: 1;
        padding: 8px 0;
        border-radius: 10px;
        font-size: 12.5px;
        font-weight: 700;
        cursor: pointer;
        border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
        background: var(--glass-bg, rgba(255, 255, 255, 0.04));
        color: var(--text-secondary);
      }
      .pf-cash__quick button:hover {
        background: rgba(139, 92, 246, 0.12);
        border-color: rgba(139, 92, 246, 0.4);
        color: var(--text-primary);
      }
      .pf-cash__change {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
      }
      .pf-cash__change span {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-secondary);
      }
      .pf-cash__change strong {
        font-size: 22px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      .pf-cash__change[data-kind="change"] {
        background: rgba(52, 211, 153, 0.1);
        border-color: rgba(52, 211, 153, 0.4);
      }
      .pf-cash__change[data-kind="change"] span,
      .pf-cash__change[data-kind="change"] strong {
        color: #34d399;
      }
      .pf-cash__change[data-kind="exact"] {
        background: rgba(52, 211, 153, 0.06);
        border-color: rgba(52, 211, 153, 0.25);
      }
      .pf-cash__change[data-kind="exact"] span {
        color: #34d399;
      }
      .pf-cash__change[data-kind="short"] {
        background: rgba(248, 113, 113, 0.1);
        border-color: rgba(248, 113, 113, 0.4);
      }
      .pf-cash__change[data-kind="short"] span,
      .pf-cash__change[data-kind="short"] strong {
        color: #f87171;
      }
      .pf-ipp__wallet,
      .pf-ipp__split {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .pf-ipp__vendor {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 10px;
        background: var(--glass-bg, rgba(255, 255, 255, 0.04));
        border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
      }
      .pf-ipp__vbalance {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 8px;
        padding: 8px 12px;
        border-radius: 10px;
        background: rgba(124, 58, 237, 0.08);
        border: 1px solid rgba(168, 85, 247, 0.22);
        font-size: 12px;
      }
      .pf-ipp__vbalance-now { color: var(--text-secondary, #cbd5e1); }
      .pf-ipp__vbalance-arrow { color: var(--text-muted, #94a3b8); }
      .pf-ipp__vbalance-after { color: var(--text-primary, #f1f5f9); font-weight: 600; }
      .pf-ipp__link {
        background: none;
        border: 0;
        color: var(--color-primary, #a78bfa);
        font-weight: 600;
        cursor: pointer;
        font-size: 12px;
      }
      .pf-ipp__vlist {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 180px;
        overflow-y: auto;
      }
      .pf-ipp__vrow {
        width: 100%;
        display: flex;
        justify-content: space-between;
        padding: 8px 12px;
        border-radius: 10px;
        border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.1));
        background: transparent;
        color: var(--text-primary);
        cursor: pointer;
        font-size: 13px;
      }
      .pf-ipp__vrow:hover {
        background: rgba(139, 92, 246, 0.1);
      }
      .pf-ipp__vbal {
        color: var(--text-tertiary);
        font-variant-numeric: tabular-nums;
      }
      .pf-ipp__splitrow {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .pf-ipp__muted {
        font-size: 12px;
        color: var(--text-tertiary);
      }
      .pf-ipp__muted[data-kind="ok"] {
        color: #34d399;
      }
      .pf-ipp__muted[data-kind="short"] {
        color: #f87171;
      }
      /* ── Advance (pay-later) block ── */
      .pf-adv {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .pf-adv__row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .pf-adv__title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-secondary);
        white-space: nowrap;
      }
      .pf-adv__input {
        flex: 1 1 auto;
      }
      .pf-adv__max {
        flex: 0 0 auto;
        padding: 9px 14px;
        border-radius: 10px;
        cursor: pointer;
        border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
        background: transparent;
        color: var(--text-secondary);
        font-weight: 600;
        font-size: 13px;
      }
      .pf-adv__tenders {
        display: flex;
        gap: 8px;
      }
      .pf-adv__tender {
        flex: 1 1 0;
        padding: 9px 0;
        border-radius: 10px;
        cursor: pointer;
        border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
        background: transparent;
        color: var(--text-secondary);
        font-weight: 600;
        font-size: 13px;
      }
      .pf-adv__tender--on {
        border-color: var(--accent, #7c3aed);
        color: var(--text-primary);
        background: color-mix(in srgb, var(--accent, #7c3aed) 16%, transparent);
      }
      .pf-adv__hint {
        font-size: 12px;
        color: var(--text-secondary);
        margin: 0;
      }
      .pf-adv__hint strong {
        color: var(--text-primary);
      }
      .pf-adv__hint--muted {
        color: var(--text-tertiary);
      }
      .pf-ipp__confirm {
        width: 100%;
        padding: 13px;
        border-radius: 14px;
        border: 0;
        cursor: pointer;
        background: var(
          --gradient-primary,
          linear-gradient(135deg, #7c3aed, #ec4899)
        );
        color: #fff;
        font-weight: 700;
        font-size: 15px;
      }
      .pf-ipp__confirm:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* ── Cross-platform overrides (additive; sub-desktop / touch only) ── */
      /* iOS zoom guard: text inputs <16px zoom Safari on focus. */
      @media (max-width: 1279px) {
        :host .pf-ipp__input {
          font-size: 16px;
        }
      }
      /* Touch sizing: grow small tap targets to ≥44px on coarse pointers. */
      @media (pointer: coarse) {
        :host .pf-ipp__input {
          padding-top: 12px;
          padding-bottom: 12px;
        }
        :host .pf-cash__quick button {
          padding-top: 12px;
          padding-bottom: 12px;
        }
        :host .pf-ipp__vrow {
          padding-top: 12px;
          padding-bottom: 12px;
        }
        :host .pf-ipp__link {
          min-height: 40px;
          padding: 0 6px;
        }
      }
    `,
  ],
})
export class InlinePaymentPanelComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly amount = input<number>(0);
  readonly patientPhone = input<string | undefined>(undefined);
  readonly busy = input<boolean>(false);
  /** Host blocks Confirm (e.g. discount over the user's cap). */
  readonly blocked = input<boolean>(false);
  readonly confirm = output<InlinePaymentResult>();

  readonly modes: ModeDef[] = [
    { id: "upi", label: "UPI", iconPath: "M12 4v16M5 8h14M5 16h14" },
    {
      id: "card",
      label: "Card",
      iconPath: "M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 11h18",
    },
    {
      id: "cash",
      label: "Cash",
      iconPath: "M3 6h18v12H3zM7 12a5 3 0 0 1 10 0 5 3 0 0 1-10 0Z",
    },
    {
      id: "wallet",
      label: "Credit Wallet",
      iconPath:
        "M21 7H5a2 2 0 0 0 0 4h16v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14M17 14h.01",
    },
    { id: "split", label: "Split", iconPath: "M6 3v18M18 3v18M3 12h18" },
    {
      id: "later",
      label: "Pay later",
      iconPath: "M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    },
  ];
  readonly mode = signal<PayMode>("cash");
  setMode(m: PayMode) {
    this.mode.set(m);
    if (m === "wallet") this.loadVendors();
  }

  // Cash
  readonly cash = signal("");
  readonly cashNum = computed(() => parseInt(this.cash() || "0", 10) || 0);
  readonly change = computed(() => this.cashNum() - this.amount());
  readonly changeAbs = computed(() => Math.abs(this.change()));
  readonly cashNotes = [100, 500, 2000];
  setExactCash() {
    this.cash.set(String(this.amount()));
  }
  addCash(n: number) {
    this.cash.set(String(this.cashNum() + n));
  }

  // Card ref
  readonly refNo = signal("");

  // Advance (pay-later mode): collect part now, leave the rest outstanding.
  readonly advance = signal("");
  readonly advanceNum = computed(() =>
    Math.min(this.amount(), parseInt(this.advance() || "0", 10) || 0),
  );
  readonly advanceMode = signal<PayMode>("cash");
  readonly advanceModes: Array<{ id: PayMode; label: string }> = [
    { id: "cash", label: "Cash" },
    { id: "upi", label: "UPI" },
    { id: "card", label: "Card" },
  ];
  setAdvance(v: string) {
    this.advance.set((v || "").replace(/\D/g, ""));
  }
  setAdvanceMode(m: PayMode) {
    this.advanceMode.set(m);
  }

  // Wallet
  readonly vendors = signal<VendorWallet[] | null>(null);
  readonly vendorId = signal<string | null>(null);
  readonly vendorQuery = signal("");
  readonly filteredVendors = computed(() => {
    const q = this.vendorQuery().trim().toLowerCase();
    const list = (this.vendors() ?? []).filter((v) => v.isActive);
    return q
      ? list.filter(
          (v) =>
            v.name.toLowerCase().includes(q) ||
            (v.code ?? "").toLowerCase().includes(q),
        )
      : list.slice(0, 25);
  });
  vendorName(id: string): string {
    return this.vendors()?.find((v) => v.id === id)?.name ?? "Vendor";
  }
  /** The selected vendor's live wallet, for the in-cart balance line. */
  selectedVendor(id: string): VendorWallet | undefined {
    return this.vendors()?.find((v) => v.id === id);
  }
  /** Format an outstanding figure: "₹X due" / "₹Y in credit" / "Settled". */
  outstandingLabel(n: number): string {
    if (Math.abs(n) < 0.005) return 'Settled';
    const f = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
    return n > 0 ? `${f.format(n)} due` : `${f.format(-n)} in credit`;
  }
  private loadVendors() {
    if (this.vendors() !== null) return;
    this.api.get<VendorWallet[]>("/api/vendors").subscribe({
      next: (l) => this.vendors.set(l ?? []),
      error: () => this.vendors.set([]),
    });
  }

  // Split
  readonly splitParts = signal<Array<{ mode: PayMode; amount: number }>>([
    { mode: "cash", amount: 0 },
    { mode: "upi", amount: 0 },
  ]);
  readonly splitSum = computed(() =>
    this.splitParts().reduce((a, p) => a + (p.amount || 0), 0),
  );
  readonly splitOk = computed(
    () => this.splitSum() === this.amount() && this.amount() > 0,
  );
  setSplitMode(i: number, m: string) {
    this.splitParts.update((ps) =>
      ps.map((p, idx) => (idx === i ? { ...p, mode: m as PayMode } : p)),
    );
  }
  setSplitAmount(i: number, v: number) {
    this.splitParts.update((ps) =>
      ps.map((p, idx) =>
        idx === i ? { ...p, amount: isFinite(v) ? v : 0 } : p,
      ),
    );
  }

  // UPI QR (same generator as the billing screen, driven by the cart total).
  readonly upiQrUrl = computed<string>(() => {
    const params = new URLSearchParams({
      pa: "prefrontal@upi",
      pn: "Prefrontal Lab",
      am: String(this.amount()),
      cu: "INR",
    });
    return `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=8&data=${encodeURIComponent("upi://pay?" + params.toString())}`;
  });

  readonly canConfirm = computed(() => {
    switch (this.mode()) {
      case "cash":
        return this.cashNum() >= this.amount() && this.amount() > 0;
      case "wallet":
        return !!this.vendorId();
      case "split":
        return this.splitOk();
      default:
        return this.amount() > 0 || this.mode() === "later";
    }
  });

  ngOnInit() {
    /* vendors load lazily on wallet select */
  }

  asVal(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }

  emit() {
    const m = this.mode();
    const r: InlinePaymentResult = { mode: m };
    if (m === "cash") r.cashTendered = this.cashNum();
    if (m === "card") r.referenceNo = this.refNo().trim() || undefined;
    if (m === "wallet") r.vendorId = this.vendorId() ?? undefined;
    if (m === "split")
      r.splitParts = this.splitParts().filter((p) => p.amount > 0);
    if (m === "later" && this.advanceNum() > 0) {
      r.advanceAmount = this.advanceNum();
      r.advanceMode = this.advanceMode();
    }
    this.confirm.emit(r);
  }
}
