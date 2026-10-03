import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { OpdPatientAllergy } from '../shared/opd.models';
import { lineShort } from '../shared/rx-schedule';
import type { ConsultWorkspace } from './consult.api';
import { ConsultDrugRef, ConsultRxLine, allergyHit, swapCandidate } from './rx/rx-model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';

/** One recent lab value (latest point of a trended parameter). */
export interface RecentResult { test: string; param: string; value: string; unit?: string | null; flag?: string | null; date: string;
  /** Numeric history, oldest → newest (≤ 6) — the tiny trend line. */
  points?: number[]; }

/** SVG polyline points for a tiny trend (w×h box), or '' for < 2 values. Pure. */
export function sparkPoints(vals: readonly number[] | undefined, w = 48, h = 16): string {
  if (!vals || vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  return vals.map((v, i) => `${((i * (w - 4)) / (vals.length - 1) + 2).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
}

/** Latest point per parameter from /api/patients/{id}/lab-trends, newest first. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recentResultsOf(trends: any, max = 6): RecentResult[] {
  const out: RecentResult[] = [];
  for (const t of trends?.tests ?? []) {
    for (const p of t.parameters ?? []) {
      const pts = [...(p.points ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const last = pts[0];
      if (!last) continue;
      const nums = pts.slice(0, 6).reverse().map(x => Number(x.value)).filter(n => Number.isFinite(n));
      out.push({ test: t.testName, param: p.name ?? p.parameter ?? t.testName, value: String(last.value), unit: p.unit, flag: last.flag, date: last.date, points: nums });
    }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, max);
}

type Section = 'allergies' | 'conditions' | 'meds' | 'results' | 'last' | 'followup';

/**
 * The consult's right "At a glance" panel (Agent C): allergies (with today's
 * prescription conflicts + one-tap swap), conditions, current medicines,
 * recent lab results from the patient's REAL lab history, last visit (repeat
 * its Rx) and the follow-up rule. The page decides where it sits: a column
 * ≥1100px, a slide-over below, a bottom sheet on phones.
 */
@Component({
  selector: 'pf-consult-glance',
  standalone: true,
  imports: [DatePipe, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="nd-card__head gl__head">
      <span class="nd-card__icon" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
      </span>
      <span class="nd-card__label">At a glance</span>
      <span class="nd-card__spacer"></span>
      @if (closable()) {
        <button type="button" class="gl__x" (click)="close.emit()" aria-label="Close at a glance">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      }
    </header>

    <div class="gl">
      @if (pregnancy(); as p) {
        <div class="gl__preg" [class.gl__preg--lact]="p.status === 'lactating'" role="status">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a5 5 0 0 0-5 5c0 2.5 2 4.5 5 8 3-3.5 5-5.5 5-8a5 5 0 0 0-5-5Z"/><path d="M8 18c-2 1-3 2-3 3M16 18c2 1 3 2 3 3"/></svg>
          <span>{{ p.status === 'pregnant' ? 'Pregnant' : 'Lactating' }}@if (p.since) { · since {{ p.since | date:'MMM d, y' }}}@if (p.source) { <em>&nbsp;(from {{ p.source }})</em>}</span>
        </div>
      }

      <!-- Allergies: a red callout when there are any. -->
      <section class="gl__s gl__s--allergy" [class.gl__s--hot]="allergies().length > 0" data-allergies>
        <button type="button" class="gl__sh" (click)="toggle('allergies')" [attr.aria-expanded]="isOpen('allergies')">
          @if (allergies().length) {
            <svg class="gl__shi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
          }
          <span>Allergies</span>@if (allergies().length) { <span class="gl__n">{{ allergies().length }}</span> }
          <svg class="gl__chev" [class.up]="isOpen('allergies')" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        @if (isOpen('allergies')) {
          <div class="gl__b">
            @if (allergies().length) {
              <div class="gl__allergies">
                @for (a of allergies(); track a.id ?? a.allergen) {
                  <span class="gl__allergy">
                    <span><b>{{ a.allergen }}</b>@if (a.reaction) { <em> · {{ a.reaction }}</em>}@if (a.severity) { <em> · {{ a.severity }}</em>}</span>
                    @if (canEdit() && a.id) {
                      <button type="button" class="gl__rm" (click)="removeAllergy.emit(a)" [attr.aria-label]="'Remove allergy ' + a.allergen">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                      </button>
                    }
                  </span>
                }
              </div>
            } @else { <p class="gl__muted">No known allergies recorded.</p> }

            @for (c of conflicts(); track c.line.key) {
              <div class="gl__conflict">
                <p><b>{{ c.line.drug.name }}</b> on today's prescription — {{ c.reason }}</p>
                @if (canEdit()) {
                  @if (c.alt; as alt) {
                    <button type="button" class="gl__swap" (click)="swap.emit({ key: c.line.key, alt })">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>
                      Swap to {{ alt.name }}
                    </button>
                  }
                  <button type="button" class="gl__link" (click)="seeLine.emit(c.line.key)">See the line</button>
                }
              </div>
            }
            @if (allergies().length && !conflicts().length && lines().length) {
              <p class="gl__ok"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>Nothing on today's prescription conflicts</p>
            }

            @if (canEdit()) {
              @if (adding()) {
                <div class="gl__add">
                  <input class="nd-input" type="text" placeholder="Allergen (drug, food, other)" aria-label="Allergen" [value]="newAllergen()" (input)="newAllergen.set($any($event.target).value)" />
                  <input class="nd-input" type="text" placeholder="Reaction (e.g. rash)" aria-label="Reaction" [value]="newReaction()" (input)="newReaction.set($any($event.target).value)" />
                  <pf-select size="sm" [options]="severityOpts" [value]="newSeverity()" placeholder="Severity" (valueChange)="newSeverity.set($event)"></pf-select>
                  <div class="gl__addact">
                    <button type="button" class="nd-btn nd-btn--tertiary" (click)="adding.set(false)">Cancel</button>
                    <button type="button" class="nd-btn nd-btn--secondary" [disabled]="!newAllergen().trim()" (click)="saveAllergy()">Save allergy</button>
                  </div>
                </div>
              } @else {
                <button type="button" class="gl__link gl__link--add" (click)="adding.set(true)">+ Record an allergy</button>
              }
            }
          </div>
        }
      </section>

      <!-- Conditions -->
      <section class="gl__s">
        <button type="button" class="gl__sh" (click)="toggle('conditions')" [attr.aria-expanded]="isOpen('conditions')">
          <span>Known conditions</span>@if (ws()?.conditions?.length) { <span class="gl__n">{{ ws()!.conditions.length }}</span> }
          <svg class="gl__chev" [class.up]="isOpen('conditions')" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        @if (isOpen('conditions')) {
          <div class="gl__b">
            @for (c of ws()?.conditions ?? []; track c.label) {
              <div class="gl__item"><b>{{ c.label }}</b><span>Since {{ c.since | date:'MMM y' }}@if (c.doctorName) { · {{ c.doctorName }}}@if (c.count > 1) { · {{ c.count }} visits}</span></div>
            } @empty { <p class="gl__muted">No earlier diagnoses on record.</p> }
          </div>
        }
      </section>

      <!-- Current medicines -->
      <section class="gl__s">
        <button type="button" class="gl__sh" (click)="toggle('meds')" [attr.aria-expanded]="isOpen('meds')">
          <span>Current medicines</span>@if (ws()?.currentMedicines?.length) { <span class="gl__n">{{ ws()!.currentMedicines.length }}</span> }
          <svg class="gl__chev" [class.up]="isOpen('meds')" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        @if (isOpen('meds')) {
          <div class="gl__b">
            @for (m of ws()?.currentMedicines ?? []; track $index) {
              <div class="gl__item gl__item--row">
                <span><b>{{ m.drugName }}</b><span>@if (m.doctorName) { {{ m.doctorName }} · }since {{ m.prescribedOn | date:'MMM d' }}@if (m.endsOn) { · till {{ m.endsOn | date:'MMM d' }}}</span></span>
                <span class="gl__sched">{{ medShort(m) }}</span>
              </div>
            } @empty { <p class="gl__muted">No running prescriptions.</p> }
          </div>
        }
      </section>

      <!-- Recent results: value + H / L + a tiny trend -->
      <section class="gl__s">
        <button type="button" class="gl__sh" (click)="toggle('results')" [attr.aria-expanded]="isOpen('results')">
          <span>Recent results</span>@if (results().length) { <span class="gl__n">{{ results().length }}</span> }
          <svg class="gl__chev" [class.up]="isOpen('results')" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        @if (isOpen('results')) {
          <div class="gl__b gl__b--tight">
            @for (r of results(); track r.test + r.param) {
              @let hl = flagOf(r);
              <div class="gl__res" [attr.data-flag]="hl" data-result>
                <span class="gl__resk"><b>{{ r.param }}</b><span>{{ r.test }} · {{ r.date | date:'MMM d' }}</span></span>
                @if (spark(r); as pts) {
                  <svg class="gl__spark" width="48" height="16" viewBox="0 0 48 16" aria-hidden="true"><polyline [attr.points]="pts" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>
                }
                <span class="gl__resv nd-num">{{ r.value }}@if (r.unit) { <span class="gl__resu">{{ r.unit }}</span> }</span>
                @if (hl) { <span class="gl__flag" [attr.aria-label]="hl === 'H' ? 'High' : hl === 'L' ? 'Low' : 'Flagged'">{{ hl }}</span> }
              </div>
            } @empty { <p class="gl__muted">No repeated lab results to show yet.</p> }
          </div>
        }
      </section>

      <!-- Last visit -->
      <section class="gl__s">
        <button type="button" class="gl__sh" (click)="toggle('last')" [attr.aria-expanded]="isOpen('last')">
          <span>Last visit</span>
          <svg class="gl__chev" [class.up]="isOpen('last')" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        @if (isOpen('last')) {
          <div class="gl__b">
            @if (ws()?.lastVisit; as lv) {
              <div class="gl__item"><b>{{ lv.visitDate | date:'EEE, d MMM y' }}</b><span>{{ lv.doctorName || 'Doctor' }}@if (lv.diagnoses.length) { · {{ dxText(lv.diagnoses) }}}</span></div>
              @if (lv.rx.length) {
                <p class="gl__muted">{{ lv.rx.length }} medicine{{ lv.rx.length === 1 ? '' : 's' }}: {{ rxNames(lv.rx) }}</p>
                @if (canEdit()) { <button type="button" class="gl__link" (click)="repeatLast.emit()">Repeat this prescription</button> }
              }
            } @else { <p class="gl__muted">First visit.</p> }
          </div>
        }
      </section>

      <!-- Follow-up rule: always at the bottom -->
      <section class="gl__fu" data-followup>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        <span>
          <b>Follow-up</b>
          @if (ws()?.visit?.isFollowUp) { Today is a follow-up visit. }
          @if (ws()?.followUpRule; as r) { A visit within {{ r.withinDays }} days is a follow-up · {{ r.fee ? '₹' + r.fee : 'free' }}. }
          @else { No follow-up rule on this service. }
        </span>
      </section>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; height: 100%; --gl-red: var(--red-text, #dc2626); }
    .gl__head { flex: none; }
    .gl { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; padding: 4px 14px 14px;
      scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb, rgba(168, 85, 247, 0.32)) transparent; }
    .gl__x { width: 36px; height: 36px; margin: -4px -4px -4px 0; border: 0; border-radius: 10px; background: transparent; color: var(--text-secondary);
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .gl__x:hover { background: var(--nd-chip-bg); }
    .gl__s { border-top: 1px solid var(--nd-line); }
    .gl__s:first-child, .gl__preg + .gl__s { border-top: 0; }
    .gl__sh { display: flex; width: 100%; align-items: center; gap: 8px; min-height: 42px; padding: 0; border: 0; background: transparent; font: inherit;
      font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); cursor: pointer; text-align: left; }
    .gl__sh:hover { color: var(--text-secondary); }
    .gl__shi { color: var(--gl-red); flex: none; }
    .gl__n { font-size: 11px; color: var(--text-tertiary); letter-spacing: 0; font-variant-numeric: tabular-nums; }
    .gl__chev { margin-left: auto; color: var(--text-tertiary); transition: transform 160ms ease; }
    .gl__chev.up { transform: rotate(180deg); }
    .gl__b { display: flex; flex-direction: column; gap: 10px; padding: 0 0 14px; }
    .gl__b--tight { gap: 4px; }
    /* Allergies present → the whole section is a red callout. */
    .gl__s--hot { margin: 10px 0 6px; padding: 0 12px; border: 1px solid color-mix(in srgb, var(--gl-red) 32%, transparent); border-radius: 12px;
      background: color-mix(in srgb, var(--gl-red) 7%, var(--nd-card-bg)); }
    .gl__s--hot .gl__sh { color: var(--gl-red); }
    .gl__s--hot + .gl__s { border-top: 0; }
    .gl__allergies { display: flex; flex-wrap: wrap; gap: 6px; }
    .gl__allergy { display: inline-flex; align-items: center; gap: 4px; min-height: 30px; padding: 2px 4px 2px 10px; border-radius: 8px;
      background: var(--nd-card-bg); border: 1px solid color-mix(in srgb, var(--gl-red) 30%, transparent); color: var(--gl-red); font-size: 13px; }
    .gl__allergy b { font-weight: 600; }
    .gl__allergy em { font-style: normal; color: var(--text-secondary); }
    .gl__rm { width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .gl__preg { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; padding: 10px 12px; border-radius: 12px; font-size: 13.5px; font-weight: 500; line-height: 1.4;
      background: color-mix(in srgb, var(--gl-red) 9%, var(--nd-card-bg)); border: 1px solid color-mix(in srgb, var(--gl-red) 30%, transparent); color: var(--text-primary); }
    .gl__preg svg { color: var(--gl-red); flex: none; }
    .gl__preg--lact { background: color-mix(in srgb, var(--color-primary, #7c3aed) 9%, var(--nd-card-bg)); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 28%, transparent); }
    .gl__preg--lact svg { color: var(--violet-text, #6d28d9); }
    .gl__preg em { font-style: normal; color: var(--text-tertiary); }
    .gl__conflict { padding: 12px; border-radius: 12px; background: var(--nd-card-bg); border: 1px solid color-mix(in srgb, var(--gl-red) 30%, transparent);
      display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
    .gl__conflict p { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text-primary); }
    .gl__swap { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--color-violet-600, #7c3aed);
      background: var(--nd-card-bg); color: var(--violet-text, #6d28d9); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .gl__link { border: 0; background: transparent; padding: 2px 0; font: inherit; font-size: 13px; font-weight: 500; color: var(--violet-text, #6d28d9); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; align-self: flex-start; }
    .gl__link--add { text-decoration: none; }
    .gl__ok { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; color: var(--text-secondary); }
    .gl__ok svg { color: var(--violet-text, #6d28d9); flex: none; }
    .gl__muted { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text-tertiary); }
    .gl__item { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); }
    .gl__item b { font-size: 13.5px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .gl__item--row { flex-direction: row; justify-content: space-between; gap: 10px; }
    .gl__item--row > span:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .gl__sched { flex: none; font-size: 13px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .gl__res { display: grid; grid-template-columns: minmax(0, 1fr) auto auto 18px; align-items: center; gap: 10px; min-height: 40px; padding: 4px 8px; margin: 0 -8px; border-radius: 8px; }
    .gl__res[data-flag] { background: color-mix(in srgb, #f59e0b 9%, transparent); }
    .gl__resk { display: flex; flex-direction: column; gap: 1px; min-width: 0; font-size: 12px; color: var(--text-tertiary); }
    .gl__resk b { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .gl__spark { color: var(--violet-text, #6d28d9); opacity: 0.85; }
    .gl__resv { font-size: 13.5px; font-weight: 600; color: var(--text-primary); text-align: right; white-space: nowrap; }
    .gl__resu { font-size: 11px; font-weight: 400; color: var(--text-tertiary); margin-left: 2px; }
    .gl__res[data-flag] .gl__resv { color: #b45309; }
    :host-context(html.dark) .gl__res[data-flag] .gl__resv, :host-context([data-theme='dark']) .gl__res[data-flag] .gl__resv { color: #fbbf24; }
    .gl__flag { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 5px; font-size: 10.5px; font-weight: 700;
      color: #fff; background: #d97706; }
    .gl__res[data-flag='L'] .gl__flag { background: #2563eb; }
    .gl__add { display: flex; flex-direction: column; gap: 8px; }
    .gl__addact { display: flex; gap: 8px; justify-content: flex-end; }
    .gl__fu { margin-top: auto; display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: 12px;
      background: var(--nd-in-tint); border: 1px solid color-mix(in srgb, var(--color-primary, #7c3aed) 18%, transparent);
      font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .gl__fu svg { flex: none; margin-top: 2px; color: var(--violet-text, #6d28d9); }
    .gl__fu b { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
    @media (max-width: 760px) { .nd-input { font-size: 16px; } }
    @media (prefers-reduced-motion: reduce) { .gl__chev { transition: none; } }
  `],
})
export class ConsultGlanceComponent {
  readonly ws = input<ConsultWorkspace | null>(null);
  readonly allergies = input<OpdPatientAllergy[]>([]);
  readonly lines = input<ConsultRxLine[]>([]);
  readonly drugs = input<ConsultDrugRef[]>([]);
  readonly results = input<RecentResult[]>([]);
  readonly canEdit = input(false);
  readonly closable = input(false);
  readonly preferIds = input<string[]>([]);

  readonly close = output<void>();
  readonly swap = output<{ key: string; alt: ConsultDrugRef }>();
  readonly seeLine = output<string>();
  readonly repeatLast = output<void>();
  readonly addAllergy = output<Partial<OpdPatientAllergy>>();
  readonly removeAllergy = output<OpdPatientAllergy>();

  private readonly closedSet = signal<Set<Section>>(new Set());
  readonly adding = signal(false);
  readonly newAllergen = signal('');
  readonly newReaction = signal('');
  readonly newSeverity = signal<string>('');
  readonly severityOpts: PfSelectOption[] = [
    { value: 'mild', label: 'Mild' }, { value: 'moderate', label: 'Moderate' }, { value: 'severe', label: 'Severe' },
  ];

  /** Pregnancy-safety guard (night/safety, critic P0 #1c) — the banner. */
  readonly pregnancy = computed(() => this.ws()?.pregnancy ?? null);

  readonly conflicts = computed(() => this.lines()
    .map(l => ({ line: l, hit: l.allergyAck ? null : allergyHit(l.drug, this.allergies()) }))
    .filter(x => !!x.hit)
    .map(x => ({ line: x.line, reason: x.hit!.reason, alt: swapCandidate(x.line, this.drugs(), this.allergies(), this.preferIds()) })));

  isOpen(s: Section) { return !this.closedSet().has(s); }
  toggle(s: Section) { this.closedSet.update(set => { const n = new Set(set); if (n.has(s)) n.delete(s); else n.add(s); return n; }); }
  dxText(d: { label: string }[]) { return d.map(x => x.label).join(', '); }
  /** H / L (or any abnormal flag) for a result; null when normal. */
  flagOf(r: RecentResult): string | null { const f = (r.flag ?? '').toUpperCase(); return f && f !== 'N' ? (f.startsWith('H') ? 'H' : f.startsWith('L') ? 'L' : f.charAt(0)) : null; }
  spark(r: RecentResult): string { return sparkPoints(r.points); }
  rxNames(rx: { drugName: string }[]) { return rx.map(r => r.drugName).join(', '); }
  medShort(m: ConsultWorkspace['currentMedicines'][number]) {
    try { return lineShort({ drugId: '', dose: m.dose, sched: m.schedule, dur: m.durationDays, food: m.food ?? undefined }, { form: m.form }).split(' · ').find(p => /\d-\d|SOS|Every|Weekly|on,/.test(p)) ?? ''; } catch { return ''; }
  }
  saveAllergy() {
    const a = this.newAllergen().trim();
    if (!a) return;
    this.addAllergy.emit({ allergen: a, reaction: this.newReaction().trim() || null, severity: (this.newSeverity() || null) as OpdPatientAllergy['severity'] });
    this.newAllergen.set(''); this.newReaction.set(''); this.newSeverity.set(''); this.adding.set(false);
  }
}
