import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { PfSelectOption, SelectComponent } from '@prefrontal/shared';
import { PfDateComponent } from '../../../shared/components/pf-date/pf-date.component';
import { CasePatient, CasePatientError, CasePatientsApi, patientMeta } from '../data/patients/case-patients-api';

/** LMS patient sex values (patient-register stores the words). */
export const SEX_OPTIONS: PfSelectOption<string>[] = [
  { value: '', label: 'Not given' },
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
];

/** Age box → years (whole number 0..150), null when empty, NaN when not a valid age. */
export function readAge(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{1,3}$/.test(t)) return NaN;
  const n = Number(t);
  return n <= 150 ? n : NaN;
}

/**
 * The "whose case sheet is this?" step (plan §3.5): the public site, and the lab's Prepare tab (owner 2026-11-11; a sheet from the
 * patient profile skips it). Search the patients, or add one in a few fields (name, age or date of birth, sex, phone), then the sheet starts.
 * Plain words, LMS inputs (pf-select, pf-date), no native pickers. Emits the chosen patient's id.
 */
@Component({
  selector: 'cs-patient-step',
  standalone: true,
  imports: [PfIconComponent, SelectComponent, PfDateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ps-root" role="dialog" aria-modal="true" aria-labelledby="ps-h" data-patient-step>
      <div class="ps-backdrop" (click)="cancel()"></div>
      <div class="ps-card">
        <header class="ps-head">
          <div>
            <h2 class="ps-title" id="ps-h">{{ adding() ? 'New patient' : 'Choose the patient' }}</h2>
            <p class="ps-sub">{{ formTitle() }}</p>
          </div>
          <button type="button" class="ps-x pf-touch" aria-label="Close" (click)="cancel()" [disabled]="busy()">
            <pf-icon name="x" [size]="18" />
          </button>
        </header>

        @if (!adding()) {
          <label class="ps-search">
            <pf-icon name="search" [size]="16" />
            <input type="search" class="ps-search__in" placeholder="Search by name or phone" aria-label="Search my patients"
                   data-ps-search [value]="query()" (input)="onQuery($any($event.target).value)" />
            @if (query()) {
              <button type="button" class="ps-search__clr" aria-label="Clear search" (click)="onQuery('')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            }
          </label>
          <div class="ps-list" aria-live="polite">
            @if (searching()) {
              <p class="ps-note">Searching…</p>
            } @else if (results().length) {
              <ul role="list" class="ps-rows">
                @for (p of results(); track p.id) {
                  <li>
                    <button type="button" class="ps-row pf-touch" data-ps-pick [disabled]="busy()" (click)="choose(p.id)">
                      <span class="ps-row__name">{{ p.name }}</span>
                      @if (meta(p); as m) { <span class="ps-row__meta">{{ m }}</span> }
                    </button>
                  </li>
                }
              </ul>
            } @else if (searched()) {
              <p class="ps-note">No patient matches “{{ query() }}”.</p>
            } @else {
              <p class="ps-note">Search your patients, or add a new one.</p>
            }
          </div>
          @if (error()) { <p class="ps-err" role="alert">{{ error() }}</p> }
          <footer class="ps-actions">
            <button type="button" class="pf-btn pf-btn--secondary" (click)="cancel()" [disabled]="busy()">Cancel</button>
            <button type="button" class="pf-btn pf-btn--primary" data-ps-new (click)="startAdding()" [disabled]="busy()">
              <pf-icon name="plus" [size]="16" /> New patient
            </button>
          </footer>
        } @else {
          <div class="ps-form">
            <div class="ps-grid">
              <label class="pf-field">
                <span class="pf-field__lbl">First name</span>
                <input class="pf-input" data-ps-first autocomplete="off" [value]="first()" (input)="first.set($any($event.target).value)" />
              </label>
              <label class="pf-field">
                <span class="pf-field__lbl">Last name <span class="ps-opt">(optional)</span></span>
                <input class="pf-input" data-ps-last autocomplete="off" [value]="last()" (input)="last.set($any($event.target).value)" />
              </label>
              <label class="pf-field">
                <span class="pf-field__lbl">Age in years</span>
                <input class="pf-input" data-ps-age inputmode="numeric" autocomplete="off" [value]="age()" [disabled]="!!dob()"
                       (input)="age.set($any($event.target).value)" />
              </label>
              <div class="pf-field">
                <span class="pf-field__lbl">or date of birth</span>
                <pf-date label="Date of birth" [value]="dob()" [max]="today" (valueChange)="dob.set($event)" />
              </div>
              <div class="pf-field">
                <span class="pf-field__lbl">Sex</span>
                <pf-select [options]="sexOptions" [value]="sex()" (valueChange)="sex.set($event)" />
              </div>
              <label class="pf-field">
                <span class="pf-field__lbl">Phone <span class="ps-opt">(optional)</span></span>
                <input class="pf-input" data-ps-phone inputmode="tel" autocomplete="off" [value]="phone()" (input)="phone.set($any($event.target).value)" />
              </label>
            </div>
            @if (duplicateOf()) {
              <p class="ps-err" role="alert" data-ps-duplicate>
                A patient with this name and phone number is already in your list.
              </p>
            } @else if (error()) { <p class="ps-err" role="alert">{{ error() }}</p> }
          </div>
          <footer class="ps-actions">
            <button type="button" class="pf-btn pf-btn--secondary" (click)="backToSearch()" [disabled]="busy()">Back</button>
            @if (duplicateOf(); as dup) {
              <button type="button" class="pf-btn pf-btn--secondary" data-ps-use-existing (click)="choose(dup)" [disabled]="busy()">Use that patient</button>
              <button type="button" class="pf-btn pf-btn--primary" data-ps-add-anyway (click)="add(true)" [disabled]="busy()">Add as new</button>
            } @else {
              <button type="button" class="pf-btn pf-btn--primary" data-ps-add (click)="add(false)" [disabled]="busy() || !canAdd()">
                {{ busy() ? 'Adding…' : 'Add and start' }}
              </button>
            }
          </footer>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .ps-root { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-end; justify-content: center; }
    @media (min-width: 640px) { .ps-root { align-items: center; } }
    .ps-backdrop { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.45); }
    .ps-card {
      position: relative; width: min(560px, 100%); max-height: min(88dvh, 720px); display: flex; flex-direction: column; gap: 12px;
      padding: 18px 16px calc(16px + env(safe-area-inset-bottom, 0px)); background: var(--bg-primary); color: var(--text-primary);
      border: 1px solid var(--border-color, var(--border-primary)); border-radius: 16px 16px 0 0; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.2);
      overflow: auto;
    }
    @media (min-width: 640px) { .ps-card { border-radius: 16px; padding: 20px; } }
    .ps-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .ps-title { margin: 0; font-size: 17px; font-weight: 600; }
    .ps-sub { margin: 2px 0 0; font-size: 13px; color: var(--text-secondary); }
    .ps-x { border: 0; background: transparent; color: var(--text-secondary); border-radius: 8px; padding: 6px; cursor: pointer; }
    .ps-search { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 44px; border-radius: 10px;
      border: 1px solid var(--border-color, var(--border-primary)); background: var(--bg-secondary); color: var(--text-secondary); }
    .ps-search__in::-webkit-search-decoration, .ps-search__in::-webkit-search-cancel-button,
    .ps-search__in::-webkit-search-results-button, .ps-search__in::-webkit-search-results-decoration { display: none; }
    .ps-search__clr { display: inline-grid; place-items: center; flex: none; width: 32px; height: 32px; border: 0; border-radius: 8px;
      background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .ps-search__clr:hover, .ps-search__clr:focus-visible { background: var(--pf-chip-bg); color: var(--text-primary); }
    .ps-search__in { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font-size: 16px; }
    .ps-list { min-height: 120px; }
    .ps-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .ps-row { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px;
      border: 1px solid var(--border-color, var(--border-primary)); background: var(--bg-primary); color: var(--text-primary); cursor: pointer; }
    .ps-row:hover { background: var(--bg-secondary); }
    .ps-row__name { font-weight: 600; font-size: 15px; }
    .ps-row__meta { font-size: 13px; color: var(--text-secondary); }
    .ps-note { margin: 16px 0; text-align: center; color: var(--text-secondary); font-size: 14px; }
    .ps-err { margin: 0; color: var(--danger-text, var(--color-danger, #b42318)); font-size: 14px; }
    .ps-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
    @media (min-width: 640px) { .ps-grid { grid-template-columns: 1fr 1fr; } }
    .ps-opt { color: var(--text-tertiary, var(--text-secondary)); font-weight: 400; }
    .ps-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
  `],
})
export class CsPatientStepComponent implements OnDestroy {
  private readonly patients = inject(CasePatientsApi);

  /** The case sheet being started (shown under the title). */
  readonly formTitle = input<string>('');
  /** The patient whose sheet starts now. */
  readonly chosen = output<string>();
  readonly cancelled = output<void>();

  protected readonly sexOptions = SEX_OPTIONS;
  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly meta = patientMeta;

  protected readonly adding = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly query = signal('');
  protected readonly results = signal<CasePatient[]>([]);
  protected readonly searching = signal(false);
  protected readonly searched = signal(false);

  protected readonly first = signal('');
  protected readonly last = signal('');
  protected readonly age = signal('');
  protected readonly dob = signal<string | null>(null);
  protected readonly sex = signal('');
  protected readonly phone = signal('');
  protected readonly duplicateOf = signal<string | null>(null);

  protected readonly canAdd = computed(() => {
    if (!this.first().trim()) return false;
    const a = readAge(this.age());
    return !Number.isNaN(a) && (a != null || !!this.dob());
  });

  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor() {
    void this.runSearch('');   // the most recent patients first
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  protected onQuery(v: string): void {
    this.query.set(v);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.runSearch(v), 250);
  }

  private async runSearch(q: string): Promise<void> {
    const mine = ++this.seq;
    this.searching.set(true);
    this.error.set('');
    try {
      const rows = await this.patients.search(q);
      if (mine !== this.seq) return;
      this.results.set(rows);
      this.searched.set(!!q.trim());
    } catch {
      if (mine !== this.seq) return;
      this.results.set([]);
      this.error.set("Couldn't search your patients just now. Please try again.");
    } finally {
      if (mine === this.seq) this.searching.set(false);
    }
  }

  protected startAdding(): void {
    this.error.set('');
    this.duplicateOf.set(null);
    // a typed search that looks like a name seeds the first / last name
    const q = this.query().trim();
    if (q && !/\d/.test(q) && !this.first()) {
      const [f, ...rest] = q.split(/\s+/);
      this.first.set(f);
      this.last.set(rest.join(' '));
    } else if (q && /^[+\d\s-]{6,}$/.test(q) && !this.phone()) {
      this.phone.set(q);
    }
    this.adding.set(true);
  }

  protected backToSearch(): void {
    this.adding.set(false);
    this.error.set('');
    this.duplicateOf.set(null);
  }

  protected async add(force: boolean): Promise<void> {
    if (this.busy() || (!force && !this.canAdd())) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const age = readAge(this.age());
      const p = await this.patients.create({
        firstName: this.first(),
        lastName: this.last(),
        sex: this.sex() || null,
        dateOfBirth: this.dob(),
        age: this.dob() ? null : age,
        phone: this.phone(),
        force,
      });
      this.chosen.emit(p.id);
    } catch (e) {
      if (e instanceof CasePatientError && e.code === 'duplicate_patient' && e.duplicateOf) this.duplicateOf.set(e.duplicateOf);
      else this.error.set(e instanceof CasePatientError ? e.message : "Couldn't add this patient. Please try again.");
    } finally {
      this.busy.set(false);
    }
  }

  protected choose(id: string): void {
    if (this.busy()) return;
    this.chosen.emit(id);
  }

  protected cancel(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }
}
