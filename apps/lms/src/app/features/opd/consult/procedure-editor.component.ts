import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import type { ConsultProcedureDraft, ConsultProcedureOption, ProcedurePricing, ProcedureWhen } from './consult.api';
import {
  MAX_PROCEDURE_QTY, PREFERRED_WITHIN, PROCEDURE_SIDES, type ProcedureSide, checkProcedurePrice, needsPriceReason, parsePrice, priceHint, priceRange, proceduresTotal,
} from './procedure-rules';

let seq = 0;

/**
 * Procedures in the consult (consult v6): an add bar scoped to the
 * department's procedures (OPD Master, each with its preset price), then a
 * list + detail. The detail chooses Do now / Book for later (only when the
 * server supports it — `laterEnabled`), the price — editable within the OPD
 * workflow setting "Doctors can change procedure prices" (its ± % cap shown
 * inline, a reason required for a change), locked with a lock icon when the
 * admin hasn't allowed changes — side, quantity and a note. For later: a
 * preferred window, the preparation note (printed on the slip) and "the
 * front desk books the date · paid on the procedure day". Pure
 * presentational: emits the new list.
 */
@Component({
  selector: 'pf-consult-procedures',
  standalone: true,
  imports: [CurrencyInrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!readonly()) {
      @if (options().length) {
        <div class="pr__bar">
          <label class="pr__in">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input #q type="text" class="pr__q" autocomplete="off" [value]="query()" (input)="onQuery(q.value)" (keydown)="onKey($event)" (focus)="focused.set(true)" (blur)="focused.set(false)"
                   placeholder="Add a procedure — endoscopy, nebulisation, dressing…" aria-label="Add a procedure" role="combobox"
                   [attr.aria-expanded]="listOpen()" aria-controls="pr-sug" />
            <kbd aria-hidden="true">Enter</kbd>
          </label>
          @if (listOpen()) {
            <div class="pr__sug" id="pr-sug" role="listbox" aria-label="Procedures you can add">
              @for (o of hits(); track o.serviceId; let i = $index) {
                <button type="button" role="option" class="pr__sg" [class.act]="i === active()" [attr.aria-selected]="i === active()" [attr.data-proc]="o.code || o.name"
                        (mousedown)="$event.preventDefault()" (mouseenter)="active.set(i)" (click)="add(o)">
                  <span class="pr__sgk">Procedure</span>
                  <span class="pr__sgn">{{ o.name }}@if (o.code) { <em>{{ o.code }}</em> }</span>
                  <span class="pr__sgp nd-num">Preset {{ o.price | inr }}</span>
                </button>
              } @empty { <p class="pr__muted pr__pad">No procedure matches “{{ query() }}”.</p> }
            </div>
          }
        </div>
      } @else {
        <p class="pr__muted">No procedures are set up for this department yet (OPD Master → services, category “Procedure”).</p>
      }
    }

    <div class="pr__md">
      <div class="pr__list" role="list" aria-label="Procedures">
        @for (p of items(); track p.key; let i = $index) {
          <button type="button" role="listitem" class="pr__row" [attr.aria-current]="p.key === sel()?.key" [attr.data-row]="p.serviceId" (click)="selKey.set(p.key)">
            <span class="pr__no nd-num">{{ i + 1 }}</span>
            <span class="pr__rt">
              <b>{{ p.name }}</b>
              <span class="pr__rm nd-num"><span class="pr__rp">{{ p.price * p.qty | inr }}</span> · {{ p.when === 'later' ? 'Book for later' : 'Do now' }}@if (needsReason(p)) { · <em>reason needed</em> }</span>
            </span>
          </button>
        } @empty {
          @if (readonly()) { <p class="pr__muted">No procedures.</p> }
        }
        @if (items().length) {
          <div class="pr__sum nd-num">
            <span>Today's bill</span><b>{{ total() | inr }}</b>
          </div>
        }
      </div>

      <div class="pr__detail">
        @if (sel(); as p) {
          @let locked = readonly() || p.status === 'billed';
          <div class="pr__top">
            <b class="pr__name">{{ p.name }}@if (p.code) { <em>{{ p.code }}</em> }</b>
            @if (laterEnabled() || p.when === 'later') {
              <span class="nd-seg pr__seg" role="radiogroup" aria-label="When">
                @for (w of whens; track w.id) {
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="(p.when ?? 'now') === w.id" [attr.data-when]="w.id"
                          [disabled]="locked" (click)="patch(p.key, { when: w.id })">{{ w.label }}</button>
                }
              </span>
            }
            @if (!locked) {
              <button type="button" class="pr__x" (click)="remove(p.key)" [attr.aria-label]="'Remove ' + p.name">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            }
          </div>

          <div class="pr__price">
            <span class="pr__lbl">Price{{ p.qty > 1 ? ' (each)' : '' }}</span>
            <div class="pr__pricerow">
              @if (canChange() && !locked) {
                <label class="pr__amt" [class.pr__amt--chg]="p.price !== p.rulePrice" [class.pr__amt--err]="!!errs()[p.key]">
                  <span aria-hidden="true">₹</span>
                  <input class="nd-num pr__pin" type="text" inputmode="decimal" [value]="priceText(p)" (input)="onPrice(p, $any($event.target).value)" (blur)="settlePrice(p.key)"
                         [attr.aria-label]="'Price for ' + p.name" [attr.aria-invalid]="!!errs()[p.key]" />
                </label>
              } @else {
                <span class="pr__amt pr__amt--locked nd-num" data-locked>
                  @if (!canChange() && !readonly()) {
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Locked price"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                  }
                  {{ p.price | inr }}
                </span>
              }
              <span class="pr__hint nd-num" [class.pr__hint--bad]="!!errs()[p.key]" data-hint>{{ errs()[p.key] || hint(p) }}</span>
            </div>
            @if (p.price !== p.rulePrice && p.priceSetByName && locked) { <span class="pr__muted">Set by {{ p.priceSetByName }}</span> }
          </div>
          @if (p.price !== p.rulePrice && canChange() && !locked) {
            <label class="pr__f">
              <span>Reason for the change <em>the front desk sees it</em></span>
              <input class="nd-input pr__note" type="text" [class.nd-input--error]="needsReason(p) && showReasonErr()" [value]="p.priceReason ?? ''"
                     (input)="patch(p.key, { priceReason: $any($event.target).value })" placeholder="e.g. Both sides, extended procedure"
                     aria-label="Reason for the price change" maxlength="300" data-reason />
              @if (needsReason(p) && showReasonErr()) { <span class="pr__err" role="alert">Give a reason for the price change.</span> }
            </label>
          }

          <div class="pr__grid">
            <div class="pr__cell">
              <span class="pr__lbl">Side</span>
              <span class="nd-seg pr__seg" role="radiogroup" [attr.aria-label]="'Side for ' + p.name">
                @for (s of sides; track s.label) {
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="(p.side ?? null) === s.value"
                          [disabled]="locked" (click)="patch(p.key, { side: s.value })">{{ s.label }}</button>
                }
              </span>
            </div>
            <div class="pr__cell">
              <span class="pr__lbl">Qty</span>
              <span class="pr__qty">
                <button type="button" class="pr__step" [disabled]="locked || p.qty <= 1" (click)="patch(p.key, { qty: p.qty - 1 })" [attr.aria-label]="'Fewer ' + p.name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>
                </button>
                <span class="pr__n nd-num" aria-live="polite">{{ p.qty }}</span>
                <button type="button" class="pr__step" [disabled]="locked || p.qty >= maxQty" (click)="patch(p.key, { qty: p.qty + 1 })" [attr.aria-label]="'More ' + p.name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                </button>
              </span>
            </div>
          </div>

          @if (p.when === 'later') {
            <div class="pr__cell">
              <span class="pr__lbl">Preferred</span>
              <span class="nd-seg pr__seg" role="radiogroup" aria-label="Preferred within">
                @for (w of preferred; track w) {
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="p.preferredWithin === w" [disabled]="locked" (click)="patch(p.key, { preferredWithin: w })">{{ w }}</button>
                }
              </span>
            </div>
            <label class="pr__f">
              <span>Preparation for the patient <em>printed on the slip</em></span>
              <input class="nd-input pr__note" type="text" [value]="p.prepNote ?? ''" [disabled]="locked" (input)="patch(p.key, { prepNote: $any($event.target).value })"
                     placeholder="e.g. Nothing to eat or drink for 8 hours before" aria-label="Preparation note" maxlength="300" data-prep />
            </label>
            <span class="pr__badge pr__badge--later">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              Front desk books the date · paid on the procedure day
            </span>
          } @else {
            <span class="pr__badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>
              {{ p.status === 'billed' ? 'Billed to the front desk' : payAfter() ? 'Added to the consultation bill on Complete — the front desk collects it' : 'Billed to the front desk when you complete the consult' }}
            </span>
          }

          @if (!locked) {
            <label class="pr__f">
              <span>Note</span>
              <input class="nd-input pr__note" type="text" [value]="p.note ?? ''" (change)="patch(p.key, { note: $any($event.target).value })"
                     placeholder="Optional — e.g. under LA, polyp seen" [attr.aria-label]="'Note for ' + p.name" maxlength="500" />
            </label>
          } @else if (p.note) { <p class="pr__muted">{{ p.note }}</p> }
        } @else {
          <div class="pr__empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z"/></svg>
            <b>{{ readonly() ? 'No procedures' : 'No procedure yet' }}</b>
            @if (!readonly()) { <span>Add one from the bar above. Preset prices come from the OPD master.</span> }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
    .pr__bar { position: relative; }
    .pr__in { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 12px; border-radius: 12px; color: var(--text-tertiary);
      border: 1px solid color-mix(in srgb, var(--color-primary, #7c3aed) 45%, var(--nd-line)); background: var(--nd-in-tint); }
    .pr__in:focus-within { border-color: var(--color-violet-600, #7c3aed); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent); }
    .pr__q { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 14.5px; }
    .pr__q::placeholder { color: var(--text-tertiary); }
    .pr__in kbd { font: inherit; font-size: 11px; color: var(--text-tertiary); border: 1px solid var(--nd-line); border-radius: 6px; padding: 1px 6px; }
    .pr__sug { position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 20; display: grid; gap: 2px; padding: 6px; max-height: 320px; overflow-y: auto;
      border-radius: 12px; background: var(--nd-card-bg); border: 1px solid var(--nd-line); box-shadow: 0 16px 36px rgba(15, 23, 42, 0.18); }
    :host-context(html.dark) .pr__sug { box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5); }
    .pr__sg { display: grid; grid-template-columns: 86px minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 44px; padding: 8px 10px; border: 0; border-radius: 9px;
      background: transparent; color: var(--text-primary); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
    .pr__sg.act { background: var(--nd-chip-bg); }
    .pr__sgk { justify-self: start; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 7px; border-radius: 6px;
      color: var(--blue-text, #1d4ed8); background: color-mix(in srgb, #60a5fa 14%, transparent); }
    .pr__sgn em, .pr__name em { font-style: normal; font-weight: 400; font-size: 12px; color: var(--text-tertiary); margin-left: 8px; }
    .pr__sgp { font-size: 12.5px; color: var(--text-tertiary); }
    .pr__pad { padding: 8px 10px; }

    .pr__md { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); gap: 20px; }
    .pr__list { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto; }
    .pr__row { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 10px; align-items: start; width: 100%; padding: 10px 12px; border-radius: 10px;
      border: 1px solid var(--nd-line); background: var(--nd-card-bg); color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
    .pr__row:hover { border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 40%, var(--nd-line)); }
    .pr__row[aria-current='true'] { background: var(--nd-in-tint); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 60%, transparent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent); }
    .pr__row:focus-visible, .pr__step:focus-visible, .pr__x:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pr__no { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: var(--violet-text, #6d28d9);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .pr__rt { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pr__rt b { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
    .pr__rm { font-size: 12.5px; color: var(--text-tertiary); }
    .pr__rm em { font-style: normal; font-weight: 600; color: var(--amber-text, #b45309); }
    .pr__rp { font-weight: 600; color: var(--text-primary); }
    .pr__sum { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 2px 0; font-size: 13px; color: var(--text-secondary); }
    .pr__sum b { font-size: 15px; color: var(--text-primary); }

    .pr__detail { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; align-items: stretch; padding: 18px; border-radius: 12px;
      border: 1px solid var(--nd-line); background: color-mix(in srgb, var(--color-primary, #7c3aed) 2%, var(--nd-card-bg)); }
    .pr__top { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .pr__name { flex: 1; min-width: 160px; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pr__x { width: 36px; height: 36px; flex: none; border: 0; border-radius: 9px; background: transparent; color: var(--text-tertiary); display: grid; place-items: center; cursor: pointer; }
    .pr__x:hover { color: var(--red-text, #dc2626); background: var(--nd-chip-bg); }
    .pr__seg { flex-wrap: wrap; }
    .pr__price { display: flex; flex-direction: column; gap: 6px; }
    .pr__pricerow { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
    .pr__lbl { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
    .pr__amt { display: inline-flex; align-items: center; gap: 4px; height: 42px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--nd-line);
      background: var(--nd-in-tint); font-size: 15px; font-weight: 700; color: var(--text-primary); }
    .pr__amt:focus-within { border-color: var(--color-violet-600, #7c3aed); }
    .pr__amt--chg { border-color: color-mix(in srgb, #f59e0b 45%, transparent); background: color-mix(in srgb, #f59e0b 10%, var(--nd-card-bg)); }
    .pr__amt--err { border-color: var(--red-text, #dc2626); }
    .pr__amt--locked { background: transparent; color: var(--text-secondary); gap: 8px; }
    .pr__pin { width: 96px; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; }
    .pr__hint { font-size: 12.5px; color: var(--text-tertiary); }
    .pr__hint--bad { color: var(--red-text, #dc2626); font-weight: 600; }
    .pr__f { display: flex; flex-direction: column; gap: 6px; }
    .pr__f > span { font-size: 12.5px; font-weight: 500; color: var(--text-secondary); }
    .pr__f em { font-style: normal; font-weight: 400; color: var(--text-tertiary); margin-left: 6px; }
    .pr__grid { display: flex; flex-wrap: wrap; gap: 12px 24px; }
    .pr__cell { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .pr__qty { display: inline-flex; align-items: center; gap: 4px; }
    .pr__step { width: 44px; height: 44px; border-radius: 10px; border: 1px solid var(--nd-line); background: var(--nd-card-bg); color: var(--text-primary);
      display: grid; place-items: center; cursor: pointer; }
    .pr__step:disabled { opacity: .45; cursor: default; }
    .pr__n { min-width: 28px; text-align: center; font-size: 15px; font-weight: 600; }
    .pr__note { width: 100%; min-height: 44px; font-size: 14px; }
    .pr__err { font-size: 12.5px; color: var(--red-text, #dc2626); }
    .pr__badge { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 4px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 600; color: var(--green-text, #047857); background: color-mix(in srgb, #34d399 14%, transparent); }
    .pr__badge--later { color: var(--blue-text, #1d4ed8); background: color-mix(in srgb, #60a5fa 14%, transparent); }
    .pr__empty { flex: 1; display: grid; place-items: center; align-content: center; gap: 8px; padding: 40px 20px; text-align: center; color: var(--text-tertiary); }
    .pr__empty b { color: var(--text-secondary); }
    .pr__muted { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text-tertiary); }
    @media (max-width: 760px) {
      .pr__md { grid-template-columns: 1fr; }
      .pr__list { flex-direction: row; overflow-x: auto; overflow-y: hidden; }
      .pr__row { min-width: 210px; }
      .pr__sum { display: none; }
      .pr__q, .pr__note { font-size: 16px; }
      .pr__detail { overflow: visible; padding: 14px; }
      .pr__sg { grid-template-columns: minmax(0, 1fr) auto; }
      .pr__sgk { grid-column: 1 / -1; }
    }
  `],
})
export class ConsultProceduresComponent {
  readonly options = input<ConsultProcedureOption[]>([]);
  readonly items = input<ConsultProcedureDraft[]>([]);
  readonly pricing = input<ProcedurePricing | null>(null);
  readonly readonly = input(false);
  /** How the visit is paid — only for the "now" badge. */
  readonly payAfter = input(false);
  /** Server supports "Book for later" (workspace features.procedureLater). */
  readonly laterEnabled = input(false);
  /** The host tried to Complete with a changed price and no reason. */
  readonly showReasonErr = input(false);
  readonly itemsChange = output<ConsultProcedureDraft[]>();

  readonly sides = PROCEDURE_SIDES;
  readonly maxQty = MAX_PROCEDURE_QTY;
  readonly preferred = PREFERRED_WITHIN;
  readonly whens: { id: ProcedureWhen; label: string }[] = [{ id: 'now', label: 'Do now' }, { id: 'later', label: 'Book for later' }];
  readonly query = signal('');
  readonly focused = signal(false);
  readonly active = signal(0);
  readonly selKey = signal<string | null>(null);
  /** Inline refusals by row key (a refused price is never emitted). */
  readonly errs = signal<Record<string, string>>({});
  private readonly typed = signal<Record<string, string>>({});
  private readonly qEl = viewChild<ElementRef<HTMLInputElement>>('q');

  readonly canChange = computed(() => !this.readonly() && !!this.pricing()?.doctorCanChange);
  readonly total = computed(() => proceduresTotal(this.items()));
  readonly hits = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.options();
    return (q ? list.filter(o => `${o.name} ${o.code ?? ''}`.toLowerCase().includes(q)) : list).slice(0, 8);
  });
  readonly listOpen = computed(() => !!this.query().trim() || (this.focused() && !this.items().length));
  /** The selected row: the picked one, else the last added. */
  readonly sel = computed<ConsultProcedureDraft | null>(() => {
    const items = this.items();
    return items.find(p => p.key === this.selKey()) ?? items[items.length - 1] ?? null;
  });

  hint(p: ConsultProcedureDraft) { return priceHint(p.rulePrice, p.price, this.pricing()); }
  needsReason(p: ConsultProcedureDraft) { return this.canChange() && needsPriceReason(p); }
  range(p: ConsultProcedureDraft) { return priceRange(p.rulePrice, this.pricing()); }

  onQuery(v: string) { this.query.set(v); this.active.set(0); }
  onKey(e: KeyboardEvent) {
    const n = this.hits().length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); this.active.set((this.active() + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); this.active.set((this.active() - 1 + n) % n); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = this.hits()[this.active()]; if (o && (this.query().trim() || n)) this.add(o); }
    else if (e.key === 'Escape') { this.query.set(''); this.qEl()?.nativeElement.blur(); }
  }

  add(o: ConsultProcedureOption): void {
    if (this.readonly()) return;
    const row: ConsultProcedureDraft = {
      key: 'n' + (++seq), id: null, serviceId: o.serviceId, name: o.name, code: o.code ?? null, qty: 1,
      rulePrice: o.price, price: o.price, side: null, note: null, status: 'draft', when: 'now', preferredWithin: null, prepNote: null,
    };
    this.selKey.set(row.key);
    this.query.set('');
    this.itemsChange.emit([...this.items(), row]);
  }

  remove(key: string): void {
    this.clearErr(key);
    if (this.selKey() === key) this.selKey.set(null);
    this.itemsChange.emit(this.items().filter(p => p.key !== key));
  }

  patch(key: string, p: Partial<ConsultProcedureDraft> & { side?: ProcedureSide | null }): void {
    if (this.readonly()) return;
    const next = this.items().map(x => {
      if (x.key !== key || x.status === 'billed') return x;
      const y = { ...x, ...p };
      y.qty = Math.min(MAX_PROCEDURE_QTY, Math.max(1, Math.round(y.qty)));
      if (p.when === 'later' && !y.preferredWithin) y.preferredWithin = PREFERRED_WITHIN[1];
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
