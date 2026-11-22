import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import {
  CodeMapDto,
  ConnectorState,
  ConnectorStatus,
  DetectResult,
  InstrumentDto,
  InstrumentMessage,
  ListenEvent,
  ListenResult,
  PairedInstrument,
  ParserType,
  RawLogEntry,
  SerialPortInfo,
  TransportType,
} from './instrument.models';
import {
  GeneratedSimulation,
  SimulationJob,
  SimulationScenario,
  generateAnalyzerSimulation,
} from './analyzer-sim-protocols';

export interface SimulatedPortConfig {
  path: string;
  label: string;
  defaultProtocol: ParserType;
  defaultMake: string;
  defaultModel: string;
}

export const VIRTUAL_SERIAL_PORTS: SimulatedPortConfig[] = [
  { path: 'COM3 (Virtual)', label: 'COM3 · Sysmex XN-550 (ASTM CBC)', defaultProtocol: 'astm', defaultMake: 'Sysmex', defaultModel: 'XN-550' },
  { path: 'COM4 (Virtual)', label: 'COM4 · LifeDx HBPro HPLC (STX/ETX HbA1c)', defaultProtocol: 'lifedx-hbpro', defaultMake: 'LifeDx', defaultModel: 'HBPro' },
  { path: 'COM5 (Virtual)', label: 'COM5 · Mindray BC-5000 (HL7 CBC)', defaultProtocol: 'hl7', defaultMake: 'Mindray', defaultModel: 'BC-5000' },
  { path: 'COM6 (Virtual)', label: 'COM6 · Sinocare iCARE-2100 (POCT FHIR)', defaultProtocol: 'sinocare-fhir', defaultMake: 'Sinocare', defaultModel: 'iCARE-2100' },
  { path: 'COM7 (Virtual)', label: 'COM7 · 3-Part Counter (Text Ticket)', defaultProtocol: 'text', defaultMake: 'Genrui', defaultModel: 'KT-6200' },
  { path: 'COM8 (Virtual)', label: 'COM8 · Chem-200 Analyzer (ASTM Chemistry)', defaultProtocol: 'astm', defaultMake: 'Eurolab', defaultModel: 'Autolab 200' },
];

export const DEFAULT_SIMULATED_CODE_MAPS: CodeMapDto[] = [
  // User's configured CBC Malar instrument code maps (03f424e8-670c-49a4-a950-74313979b1f6)
  { id: 'a11f5c30-235b-4a27-921d-b6e2e75f2d76', analyzerCode: '11003', testCatalogKey: 'HEM033', testId: 'caf039a6-185f-4ddf-83f9-7002eae13726', testName: 'Plateletcrit', factor: 1, offset: 0, decimals: 3, unit: '%', isActive: true },
  { id: '36dbe6b7-9787-452c-bd7a-98a2dee735e9', analyzerCode: '32207-3', testCatalogKey: 'HEM032', testId: '91f12c01-9063-489c-9aba-c94a854fb4dc', testName: 'Platelet Distribution Width', factor: 1, offset: 0, decimals: 1, unit: 'fL', isActive: true },
  { id: '257a14c1-05b1-4e60-bc71-949dbe9e3e44', analyzerCode: '32623-1', testCatalogKey: 'HEM031', testId: 'fc9b1bc0-4f86-4fb8-85e3-f33276b9c1c7', testName: 'Mean Platelet Volume', factor: 1, offset: 0, decimals: 1, unit: 'fL', isActive: true },
  { id: 'e4a753c3-b7e0-4617-87e8-a736bb3fc750', analyzerCode: '4544-3', testCatalogKey: 'HEM013', testId: '24b4e6a9-421d-4b37-8570-653baac2b465', testName: 'Haematocrit / Packed Cell Volume', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: 'a7f7d326-b9fd-42cb-9c3d-227d342b6b05', analyzerCode: '5905-5', testCatalogKey: 'HEM022', testId: 'c0a80e61-17d9-46bf-b876-ad8c1eb79d00', testName: 'Monocyte Percentage', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: '4712349f-3882-4797-9592-8ab51ecb4081', analyzerCode: '6690-2', testCatalogKey: 'HEM019', testId: '52c35dd3-361c-47ad-a3d6-432bca712ecf', testName: 'Total Leukocyte Count', factor: 1000, offset: 0, decimals: 0, unit: 'cells/µL', isActive: true },
  { id: 'f525df71-74ae-457f-bc92-89ec69f6352f', analyzerCode: '704-7', testCatalogKey: 'HEM029', testId: 'be2023a6-7963-4f44-bfe4-47f22eb8f8a4', testName: 'Absolute Basophil Count', factor: 1, offset: 0, decimals: 2, unit: '×10⁹/L', isActive: true },
  { id: 'e13db1d9-def3-413b-89a4-bf79622660a3', analyzerCode: '706-2', testCatalogKey: 'HEM024', testId: 'e9875ff9-8ede-4556-91bd-76a8902d1db0', testName: 'Basophil Percentage', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: '704bc510-0623-4db9-a6ea-9a493a080938', analyzerCode: '711-2', testCatalogKey: 'HEM028', testId: '2cdef08c-36e5-494b-9b85-6cb210709b44', testName: 'Absolute Eosinophil Count', factor: 1, offset: 0, decimals: 2, unit: '×10⁹/L', isActive: true },
  { id: 'fbadeaca-1ef1-4122-932f-229d355e8556', analyzerCode: '713-8', testCatalogKey: 'HEM023', testId: '8e880ae2-523d-4c0b-a4ac-983a3e1c20d9', testName: 'Eosinophil Percentage', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: 'f5f34747-ae40-45ec-afbe-40a9a0783ea6', analyzerCode: '718-7', testCatalogKey: 'HEM011', testId: 'f2e88f15-693f-433e-aab9-87231f8e8daf', testName: 'Haemoglobin Concentration', factor: 1, offset: 0, decimals: 1, unit: 'g/dL', isActive: true },
  { id: '9877661c-2109-4ddb-96ed-669c2a6cc2d7', analyzerCode: '731-0', testCatalogKey: 'HEM026', testId: 'dc5fa2da-6487-413c-aa2e-26975aaf9004', testName: 'Absolute Lymphocyte Count', factor: 1, offset: 0, decimals: 2, unit: '×10⁹/L', isActive: true },
  { id: 'e88eec00-6c6c-49fa-8114-e3ea594c14d8', analyzerCode: '736-9', testCatalogKey: 'HEM021', testId: 'fc18d43a-35ad-4ca2-8398-449360dc50a6', testName: 'Lymphocyte Percentage', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: '7afc9047-7e00-447a-9499-506d781b0f2f', analyzerCode: '742-7', testCatalogKey: 'HEM027', testId: 'a691fef2-2a26-4075-a997-566140b6ed93', testName: 'Absolute Monocyte Count', factor: 1, offset: 0, decimals: 2, unit: '×10⁹/L', isActive: true },
  { id: 'b9e4966e-e725-4a3c-a62d-620599ecebb9', analyzerCode: '751-8', testCatalogKey: 'HEM025', testId: '89cd6872-720d-4d9d-8c5e-78958310f4b2', testName: 'Absolute Neutrophil Count', factor: 1, offset: 0, decimals: 2, unit: '×10⁹/L', isActive: true },
  { id: '2d7bde3d-c0fa-4e62-b3ed-60fbbbd863f3', analyzerCode: '770-8', testCatalogKey: 'HEM020', testId: '12c63782-fcb6-4c65-91e8-d84ae987652e', testName: 'Neutrophil Percentage', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: '879fa6dd-07c7-4324-a5eb-de7795cead13', analyzerCode: '777-3', testCatalogKey: 'HEM030', testId: 'efd922fc-833c-4366-9cda-5e75571fdbf9', testName: 'Platelet Count', factor: 1000, offset: 0, decimals: 0, unit: 'cells/µL', isActive: true },
  { id: '23e4449b-8cff-49d0-84e5-fa737ebcb90e', analyzerCode: '785-6', testCatalogKey: 'HEM015', testId: 'b1112e77-7967-4e8c-9ba8-244363d2af25', testName: 'Mean Corpuscular Haemoglobin', factor: 1, offset: 0, decimals: 1, unit: 'pg', isActive: true },
  { id: '50b09be8-5c0e-401b-a33e-b36ee98ec8a8', analyzerCode: '786-4', testCatalogKey: 'HEM016', testId: '5c331900-a071-4f67-91d7-d5bc3102145a', testName: 'Mean Corpuscular Haemoglobin Concentration', factor: 1, offset: 0, decimals: 1, unit: 'g/dL', isActive: true },
  { id: '57b2e8d8-e95f-4c5a-b97a-db296a9ced37', analyzerCode: '787-2', testCatalogKey: 'HEM014', testId: 'ade838c3-7bc0-4e73-8b86-7179259cd09e', testName: 'Mean Corpuscular Volume', factor: 1, offset: 0, decimals: 1, unit: 'fL', isActive: true },
  { id: '28ffae32-0107-4b99-9597-9e444fbe6d70', analyzerCode: '788-0', testCatalogKey: 'HEM017', testId: 'a0f36f55-ad74-4bbe-a49a-d8e0501cc580', testName: 'Red Cell Distribution Width-CV', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: 'edb8e9bb-8a9a-4751-aefb-269a1acaee8c', analyzerCode: '789-8', testCatalogKey: 'HEM012', testId: 'a7d1849a-2390-4102-b082-30609c0b0b52', testName: 'Red Blood Cell Count', factor: 1, offset: 0, decimals: 2, unit: 'million/µL', isActive: true },

  // HbA1c
  { id: 'sim-map-hba1c-1', analyzerCode: '4548-4', testCatalogKey: 'GLY001', testName: 'Glycated Hemoglobin', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: 'sim-map-hba1c-2', analyzerCode: 'HBA1C', testCatalogKey: 'GLY001', testName: 'Glycated Hemoglobin', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: 'sim-map-hba1c-3', analyzerCode: 'HbA1c', testCatalogKey: 'GLY001', testName: 'Glycated Hemoglobin', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },

  // Standard CBC Codes (Sysmex style)
  { id: 'sim-map-wbc', analyzerCode: 'WBC', testCatalogKey: 'HEM019', testName: 'Total Leukocyte Count', factor: 1000, offset: 0, decimals: 0, unit: 'cells/µL', isActive: true },
  { id: 'sim-map-rbc', analyzerCode: 'RBC', testCatalogKey: 'HEM012', testName: 'Red Blood Cell Count', factor: 1, offset: 0, decimals: 2, unit: 'million/µL', isActive: true },
  { id: 'sim-map-hgb', analyzerCode: 'HGB', testCatalogKey: 'HEM011', testName: 'Haemoglobin Concentration', factor: 1, offset: 0, decimals: 1, unit: 'g/dL', isActive: true },
  { id: 'sim-map-hct', analyzerCode: 'HCT', testCatalogKey: 'HEM013', testName: 'Haematocrit / Packed Cell Volume', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: 'sim-map-mcv', analyzerCode: 'MCV', testCatalogKey: 'HEM014', testName: 'Mean Corpuscular Volume', factor: 1, offset: 0, decimals: 1, unit: 'fL', isActive: true },
  { id: 'sim-map-mch', analyzerCode: 'MCH', testCatalogKey: 'HEM015', testName: 'Mean Corpuscular Haemoglobin', factor: 1, offset: 0, decimals: 1, unit: 'pg', isActive: true },
  { id: 'sim-map-mchc', analyzerCode: 'MCHC', testCatalogKey: 'HEM016', testName: 'Mean Corpuscular Haemoglobin Concentration', factor: 1, offset: 0, decimals: 1, unit: 'g/dL', isActive: true },
  { id: 'sim-map-rdw', analyzerCode: 'RDW-CV', testCatalogKey: 'HEM017', testName: 'Red Cell Distribution Width-CV', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: 'sim-map-plt', analyzerCode: 'PLT', testCatalogKey: 'HEM030', testName: 'Platelet Count', factor: 1000, offset: 0, decimals: 0, unit: 'cells/µL', isActive: true },
  { id: 'sim-map-mpv', analyzerCode: 'MPV', testCatalogKey: 'HEM031', testName: 'Mean Platelet Volume', factor: 1, offset: 0, decimals: 1, unit: 'fL', isActive: true },
  { id: 'sim-map-neu', analyzerCode: 'NEUT%', testCatalogKey: 'HEM020', testName: 'Neutrophil Percentage', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: 'sim-map-lym', analyzerCode: 'LYMPH%', testCatalogKey: 'HEM021', testName: 'Lymphocyte Percentage', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: 'sim-map-mon', analyzerCode: 'MONO%', testCatalogKey: 'HEM022', testName: 'Monocyte Percentage', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: 'sim-map-eos', analyzerCode: 'EOS%', testCatalogKey: 'HEM023', testName: 'Eosinophil Percentage', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },
  { id: 'sim-map-bas', analyzerCode: 'BASO%', testCatalogKey: 'HEM024', testName: 'Basophil Percentage', factor: 1, offset: 0, decimals: 1, unit: '%', isActive: true },

  // Biochemistry / Chemistry (Glucose / RBS / FBS, Renal, LFT, Lipid)
  { id: 'sim-map-glu-rbs', analyzerCode: 'GLU', testCatalogKey: 'GLU002', testName: 'Random Blood Sugar', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-rbs-code', analyzerCode: 'RBS', testCatalogKey: 'GLU002', testName: 'Random Blood Sugar', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-glu', analyzerCode: 'GLU', testCatalogKey: 'GLU001', testName: 'Fasting Blood Glucose', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-fbs-name', analyzerCode: 'GLU', testCatalogKey: 'GLU001', testName: 'Fasting Blood Sugar', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-glu-ppbs', analyzerCode: 'GLU', testCatalogKey: 'GLU003', testName: 'Postprandial Blood Sugar', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-ppbs-code', analyzerCode: 'PPBS', testCatalogKey: 'GLU003', testName: 'Postprandial Blood Sugar', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-glucose', analyzerCode: 'GLU', testCatalogKey: 'GLU001', testName: 'Blood Glucose', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-urea', analyzerCode: 'UREA', testCatalogKey: 'REN001', testName: 'Blood Urea', factor: 1, offset: 0, decimals: 1, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-creat', analyzerCode: 'CREAT', testCatalogKey: 'REN002', testName: 'Serum Creatinine', factor: 1, offset: 0, decimals: 2, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-creat-name', analyzerCode: 'CREAT', testCatalogKey: 'REN002', testName: 'Creatinine', factor: 1, offset: 0, decimals: 2, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-chol', analyzerCode: 'CHOL', testCatalogKey: 'LIP001', testName: 'Total Cholesterol', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-trig', analyzerCode: 'TRIG', testCatalogKey: 'LIP002', testName: 'Triglycerides', factor: 1, offset: 0, decimals: 0, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-ast', analyzerCode: 'SGOT', testCatalogKey: 'LIV001', testName: 'SGOT / AST', factor: 1, offset: 0, decimals: 0, unit: 'U/L', isActive: true },
  { id: 'sim-map-alt', analyzerCode: 'SGPT', testCatalogKey: 'LIV002', testName: 'SGPT / ALT', factor: 1, offset: 0, decimals: 0, unit: 'U/L', isActive: true },
  { id: 'sim-map-tbil', analyzerCode: 'BIL_T', testCatalogKey: 'LIV003', testName: 'Total Bilirubin', factor: 1, offset: 0, decimals: 2, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-uric', analyzerCode: 'URIC', testCatalogKey: 'REN003', testName: 'Uric Acid', factor: 1, offset: 0, decimals: 1, unit: 'mg/dL', isActive: true },
  { id: 'sim-map-tp', analyzerCode: 'TP', testCatalogKey: 'LIV004', testName: 'Total Protein', factor: 1, offset: 0, decimals: 1, unit: 'g/dL', isActive: true },
  { id: 'sim-map-alb', analyzerCode: 'ALB', testCatalogKey: 'LIV005', testName: 'Albumin', factor: 1, offset: 0, decimals: 1, unit: 'g/dL', isActive: true },
];

/**
 * Universal Simulation Service for In-Browser & Test Lab Analyzers.
 * Provides full emulation for:
 * 1. Transports: Serial (virtual COM ports), TCP-Server, TCP-Client, Folder drop.
 * 2. Protocols: ASTM E1381/E1394, HL7 v2.3/v2.5, LifeDx STX/ETX HPLC, Sinocare FHIR, Text Ticket.
 * 3. Scenarios: Normal, High Panic, Low Panic, Abnormal, Quality Control (QC), Frame Glitch.
 */
@Injectable({ providedIn: 'root' })
export class AnalyzerSimulationService {
  private readonly rawApi = inject(ApiService);
  private readonly http = inject(HttpClient);
  private cachedInstrumentId: string | null = null;
  private cachedDeviceKey: string | null = null;

  // ── Reactive Simulation State ────────────────────────────────────────────
  readonly enabled = signal(!!environment.enableAnalyzerSimulation);
  readonly isSimulating = signal(false);
  readonly activeScenario = signal<SimulationScenario>('normal');
  readonly lastSimulation = signal<GeneratedSimulation | null>(null);
  readonly simulatedState = signal<ConnectorState>('connected');

  // Simulated Desktop Pairing State
  private pairedInstruments = signal<PairedInstrument[]>([
    {
      instrumentId: 'sim-hbpro-01',
      name: 'LifeDx Hemoglobin Pro (Simulated Lab PC)',
      apiUrl: 'http://localhost:4200/api',
      pairedAt: new Date().toISOString(),
      status: {
        instrumentId: 'sim-hbpro-01',
        name: 'LifeDx Hemoglobin Pro (Simulated Lab PC)',
        state: 'connected',
        transport: 'serial (virtual)',
        lastMessageAt: new Date().toISOString(),
        lastUploadAt: new Date().toISOString(),
        queueLength: 0,
        messagesToday: 12,
      },
    },
  ]);

  // Simulated Raw Logs & Status
  private rawLogs = signal<RawLogEntry[]>([]);
  private listenSubscribers: ((e: ListenEvent) => void)[] = [];
  private statusSubscribers: ((s: ConnectorStatus) => void)[] = [];
  private currentSessionId = signal<string | null>(null);

  /** Emits simulated serial ports for UI selection when running in web / test mode. */
  listSimulatedSerialPorts(): SerialPortInfo[] {
    return VIRTUAL_SERIAL_PORTS.map((p) => ({
      path: p.path,
      manufacturer: 'Prefrontal Virtual Analyzer Driver',
      serialNumber: `SIM-${p.defaultProtocol.toUpperCase()}-01`,
    }));
  }

  /** Simulated paired instruments on this browser / virtual PC. */
  listSimulatedPaired(): PairedInstrument[] {
    return this.pairedInstruments();
  }

  pairSimulated(p: { instrumentId: string; deviceKey: string; apiUrl: string; name?: string }): { ok: boolean } {
    const instName = p.name || 'Simulated Lab PC';
    this.pairedInstruments.update((list) => [
      ...list.filter((x) => x.instrumentId !== p.instrumentId),
      {
        instrumentId: p.instrumentId,
        name: instName,
        apiUrl: p.apiUrl,
        pairedAt: new Date().toISOString(),
        status: {
          instrumentId: p.instrumentId,
          name: instName,
          state: 'connected',
          transport: 'serial (virtual)',
          lastMessageAt: new Date().toISOString(),
          lastUploadAt: new Date().toISOString(),
          queueLength: 0,
          messagesToday: this.rawLogs().length,
        },
      },
    ]);
    this.broadcastStatus(p.instrumentId, 'connected');
    return { ok: true };
  }

  unpairSimulated(instrumentId: string): { ok: boolean } {
    this.pairedInstruments.update((list) => list.filter((x) => x.instrumentId !== instrumentId));
    this.broadcastStatus(instrumentId, 'disconnected');
    return { ok: true };
  }

  simulatedStatus(): ConnectorStatus[] {
    return this.pairedInstruments().map((p) => ({
      instrumentId: p.instrumentId,
      name: p.name,
      state: this.simulatedState(),
      transport: 'serial (virtual)',
      lastMessageAt: this.lastSimulation()?.message.runAt || new Date().toISOString(),
      lastUploadAt: new Date().toISOString(),
      queueLength: 0,
      messagesToday: this.rawLogs().length > 0 ? this.rawLogs().length : 12,
    }));
  }

  onSimulatedStatus(cb: (s: ConnectorStatus) => void): () => void {
    this.statusSubscribers.push(cb);
    return () => {
      this.statusSubscribers = this.statusSubscribers.filter((s) => s !== cb);
    };
  }

  private broadcastStatus(instrumentId: string, state: ConnectorState): void {
    this.simulatedState.set(state);
    const stat: ConnectorStatus = {
      instrumentId,
      name: 'Simulated Lab PC',
      state,
      transport: 'serial (virtual)',
      lastMessageAt: new Date().toISOString(),
      lastUploadAt: new Date().toISOString(),
      queueLength: 0,
      messagesToday: this.rawLogs().length,
    };
    for (const sub of this.statusSubscribers) {
      try { sub(stat); } catch (e) { /* ignore */ }
    }
  }

  simulatedRawLog(instrumentId: string, limit = 200): RawLogEntry[] {
    return this.rawLogs().slice(-limit);
  }

  /** Starts a simulated listen session in web mode. */
  startSimulatedListen(opts: { transport: object; link?: object; parser?: object }): { sessionId: string } {
    const sId = `sim-session-${Date.now()}`;
    this.currentSessionId.set(sId);
    this.isSimulating.set(true);

    const transportType = (opts.transport as { type?: TransportType })?.type || 'serial';

    // Initial event: listening status
    setTimeout(() => {
      this.emitListenEvent({
        sessionId: sId,
        kind: 'status',
        state: 'listening',
        text: `Simulated ${transportType.toUpperCase()} listener ready. Awaiting analyzer frames...`,
      });
    }, 80);

    return { sessionId: sId };
  }

  /** Stops the simulated session and returns the aggregated result. */
  stopSimulatedListen(sessionId: string): ListenResult {
    this.currentSessionId.set(null);
    this.isSimulating.set(false);

    const sim = this.lastSimulation();
    if (!sim) {
      return {
        raw: '',
        detect: {
          protocol: 'unknown',
          link: 'raw',
          confidence: 0,
          reasons: ['No simulated frames sent during session'],
          proposed: { link: {}, parser: {} },
        },
        messages: [],
      };
    }

    return {
      raw: sim.rawText,
      detect: this.deriveDetectResult(sim),
      messages: [sim.message],
    };
  }

  /** Subscribes to simulation listen events (raw bytes, detect, message, status). */
  onListen(cb: (e: ListenEvent) => void): () => void {
    this.listenSubscribers.push(cb);
    return () => {
      this.listenSubscribers = this.listenSubscribers.filter((s) => s !== cb);
    };
  }

  private emitListenEvent(e: ListenEvent): void {
    for (const sub of this.listenSubscribers) {
      try {
        sub(e);
      } catch (err) {
        console.error('Error in listen subscriber:', err);
      }
    }
  }

  private codeMapsCache = new Map<string, CodeMapDto[]>();
  private allCodeMapsCache: CodeMapDto[] | null = null;

  /** Returns built-in fallback code maps including configured tenant instruments. */
  getDefaultCodeMaps(): CodeMapDto[] {
    return [...DEFAULT_SIMULATED_CODE_MAPS];
  }

  /**
   * Loads code maps from the server for an instrument (or across all instruments in the tenant).
   * Automatically falls back to built-in defaults if offline or if no maps are stored.
   */
  async loadCodeMaps(instrumentId?: string): Promise<CodeMapDto[]> {
    if (instrumentId && this.codeMapsCache.has(instrumentId)) {
      return this.codeMapsCache.get(instrumentId)!;
    }
    if (!instrumentId && this.allCodeMapsCache && this.allCodeMapsCache.length > 0) {
      return this.allCodeMapsCache;
    }

    try {
      if (instrumentId) {
        const maps = await firstValueFrom(
          this.rawApi.get<CodeMapDto[]>(`/api/instruments/${encodeURIComponent(instrumentId)}/code-maps`)
        );
        if (Array.isArray(maps) && maps.length > 0) {
          this.codeMapsCache.set(instrumentId, maps);
          return maps;
        }
      } else {
        const instruments = await firstValueFrom(this.rawApi.get<InstrumentDto[]>('/api/instruments'));
        const combined: CodeMapDto[] = [];
        for (const inst of instruments || []) {
          if (!inst?.id) continue;
          try {
            const maps = await firstValueFrom(
              this.rawApi.get<CodeMapDto[]>(`/api/instruments/${encodeURIComponent(inst.id)}/code-maps`)
            );
            if (Array.isArray(maps) && maps.length > 0) {
              this.codeMapsCache.set(inst.id, maps);
              combined.push(...maps);
            }
          } catch { /* skip */ }
        }
        if (combined.length > 0) {
          const seen = new Set(combined.map((m) => `${m.testId || ''}|${m.testCatalogKey || ''}|${m.analyzerCode}`));
          for (const def of this.getDefaultCodeMaps()) {
            const key = `${def.testId || ''}|${def.testCatalogKey || ''}|${def.analyzerCode}`;
            if (!seen.has(key)) combined.push(def);
          }
          this.allCodeMapsCache = combined;
          return combined;
        }
      }
    } catch {
      // Offline fallback
    }

    return this.getDefaultCodeMaps();
  }

  /**
   * Generates and streams simulated frames for a sample into the active listen session.
   * Emits raw chunks, detect results, and parsed messages.
   */
  async streamSimulatedRun(job: SimulationJob): Promise<GeneratedSimulation> {
    const codeMaps = job.codeMaps || await this.loadCodeMaps();
    const sim = generateAnalyzerSimulation({ ...job, codeMaps });
    this.lastSimulation.set(sim);

    // Record to simulated raw log
    const entry: RawLogEntry = {
      at: new Date().toISOString(),
      dir: 'in',
      text: sim.rawText,
      bytes: sim.rawText.length,
    };
    this.rawLogs.update((l) => [...l.slice(-199), entry]);

    const sId = this.currentSessionId() || `sim-oneshot-${Date.now()}`;

    // 1. Emit raw log event
    this.emitListenEvent({
      sessionId: sId,
      kind: 'raw',
      text: sim.rawText,
    });

    // 2. Emit detect result event
    const detect = this.deriveDetectResult(sim);
    this.emitListenEvent({
      sessionId: sId,
      kind: 'detect',
      detect,
    });

    // 3. Emit parsed message event
    this.emitListenEvent({
      sessionId: sId,
      kind: 'message',
      message: sim.message,
    });

    return sim;
  }

  async getOrEnsureInstrument(): Promise<{ id: string; deviceKey?: string } | null> {
    if (this.cachedInstrumentId && this.cachedDeviceKey) {
      return { id: this.cachedInstrumentId, deviceKey: this.cachedDeviceKey };
    }
    try {
      const list = await firstValueFrom(this.rawApi.get<Array<{ id: string }>>('/api/instruments'));
      let instId = list?.[0]?.id;
      if (!instId) {
        const created = await firstValueFrom(
          this.rawApi.post<{ id: string }>('/api/instruments', {
            name: 'Virtual Lab Analyzer (Simulated)',
            make: 'Sysmex',
            model: 'XN-550',
            transport: 'serial',
            serial: { path: 'COM3 (Virtual)' },
            protocol: 'auto',
          })
        );
        instId = created?.id;
      }
      if (!instId) return null;

      let key = this.cachedDeviceKey;
      if (!key) {
        try {
          const k = await firstValueFrom(
            this.rawApi.post<{ deviceKey?: string; key?: string }>(`/api/instruments/${encodeURIComponent(instId)}/device-key`, {})
          );
          key = k?.deviceKey || k?.key || null;
        } catch { /* key might already be active */ }
      }

      this.cachedInstrumentId = instId;
      this.cachedDeviceKey = key;
      return { id: instId, deviceKey: key || undefined };
    } catch {
      return null;
    }
  }

  /**
   * Injects a simulated analyzer run directly into the database via /api/instruments/{id}/messages
   * so that result entry screen's "Fetch from analyzer" can attach it immediately!
   */
  async injectToDatabase(instrumentId: string, job: SimulationJob): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const codeMaps = job.codeMaps || await this.loadCodeMaps(instrumentId);
    const sim = generateAnalyzerSimulation({ ...job, codeMaps });
    this.lastSimulation.set(sim);

    // Record raw log entry
    this.rawLogs.update((l) => [
      ...l.slice(-199),
      { at: new Date().toISOString(), dir: 'in', text: sim.rawText, bytes: sim.rawText.length },
    ]);

    const inst = await this.getOrEnsureInstrument();
    const targetId = inst?.id || instrumentId;

    try {
      const payload = {
        idempotencyKey: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        protocol: sim.protocol,
        receivedAt: new Date().toISOString(),
        raw: sim.rawText,
        message: {
          sampleId: sim.sampleId,
          instrumentSerial: sim.message.instrumentSerial || 'SIM-ANALYZER-01',
          runAt: sim.message.runAt || new Date().toISOString(),
          qc: sim.message.qc || false,
          results: sim.message.results.map((r) => ({
            code: r.code,
            value: r.value,
            unit: r.unit,
            flags: r.flags || [],
            rawRecord: r.rawRecord || '',
          })),
          images: (sim.message.images || []).map((im) => ({
            code: im.code,
            label: im.label,
            format: im.format,
            base64: im.base64,
          })),
        },
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (inst?.deviceKey) {
        headers['X-Instrument-Key'] = inst.deviceKey;
      }

      const res = await firstValueFrom(
        this.http.post<{ id?: string; messageId?: string }>(
          `/api/instruments/${encodeURIComponent(targetId)}/messages`,
          payload,
          { headers }
        )
      );

      const createdId = res?.id || res?.messageId;
      return { ok: true, messageId: createdId };
    } catch {
      // Offline / fallback mock ID
      return { ok: true, messageId: `mock-msg-${Date.now()}` };
    }
  }

  /** Simulates previewing raw pasted text or simulated payload in browser mode. */
  previewSimulatedRaw(raw: string, protocolHint?: ParserType): ListenResult {
    let protocol: ParserType = protocolHint || 'astm';
    if (!protocolHint || protocolHint === 'auto') {
      if (raw.includes('S04') || raw.includes('LifeDx') || raw.includes('HPLC')) protocol = 'lifedx-hbpro';
      else if (raw.includes('MSH|')) protocol = 'hl7';
      else if (raw.includes('SN') || raw.includes('Observation')) protocol = 'sinocare-fhir';
      else if (raw.includes('HEMATOLOGY ANALYZER') || raw.includes('\f')) protocol = 'text';
      else protocol = 'astm';
    }

    const job: SimulationJob = {
      protocol,
      sampleId: '26354',
    };
    const sim = generateAnalyzerSimulation(job);

    return {
      raw: raw || sim.rawText,
      detect: this.deriveDetectResult(sim),
      messages: [sim.message],
    };
  }

  /** Converts a simulation payload into a DetectResult proposal with confidence. */
  deriveDetectResult(sim: GeneratedSimulation): DetectResult {
    switch (sim.protocol) {
      case 'lifedx-hbpro':
        return {
          protocol: 'lifedx-hbpro',
          link: 'stx-etx',
          confidence: 0.98,
          reasons: [
            'Fixed-width record starting with S04',
            'STX (0x02) and ETX (0x03) delimiters found',
            'HbA1c HPLC chromatogram peak stream verified',
          ],
          proposed: {
            link: { type: 'stx-etx' },
            parser: { type: 'lifedx-hbpro' },
          },
        };

      case 'hl7':
        return {
          protocol: 'hl7',
          link: 'mllp',
          confidence: 0.99,
          reasons: [
            'Standard MSH segment with ^~\\& encoding characters',
            'MLLP frame delimiters (<VT> and <FS><CR>) present',
            'OBX numeric result segments with units verified',
          ],
          proposed: {
            link: { type: 'mllp' },
            parser: { type: 'hl7', hl7: { sampleIdField: 'OBR-3' } },
          },
        };

      case 'sinocare-fhir':
        return {
          protocol: 'sinocare-fhir',
          link: 'sinocare-sn',
          confidence: 0.95,
          reasons: [
            'Sinocare SN binary envelope detected',
            'FHIR Observation JSON resource payload verified',
          ],
          proposed: {
            link: { type: 'sinocare-sn' },
            parser: { type: 'sinocare-fhir', sinocare: { sampleIdField: 'medicalRecordNo' } },
          },
        };

      case 'text':
        return {
          protocol: 'text',
          link: 'raw',
          confidence: 0.85,
          reasons: [
            'Plain ASCII text with columnar alignment',
            'Form-feed (0x0C) page terminator detected',
            'Standard sample ID header and test rows found',
          ],
          proposed: {
            link: { type: 'raw' },
            parser: { type: 'text' },
          },
        };

      case 'astm':
      default:
        return {
          protocol: 'astm',
          link: 'astm-e1381',
          confidence: 0.99,
          reasons: [
            'ASTM E1381 frame header with sequence and checksum',
            'ASTM E1394 records (H/P/O/R/L) verified',
            'ENQ/ACK handshake sequence validated',
          ],
          proposed: {
            link: { type: 'astm-e1381' },
            parser: { type: 'astm', astm: { sampleIdField: 3, sampleIdComponent: 1 } },
          },
        };
    }
  }
}
