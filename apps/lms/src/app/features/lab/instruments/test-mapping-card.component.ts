import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { PfKeysDirective } from '../../../shared/components/numpad/pf-keys.directive';
import { SamplePresetDirective } from '../../../shared/directives/sample-preset.directive';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { TestMappingService } from '../../../shared/instruments/test-mapping.service';
import { TEST_MAPPING_QUIET_S, testMappingLine } from '../../../shared/instruments/test-mapping';

/**
 * "Test with an analyzer ID" — the small inline card on an instrument's
 * Status tab (owner 2026-10-31: one-time, no extra screen, no alias list).
 *
 *   [analyzer ID] → [Prefrontal sample] [Start]
 *   ● Waiting for 8507 → sample 26117…                              [Close]
 *   ✓ Receiving from 8507 → 26117 — 3 results so far. Finishes after
 *     90 s with no new results (1:12 left).                     [Finish now]
 *   ✓ Done — 5 results attached to 26117.          (above the empty form)
 *
 * The session itself lives in the root TestMappingService (keep-alive,
 * window close, logout); the card only renders it, so switching tabs never ends
 * it — the instrument screen (InstrumentEditorComponent) ends it on route leave.
 */
@Component({
  selector: 'pf-test-mapping-card',
  standalone: true,
  imports: [PfKeysDirective, SamplePresetDirective, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './test-mapping-card.component.html',
  styleUrl: './test-mapping-card.component.scss',
})
export class TestMappingCardComponent {
  protected readonly svc = inject(TestMappingService);
  protected readonly quietS = TEST_MAPPING_QUIET_S;

  readonly instrumentId = input.required<string>();
  /** The newest unmatched result's analyzer ID (prefilled while the box is untouched). */
  readonly suggestedId = input<string>('');
  /** Results were routed — the host reloads its result list. */
  readonly routed = output<void>();

  readonly analyzerId = signal('');
  readonly sampleCode = signal('');
  readonly error = signal<string | null>(null);
  private idTouched = false;

  private readonly sampleInput = viewChild<ElementRef<HTMLInputElement>>('sampleInput');

  /** The running test, only when it is THIS instrument's. */
  readonly running = computed(() => {
    const a = this.svc.active();
    return a && a.instrumentId === this.instrumentId() ? a : null;
  });
  readonly line = computed(() => { const a = this.running(); return a ? testMappingLine(a) : ''; });
  readonly canStart = computed(() => !!this.analyzerId().trim() && !!this.sampleCode().trim() && !this.svc.busy() && !this.svc.active());

  constructor() {
    effect(() => {
      const s = this.suggestedId();
      if (!this.idTouched) untracked(() => this.analyzerId.set(s ?? ''));
    });
    let tick = untracked(() => this.svc.routedTick());
    effect(() => {
      const t = this.svc.routedTick();
      if (t !== tick) { tick = t; untracked(() => this.routed.emit()); }
    });
  }

  setAnalyzerId(v: string) { this.idTouched = true; this.analyzerId.set(v); this.error.set(null); }
  setSampleCode(v: string) { this.sampleCode.set(v); this.error.set(null); }

  /** "Test with this ID" on an unmatched result: prefill + jump to the sample box. */
  useId(id: string) {
    this.setAnalyzerId(id.trim());
    this.svc.note.set(null);
    queueMicrotask(() => this.sampleInput()?.nativeElement.focus());
  }

  async start() {
    if (!this.canStart()) return;
    this.error.set(null);
    const r = await this.svc.start(this.instrumentId(), this.analyzerId(), this.sampleCode());
    if (!r.ok) { this.error.set(r.error); return; }
    this.sampleCode.set('');
  }

  close() { void this.svc.end('closed'); }
  dismissNote() { this.svc.note.set(null); }
}
