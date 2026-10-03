import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { OpdPatientAllergy, OpdPregnancy } from '../shared/opd.models';
import { lineShort } from '../shared/rx-schedule';
import type { ConsultCurrentMedicine } from './consult.api';
import { ConsultDrugRef, ConsultRxLine, allergyHit, swapCandidate } from './rx/rx-model';
import { RecentResult, VisitFilter, VisitItem, filterItems } from './consult-records';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';

/**
 * The consult's left VISIT card (consult v6). On top, the "Always" strip:
 * allergies (record / remove, and today's prescription conflicts with a
 * one-tap swap — moved here from the old at-a-glance card), known
 * conditions, running medicines and a watch line from abnormal trends.
 * Then All / Reports / Images and the selected visit's records as tiles
 * (visit flow, vitals, desk note, intake, reports, results, images,
 * prescription). A tile opens in the centre viewer — or, in compare mode,
 * joins / leaves the comparison (selected ring + its order number). It is
 * the RIGHT card on desktop, a slide-over on tablet and a sheet on phones.
 */
@Component({
  selector: 'pf-consult-visit-card',
  standalone: true,
  imports: [DatePipe, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="nd-card__head vc__head">
      <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
      <span class="nd-card__label">{{ isToday() ? 'Today' : 'Visit' }}</span>
      @if (pinnable()) {
        <button type="button" class="vc__pin" (click)="togglePin.emit()" [attr.aria-pressed]="pinned()" data-pin
                [title]="autoCollapsed() ? 'Pinned · collapsed for space' : pinned() ? 'Pinned: stays open beside the consult' : 'Unpinned: folds to a rail'"
                [attr.aria-label]="autoCollapsed() ? 'Pinned, collapsed for space. Unpin the patient card' : pinned() ? 'Unpin the patient card' : 'Pin the patient card open'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8V4h6v6.8l2 3.2H7l2-3.2Z"/></svg>
        </button>
        @if (autoCollapsed()) { <span class="vc__auto">Pinned · collapsed for space</span> }
      }
      @if (closable()) {
        <button type="button" class="vc__x" (click)="close.emit()" aria-label="Close the patient card">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      }
      <span class="nd-card__spacer"></span>
      <button type="button" class="vc__date nd-num" (click)="stripOpen.set(!stripOpen())" [attr.aria-expanded]="stripOpen()" aria-label="Show the patient's allergies, conditions and medicines">
        {{ dayKey() + 'T00:00:00' | date:'EEE, d MMM y' }}
      </button>
      @if (!isToday()) { <button type="button" class="vc__today" (click)="today.emit()">Today</button> }
    </header>

    <div class="vc__always" [class.vc__always--open]="stripOpen()">
      @if (pregnancy(); as p) {
        <div class="vc__preg" role="status">{{ p.status === 'pregnant' ? 'Pregnant' : 'Lactating' }}@if (p.since) { · since {{ p.since | date:'MMM d, y' }}}</div>
      }
      <div class="vc__ar" data-allergies>
        <span class="vc__k">Allergies</span>
        <span class="vc__v">
          @for (a of allergies(); track a.id ?? a.allergen) {
            <span class="vc__allergy">
              <b>{{ a.allergen }}</b>@if (a.reaction) { <em> · {{ a.reaction }}</em> }
              @if (canEdit() && a.id) {
                <button type="button" class="vc__rm" (click)="removeAllergy.emit(a)" [attr.aria-label]="'Remove allergy ' + a.allergen">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              }
            </span>
          } @empty { <span class="vc__muted">None recorded</span> }
          @if (canEdit() && !adding()) { <button type="button" class="vc__link" (click)="adding.set(true)">+ Add</button> }
        </span>
      </div>
      @if (adding()) {
        <div class="vc__add">
          <input class="nd-input" type="text" placeholder="Allergen (drug, food, other)" aria-label="Allergen" [value]="newAllergen()" (input)="newAllergen.set($any($event.target).value)" />
          <input class="nd-input" type="text" placeholder="Reaction (e.g. rash)" aria-label="Reaction" [value]="newReaction()" (input)="newReaction.set($any($event.target).value)" />
          <pf-select size="sm" [options]="severityOpts" [value]="newSeverity()" placeholder="Severity" (valueChange)="newSeverity.set($event)"></pf-select>
          <div class="vc__addact">
            <button type="button" class="nd-btn nd-btn--tertiary" (click)="adding.set(false)">Cancel</button>
            <button type="button" class="nd-btn nd-btn--secondary" [disabled]="!newAllergen().trim()" (click)="saveAllergy()">Save allergy</button>
          </div>
        </div>
      }
      @for (c of conflicts(); track c.line.key) {
        <div class="vc__conflict" role="alert">
          <p><b>{{ c.line.drug.name }}</b> on today's prescription — {{ c.reason }}</p>
          @if (canEdit()) {
            <span class="vc__cact">
              @if (c.alt; as alt) { <button type="button" class="vc__swap" (click)="swap.emit({ key: c.line.key, alt })">Swap to {{ alt.name }}</button> }
              <button type="button" class="vc__link" (click)="seeLine.emit(c.line.key)">See the line</button>
            </span>
          }
        </div>
      }
      <div class="vc__ar"><span class="vc__k">Conditions</span><span class="vc__v">{{ conditionsText() || 'None on record' }}</span></div>
      <div class="vc__ar"><span class="vc__k">Medicines</span><span class="vc__v">{{ medsText() || 'None running' }}</span></div>
      @if (watch()) { <div class="vc__ar"><span class="vc__k">Watch</span><span class="vc__v vc__w nd-num">{{ watch() }}</span></div> }
      @if (results().length) {
        <div class="vc__ar"><span class="vc__k">Results</span>
          <span class="vc__v vc__res">
            @for (r of results(); track r.test + r.param) {
              @let hl = flagOf(r);
              <span class="vc__rv nd-num" [attr.data-flag]="hl" [title]="r.test + ' · ' + (r.date | date:'d MMM y')">{{ r.param }} <b>{{ r.value }}</b>@if (r.unit) { {{ ' ' + r.unit }} }@if (hl) { <i>{{ hl }}</i> }</span>
            }
          </span>
        </div>
      }
    </div>

    <div class="vc__pills" role="group" aria-label="Show" [class.vc__pills--open]="stripOpen()">
      @for (f of filters; track f.id) {
        <button type="button" class="vc__pill" [attr.aria-pressed]="filter() === f.id" (click)="filter.set(f.id)">{{ f.label }}</button>
      }
    </div>

    <div class="vc__scroll">
      <div class="vc__items" role="list" [attr.aria-label]="'Records of ' + (isToday() ? 'today' : 'this visit')">
        @for (i of shown(); track i.id) {
          @let order = compareIds().indexOf(i.id) + 1;
          <div class="vc__row" role="listitem" [attr.aria-current]="selectedId() === i.id" [attr.data-item]="i.type"
               [class.vc__row--pick]="compareMode() && i.compare" [class.vc__row--picked]="order > 0">
            <button type="button" class="vc__open" (click)="open.emit(i)"
                    [attr.aria-label]="compareMode() && i.compare ? (order ? 'Remove ' + i.title + ' from compare' : 'Add ' + i.title + ' to compare') : 'Open ' + i.title"
                    [attr.aria-pressed]="compareMode() && i.compare ? order > 0 : null">
              <span class="vc__ic" [attr.data-type]="i.type" aria-hidden="true">
                @switch (i.type) {
                  @case ('flow') { <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h5a3 3 0 0 1 0 6h-2a3 3 0 0 0 0 6h5"/></svg> }
                  @case ('vit') { <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg> }
                  @case ('pre') { <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg> }
                  @case ('res') { <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6L5 19a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-10V3"/></svg> }
                  @case ('img') { <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg> }
                  @case ('rx') { <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="m8.5 8.5 7 7"/></svg> }
                  @default { <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg> }
                }
              </span>
              <span class="vc__t">
                <span class="vc__n">{{ i.title }}</span>
                <span class="vc__s nd-num" [class.vc__s--h]="i.high">{{ i.sub }}</span>
              </span>
              @if (order > 0) { <span class="vc__ord nd-num" aria-hidden="true">{{ order }}</span> }
            </button>
          </div>
        } @empty {
          <p class="vc__muted vc__pad">{{ loading() ? 'Loading this visit…' : 'Nothing of this kind on this visit.' }}</p>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; height: 100%; }
    .vc__head { min-height: 53px; }
    .vc__date { border: 0; background: none; padding: 4px 2px; font: inherit; font-size: 12px; color: var(--text-tertiary); cursor: pointer; border-radius: 6px; }
    .vc__date:focus-visible, .vc__today:focus-visible, .vc__pill:focus-visible, .vc__open:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .vc__today { height: 30px; padding: 0 10px; border: 0; border-radius: 8px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
      color: var(--violet-text, #6d28d9); background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .vc__always { display: grid; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--nd-line); }
    .vc__ar { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 8px; font-size: 12.5px; line-height: 1.45; }
    .vc__k { color: var(--text-tertiary); }
    .vc__v { color: var(--text-primary); display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; min-width: 0; overflow-wrap: anywhere; }
    .vc__w { color: var(--amber-text, #b45309); font-weight: 600; }
    :host-context(html.dark) .vc__w { color: #fbbf24; }
    .vc__res { flex-direction: column; align-items: flex-start; gap: 2px; }
    .vc__rv { font-size: 12.5px; color: var(--text-secondary); }
    .vc__rv b { color: var(--text-primary); font-weight: 600; }
    .vc__rv i { margin-left: 4px; padding: 0 4px; border-radius: 4px; font-style: normal; font-size: 10.5px; font-weight: 700; color: #fff; background: #d97706; }
    .vc__rv[data-flag='L'] i { background: #2563eb; }
    .vc__rv[data-flag] b { color: var(--amber-text, #b45309); }
    :host-context(html.dark) .vc__rv[data-flag] b { color: #fbbf24; }
    .vc__muted { color: var(--text-tertiary); font-size: 12.5px; margin: 0; }
    .vc__pad { padding: 4px 2px; }
    .vc__allergy { display: inline-flex; align-items: center; gap: 2px; min-height: 26px; padding: 1px 2px 1px 8px; border-radius: 7px; font-size: 12.5px;
      color: var(--red-text, #dc2626); border: 1px solid color-mix(in srgb, var(--red-text, #dc2626) 30%, transparent); background: color-mix(in srgb, var(--red-text, #dc2626) 6%, var(--nd-card-bg)); }
    .vc__allergy em { font-style: normal; color: var(--text-secondary); }
    .vc__rm { width: 22px; height: 22px; border: 0; border-radius: 6px; background: transparent; color: inherit; display: grid; place-items: center; cursor: pointer; }
    .vc__link { border: 0; background: transparent; padding: 2px 0; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--violet-text, #6d28d9); cursor: pointer; }
    .vc__add { display: grid; gap: 8px; }
    .vc__addact { display: flex; justify-content: flex-end; gap: 8px; }
    .vc__conflict { display: grid; gap: 6px; padding: 10px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--red-text, #dc2626) 30%, transparent);
      background: color-mix(in srgb, var(--red-text, #dc2626) 6%, var(--nd-card-bg)); font-size: 12.5px; }
    .vc__conflict p { margin: 0; color: var(--text-primary); line-height: 1.45; }
    .vc__cact { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .vc__swap { min-height: 36px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--color-violet-600, #7c3aed); background: var(--nd-card-bg);
      color: var(--violet-text, #6d28d9); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .vc__preg { padding: 8px 10px; border-radius: 10px; font-size: 12.5px; font-weight: 600; color: var(--text-primary);
      background: color-mix(in srgb, var(--red-text, #dc2626) 8%, var(--nd-card-bg)); border: 1px solid color-mix(in srgb, var(--red-text, #dc2626) 28%, transparent); }
    .vc__pills { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 14px 4px; }
    .vc__pill { height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--nd-line); background: none; font: inherit; font-size: 12px; font-weight: 500;
      color: var(--text-secondary); cursor: pointer; }
    .vc__pill[aria-pressed='true'] { border-color: transparent; color: #fff; font-weight: 600; background: var(--gradient-primary, linear-gradient(135deg, #7c3aed, #ec4899)); }
    .vc__scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
    .vc__items { display: grid; gap: 8px; padding: 10px 14px 14px; align-content: start; }
    .vc__row { display: flex; align-items: center; gap: 4px; min-height: 52px; padding: 0; border-radius: var(--nd-radius-sm, 10px);
      border: 1px solid var(--nd-line); background: var(--nd-card-bg); }
    .vc__row:hover { border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 40%, var(--nd-line)); }
    .vc__row[aria-current='true'] { background: var(--nd-in-tint); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 55%, transparent); }
    .vc__open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; border-radius: 10px; }
    .vc__ic { flex: none; width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; color: var(--violet-text, #6d28d9);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 6%, transparent); }
    .vc__ic[data-type='res'] { color: var(--blue-text, #1d4ed8); background: color-mix(in srgb, #60a5fa 12%, transparent); }
    .vc__ic[data-type='rx'] { color: var(--orange-text, #c2410c); }
    .vc__ic[data-type='pre'] { color: var(--amber-text, #b45309); background: color-mix(in srgb, #fbbf24 12%, transparent); }
    .vc__t { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .vc__n { font-size: 13px; font-weight: 500; color: var(--text-primary); overflow-wrap: anywhere; }
    .vc__s { font-size: 11.5px; color: var(--text-tertiary); }
    .vc__s--h { color: var(--red-text, #dc2626); font-weight: 600; }
    .vc__row--pick { border-style: dashed; }
    .vc__row--picked { border-style: solid; border-color: var(--color-violet-600, #7c3aed); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary, #7c3aed) 35%, transparent); }
    .vc__ord { flex: none; margin-left: auto; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11.5px; font-weight: 700;
      color: #fff; background: var(--color-violet-600, #7c3aed); }
    .vc__pin { order: 8; height: 28px; min-width: 28px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--nd-line); background: none;
      color: var(--text-secondary); display: inline-grid; place-items: center; cursor: pointer; }
    .vc__pin[aria-pressed='true'] { border-color: transparent; color: var(--violet-text, #6d28d9); background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .vc__auto { order: 7; font-size: 11px; color: var(--text-tertiary); white-space: nowrap; }
    .vc__pin:focus-visible, .vc__x:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .vc__x { order: 9; width: 32px; height: 32px; border: 0; border-radius: 8px; background: none; color: var(--text-secondary); display: grid; place-items: center; cursor: pointer; }

    @media (max-width: 760px) { .nd-input { font-size: 16px; } }
  `],
})
export class ConsultVisitCardComponent {
  readonly items = input<VisitItem[]>([]);
  readonly dayKey = input.required<string>();
  readonly isToday = input(true);
  readonly loading = input(false);
  readonly selectedId = input<string | null>(null);
  readonly compareIds = input<string[]>([]);
  /** Compare mode (band button): a tap adds / removes the record instead of opening it. */
  readonly compareMode = input(false);
  /** Unpinned overlay / phone sheet: a close button. */
  readonly closable = input(false);
  /** The pin (same icon + behaviour as the journey dock); hidden on phones. */
  readonly pinnable = input(true);
  readonly pinned = input(true);
  /** Pinned, but folded because the centre needs the room (auto-balance). */
  readonly autoCollapsed = input(false);
  readonly allergies = input<OpdPatientAllergy[]>([]);
  readonly pregnancy = input<OpdPregnancy | null>(null);
  readonly conditions = input<{ label: string }[]>([]);
  readonly medicines = input<ConsultCurrentMedicine[]>([]);
  readonly watch = input<string | null>(null);
  /** Recent lab results (latest value per test). */
  readonly results = input<RecentResult[]>([]);
  readonly lines = input<ConsultRxLine[]>([]);
  readonly drugs = input<ConsultDrugRef[]>([]);
  readonly preferIds = input<string[]>([]);
  readonly canEdit = input(false);

  readonly open = output<VisitItem>();
  readonly close = output<void>();
  readonly togglePin = output<void>();
  readonly today = output<void>();
  readonly swap = output<{ key: string; alt: ConsultDrugRef }>();
  readonly seeLine = output<string>();
  readonly addAllergy = output<Partial<OpdPatientAllergy>>();
  readonly removeAllergy = output<OpdPatientAllergy>();

  readonly filters: { id: VisitFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'reports', label: 'Reports' }, { id: 'images', label: 'Images' }];
  readonly filter = signal<VisitFilter>('all');
  readonly stripOpen = signal(false);
  readonly shown = computed(() => filterItems(this.items(), this.filter()));

  readonly adding = signal(false);
  readonly newAllergen = signal('');
  readonly newReaction = signal('');
  readonly newSeverity = signal<string>('');
  readonly severityOpts: PfSelectOption[] = [
    { value: 'mild', label: 'Mild' }, { value: 'moderate', label: 'Moderate' }, { value: 'severe', label: 'Severe' },
  ];

  readonly conflicts = computed(() => this.lines()
    .map(l => ({ line: l, hit: l.allergyAck ? null : allergyHit(l.drug, this.allergies()) }))
    .filter(x => !!x.hit)
    .map(x => ({ line: x.line, reason: x.hit!.reason, alt: swapCandidate(x.line, this.drugs(), this.allergies(), this.preferIds()) })));
  readonly conditionsText = computed(() => this.conditions().map(c => c.label).join(' · '));
  readonly medsText = computed(() => this.medicines().map(m => {
    let s = '';
    try { s = lineShort({ drugId: '', dose: m.dose, sched: m.schedule, dur: m.durationDays, food: m.food ?? undefined }, { form: m.form }).split(' · ').find(p => /\d-\d|SOS|Every|Weekly|on,/.test(p)) ?? ''; } catch { s = ''; }
    return m.drugName + (s ? ' ' + s : '');
  }).join(' · '));

  /** H / L (or any abnormal flag) for a result; null when normal. */
  flagOf(r: RecentResult): string | null { const f = (r.flag ?? '').toUpperCase(); return f && f !== 'N' ? (f.startsWith('H') ? 'H' : f.startsWith('L') ? 'L' : f.charAt(0)) : null; }
  saveAllergy() {
    const a = this.newAllergen().trim();
    if (!a) return;
    this.addAllergy.emit({ allergen: a, reaction: this.newReaction().trim() || null, severity: (this.newSeverity() || null) as OpdPatientAllergy['severity'] });
    this.newAllergen.set(''); this.newReaction.set(''); this.newSeverity.set(''); this.adding.set(false);
  }
}
