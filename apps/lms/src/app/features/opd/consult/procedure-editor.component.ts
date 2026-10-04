import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { LowerCasePipe } from '@angular/common';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { type ConsultProcedureDraft, type ConsultProcedureOption, type ProcedurePricing, type ProcedureWhen, procedureSchemaOf } from './consult.api';
import { OpdFormRendererComponent } from '../admin/forms/renderer';
import { ProcedureSession, copyAllFromLast, keyReadings, lastHints, lastValue, sessionNumber } from './procedure-sessions';
import {
  MAX_PROCEDURE_QTY, PREFERRED_WITHIN, PROCEDURE_SIDES, type ProcedureSide, checkProcedurePrice, needsPriceReason, parsePrice, priceHint, proceduresTotal,
} from './procedure-rules';
import { PadAddComponent } from './pad-add.component';
import type { PadOption } from './pad';

let seq = 0;

/**
 * Procedures on the prescription pad (consult v11): one line per procedure —
 * name · Do now / Book for later (preferred window) · price ("preset ₹X" when
 * changed) · "N files · record". Tapping a line opens its editor in place:
 * Do now / Book for later (only when the server supports it —
 * `laterEnabled`), the price within the OPD workflow's policy (± % cap
 * inline, a reason required for a change, a lock when the admin hasn't
 * allowed changes), side, quantity and a note; for later the preferred
 * window and the preparation note; for Do now the procedure record and its
 * photos / video / report (Upload, Take photo — `recordEnabled`). The add
 * field under the lines is the pad's dashed entry with the department's
 * common procedures as one-tap chips. Pure presentational: emits the list
 * and the picked files (the host uploads them).
 */
@Component({
  selector: 'pf-consult-procedures',
  standalone: true,
  imports: [CurrencyInrPipe, LowerCasePipe, PadAddComponent, OpdFormRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pr__lines" role="list" aria-label="Procedures">
      @for (p of items(); track p.key) {
        @let locked = readonly() || p.status === 'billed';
        @if (openKey() !== p.key) {
          <button type="button" role="listitem" class="pr__line" [attr.data-row]="p.serviceId" (click)="openKey.set(p.key)" [attr.aria-label]="'Edit ' + p.name">
            <b>{{ p.name }}</b>
            @if (schemaOf(p)) {
              <span class="pr__sess nd-num">Session {{ sessionNo(p) }}</span>
              @for (r of readings(p); track $index) { <span class="pr__read nd-num">{{ r }}</span> }
            }
            <span class="pr__tag" [class.pr__tag--now]="p.when !== 'later'">{{ p.when === 'later' ? 'Book for later · ' + ((p.preferredWithin || 'Within 2 weeks') | lowercase) : 'Do now' }}</span>
            @if (fileCount(p) || p.record) { <span class="pr__att nd-num">@if (fileCount(p)) { {{ fileCount(p) }} file{{ fileCount(p) === 1 ? '' : 's' }} }@if (fileCount(p) && p.record) { · }@if (p.record) { record }</span> }
            @if (needsReason(p)) { <span class="pr__warn">reason needed</span> }
            <span class="pr__price nd-num">{{ p.price * p.qty | inr }}@if (p.price !== p.rulePrice) { <small>preset {{ p.rulePrice | inr }}</small> }</span>
          </button>
        } @else {
          <div class="pr__detail" role="listitem" [attr.data-row]="p.serviceId">
            <div class="pr__top">
              <b class="pr__name">{{ p.name }}@if (p.code) { <em>{{ p.code }}</em> }</b>
              @if (laterEnabled() || p.when === 'later') {
                <span class="pr__opts" role="radiogroup" aria-label="When">
                  @for (w of whens; track w.id) {
                    <button type="button" class="pr__o" role="radio" [attr.aria-checked]="(p.when ?? 'now') === w.id" [attr.data-when]="w.id"
                            [disabled]="locked" (click)="patch(p.key, { when: w.id })">{{ w.label }}</button>
                  }
                </span>
              }
              <button type="button" class="nd-btn nd-btn--secondary pr__done" (click)="openKey.set(null)">Done</button>
              @if (!locked) {
                <button type="button" class="pr__x" (click)="remove(p.key)" [attr.aria-label]="'Remove ' + p.name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              }
            </div>

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
              <span class="pr__qty">
                <button type="button" class="pr__step" [disabled]="locked || p.qty <= 1" (click)="patch(p.key, { qty: p.qty - 1 })" [attr.aria-label]="'Fewer ' + p.name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>
                </button>
                <span class="pr__n nd-num" aria-live="polite">× {{ p.qty }}</span>
                <button type="button" class="pr__step" [disabled]="locked || p.qty >= maxQty" (click)="patch(p.key, { qty: p.qty + 1 })" [attr.aria-label]="'More ' + p.name">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                </button>
              </span>
            </div>
            @if (p.price !== p.rulePrice && p.priceSetByName && locked) { <span class="pr__muted">Set by {{ p.priceSetByName }}</span> }
            @if (p.price !== p.rulePrice && canChange() && !locked) {
              <input class="nd-input pr__field" type="text" [class.nd-input--error]="needsReason(p) && showReasonErr()" [value]="p.priceReason ?? ''"
                     (input)="patch(p.key, { priceReason: $any($event.target).value })" placeholder="Reason for the price change — the front desk sees it"
                     aria-label="Reason for the price change" maxlength="300" data-reason />
              @if (needsReason(p) && showReasonErr()) { <span class="pr__err" role="alert">Give a reason for the price change.</span> }
            }

            <!-- The procedure's own form (e.g. a laser session), with the last session beside each field. -->
            @if (p.when !== 'later' && schemaOf(p); as sch) {
              <div class="pr__form" data-proc-form>
                <div class="pr__fh">
                  <b class="nd-num">Session {{ sessionNo(p) }}</b>
                  @if (formNameOf(p); as fn) { <span class="pr__fhs">{{ fn }}</span> }
                  <span class="pr__grow"></span>
                  @if (!locked) {
                    <button type="button" class="pr__link" [disabled]="!pastCount(p)" (click)="copyAll(p)" data-copy-last>Copy all from last session</button>
                  }
                  @if (pastCount(p)) {
                    <button type="button" class="pr__link" (click)="showSessions.emit(p.serviceId)" data-sessions>Sessions ({{ pastCount(p) }})</button>
                  }
                </div>
                <pf-opd-form-renderer [schema]="sch" [answers]="p.answers ?? {}" [mode]="locked ? 'readonly' : 'edit'" [layout]="phone() ? 'phone' : 'screen'" [compact]="true"
                                      [hints]="locked ? {} : hintsFor(p)" (hintPick)="onHint(p, $event)" (answersChange)="patch(p.key, { answers: $event })"></pf-opd-form-renderer>
              </div>
            }

            <span class="pr__opts" role="radiogroup" [attr.aria-label]="'Side for ' + p.name">
              @for (sd of sides; track sd.label) {
                <button type="button" class="pr__o" role="radio" [attr.aria-checked]="(p.side ?? null) === sd.value" [disabled]="locked" (click)="patch(p.key, { side: sd.value })">{{ sd.label === 'None' ? 'No side' : sd.label }}</button>
              }
            </span>

            @if (p.when === 'later') {
              <span class="pr__opts" role="radiogroup" aria-label="Preferred within">
                @for (w of preferred; track w) {
                  <button type="button" class="pr__o" role="radio" [attr.aria-checked]="p.preferredWithin === w" [disabled]="locked" (click)="patch(p.key, { preferredWithin: w })">{{ w }}</button>
                }
              </span>
              <input class="nd-input pr__field" type="text" [value]="p.prepNote ?? ''" [disabled]="locked" (input)="patch(p.key, { prepNote: $any($event.target).value })"
                     placeholder="Preparation for the patient (printed on the slip) — e.g. nothing to eat for 8 hours" aria-label="Preparation note" maxlength="300" data-prep />
              <span class="pr__badge pr__badge--later">Front desk books the date · paid on the procedure day</span>
            } @else {
              @if (recordEnabled()) {
                <textarea class="nd-input pr__rec" rows="3" [value]="p.record ?? ''" [disabled]="locked" (input)="patch(p.key, { record: $any($event.target).value })"
                          placeholder="Procedure record — findings, what was done, any complications" aria-label="Procedure record" data-record></textarea>
                @if (files()[p.key]?.length) {
                  <div class="pr__files">
                    @for (f of files()[p.key]; track f.id) {
                      <span class="pr__file" [title]="f.name">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">@if (f.kind === 'image') { <rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/> } @else { <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/> }</svg>
                        {{ f.name }}
                        @if (!locked && canRemoveFiles()) {
                          <button type="button" class="pr__fx" (click)="removeFile.emit({ key: p.key, id: f.id })" [attr.aria-label]="'Remove ' + f.name" data-rmfile>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                          </button>
                        }
                      </span>
                    }
                  </div>
                }
                @if (!locked) {
                  <div class="pr__up">
                    <button type="button" class="nd-btn nd-btn--secondary pr__upb" [disabled]="!p.id || uploading()[p.key]" (click)="upIn.click()" data-upload>
                      {{ uploading()[p.key] ? 'Uploading…' : 'Upload' }}
                    </button>
                    <button type="button" class="nd-btn nd-btn--secondary pr__upb" [disabled]="!p.id || uploading()[p.key]" (click)="camIn.click()" data-photo>Take photo</button>
                    <input #upIn class="pr__file-in" type="file" multiple accept="image/*,video/*,application/pdf" tabindex="-1" aria-hidden="true" (change)="pickFiles(p, upIn)" />
                    <input #camIn class="pr__file-in" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" (change)="pickFiles(p, camIn)" />
                    <span class="pr__muted">{{ p.id ? 'Photos, video or the device report attach to this visit.' : 'Saving… you can attach files in a moment.' }}</span>
                  </div>
                }
              }
              <span class="pr__badge">{{ p.status === 'billed' ? 'Billed to the front desk' : payAfter() ? 'Added to the consultation bill on Complete' : 'Billed to the front desk when you complete the consult' }}</span>
            }
            @if (!locked) {
              <input class="nd-input pr__field" type="text" [value]="p.note ?? ''" (change)="patch(p.key, { note: $any($event.target).value })"
                     placeholder="Note (optional)" [attr.aria-label]="'Note for ' + p.name" maxlength="500" />
            } @else if (p.note) { <p class="pr__muted">{{ p.note }}</p> }
          </div>
        }
      }
    </div>
    @if (!readonly()) {
      @if (options().length) {
        <pf-pad-add placeholder="Add a procedure…" [options]="optionList()" [quick]="quickList()" quickLabel="Common procedures" (pick)="addById($event.id)"></pf-pad-add>
      } @else {
        <span class="pr__none">No procedures are set up for this department yet · OPD Master → services → “Procedure”</span>
      }
    } @else if (!items().length) { <p class="pr__muted">No procedures.</p> }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 8px; }
    .pr__lines { display: grid; gap: 8px; }
    .pr__lines:empty { display: none; }
    .pr__line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-height: 42px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--nd-line);
      background: var(--nd-card-bg); color: var(--text-primary); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
    .pr__line:hover { border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 45%, var(--nd-line)); }
    .pr__line:focus-visible, .pr__o:focus-visible, .pr__step:focus-visible, .pr__x:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pr__line b { font-weight: 600; overflow-wrap: anywhere; }
    .pr__tag { padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--blue-text, #1d4ed8); background: color-mix(in srgb, #60a5fa 14%, transparent); }
    .pr__tag--now { color: var(--green-text, #047857); background: color-mix(in srgb, #34d399 14%, transparent); }
    .pr__att { font-size: 12px; color: var(--text-tertiary); }
    .pr__warn { font-size: 12px; font-weight: 600; color: var(--amber-text, #b45309); }
    .pr__price { margin-left: auto; font-weight: 700; }
    .pr__price small { margin-left: 8px; font-weight: 500; color: var(--text-tertiary); }
    .pr__detail { display: grid; gap: 12px; padding: 12px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--color-primary, #7c3aed) 45%, var(--nd-line));
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 3%, var(--nd-card-bg)); }
    .pr__top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .pr__name { flex: 1; min-width: 160px; font-size: 14.5px; font-weight: 600; }
    .pr__name em { margin-left: 8px; font-style: normal; font-weight: 400; font-size: 12px; color: var(--text-tertiary); }
    .pr__done { height: 32px; min-height: 32px; }
    .pr__x { width: 32px; height: 32px; border: 0; border-radius: 8px; background: none; color: var(--text-tertiary); display: grid; place-items: center; cursor: pointer; }
    .pr__x:hover { color: var(--red-text, #dc2626); background: var(--nd-chip-bg); }
    .pr__opts { display: flex; flex-wrap: wrap; gap: 8px; }
    .pr__o { height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--nd-line); background: none; font: inherit; font-size: 13px; font-weight: 500;
      color: var(--text-secondary); cursor: pointer; }
    .pr__o[aria-checked='true'] { color: var(--violet-text, #6d28d9); font-weight: 600; border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 55%, transparent);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .pr__o:disabled { cursor: default; }
    .pr__pricerow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
    .pr__amt { display: inline-flex; align-items: center; gap: 4px; height: 40px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--nd-line);
      background: var(--nd-in-tint); font-size: 15px; font-weight: 700; color: var(--text-primary); }
    .pr__amt:focus-within { border-color: var(--color-violet-600, #7c3aed); }
    .pr__amt--chg { border-color: color-mix(in srgb, #f59e0b 45%, transparent); background: color-mix(in srgb, #f59e0b 10%, var(--nd-card-bg)); }
    .pr__amt--err { border-color: var(--red-text, #dc2626); }
    .pr__amt--locked { background: transparent; color: var(--text-secondary); gap: 8px; }
    .pr__pin { width: 96px; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; }
    .pr__hint { font-size: 12.5px; color: var(--text-tertiary); }
    .pr__hint--bad { color: var(--red-text, #dc2626); font-weight: 600; }
    .pr__qty { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
    .pr__step { width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--nd-line); background: var(--nd-card-bg); color: var(--text-primary); display: grid; place-items: center; cursor: pointer; }
    .pr__step:disabled { opacity: .45; cursor: default; }
    .pr__n { min-width: 32px; text-align: center; font-size: 14px; font-weight: 600; }
    .pr__field { width: 100%; min-height: 40px; font-size: 14px; }
    .pr__rec { width: 100%; min-height: 72px; font-size: 14px; resize: vertical; }
    .pr__err { font-size: 12.5px; color: var(--red-text, #dc2626); }
    .pr__files { display: flex; flex-wrap: wrap; gap: 8px; }
    .pr__fx { width: 22px; height: 22px; margin-right: -8px; border: 0; border-radius: 8px; background: none; color: var(--text-tertiary); display: grid; place-items: center; cursor: pointer; }
    .pr__fx:hover { color: var(--red-text, #dc2626); background: var(--nd-chip-bg); }
    .pr__fx:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pr__file { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--nd-line);
      font-size: 12.5px; color: var(--text-secondary); overflow-wrap: anywhere; }
    .pr__up { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .pr__upb { height: 36px; min-height: 36px; }
    .pr__file-in { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .pr__badge { justify-self: start; display: inline-flex; align-items: center; min-height: 28px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;
      color: var(--green-text, #047857); background: color-mix(in srgb, #34d399 14%, transparent); }
    .pr__badge--later { color: var(--blue-text, #1d4ed8); background: color-mix(in srgb, #60a5fa 14%, transparent); }
    .pr__none { display: flex; align-items: center; min-height: 42px; font-size: 12.5px; color: var(--text-tertiary); }
    .pr__sess { font-size: 12.5px; font-weight: 600; color: var(--violet-text, #6d28d9); }
    .pr__read { font-size: 12.5px; color: var(--text-secondary); }
    .pr__read::before { content: '· '; color: var(--text-tertiary); }
    .pr__form { display: grid; gap: 12px; padding: 12px; border-radius: 10px; border: 1px solid var(--nd-line); background: var(--nd-card-bg); }
    .pr__fh { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
    .pr__fh b { font-size: 13.5px; }
    .pr__fhs { font-size: 12.5px; color: var(--text-tertiary); }
    .pr__grow { flex: 1 1 auto; }
    .pr__link { border: 0; background: none; padding: 0; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--violet-text, #6d28d9); cursor: pointer; }
    .pr__link:disabled { color: var(--text-tertiary); cursor: default; }
    .pr__link:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; border-radius: 4px; }
    .pr__form ::ng-deep .ofr { gap: 12px 24px; }
    .pr__form ::ng-deep .ofr-q { padding: 0; }
    .pr__form ::ng-deep .ofr-q__q { font-size: 12.5px; font-weight: 500; color: var(--text-secondary); }
    .pr__form ::ng-deep .ofr-chip, .pr__form ::ng-deep .ofr-seg .nd-seg__item, .pr__form ::ng-deep .ofr-scale button { height: 32px; }
    .pr__muted { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text-tertiary); }
    @media (max-width: 760px) { .pr__field, .pr__rec { font-size: 16px; } .pr__qty { margin-left: 0; } }
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
  /** Server supports the procedure record + files (feature-detected). */
  readonly recordEnabled = input(false);
  /** Files attached to each procedure (by row key). */
  readonly files = input<Record<string, { id: string; name: string; kind: string }[]>>({});
  /** Rows uploading right now. */
  readonly uploading = input<Record<string, boolean>>({});
  /** Files can be removed (the consult isn't completed). */
  readonly canRemoveFiles = input(false);
  /** × on a file chip (the host deletes it, optimistically). */
  readonly removeFile = output<{ key: string; id: string }>();
  /** Past sessions per procedure (serviceId → list; undefined = not loaded yet). */
  readonly sessions = input<Record<string, ProcedureSession[] | undefined>>({});
  /** Today's visit (never counted as a "last session"). */
  readonly todayVisitId = input<string | null>(null);
  readonly phone = input(false);
  /** Ask the host to load a procedure's past sessions. */
  readonly needSessions = output<string>();
  /** "Sessions": the host shows every past session as a table. */
  readonly showSessions = output<string>();

  constructor() {
    // Load the past sessions of every procedure on the pad that has a form.
    effect(() => {
      const items = this.items(), loaded = this.sessions();
      untracked(() => {
        for (const sid of new Set(items.map(p => p.serviceId))) {
          if (loaded[sid] === undefined && this.schemaOfService(sid)) this.needSessions.emit(sid);
        }
      });
    });
  }

  private schemaOfService(serviceId: string): unknown | null {
    const o = this.options().find(x => x.serviceId === serviceId);
    return o ? procedureSchemaOf(o) : null;
  }
  schemaOf(p: ConsultProcedureDraft): unknown | null { return this.schemaOfService(p.serviceId); }
  formNameOf(p: ConsultProcedureDraft): string | null {
    const o = this.options().find(x => x.serviceId === p.serviceId);
    return o?.form?.formName ?? o?.formName ?? null;
  }
  private past(p: ConsultProcedureDraft): ProcedureSession[] { return this.sessions()[p.serviceId] ?? []; }
  pastCount(p: ConsultProcedureDraft) { return this.past(p).filter(s => s.visitId !== this.todayVisitId()).length; }
  sessionNo(p: ConsultProcedureDraft) { return sessionNumber(this.past(p), this.todayVisitId()); }
  hintsFor(p: ConsultProcedureDraft) { return lastHints(this.schemaOf(p), this.past(p), this.todayVisitId()); }
  readings(p: ConsultProcedureDraft) { return keyReadings(this.schemaOf(p), p.answers, 2); }
  onHint(p: ConsultProcedureDraft, key: string) {
    const v = lastValue(key, this.past(p), this.todayVisitId());
    if (v !== undefined) this.patch(p.key, { answers: { ...(p.answers ?? {}), [key]: v } });
  }
  copyAll(p: ConsultProcedureDraft) {
    this.patch(p.key, { answers: copyAllFromLast(this.schemaOf(p), p.answers ?? {}, this.past(p), this.todayVisitId()) });
  }
  readonly itemsChange = output<ConsultProcedureDraft[]>();
  /** Files picked for a saved procedure (the host uploads them with its id). */
  readonly upload = output<{ key: string; procedureId: string; files: File[] }>();

  readonly sides = PROCEDURE_SIDES;
  readonly maxQty = MAX_PROCEDURE_QTY;
  readonly preferred = PREFERRED_WITHIN;
  readonly whens: { id: ProcedureWhen; label: string }[] = [{ id: 'now', label: 'Do now' }, { id: 'later', label: 'Book for later' }];
  /** The line open for editing (a new one opens itself). */
  readonly openKey = signal<string | null>(null);
  /** Inline refusals by row key (a refused price is never emitted). */
  readonly errs = signal<Record<string, string>>({});
  private readonly typed = signal<Record<string, string>>({});

  readonly canChange = computed(() => !this.readonly() && !!this.pricing()?.doctorCanChange);
  readonly total = computed(() => proceduresTotal(this.items()));
  readonly optionList = computed<PadOption[]>(() => this.options().map(o => ({ id: o.serviceId, label: o.name, meta: '₹' + o.price.toLocaleString('en-IN') })));
  /** The department's common procedures (one tap) — the first few not yet added. */
  readonly quickList = computed<PadOption[]>(() => {
    const have = new Set(this.items().map(p => p.serviceId));
    return this.optionList().filter(o => !have.has(o.id)).slice(0, 4);
  });

  hint(p: ConsultProcedureDraft) { return priceHint(p.rulePrice, p.price, this.pricing()); }
  needsReason(p: ConsultProcedureDraft) { return this.canChange() && needsPriceReason(p); }
  fileCount(p: ConsultProcedureDraft) { return this.files()[p.key]?.length ?? 0; }
  addById(id: string) { const o = this.options().find(x => x.serviceId === id); if (o) this.add(o); }
  pickFiles(p: ConsultProcedureDraft, el: HTMLInputElement) {
    const list = Array.from(el.files ?? []);
    el.value = '';
    if (list.length && p.id) this.upload.emit({ key: p.key, procedureId: p.id, files: list });
  }

  add(o: ConsultProcedureOption): void {
    if (this.readonly()) return;
    const row: ConsultProcedureDraft = {
      key: 'n' + (++seq), id: null, serviceId: o.serviceId, name: o.name, code: o.code ?? null, qty: 1,
      rulePrice: o.price, price: o.price, side: null, note: null, status: 'draft', when: 'now', preferredWithin: null, prepNote: null, record: null,
    };
    this.openKey.set(row.key);
    this.itemsChange.emit([...this.items(), row]);
  }

  remove(key: string): void {
    this.clearErr(key);
    if (this.openKey() === key) this.openKey.set(null);
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
