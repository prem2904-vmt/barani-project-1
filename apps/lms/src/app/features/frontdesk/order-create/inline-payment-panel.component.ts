import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { ApiService } from "../../../core/services/api.service";
import { CurrencyInrPipe } from "../../../shared/pipes/currency-inr.pipe";

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

/** How it is being paid — the designer's three-way choice. */
export type PayKind = "now" | "vendor" | "later";
/** Pay-now methods. */
type NowMethod = "upi" | "card" | "cash" | "split";
type SplitMode = "upi" | "card" | "cash";

interface MethodDef {
  id: NowMethod;
  label: string;
  iconPath: string;
}

/**
 * Live payment pane — driven by the cart total (no bill yet). Designer panel:
 * "How is it being paid?" Pay now (UPI / Card / Cash / Split) · Bill to vendor
 * (the Credit Wallet) · Pay later (optional advance). Persists nothing: it
 * emits the chosen payment via (confirm) and the host creates the order +
 * bill + records payment. Used by Order & Payments and the frontdesk
 * due-settlement drawer.
 */
@Component({
  selector: "pf-inline-payment-panel",
  standalone: true,
  imports: [CurrencyInrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-ipp">
      <!-- How is it being paid? (designer panel): Pay now / Bill to vendor /
           Pay later. "Bill to vendor" is the Credit Wallet (vendor tab). -->
      <p class="pf-ipp__q">How is it being paid?</p>
      <div class="pf-ipp__kinds" role="radiogroup" aria-label="How is it being paid">
        @for (k of kinds(); track k.id) {
          <button type="button" class="pf-ipp__kind" role="radio"
                  [attr.aria-checked]="kind() === k.id"
                  (click)="setKind(k.id)">{{ k.label }}</button>
        }
      </div>

      @switch (kind()) {
        @case ("now") {
          <div class="pf-ipp__methods" role="radiogroup" aria-label="Payment method">
            @for (m of methods; track m.id) {
              <button type="button" class="pf-ipp__method" role="radio"
                      [attr.aria-checked]="method() === m.id"
                      (click)="setMode(m.id)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path [attr.d]="m.iconPath" />
                </svg>
                <span>{{ m.label }}</span>
              </button>
            }
          </div>

          <div class="pf-ipp__detail">
            @switch (method()) {
              @case ("upi") {
                <div class="pf-ipp__upi">
                  <div class="pf-ipp__qr">
                    <img [src]="upiQrUrl()" alt="UPI QR code to pay" width="84" height="84" />
                  </div>
                  <div class="pf-ipp__upi-text">
                    <span>Scan with any UPI app</span>
                    <strong>{{ amount() | inr }}</strong>
                    <span class="pf-ipp__mono">prefrontal&#64;upi</span>
                  </div>
                </div>
              }
              @case ("card") {
                <div class="pf-ipp__stack">
                  <span>Charge <strong>{{ amount() | inr }}</strong> on the terminal. Tap, insert or swipe the card.</span>
                  <label class="pf-ipp__label">
                    Approval / reference no. (optional)
                    <input class="pf-ipp__input" placeholder="From the terminal slip"
                           [value]="refNo()" (input)="refNo.set(asVal($event))" />
                  </label>
                </div>
              }
              @case ("cash") {
                <div class="pf-ipp__stack">
                  <label class="pf-ipp__label">
                    Cash received
                    <!-- Digits only: brings up the OS number pad on phones. -->
                    <input class="pf-ipp__input pf-ipp__input--num" inputmode="numeric" autocomplete="off"
                           enterkeyhint="done" [value]="cash()" (input)="cash.set(cashDigits($event))"
                           placeholder="Amount received" />
                  </label>
                  <div class="pf-ipp__quick">
                    <button type="button" (click)="setExactCash()">Exact</button>
                    @for (n of cashNotes; track n) {
                      <button type="button" (click)="addCash(n)">+{{ n }}</button>
                    }
                  </div>
                  <!-- The whole point: how much to hand back. -->
                  <p class="pf-ipp__change" [attr.data-kind]="cashNum() === 0 ? 'idle' : change() > 0 ? 'change' : change() === 0 ? 'exact' : 'short'">
                    @if (cashNum() === 0) {
                      Due {{ amount() | inr }}
                    } @else if (change() > 0) {
                      Return to patient <strong>{{ changeAbs() | inr }}</strong>
                    } @else if (change() === 0) {
                      Exact, no change due
                    } @else {
                      Short by <strong>{{ changeAbs() | inr }}</strong>
                    }
                  </p>
                </div>
              }
              @case ("split") {
                <div class="pf-ipp__stack">
                  <span>Enter how much goes to each method</span>
                  @for (m of splitModes; track m.id) {
                    <label class="pf-ipp__splitrow">
                      <span>{{ m.label }}</span>
                      <input class="pf-ipp__input" type="text" inputmode="decimal" placeholder="₹0.00"
                             [attr.aria-label]="m.label + ' amount'"
                             [value]="splitAmounts()[m.id] || ''"
                             (input)="setSplitAmount(m.id, asVal($event))" />
                    </label>
                  }
                  <p class="pf-ipp__muted" [attr.data-kind]="splitOk() ? 'ok' : 'short'">
                    Allocated {{ splitSum() | inr }} of {{ amount() | inr }}
                  </p>
                </div>
              }
            }
          </div>
        }
        @case ("vendor") {
          <div class="pf-ipp__detail pf-ipp__detail--col">
            <span class="pf-ipp__title">Bill to vendor</span>
            @if (vendorId(); as vid) {
              <div class="pf-ipp__vendor">
                <span>{{ vendorName(vid) }}</span>
                <button type="button" class="pf-ipp__link" (click)="vendorId.set(null)">Change</button>
              </div>
              <!-- Live balance: current outstanding, and where it lands after
                   this order is charged to the tab. -->
              @if (selectedVendor(vid); as sv) {
                <div class="pf-ipp__vbalance">
                  <span class="pf-ipp__vbalance-now">Current: {{ outstandingLabel(sv.outstanding) }}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-6 6 6-6 6"/></svg>
                  <span class="pf-ipp__vbalance-after">After this order: {{ outstandingLabel(sv.outstanding + amount()) }}</span>
                </div>
              }
            } @else {
              <span class="pf-ipp__muted">The bill goes to the vendor's account.</span>
              <input class="pf-ipp__input" placeholder="Search vendor…" aria-label="Search vendor"
                     [value]="vendorQuery()" (input)="vendorQuery.set(asVal($event))" />
              @if (vendors() === null) {
                <p class="pf-ipp__muted">Loading vendors…</p>
              } @else if (filteredVendors().length === 0) {
                <p class="pf-ipp__muted">No vendors.</p>
              } @else {
                <ul class="pf-ipp__vlist">
                  @for (v of filteredVendors(); track v.id) {
                    <li>
                      <button type="button" class="pf-ipp__vrow" (click)="vendorId.set(v.id)">
                        <span>{{ v.name }}</span><span class="pf-ipp__vbal">{{ outstandingLabel(v.outstanding) }}</span>
                      </button>
                    </li>
                  }
                </ul>
              }
            }
          </div>
        }
        @case ("later") {
          <!-- Advance payment (optional): collect a partial amount now; the
               rest stays outstanding and is due on the report. -->
          <div class="pf-ipp__detail pf-ipp__detail--col">
            <span class="pf-ipp__title">Pay later</span>
            <label class="pf-ipp__label">
              Advance collected now (optional)
              <input type="text" inputmode="numeric" class="pf-ipp__input" placeholder="₹0.00"
                     [class.pf-ipp__input--err]="advanceOver()"
                     [attr.aria-invalid]="advanceOver() ? 'true' : null"
                     [attr.aria-describedby]="advanceOver() ? 'pf-ipp-adv-err' : null"
                     [value]="advance()" (input)="setAdvance(asVal($event))" />
            </label>
            @if (advanceOver()) {
              <!-- Never silently clamp: the desk must see the advance is over
                   the bill and correct it (Confirm stays blocked). -->
              <p class="pf-ipp__err" id="pf-ipp-adv-err" role="alert">
                Advance can't be more than the bill, {{ amount() | inr }}. Reduce it to continue.
              </p>
            } @else if (advanceNum() > 0) {
              <div class="pf-ipp__tenders" role="radiogroup" aria-label="Advance paid by">
                @for (t of advanceModes; track t.id) {
                  <button type="button" class="pf-ipp__tender" role="radio"
                          [attr.aria-checked]="advanceMode() === t.id"
                          (click)="setAdvanceMode(t.id)">{{ t.label }}</button>
                }
              </div>
              <p class="pf-ipp__muted">
                Collect <strong>{{ advanceNum() | inr }}</strong> now ·
                <strong>{{ amount() - advanceNum() | inr }}</strong> stays outstanding
              </p>
            } @else {
              <p class="pf-ipp__muted">No advance: the full {{ amount() | inr }} is due on the report.</p>
            }
          </div>
        }
      }

      @if (!externalFooter()) {
        <button type="button" class="pf-ipp__confirm" [disabled]="confirmDisabled()" (click)="emit()">
          {{ confirmLabel() }}
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .pf-ipp { display: flex; flex-direction: column; gap: 8px; }
      .pf-ipp__q { margin: 0; font-size: 12px; color: var(--text-secondary); }

      /* Pay now / Bill to vendor / Pay later — one segmented track. */
      .pf-ipp__kinds {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 4px;
        padding: 3px; border-radius: 10px;
        background: var(--glass-bg-hover, rgba(127, 127, 127, 0.08));
      }
      .pf-ipp__kind {
        height: 30px; border: 0; border-radius: 8px; cursor: pointer;
        background: transparent; color: var(--text-secondary);
        font: inherit; font-size: 12px; white-space: nowrap;
        transition: background 0.15s, color 0.15s;
      }
      .pf-ipp__kind:hover:not([aria-checked="true"]) { color: var(--text-primary); }
      /* Neutral raised segment (primary is kept for the one main CTA). */
      .pf-ipp__kind[aria-checked="true"] {
        background: var(--bg-card-solid, #fff); color: var(--text-primary); font-weight: 600;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      /* UPI / Card / Cash / Split tiles. */
      .pf-ipp__methods { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
      .pf-ipp__method {
        height: 54px; border-radius: 10px; cursor: pointer;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
        font: inherit; font-size: 12px;
        border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-secondary);
        transition: background 0.15s, border-color 0.15s, color 0.15s;
      }
      .pf-ipp__method:hover:not([aria-checked="true"]) { border-color: var(--card-hover-border, var(--glass-border-hover)); color: var(--text-primary); }
      /* Neutral selected tile: stronger border + light tint, normal text. */
      .pf-ipp__method[aria-checked="true"] {
        border: 1.5px solid color-mix(in srgb, var(--text-primary) 55%, transparent);
        background: color-mix(in srgb, var(--text-primary) 6%, transparent);
        color: var(--text-primary);
      }

      /* The selected method's detail panel. */
      .pf-ipp__detail {
        min-height: 98px; box-sizing: border-box; padding: 10px 12px;
        border: 1px solid var(--glass-border); border-radius: 10px;
        display: flex; align-items: center; gap: 12px;
        font-size: 12px; color: var(--text-secondary);
      }
      .pf-ipp__detail--col { flex-direction: column; align-items: stretch; gap: 6px; min-height: 0; }
      .pf-ipp__title { font-weight: 600; color: var(--text-primary); }
      .pf-ipp__stack { display: flex; flex-direction: column; gap: 8px; width: 100%; }
      .pf-ipp__stack strong { color: var(--text-primary); }
      .pf-ipp__label { display: flex; flex-direction: column; gap: 4px; }
      .pf-ipp__upi { display: flex; align-items: center; gap: 12px; }
      .pf-ipp__qr { background: #fff; padding: 4px; border-radius: 8px; flex-shrink: 0; line-height: 0; }
      .pf-ipp__qr img { display: block; width: 76px; height: 76px; }
      .pf-ipp__upi-text { display: flex; flex-direction: column; gap: 3px; }
      .pf-ipp__upi-text strong { font-size: 15px; color: var(--text-primary); font-variant-numeric: tabular-nums; }
      .pf-ipp__mono { font-family: inherit; font-variant-numeric: tabular-nums; color: var(--text-tertiary); }

      .pf-ipp__input {
        width: 100%; height: 32px; box-sizing: border-box; padding: 0 10px;
        border-radius: 8px; border: 1px solid var(--input-border, var(--glass-border));
        background: var(--input-bg, transparent); color: var(--input-text, var(--text-primary));
        font: inherit; font-size: 13px; outline: none;
      }
      .pf-ipp__input::placeholder { color: var(--input-placeholder, var(--text-muted)); }
      .pf-ipp__input:focus { border-color: var(--input-border-focus, #8b5cf6); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent); }
      .pf-ipp__input--num { font-variant-numeric: tabular-nums; font-weight: 600; }

      .pf-ipp__quick { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
      .pf-ipp__quick button {
        height: 26px; border-radius: 7px; cursor: pointer; font: inherit; font-size: 12px;
        border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-secondary);
      }
      .pf-ipp__quick button:hover { border-color: var(--card-hover-border, var(--glass-border-hover)); color: var(--text-primary); }
      .pf-ipp__change { margin: 0; font-size: 12px; color: var(--text-tertiary); display: flex; justify-content: space-between; gap: 8px; }
      .pf-ipp__change strong { font-size: 14px; font-variant-numeric: tabular-nums; }
      .pf-ipp__change[data-kind='change'], .pf-ipp__change[data-kind='exact'] { color: var(--violet-text, #6d28d9); }
      .pf-ipp__change[data-kind='change'] strong { color: var(--violet-text, #6d28d9); }
      .pf-ipp__change[data-kind='short'], .pf-ipp__change[data-kind='short'] strong { color: var(--error-text, #ef4444); }

      .pf-ipp__splitrow { display: flex; align-items: center; gap: 6px; }
      .pf-ipp__splitrow span { width: 60px; flex-shrink: 0; }
      .pf-ipp__splitrow .pf-ipp__input { height: 28px; }

      .pf-ipp__muted { margin: 0; font-size: 12px; color: var(--text-tertiary); }
      .pf-ipp__err { margin: 0; font-size: 12px; color: var(--error-text, #ef4444); }
      .pf-ipp__input--err, .pf-ipp__input--err:focus { border-color: var(--error-text, #ef4444); }
      .pf-ipp__muted strong { color: var(--text-primary); }
      .pf-ipp__muted[data-kind='ok'] { color: var(--violet-text, #6d28d9); }
      .pf-ipp__muted[data-kind='short'] { color: var(--error-text, #ef4444); }

      .pf-ipp__vendor {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 8px 12px; border-radius: 10px; color: var(--text-primary);
        background: var(--glass-bg); border: 1px solid var(--glass-border);
      }
      .pf-ipp__vbalance {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        padding: 8px 12px; border-radius: 10px;
        background: color-mix(in srgb, var(--color-primary, #7c3aed) 8%, transparent);
        border: 1px solid var(--border-primary, rgba(139, 92, 246, 0.22));
      }
      .pf-ipp__vbalance svg { color: var(--text-muted); }
      .pf-ipp__vbalance-after { color: var(--text-primary); font-weight: 600; }
      .pf-ipp__link { background: none; border: 0; color: var(--color-primary, #7c3aed); font-weight: 600; cursor: pointer; font-size: 12px; }
      .pf-ipp__vlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
      .pf-ipp__vrow {
        width: 100%; display: flex; justify-content: space-between; gap: 8px;
        padding: 8px 12px; border-radius: 10px; cursor: pointer; font: inherit; font-size: 13px;
        border: 1px solid var(--glass-border); background: transparent; color: var(--text-primary);
      }
      .pf-ipp__vrow:hover { background: var(--bg-hover); }
      .pf-ipp__vbal { color: var(--text-tertiary); font-variant-numeric: tabular-nums; }

      .pf-ipp__tenders { display: flex; gap: 6px; }
      .pf-ipp__tender {
        flex: 1 1 0; height: 30px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
        border: 1px solid var(--glass-border); background: transparent; color: var(--text-secondary);
      }
      .pf-ipp__tender[aria-checked="true"] {
        border-color: color-mix(in srgb, var(--text-primary) 55%, transparent); color: var(--text-primary);
        background: color-mix(in srgb, var(--text-primary) 6%, transparent);
      }

      /* Own Confirm (hosts without a pinned footer, e.g. the frontdesk
         due-settlement drawer). */
      .pf-ipp__confirm {
        width: 100%; height: 40px; border-radius: 10px; border: 0; cursor: pointer;
        background: var(--gradient-primary, linear-gradient(135deg, #7c3aed, #ec4899));
        color: #fff; font: inherit; font-weight: 600; font-size: 13px;
      }
      .pf-ipp__confirm:disabled { opacity: 0.5; cursor: not-allowed; }

      /* iOS zoom guard: text inputs <16px zoom Safari on focus. */
      @media (max-width: 1023px) {
        :host .pf-ipp__input { font-size: 16px; height: 40px; }
      }
      /* Touch sizing: grow small tap targets on coarse pointers. */
      @media (pointer: coarse) {
        :host .pf-ipp__kind { height: 38px; }
        :host .pf-ipp__quick button, :host .pf-ipp__tender { height: 38px; }
        :host .pf-ipp__vrow { padding-top: 12px; padding-bottom: 12px; }
        :host .pf-ipp__link { min-height: 40px; padding: 0 6px; }
      }
    `,
  ],
})
export class InlinePaymentPanelComponent {
  private readonly api = inject(ApiService);
  private readonly inr = new CurrencyInrPipe();

  readonly amount = input<number>(0);
  readonly patientPhone = input<string | undefined>(undefined);
  readonly busy = input<boolean>(false);
  /** Host blocks Confirm (e.g. discount over the user's cap). */
  readonly blocked = input<boolean>(false);
  /** When false, "Pay later" is hidden — used when SETTLING an existing due
   *  (a due is one-time; it must be cleared, not re-deferred). */
  readonly allowLater = input<boolean>(true);
  /** The host renders Confirm itself (the order screen's pinned billing
   *  footer reads confirmLabel/confirmDisabled and calls emit()). */
  readonly externalFooter = input<boolean>(false);
  /** Referring hospital picked in the order's search pill. "Bill to vendor"
   *  pre-selects the vendor with exactly this name, when one exists. */
  readonly vendorHint = input<string>("");
  readonly confirm = output<InlinePaymentResult>();

  /** How it is being paid (designer panel). */
  readonly kind = signal<PayKind>("now");
  readonly kinds = computed<Array<{ id: PayKind; label: string }>>(() => [
    { id: "now", label: "Pay now" },
    { id: "vendor", label: "Bill to vendor" },
    ...(this.allowLater() ? [{ id: "later" as const, label: "Pay later" }] : []),
  ]);
  /** Pay-now method tiles. */
  readonly methods: MethodDef[] = [
    { id: "upi", label: "UPI", iconPath: "M12 3v18M7 8h10M7 14h10" },
    { id: "card", label: "Card", iconPath: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18" },
    { id: "cash", label: "Cash", iconPath: "M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" },
    { id: "split", label: "Split", iconPath: "M8 3v18M16 3v18M4 12h16" },
  ];
  readonly method = signal<NowMethod>("cash");

  /** The payment mode this panel will emit — the same PayMode contract the
   *  hosts have always consumed (vendor = the Credit Wallet). */
  readonly mode = computed<PayMode>(() => {
    const k = this.kind();
    return k === "vendor" ? "wallet" : k === "later" ? "later" : this.method();
  });

  setKind(k: PayKind) {
    if (k === "later" && !this.allowLater()) return;
    this.kind.set(k);
    if (k === "vendor") this.loadVendors();
  }
  /** Select a mode by its PayMode id (kept for hosts/tests that think in modes). */
  setMode(m: PayMode) {
    if (m === "later") return this.setKind("later");
    if (m === "wallet") return this.setKind("vendor");
    this.kind.set("now");
    this.method.set(m);
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

  // Advance (pay-later): collect part now, leave the rest outstanding.
  readonly advance = signal("");
  /** The advance as typed (whole rupees). Never silently clamped: an advance
   *  above the payable balance is an error the desk must correct. */
  readonly advanceNum = computed(() => parseInt(this.advance() || "0", 10) || 0);
  /** Advance exceeds what is owed → inline error + Confirm blocked. */
  readonly advanceOver = computed(() => this.advanceNum() > this.amount() + 0.005);
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

  // Vendor (Credit Wallet)
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
    if (Math.abs(n) < 0.005) return "Settled";
    const f = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
    return n > 0 ? `${f.format(n)} due` : `${f.format(-n)} in credit`;
  }
  private loadVendors() {
    if (this.vendors() !== null) { this.applyVendorHint(); return; }
    this.api.get<VendorWallet[]>("/api/vendors").subscribe({
      next: (l) => { this.vendors.set(l ?? []); this.applyVendorHint(); },
      error: () => this.vendors.set([]),
    });
  }
  /** Pre-select the vendor named like the referring hospital (exact, case-
   *  insensitive). Never overrides a vendor the user already chose. */
  private applyVendorHint() {
    if (this.vendorId()) return;
    const h = this.vendorHint().trim().toLowerCase();
    if (!h) return;
    const v = (this.vendors() ?? []).find((x) => x.isActive && x.name.trim().toLowerCase() === h);
    if (v) this.vendorId.set(v.id);
  }

  // Split — one amount per method (UPI / Card / Cash).
  readonly splitModes: Array<{ id: SplitMode; label: string }> = [
    { id: "upi", label: "UPI" },
    { id: "card", label: "Card" },
    { id: "cash", label: "Cash" },
  ];
  readonly splitAmounts = signal<Record<SplitMode, number>>({ upi: 0, card: 0, cash: 0 });
  /** The non-zero parts, in the shape hosts post as individual payments. */
  readonly splitParts = computed<Array<{ mode: PayMode; amount: number }>>(() =>
    this.splitModes
      .map((m) => ({ mode: m.id as PayMode, amount: this.splitAmounts()[m.id] || 0 }))
      .filter((p) => p.amount > 0),
  );
  readonly splitSum = computed(() =>
    Math.round(this.splitParts().reduce((a, p) => a + p.amount, 0) * 100) / 100,
  );
  readonly splitOk = computed(
    () => this.amount() > 0 && Math.abs(this.splitSum() - this.amount()) < 0.005,
  );
  setSplitAmount(m: SplitMode, v: string) {
    const n = parseFloat((v || "").replace(/[^0-9.]/g, ""));
    this.splitAmounts.update((a) => ({ ...a, [m]: isFinite(n) && n > 0 ? n : 0 }));
  }

  // UPI QR (same generator as before, driven by the amount).
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
      case "later":
        return !this.advanceOver();
      default:
        return this.amount() > 0;
    }
  });
  readonly confirmDisabled = computed(() => this.busy() || this.blocked() || !this.canConfirm());

  /** Confirm label reflects the real amount and the chosen mode (designer). */
  readonly confirmLabel = computed(() => {
    if (this.busy()) return "Processing…";
    const amt = this.inr.transform(this.amount());
    switch (this.mode()) {
      case "card":
        return `Confirm ${amt} by card`;
      case "wallet":
        return `Bill ${amt} to vendor`;
      case "later": {
        const adv = this.advanceOver() ? 0 : this.advanceNum();
        return adv > 0
          ? `Collect ${this.inr.transform(adv)} now, ${this.inr.transform(this.amount() - adv)} due`
          : `Place order, ${amt} due`;
      }
      default:
        return `Confirm ${amt} received`;
    }
  });

  asVal(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  /** Cash field is whole rupees — keep only digits so the native OS numpad
   *  (mobile) or the keyboard (web) can't slip in stray characters. */
  cashDigits(e: Event): string {
    return (e.target as HTMLInputElement).value.replace(/\D/g, "");
  }

  emit() {
    if (this.confirmDisabled()) return;
    const m = this.mode();
    const r: InlinePaymentResult = { mode: m };
    if (m === "cash") r.cashTendered = this.cashNum();
    if (m === "card") r.referenceNo = this.refNo().trim() || undefined;
    if (m === "wallet") r.vendorId = this.vendorId() ?? undefined;
    if (m === "split") r.splitParts = this.splitParts();
    if (m === "later" && this.advanceNum() > 0) {
      r.advanceAmount = this.advanceNum();
      r.advanceMode = this.advanceMode();
    }
    this.confirm.emit(r);
  }
}
