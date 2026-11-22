import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../../core/services/toast.service';
import { OrderSample } from '../../models/order.model';
import { InstrumentsApiService } from '../instruments-api.service';
import { AnalyzerSimulationService } from '../analyzer-simulation.service';
import { CodeMapDto, MappedValue, ParserType, RunDto } from '../instrument.models';
import { PrefillLine } from '../instrument-prefill';
import {
  MockScenarioKey,
  MockScenarioMeta,
  ProtocolDiscipline,
  detectDiscipline,
  extractMockValueFromMap,
  formatMockConvertedValue,
  resolveScenarioForDiscipline,
  scenariosForDiscipline,
} from './mock-result-data';

@Component({
  selector: 'pf-sample-result-simulator',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (canSimulate()) {
      <div class="pf-sre-sim-wrap" role="region" aria-label="Mock analyzer simulator">
        <!-- Merged Split Button: Single click runs simulation (default: random) -->
        <div class="pf-sre-sim-split" [class.pf-sre-sim-split--open]="menuOpen()">
          <button
            type="button"
            class="pf-btn pf-btn--tertiary pf-btn--sm pf-sre-sim-main"
            [disabled]="simulating()"
            (click)="simulateRun()"
            [title]="'Simulate analyzer transmission (' + activeLabel() + ')'"
          >
            <svg class="pf-sre-sim-play" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span class="pf-sre-sim-text">
              {{ simulating() ? 'Simulating…' : (selectedScenario() === 'random' ? 'Simulate run' : 'Simulate: ' + activeShortLabel()) }}
            </span>
          </button>

          <span class="pf-sre-sim-sep" aria-hidden="true"></span>

          <!-- Dropdown trigger to pick scenario -->
          <button
            type="button"
            class="pf-btn pf-btn--tertiary pf-btn--sm pf-sre-sim-trigger"
            [disabled]="simulating()"
            [attr.aria-expanded]="menuOpen()"
            aria-haspopup="listbox"
            aria-label="Pick simulation scenario"
            [title]="'Pick from 5 ' + protocolTitle() + ' profiles (or random)'"
            (click)="toggleMenu()"
          >
            <svg class="pf-sre-sim-chev" [class.pf-sre-sim-chev--open]="menuOpen()" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>

        <!-- Scrim to close on outside click -->
        @if (menuOpen()) {
          <span class="pf-sre-sim-scrim" (click)="menuOpen.set(false)" aria-hidden="true"></span>

          <!-- Dropdown Menu -->
          <div class="pf-sre-sim-menu" role="listbox" aria-label="Simulation scenarios">
            <div class="pf-sre-sim-menu__head">
              <span>{{ protocolTitle() }} Scenarios</span>
              <span class="pf-sre-sim-menu__sub">5 realistic profiles</span>
            </div>
            @for (s of scenarios(); track s.key) {
              <button
                type="button"
                class="pf-sre-sim-opt"
                role="option"
                [attr.aria-selected]="selectedScenario() === s.key"
                [class.pf-sre-sim-opt--active]="selectedScenario() === s.key"
                (click)="pickAndSimulate(s.key)"
              >
                <div class="pf-sre-sim-opt__main">
                  <span class="pf-sre-sim-opt__title">{{ s.label }}</span>
                  <span class="pf-sre-sim-opt__desc">{{ s.description }}</span>
                </div>
                @if (selectedScenario() === s.key) {
                  <svg class="pf-sre-sim-opt__check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                }
              </button>
            }
          </div>
        }

        @if (lastMeta(); as meta) {
          <span class="pf-sre-sim-badge" [attr.data-badge]="meta.badge" [title]="meta.description">
            {{ meta.shortLabel }}
          </span>
        }
      </div>
    }
  `,
  styles: [`
    .pf-sre-sim-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .pf-sre-sim-split {
      display: inline-flex;
      align-items: stretch;
      border-radius: var(--pf-radius-sm, 8px);
      background: var(--bg-surface, rgba(255, 255, 255, 0.05));
      border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
      transition: border-color 0.15s ease, background 0.15s ease;
    }

    .pf-sre-sim-split:hover {
      border-color: rgba(168, 85, 247, 0.4);
    }

    .pf-sre-sim-split--open {
      border-color: rgba(168, 85, 247, 0.6);
      box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.3);
    }

    .pf-sre-sim-main {
      border: none !important;
      border-top-right-radius: 0 !important;
      border-bottom-right-radius: 0 !important;
      background: transparent !important;
      padding: 0 10px 0 10px !important;
      font-size: 12.5px;
      gap: 6px;
    }

    .pf-sre-sim-main:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.06) !important;
    }

    .pf-sre-sim-sep {
      width: 1px;
      align-self: center;
      height: 18px;
      background: var(--border-subtle, rgba(255, 255, 255, 0.12));
    }

    .pf-sre-sim-trigger {
      border: none !important;
      border-top-left-radius: 0 !important;
      border-bottom-left-radius: 0 !important;
      background: transparent !important;
      padding: 0 7px !important;
      min-width: 24px;
      color: var(--text-secondary, #94a3b8);
    }

    .pf-sre-sim-trigger:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.06) !important;
      color: var(--text-primary, #f1f5f9);
    }

    .pf-sre-sim-chev {
      transition: transform 0.15s ease;
    }

    .pf-sre-sim-chev--open {
      transform: rotate(180deg);
    }

    .pf-sre-sim-scrim {
      position: fixed;
      inset: 0;
      z-index: 99;
      cursor: default;
    }

    .pf-sre-sim-menu {
      position: absolute;
      top: calc(100% + 5px);
      left: 0;
      z-index: 100;
      min-width: 320px;
      max-width: 420px;
      padding: 6px;
      border-radius: var(--pf-radius-md, 12px);
      background: #13141f;
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.65), 0 2px 6px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      gap: 2px;
      animation: pf-sim-drop 0.12s ease-out;
    }

    @keyframes pf-sim-drop {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .pf-sre-sim-menu__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px 4px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted, #64748b);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      margin-bottom: 3px;
    }

    .pf-sre-sim-menu__sub {
      font-weight: 500;
      text-transform: none;
      font-size: 11px;
      color: #a855f7;
    }

    .pf-sre-sim-opt {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: var(--text-primary, #f1f5f9);
      text-align: left;
      cursor: pointer;
      transition: background 0.12s ease;
    }

    .pf-sre-sim-opt:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    .pf-sre-sim-opt--active {
      background: rgba(168, 85, 247, 0.12);
      color: #c084fc;
    }

    .pf-sre-sim-opt__main {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .pf-sre-sim-opt__title {
      font-size: 12.5px;
      font-weight: 600;
      color: inherit;
    }

    .pf-sre-sim-opt__desc {
      font-size: 11px;
      color: var(--text-muted, #94a3b8);
      line-height: 1.3;
    }

    .pf-sre-sim-opt__check {
      flex: none;
      color: #c084fc;
    }

    .pf-sre-sim-badge {
      display: inline-flex;
      align-items: center;
      height: 24px;
      padding: 0 8px;
      border-radius: var(--pf-radius-xs, 6px);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
      background: var(--pf-chip-bg, rgba(255, 255, 255, 0.06));
      color: var(--text-secondary, #94a3b8);
      border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    }
    .pf-sre-sim-badge[data-badge="abnormal"] {
      background: rgba(245, 158, 11, 0.12);
      color: #f59e0b;
      border-color: rgba(245, 158, 11, 0.3);
    }
    .pf-sre-sim-badge[data-badge="critical"] {
      background: rgba(239, 68, 68, 0.14);
      color: #ef4444;
      border-color: rgba(239, 68, 68, 0.35);
    }
    .pf-sre-sim-badge[data-badge="atypical"] {
      background: rgba(168, 85, 247, 0.12);
      color: #c084fc;
      border-color: rgba(168, 85, 247, 0.3);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SampleResultSimulatorComponent {
  private readonly simulationService = inject(AnalyzerSimulationService);
  private readonly instrumentsApi = inject(InstrumentsApiService);
  private readonly toasts = inject(ToastService);

  readonly sample = input<OrderSample | null>(null);
  readonly lines = input<readonly PrefillLine[]>([]);

  readonly appliedRun = output<RunDto>();

  readonly selectedScenario = signal<MockScenarioKey>('random');
  readonly menuOpen = signal<boolean>(false);
  readonly simulating = signal<boolean>(false);
  readonly lastMeta = signal<MockScenarioMeta | null>(null);

  constructor() {
    let prevSampleId: string | null = null;
    effect(() => {
      const s = this.sample();
      const currentId = s?.id || null;
      if (currentId !== prevSampleId) {
        prevSampleId = currentId;
        this.selectedScenario.set('random');
        this.lastMeta.set(null);
        this.menuOpen.set(false);
      }
    });
  }

  readonly discipline = computed<ProtocolDiscipline | null>(() => {
    const s = this.sample();
    if (!s) return null;
    return detectDiscipline(s.tests ?? []);
  });

  readonly canSimulate = computed<boolean>(() => {
    return this.discipline() !== null;
  });

  readonly protocolTitle = computed<string>(() => {
    switch (this.discipline()) {
      case 'chemistry':
        return 'Chemistry';
      case 'hplc':
        return 'HPLC (HbA1c)';
      case 'poct':
        return 'POCT HbA1c';
      case 'text3part':
        return '3-Part CBC';
      case 'haematology':
      default:
        return 'CBC';
    }
  });

  readonly scenarios = computed<MockScenarioMeta[]>(() => {
    const disc = this.discipline() || 'haematology';
    return scenariosForDiscipline(disc);
  });

  readonly activeScenarioMeta = computed<MockScenarioMeta | null>(() => {
    const disc = this.discipline() || 'haematology';
    const list = scenariosForDiscipline(disc);
    return list.find((s) => s.key === this.selectedScenario()) || list[0] || null;
  });

  readonly activeShortLabel = computed(() => {
    return this.activeScenarioMeta()?.shortLabel || 'Random';
  });

  readonly activeLabel = computed(() => {
    return this.activeScenarioMeta()?.label || 'Random';
  });

  toggleMenu(): void {
    this.menuOpen.set(!this.menuOpen());
  }

  pickAndSimulate(key: MockScenarioKey): void {
    this.selectedScenario.set(key);
    this.menuOpen.set(false);
    void this.simulateRun(key);
  }

  async simulateRun(explicitKey?: MockScenarioKey): Promise<void> {
    const s = this.sample();
    const disc = this.discipline();
    if (!s?.id || !disc || this.simulating()) return;
    this.simulating.set(true);

    try {
      const barcode = (s.barcode ?? '26354').trim();
      const tests = s.tests ?? [];

      let proto: ParserType = 'astm';
      let instName = 'Sysmex XN-550 (ASTM)';

      switch (disc) {
        case 'haematology':
          proto = 'astm';
          instName = 'Sysmex XN-550 (ASTM)';
          break;
        case 'chemistry':
          proto = 'astm';
          instName = 'Erba Chem-200 (ASTM Chemistry)';
          break;
        case 'hplc':
          proto = 'lifedx-hbpro';
          instName = 'LifeDx HBPro HPLC';
          break;
        case 'poct':
          proto = 'sinocare-fhir';
          instName = 'Sinocare iCARE-2100 (POCT)';
          break;
        case 'text3part':
          proto = 'text';
          instName = 'Genrui KT-6200 (3-Part)';
          break;
      }

      // Resolve the scenario (random selection if 'random', or chosen example)
      const requested = explicitKey || this.selectedScenario();
      const meta = resolveScenarioForDiscipline(disc, requested);
      this.lastMeta.set(meta);

      // Load instrument code maps
      const codeMaps = await this.simulationService.loadCodeMaps();
      const mappedValues: MappedValue[] = [];
      const lines = this.lines();
      const lineByOrderTestId = new Map(lines.map((l) => [l.orderTestId, l]));

      for (const t of tests) {
        const line = lineByOrderTestId.get(t.id);
        if (!line) continue;

        // 1. Match test using database code mapping
        let map = codeMaps.find(
          (m) =>
            (m.testId && m.testId === t.testId) ||
            (m.testCatalogKey && t.test?.catalogKey && m.testCatalogKey.toUpperCase() === t.test.catalogKey.toUpperCase()) ||
            (m.testName && t.name && m.testName.trim().toLowerCase() === t.name.trim().toLowerCase()) ||
            (m.testName && t.test?.name && m.testName.trim().toLowerCase() === t.test.name.trim().toLowerCase())
        );

        // 2. Synthesize map if unmapped but recognized in this discipline
        if (!map) {
          const tName = (t.name || t.test?.name || '').trim().toLowerCase();
          if (disc === 'chemistry') {
            if (/glucose|sugar|rbs|fbs|ppbs|grbs/i.test(tName)) {
              map = { id: 'syn-glu', analyzerCode: 'GLU', testCatalogKey: 'GLU002', testName: t.name || 'Random Blood Sugar', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL' };
            } else if (/urea|bun/i.test(tName)) {
              map = { id: 'syn-urea', analyzerCode: 'UREA', testCatalogKey: 'REN001', testName: t.name || 'Blood Urea', factor: 1, offset: 0, decimals: 1, unit: 'mg/dL' };
            } else if (/creatinine/i.test(tName)) {
              map = { id: 'syn-creat', analyzerCode: 'CREAT', testCatalogKey: 'REN002', testName: t.name || 'Serum Creatinine', factor: 1, offset: 0, decimals: 2, unit: 'mg/dL' };
            } else if (/cholesterol/i.test(tName)) {
              map = { id: 'syn-chol', analyzerCode: 'CHOL', testCatalogKey: 'LIP001', testName: t.name || 'Total Cholesterol', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL' };
            } else if (/triglyceride/i.test(tName)) {
              map = { id: 'syn-trig', analyzerCode: 'TRIG', testCatalogKey: 'LIP002', testName: t.name || 'Triglycerides', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL' };
            } else if (/sgot|ast/i.test(tName)) {
              map = { id: 'syn-ast', analyzerCode: 'SGOT', testCatalogKey: 'LIV001', testName: t.name || 'SGOT / AST', factor: 1, offset: 0, decimals: 0, unit: 'U/L' };
            } else if (/sgpt|alt/i.test(tName)) {
              map = { id: 'syn-alt', analyzerCode: 'SGPT', testCatalogKey: 'LIV002', testName: t.name || 'SGPT / ALT', factor: 1, offset: 0, decimals: 0, unit: 'U/L' };
            } else if (/bilirubin/i.test(tName)) {
              map = { id: 'syn-bil', analyzerCode: 'BIL_T', testCatalogKey: 'LIV003', testName: t.name || 'Total Bilirubin', factor: 1, offset: 0, decimals: 2, unit: 'mg/dL' };
            } else if (/uric/i.test(tName)) {
              map = { id: 'syn-uric', analyzerCode: 'URIC', testCatalogKey: 'REN003', testName: t.name || 'Uric Acid', factor: 1, offset: 0, decimals: 1, unit: 'mg/dL' };
            }
          } else if (disc === 'haematology') {
            if (/haemoglobin|hemoglobin/i.test(tName)) {
              map = { id: 'syn-hgb', analyzerCode: '718-7', testCatalogKey: 'HEM011', testName: t.name, factor: 1, offset: 0, decimals: 1, unit: 'g/dL' };
            } else if (/red blood/i.test(tName)) {
              map = { id: 'syn-rbc', analyzerCode: '789-8', testCatalogKey: 'HEM012', testName: t.name, factor: 1, offset: 0, decimals: 2, unit: 'million/µL' };
            } else if (/packed cell|haematocrit|hematocrit/i.test(tName)) {
              map = { id: 'syn-pcv', analyzerCode: '4544-3', testCatalogKey: 'HEM013', testName: t.name, factor: 1, offset: 0, decimals: 1, unit: '%' };
            } else if (/platelet count/i.test(tName)) {
              map = { id: 'syn-plt', analyzerCode: '777-3', testCatalogKey: 'HEM030', testName: t.name, factor: 1000, offset: 0, decimals: 0, unit: 'cells/µL' };
            } else if (/leukocyte|wbc/i.test(tName)) {
              map = { id: 'syn-wbc', analyzerCode: '6690-2', testCatalogKey: 'HEM019', testName: t.name, factor: 1000, offset: 0, decimals: 0, unit: 'cells/µL' };
            }
          } else if (disc === 'hplc' || disc === 'poct') {
            if (/hba1c|glycated/i.test(tName)) {
              map = { id: 'syn-hba1c', analyzerCode: 'HBA1C', testCatalogKey: 'GLY001', testName: t.name, factor: 1, offset: 0, decimals: 1, unit: '%' };
            }
          }
        }

        if (map) {
          const sim = extractMockValueFromMap(map, meta.key);
          const formattedVal = formatMockConvertedValue(sim.rawValue, map);
          const targetParamName = line.params[0]?.name || 'result';

          mappedValues.push({
            analyzerCode: map.analyzerCode,
            orderTestId: t.id,
            testId: t.testId || map.testId || null,
            catalogKey: map.testCatalogKey || '',
            parameterName: targetParamName,
            value: formattedVal,
            rawValue: String(sim.rawValue),
            unit: map.unit || '',
            flags: sim.flag ? [sim.flag] : [],
          });
        }
      }

      const runId = `sim-run-${Date.now()}`;
      const runLabel = `${instName} · ${meta.label}`;

      if (mappedValues.length > 0) {
        const simRun: RunDto = {
          messageId: runId,
          instrumentId: 'sim-virtual',
          instrumentName: runLabel,
          receivedAt: new Date().toISOString(),
          runAt: new Date().toISOString(),
          state: 'matched',
          values: mappedValues,
        };

        // Emit to the parent component for clean prefill & draft saving
        this.appliedRun.emit(simRun);
      }

      // Inject to backend in background so server attachment works
      try {
        const inj = await this.simulationService.injectToDatabase('', {
          protocol: proto,
          scenario: meta.key as any,
          sampleId: barcode,
          codeMaps,
        });
        if (inj.ok && inj.messageId && !inj.messageId.startsWith('mock-')) {
          try {
            await firstValueFrom(this.instrumentsApi.attach(inj.messageId, barcode));
          } catch { /* lost race or already attached */ }
        }
      } catch { /* client prefill already active */ }

      this.toasts.success(`Simulated ${instName}: ${meta.label} applied for sample ${barcode}`);
    } catch {
      this.toasts.error('Failed to simulate analyzer run');
    } finally {
      this.simulating.set(false);
    }
  }
}
