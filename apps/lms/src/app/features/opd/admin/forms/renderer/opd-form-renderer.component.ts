import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { PfDateComponent } from '../../../../../shared/components/pf-date/pf-date.component';
import { PfSelectOption, SelectComponent } from '../../../../../shared/primitives/select.component';
import { AuthedMediaDirective } from '../../../shared/authed-media.directive';
import {
  OpdAnswers, OpdMark, OpdMediaRef, OpdQuestion, OpdSided, Side, YES_NO, allQuestions, computeCalc, conditionMet, isWide,
  normalizeQuestion, normalizeSchema, printRows, typeName,
} from '../form-schema';
import type { BuilderAction } from '../form-builder-ops';

/** How the renderer draws a form. */
export type OpdFormRenderMode = 'edit' | 'readonly' | 'print' | 'design';

/** Ask the host to capture / upload a file for a media question. */
export interface OpdMediaRequest { key: string; side?: Side; }

/** Outline paths for body-diagram questions (0–100 viewBox). */
const SHAPES: Record<string, string[]> = {
  ear: ['M50 8a42 42 0 1 0 0 84a42 42 0 1 0 0-84Z', 'M50 16a34 34 0 1 0 0 68a34 34 0 1 0 0-68Z', 'M58 16 50 50', 'M52 55 69 80 60 84Z'],
  nose: ['M47 10C30 12 12 36 12 60c0 16 10 28 26 28h9M53 10c17 2 35 26 35 50 0 16-10 28-26 28h-9', 'M50 10v78',
    'M20 44c7-6 16-6 24 0M20 62c7-6 16-6 24 0M56 44c8-6 17-6 24 0M56 62c8-6 17-6 24 0'],
  body: ['M50 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16Z', 'M39 23h22l3 32h-5l-1 37h-7l-1-27-1 27h-7l-1-37h-5z', 'M39 24 27 52M61 24l12 28'],
};

/**
 * `<pf-opd-form-renderer>` — ONE renderer for an OPD consult form (schema v2):
 * the doctor's consult (mode `edit`), a past consult (`readonly`), the printed
 * summary (`print`) and the form builder's canvas (`design` — the same blocks
 * with selection, the question toolbar and "+" insert handles). Agent C
 * imports it from `features/opd/admin/forms/renderer` (see index.ts).
 *
 * Controlled: pass `answers`, listen to `answersChange` and feed the new
 * object back. Conditional questions ("show only when") hide in edit /
 * readonly / print and show dimmed with their rule in design. Built-in consult
 * sections (vitals, diagnosis, Rx, …) are never rendered here.
 *
 * Media questions never upload by themselves: `mediaRequest` asks the host to
 * capture / upload (any image or video format) and the host adds
 * `OpdMediaRef`s to the answer.
 */
@Component({
  selector: 'pf-opd-form-renderer',
  standalone: true,
  imports: [NgTemplateOutlet, PfDateComponent, SelectComponent, AuthedMediaDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mode() === 'print') {
      <div class="ofr-print">
        @if (rows().length) {
          <table class="ofr-pt">
            @for (r of rows(); track r.key) {
              <tr>
                <th scope="row">{{ r.label }}</th>
                <td>
                  @if (r.table) {
                    <table class="ofr-pt__t">
                      <tr><th>{{ r.table.unit || '' }}</th>@for (c of r.table.cols; track $index) { <th>{{ c }}</th> }</tr>
                      @for (row of r.table.rows; track $index; let ri = $index) {
                        <tr><th>{{ row }}</th>@for (c of r.table.cols; track $index; let ci = $index) { <td class="pf-num">{{ r.table.cells[ri][ci] || '—' }}</td> }</tr>
                      }
                    </table>
                  } @else if (r.sides) {
                    @if (r.sides.r || r.sides.l) { <b>R</b> {{ r.sides.r || '—' }} &nbsp;·&nbsp; <b>L</b> {{ r.sides.l || '—' }} } @else { <span class="ofr-pt__blank"></span> }
                  } @else if (r.text) { {{ r.text }} } @else { <span class="ofr-pt__blank"></span> }
                </td>
              </tr>
            }
          </table>
        } @else {
          <p class="ofr-pt__none">Nothing on this form is set to print.</p>
        }
      </div>
    } @else {
      <div class="ofr" [class.ofr--phone]="layout() === 'phone'" [class.ofr--design]="design()">
        @for (group of sectionGroups(); track group.key) {
          @if (showSectionHeads() && group.items.length) {
            <button type="button" class="ofr-sec-head" [attr.aria-expanded]="!isCollapsed(group.key)" (click)="toggleSection(group.key)">
              <svg class="ofr-sec-head__c" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
              {{ group.title }}
            </button>
          }
          @if (!showSectionHeads() || !isCollapsed(group.key)) {
          @for (q of group.items; track q.key; let i = $index) {
          <div class="ofr-q" [class.ofr-q--wide]="wide(q)" [class.is-sel]="design() && selectedKey() === q.key"
               [class.is-cond]="!met(q)" [class.is-addon]="addonKeys().has(q.key)"
               [attr.data-q]="q.key" [attr.data-type]="q.sides ? 'lr' : q.type"
               [attr.tabindex]="design() ? 0 : null" [attr.role]="design() ? 'group' : null"
               [attr.aria-label]="design() ? q.label + ' — ' + typeName(q) + (selectedKey() === q.key ? ', selected' : '. Press Enter to edit') : null"
               (click)="design() && questionSelect.emit(q.key)" (keydown.enter)="design() && questionSelect.emit(q.key)">
            <div class="ofr-q__lbl">
              <span class="ofr-q__q" [attr.id]="'ofr-' + q.key">{{ q.label }}@if (q.required) {<span class="ofr-q__req" title="Required" aria-label="required">*</span>}</span>
              @if (q.when && design()) {
                <span class="ofr-tag" [class.ofr-tag--off]="!met(q)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4v9a4 4 0 0 0 4 4h12M16 13l4 4-4 4"/></svg>
                  {{ met(q) ? 'Shows when' : 'Hidden until' }} “{{ srcLabel(q) }}” is {{ q.when.value }}
                </span>
              }
              @if (design() && q.print === false) {
                <span class="ofr-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg>Not printed</span>
              }
              @if (addonKeys().has(q.key)) { <span class="ofr-tag">Doctor's own</span> }
              @if (hints()[q.key]; as h) {
                <button type="button" class="ofr-last" [disabled]="!live()" (click)="hintPick.emit(q.key)" [attr.aria-label]="'Copy last: ' + h" title="Tap to copy">Last: {{ h }}</button>
              }
            </div>
            <div class="ofr-q__body">
              @if (q.sides) {
                <div class="ofr-lr">
                  @for (sd of sidesList; track sd) {
                    <div class="ofr-side"><span class="ofr-side__k">{{ sd === 'r' ? 'Right' : 'Left' }}</span>
                      <ng-container [ngTemplateOutlet]="ctl" [ngTemplateOutletContext]="{ q: q, v: sideVal(q, sd), side: sd }"></ng-container>
                    </div>
                  }
                </div>
              } @else {
                <ng-container [ngTemplateOutlet]="ctl" [ngTemplateOutletContext]="{ q: q, v: answers()[q.key], side: null }"></ng-container>
              }
            </div>
            @if (design()) {
              <button class="ofr-ins" type="button" tabindex="-1" (click)="$event.stopPropagation(); insertAt.emit(i)"
                      [attr.aria-label]="'Insert a question above ' + q.label">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              </button>
              @if (selectedKey() === q.key) {
                <div class="ofr-bar" role="toolbar" aria-label="Question tools" (click)="$event.stopPropagation()">
                  <button type="button" (click)="action.emit({ key: q.key, action: 'up' })" [disabled]="i === 0" aria-label="Move up" title="Move up"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg></button>
                  <button type="button" (click)="action.emit({ key: q.key, action: 'down' })" [disabled]="i === group.items.length - 1" aria-label="Move down" title="Move down"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
                  <button type="button" (click)="action.emit({ key: q.key, action: 'dup' })" aria-label="Duplicate" title="Duplicate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                  <span class="ofr-bar__sep" aria-hidden="true"></span>
                  <button type="button" class="ofr-bar__req" [attr.aria-pressed]="!!q.required" (click)="action.emit({ key: q.key, action: 'req' })">Required</button>
                  <span class="ofr-bar__sep" aria-hidden="true"></span>
                  <button type="button" class="ofr-bar__del" (click)="action.emit({ key: q.key, action: 'del' })" aria-label="Delete question" title="Delete question"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                </div>
              }
            }
          </div>
          }
          }
        }
      </div>
    }

    <ng-template #ctl let-q="q" let-v="v" let-side="side">
      @switch (q.type) {
        @case ('short') {
          <input class="pf-input" [value]="v ?? ''" placeholder="Type here" [readOnly]="!live()" [attr.tabindex]="design() ? -1 : null"
                 [attr.aria-label]="aria(q, side)" (input)="set(q, side, $any($event.target).value)">
        }
        @case ('long') {
          <textarea class="pf-input ofr-ta" rows="3" placeholder="Type here" [readOnly]="!live()" [attr.tabindex]="design() ? -1 : null"
                    [attr.aria-label]="aria(q, side)" [value]="v ?? ''" (input)="set(q, side, $any($event.target).value)"></textarea>
        }
        @case ('num') {
          <span class="ofr-unit"><input class="pf-input pf-num" inputmode="decimal" [value]="v ?? ''" placeholder="—" [readOnly]="!live()"
                 [attr.tabindex]="design() ? -1 : null" [attr.aria-label]="aria(q, side)" (input)="set(q, side, $any($event.target).value)">
            @if (q.unit) { <span class="ofr-unit__u">{{ q.unit }}</span> }</span>
        }
        @case ('date') {
          @if (live()) { <pf-date [value]="v ?? null" [label]="aria(q, side)" (valueChange)="set(q, side, $event)"></pf-date> }
          @else { <span class="pf-input ofr-static pf-num">{{ v ? dateText(v) : 'Pick a date' }}</span> }
        }
        @case ('yn') {
          <span class="pf-seg ofr-seg" role="group" [attr.aria-label]="aria(q, side)">
            @for (o of yn; track o) {
              <button type="button" class="pf-seg__item" [attr.aria-pressed]="v === o" [disabled]="!live() && !design()" [attr.tabindex]="design() ? -1 : null"
                      (click)="live() && set(q, side, v === o ? null : o)">{{ o }}</button>
            }
          </span>
        }
        @case ('one') {
          @if ((q.choices?.length ?? 0) > 5) {
            @if (live()) {
              <pf-select [options]="opts(q)" [value]="v ?? ''" [searchable]="(q.choices?.length ?? 0) > 8" placeholder="Choose…" (valueChange)="set(q, side, $event || null)"></pf-select>
            } @else { <span class="pf-input ofr-static">{{ v || 'Choose…' }}</span> }
          } @else {
            <span class="ofr-chips" role="group" [attr.aria-label]="aria(q, side)">
              @for (o of q.choices ?? []; track o) {
                <button type="button" class="pf-chip ofr-chip" [attr.aria-pressed]="v === o" [disabled]="!live() && !design()" [attr.tabindex]="design() ? -1 : null"
                        (click)="live() && set(q, side, v === o ? null : o)">{{ o }}</button>
              }
            </span>
          }
        }
        @case ('many') {
          <span class="ofr-chips" role="group" [attr.aria-label]="aria(q, side)">
            @for (o of q.choices ?? []; track o) {
              <button type="button" class="pf-chip ofr-chip" [attr.aria-pressed]="has(v, o)" [disabled]="!live() && !design()" [attr.tabindex]="design() ? -1 : null"
                      (click)="live() && set(q, side, toggle(v, o))">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  @if (has(v, o)) { <path d="M20 6 9 17l-5-5"/> } @else { <path d="M12 5v14M5 12h14"/> }
                </svg>{{ o }}</button>
            }
          </span>
        }
        @case ('scale') {
          <span class="ofr-scale" role="group" [attr.aria-label]="aria(q, side)">
            @for (k of steps(q); track k) {
              <button type="button" class="pf-num" [attr.aria-pressed]="v === k" [disabled]="!live() && !design()" [attr.tabindex]="design() ? -1 : null"
                      (click)="live() && set(q, side, v === k ? null : k)">{{ k }}</button>
            }
          </span>
        }
        @case ('media') {
          <span class="ofr-media">
            @for (m of mediaOf(v); track $index) {
              <span class="ofr-shot">
                @if (m.url && m.kind === 'image') { <img [pfAuthedSrc]="m.url" [alt]="m.name"> }
                @else if (m.url && m.kind === 'video') { <video [pfAuthedSrc]="m.url" muted playsinline preload="metadata"></video> }
                <span class="ofr-shot__n">{{ m.name }}</span>
                @if (live()) {
                  <button type="button" class="ofr-shot__x" (click)="set(q, side, removeAt(v, $index))" [attr.aria-label]="'Remove ' + m.name">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                }
              </span>
            }
            @if (live() || design()) {
              <button type="button" class="ofr-shot ofr-shot--add" [attr.tabindex]="design() ? -1 : null"
                      (click)="live() && mediaRequest.emit({ key: q.key, side: side ?? undefined })">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                Capture or upload
              </button>
            } @else if (!mediaOf(v).length) { <span class="ofr-muted">No files</span> }
          </span>
        }
        @case ('diagram') {
          <span class="ofr-dia">
            <svg class="ofr-dia__svg" viewBox="0 0 100 100" role="img" [attr.aria-label]="aria(q, side) + ' — ' + marksOf(v).length + ' marked'"
                 [class.is-live]="live()" (click)="live() && mark(q, side, v, $event)">
              @for (d of shape(q); track $index) { <path [attr.d]="d" class="ofr-dia__o"/> }
              @for (p of marksOf(v); track $index) {
                <g class="ofr-dia__m"><circle [attr.cx]="p.x" [attr.cy]="p.y" r="6"/><text [attr.x]="p.x" [attr.y]="p.y + 2.4">{{ $index + 1 }}</text></g>
              }
            </svg>
            <span class="ofr-dia__k">
              @for (p of marksOf(v); track $index) {
                <span class="ofr-dia__row"><b class="pf-num">{{ $index + 1 }}</b>
                  @if (live()) {
                    <input class="pf-input ofr-dia__in" [value]="p.note" placeholder="What is here?" [attr.aria-label]="'Note for mark ' + ($index + 1)"
                           (input)="set(q, side, noteAt(v, $index, $any($event.target).value))">
                    <button type="button" class="ofr-shot__x" (click)="set(q, side, removeAt(v, $index))" [attr.aria-label]="'Remove mark ' + ($index + 1)">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  } @else { <span>{{ p.note || 'Marked' }}</span> }
                </span>
              } @empty { <span class="ofr-muted">{{ live() ? 'Tap the outline to mark a spot' : 'Nothing marked' }}</span> }
            </span>
          </span>
        }
        @case ('table') {
          <span class="ofr-tab"><table>
            <thead><tr><th>{{ q.unit || '' }}</th>@for (c of q.cols ?? []; track $index) { <th class="pf-num">{{ c }}</th> }</tr></thead>
            <tbody>
              @for (r of q.rows ?? []; track $index; let ri = $index) {
                <tr><th>{{ r }}</th>
                  @for (c of q.cols ?? []; track $index; let ci = $index) {
                    <td><input class="ofr-tab__in pf-num" [value]="cell(v, ri, ci)" [readOnly]="!live()" [attr.tabindex]="design() ? -1 : null"
                               [attr.aria-label]="r + ' ' + c" (input)="set(q, side, setCell(q, v, ri, ci, $any($event.target).value))"></td>
                  }
                </tr>
              }
            </tbody>
          </table></span>
        }
        @case ('calc') {
          <span class="pf-input ofr-static pf-num ofr-calc" [attr.aria-label]="aria(q, side) + ', calculated'">{{ calcValue(q) || '—' }}</span>
        }
      }
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .ofr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
    .ofr--phone { grid-template-columns: minmax(0, 1fr); }
    @media (max-width: 720px) { .ofr { grid-template-columns: minmax(0, 1fr); } }
    .ofr-sec-head { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; padding: 4px 2px 0; margin: 0; border: 0; background: transparent; cursor: pointer;
      font: inherit; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .ofr-sec-head:not(:first-child) { margin-top: 6px; padding-top: 16px; border-top: 1px solid var(--pf-line); }
    .ofr-sec-head:hover { color: var(--text-secondary); }
    .ofr-sec-head__c { flex: none; transition: transform var(--pf-dur-fast, 120ms) ease; }
    .ofr-sec-head[aria-expanded='true'] .ofr-sec-head__c { transform: rotate(90deg); }
    @media (prefers-reduced-motion: reduce) { .ofr-sec-head__c { transition: none; } }
    .ofr-q { position: relative; display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 10px 12px; border-radius: var(--pf-radius, 12px); border: 1px solid transparent; }
    .ofr-q--wide { grid-column: 1 / -1; }
    .ofr--design .ofr-q { cursor: pointer; transition: border-color var(--pf-dur-fast, 120ms) ease, background var(--pf-dur-fast, 120ms) ease; }
    .ofr--design .ofr-q:hover { border-color: var(--pf-line); background: color-mix(in srgb, var(--text-primary) 2%, transparent); }
    .ofr--design .ofr-q:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .ofr-q.is-sel { border-color: var(--color-violet-600, #7c3aed); background: color-mix(in srgb, var(--color-primary, #7c3aed) 5%, transparent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .ofr-q.is-cond { opacity: .62; }
    .ofr-q.is-addon { border-style: dashed; border-color: var(--pf-line); }
    .ofr-q__lbl { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
    .ofr-q__q { font-size: 13px; font-weight: 600; color: var(--text-primary); line-height: 1.4; }
    .ofr-last { margin-left: auto; height: 22px; padding: 0 8px; border-radius: 999px; border: 1px dashed var(--pf-line); background: none; font: inherit; font-size: 11.5px;
      color: var(--text-tertiary); white-space: nowrap; cursor: pointer; font-variant-numeric: tabular-nums; }
    .ofr-last:hover:not(:disabled) { color: var(--violet-text, #6d28d9); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 50%, var(--pf-line)); }
    .ofr-last:disabled { cursor: default; }
    .ofr-q__req { color: var(--red-text, #dc2626); margin-left: 2px; }
    .ofr-tag { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 500;
      color: var(--text-secondary); background: var(--pf-chip-bg); border: 1px solid var(--pf-line); }
    .ofr-tag--off { color: var(--text-tertiary); }
    .ofr-q__body { min-width: 0; }
    .ofr-lr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .ofr--phone .ofr-lr { grid-template-columns: minmax(0, 1fr); }
    @media (max-width: 720px) { .ofr-lr { grid-template-columns: minmax(0, 1fr); } }
    .ofr-side { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 10px; border-radius: var(--pf-radius-sm, 10px); background: color-mix(in srgb, var(--text-primary) 3%, transparent); border: 1px solid var(--pf-line); }
    .ofr-side__k { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--violet-text, #6d28d9); }
    .ofr-ta { resize: vertical; min-height: 72px; font: inherit; }
    .ofr-static { display: flex; align-items: center; color: var(--text-secondary); }
    .ofr-unit { display: flex; align-items: center; gap: 8px; max-width: 220px; }
    .ofr-unit__u { font-size: 12.5px; color: var(--text-secondary); white-space: nowrap; }
    .ofr-seg { flex-wrap: wrap; }
    .ofr-seg .pf-seg__item { height: 36px; }
    .ofr-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .ofr-chip { height: 36px; padding: 0 12px; font-size: 12.5px; }
    .ofr-chip[aria-pressed='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); color: var(--text-primary); font-weight: 600; }
    .ofr-chip:disabled, .ofr-seg .pf-seg__item:disabled, .ofr-scale button:disabled { cursor: default; opacity: 1; }
    .ofr--design .ofr-chip, .ofr--design .pf-seg__item, .ofr--design .ofr-scale button { pointer-events: none; }
    .ofr-scale { display: flex; flex-wrap: wrap; gap: 6px; }
    .ofr-scale button { min-width: 40px; height: 40px; border-radius: 10px; border: 1px solid var(--pf-line); background: var(--pf-card-bg); color: var(--text-primary); font: inherit; font-size: 13px; cursor: pointer; }
    .ofr-scale button[aria-pressed='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); font-weight: 700; }
    .ofr-media { display: flex; flex-wrap: wrap; gap: 8px; }
    .ofr-shot { position: relative; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 112px; height: 84px;
      border-radius: 10px; border: 1px solid var(--pf-line); background: color-mix(in srgb, var(--text-primary) 5%, var(--pf-card-bg)); overflow: hidden; font-size: 11px; color: var(--text-secondary); }
    .ofr-shot img, .ofr-shot video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .ofr-shot__n { position: relative; padding: 0 6px; text-align: center; }
    .ofr-shot--add { border-style: dashed; cursor: pointer; font: inherit; font-size: 11.5px; color: var(--violet-text, #6d28d9); }
    .ofr-shot__x { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--pf-line);
      background: var(--pf-card-bg); color: var(--text-tertiary); cursor: pointer; flex: none; }
    .ofr-shot .ofr-shot__x { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; }
    .ofr-dia { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
    .ofr-dia__svg { width: 150px; height: 150px; flex: none; border-radius: 12px; background: color-mix(in srgb, var(--text-primary) 3%, transparent); border: 1px solid var(--pf-line); }
    .ofr-dia__svg.is-live { cursor: crosshair; }
    .ofr-dia__o { fill: none; stroke: var(--text-tertiary); stroke-width: 1.4; }
    .ofr-dia__m circle { fill: var(--color-violet-600, #7c3aed); }
    .ofr-dia__m text { fill: #fff; font-size: 7px; font-weight: 700; text-anchor: middle; }
    .ofr-dia__k { display: flex; flex-direction: column; gap: 6px; min-width: 160px; flex: 1 1 180px; font-size: 12.5px; color: var(--text-secondary); }
    .ofr-dia__row { display: flex; align-items: center; gap: 8px; }
    .ofr-dia__row b { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 999px; background: var(--color-violet-600, #7c3aed); color: #fff; font-size: 11px; flex: none; }
    .ofr-dia__in { min-height: 36px; }
    .ofr-tab { display: block; max-width: 100%; overflow-x: auto; }
    .ofr-tab table { border-collapse: collapse; font-size: 12.5px; }
    .ofr-tab th { padding: 4px 8px; font-weight: 600; color: var(--text-secondary); text-align: center; white-space: nowrap; }
    .ofr-tab tbody th { text-align: left; }
    .ofr-tab td { padding: 2px; }
    .ofr-tab__in { width: 56px; height: 36px; text-align: center; border-radius: 8px; border: 1px solid var(--pf-line); background: var(--pf-card-bg); color: var(--text-primary); font: inherit; font-size: 13px; }
    .ofr-muted { font-size: 12.5px; color: var(--text-tertiary); }
    .ofr-ins { position: absolute; left: 50%; top: -10px; transform: translateX(-50%); display: none; align-items: center; justify-content: center; width: 22px; height: 22px;
      border-radius: 999px; border: 1px solid var(--pf-sel-border); background: var(--pf-card-bg); color: var(--violet-text, #6d28d9); cursor: pointer; z-index: 2; }
    .ofr--design .ofr-q:hover .ofr-ins, .ofr--design .ofr-q.is-sel .ofr-ins { display: inline-flex; }
    .ofr-bar { position: absolute; right: 8px; top: -18px; display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 10px; z-index: 3;
      background: var(--pf-card-bg); border: 1px solid var(--pf-line); box-shadow: 0 6px 18px rgba(15, 23, 42, .12); }
    .ofr-bar button { display: inline-flex; align-items: center; gap: 4px; height: 30px; min-width: 30px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
    .ofr-bar button:hover:not(:disabled) { background: var(--pf-chip-bg); color: var(--text-primary); }
    .ofr-bar button:disabled { opacity: .4; cursor: default; }
    .ofr-bar__req[aria-pressed='true'] { color: var(--violet-text, #6d28d9); font-weight: 600; }
    .ofr-bar__del:hover { color: var(--red-text, #dc2626) !important; }
    .ofr-bar__sep { width: 1px; height: 18px; background: var(--pf-line); }
    /* Print */
    .ofr-pt { width: 100%; border-collapse: collapse; font-size: 12px; }
    .ofr-pt > tr > th, .ofr-pt > tbody > tr > th { width: 34%; padding: 5px 10px 5px 0; text-align: left; font-weight: 600; color: var(--text-secondary); vertical-align: top; }
    .ofr-pt > tr > td, .ofr-pt > tbody > tr > td { padding: 5px 0; color: var(--text-primary); border-bottom: 1px solid var(--pf-line); }
    .ofr-pt__t { border-collapse: collapse; font-size: 11px; }
    .ofr-pt__t th, .ofr-pt__t td { padding: 2px 6px; border: 1px solid var(--pf-line); text-align: center; }
    .ofr-pt__blank { display: inline-block; width: 140px; border-bottom: 1px dotted var(--text-tertiary); }
    .ofr-pt__none { margin: 0; font-size: 12px; color: var(--text-tertiary); }
    @media (max-width: 640px) { .pf-input, .ofr-tab__in { font-size: 16px; } }
    @media (prefers-reduced-motion: reduce) { .ofr-q { transition: none !important; } }
  `],
})
export class OpdFormRendererComponent {
  /** The form: a schema v2 doc (or a foundation v1 schema — normalised). */
  readonly schema = input<unknown>(null);
  /** Answers keyed by question key (left & right = `{ r, l }`). */
  readonly answers = input<OpdAnswers>({});
  readonly mode = input<OpdFormRenderMode>('edit');
  /** A doctor's add-only questions, appended after the form's. */
  readonly addons = input<unknown[] | null>(null);
  /** `phone` = one column. */
  readonly layout = input<'screen' | 'phone'>('screen');
  /** design: the selected question. */
  readonly selectedKey = input<string | null>(null);
  /** design: also show questions whose condition isn't met (dimmed). Default true in design. */
  readonly showHidden = input<boolean | null>(null);
  /** print: also print unanswered questions as blank lines (an empty form). */
  readonly printBlanks = input<boolean>(false);
  /** The anchor "today" for a `calc` pog field (the visit date); defaults to today. */
  readonly visitDate = input<string | null>(null);
  /** OPD consult: short controls (yes/no, a pick of ≤5, a scale) sit two to a row. Default off. */
  readonly compact = input(false);

  readonly answersChange = output<OpdAnswers>();
  /** A muted "Last: …" chip per question (the previous session's value); empty = none. */
  readonly hints = input<Record<string, string>>({});
  /** A "Last: …" chip was tapped (the host copies that value in). */
  readonly hintPick = output<string>();
  readonly mediaRequest = output<OpdMediaRequest>();
  /** design: a question was clicked. */
  readonly questionSelect = output<string>();
  /** design: a toolbar action on the selected question. */
  readonly action = output<{ key: string; action: BuilderAction }>();
  /** design: "+" above question `index`. */
  readonly insertAt = output<number>();

  readonly yn = YES_NO;
  readonly sidesList: ('r' | 'l')[] = ['r', 'l'];
  protected readonly typeName = typeName;

  readonly doc = computed(() => normalizeSchema(this.schema()));
  readonly addonList = computed(() => (this.addons() ?? []).map(normalizeQuestion).filter((q): q is OpdQuestion => !!q));
  readonly addonKeys = computed(() => new Set(this.addonList().map((q) => q.key)));
  readonly list = computed(() => [...allQuestions(this.doc()), ...this.addonList()]);
  readonly byKey = computed(() => new Map(this.list().map((q) => [q.key, q] as const)));
  readonly design = computed(() => this.mode() === 'design');
  readonly live = computed(() => this.mode() === 'edit');
  readonly shown = computed(() => {
    const all = this.list();
    const showAll = this.showHidden() ?? this.design();
    return showAll ? all : all.filter((q) => conditionMet(q, this.byKey(), this.answers()));
  });
  readonly rows = computed(() => printRows(this.list(), this.answers(), this.printBlanks()));

  /** Questions grouped by their section (a trailing "Doctor's own" group for
   *  addons, when there are any), each already filtered the way `shown()` is.
   *  Design mode is always fed a ONE-section doc per instance (the builder
   *  edits each section in its own renderer), so headers stay off there —
   *  they only show for the real, multi-section consult screens. */
  readonly sectionGroups = computed(() => {
    const d = this.doc();
    const showAll = this.showHidden() ?? this.design();
    const bk = this.byKey();
    const answers = this.answers();
    const vis = (q: OpdQuestion) => showAll || conditionMet(q, bk, answers);
    const groups = d.sections.map((s) => ({ key: s.key, title: s.title, items: s.fields.filter(vis) }));
    const addons = this.addonList().filter(vis);
    if (addons.length) groups.push({ key: '__addons', title: "Doctor's own", items: addons });
    return groups;
  });
  readonly showSectionHeads = computed(() => this.sectionGroups().length > 1);
  private readonly collapsedSections = signal<ReadonlySet<string>>(new Set());
  isCollapsed(key: string): boolean { return this.collapsedSections().has(key); }
  toggleSection(key: string): void {
    this.collapsedSections.update((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  met(q: OpdQuestion): boolean { return conditionMet(q, this.byKey(), this.answers()); }
  wide(q: OpdQuestion): boolean {
    // Compact (OPD consult): short pick / scale controls share the 2-column
    // grid instead of taking a full row — unless the form says wide.
    if (this.compact() && q.wide == null && !q.sides && (q.type === 'scale' || q.type === 'yn' || (q.type === 'one' && (q.choices?.length ?? 0) <= 5))) return false;
    return isWide(q);
  }
  srcLabel(q: OpdQuestion): string { return (this.byKey().get(q.when?.key ?? '')?.label ?? '').replace(/\?$/, ''); }
  aria(q: OpdQuestion, side: Side | null): string { return q.label + (side ? (side === 'r' ? ', right' : ', left') : ''); }
  sideVal(q: OpdQuestion, sd: Side): unknown { return ((this.answers()[q.key] ?? {}) as OpdSided)[sd]; }
  opts(q: OpdQuestion): PfSelectOption<string>[] { return (q.choices ?? []).map((c) => ({ value: c, label: c })); }
  has(v: unknown, o: string): boolean { return Array.isArray(v) && v.includes(o); }
  toggle(v: unknown, o: string): string[] { const a = Array.isArray(v) ? (v as string[]) : []; return a.includes(o) ? a.filter((x) => x !== o) : [...a, o]; }
  steps(q: OpdQuestion): number[] { const out: number[] = []; for (let k = q.min ?? 0; k <= (q.max ?? 10); k++) out.push(k); return out; }
  mediaOf(v: unknown): OpdMediaRef[] { return Array.isArray(v) ? (v as OpdMediaRef[]) : typeof v === 'number' ? Array.from({ length: v }, (_, i) => ({ name: `Image ${i + 1}` })) : []; }
  marksOf(v: unknown): OpdMark[] {
    return Array.isArray(v) ? (v as unknown[]).map((p) => Array.isArray(p) ? { x: +p[0], y: +p[1], note: String(p[2] ?? '') } : (p as OpdMark)) : [];
  }
  shape(q: OpdQuestion): string[] { return SHAPES[q.shape ?? 'body'] ?? SHAPES['body']; }
  cell(v: unknown, r: number, c: number): string { const t = v as unknown[][]; return t?.[r]?.[c] == null ? '' : String(t[r][c]); }
  dateText(v: string): string { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); return m ? `${m[3]}/${m[2]}/${m[1]}` : v; }
  /** A `calc` field's live value — recomputed from the current answers on every render. */
  calcValue(q: OpdQuestion): string {
    const source = q.from ? this.byKey().get(q.from) : undefined;
    return computeCalc(q, source, this.answers(), this.visitDate() ?? undefined);
  }

  removeAt(v: unknown, i: number): unknown[] { return (Array.isArray(v) ? v : []).filter((_, k) => k !== i); }
  noteAt(v: unknown, i: number, note: string): OpdMark[] { return this.marksOf(v).map((m, k) => (k === i ? { ...m, note } : m)); }
  setCell(q: OpdQuestion, v: unknown, r: number, c: number, val: string): string[][] {
    const rows = q.rows ?? [], cols = q.cols ?? [];
    const t = rows.map((_, ri) => cols.map((_, ci) => this.cell(v, ri, ci)));
    if (t[r]) t[r][c] = val;
    return t;
  }
  mark(q: OpdQuestion, side: Side | null, v: unknown, e: MouseEvent): void {
    const svg = e.currentTarget as SVGElement;
    const b = svg.getBoundingClientRect();
    if (!b.width || !b.height) return;
    const x = Math.round(((e.clientX - b.left) / b.width) * 100);
    const y = Math.round(((e.clientY - b.top) / b.height) * 100);
    this.set(q, side, [...this.marksOf(v), { x, y, note: '' }]);
  }

  /** Emit a new answers object with one value replaced — and any `calc` field
   *  that reads THIS question recomputed and persisted alongside it, so a
   *  save captures what's on screen without a server round-trip. */
  set(q: OpdQuestion, side: Side | null, value: unknown): void {
    if (!this.live()) return;
    const cur = this.answers() ?? {};
    let next: unknown = value;
    if (side) next = { ...((cur[q.key] ?? {}) as OpdSided), [side]: value };
    const merged: OpdAnswers = { ...cur, [q.key]: next };
    for (const dep of this.list()) {
      if (dep.type === 'calc' && dep.from === q.key) merged[dep.key] = computeCalc(dep, q, merged, this.visitDate() ?? undefined);
    }
    this.answersChange.emit(merged);
  }
}
