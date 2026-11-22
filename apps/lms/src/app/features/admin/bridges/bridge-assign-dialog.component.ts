import { stableJson } from '../../../shared/utils/dirty-snapshot';
import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ModalPortalDirective } from '../../../shared/directives/modal-portal.directive';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ApiError } from '../../../shared/models/api-response.model';
import { BridgesApiService } from '../../../shared/bridges/bridges-api.service';
import { InstrumentsApiService } from '../../../shared/instruments/instruments-api.service';
import type { BridgeDto } from '../../../shared/bridges/bridge.models';
import type { InstrumentDto, LinkType } from '../../../shared/instruments/instrument.models';
import {
  BridgeAssignForm, FRAMING_OPTIONS, assignFormFrom, configFor, configUnchanged, upsertWithConfig, validateAssign,
} from '../../../shared/bridges/bridge-assign';
import { bridgeErrorText } from '../../../shared/bridges/bridge-status';
import { linkableInstruments } from './detected-source-link-dialog.component';

/**
 * Put an analyzer on a Bridge (or change how the Bridge reaches it): which
 * analyzer, LISTEN on a port (the analyzer connects to the Bridge) or
 * CONNECT to the analyzer's address, and the framing. Saves the analyzer's
 * connection first (only when it changed), then `PUT /api/instruments/{id}/bridge`.
 */
@Component({
  selector: 'pf-bridge-assign-dialog',
  standalone: true,
  imports: [ModalPortalDirective, BusyDirective, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-dialog" role="dialog" aria-modal="true" aria-labelledby="pf-bad-title" pfModalPortal>
      <div class="pf-dialog__backdrop" (click)="close()"></div>
      <form class="pf-dialog__card" (submit)="$event.preventDefault(); save()">
        <header class="pf-dialog__head">
          <span class="pf-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4"/></svg>
          </span>
          <div class="pf-dialog__titles">
            <h2 id="pf-bad-title" class="pf-card__label">{{ editing() ? 'Analyzer connection' : 'Assign analyzer' }}</h2>
            <p class="pf-dialog__sub">{{ bridge().name }} · analyzer network 192.168.50.x</p>
          </div>
          <button type="button" class="pf-btn pf-btn--icon" (click)="close()" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div class="pf-dialog__body">
          <div class="pf-field">
            <span class="pf-field__lbl" id="pf-bad-inst">Analyzer</span>
            <pf-select aria-labelledby="pf-bad-inst" [options]="options()" [value]="form().instrumentId" [searchable]="true" [disabled]="editing()"
                       placeholder="Pick the analyzer" (valueChange)="pickInstrument($event)"></pf-select>
            @if (touched() && issue('instrumentId')) { <span class="pf-bad__err" role="alert">{{ issue('instrumentId') }}</span> }
          </div>

          <div class="pf-field">
            <span class="pf-field__lbl" id="pf-bad-mode">How they connect</span>
            <div class="pf-seg pf-bad__seg" role="radiogroup" aria-labelledby="pf-bad-mode">
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="form().mode === 'listen'" (click)="patch({ mode: 'listen' })">Analyzer connects to the Bridge</button>
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="form().mode === 'connect'" (click)="patch({ mode: 'connect' })">Bridge connects to the analyzer</button>
            </div>
          </div>

          <div class="pf-bad__row">
            @if (form().mode === 'connect') {
              <label class="pf-field">
                <span class="pf-field__lbl">Analyzer IP address</span>
                <input class="pf-input pf-num" inputmode="decimal" [class.pf-input--error]="touched() && !!issue('host')" [value]="form().host"
                       (input)="patch({ host: $any($event.target).value })" placeholder="192.168.50.20" autocomplete="off" />
                @if (touched() && issue('host')) { <span class="pf-bad__err" role="alert">{{ issue('host') }}</span> }
              </label>
            }
            <label class="pf-field">
              <span class="pf-field__lbl">{{ form().mode === 'listen' ? 'Bridge port' : 'Analyzer port' }}</span>
              <input class="pf-input pf-num" inputmode="numeric" [class.pf-input--error]="touched() && !!issue('port')" [value]="form().port ?? ''"
                     (input)="patch({ port: toPort($any($event.target).value) })" placeholder="e.g. 6661" autocomplete="off" />
              @if (touched() && issue('port')) { <span class="pf-bad__err" role="alert">{{ issue('port') }}</span> }
            </label>
            <div class="pf-field">
              <span class="pf-field__lbl" id="pf-bad-fr">Framing</span>
              <pf-select aria-labelledby="pf-bad-fr" [options]="framingOptions" [value]="form().framing" (valueChange)="patch({ framing: $event })"></pf-select>
            </div>
          </div>
          <p class="pf-field__hint">
            @if (form().mode === 'listen') { Set the analyzer's LIS host to the Bridge (192.168.50.1) and this port. }
            @else { The analyzer gets an address from the Bridge (192.168.50.100–199) or keeps a fixed one — enter what its network screen shows. }
          </p>
          @if (error()) { <p class="pf-bad__err" role="alert">{{ error() }}</p> }
        </div>

        <footer class="pf-dialog__foot">
          <button type="button" class="pf-btn pf-btn--secondary" [disabled]="saving()" (click)="close()">Cancel</button>
          <button type="submit" class="pf-btn pf-btn--primary" [disabled]="saving() || !changed()" [pfBusyInactive]="saving() || !changed()"
                  [attr.title]="changed() || saving() ? null : 'No changes to save'" [pfBusy]="saving()" pfBusyLabel="Saving…">
            {{ saving() ? 'Saving…' : (editing() ? 'Save connection' : 'Assign to Bridge') }}
          </button>
        </footer>
      </form>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .pf-bad__seg { flex-wrap: wrap; }
    .pf-bad__row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .pf-bad__err { margin: 0; font-size: 12px; color: var(--red-text, #dc2626); }
    @media (max-width: 640px) { .pf-card__label { font-size: 12px !important; line-height: 1.3 !important; } }
    @media (max-width: 640px) { .pf-bad__row { grid-template-columns: minmax(0, 1fr); } .pf-bad__seg .pf-seg__item { min-height: 44px; } }
  `],
})
export class BridgeAssignDialogComponent implements OnInit {
  private readonly bridgesApi = inject(BridgesApiService);
  private readonly instrumentsApi = inject(InstrumentsApiService);

  readonly bridge = input.required<BridgeDto>();
  readonly instruments = input<InstrumentDto[]>([]);
  /** Set = edit this analyzer's connection (already on the Bridge). */
  readonly instrument = input<InstrumentDto | null>(null);
  readonly closed = output<void>();
  readonly saved = output<InstrumentDto>();

  readonly form = signal<BridgeAssignForm>({ instrumentId: '', mode: 'listen', port: null, host: '', framing: 'auto' });
  readonly touched = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly editing = computed(() => !!this.instrument());
  readonly framingOptions: PfSelectOption<LinkType>[] = FRAMING_OPTIONS.map((o) => ({ ...o }));

  /** Analyzers already on this Bridge (for the port clash check). */
  readonly onBridge = computed(() => this.instruments().filter((i) => i.bridgeId === this.bridge().id));
  readonly options = computed<PfSelectOption<string>[]>(() => {
    const pool = this.editing() ? this.instruments().filter((i) => i.id === this.instrument()?.id)
      : linkableInstruments(this.instruments(), this.bridge()).filter((i) => i.bridgeId !== this.bridge().id);
    return pool.map((i) => ({
      value: i.id, label: i.name,
      hint: i.bridgeId ? `On ${i.bridgeName || 'another Bridge'} — moves here` : (i.config?.transport?.type === 'serial' ? 'Serial today — switches to the network' : 'This computer today'),
    }));
  });
  readonly issues = computed(() => validateAssign(this.form(), this.onBridge()));

  ngOnInit(): void {
    const i = this.instrument();
    if (i) { this.form.set(assignFormFrom(i)); this.base.set(stableJson(this.form())); }
  }
  /** Save only when something changed (owner 2026-11-19): an existing connection compared with how it was opened;
   *  a new assignment has nothing saved yet. */
  private readonly base = signal('');
  readonly changed = computed(() => !this.editing() || stableJson(this.form()) !== this.base());

  @HostListener('document:keydown.escape')
  onEscape() { if (!this.saving()) this.close(); }

  issue(f: string): string | null { return this.issues().find((x) => x.field === f)?.message ?? null; }
  toPort(v: string): number | null { const n = Number(String(v).replace(/\D/g, '')); return String(v).trim() && Number.isFinite(n) ? n : null; }
  patch(p: Partial<BridgeAssignForm>): void { this.form.update((f) => ({ ...f, ...p })); }

  pickInstrument(id: string): void {
    const i = this.instruments().find((x) => x.id === id);
    this.form.set(i ? assignFormFrom(i) : { ...this.form(), instrumentId: id });
  }

  close(): void { this.closed.emit(); }

  async save(): Promise<void> {
    this.touched.set(true);
    if (this.issues().length || this.saving()) return;
    const f = this.form();
    const inst = this.instruments().find((i) => i.id === f.instrumentId) ?? this.instrument();
    if (!inst) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      let current = inst;
      if (!configUnchanged(f, inst)) {
        current = await firstValueFrom(this.instrumentsApi.update(inst.id, upsertWithConfig(inst, configFor(f, inst.config))));
      }
      const result = current.bridgeId === this.bridge().id ? current : await firstValueFrom(this.bridgesApi.assignInstrument(inst.id, this.bridge().id));
      this.saving.set(false);
      this.saved.emit(result);
    } catch (e) {
      this.saving.set(false);
      const err = ApiError.from(e);
      this.error.set(bridgeErrorText(err.code, err.message));
    }
  }
}

