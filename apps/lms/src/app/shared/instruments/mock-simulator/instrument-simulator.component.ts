import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../../core/services/toast.service';
import { SelectComponent, PfSelectOption } from '../../primitives/select.component';
import { InstrumentBridgeService } from '../instrument-bridge.service';
import { CodeMapRow } from '../instrument-config';
import { ConnectorState, ParserType } from '../instrument.models';
import { GeneratedSimulation } from '../analyzer-simulation.service';
import {
  MockScenarioKey,
  ProtocolDiscipline,
  resolveScenarioForDiscipline,
  scenariosForDiscipline,
} from './mock-result-data';

@Component({
  selector: 'pf-instrument-simulator',
  standalone: true,
  imports: [CommonModule, SelectComponent],
  template: `
    <div class="pf-ie-sim-card" role="region" aria-label="Analyzer simulator">
      <div class="pf-ie-sim-header">
        <span class="pf-ie-sim-tag">Simulator</span>
        <span class="pf-ie-sim-title">Virtual Analyzer Frame Generator</span>
        <span class="pf-field__hint">Simulate real analyzer transmissions, framed packets, and auto-detection with 5 distinct clinical profiles.</span>
      </div>
      <div class="pf-ie-sim-controls">
        <div class="pf-field">
          <span class="pf-field__lbl">Protocol & Device</span>
          <pf-select [options]="protocolOptions" [value]="simProtocol()" (valueChange)="simProtocol.set($event)"></pf-select>
        </div>
        <div class="pf-field">
          <span class="pf-field__lbl">Clinical Scenario</span>
          <pf-select [options]="scenarioOptions()" [value]="simScenario()" (valueChange)="simScenario.set($event)"></pf-select>
        </div>
        <div class="pf-field">
          <span class="pf-field__lbl">Sample ID</span>
          <input
            class="pf-input pf-num"
            [value]="simSampleId()"
            (input)="simSampleId.set($any($event.target).value)"
            placeholder="e.g. 26354"
            autocomplete="off"
          />
        </div>
        <div class="pf-ie-sim-actions">
          <button
            type="button"
            class="pf-btn pf-btn--secondary press"
            [disabled]="simStreaming()"
            (click)="simulateRun()"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            {{ simStreaming() ? 'Streaming…' : 'Stream run' }}
          </button>
          <button
            type="button"
            class="pf-btn pf-btn--quiet press"
            [disabled]="simInjecting()"
            (click)="injectSimulatedToLis()"
            title="Post message directly to LIS so Result Entry can fetch it"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {{ simInjecting() ? 'Sending…' : 'Send to LIS' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .pf-ie-sim-card {
      margin-top: 14px;
      padding: 16px;
      border-radius: var(--pf-radius-md, 12px);
      background: color-mix(in srgb, var(--pf-color-primary, #a855f7) 6%, transparent);
      border: 1px dashed color-mix(in srgb, var(--pf-color-primary, #a855f7) 35%, transparent);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pf-ie-sim-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
    }
    .pf-ie-sim-tag {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--pf-color-primary, #a855f7);
      color: #fff;
    }
    .pf-ie-sim-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-ie-sim-controls {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      align-items: flex-end;
    }
    .pf-ie-sim-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pf-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .pf-field__lbl {
      font-size: 12px;
      color: var(--text-secondary);
      font-weight: 500;
    }
    .pf-field__hint {
      font-size: 12px;
      color: var(--text-muted);
      width: 100%;
    }
    .pf-input {
      height: 32px;
      padding: 0 10px;
      font-size: 13px;
      border-radius: var(--pf-radius-sm, 8px);
      border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
      background: var(--bg-surface, rgba(0, 0, 0, 0.2));
      color: var(--text-primary);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstrumentSimulatorComponent {
  private readonly bridge = inject(InstrumentBridgeService);
  private readonly toasts = inject(ToastService);

  readonly instrumentId = input<string | null>(null);
  readonly maps = input<CodeMapRow[]>([]);
  readonly protocol = input<ParserType>('astm');

  readonly rawCaptured = output<string>();
  readonly simulationRun = output<GeneratedSimulation>();

  readonly simProtocol = signal<ParserType>('astm');
  readonly simScenario = signal<MockScenarioKey>('random');
  readonly simSampleId = signal<string>('26354');
  readonly simStreaming = signal<boolean>(false);
  readonly simInjecting = signal<boolean>(false);

  readonly protocolOptions: PfSelectOption<ParserType>[] = [
    { value: 'astm', label: 'ASTM E1381/E1394 (5-Part CBC & Chem)' },
    { value: 'hl7', label: 'HL7 v2.3.1 (MLLP CBC)' },
    { value: 'lifedx-hbpro', label: 'LifeDx HBPro (STX/ETX HPLC HbA1c)' },
    { value: 'sinocare-fhir', label: 'Sinocare iCARE-2100 (POCT FHIR)' },
    { value: 'text', label: 'Text Ticket (3-Part Delimited)' },
  ];

  readonly discipline = computed<ProtocolDiscipline>(() => {
    const proto = this.simProtocol();
    if (proto === 'lifedx-hbpro') return 'hplc';
    if (proto === 'sinocare-fhir') return 'poct';
    if (proto === 'text') return 'text3part';
    const hasChem = (this.maps() || []).some((m) =>
      /glucose|sugar|rbs|fbs|ppbs|urea|creat|chol|trig|ast|alt|sgot|sgpt|bil/i.test(m.testName || m.analyzerCode || '')
    );
    if (hasChem) return 'chemistry';
    return 'haematology';
  });

  readonly scenarioOptions = computed<PfSelectOption<MockScenarioKey>[]>(() => {
    return scenariosForDiscipline(this.discipline()).map((s) => ({
      value: s.key,
      label: s.label,
      hint: s.description,
    }));
  });

  constructor() {
    effect(() => {
      const p = this.protocol();
      if (p && p !== 'auto') {
        this.simProtocol.set(p);
      }
    });
  }

  async simulateRun(): Promise<void> {
    this.simStreaming.set(true);
    try {
      const editorMaps = this.maps().map((m) => ({
        id: `row-${m.analyzerCode}`,
        analyzerCode: m.analyzerCode,
        testCatalogKey: m.testCatalogKey,
        testName: m.testName,
        factor: m.factor,
        offset: m.offset ?? 0,
        decimals: m.decimals,
        unit: m.unit,
        isActive: true,
      }));

      const meta = resolveScenarioForDiscipline(this.discipline(), this.simScenario());
      const sim = await this.bridge.sim.streamSimulatedRun({
        protocol: this.simProtocol(),
        scenario: meta.key as any,
        sampleId: (this.simSampleId() || '26354').trim(),
        codeMaps: editorMaps,
      });

      this.rawCaptured.emit(sim.rawText);
      this.simulationRun.emit(sim);

      this.toasts.success(`Simulated ${sim.protocol.toUpperCase()}: ${meta.label} for sample ${sim.sampleId}`);
    } catch {
      this.toasts.error('Simulation streaming failed');
    } finally {
      this.simStreaming.set(false);
    }
  }

  async injectSimulatedToLis(): Promise<void> {
    const id = this.instrumentId();
    this.simInjecting.set(true);
    try {
      const editorMaps = this.maps().map((m) => ({
        id: `row-${m.analyzerCode}`,
        analyzerCode: m.analyzerCode,
        testCatalogKey: m.testCatalogKey,
        testName: m.testName,
        factor: m.factor,
        offset: m.offset ?? 0,
        decimals: m.decimals,
        unit: m.unit,
        isActive: true,
      }));

      const meta = resolveScenarioForDiscipline(this.discipline(), this.simScenario());
      const res = await this.bridge.sim.injectToDatabase(id || 'sim-analyzer-01', {
        protocol: this.simProtocol(),
        scenario: meta.key as any,
        sampleId: (this.simSampleId() || '26354').trim(),
        codeMaps: editorMaps,
      });

      if (res.ok) {
        if ((res as any).raw) {
          this.rawCaptured.emit((res as any).raw);
        }
        if ((res as any).sim) {
          this.simulationRun.emit((res as any).sim);
        }
        this.toasts.success(`Injected ${meta.label} for sample ${this.simSampleId()} into LIS messages.`);
      } else {
        this.toasts.error(res.error || 'Failed to inject message');
      }
    } catch {
      this.toasts.error('Could not inject simulated run');
    } finally {
      this.simInjecting.set(false);
    }
  }

  setSimConnectionState(state: ConnectorState): void {
    const id = this.instrumentId() || 'sim-analyzer-01';
    (this.bridge.sim as unknown as { broadcastStatus?: (i: string, s: ConnectorState) => void }).broadcastStatus?.(id, state);
    this.toasts.info(`Simulated connection set to ${state}`);
  }
}
