import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, model, output, signal, viewChild,
} from '@angular/core';
import type { OpdPatientAllergy, OpdPregnancy } from '../../shared/opd.models';
import {
  RxLine, RxSchedule, RxUsual, SCHED_DEFAULTS, doseShort, formOf, lineShort, newRxLine, parseRx,
} from '../../shared/rx-schedule';
import {
  ConsultDrugRef, ConsultRxLine, THEN_PRESETS, TIMING_MORE, addThen, allergyHit, freeDrug, lineKey,
  pregnancyHit, removeStep, sitesFor, swapCandidate, timingIdOf,
} from './rx-model';
import {
  RX_DAYS_OPTIONS, RX_FOOD_OPTIONS, RX_PATTERN_OPTIONS, RxTokenOption, applyDays, applyFood, applyPattern, daysEditable, daysId, daysLabel,
  defaultUsual, foodLabel, formName, needsDoseToken, patternId, patternLabel, rxSentence,
} from './rx-line';
import { entryAction, wordStartMatch } from '../pad';

const COMPOSE_KEY = '__compose';

/** A suggestion's usual dose in a few words: "1-1-1 · 5 days · after food". Pure. */
export function doseSummary(line: RxLine, drug: Pick<ConsultDrugRef, 'form'>): string {
  const days = line.sched.type === 'steps' || line.sched.type === 'cycle' ? '' : `${line.dur} day${line.dur === 1 ? '' : 's'}`;
  const food = formOf(drug).food && line.food ? `${line.food.toLowerCase()} food` : '';
  return [patternLabel(line), days, food].filter(Boolean).join(' · ');
}
import { RxPopClose, RxPopOption, RxPopoverComponent } from './rx-popover.component';

/** Duration label in doctor words: 7 → "1 week", 14 → "2 weeks", else "n days". */
export function durLabel(n: number): string {
  if (n >= 7 && n % 7 === 0) return n === 7 ? '1 week' : n / 7 + ' weeks';
  return n === 1 ? '1 day' : n + ' days';
}

type Tok = 'dose' | 'pat' | 'days' | 'food' | 'site';
interface Suggest { kind: 'parsed' | 'drug' | 'free'; drug: ConsultDrugRef; line: RxLine; meta: string; }

/**
 * The prescription (consult v6) — a fast written list. Type a few letters and
 * press Enter: the drug goes in with the doctor's usual (its UsualJson, else
 * their last line, else 1-0-1 · 5 days · after food); focus stays in the bar
 * for the next one. The shorthand still works ("amox 500 1-0-1 5d af").
 * Each line: number, name + strength + form, then three tappable tokens —
 * pattern · days · food (a dose / site token only when the line needs one).
 * Tapping a token opens ONE row of common choices; "More…" on the pattern
 * opens the advanced schedules (every few hours, alternate days, weekly,
 * cycles, "+ then" taper). Under each line, the plain sentence (rxSentence)
 * and the total quantity. Allergy / pregnancy warnings stay inline with their
 * one-tap swap and "Keep, reviewed" acknowledgements. Hosts project the
 * one-tap row (usuals, repeat, diagnosis set) into [rx-quick].
 */
@Component({
  selector: 'pf-rx-editor',
  standalone: true,
  imports: [RxPopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rxe">

      <div class="rxe__list" [class.rxe__list--empty]="!lines().length" [hidden]="!lines().length && !readonly()">
        @for (l of lines(); track l.key; let i = $index) {
          @let hit = hitOf(l);
          @let pregHit = pregHitOf(l);
          @let open = openTok()?.key === l.key ? openTok()!.tok : null;
          @let sn = sentence(l);
          <div class="rl" [class.rl--warn]="(hit && !l.allergyAck) || (pregHit && !l.pregnancyAck)" [class.rl--flash]="flash() === l.key" [attr.data-key]="l.key">
            <span class="rl__no pf-num">{{ i + 1 }}</span>
            <div class="rl__drug">
              <b class="rl__name">{{ l.drug.name }}</b>
              @if (l.drug.strength && !nameHasStrength(l.drug)) { <span class="rl__str">{{ l.drug.strength }}</span> }
              <span class="rl__form">{{ formWord(l.drug) }}</span>
              @if (schedBadge(l.drug); as b) { <span class="rl__sch" [class.rl__sch--h]="b !== 'OTC'">{{ b }}</span> }
              @if (pregnant() && l.drug.pregnancyRisk === 'caution') { <span class="rl__caution" title="Use with caution in pregnancy">Caution in pregnancy</span> }
              @if (l.drug.free) { <span class="rl__free">Not in the drug master · dispensed by name</span> }
            </div>
            <div class="rl__toks">
              @if (showDose(l)) {
                <button type="button" class="tok pf-num" data-tok="dose" [disabled]="readonly()" [attr.aria-expanded]="open === 'dose'" (click)="toggleTok(l, 'dose')" [attr.aria-label]="'Dose ' + doseShort(l.drug, l.line.dose)">{{ doseShort(l.drug, l.line.dose) }}</button>
              }
              @if (sites(l).length) {
                <button type="button" class="tok" data-tok="site" [disabled]="readonly()" [attr.aria-expanded]="open === 'site'" (click)="toggleTok(l, 'site')" aria-label="Where">{{ l.line.site || 'Where?' }}</button>
              }
              <button #patTok type="button" class="tok pf-num" data-tok="pat" [disabled]="readonly()" [attr.aria-expanded]="open === 'pat'" (click)="toggleTok(l, 'pat')" [attr.aria-label]="'When: ' + pattern(l)">{{ pattern(l) }}</button>
              @if (canDays(l)) {
                <button type="button" class="tok pf-num" data-tok="days" [disabled]="readonly()" [attr.aria-expanded]="open === 'days'" (click)="toggleTok(l, 'days')" [attr.aria-label]="'For: ' + days(l)">{{ days(l) }}</button>
              } @else { <span class="tok tok--static pf-num">{{ days(l) }}</span> }
              @if (hasFood(l)) {
                <button type="button" class="tok" data-tok="food" [disabled]="readonly()" [attr.aria-expanded]="open === 'food'" (click)="toggleTok(l, 'food')" [attr.aria-label]="'Food: ' + food(l)">{{ food(l) }}</button>
              }
            </div>
            @if (!readonly()) {
              <button type="button" class="rl__x" (click)="remove(l)" [attr.aria-label]="'Remove ' + l.drug.name">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            } @else { <span></span> }

            @if (open) {
              <div class="rl__opts" role="listbox" [attr.aria-label]="tokTitle(open)" (keydown)="onOptsKey($event, l)">
                @for (o of optionsFor(l, open); track o.id) {
                  <button type="button" class="pf-num" role="option" [attr.aria-pressed]="o.id === selectedFor(l, open)" [attr.aria-selected]="o.id === selectedFor(l, open)"
                          [attr.data-opt]="o.id" (click)="pickOpt(l, open, o.id, $event)">{{ o.label }}</button>
                }
              </div>
            }

            <p class="rl__say" [class.rl__say--empty]="!sn.qty">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>
              <span class="rl__sent">{{ sn.text }}</span>
              @if (sn.qty) { <span class="rl__qty pf-num">{{ sn.qty }}</span> }
            </p>

            @if (hit) {
              @if (!l.allergyAck) {
                <div class="rl__alert" role="alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                  <span class="rl__alert-t"><b>Allergy: {{ hit.allergy.allergen }}</b>@if (hit.allergy.reaction) { — {{ hit.allergy.reaction }}}. {{ hit.reason }}</span>
                  @if (!readonly()) {
                    @if (swapFor(l); as alt) {
                      <button type="button" class="rl__swap" (click)="swap(l, alt)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>
                        Swap to {{ alt.name }}
                      </button>
                    }
                    <button type="button" class="rl__keep" (click)="keep(l)">Keep, reviewed</button>
                  }
                </div>
              } @else {
                <p class="rl__acked">Allergy reviewed — kept on purpose ({{ hit.allergy.allergen }}).
                  @if (!readonly()) { <button type="button" class="rl__undo" (click)="unkeep(l)">Undo</button> }</p>
              }
            }
            @if (pregHit) {
              @if (!l.pregnancyAck) {
                <div class="rl__alert rl__alert--preg" role="alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                  <span class="rl__alert-t"><b>{{ pregHit.risk === 'contraindicated' ? 'Contraindicated in pregnancy' : 'Avoid in pregnancy' }}</b>. {{ pregHit.reason }}</span>
                  @if (!readonly()) {
                    @if (swapFor(l); as alt) {
                      <button type="button" class="rl__swap" (click)="swap(l, alt)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>
                        Swap to {{ alt.name }}
                      </button>
                    }
                    <button type="button" class="rl__keep" (click)="keepPregnancy(l)">Keep, reviewed</button>
                  }
                </div>
              } @else {
                <p class="rl__acked">Pregnancy risk reviewed — kept on purpose ({{ l.drug.name }}).
                  @if (!readonly()) { <button type="button" class="rl__undo" (click)="unkeepPregnancy(l)">Undo</button> }</p>
              }
            }
          </div>
        } @empty {
          @if (readonly()) { <p class="rxe__none">No medicines prescribed.</p> }
        }
      </div>

      @if (!readonly()) {
        @if (compose(); as c) {
          <!-- The one-line dose composer: name + pattern / days / food + Add ↵ + Advanced. -->
          <div class="cmp" (keydown)="onComposeKey($event)" data-composer>
            <div class="cmp__line">
              <b class="cmp__name">{{ c.drug.name }}@if (c.drug.strength && !nameHasStrength(c.drug)) { <span> {{ c.drug.strength }}</span> }</b>
              <span class="cmp__chip-wrap">
                <button type="button" class="cmp__chip pf-num" [class.on]="cOpen() === 'pat'" (click)="cOpen.set(cOpen() === 'pat' ? null : 'pat')" aria-haspopup="listbox" [attr.aria-expanded]="cOpen() === 'pat'">{{ patternOf(c.line) }}<span aria-hidden="true">▾</span></button>
                @if (cOpen() === 'pat') { <span class="cmp__menu" role="listbox" aria-label="When">@for (o of composePatterns; track o.id) { <button type="button" class="pf-num" [attr.aria-pressed]="o.id === patIdOf(c.line)" (click)="composeSet('pat', o.id)">{{ o.label }}</button> }</span> }
              </span>
              @if (daysOk(c.line)) {
                <span class="cmp__chip-wrap">
                  <button type="button" class="cmp__chip pf-num" [class.on]="cOpen() === 'days'" (click)="cOpen.set(cOpen() === 'days' ? null : 'days')" aria-haspopup="listbox" [attr.aria-expanded]="cOpen() === 'days'">{{ daysOf(c) }}<span aria-hidden="true">▾</span></button>
                  @if (cOpen() === 'days') { <span class="cmp__menu" role="listbox" aria-label="For how long">@for (o of daysOpts; track o.id) { <button type="button" class="pf-num" [attr.aria-pressed]="o.id === dayIdOf(c)" (click)="composeSet('days', o.id)">{{ o.label }}</button> }</span> }
                </span>
              }
              @if (foodOk(c.drug)) {
                <span class="cmp__chip-wrap">
                  <button type="button" class="cmp__chip" [class.on]="cOpen() === 'food'" (click)="cOpen.set(cOpen() === 'food' ? null : 'food')" aria-haspopup="listbox" [attr.aria-expanded]="cOpen() === 'food'">{{ foodOf(c.line) }}<span aria-hidden="true">▾</span></button>
                  @if (cOpen() === 'food') { <span class="cmp__menu" role="listbox" aria-label="Food">@for (o of foodOpts; track o.id) { <button type="button" [attr.aria-pressed]="o.id === (c.line.food ?? '')" (click)="composeSet('food', o.id)">{{ o.label }}</button> }</span> }
                </span>
              }
              <button #cAdd type="button" class="pf-btn pf-btn--primary cmp__add" (click)="composeAdd()" data-cadd>Add ↵</button>
              <button #cAdv type="button" class="cmp__link" (click)="openComposeMore(cAdv)">Advanced</button>
              <button type="button" class="rl__x" (click)="cancelCompose()" aria-label="Cancel">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <p class="cmp__say">{{ sentenceOf(c).text }}@if (sentenceOf(c).qty) { · <b class="pf-num">{{ sentenceOf(c).qty }}</b> }</p>
          </div>
        } @else {
          <div class="rxe__bar">
            <label class="rxe__in">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
              <input #addIn type="text" class="rxe__addin" [value]="typed()" (input)="onType(addIn.value)" (keydown)="onAddKey($event)"
                     placeholder="Type a medicine and press Enter…" aria-label="Add a medicine"
                     role="combobox" [attr.aria-expanded]="!!suggest().length" aria-controls="rxe-sug" autocomplete="off" spellcheck="false" />
            </label>
            @if (suggest().length) {
              <div class="rxe__sug" id="rxe-sug" role="listbox" aria-label="Medicines">
                @for (s of suggest(); track s.kind + s.drug.id; let i = $index) {
                  <div class="rxe__sgm" [class.act]="i === active()" (mouseenter)="active.set(i)">
                    <button type="button" class="rxe__sg" role="option" [attr.aria-selected]="i === active()" (mousedown)="$event.preventDefault()" (click)="addSuggestion(s)">
                      @if (s.kind === 'free') { <b>Add “{{ s.drug.name }}” as written</b> }
                      @else { <b>{{ s.drug.name }}@if (s.drug.strength && !nameHasStrength(s.drug)) { {{ ' ' + s.drug.strength }} }</b> }
                      <span class="rxe__sgd pf-num">{{ s.kind === 'parsed' ? sentenceOf({ drug: s.drug, line: s.line }).text : s.meta }}</span>
                      @if (s.kind !== 'free' && hitOfDrug(s.drug)) { <span class="rxe__sgw">Allergy</span> }
                      @else if (s.kind !== 'free' && pregHitOfDrug(s.drug); as ph) { <span class="rxe__sgw">{{ ph.risk === 'contraindicated' ? 'Contraindicated' : 'Avoid — pregnancy' }}</span> }
                    </button>
                    @if (s.kind === 'drug') {
                      <button type="button" class="rxe__chg" (mousedown)="$event.preventDefault()" (click)="startCompose(s)" title="Change the dose before adding (Tab)">Change dose</button>
                    }
                  </div>
                }
                <p class="rxe__hint">Enter adds with this dose · Tab changes it first</p>
              </div>
            }
          </div>
        }
      }

      <ng-content select="[rx-quick]"></ng-content>
    </div>

    @if (more(); as m) {
      <pf-rx-popover [anchor]="m.anchor" [options]="moreOptions()" [selected]="moreSelected()" title="More timings" [minWidth]="280" (closed)="onMore($event)"></pf-rx-popover>
    }
  `,
  styles: [`
    :host { display: block; }
    .rxe { display: flex; flex-direction: column; gap: 8px; }
    .rxe__bar { position: relative; }
    .rxe__sgm { display: flex; align-items: center; gap: 8px; border-radius: 8px; padding-right: 8px; }
    .rxe__sgm.act { background: var(--pf-chip-bg); }
    .rxe__sgm .rxe__sg { flex: 1; background: none !important; }
    .rxe__sgd { font-size: 12.5px; font-weight: 600; color: var(--violet-text, #6d28d9); }
    .rxe__chg { flex: none; height: 28px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--pf-line); background: var(--pf-card-bg);
      font: inherit; font-size: 12px; font-weight: 600; color: var(--text-secondary); cursor: pointer; }
    .rxe__chg:hover { border-color: var(--color-violet-600, #7c3aed); color: var(--text-primary); }
    .rxe__hint { margin: 4px 0 0; padding: 8px 12px 0; border-top: 1px solid var(--pf-line); font-size: 12px; color: var(--text-tertiary); }
    /* The one-line dose composer. */
    .cmp { display: grid; gap: 8px; padding: 8px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--color-primary, #7c3aed) 55%, transparent); background: var(--pf-in-tint); }
    .cmp__line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .cmp__name { font-size: 14.5px; font-weight: 600; margin-right: 4px; }
    .cmp__name span { font-weight: 400; color: var(--text-tertiary); }
    .cmp__chip-wrap { position: relative; }
    .cmp__chip { display: inline-flex; align-items: center; gap: 4px; height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--pf-line); background: var(--pf-card-bg);
      font: inherit; font-size: 14px; font-weight: 600; color: var(--text-primary); cursor: pointer; }
    .cmp__chip span { font-size: 10px; color: var(--text-tertiary); }
    .cmp__chip.on { border-color: var(--color-violet-600, #7c3aed); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 18%, transparent); }
    .cmp__menu { position: absolute; left: 0; top: 40px; z-index: 30; display: flex; flex-wrap: wrap; gap: 8px; width: max-content; max-width: min(420px, 80vw); padding: 8px;
      border-radius: 12px; background: var(--pf-card-bg); border: 1px solid var(--pf-line); box-shadow: 0 16px 36px rgba(15, 23, 42, 0.18); }
    .cmp__menu button { height: 34px; min-width: 48px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--pf-line); background: var(--pf-card-bg);
      font: inherit; font-size: 13.5px; font-weight: 600; color: var(--text-secondary); cursor: pointer; }
    .cmp__menu button[aria-pressed='true'] { color: var(--violet-text, #6d28d9); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 60%, transparent);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .cmp__add { height: 34px; min-height: 34px; margin-left: auto; }
    .cmp__link { border: 0; background: none; padding: 0 4px; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--violet-text, #6d28d9); cursor: pointer; }
    .cmp__say { margin: 0; font-size: 12.5px; color: var(--text-tertiary); }
    .cmp__say b { color: var(--text-secondary); }
    .rxe__in { display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 12px; border-radius: 10px; color: var(--text-tertiary);
      border: 1px dashed color-mix(in srgb, var(--color-primary, #7c3aed) 45%, var(--pf-line)); background: var(--pf-in-tint); }
    .rxe__in:focus-within { border-style: solid; border-color: var(--color-violet-600, #7c3aed); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent); }
    .rxe__addin { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 14px; }
    .rxe__addin::placeholder { color: var(--text-tertiary); }
    .rxe__in kbd { font: inherit; font-size: 11px; color: var(--text-tertiary); border: 1px solid var(--pf-line); border-radius: 6px; padding: 1px 6px; }
    .rxe__sug { position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 20; display: grid; gap: 2px; padding: 6px; max-height: 340px; overflow-y: auto;
      border-radius: 12px; background: var(--pf-card-bg); border: 1px solid var(--pf-line); box-shadow: 0 16px 36px rgba(15, 23, 42, 0.18); }
    :host-context(html.dark) .rxe__sug { box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5); }
    .rxe__sg { display: grid; grid-template-columns: 78px minmax(0, 1fr) auto; gap: 10px; align-items: center; width: 100%; min-height: 44px; padding: 8px 10px;
      border: 0; border-radius: 9px; background: transparent; color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
    .rxe__sg.act { background: var(--pf-chip-bg); }
    .rxe__sgk { justify-self: start; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 7px; border-radius: 6px;
      color: var(--orange-text, #c2410c); background: color-mix(in srgb, #fdba74 18%, transparent); }
    .rxe__sgt { min-width: 0; font-size: 14px; }
    .rxe__sgt b { font-weight: 600; }
    .rxe__sgs { color: var(--text-secondary); }
    .rxe__sgm { display: block; font-size: 12px; color: var(--text-tertiary); line-height: 1.4; }
    .rxe__sge { font-size: 11px; color: var(--text-tertiary); }
    .rxe__sgw { font-size: 11px; font-weight: 600; color: var(--red-text, #dc2626); }

    .rxe__list { border: 1px solid var(--pf-line); border-radius: 12px; overflow: hidden; }
    .rxe__none { margin: 0; padding: 22px; text-align: center; font-size: 13px; color: var(--text-tertiary); }
    .rl { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto 28px; gap: 4px 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--pf-line);
      transition: background-color 600ms ease; }
    .rl:last-child { border-bottom: 0; }
    .rl--flash { background: var(--pf-in-tint); }
    .rl__no { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: var(--violet-text, #6d28d9);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .rl--warn .rl__no { color: var(--red-text, #dc2626); background: color-mix(in srgb, var(--red-text, #dc2626) 12%, transparent); }
    .rl__drug { min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
    .rl__name { font-size: 14.5px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .rl--warn .rl__name { color: var(--red-text, #dc2626); }
    .rl__str { font-size: 13.5px; font-weight: 500; color: var(--text-primary); }
    .rl__form { font-size: 12px; color: var(--text-tertiary); }
    .rl__sch { font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--pf-line); color: var(--text-tertiary); }
    .rl__sch--h { color: var(--red-text, #dc2626); border-color: color-mix(in srgb, var(--red-text, #dc2626) 45%, transparent); }
    .rl__caution { font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 6px; border: 1px solid color-mix(in srgb, #d97706 45%, transparent); color: var(--amber-text, #b45309); }
    .rl__free { flex-basis: 100%; font-size: 12px; color: var(--text-tertiary); }
    .rl__toks { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .tok { height: 32px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--pf-line); background: var(--pf-in-tint); color: var(--text-primary);
      font: inherit; font-size: 13.5px; font-weight: 600; white-space: nowrap; cursor: pointer; }
    .tok:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 55%, transparent); }
    .tok:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .tok[aria-expanded='true'] { background: var(--color-violet-600, #7c3aed); border-color: var(--color-violet-600, #7c3aed); color: #fff; }
    .tok:disabled, .tok--static { cursor: default; background: transparent; display: inline-flex; align-items: center; }
    .rl__x { width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--text-tertiary); display: grid; place-items: center; cursor: pointer; }
    .rl__x:hover { color: var(--red-text, #dc2626); background: color-mix(in srgb, var(--red-text, #dc2626) 10%, transparent); }
    .rl__opts { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 6px; padding-top: 4px; }
    .rl__opts button { height: 34px; min-width: 52px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--pf-line); background: var(--pf-card-bg);
      color: var(--text-secondary); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
    .rl__opts button:hover { color: var(--text-primary); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 45%, transparent); }
    .rl__opts button[aria-pressed='true'] { color: var(--violet-text, #6d28d9); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 60%, transparent);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .rl__opts button:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .rl__say { grid-column: 2 / -1; display: flex; align-items: flex-start; gap: 8px; margin: 2px 0 0; font-size: 13px; line-height: 1.45; color: var(--text-secondary); }
    .rl__say svg { flex: none; margin-top: 3px; color: var(--green-text, #047857); }
    .rl__say--empty svg { color: var(--amber-text, #b45309); }
    .rl__sent { flex: 1; min-width: 0; }
    .rl__qty { flex: none; font-size: 12.5px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
    .rl__alert { grid-column: 2 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-top: 6px; padding: 10px 14px; border-radius: 12px;
      background: color-mix(in srgb, var(--red-text, #dc2626) 8%, var(--pf-card-bg)); border: 1px solid color-mix(in srgb, var(--red-text, #dc2626) 30%, transparent);
      color: var(--text-primary); font-size: 13px; line-height: 1.45; }
    .rl__alert > svg { color: var(--red-text, #dc2626); flex: none; }
    .rl__alert-t { flex: 1 1 260px; min-width: 0; }
    .rl__alert-t b { color: var(--red-text, #dc2626); font-weight: 600; }
    .rl__swap { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--color-violet-600, #7c3aed);
      background: var(--pf-card-bg); color: var(--violet-text, #6d28d9); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .rl__keep { border: 0; background: transparent; padding: 4px 2px; font: inherit; font-size: 13px; font-weight: 600; color: var(--violet-text, #6d28d9); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    .rl__acked { grid-column: 2 / -1; margin: 4px 0 0; font-size: 12.5px; color: var(--text-tertiary); }
    .rl__undo { border: 0; background: transparent; font: inherit; font-size: 12.5px; color: var(--violet-text, #6d28d9); cursor: pointer; }

    /* Phone: one column — the tokens wrap onto a second row under the name. */
    @media (max-width: 600px) {
      .rl { grid-template-columns: 26px minmax(0, 1fr) 30px; row-gap: 8px; }
      .rl__toks { grid-column: 2 / -1; grid-row: 2; justify-content: flex-start; }
      .rl__x { grid-column: 3; grid-row: 1; }
      .rxe__addin { font-size: 16px; }
      .rxe__sg { grid-template-columns: minmax(0, 1fr) auto; }
      .rxe__sgk { grid-column: 1 / -1; }
    }
    @media (pointer: coarse) { .tok { height: 40px; } .rl__opts button { height: 44px; } .rl__x { width: 40px; height: 40px; } }
    @media (prefers-reduced-motion: reduce) { .rl { transition: none; } }
  `],
})
export class RxEditorComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly addIn = viewChild<ElementRef<HTMLInputElement>>('addIn');
  // (the composer's Add button is declared with the composer below)

  readonly lines = model<ConsultRxLine[]>([]);
  readonly drugs = input<ConsultDrugRef[]>([]);
  readonly allergies = input<OpdPatientAllergy[]>([]);
  /** Pregnancy-safety guard (night/safety, critic P0 #1c) — the patient's resolved status. */
  readonly pregnant = input<OpdPregnancy | null>(null);
  readonly readonly = input(false);
  /** Day 0 of the course (the visit day). */
  readonly start = input<Date>(new Date());
  /** The doctor's usual line per drug id (UsualJson / last prescribed). */
  readonly usuals = input<Record<string, RxUsual>>({});
  /** Drugs the doctor already uses for today's diagnosis (swap preference). */
  readonly preferIds = input<string[]>([]);
  /** Ask the host to search the drug master (debounced there). */
  readonly search = output<string>();
  /** A human line for the host's toast (swap / add). */
  readonly notice = output<string>();

  readonly typed = signal('');
  /** Put the cursor in the medicine field on open (the pad's default focus). */
  readonly autofocus = input(true);
  readonly active = signal(0);
  readonly openTok = signal<{ key: string; tok: Tok } | null>(null);
  readonly more = signal<{ key: string; anchor: HTMLElement } | null>(null);
  readonly flash = signal<string | null>(null);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  readonly doseShort = doseShort;

  /** The usual for a drug: the doctor's own, else the default (1-0-1 · 5 days · after food). */
  usualOf(d: ConsultDrugRef): RxUsual { return this.usuals()[d.id] ?? defaultUsual(d); }
  private readonly usualById = (id: string): RxUsual | null => {
    const d = this.drugs().find(x => x.id === id);
    return this.usuals()[id] ?? (d ? defaultUsual(d) : null);
  };

  readonly parsed = computed(() => parseRx(this.typed(), this.drugs(), this.usualById));
  /** Shorthand with an instruction → "as typed" first. */
  readonly preview = computed(() => {
    const p = this.parsed();
    return p && p.drug && p.line && p.any ? { drug: p.drug as ConsultDrugRef, line: p.line } : null;
  });
  readonly matches = computed<ConsultDrugRef[]>(() => {
    const p = this.parsed();
    const q = (p?.name ?? this.typed()).trim().toLowerCase();
    if (!q) return [];
    const on = new Set(this.lines().map(l => l.drug.id));
    const starts = (d: ConsultDrugRef) => d.name.toLowerCase().startsWith(q) ? 0 : 1;
    // Word-start matching ("amo" never matches Paracetamol); never a drug already on the list.
    return this.drugs().filter(d => !on.has(d.id) && wordStartMatch(`${d.name} ${d.generic ?? ''} ${d.aliases ?? ''}`, q))
      .sort((a, b) => starts(a) - starts(b)).slice(0, 6);
  });
  readonly freeName = computed(() => (this.parsed()?.name ?? this.typed()).trim().replace(/\b\w/g, c => c.toUpperCase()));
  /** What Enter / the list offers, in order. */
  readonly suggest = computed<Suggest[]>(() => {
    if (!this.typed().trim()) return [];
    const out: Suggest[] = [];
    const pv = this.preview();
    if (pv) out.push({ kind: 'parsed', drug: pv.drug, line: pv.line, meta: rxSentence({ drug: pv.drug, line: pv.line }, this.start()).text });
    for (const d of this.matches()) {
      if (pv && pv.drug.id === d.id) continue;
      const line = newRxLine(d.id, this.usualOf(d));
      out.push({ kind: 'drug', drug: d, line, meta: doseSummary(line, d) });
    }
    if (!out.length && this.freeName()) {
      const d = freeDrug(this.freeName());
      out.push({ kind: 'free', drug: d, line: newRxLine(d.id, defaultUsual(d)), meta: 'Not in the drug master — the pharmacy dispenses it by name.' });
    }
    return out;
  });

  sites(l: ConsultRxLine) { return sitesFor(l.drug); }
  hasFood(l: ConsultRxLine) { return !!formOf(l.drug).food; }
  showDose(l: ConsultRxLine) { return needsDoseToken(l); }
  canDays(l: ConsultRxLine) { return daysEditable(l.line); }
  pattern(l: ConsultRxLine) { return patternLabel(l.line); }
  days(l: ConsultRxLine) { return daysLabel(l); }
  food(l: ConsultRxLine) { return foodLabel(l.line); }
  formWord(d: ConsultDrugRef) { return formName(d); }
  sentence(l: ConsultRxLine) { return rxSentence(l, this.start()); }
  nameHasStrength(d: ConsultDrugRef) { return !!d.strength && d.name.toLowerCase().includes(String(d.strength).toLowerCase()); }
  hitOf(l: ConsultRxLine) { return allergyHit(l.drug, this.allergies()); }
  hitOfDrug(d: ConsultDrugRef) { return allergyHit(d, this.allergies()); }
  pregHitOf(l: ConsultRxLine) { return pregnancyHit(l.drug, this.pregnant()); }
  pregHitOfDrug(d: ConsultDrugRef) { return pregnancyHit(d, this.pregnant()); }
  swapFor(l: ConsultRxLine) { return swapCandidate(l, this.drugs(), this.allergies(), this.preferIds()); }
  lineByKey(key: string) { return this.lines().find(l => l.key === key) ?? null; }
  schedBadge(d: ConsultDrugRef): string | null {
    if (d.free) return null;
    const s = (d.schedule || 'none').toString();
    return s === 'none' || s === 'G' ? 'OTC' : 'Sch ' + s;
  }
  tokTitle(t: Tok) { return ({ dose: 'Dose', site: 'Where', pat: 'When', days: 'For how long', food: 'Food' } as Record<Tok, string>)[t]; }

  // ── Adding ─────────────────────────────────────────────────────────
  onType(v: string) {
    this.typed.set(v);
    this.active.set(0);
    const name = (parseRx(v, [], () => null)?.name ?? v).trim();
    if (name.length >= 2) this.search.emit(name);
  }
  onBlur() { /* the list closes when the text is cleared; a click keeps focus via mousedown.preventDefault */ }
  onAddKey(e: KeyboardEvent) {
    const n = this.suggest().length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); this.active.set((this.active() + 1) % n); return; }
    if (e.key === 'ArrowUp' && n) { e.preventDefault(); this.active.set((this.active() - 1 + n) % n); return; }
    if (e.key === 'Escape') { this.typed.set(''); return; }
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    const s = this.suggest()[Math.min(this.active(), Math.max(0, n - 1))];
    const act = entryAction(e.key, { hasPick: !!s && s.kind !== 'free', parsed: s?.kind === 'parsed', text: this.typed(), allowFree: s?.kind === 'free', composer: true });
    if (act === 'none') return;
    e.preventDefault();
    if (act === 'compose' && s) this.startCompose(s);
    else if (s) this.addSuggestion(s);
  }
  addSuggestion(s: Suggest) {
    this.push(s.drug, s.line);
    queueMicrotask(() => this.addIn()?.nativeElement?.focus());
  }
  /** Add a drug with the doctor's usual dose (the host's one-tap chips). */
  addDrug(d: ConsultDrugRef) { this.push(d, newRxLine(d.id, this.usualOf(d))); }
  private push(drug: ConsultDrugRef, line: RxLine, notes: string | null = null) {
    const key = lineKey();
    this.lines.update(ls => [...ls, { key, drug, line: { ...line, drugId: drug.id }, ...(notes ? { notes } : {}) }]);
    this.typed.set('');
    this.active.set(0);
    this.notice.emit(`${drug.name} added · ${lineShort(line, drug)}`);
    this.flash.set(key);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 900);
  }

  // ── Editing ────────────────────────────────────────────────────────
  private patch(key: string, f: (l: ConsultRxLine) => ConsultRxLine) {
    this.lines.update(ls => ls.map(l => (l.key === key ? f(l) : l)));
  }
  remove(l: ConsultRxLine) { this.lines.update(ls => ls.filter(x => x.key !== l.key)); if (this.openTok()?.key === l.key) this.openTok.set(null); }
  keep(l: ConsultRxLine) { this.patch(l.key, x => ({ ...x, allergyAck: true, allergyAckNote: 'Kept after review' })); }
  unkeep(l: ConsultRxLine) { this.patch(l.key, x => ({ ...x, allergyAck: false, allergyAckNote: null })); }
  keepPregnancy(l: ConsultRxLine) { this.patch(l.key, x => ({ ...x, pregnancyAck: true, pregnancyAckNote: 'Kept after review' })); }
  unkeepPregnancy(l: ConsultRxLine) { this.patch(l.key, x => ({ ...x, pregnancyAck: false, pregnancyAckNote: null })); }
  swap(l: ConsultRxLine, alt: ConsultDrugRef) {
    const line = newRxLine(alt.id, this.usualOf(alt));
    this.patch(l.key, x => ({ ...x, id: undefined, drug: alt, line, allergyAck: false, allergyAckNote: null, pregnancyAck: false, pregnancyAckNote: null }));
    this.notice.emit(`${l.drug.name} swapped for ${alt.name} · ${lineShort(line, alt)}`);
  }

  // ── Tokens: one row of common choices ──────────────────────────────
  toggleTok(l: ConsultRxLine, tok: Tok) {
    if (this.readonly()) return;
    const cur = this.openTok();
    this.openTok.set(cur && cur.key === l.key && cur.tok === tok ? null : { key: l.key, tok });
    if (this.openTok()) queueMicrotask(() => this.focusOpt(l.key));
  }
  optionsFor(l: ConsultRxLine, tok: Tok): readonly RxTokenOption[] {
    switch (tok) {
      case 'pat': return RX_PATTERN_OPTIONS;
      case 'days': return RX_DAYS_OPTIONS;
      case 'food': return RX_FOOD_OPTIONS;
      case 'dose': return formOf(l.drug).doses.map(n => ({ id: String(n), label: doseShort(l.drug, n) }));
      case 'site': return sitesFor(l.drug).map(s => ({ id: s, label: s }));
    }
  }
  selectedFor(l: ConsultRxLine, tok: Tok): string | null {
    switch (tok) {
      case 'pat': return patternId(l.line);
      case 'days': return daysId(l);
      case 'food': return l.line.food ?? '';
      case 'dose': return String(l.line.dose);
      case 'site': return l.line.site ?? null;
    }
  }
  pickOpt(l: ConsultRxLine, tok: Tok, id: string, e: Event) {
    if (tok === 'pat' && id === 'more') {
      const anchor = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-key="${l.key}"] [data-tok="pat"]`) ?? (e.currentTarget as HTMLElement);
      this.openTok.set(null);
      this.more.set({ key: l.key, anchor });
      return;
    }
    this.patch(l.key, x => {
      switch (tok) {
        case 'pat': return { ...x, line: applyPattern(x.line, id) };
        case 'days': return applyDays(x, id);
        case 'food': return { ...x, line: applyFood(x.line, id) };
        case 'dose': return { ...x, line: { ...x.line, dose: +id } };
        case 'site': return { ...x, line: { ...x.line, site: id } };
      }
    });
    this.openTok.set(null);
    queueMicrotask(() => (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-key="${l.key}"] [data-tok="${tok}"]`)?.focus());
  }
  onOptsKey(e: KeyboardEvent, l: ConsultRxLine) {
    const btns = Array.from((this.host.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(`[data-key="${l.key}"] .rl__opts button`));
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { const t = this.openTok()?.tok; this.openTok.set(null); e.preventDefault(); e.stopPropagation();
      queueMicrotask(() => (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-key="${l.key}"] [data-tok="${t}"]`)?.focus()); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && btns.length) { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && btns.length) { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
  }
  private focusOpt(key: string) {
    const row = (this.host.nativeElement as HTMLElement).querySelector(`[data-key="${key}"] .rl__opts`);
    (row?.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? row?.querySelector<HTMLElement>('button'))?.focus();
  }

  // ── "More…": the advanced schedules (the existing builder) ─────────
  readonly moreOptions = computed<RxPopOption[]>(() => {
    const m = this.more();
    const l = m ? this.lineFor(m.key) : null;
    if (!l) return [];
    const out: RxPopOption[] = [
      { id: 'h6', label: 'Every 6 hours', group: 'grid' }, { id: 'h8', label: 'Every 8 hours', group: 'grid' }, { id: 'h12', label: 'Every 12 hours', group: 'grid' },
      ...[2, 3, 4].map(n => ({ id: 'sos' + n, label: `SOS · up to ${n} a day`, group: 'grid' as const })),
      ...TIMING_MORE.map(o => ({ id: o.id, label: o.label, hint: o.hint })),
    ];
    if (l.line.sched.type !== 'cycle') out.push(...THEN_PRESETS.map(t => ({ id: 'then:' + t.id, label: 'Then: ' + t.label.charAt(0).toLowerCase() + t.label.slice(1) })));
    if (l.line.sched.type === 'steps') out.push({ id: 'drop-last', label: 'Remove the last step', hint: 'taper' });
    return out;
  });
  readonly moreSelected = computed<string | null>(() => {
    const m = this.more();
    const l = m ? this.lineFor(m.key) : null;
    if (!l) return null;
    const s = l.line.sched;
    if (s.type === 'hours' && !s.awake) return 'h' + s.every;
    if (s.type === 'sos') return 'sos' + s.max;
    return timingIdOf(s);
  });
  onMore(c: RxPopClose) {
    const m = this.more();
    this.more.set(null);
    if (!m) return;
    if (c.kind === 'pick') this.applyMore(m.key, c.id);
    queueMicrotask(() => m.anchor.isConnected && m.anchor.focus());
  }
  /** Apply an advanced schedule / taper step to a line (or the composer's). */
  applyMore(key: string, id: string) {
    const l = this.lineFor(key);
    if (!l) return;
    const next = this.moreLine(l.line, id);
    if (!next) return;
    if (key === COMPOSE_KEY) { const c = this.compose(); if (c) this.compose.set({ ...c, line: next }); return; }
    this.patch(key, x => ({ ...x, line: next }));
  }
  /** The line after an advanced pick (null = no change). */
  private moreLine(line: RxLine, id: string): RxLine | null {
    if (id.startsWith('then:')) {
      const t = THEN_PRESETS.find(x => x.id === id.slice(5));
      return t ? addThen(line, t.step) : null;
    }
    if (id === 'drop-last') return line.sched.type === 'steps' ? removeStep(line, line.sched.steps.length - 1) : null;
    let next: RxSchedule | null = null;
    if (/^h\d+$/.test(id)) next = { type: 'hours', every: +id.slice(1), awake: false };
    else if (/^sos\d$/.test(id)) next = { ...SCHED_DEFAULTS.sos, max: +id.slice(3) } as RxSchedule;
    else {
      const o = TIMING_MORE.find(x => x.id === id);
      if (o) next = JSON.parse(JSON.stringify(o.sched)) as RxSchedule;
    }
    if (!next) return null;
    const sched = next;
    if (sched.type === 'days' && sched.mode === 'weekly') sched.wd = [this.start().getDay()];
    const out = JSON.parse(JSON.stringify(line)) as RxLine;
    out.sched = sched;
    if (sched.type === 'cycle') out.dur = 0;
    else if (!out.dur) out.dur = sched.type === 'sos' ? 3 : 5;
    return out;
  }
  private lineFor(key: string): Pick<ConsultRxLine, 'line' | 'drug'> | null {
    return key === COMPOSE_KEY ? this.compose() : this.lineByKey(key);
  }

  // ── The one-line dose composer (Tab / "Change dose") ───────────────
  readonly compose = signal<{ drug: ConsultDrugRef; line: RxLine; notes?: string | null } | null>(null);
  readonly cOpen = signal<'pat' | 'days' | 'food' | null>(null);
  readonly composePatterns = RX_PATTERN_OPTIONS.filter(o => o.id !== 'more' && o.id !== 'sos');
  readonly daysOpts = RX_DAYS_OPTIONS;
  readonly foodOpts = RX_FOOD_OPTIONS;
  private readonly cAdd = viewChild<ElementRef<HTMLButtonElement>>('cAdd');
  patternOf(l: RxLine) { return patternLabel(l); }
  patIdOf(l: RxLine) { return patternId(l); }
  daysOf(c: { line: RxLine; notes?: string | null }) { return daysLabel({ line: c.line, notes: c.notes }); }
  dayIdOf(c: { line: RxLine; notes?: string | null }) { return daysId({ line: c.line, notes: c.notes }); }
  daysOk(l: RxLine) { return daysEditable(l); }
  foodOf(l: RxLine) { return foodLabel(l); }
  foodOk(d: ConsultDrugRef) { return !!formOf(d).food; }
  sentenceOf(c: { drug: ConsultDrugRef; line: RxLine; notes?: string | null }) { return rxSentence({ drug: c.drug, line: c.line, notes: c.notes }, this.start()); }
  startCompose(s: Suggest) {
    if (s.kind === 'free') return;
    this.compose.set({ drug: s.drug, line: JSON.parse(JSON.stringify(s.line)) as RxLine });
    this.cOpen.set(null);
    queueMicrotask(() => this.cAdd()?.nativeElement.focus());
  }
  composeSet(field: 'pat' | 'days' | 'food', id: string) {
    const c = this.compose();
    if (!c) return;
    if (field === 'pat') this.compose.set({ ...c, line: applyPattern(c.line, id) });
    else if (field === 'food') this.compose.set({ ...c, line: applyFood(c.line, id) });
    else { const d = applyDays({ key: COMPOSE_KEY, drug: c.drug, line: c.line, notes: c.notes }, id); this.compose.set({ ...c, line: d.line, notes: d.notes }); }
    this.cOpen.set(null);
    queueMicrotask(() => this.cAdd()?.nativeElement.focus());
  }
  composeAdd() {
    const c = this.compose();
    if (!c) return;
    this.compose.set(null);
    this.push(c.drug, c.line, c.notes ?? null);
    this.focusEntry();
  }
  cancelCompose() { this.compose.set(null); this.cOpen.set(null); this.focusEntry(); }
  onComposeKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); if (this.cOpen()) this.cOpen.set(null); else this.cancelCompose(); return; }
    if (e.key === 'Enter' && !this.cOpen()) { e.preventDefault(); this.composeAdd(); }
  }
  openComposeMore(anchor: HTMLElement) { this.cOpen.set(null); this.more.set({ key: COMPOSE_KEY, anchor }); }
  /** Put the cursor back in the medicine field (the pad's default focus). */
  focusEntry() { queueMicrotask(() => this.addIn()?.nativeElement?.focus()); }
  ngAfterViewInit() { if (!this.readonly() && this.autofocus()) this.focusEntry(); }
}
