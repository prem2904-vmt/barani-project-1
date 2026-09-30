import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import {
  allowedSpecimensFor, findAllowed, fixedSpecimenOf, specimenModeOf,
  type AllowedSpecimen, type TestSpecimenMap,
} from '../../../shared/utils/micro-specimen';
import { opdAsksSpecimen, type OpdSpecimenTest } from './opd-specimen';

/**
 * "Choose the specimen" control for ONE picked lab test — the same rule as
 * the lab's own order desk (`features/frontdesk/order-create`, the
 * `micro-specimen.ts` twin of the server's `SpecimenRules`), reusable
 * wherever OPD picks a lab test: today the front desk's booking screen
 * (`book-visit.page`), and — per the orchestrator's wiring note — the
 * doctor's consult investigations step once that coder is free.
 *
 * - "none" mode: renders nothing.
 * - "fixed" mode: a plain "Specimen · <name>" line — no picker, the server
 *   stamps it.
 * - "choose" mode: a searchable `pf-select` (never a native `<select>`) over
 *   the test's allowed specimens, falling back to the tenant's Specimen
 *   master when the test has no mapping of its own (server does the same).
 *   `invalid` (set by the host after a blocked Complete / Checkout) shows
 *   the same inline error `order-create` uses.
 *
 * Owns its own fetch of `/api/microbiology/test-specimens` + `/specimens`
 * (cached per test id) — a host only needs to pass `test` + `value` and
 * listen to `valueChange`; it never needs the raw allowed-list wiring
 * itself.
 */
@Component({
  selector: 'pf-opd-specimen-picker',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mode() === 'fixed') {
      @if (fixedName(); as name) { <p class="pf-opd-spec__fixed">Specimen · {{ name }}</p> }
    } @else if (mode() === 'choose') {
      <div class="pf-opd-spec" [class.pf-opd-spec--err]="invalid() && !value()">
        <pf-select size="sm" [searchable]="true" [options]="options()" [value]="value() ?? ''"
          placeholder="Choose specimen…" [attr.aria-invalid]="invalid() && !value() ? 'true' : null"
          (valueChange)="pick($event)"></pf-select>
        @if (invalid() && !value()) { <p class="pf-opd-spec__err" role="alert">Choose the specimen for {{ test().name }}.</p> }
      </div>
    }
  `,
  styles: [`
    .pf-opd-spec { margin-top: 4px; max-width: 240px; }
    .pf-opd-spec--err :is(button, input) { border-color: var(--danger, #ef4444) !important; }
    .pf-opd-spec__err { margin: 4px 0 0; font-size: 12px; color: var(--danger, #ef4444); }
    .pf-opd-spec__fixed { margin: 2px 0 0; font-size: 12px; color: var(--muted, #6b7280); }
  `],
})
export class OpdSpecimenPickerComponent {
  private readonly api = inject(ApiService);

  /** The picked lab test — `parameters` carries `specimenMode` (the summary
   *  view already trims it in, `GET /api/tests?view=summary`). */
  readonly test = input.required<{ id: string; name: string; parameters?: string | null }>();
  /** The chosen specimen: a master CODE (new picks) or NAME (older drafts). */
  readonly value = input<string | null>(null);
  /** Set by the host after a blocked Complete / Checkout — shows the inline error. */
  readonly invalid = input(false);
  readonly valueChange = output<string>();

  private readonly _map = signal<TestSpecimenMap | undefined>(undefined);
  private readonly _master = signal<AllowedSpecimen[]>([]);

  readonly mode = computed(() => specimenModeOf(this.test().parameters));
  readonly asks = computed(() => opdAsksSpecimen(this.test() as OpdSpecimenTest));
  readonly fixedName = computed(() => fixedSpecimenOf(this._map())?.name ?? null);
  readonly options = computed<PfSelectOption[]>(() => {
    const t = this.test();
    const maps: Record<string, TestSpecimenMap | undefined> = { [t.id]: this._map() };
    return allowedSpecimensFor(t, maps, this._master()).map(s => ({ value: s.code, label: s.name }));
  });
  /** The value's label, honouring an allowed-list or master-list code/name
   *  (a stored code shows its NAME; an older stored name passes through). */
  readonly label = computed(() => {
    const v = this.value();
    if (!v) return '';
    const allowed = this._map()?.specimens ?? [];
    return findAllowed(allowed, v)?.name ?? findAllowed(this._master(), v)?.name ?? v;
  });

  private loadedFor: string | null = null;

  constructor() {
    effect(() => {
      const t = this.test();
      if (!t?.id || this.loadedFor === t.id || specimenModeOf(t.parameters) === 'none') return;
      this.loadedFor = t.id;
      untracked(() => this.load(t.id));
    });
  }

  private load(testId: string): void {
    this.api.get<TestSpecimenMap[]>(`/api/microbiology/test-specimens?testIds=${testId}`).subscribe({
      next: rows => this._map.set(rows?.find(r => r.testId === testId) ?? { testId, specimens: [] }),
      error: () => this._map.set({ testId, specimens: [] }),
    });
    this.api.get<{ code: string; name: string; container?: string | null }[]>('/api/microbiology/specimens').subscribe({
      next: rows => this._master.set((rows ?? []).map(r => ({ code: r.code, name: r.name, isDefault: false, container: r.container ?? null }))),
      error: () => { /* no master fallback — the test's own allowed list still works */ },
    });
  }

  pick(v: string): void { this.valueChange.emit(v); }
}
