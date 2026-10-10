import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { ModalPortalDirective } from '../../../shared/directives/modal-portal.directive';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ApiError } from '../../../shared/models/api-response.model';
import { BridgesApiService } from '../../../shared/bridges/bridges-api.service';
import type { BridgeDto, DetectedSourceDto, DetectedSourceLinkRequest } from '../../../shared/bridges/bridge.models';
import type { InstrumentDto } from '../../../shared/instruments/instrument.models';
import { bridgeErrorText, detectedSourceHeadline, framingWord } from '../../../shared/bridges/bridge-status';

type Mode = 'existing' | 'create';

/** Instruments a source may link to: active, in the Bridge's branch. */
export function linkableInstruments(list: readonly InstrumentDto[], bridge: Pick<BridgeDto, 'branchId'>): InstrumentDto[] {
  return list.filter((i) => i.isActive !== false && (!i.branchId || i.branchId === bridge.branchId));
}

/**
 * "Sysmex XN-350 connected on port 6661 — link it?" Link the unknown source a
 * Bridge reported to an EXISTING analyzer of the Bridge's branch, or CREATE
 * one prefilled from the server's guess (make / model / code-map profile).
 * The server writes the connection (listen port / connect host) from the
 * source and flushes the Bridge's held messages into the analyzer.
 */
@Component({
  selector: 'pf-detected-source-link-dialog',
  standalone: true,
  imports: [ModalPortalDirective, BusyDirective, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="nd-dialog" role="dialog" aria-modal="true" aria-labelledby="pf-dsl-title" pfModalPortal>
      <div class="nd-dialog__backdrop" (click)="close()"></div>
      <form class="nd-dialog__card" (submit)="$event.preventDefault(); save()">
        <header class="nd-dialog__head">
          <span class="nd-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
          </span>
          <div class="nd-dialog__titles">
            <h2 id="pf-dsl-title" class="nd-card__label">Link analyzer</h2>
            <p class="nd-dialog__sub">{{ headline() }} · {{ framing() }}{{ source().quarantined ? ' · ' + source().quarantined + ' results held' : '' }}</p>
          </div>
          <button type="button" class="nd-btn nd-btn--icon" (click)="close()" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div class="nd-dialog__body">
          <div class="nd-seg pf-dsl__seg" role="radiogroup" aria-label="Link to">
            <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="mode() === 'create'" (click)="mode.set('create')">New analyzer</button>
            <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="mode() === 'existing'" (click)="mode.set('existing')" [disabled]="!options().length">Existing analyzer</button>
          </div>

          @if (mode() === 'existing') {
            <div class="nd-field">
              <span class="nd-field__lbl" id="pf-dsl-inst">Analyzer in {{ bridge().branchName || 'this branch' }}</span>
              <pf-select aria-labelledby="pf-dsl-inst" [options]="options()" [value]="instrumentId()" [searchable]="true" placeholder="Pick the analyzer"
                         (valueChange)="instrumentId.set($event)"></pf-select>
              <span class="nd-field__hint">Its connection is set from what the Bridge saw, if it has none yet. Code mapping stays as it is.</span>
            </div>
          } @else {
            <label class="nd-field">
              <span class="nd-field__lbl">Name</span>
              <input class="nd-input" [value]="name()" (input)="name.set($any($event.target).value)" maxlength="120" autocomplete="off" />
            </label>
            <div class="pf-dsl__row">
              <label class="nd-field"><span class="nd-field__lbl">Make</span>
                <input class="nd-input" [value]="make()" (input)="make.set($any($event.target).value)" autocomplete="off" /></label>
              <label class="nd-field"><span class="nd-field__lbl">Model</span>
                <input class="nd-input" [value]="model()" (input)="model.set($any($event.target).value)" autocomplete="off" /></label>
            </div>
            @if (source().guess?.profileKey) {
              <p class="nd-field__hint">Codes are mapped with the {{ source().guess?.label || 'matching' }} profile — check them in the analyzer's Code mapping.</p>
            }
          }
          <p class="nd-field__hint">Results stay a prefill: the technician checks and submits every value.</p>
          @if (error()) { <p class="pf-dsl__err" role="alert">{{ error() }}</p> }
        </div>

        <footer class="nd-dialog__foot">
          <button type="button" class="nd-btn nd-btn--secondary" [disabled]="saving()" (click)="close()">Cancel</button>
          <button type="submit" class="nd-btn nd-btn--primary" [disabled]="!canSave() || saving()" [pfBusy]="saving()" pfBusyLabel="Linking…">
            {{ saving() ? 'Linking…' : 'Link analyzer' }}
          </button>
        </footer>
      </form>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .pf-dsl__seg { align-self: flex-start; }
    .pf-dsl__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .pf-dsl__err { margin: 0; font-size: 12.5px; color: var(--red-text, #dc2626); }
    @media (max-width: 640px) { .pf-dsl__row { grid-template-columns: minmax(0, 1fr); } .pf-dsl__seg { align-self: stretch; } }
  `],
})
export class DetectedSourceLinkDialogComponent implements OnInit {
  private readonly api = inject(BridgesApiService);

  readonly bridge = input.required<BridgeDto>();
  readonly source = input.required<DetectedSourceDto>();
  readonly instruments = input<InstrumentDto[]>([]);
  readonly closed = output<void>();
  readonly linked = output<{ source: DetectedSourceDto; instrument: InstrumentDto }>();

  readonly mode = signal<Mode>('create');
  readonly instrumentId = signal<string>('');
  readonly name = signal('');
  readonly make = signal('');
  readonly model = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  private seeded = false;

  readonly headline = computed(() => detectedSourceHeadline(this.source()));
  readonly framing = computed(() => framingWord(this.source().framing));
  readonly options = computed<PfSelectOption<string>[]>(() => linkableInstruments(this.instruments(), this.bridge()).map((i) => ({
    value: i.id,
    label: i.name,
    hint: [i.make, i.model].filter(Boolean).join(' ') + (i.bridgeId && i.bridgeId !== this.bridge().id ? ` · on ${i.bridgeName || 'another Bridge'}` : ''),
  })));
  readonly canSave = computed(() => this.mode() === 'existing' ? !!this.instrumentId() : this.name().trim().length > 0 && this.name().trim().length <= 120);

  ngOnInit(): void {
    if (this.seeded) return;
    this.seeded = true;
    const g = this.source().guess;
    this.name.set(g?.label || [g?.make, g?.model].filter(Boolean).join(' ') || this.source().header?.hl7?.sendingApp || 'New analyzer');
    this.make.set(g?.make ?? '');
    this.model.set(g?.model ?? '');
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (!this.saving()) this.close(); }

  close(): void { this.closed.emit(); }

  save(): void {
    if (!this.canSave() || this.saving()) return;
    const g = this.source().guess;
    const body: DetectedSourceLinkRequest = this.mode() === 'existing'
      ? { instrumentId: this.instrumentId() }
      : { create: { name: this.name().trim(), make: this.make().trim() || undefined, model: this.model().trim() || undefined, profileKey: g?.profileKey || undefined } };
    this.saving.set(true);
    this.error.set(null);
    this.api.linkSource(this.bridge().id, this.source().id, body).subscribe({
      next: (r) => { this.saving.set(false); this.linked.emit(r); },
      error: (e) => { this.saving.set(false); const err = ApiError.from(e); this.error.set(bridgeErrorText(err.code, err.message)); },
    });
  }
}
