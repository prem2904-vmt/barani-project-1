import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SelectComponent, PfSelectOption } from '../../../../shared/primitives/select.component';
import { BUILT_INS, OpdQuestion, Q_TYPES, answersOf, conditionSources, typeName } from './form-schema';
import { patchQuestion, setSides } from './form-builder-ops';

export type InspectorMode = 'form' | 'question' | 'print' | 'try';

/**
 * The form builder's inspector (side action card) — in DOCTOR language:
 * question, answer type, choices, unit, sides, "show only when…", print on
 * the report, required. Without a selection it explains the form (built-ins
 * locked, doctors' add-ons, versions); in the printed view it lists what
 * prints; while trying the form it offers Reset / Back to editing. Emits the
 * whole new question list (the page owns the state).
 */
@Component({
  selector: 'pf-opd-form-inspector',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="nd-card__head">
      <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1ZM8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 12h8M8 16h5"/></svg></span>
      <span class="nd-card__label">{{ title() }}</span>
      <span class="fi-count nd-num">{{ count() }}</span>
      <span class="nd-card__spacer"></span>
      @if (mode() === 'question') {
        <button type="button" class="nd-btn nd-btn--icon fi-x" (click)="closed.emit()" aria-label="Done — close question settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      }
    </header>
    <div class="nd-card__body fi">
      @switch (mode()) {
        @case ('try') {
          <p class="fi-lead">Answer the way a doctor would. Questions with a condition appear as you answer.</p>
          <p class="fi-note">Nothing here is saved or sent. It's the doctor's view, with your draft changes.</p>
          <div class="fi-row">
            <button type="button" class="nd-btn nd-btn--secondary press" (click)="resetTry.emit()">Reset answers</button>
            <button type="button" class="nd-btn nd-btn--tertiary press" (click)="stopTry.emit()">Back to editing</button>
          </div>
        }
        @case ('print') {
          <p class="fi-lead">Only answered questions with <b>Print</b> on appear on the consult summary and prescription.</p>
          @for (q of list(); track q.key) {
            <div class="fi-pr">
              <span class="fi-pr__t">{{ q.label }}<small>{{ typeName(q) }}</small></span>
              <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="q.print !== false" [attr.aria-label]="'Print ' + q.label"
                      (click)="emit(patchQuestion(list(), q.key, { print: q.print === false }))"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
            </div>
          }
          <p class="fi-note">Vitals, diagnosis, prescription, investigations and the review date always print.</p>
        }
        @case ('form') {
          <p class="fi-lead">Click any question on the screen to change it — or type a sentence under <b>Add a question</b>.</p>
          <button type="button" class="nd-btn nd-btn--secondary press" (click)="browse.emit()">Browse answer types</button>
          <div class="fi-sec">Built into every consult</div>
          @for (b of builtIns; track b.key) {
            <div class="fi-built">
              <span class="fi-built__ic" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="b.icon"/></svg></span>
              <span class="fi-pr__t">{{ b.title }}<small>{{ b.hint }}</small></span>
              <svg class="fi-lock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Built-in"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
          }
          <p class="fi-note">Not questions on a form — every consult has them, whichever form a service uses.</p>
          <div class="fi-sec">Doctors</div>
          <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="allowAddons()" (click)="allowAddonsChange.emit(!allowAddons())">
            <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>Doctors may add their own questions</button>
          <p class="fi-note">On top of yours — they can't remove or change your questions.</p>
          <div class="fi-sec">Versions</div>
          <p class="fi-note">Changes save as a draft on their own. <b>Publish</b> makes the next version for new consults; past consults keep the version they were filled with.</p>
        }
        @case ('question') {
          @if (q(); as f) {
            <label class="fi-fld"><span class="fi-lbl">Question</span>
              <input class="nd-input" [value]="f.label" maxlength="200" autocomplete="off" (input)="patch({ label: $any($event.target).value || f.label })"></label>
            <div class="fi-fld"><span class="fi-lbl">Answer type</span>
              <button type="button" class="fi-type press" (click)="changeType.emit()">
                <span class="fi-type__t"><b>{{ f.sides ? 'Left & right · ' + Q_TYPES[f.type][0] : Q_TYPES[f.type][0] }}</b><small>{{ Q_TYPES[f.sides ? 'lr' : f.type][1] }}</small></span>
                <span class="fi-type__c">Change</span>
              </button></div>
            @if (f.type === 'one' || f.type === 'many') {
              <div class="fi-fld"><span class="fi-lbl">Choices</span>
                @for (c of f.choices ?? []; track $index; let k = $index) {
                  <span class="fi-ch">
                    <input class="nd-input" [value]="c" [attr.aria-label]="'Choice ' + (k + 1)" (change)="setChoice(k, $any($event.target).value)">
                    <button type="button" class="nd-btn nd-btn--icon" (click)="removeChoice(k)" [disabled]="(f.choices?.length ?? 0) <= 1" [attr.aria-label]="'Remove ' + c">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                  </span>
                }
                <button type="button" class="nd-btn nd-btn--tertiary fi-add press" (click)="addChoice()">+ Add a choice</button>
              </div>
            }
            @if (f.type === 'num' || f.type === 'table') {
              <label class="fi-fld"><span class="fi-lbl">Unit</span>
                <input class="nd-input" [value]="f.unit ?? ''" placeholder="e.g. kg, mm, days" maxlength="24" autocomplete="off" (input)="patch({ unit: $any($event.target).value || undefined })"></label>
            }
            @if (f.type === 'scale') {
              <div class="fi-fld"><span class="fi-lbl">Goes from</span>
                <span class="fi-2"><input class="nd-input nd-num" inputmode="numeric" aria-label="Lowest" [value]="f.min ?? 0" (change)="setScale('min', $any($event.target).value)">
                  <span>to</span><input class="nd-input nd-num" inputmode="numeric" aria-label="Highest" [value]="f.max ?? 10" (change)="setScale('max', $any($event.target).value)"></span></div>
            }
            @if (f.type === 'table') {
              <label class="fi-fld"><span class="fi-lbl">Columns</span>
                <input class="nd-input" [value]="(f.cols ?? []).join(', ')" (change)="patch({ cols: splitList($any($event.target).value) })"></label>
              <label class="fi-fld"><span class="fi-lbl">Rows</span>
                <input class="nd-input" [value]="(f.rows ?? []).join(', ')" (change)="patch({ rows: splitList($any($event.target).value) })"></label>
            }
            @if (f.type === 'diagram') {
              <div class="fi-fld"><span class="fi-lbl">Outline</span>
                <span class="nd-seg" role="radiogroup" aria-label="Outline">
                  @for (o of shapes; track o.value) {
                    <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="(f.shape ?? 'body') === o.value" (click)="patch({ shape: o.value })">{{ o.label }}</button>
                  }
                </span></div>
            }
            @if (f.type === 'media') {
              <p class="fi-note"><b>Decided:</b> any image or video format — captured, from the endoscope, or uploaded.</p>
            }
            @if (f.type !== 'media' && f.type !== 'table') {
              <div class="fi-fld">
                <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="!!f.sides" (click)="emit(setSides(list(), f.key, !f.sides))">
                  <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>Left &amp; right sides?</button>
                <span class="fi-note">Ask for right and left separately — ears, eyes, nostrils, limbs.</span></div>
            }
            <div class="fi-fld"><span class="fi-lbl">Show only when…</span>
              @if (f.when && srcOf(f)) {
                <span class="fi-cond">
                  <pf-select size="sm" [options]="sourceOptions()" [value]="f.when.key" (valueChange)="setCondSource($event)"></pf-select>
                  <span class="fi-cond__is">is</span>
                  <pf-select size="sm" [options]="valueOptions()" [value]="f.when.value" (valueChange)="patch({ when: { key: f.when.key, value: $event } })"></pf-select>
                  <button type="button" class="nd-btn nd-btn--icon" (click)="patch({ when: null })" aria-label="Remove the condition">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                </span>
                <span class="fi-note">Hidden until the doctor answers “{{ srcLabel() }}” with {{ f.when.value }}.</span>
              } @else if (sources().length) {
                <button type="button" class="nd-btn nd-btn--secondary press" (click)="addCondition()">Add a condition</button>
                <span class="fi-note">e.g. show “Discharge type” only when “Ear discharge” is Yes.</span>
              } @else {
                <span class="fi-note">Needs a Yes / No or Pick-one question above this one.</span>
              }
            </div>
            <div class="fi-box">
              <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="f.print !== false" (click)="patch({ print: f.print === false })">
                <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>Print on the report?</button>
              <span class="fi-note">On the consult summary and prescription the patient takes home.</span>
              <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="!!f.required" (click)="patch({ required: !f.required })">
                <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>Required</button>
              <span class="fi-note">The doctor must answer before completing the consult.</span>
            </div>
          }
        }
      }
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; }
    .fi { gap: 12px; }
    .fi-count { font-size: 12.5px; color: var(--text-tertiary); }
    .fi-x { width: 32px !important; height: 32px; min-height: 32px; }
    .fi-lead { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
    .fi-note { margin: 0; font-size: 12px; line-height: 1.5; color: var(--text-tertiary); }
    .fi-sec { margin-top: 6px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
    .fi-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .fi-fld { display: flex; flex-direction: column; gap: 6px; }
    .fi-lbl { font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    .fi-type { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 8px 12px; text-align: left; border-radius: 12px;
      border: 1px solid var(--nd-line); background: var(--nd-card-bg); color: var(--text-primary); font: inherit; cursor: pointer; }
    .fi-type:hover { border-color: var(--nd-sel-border); }
    .fi-type__t { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; font-size: 13px; }
    .fi-type__t small { font-size: 12px; color: var(--text-tertiary); }
    .fi-type__c { font-size: 12.5px; font-weight: 600; color: var(--violet-text, #6d28d9); }
    .fi-ch { display: flex; gap: 6px; align-items: center; }
    .fi-add { align-self: flex-start; }
    .fi-2 { display: flex; align-items: center; gap: 8px; }
    .fi-2 .nd-input { width: 80px; }
    .fi-cond { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .fi-cond pf-select { min-width: 120px; flex: 1 1 120px; }
    .fi-cond__is { font-size: 12.5px; color: var(--text-secondary); }
    .fi-box { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 12px; border: 1px solid var(--nd-line); }
    .fi-pr, .fi-built { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 0; border-bottom: 1px solid var(--nd-line); }
    .fi-pr__t { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; font-size: 13px; color: var(--text-primary); }
    .fi-pr__t small { font-size: 12px; color: var(--text-tertiary); }
    .fi-built__ic { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; background: var(--nd-chip-bg); color: var(--text-secondary); flex: none; }
    .fi-lock { color: var(--text-tertiary); flex: none; }
    @media (max-width: 640px) { .nd-input { font-size: 16px; } }
  `],
})
export class OpdFormInspectorComponent {
  readonly list = input<OpdQuestion[]>([]);
  readonly selectedKey = input<string | null>(null);
  readonly mode = input<InspectorMode>('form');
  readonly allowAddons = input<boolean>(true);

  readonly listChange = output<OpdQuestion[]>();
  readonly closed = output<void>();
  readonly browse = output<void>();
  readonly changeType = output<void>();
  readonly allowAddonsChange = output<boolean>();
  readonly resetTry = output<void>();
  readonly stopTry = output<void>();

  protected readonly Q_TYPES = Q_TYPES;
  protected readonly typeName = typeName;
  protected readonly patchQuestion = patchQuestion;
  protected readonly setSides = setSides;
  readonly builtIns = BUILT_INS;
  readonly shapes: { value: 'ear' | 'nose' | 'body'; label: string }[] = [
    { value: 'ear', label: 'Ear drum' }, { value: 'nose', label: 'Nasal cavity' }, { value: 'body', label: 'Body' },
  ];

  readonly index = computed(() => this.list().findIndex((x) => x.key === this.selectedKey()));
  readonly q = computed(() => this.list()[this.index()] ?? null);
  readonly sources = computed(() => conditionSources(this.list(), this.index()));
  readonly sourceOptions = computed<PfSelectOption<string>[]>(() => this.sources().map((s) => ({ value: s.key, label: s.label })));
  readonly valueOptions = computed<PfSelectOption<string>[]>(() => {
    const src = this.srcOf(this.q());
    return src ? answersOf(src).map((v) => ({ value: v, label: v })) : [];
  });
  readonly title = computed(() => ({ try: 'Trying as a doctor', print: 'What prints', form: 'This form', question: 'Question' } as const)[this.mode()]);
  readonly count = computed(() => {
    const n = this.list().length;
    if (this.mode() === 'question') return `${this.index() + 1} of ${n}`;
    if (this.mode() === 'print') return `${this.list().filter((x) => x.print !== false).length} of ${n}`;
    if (this.mode() === 'form') return `${n} ${n === 1 ? 'question' : 'questions'}`;
    return '';
  });

  srcOf(f: OpdQuestion | null): OpdQuestion | undefined { return f?.when ? this.list().find((x) => x.key === f.when!.key) : undefined; }
  srcLabel(): string { return (this.srcOf(this.q())?.label ?? '').replace(/\?$/, ''); }

  emit(list: OpdQuestion[]): void { this.listChange.emit(list); }
  patch(p: Partial<OpdQuestion>): void { const f = this.q(); if (f) this.emit(patchQuestion(this.list(), f.key, p)); }

  setChoice(k: number, v: string): void {
    const f = this.q(); if (!f) return;
    const t = String(v ?? '').trim(); if (!t) return;
    const choices = (f.choices ?? []).map((c, i) => (i === k ? t : c));
    const old = f.choices?.[k];
    // A condition on the renamed answer follows it.
    const list = patchQuestion(this.list(), f.key, { choices }).map((x) => (x.when?.key === f.key && x.when.value === old ? { ...x, when: { key: f.key, value: t } } : x));
    this.emit(list);
  }
  removeChoice(k: number): void { const f = this.q(); if (f && (f.choices?.length ?? 0) > 1) this.patch({ choices: f.choices!.filter((_, i) => i !== k) }); }
  addChoice(): void {
    const f = this.q(); if (!f) return;
    const c = f.choices ?? [];
    let n = c.length + 1, label = `Choice ${n}`;
    while (c.includes(label)) label = `Choice ${++n}`;
    this.patch({ choices: [...c, label] });
  }
  setScale(which: 'min' | 'max', v: string): void {
    const f = this.q(); if (!f) return;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return;
    const min = which === 'min' ? n : f.min ?? 0;
    const max = which === 'max' ? n : f.max ?? 10;
    if (max <= min || max - min > 20) return;
    this.patch({ min, max });
  }
  splitList(v: string): string[] { return String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20); }
  addCondition(): void {
    const srcs = this.sources();
    const s0 = srcs.find((x) => x.type === 'yn') ?? srcs[0];
    if (s0) this.patch({ when: { key: s0.key, value: answersOf(s0)[0] } });
  }
  setCondSource(key: string): void {
    const s = this.list().find((x) => x.key === key);
    if (s) this.patch({ when: { key, value: answersOf(s)[0] } });
  }
}
