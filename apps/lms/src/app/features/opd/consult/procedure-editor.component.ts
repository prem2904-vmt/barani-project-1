import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import type { ConsultProcedureDraft, ConsultProcedureOption, ProcedurePricing } from './consult.api';
import {
  MAX_PROCEDURE_QTY, PROCEDURE_SIDES, type ProcedureSide, checkProcedurePrice, parsePrice, proceduresTotal,
} from './procedure-rules';

let seq = 0;

/**
 * "Add procedure" in the consult (step 3): the department's procedure services
 * from the OPD Master, each with its fixed price (the ONE fee resolver on the
 * server). Several procedures, quantity, side (left / right / both) and a note
 * per line. The price is read-only unless the OPD workflow setting "Doctors
 * can change procedure prices" is on — then the doctor types the exact amount
 * (within the setting's cap; a reason is optional) and the desk sees
 * "set by Dr X (rule ₹Y)". Pure presentational: emits the new list.
 */
@Component({
  selector: 'pf-consult-procedures',
  standalone: true,
  imports: [CurrencyInrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!readonly()) {
      @if (options().length) {
        <div class="pr__add">
          <svg class="pr__sico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input #q class="nd-input pr__q" type="text" autocomplete="off" [value]="query()" (input)="query.set(q.value)"
                 placeholder="Add procedure — search this department's procedures" aria-label="Search procedures" />
        </div>
        <div class="pr__tiles" role="list" aria-label="Procedures you can add">
          @for (o of shownOptions(); track o.serviceId) {
            <button type="button" role="listitem" class="pr__tile" [class.on]="countOf(o.serviceId) > 0" (click)="add(o)" [attr.data-proc]="o.code || o.name">
              <span class="pr__tico" aria-hidden="true">
                @if (countOf(o.serviceId) > 0) { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> }
                @else { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> }
              </span>
              <span class="pr__tn">{{ o.name }}</span>
              <span class="pr__tp">{{ o.price | inr }}</span>
            </button>
          } @empty {
            <p class="pr__muted">No procedure matches “{{ query() }}”.</p>
          }
        </div>
        @if (!query().trim() && options().length > collapsedCount && !showAll()) {
          <button type="button" class="nd-btn nd-btn--quiet pr__more" (click)="showAll.set(true)">Show all {{ options().length }} procedures</button>
        }
      } @else {
        <p class="pr__muted">No procedures are set up for this department yet (OPD Master → services, category “Procedure”).</p>
      }
    }

    @if (items().length) {
      <ul class="pr__list" aria-label="Procedures done">
        @for (p of items(); track p.key) {
          <li class="pr__row" [attr.data-row]="p.serviceId">
            <div class="pr__top">
              <span class="pr__name">{{ p.name }}@if (p.code) { <em>{{ p.code }}</em> }</span>
              @if (!readonly() && p.status !== 'billed') {
                <button type="button" class="pr__x" (click)="remove(p.key)" [attr.aria-label]="'Remove ' + p.name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              }
            </div>
            <div class="pr__grid">
              <div class="pr__cell">
                <span class="pr__lbl">Side</span>
                <span class="nd-seg pr__seg" role="radiogroup" [attr.aria-label]="'Side for ' + p.name">
                  @for (s of sides; track s.label) {
                    <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="(p.side ?? null) === s.value"
                            [disabled]="readonly() || p.status === 'billed'" (click)="patch(p.key, { side: s.value })">{{ s.label }}</button>
                  }
                </span>
              </div>
              <div class="pr__cell">
                <span class="pr__lbl">Qty</span>
                <span class="pr__qty">
                  <button type="button" class="pr__step" [disabled]="readonly() || p.status === 'billed' || p.qty <= 1" (click)="patch(p.key, { qty: p.qty - 1 })" [attr.aria-label]="'Fewer ' + p.name">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>
                  </button>
                  <span class="pr__n nd-num" aria-live="polite">{{ p.qty }}</span>
                  <button type="button" class="pr__step" [disabled]="readonly() || p.status === 'billed' || p.qty >= maxQty" (click)="patch(p.key, { qty: p.qty + 1 })" [attr.aria-label]="'More ' + p.name">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                </span>
              </div>
              <div class="pr__cell pr__cell--price">
                <span class="pr__lbl">Price{{ p.qty > 1 ? ' (each)' : '' }}</span>
                @if (canChange() && p.status !== 'billed') {
                  <input class="nd-input nd-num pr__price" type="text" inputmode="decimal" [class.nd-input--error]="!!errs()[p.key]"
                         [value]="priceText(p)" (input)="onPrice(p, $any($event.target).value)" (blur)="settlePrice(p.key)"
                         [attr.aria-label]="'Price for ' + p.name" [attr.aria-invalid]="!!errs()[p.key]" />
                } @else {
                  <span class="pr__fixed nd-num">{{ p.price | inr }}@if (!canChange() && !readonly()) { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Fixed price"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg> }</span>
                }
                @if (p.price !== p.rulePrice) {
                  <span class="pr__rule">Rule {{ p.rulePrice | inr }}@if (p.priceSetByName) { · set by {{ p.priceSetByName }} }</span>
                }
              </div>
            </div>
            @if (errs()[p.key]; as e) { <p class="pr__err" role="alert">{{ e }}</p> }
            @if (p.price !== p.rulePrice && canChange() && p.status !== 'billed') {
              <input class="nd-input pr__note" type="text" [value]="p.priceReason ?? ''" (change)="patch(p.key, { priceReason: $any($event.target).value })"
                     placeholder="Why the price changed (optional) — the desk sees it" aria-label="Reason for the price change" maxlength="300" />
            }
            @if (!readonly() && p.status !== 'billed') {
              <input class="nd-input pr__note" type="text" [value]="p.note ?? ''" (change)="patch(p.key, { note: $any($event.target).value })"
                     placeholder="Note (optional) — e.g. under LA, polyp seen" [attr.aria-label]="'Note for ' + p.name" maxlength="500" />
            } @else if (p.note) {
              <p class="pr__muted">{{ p.note }}</p>
            }
          </li>
        }
      </ul>
      <div class="pr__sum">
        <span>{{ items().length }} procedure{{ items().length === 1 ? '' : 's' }}</span>
        <b class="nd-num">{{ total() | inr }}</b>
      </div>
      <p class="pr__muted">{{ billedNote() }}</p>
    } @else if (readonly()) {
      <p class="pr__muted">No procedures.</p>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 12px; }
    .pr__add { position: relative; }
    .pr__sico { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); }
    .pr__q { width: 100%; padding-left: 36px; min-height: 44px; font-size: 14.5px; }
    .pr__tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
    .pr__tile { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 14px; border-radius: 12px; border: 1px dashed var(--nd-line);
      background: var(--nd-card-bg); color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
    .pr__tile:hover { border-color: var(--nd-sel-border); }
    .pr__tile.on { border-style: solid; border-color: var(--nd-sel-border); background: var(--nd-in-tint); }
    .pr__tile:focus-visible, .pr__step:focus-visible, .pr__x:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .pr__tico { flex: none; width: 18px; display: inline-flex; color: var(--violet-text, #6d28d9); }
    .pr__tn { flex: 1; min-width: 0; font-size: 14px; }
    .pr__tp { flex: none; font-size: 13px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pr__more { align-self: flex-start; }
    .pr__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .pr__row { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--nd-line); background: var(--nd-card-bg); }
    .pr__top { display: flex; align-items: center; gap: 8px; }
    .pr__name { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 600; color: var(--text-primary); }
    .pr__name em { font-style: normal; font-weight: 400; font-size: 12px; color: var(--text-tertiary); margin-left: 8px; }
    .pr__x { width: 36px; height: 36px; flex: none; border: 0; border-radius: 9px; background: transparent; color: var(--text-tertiary); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .pr__x:hover { color: var(--red-text, #dc2626); background: var(--nd-chip-bg); }
    .pr__grid { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: flex-start; }
    .pr__cell { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .pr__cell--price { min-width: 140px; }
    .pr__lbl { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
    .pr__seg { flex-wrap: wrap; }
    .pr__qty { display: inline-flex; align-items: center; gap: 4px; }
    .pr__step { width: 44px; height: 44px; border-radius: 10px; border: 1px solid var(--nd-line); background: var(--nd-card-bg); color: var(--text-primary);
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .pr__step:disabled { opacity: .45; cursor: default; }
    .pr__n { min-width: 28px; text-align: center; font-size: 15px; font-weight: 600; }
    .pr__price { width: 140px; min-height: 44px; font-size: 16px; }
    .pr__fixed { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pr__fixed svg { color: var(--text-tertiary); }
    .pr__rule { font-size: 12px; color: var(--amber-text, #b45309); }
    .pr__note { width: 100%; min-height: 44px; font-size: 14px; }
    .pr__err { margin: 0; font-size: 12.5px; color: var(--red-text, #dc2626); }
    .pr__sum { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 2px 0; font-size: 13.5px; color: var(--text-secondary); }
    .pr__sum b { font-size: 16px; color: var(--text-primary); }
    .pr__muted { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text-tertiary); }
    @media (max-width: 760px) { .pr__q, .pr__note { font-size: 16px; } .pr__tiles { grid-template-columns: 1fr; } }
  `],
})
export class ConsultProceduresComponent {
  readonly options = input<ConsultProcedureOption[]>([]);
  readonly items = input<ConsultProcedureDraft[]>([]);
  readonly pricing = input<ProcedurePricing | null>(null);
  readonly readonly = input(false);
  /** How the visit is paid — only for the note under the total. */
  readonly payAfter = input(false);
  readonly itemsChange = output<ConsultProcedureDraft[]>();

  readonly sides = PROCEDURE_SIDES;
  readonly maxQty = MAX_PROCEDURE_QTY;
  readonly query = signal('');
  /** Without a search, the first few tiles (the list can be long on a phone). */
  readonly showAll = signal(false);
  readonly collapsedCount = 6;
  /** Inline refusals by row key (a refused price is never emitted). */
  readonly errs = signal<Record<string, string>>({});
  private readonly typed = signal<Record<string, string>>({});

  readonly canChange = computed(() => !this.readonly() && !!this.pricing()?.doctorCanChange);
  readonly total = computed(() => proceduresTotal(this.items()));
  readonly shownOptions = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.options();
    return q ? list.filter(o => `${o.name} ${o.code ?? ''}`.toLowerCase().includes(q))
      : this.showAll() ? list : list.slice(0, this.collapsedCount);
  });
  readonly billedNote = computed(() => this.items().every(p => p.status === 'billed')
    ? 'Billed to the front desk.'
    : this.payAfter()
      ? 'Added to the consultation bill on Complete — the front desk collects it.'
      : 'Billed to the front desk on Complete (the consultation is already paid).');

  countOf(serviceId: string): number { return this.items().filter(p => p.serviceId === serviceId).length; }

  add(o: ConsultProcedureOption): void {
    if (this.readonly()) return;
    const row: ConsultProcedureDraft = {
      key: 'n' + (++seq), id: null, serviceId: o.serviceId, name: o.name, code: o.code ?? null, qty: 1,
      rulePrice: o.price, price: o.price, side: null, note: null, status: 'draft',
    };
    this.itemsChange.emit([...this.items(), row]);
  }

  remove(key: string): void {
    this.clearErr(key);
    this.itemsChange.emit(this.items().filter(p => p.key !== key));
  }

  patch(key: string, p: Partial<ConsultProcedureDraft> & { side?: ProcedureSide | null }): void {
    if (this.readonly()) return;
    const next = this.items().map(x => {
      if (x.key !== key || x.status === 'billed') return x;
      const y = { ...x, ...p };
      y.qty = Math.min(MAX_PROCEDURE_QTY, Math.max(1, Math.round(y.qty)));
      return y;
    });
    this.itemsChange.emit(next);
  }

  priceText(p: ConsultProcedureDraft): string { return this.typed()[p.key] ?? String(p.price); }

  /** A typed price is emitted only when the rule allows it; else it shows the refusal. */
  onPrice(p: ConsultProcedureDraft, raw: string): void {
    this.typed.update(m => ({ ...m, [p.key]: raw }));
    const n = raw.trim() === '' ? p.rulePrice : parsePrice(raw);
    if (Number.isNaN(n)) { this.errs.update(m => ({ ...m, [p.key]: 'Type the amount in rupees, e.g. 1200.' })); return; }
    const bad = checkProcedurePrice(p.rulePrice, n, this.pricing());
    if (bad) { this.errs.update(m => ({ ...m, [p.key]: bad.message })); return; }
    this.clearErr(p.key);
    if (n !== p.price) this.patch(p.key, { price: n, ...(n === p.rulePrice ? { priceReason: null } : {}) });
  }

  /** On blur, a refused / blank entry snaps back to the saved price. */
  settlePrice(key: string): void {
    this.typed.update(m => { const n = { ...m }; delete n[key]; return n; });
    this.clearErr(key);
  }

  private clearErr(key: string): void {
    this.errs.update(m => { if (!m[key]) return m; const n = { ...m }; delete n[key]; return n; });
  }
}
