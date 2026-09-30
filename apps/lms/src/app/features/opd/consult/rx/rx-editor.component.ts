import {
  ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, model, output, signal,
} from '@angular/core';
import type { OpdPatientAllergy, OpdPregnancy } from '../../shared/opd.models';
import {
  DURATIONS, FORMS, RxLine, RxSchedule, RxUsual, STEP_DURATIONS, doseShort, formOf, lineShort, newRxLine, parseRx, qtyWords,
  sayRx, segsOf, stripDays, whenShort,
} from '../../shared/rx-schedule';
import {
  ALL_TIMINGS, ConsultDrugRef, ConsultRxLine, THEN_PRESETS, TIMING_GRID, TIMING_MORE, addThen, allergyHit, freeDrug, lineKey,
  pregnancyHit, removeStep, sitesFor, swapCandidate, timingIdOf,
} from './rx-model';
import { RxPopClose, RxPopOption, RxPopoverComponent } from './rx-popover.component';

type Field = 'dose' | 'site' | 'when' | 'dur' | 'food' | 'then' | 'strip';
interface OpenPop { key: string; step: number; field: Field; anchor: HTMLElement; }

/** Duration label in doctor words: 7 → "1 week", 14 → "2 weeks", else "n days". */
export function durLabel(n: number): string {
  if (n >= 7 && n % 7 === 0) return n === 7 ? '1 week' : n / 7 + ' weeks';
  return n === 1 ? '1 day' : n + ' days';
}

/**
 * Step 2 — the prescription (Agent C). ONE line per medicine in doctor
 * shorthand (`Drug · dose · where · 1-0-1 · 5 days · after food`), values in
 * aligned columns; tapping a value opens a small popover with only that
 * value's options (RxPopoverComponent: keyboard Tab / Enter / arrows / Esc).
 * "+ then…" adds a taper step; a calendar glyph shows the 14-day strip. The
 * add box reads shorthand (`clav 1-0-1 5d af`) with a live preview. Every
 * sentence / quantity / strip comes from the SHARED model
 * (features/opd/shared/rx-schedule.ts). Allergy conflicts show inline with a
 * one-tap swap or "Keep, reviewed" (the ack is stored on the line).
 */
@Component({
  selector: 'pf-rx-editor',
  standalone: true,
  imports: [RxPopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rxe">
      @if (lines().length) {
        <div class="rxe__card">
          <div class="rxe__head" aria-hidden="true">
            <span></span><span>Medicine</span><span>Dose</span><span>Where</span><span>When</span><span>For</span><span>Food</span><span></span><span class="r">Qty</span><span></span>
          </div>
          @for (l of lines(); track l.key; let i = $index) {
            @let hit = hitOf(l);
            @let pregHit = pregHitOf(l);
            <div class="rxe__line" [class.rxe__line--warn]="(hit && !l.allergyAck) || (pregHit && !l.pregnancyAck)" [attr.data-key]="l.key">
              @for (sg of segs(l); track sg.k; let k = $index) {
                <div class="rxe__row" [class.rxe__row--then]="k > 0">
                  @if (k === 0) {
                    <span class="rxe__n">{{ i + 1 }}</span>
                    <span class="rxe__drug">
                      <span class="rxe__name" [class.rxe__name--warn]="(hit && !l.allergyAck) || (pregHit && !l.pregnancyAck)">{{ l.drug.name }}</span>
                      @if (schedBadge(l.drug); as b) { <span class="rxe__sch" [class.rxe__sch--h]="b !== 'OTC'">{{ b }}</span> }
                      @if (pregnant() && l.drug.pregnancyRisk === 'caution') { <span class="rxe__preg-caution" title="Use with caution in pregnancy">Caution in pregnancy</span> }
                      @if (l.drug.generic || l.drug.strength) { <span class="rxe__gen">{{ l.drug.generic }}{{ l.drug.generic && l.drug.strength ? ' ' : '' }}{{ l.drug.strength }}</span> }
                      @if (l.drug.free) { <span class="rxe__gen">Not in the drug master · dispensed by name</span> }
                    </span>
                  } @else {
                    <span class="rxe__n"></span>
                    <span class="rxe__drug rxe__then-lbl">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4v7a4 4 0 0 0 4 4h10"/><path d="m15 11 4 4-4 4"/></svg>
                      then
                    </span>
                  }
                  <span class="rxe__c">
                    @if (l.drug.form !== 'cream') {
                      <button type="button" class="rxv" [disabled]="readonly()" (click)="open($event, l, k, 'dose')" [attr.aria-label]="'Dose ' + doseShort(l.drug, sg.dose)">{{ doseShort(l.drug, sg.dose) }}</button>
                    } @else { <span class="rxe__static">Thin layer</span> }
                  </span>
                  <span class="rxe__c">
                    @if (k === 0 && sites(l).length) {
                      <button type="button" class="rxv" [disabled]="readonly()" (click)="open($event, l, 0, 'site')" aria-label="Where">{{ l.line.site || 'Where?' }}</button>
                    }
                  </span>
                  <span class="rxe__c rxe__when">
                    <button type="button" class="rxv" [disabled]="readonly()" (click)="open($event, l, k, 'when')" [attr.aria-label]="'When ' + whenShort(sg.sched)">{{ whenShort(sg.sched) }}</button>
                    @if (k === 0) {
                      <button type="button" class="rxe__cal" (click)="open($event, l, 0, 'strip')" aria-label="Show the next 14 days" title="Next 14 days">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                      </button>
                    }
                  </span>
                  <span class="rxe__c">
                    <button type="button" class="rxv" [disabled]="readonly()" (click)="open($event, l, k, 'dur')" aria-label="For how long">{{ durText(l, sg) }}</button>
                  </span>
                  <span class="rxe__c">
                    @if (k === 0 && hasFood(l)) {
                      <button type="button" class="rxv" [disabled]="readonly()" (click)="open($event, l, 0, 'food')" aria-label="Food">{{ l.line.food ? l.line.food + ' food' : 'Any time' }}</button>
                    }
                  </span>
                  <span class="rxe__c">
                    @if (!readonly() && k === segs(l).length - 1 && l.line.sched.type !== 'cycle') {
                      <button type="button" class="rxe__then" (click)="open($event, l, k, 'then')">+ then</button>
                    }
                  </span>
                  <span class="rxe__c r rxe__qty">@if (k === 0) { {{ qty(l) }} }</span>
                  <span class="rxe__c">
                    @if (!readonly()) {
                      <button type="button" class="rxe__x" (click)="k === 0 ? remove(l) : dropStep(l, k)" [attr.aria-label]="k === 0 ? 'Remove ' + l.drug.name : 'Remove this step'">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                      </button>
                    }
                  </span>
                </div>
              }
              <p class="rxe__say">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/></svg>
                {{ say(l) }}
              </p>
              @if (hit) {
                @if (!l.allergyAck) {
                  <div class="rxe__allergy" role="alert">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                    <span class="rxe__allergy-t"><b>Allergy: {{ hit.allergy.allergen }}</b>@if (hit.allergy.reaction) { — {{ hit.allergy.reaction }}}. {{ hit.reason }}</span>
                    @if (!readonly()) {
                      @if (swapFor(l); as alt) {
                        <button type="button" class="rxe__swap" (click)="swap(l, alt)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>
                          Swap to {{ alt.name }}
                        </button>
                      }
                      <button type="button" class="rxe__keep" (click)="keep(l)">Keep, reviewed</button>
                    }
                  </div>
                } @else {
                  <p class="rxe__acked">Allergy reviewed — kept on purpose ({{ hit.allergy.allergen }}).
                    @if (!readonly()) { <button type="button" class="rxe__undo-ack" (click)="unkeep(l)">Undo</button> }</p>
                }
              }
              @if (pregHit) {
                @if (!l.pregnancyAck) {
                  <div class="rxe__allergy rxe__preg" role="alert">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                    <span class="rxe__allergy-t"><b>{{ pregHit.risk === 'contraindicated' ? 'Contraindicated in pregnancy' : 'Avoid in pregnancy' }}</b>. {{ pregHit.reason }}</span>
                    @if (!readonly()) {
                      @if (swapFor(l); as alt) {
                        <button type="button" class="rxe__swap" (click)="swap(l, alt)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>
                          Swap to {{ alt.name }}
                        </button>
                      }
                      <button type="button" class="rxe__keep" (click)="keepPregnancy(l)">Keep, reviewed</button>
                    }
                  </div>
                } @else {
                  <p class="rxe__acked">Pregnancy risk reviewed — kept on purpose ({{ l.drug.name }}).
                    @if (!readonly()) { <button type="button" class="rxe__undo-ack" (click)="unkeepPregnancy(l)">Undo</button> }</p>
                }
              }
            </div>
          }
        </div>
      } @else if (readonly()) {
        <p class="rxe__none">No medicines prescribed.</p>
      }

      @if (!readonly()) {
        <div class="rxe__add">
          <label class="rxe__addbox">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            <input #addIn type="text" class="rxe__addin" [value]="typed()" (input)="onType(addIn.value)" (keydown)="onAddKey($event)"
                   placeholder="Add a medicine — e.g. clav 1-0-1 5d af" aria-label="Add a medicine in shorthand" autocomplete="off" spellcheck="false" />
          </label>
          @if (typed().trim()) {
            <div class="rxe__suggest">
              @if (preview(); as p) {
                <button type="button" class="rxe__asTyped" (click)="addParsed()">
                  <span class="rxe__k">Add as typed <kbd>Enter</kbd></span>
                  <span class="rxe__pl"><b>{{ p.drug.name }}</b> {{ lineShortOf(p.line, p.drug) }}</span>
                  <span class="rxe__ps">{{ sayOf(p.line, p.drug) }}</span>
                </button>
              }
              @if (matches().length) {
                <div class="rxe__k rxe__k--pad">Matches</div>
                @for (d of matches(); track d.id) {
                  <button type="button" class="rxe__match" (click)="addDrug(d)">
                    <span class="rxe__pl"><b>{{ d.name }}</b>@if (schedBadge(d); as b) { <span class="rxe__sch" [class.rxe__sch--h]="b !== 'OTC'">{{ b }}</span> }</span>
                    <span class="rxe__ps">{{ d.generic }} · {{ lineShortOf(usualLine(d), d) }}</span>
                    @if (hitOfDrug(d)) { <span class="rxe__warnchip">Allergy</span> }
                    @else if (pregHitOfDrug(d)) { <span class="rxe__warnchip">{{ pregHitOfDrug(d)!.risk === 'contraindicated' ? 'Contraindicated' : 'Avoid — pregnancy' }}</span> }
                  </button>
                }
              } @else if (!preview()) {
                <button type="button" class="rxe__match" (click)="addFree()">
                  <span class="rxe__pl">Add <b>{{ freeName() }}</b> as written</span>
                  <span class="rxe__ps">Not in the drug master — the pharmacy dispenses it by name.</span>
                </button>
              }
            </div>
          }
        </div>
      }
    </div>

    @if (pop(); as p) {
      <pf-rx-popover [anchor]="p.anchor" [options]="popOptions()" [selected]="popSelected()" [title]="popTitle()"
                     [minWidth]="p.field === 'strip' ? 320 : p.field === 'when' ? 300 : 180" (closed)="onPop($event)">
        @if (p.field === 'strip') {
          @let l = lineByKey(p.key);
          @if (l) {
            <div class="rxs" role="img" [attr.aria-label]="'Doses over the next 14 days for ' + l.drug.name">
              @for (c of strip(l); track $index) {
                <span class="rxs__d" [class.rxs__d--today]="c.today" [class.rxs__d--off]="c.day && !c.day.n" [class.rxs__d--done]="!c.day">
                  <span class="rxs__w">{{ 'SMTWTFS'[c.weekday] }}</span>
                  <span class="rxs__n">{{ c.date.getDate() }}</span>
                  <span class="rxs__dots">
                    @if (c.day) { @for (x of dots(c.day.n); track $index) { <i [class.sos]="c.day.sos"></i> } }
                  </span>
                </span>
              }
            </div>
            <p class="rxs__foot">{{ qty(l) }} in total · filled dot = a dose, hollow = only if needed</p>
          }
        }
      </pf-rx-popover>
    }
  `,
  styles: [`
    :host { display: block; }
    .rxe { display: flex; flex-direction: column; gap: 12px; }
    .rxe__card { border-radius: var(--nd-radius-card, 16px); background: var(--nd-card-bg); border: 1px solid var(--nd-line); padding: 4px 14px 8px; }
    .rxe__head, .rxe__row { display: grid; align-items: start; column-gap: 10px;
      grid-template-columns: 26px minmax(150px, 1.6fr) 74px minmax(76px, 0.9fr) minmax(92px, 1fr) 76px 84px 56px 76px 30px; }
    .rxe__head { padding: 12px 0 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); border-bottom: 1px solid var(--nd-line); }
    .r { text-align: right; justify-self: end; }
    .rxe__line { padding: 12px 0 10px; border-bottom: 1px solid var(--nd-line); }
    .rxe__line:last-child { border-bottom: 0; }
    .rxe__row { padding: 4px 0; }
    .rxe__row--then { padding-top: 8px; }
    .rxe__n { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 600; color: var(--text-tertiary); background: var(--nd-chip-bg); margin-top: 2px; }
    .rxe__line--warn .rxe__n { color: var(--red-text, #dc2626); background: color-mix(in srgb, var(--red-text, #dc2626) 12%, transparent); }
    .rxe__drug { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
    .rxe__name { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .rxe__name--warn { color: var(--red-text, #dc2626); }
    .rxe__gen { flex-basis: 100%; font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); }
    .rxe__sch { font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--nd-line); color: var(--text-tertiary); }
    .rxe__sch--h { color: var(--red-text, #dc2626); border-color: color-mix(in srgb, var(--red-text, #dc2626) 45%, transparent); }
    .rxe__preg-caution { font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 6px; border: 1px solid color-mix(in srgb, #d97706 45%, transparent); color: #b45309; }
    :host-context(html.dark) .rxe__preg-caution { color: #fbbf24; border-color: color-mix(in srgb, #fbbf24 45%, transparent); }
    .rxe__then-lbl { display: inline-flex; align-items: center; gap: 6px; padding-left: 12px; font-size: 13px; color: var(--text-tertiary); }
    .rxe__c { min-width: 0; display: flex; align-items: center; gap: 4px; min-height: 30px; }
    .rxe__static { font-size: 14px; color: var(--text-primary); }
    .rxv { max-width: 100%; padding: 2px 0; border: 0; border-bottom: 1.5px dotted color-mix(in srgb, var(--text-primary) 45%, transparent);
      background: transparent; color: var(--text-primary); font: inherit; font-size: 14.5px; font-weight: 500; font-variant-numeric: tabular-nums;
      text-align: left; cursor: pointer; border-radius: 0; line-height: 1.35; }
    .rxv:hover:not(:disabled), .rxv:focus-visible { color: var(--violet-text, #6d28d9); border-bottom-color: currentColor; outline: none; background: var(--nd-in-tint); }
    .rxv:disabled { border-bottom-color: transparent; cursor: default; }
    .rxe__cal { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 8px; background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .rxe__cal:hover, .rxe__cal:focus-visible { color: var(--violet-text, #6d28d9); background: var(--nd-chip-bg); outline: none; }
    .rxe__then { border: 0; background: transparent; padding: 2px 0; font: inherit; font-size: 13px; font-weight: 500; color: var(--violet-text, #6d28d9); cursor: pointer; white-space: nowrap; }
    .rxe__qty { font-size: 13px; color: var(--text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .rxe__x { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--text-tertiary); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .rxe__x:hover { color: var(--red-text, #dc2626); background: color-mix(in srgb, var(--red-text, #dc2626) 10%, transparent); }
    .rxe__say { display: flex; gap: 8px; align-items: flex-start; margin: 6px 0 0 36px; font-size: 13px; line-height: 1.45; color: var(--text-secondary); }
    .rxe__say svg { flex: none; margin-top: 3px; color: var(--text-tertiary); }
    .rxe__allergy { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin: 10px 0 2px 36px; padding: 10px 14px; border-radius: 12px;
      background: color-mix(in srgb, var(--red-text, #dc2626) 8%, var(--nd-card-bg)); border: 1px solid color-mix(in srgb, var(--red-text, #dc2626) 30%, transparent); color: var(--text-primary); font-size: 13px; line-height: 1.45; }
    .rxe__allergy > svg { color: var(--red-text, #dc2626); flex: none; }
    .rxe__allergy-t { flex: 1 1 260px; min-width: 0; }
    .rxe__allergy-t b { color: var(--red-text, #dc2626); font-weight: 600; }
    .rxe__swap { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--color-violet-600, #7c3aed);
      background: var(--nd-card-bg); color: var(--violet-text, #6d28d9); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .rxe__keep { border: 0; background: transparent; padding: 4px 2px; font: inherit; font-size: 13px; font-weight: 600; color: var(--violet-text, #6d28d9); text-decoration: underline; cursor: pointer; }
    .rxe__acked { margin: 8px 0 0 36px; font-size: 12.5px; color: var(--text-tertiary); }
    .rxe__undo-ack { border: 0; background: transparent; font: inherit; font-size: 12.5px; color: var(--violet-text, #6d28d9); cursor: pointer; }
    .rxe__none { margin: 0; font-size: 13px; color: var(--text-tertiary); }

    .rxe__add { display: flex; flex-direction: column; gap: 8px; }
    .rxe__addbox { display: flex; align-items: center; gap: 10px; max-width: 560px; min-height: 46px; padding: 0 14px; border-radius: 12px;
      background: var(--nd-card-bg); border: 1px solid var(--nd-line); color: var(--text-tertiary); }
    .rxe__addbox:focus-within { border-color: var(--color-violet-600, #7c3aed); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent); }
    .rxe__addin { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 14.5px; }
    .rxe__suggest { display: flex; flex-direction: column; gap: 2px; padding: 6px; border-radius: 14px; background: var(--nd-card-bg); border: 1px solid var(--nd-line); box-shadow: var(--nd-shadow-sm); }
    .rxe__asTyped, .rxe__match { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: 100%; padding: 10px 12px; border-radius: 10px;
      border: 1px solid transparent; background: transparent; color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; position: relative; }
    .rxe__asTyped { border-color: var(--nd-sel-border); background: var(--nd-in-tint); }
    .rxe__match:hover, .rxe__match:focus-visible { background: var(--nd-chip-bg); outline: none; }
    .rxe__k { display: flex; width: 100%; justify-content: space-between; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--violet-text, #6d28d9); }
    .rxe__k--pad { padding: 8px 12px 2px; color: var(--text-tertiary); }
    .rxe__k kbd { font: inherit; font-size: 11px; letter-spacing: 0; text-transform: none; padding: 1px 7px; border-radius: 6px; border: 1px solid var(--nd-line); color: var(--text-secondary); background: var(--nd-card-bg); }
    .rxe__pl { font-size: 14px; display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
    .rxe__pl b { font-weight: 600; }
    .rxe__ps { font-size: 12.5px; color: var(--text-tertiary); line-height: 1.4; }
    .rxe__warnchip { position: absolute; right: 12px; top: 12px; font-size: 11px; font-weight: 600; color: var(--red-text, #dc2626); }

    .rxs { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
    .rxs__d { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px; border-radius: 10px; background: var(--nd-chip-bg); }
    .rxs__d--today { outline: 1.5px solid var(--color-violet-600, #7c3aed); }
    .rxs__d--off { opacity: 0.55; }
    .rxs__d--done { background: transparent; opacity: 0.4; }
    .rxs__w { font-size: 10px; font-weight: 600; color: var(--text-tertiary); }
    .rxs__n { font-size: 12.5px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .rxs__dots { display: flex; flex-wrap: wrap; justify-content: center; gap: 2px; min-height: 7px; max-width: 34px; }
    .rxs__dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--color-violet-600, #7c3aed); }
    .rxs__dots i.sos { background: transparent; border: 1.5px solid var(--color-violet-600, #7c3aed); width: 5px; height: 5px; }
    .rxs__foot { margin: 10px 2px 2px; font-size: 12px; color: var(--text-tertiary); }

    /* Tablet: fold Food/+then under the line; phone: one card per medicine. */
    @media (max-width: 1280px) {
      .rxe__head, .rxe__row { grid-template-columns: 24px minmax(130px, 1.4fr) 66px minmax(70px, 0.9fr) minmax(84px, 1fr) 70px 78px 50px 68px 28px; column-gap: 8px; }
    }
    @media (max-width: 760px) {
      .rxe__card { padding: 2px 12px 6px; }
      .rxe__head { display: none; }
      .rxe__row { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
      .rxe__drug { flex: 1 1 calc(100% - 70px); }
      .rxe__row > .rxe__c:last-child { position: absolute; right: 0; top: 8px; }
      .rxe__line { position: relative; }
      .rxe__c:empty { display: none; }
      .rxe__say, .rxe__allergy, .rxe__acked { margin-left: 0; }
      .rxv { font-size: 16px; }
      .rxe__addin { font-size: 16px; }
    }
    @media (pointer: coarse) { .rxv { min-height: 36px; } .rxe__x, .rxe__cal { width: 40px; height: 40px; } }
  `],
})
export class RxEditorComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly lines = model<ConsultRxLine[]>([]);
  readonly drugs = input<ConsultDrugRef[]>([]);
  readonly allergies = input<OpdPatientAllergy[]>([]);
  /** Pregnancy-safety guard (night/safety, critic P0 #1c) — the patient's resolved status. */
  readonly pregnant = input<OpdPregnancy | null>(null);
  readonly readonly = input(false);
  /** Day 0 of the course (the visit day). */
  readonly start = input<Date>(new Date());
  /** The doctor's usual line per drug id (last prescribed), null = model default. */
  readonly usuals = input<Record<string, RxUsual>>({});
  /** Drugs the doctor already uses for today's diagnosis (swap preference). */
  readonly preferIds = input<string[]>([]);
  /** Ask the host to search the drug master (debounced there). */
  readonly search = output<string>();
  /** A human line for the host's toast (swap / add). */
  readonly notice = output<string>();

  readonly typed = signal('');
  readonly pop = signal<OpenPop | null>(null);

  readonly doseShort = doseShort;
  readonly whenShort = (s: RxSchedule) => whenShort(s);

  private readonly usualOf = (id: string): RxUsual | null => this.usuals()[id] ?? null;

  readonly parsed = computed(() => parseRx(this.typed(), this.drugs(), this.usualOf));
  /** The live "add as typed" preview — only when the text carries an instruction. */
  readonly preview = computed(() => {
    const p = this.parsed();
    return p && p.drug && p.line && p.any ? { drug: p.drug as ConsultDrugRef, line: p.line } : null;
  });
  readonly matches = computed<ConsultDrugRef[]>(() => {
    const p = this.parsed();
    const q = (p?.name ?? this.typed()).trim().toLowerCase();
    if (!q) return [];
    return this.drugs().filter(d => `${d.name} ${d.generic ?? ''} ${d.aliases ?? ''}`.toLowerCase().includes(q)).slice(0, 6);
  });
  readonly freeName = computed(() => (this.parsed()?.name ?? this.typed()).trim().replace(/\b\w/g, c => c.toUpperCase()));

  segs(l: ConsultRxLine) { return segsOf(l.line); }
  sites(l: ConsultRxLine) { return sitesFor(l.drug); }
  hasFood(l: ConsultRxLine) { return !!formOf(l.drug).food; }
  say(l: ConsultRxLine) { return sayRx(l.line, l.drug); }
  sayOf(line: RxLine, d: ConsultDrugRef) { return sayRx(line, d); }
  lineShortOf(line: RxLine, d: ConsultDrugRef) { return lineShort(line, d); }
  qty(l: ConsultRxLine) { return qtyWords(l.line, l.drug, this.start()); }
  strip(l: ConsultRxLine) { return stripDays(l.line, this.start(), 14); }
  dots(n: number) { return Array.from({ length: Math.min(n, 8) }); }
  hitOf(l: ConsultRxLine) { return allergyHit(l.drug, this.allergies()); }
  hitOfDrug(d: ConsultDrugRef) { return allergyHit(d, this.allergies()); }
  pregHitOf(l: ConsultRxLine) { return pregnancyHit(l.drug, this.pregnant()); }
  pregHitOfDrug(d: ConsultDrugRef) { return pregnancyHit(d, this.pregnant()); }
  swapFor(l: ConsultRxLine) { return swapCandidate(l, this.drugs(), this.allergies(), this.preferIds()); }
  usualLine(d: ConsultDrugRef) { return newRxLine(d.id, this.usualOf(d.id)); }
  lineByKey(key: string) { return this.lines().find(l => l.key === key) ?? null; }
  schedBadge(d: ConsultDrugRef): string | null {
    if (d.free) return null;
    const s = (d.schedule || 'none').toString();
    return s === 'none' || s === 'G' ? 'OTC' : 'Sch ' + s;
  }
  durText(l: ConsultRxLine, sg: { dur: number; sched: RxSchedule; k: number }): string {
    if (l.line.sched.type === 'cycle') { const c = l.line.sched.cycles || 1; return c + (c === 1 ? ' cycle' : ' cycles'); }
    return durLabel(sg.dur || 0);
  }

  // ── Editing ────────────────────────────────────────────────────────
  private patch(key: string, f: (l: ConsultRxLine) => ConsultRxLine) {
    this.lines.update(ls => ls.map(l => (l.key === key ? f(l) : l)));
  }
  private setLine(key: string, fn: (line: RxLine) => void) {
    this.patch(key, l => { const line = JSON.parse(JSON.stringify(l.line)) as RxLine; fn(line); return { ...l, line }; });
  }

  remove(l: ConsultRxLine) { this.lines.update(ls => ls.filter(x => x.key !== l.key)); }
  dropStep(l: ConsultRxLine, k: number) { this.patch(l.key, x => ({ ...x, line: removeStep(x.line, k) })); }
  keep(l: ConsultRxLine) { this.patch(l.key, x => ({ ...x, allergyAck: true, allergyAckNote: 'Kept after review' })); }
  unkeep(l: ConsultRxLine) { this.patch(l.key, x => ({ ...x, allergyAck: false, allergyAckNote: null })); }
  keepPregnancy(l: ConsultRxLine) { this.patch(l.key, x => ({ ...x, pregnancyAck: true, pregnancyAckNote: 'Kept after review' })); }
  unkeepPregnancy(l: ConsultRxLine) { this.patch(l.key, x => ({ ...x, pregnancyAck: false, pregnancyAckNote: null })); }
  swap(l: ConsultRxLine, alt: ConsultDrugRef) {
    const line = newRxLine(alt.id, this.usualOf(alt.id));
    this.patch(l.key, x => ({ ...x, id: undefined, drug: alt, line, allergyAck: false, allergyAckNote: null, pregnancyAck: false, pregnancyAckNote: null }));
    this.notice.emit(`${l.drug.name} swapped for ${alt.name} · ${lineShort(line, alt)}`);
  }

  onType(v: string) {
    this.typed.set(v);
    const name = (parseRx(v, [], () => null)?.name ?? v).trim();
    if (name.length >= 2) this.search.emit(name);
  }
  onAddKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.preview()) this.addParsed();
      else if (this.matches()[0]) this.addDrug(this.matches()[0]);
      else if (this.typed().trim()) this.addFree();
    } else if (e.key === 'Escape') { this.typed.set(''); }
  }
  private push(drug: ConsultDrugRef, line: RxLine) {
    this.lines.update(ls => [...ls, { key: lineKey(), drug, line: { ...line, drugId: drug.id } }]);
    this.typed.set('');
    this.notice.emit(`${drug.name} added · ${lineShort(line, drug)}`);
  }
  addParsed() { const p = this.preview(); if (p) this.push(p.drug, p.line); }
  addDrug(d: ConsultDrugRef) {
    const p = this.parsed();
    this.push(d, p?.drug?.id === d.id && p.line ? p.line : newRxLine(d.id, this.usualOf(d.id)));
  }
  addFree() { const d = freeDrug(this.freeName()); this.push(d, newRxLine(d.id, null)); }

  // ── Popovers ───────────────────────────────────────────────────────
  open(e: Event, l: ConsultRxLine, step: number, field: Field) {
    if (this.readonly() && field !== 'strip') return;
    this.pop.set({ key: l.key, step, field, anchor: e.currentTarget as HTMLElement });
  }

  readonly popTitle = computed(() => {
    const p = this.pop();
    return ({ dose: 'Dose', site: 'Where', when: 'When', dur: 'For', food: 'Food', then: 'Then…', strip: 'Next 14 days' } as Record<Field, string>)[p?.field ?? 'dose'];
  });

  readonly popOptions = computed<RxPopOption[]>(() => {
    const p = this.pop();
    const l = p ? this.lineByKey(p.key) : null;
    if (!p || !l) return [];
    const f = formOf(l.drug);
    switch (p.field) {
      case 'dose': return f.doses.map(n => ({ id: String(n), label: doseShort(l.drug, n), group: 'grid' as const }));
      case 'site': return sitesFor(l.drug).map(s => ({ id: s, label: s }));
      case 'when': return [
        ...TIMING_GRID.map(o => ({ id: o.id, label: o.label, group: 'grid' as const })),
        ...TIMING_MORE.map(o => ({ id: o.id, label: o.label, hint: o.hint })),
      ];
      case 'dur':
        if (l.line.sched.type === 'cycle') return [1, 2, 3, 6].map(n => ({ id: String(n), label: n + (n === 1 ? ' cycle' : ' cycles'), group: 'grid' as const }));
        return (p.step > 0 || l.line.sched.type === 'steps' ? STEP_DURATIONS : DURATIONS).map(n => ({ id: String(n), label: durLabel(n), group: 'grid' as const }));
      case 'food': return [{ id: 'After', label: 'After food' }, { id: 'Before', label: 'Before food' }, { id: '', label: 'Any time' }];
      case 'then': return THEN_PRESETS.map(t => ({ id: t.id, label: t.label }));
      case 'strip': return [];
    }
  });

  readonly popSelected = computed<string | null>(() => {
    const p = this.pop();
    const l = p ? this.lineByKey(p.key) : null;
    if (!p || !l) return null;
    const sg = segsOf(l.line)[p.step] ?? segsOf(l.line)[0];
    switch (p.field) {
      case 'dose': return String(sg.dose);
      case 'site': return l.line.site ?? null;
      case 'when': return timingIdOf(sg.sched);
      case 'dur': return l.line.sched.type === 'cycle' ? String(l.line.sched.cycles || 1) : String(sg.dur);
      case 'food': return l.line.food ?? '';
      default: return null;
    }
  });

  onPop(c: RxPopClose) {
    const p = this.pop();
    this.pop.set(null);
    if (!p) return;
    if (c.kind === 'pick') this.apply(p, c.id);
    if (c.kind === 'tab') this.focusNext(p.anchor, c.back);
    else queueMicrotask(() => p.anchor.isConnected && p.anchor.focus());
  }

  /** Apply a popover pick to the line / its taper step. */
  apply(p: Pick<OpenPop, 'key' | 'step' | 'field'>, id: string) {
    const l = this.lineByKey(p.key);
    if (!l) return;
    if (p.field === 'then') {
      const t = THEN_PRESETS.find(x => x.id === id);
      if (t) this.patch(l.key, x => ({ ...x, line: addThen(x.line, t.step) }));
      return;
    }
    this.setLine(l.key, line => {
      const s = line.sched;
      const inStep = s.type === 'steps' ? s.steps[p.step] ?? s.steps[0] : null;
      switch (p.field) {
        case 'dose': if (inStep && p.step > 0) inStep.dose = +id; else { line.dose = +id; if (inStep) delete inStep.dose; } break;
        case 'site': line.site = id; break;
        case 'food': line.food = id ? (id as RxLine['food']) : undefined; break;
        case 'dur':
          if (s.type === 'cycle') s.cycles = +id;
          else if (inStep) inStep.dur = +id;
          else line.dur = +id;
          break;
        case 'when': {
          const opt = ALL_TIMINGS.find(o => o.id === id);
          if (!opt) break;
          const next = JSON.parse(JSON.stringify(opt.sched)) as RxSchedule;
          if (next.type === 'days' && next.mode === 'weekly') next.wd = [this.start().getDay()];
          if (inStep) inStep.sched = next;
          else if (next.type === 'cycle') { line.sched = next; line.dur = 0; }
          else { line.sched = next; if (!line.dur) line.dur = next.type === 'sos' ? 3 : 5; }
          break;
        }
      }
    });
  }

  /** Tab out of a popover → focus the next / previous value on the screen. */
  private focusNext(anchor: HTMLElement, back: boolean) {
    const all = Array.from((this.host.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.rxv:not(:disabled), .rxe__cal'));
    const i = all.indexOf(anchor as HTMLButtonElement);
    const next = all[i + (back ? -1 : 1)] ?? (back ? null : this.host.nativeElement.querySelector('.rxe__addin'));
    queueMicrotask(() => (next as HTMLElement | null)?.focus());
  }

  /** For hosts: forms that make sense to pick for a free-text drug. */
  readonly formsList = Object.keys(FORMS);
}
