import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ExpenseService } from '../../../core/services/expense.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ApiError } from '../../../shared/models/api-response.model';
import {
  EXPENSE_MODES, ExpenseAttachment, ExpenseCategory, ExpenseEntry, ExpenseEntryInput, ExpenseKind, ExpenseMode,
  validExpenseAmount,
} from '../../../shared/models/expense.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { NdDateComponent } from '../../../shared/components/nd-date/nd-date.component';
import { ModalPortalDirective } from '../../../shared/directives/modal-portal.directive';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { addDays } from '../../../shared/utils/lab-clock';

/** A bill picked on this device, not uploaded yet (shown as a thumbnail). */
interface PendingBill { id: number; file: File; preview: string | null; }

const MAX_BILL_BYTES = 15 * 1024 * 1024;
const BILL_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

/**
 * Add / edit one expense-book entry — the phone-first quick add. Kit modal on
 * web / tablet, a bottom sheet on phones (above the navbar). Amount first
 * (decimal keypad), then what it was for, category (pf-select, searchable;
 * an admin can create a new category inline), payment mode (kit segmented),
 * date (kit date, IST, never a future or closed day), paid to, notes and the
 * bills: "Take photo" opens the rear camera on phones / tablets, "Attach"
 * takes several images or PDFs. Bills upload right after the entry saves.
 * ONE primary (Save); Delete is the danger action in edit mode (confirmed
 * through DialogService).
 */
@Component({
  selector: 'pf-expense-entry-dialog',
  standalone: true,
  imports: [SelectComponent, NdDateComponent, ModalPortalDirective, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-xd" role="dialog" aria-modal="true" aria-labelledby="pf-xd-title" pfModalPortal>
      <div class="pf-xd__backdrop" (click)="close()"></div>
      <form class="pf-xd__card" (submit)="$event.preventDefault(); save()" novalidate>
        <span class="nd-sheet__handle pf-xd__handle" aria-hidden="true"></span>
        <header class="pf-xd__head">
          <span class="nd-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5Z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
          </span>
          <h2 id="pf-xd-title" class="nd-card__label pf-xd__title">{{ entry() ? 'Edit entry' : (kind() === 'cash_in' ? 'Add cash in' : 'Add expense') }}</h2>
          <button type="button" class="nd-btn nd-btn--icon pf-xd__close" (click)="close()" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div class="pf-xd__body">
          <div class="nd-field">
            <span class="nd-field__lbl" id="pf-xd-kind-lbl">Type</span>
            <span class="nd-seg pf-xd__seg" role="radiogroup" aria-labelledby="pf-xd-kind-lbl">
              <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="kind() === 'expense'" (click)="kind.set('expense')">Expense</button>
              <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="kind() === 'cash_in'" (click)="kind.set('cash_in')">Cash in</button>
            </span>
            @if (kind() === 'cash_in') {
              <p class="nd-field__hint">Money put INTO the expense account — a top-up or float. It raises the day's closing balance.</p>
            }
          </div>

          <div class="pf-xd__row">
            <div class="nd-field">
              <label class="nd-field__lbl" for="pf-xd-amount">Amount (₹)</label>
              <input id="pf-xd-amount" class="nd-input nd-num pf-xd__amount" type="text" inputmode="decimal" autocomplete="off"
                     placeholder="0.00" [class.nd-input--error]="fieldErr() === 'amount'"
                     [value]="amountText()" (input)="amountText.set($any($event.target).value)" />
            </div>
            <div class="nd-field">
              <label class="nd-field__lbl" for="pf-xd-date">Date</label>
              <pf-nd-date label="Date" inputId="pf-xd-date" [value]="date()" [min]="minDate()" [max]="today()"
                          (valueChange)="date.set($event)"></pf-nd-date>
            </div>
          </div>

          <div class="nd-field">
            <label class="nd-field__lbl" for="pf-xd-desc">{{ kind() === 'cash_in' ? 'Details' : 'Item / what it was for' }}</label>
            <input id="pf-xd-desc" class="nd-input" type="text" maxlength="300" autocomplete="off"
                   [placeholder]="kind() === 'cash_in' ? 'e.g. Float from owner' : 'e.g. Printer toner'"
                   [class.nd-input--error]="fieldErr() === 'description'"
                   [value]="description()" (input)="description.set($any($event.target).value)" />
          </div>

          <div class="nd-field">
            <span class="nd-field__lbl">Bills &amp; receipts <span class="pf-xd__opt">photo or PDF</span></span>
            @if (bills().length || pending().length) {
              <ul class="pf-xd__bills" aria-label="Bills">
                @for (b of bills(); track b.id) {
                  <li class="pf-xd__bill">
                    <a class="pf-xd__thumb" [href]="b.url" target="_blank" rel="noopener" [attr.aria-label]="'Open ' + b.fileName">
                      @if (isImage(b.contentType)) { <img [src]="b.url" alt="" loading="lazy" /> }
                      @else { <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg> }
                    </a>
                    <span class="pf-xd__billname">{{ b.fileName }}</span>
                    <button type="button" class="nd-btn nd-btn--icon pf-xd__billx" (click)="removeStored(b)" [attr.aria-label]="'Remove ' + b.fileName">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  </li>
                }
                @for (p of pending(); track p.id) {
                  <li class="pf-xd__bill pf-xd__bill--new">
                    <span class="pf-xd__thumb">
                      @if (p.preview) { <img [src]="p.preview" alt="" /> }
                      @else { <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg> }
                    </span>
                    <span class="pf-xd__billname">{{ p.file.name }}</span>
                    <button type="button" class="nd-btn nd-btn--icon pf-xd__billx" (click)="dropPending(p)" [attr.aria-label]="'Remove ' + p.file.name">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  </li>
                }
              </ul>
            }
            <div class="pf-xd__pick">
              <label class="nd-btn nd-btn--secondary pf-xd__pickbtn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Take photo
                <input class="pf-xd__file" type="file" accept="image/*" capture="environment" (change)="onFiles($event)" />
              </label>
              <label class="nd-btn nd-btn--secondary pf-xd__pickbtn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>
                Attach files
                <input class="pf-xd__file" type="file" accept="image/*,application/pdf" multiple (change)="onFiles($event)" />
              </label>
            </div>
          </div>

          @if (kind() === 'expense') {
            <div class="nd-field">
              <label class="nd-field__lbl" for="pf-xd-cat">Category</label>
              <pf-select id="pf-xd-cat" [options]="categoryOptions()" [value]="categoryId()" placeholder="Pick a category"
                         [searchable]="true" [allowCreate]="isAdmin()" createVerb="Add category"
                         createHint="New category for the whole lab"
                         (valueChange)="pickCategory($event)"></pf-select>
            </div>
          }

          <div class="nd-field">
            <span class="nd-field__lbl" id="pf-xd-mode-lbl">Payment mode</span>
            <span class="nd-seg pf-xd__seg" role="radiogroup" aria-labelledby="pf-xd-mode-lbl">
              @for (m of modes; track m.value) {
                <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="mode() === m.value" (click)="mode.set(m.value)">{{ m.value === 'bank' ? 'Bank' : m.label }}</button>
              }
            </span>
          </div>

          <div class="nd-field">
            <label class="nd-field__lbl" for="pf-xd-to">{{ kind() === 'cash_in' ? 'Received from' : 'Paid to / vendor' }} <span class="pf-xd__opt">optional</span></label>
            <input id="pf-xd-to" class="nd-input" type="text" maxlength="160" autocomplete="off"
                   [value]="paidTo()" (input)="paidTo.set($any($event.target).value)" />
          </div>

          <div class="nd-field">
            <label class="nd-field__lbl" for="pf-xd-notes">Notes <span class="pf-xd__opt">optional</span></label>
            <textarea id="pf-xd-notes" class="nd-input" rows="2" maxlength="1000"
                      [value]="notes()" (input)="notes.set($any($event.target).value)"></textarea>
          </div>

          @if (error()) { <p class="pf-xd__err" role="alert">{{ error() }}</p> }
        </div>

        <footer class="pf-xd__foot">
          @if (entry()) {
            <button type="button" class="nd-btn nd-btn--danger" [disabled]="saving() || deleting()" [pfBusy]="deleting()" pfBusyLabel="Deleting…" (click)="remove()">Delete</button>
          } @else {
            <button type="button" class="nd-btn nd-btn--secondary" [disabled]="saving()" (click)="close()">Cancel</button>
          }
          <button type="submit" class="nd-btn nd-btn--primary" [disabled]="!canSave() || saving() || deleting()" [pfBusy]="saving()" [pfBusyLabel]="savingLabel()">
            {{ saving() ? savingLabel() : 'Save' }}
          </button>
        </footer>
      </form>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .pf-xd { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .pf-xd__backdrop { position: absolute; inset: 0; background: rgba(5, 5, 15, 0.55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    .pf-xd__card {
      position: relative; width: 100%; max-width: 36rem; max-height: calc(100dvh - 32px);
      display: flex; flex-direction: column; margin: 0; padding: 0;
      border-radius: var(--nd-radius-card, 18px); background: var(--nd-card-bg, var(--bg-card-solid));
      border: 1px solid var(--nd-line, var(--glass-border)); box-shadow: 0 30px 70px rgba(0, 0, 0, 0.45); overflow: hidden;
    }
    .pf-xd__handle { display: none; }
    .pf-xd__head { display: flex; align-items: center; gap: 12px; padding: 14px 16px 12px; border-bottom: 1px solid var(--nd-line); }
    .pf-xd__title { margin: 0; flex: 1 1 auto; }
    .pf-xd__close { flex: none; }
    .pf-xd__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
    .pf-xd__row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
    .pf-xd__amount { font-size: 18px; font-weight: 600; }
    .pf-xd__seg { flex-wrap: wrap; }
    .pf-xd__opt { font-weight: 400; color: var(--text-tertiary); }
    .pf-xd__err { margin: 0; font-size: 12.5px; color: var(--red-text, #dc2626); }
    .pf-xd__bills { list-style: none; margin: 0 0 8px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
    .pf-xd__bill { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pf-xd__thumb {
      display: flex; align-items: center; justify-content: center; aspect-ratio: 1; border-radius: 10px; overflow: hidden;
      background: var(--glass-bg); border: 1px solid var(--nd-line); color: var(--text-tertiary);
    }
    .pf-xd__thumb img { width: 100%; height: 100%; object-fit: cover; }
    .pf-xd__billname { font-size: 11.5px; color: var(--text-secondary); overflow-wrap: anywhere; line-height: 1.3; }
    .pf-xd__billx { position: absolute; top: 4px; right: 4px; width: 28px; height: 28px; background: var(--nd-card-bg, var(--bg-card-solid)); }
    .pf-xd__pick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .pf-xd__pickbtn { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; }
    .pf-xd__file { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
    .pf-xd__pickbtn:focus-within { outline: 2px solid var(--nd-focus, #7c3aed); outline-offset: 2px; }
    .pf-xd__foot { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px 16px 16px; border-top: 1px solid var(--nd-line); }
    @media (pointer: coarse) { .pf-xd__billx { width: 44px; height: 44px; top: 0; right: 0; } }
    @media (max-width: 640px) {
      .pf-xd { align-items: flex-end; padding: 0; bottom: var(--nd-nav-h, 0px); }
      .pf-xd__card { max-width: none; border-radius: 18px 18px 0 0; max-height: calc(100dvh - var(--nd-nav-h, 0px) - env(safe-area-inset-top, 0px) - 12px); padding-bottom: env(safe-area-inset-bottom, 0px); }
      .pf-xd__handle { display: block; width: 40px; height: 4px; margin: 8px auto 0; border-radius: 999px; background: var(--nd-line); }
      .pf-xd__body .nd-input { font-size: 16px; min-height: 44px; }
      .pf-xd__foot .nd-btn, .pf-xd__pickbtn { min-height: 44px; }
    }
  `],
})
export class ExpenseEntryDialogComponent implements OnDestroy {
  private readonly svc = inject(ExpenseService);
  private readonly toasts = inject(ToastService);
  private readonly dialogs = inject(DialogService);

  /** The entry being edited; null = a new one. */
  readonly entry = input<ExpenseEntry | null>(null);
  readonly categories = input<ExpenseCategory[]>([]);
  readonly today = input.required<string>();
  /** Latest closed day (yyyy-MM-dd) — the date can't be on or before it. */
  readonly closedThrough = input<string | null>(null);
  readonly isAdmin = input(false);
  readonly initialKind = input<ExpenseKind>('expense');
  readonly initialDate = input<string | null>(null);
  /** Bills already picked before the dialog opened (the phone bar's
   *  "Snap bill" — the camera first, then the form). New entries only. */
  readonly initialFiles = input<File[]>([]);

  readonly closed = output<void>();
  /** Something changed on the server (saved / deleted) — the host reloads. */
  readonly changed = output<void>();
  /** A category was created inline (the host adds it to its list). */
  readonly categoryCreated = output<ExpenseCategory>();

  readonly modes = EXPENSE_MODES;

  readonly kind = signal<ExpenseKind>('expense');
  readonly amountText = signal('');
  readonly date = signal<string | null>(null);
  readonly description = signal('');
  readonly categoryId = signal<string>('');
  readonly mode = signal<ExpenseMode>('cash');
  readonly paidTo = signal('');
  readonly notes = signal('');
  readonly bills = signal<ExpenseAttachment[]>([]);
  readonly pending = signal<PendingBill[]>([]);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly uploadStep = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly fieldErr = signal<string | null>(null);
  private readonly extraCats = signal<ExpenseCategory[]>([]);
  private seq = 0;
  private inited = false;

  readonly minDate = computed(() => { const c = this.closedThrough(); return c ? addDays(c, 1) : null; });
  readonly amount = computed<number | null>(() => {
    const t = this.amountText().replace(/[,₹\s]/g, '');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  });
  readonly categoryOptions = computed<PfSelectOption<string>[]>(() => {
    const current = this.entry()?.categoryId;
    return [...this.categories(), ...this.extraCats()]
      .filter(c => c.isActive || c.id === current)
      .map(c => ({ value: c.id, label: c.name }));
  });
  readonly canSave = computed(() =>
    validExpenseAmount(this.amount()) && this.description().trim().length > 0 && !!this.date()
    && (this.kind() === 'cash_in' || !!this.categoryId()));
  readonly savingLabel = computed(() => this.uploadStep() ?? 'Saving…');

  constructor() {
    queueMicrotask(() => this.init());
  }

  /** Seed the form from the entry (edit) or the defaults (new). */
  init() {
    if (this.inited) return;
    this.inited = true;
    const e = this.entry();
    if (e) {
      this.kind.set(e.kind);
      this.amountText.set(String(e.amount));
      this.date.set(e.date);
      this.description.set(e.description);
      this.categoryId.set(e.categoryId ?? '');
      this.mode.set(e.paymentMode);
      this.paidTo.set(e.paidTo ?? '');
      this.notes.set(e.notes ?? '');
      this.bills.set([...e.attachments]);
    } else {
      this.kind.set(this.initialKind());
      this.date.set(this.initialDate() ?? this.today());
      if (this.initialFiles().length) this.addFiles(this.initialFiles());
    }
  }

  ngOnDestroy() {
    for (const p of this.pending()) if (p.preview) URL.revokeObjectURL(p.preview);
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (!this.saving() && !this.deleting()) this.close(); }

  close() { this.closed.emit(); }

  isImage(type: string) { return (type || '').startsWith('image/'); }

  async pickCategory(value: string) {
    const known = this.categoryOptions().some(o => o.value === value);
    if (known || !value) { this.categoryId.set(value); return; }
    // allowCreate: the typed text comes back as the value — create it (admin).
    try {
      const cat = await firstValueFrom(this.svc.createCategory(value.trim()));
      this.extraCats.update(l => [...l, cat]);
      this.categoryCreated.emit(cat);
      this.categoryId.set(cat.id);
      this.toasts.success(`Category "${cat.name}" added`);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    }
  }

  onFiles(ev: Event) {
    const inputEl = ev.target as HTMLInputElement;
    const files = Array.from(inputEl.files ?? []);
    inputEl.value = '';
    this.addFiles(files);
  }

  /** Queue bills (photos / PDFs) to upload after the entry saves. */
  addFiles(files: readonly File[]) {
    const next: PendingBill[] = [];
    for (const f of files) {
      if (f.size > MAX_BILL_BYTES) { this.toasts.error(`${f.name} is over 15 MB`); continue; }
      if (f.type && !BILL_TYPES.includes(f.type.toLowerCase())) { this.toasts.error(`${f.name}: photos or PDFs only`); continue; }
      let preview: string | null = null;
      if ((f.type || '').startsWith('image/') && f.type !== 'image/heic') {
        try { preview = URL.createObjectURL(f); } catch { preview = null; }
      }
      next.push({ id: ++this.seq, file: f, preview });
    }
    if (this.bills().length + this.pending().length + next.length > 10) {
      this.toasts.error('At most 10 bills per entry');
      next.forEach(p => p.preview && URL.revokeObjectURL(p.preview));
      return;
    }
    this.pending.update(l => [...l, ...next]);
  }

  dropPending(p: PendingBill) {
    if (p.preview) URL.revokeObjectURL(p.preview);
    this.pending.update(l => l.filter(x => x.id !== p.id));
  }

  async removeStored(b: ExpenseAttachment) {
    const e = this.entry();
    if (!e) return;
    const ok = await this.dialogs.confirm({ title: 'Remove this bill?', message: b.fileName, confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    try {
      await firstValueFrom(this.svc.removeAttachment(e.id, b.id));
      this.bills.update(l => l.filter(x => x.id !== b.id));
      this.changed.emit();
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    }
  }

  private input(): ExpenseEntryInput {
    const kind = this.kind();
    return {
      date: this.date()!,
      kind,
      description: this.description().trim(),
      categoryId: kind === 'expense' ? this.categoryId() || null : null,
      amount: this.amount()!,
      paymentMode: this.mode(),
      paidTo: this.paidTo().trim() || null,
      notes: this.notes().trim() || null,
    };
  }

  async save() {
    if (!this.canSave() || this.saving()) {
      if (!validExpenseAmount(this.amount())) { this.fieldErr.set('amount'); this.error.set('Enter an amount above ₹0 (up to 2 decimals).'); }
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.fieldErr.set(null);
    const existing = this.entry();
    let saved: ExpenseEntry;
    try {
      saved = await firstValueFrom(existing ? this.svc.update(existing.id, this.input()) : this.svc.create(this.input()));
    } catch (e) {
      const err = ApiError.from(e);
      this.saving.set(false);
      this.error.set(err.message);
      this.fieldErr.set(err.field ?? null);
      return;
    }
    const files = this.pending().map(p => p.file);
    if (files.length) {
      this.uploadStep.set(`Uploading ${files.length} bill${files.length === 1 ? '' : 's'}…`);
      try {
        await this.svc.attach(saved.id, files);
      } catch (e) {
        // The entry is saved; say so and keep the dialog to retry the bills.
        this.saving.set(false);
        this.uploadStep.set(null);
        this.error.set(`Saved, but the bills didn't upload: ${ApiError.from(e).message}`);
        this.changed.emit();
        return;
      }
    }
    this.saving.set(false);
    this.uploadStep.set(null);
    this.toasts.success(existing ? 'Entry updated' : (saved.kind === 'cash_in' ? 'Cash in added' : 'Expense added'));
    this.changed.emit();
    this.close();
  }

  async remove() {
    const e = this.entry();
    if (!e || this.deleting()) return;
    const ok = await this.dialogs.confirm({
      title: 'Delete this entry?', message: `${e.description} — ₹${e.amount}. The audit log keeps a record.`,
      confirmLabel: 'Delete', tone: 'danger',
    });
    if (!ok) return;
    this.deleting.set(true);
    try {
      await firstValueFrom(this.svc.remove(e.id));
      this.toasts.success('Entry deleted');
      this.changed.emit();
      this.close();
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.deleting.set(false);
    }
  }
}
