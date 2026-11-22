import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import {
  ConnectorStatus, ElectronInstrumentsApi, ElectronInstrumentsDiagApi, ElectronSupportApi, ListenEvent, ListenResult, PairedInstrument, RawLogEntry, SerialPortInfo,
} from './instrument.models';
import { AnalyzerSimulationService } from './analyzer-simulation.service';

/** Where the bridge comes from. Default: the Electron preload's
 *  `window.electronAPI.instruments` (undefined on web / iPad / phones).
 *  Specs provide their own double through this token (no vi.mock). */
export const INSTRUMENT_BRIDGE_SOURCE = new InjectionToken<() => ElectronInstrumentsApi | undefined>(
  'INSTRUMENT_BRIDGE_SOURCE',
  {
    providedIn: 'root',
    factory: () => () => {
      if (typeof window === 'undefined') return undefined;
      const api = (window as unknown as { electronAPI?: { instruments?: ElectronInstrumentsApi } }).electronAPI?.instruments;
      return api && typeof api.list === 'function' ? api : undefined;
    },
  },
);

/**
 * The paired-desktop connector, as seen from the UI. Never assumes Node:
 * every call is safe on the web (`available` false without simulation → empty results, no-op
 * subscriptions), so screens can render one template.
 *
 * When simulation is active (the default on web), full analyzer listening,
 * virtual serial ports, and frame streaming are provided seamlessly.
 */
@Injectable({ providedIn: 'root' })
export class InstrumentBridgeService {
  private readonly source = inject(INSTRUMENT_BRIDGE_SOURCE);
  readonly sim = inject(AnalyzerSimulationService);

  private get api(): ElectronInstrumentsApi | undefined {
    try { return this.source(); } catch { return undefined; }
  }

  /** True only inside the native Electron desktop app with the connector preload. */
  get isDesktop(): boolean { return !!this.api; }

  /** True when web simulation mode is providing virtual analyzers. */
  get isSimulated(): boolean { return !this.api && this.sim.enabled(); }

  /** True inside Electron or when web simulation mode is enabled. */
  get available(): boolean { return !!this.api || this.sim.enabled(); }

  /** The "Connect an analyzer" helpers (desktop ≥ 1.1.1). */
  get diagAvailable(): boolean { const d = this.api?.diag; return !!d && typeof d.snapshot === 'function'; }

  /** The netdiag bridge, or undefined (web, older desktop). */
  get diag(): ElectronInstrumentsDiagApi | undefined { return this.diagAvailable ? this.api!.diag : undefined; }

  /** "Allow Prefrontal support" bridge (desktop ≥ 1.1.2), or undefined (web, older desktop). */
  get support(): ElectronSupportApi | undefined {
    const s = this.api?.support;
    return s && typeof s.start === 'function' && typeof s.onChange === 'function' ? s : undefined;
  }

  async list(): Promise<PairedInstrument[]> {
    const a = this.api;
    if (!a) return this.sim.listSimulatedPaired();
    try { return (await a.list()) ?? []; } catch { return []; }
  }

  async pair(p: { instrumentId: string; deviceKey: string; apiUrl: string; name?: string }): Promise<{ ok: boolean; error?: string }> {
    const a = this.api;
    if (!a) return this.sim.pairSimulated(p);
    try { return await a.pair(p); } catch (e) { return { ok: false, error: errText(e) }; }
  }

  async unpair(instrumentId: string): Promise<{ ok: boolean }> {
    const a = this.api;
    if (!a) return this.sim.unpairSimulated(instrumentId);
    try { return await a.unpair(instrumentId); } catch { return { ok: false }; }
  }

  /** Tell this PC's running connector to apply a just-saved config now
   *  (no re-pair / restart). No-op on the web or when not paired here. */
  async reload(instrumentId: string): Promise<{ ok: boolean; changed?: boolean; restarted?: boolean; error?: string }> {
    const a = this.api;
    if (!a || typeof a.reload !== 'function') return { ok: true, changed: true, restarted: true };
    try { return await a.reload(instrumentId); } catch (e) { return { ok: false, error: errText(e) }; }
  }

  async status(): Promise<ConnectorStatus[]> {
    const a = this.api;
    if (!a) return this.sim.simulatedStatus();
    try { return (await a.status()) ?? []; } catch { return []; }
  }

  onStatus(cb: (s: ConnectorStatus) => void): () => void {
    const a = this.api;
    if (!a) return this.sim.onSimulatedStatus(cb);
    try { return a.onStatus(cb) ?? (() => undefined); } catch { return () => undefined; }
  }

  async rawLog(instrumentId: string, limit = 200): Promise<RawLogEntry[]> {
    const a = this.api;
    if (!a) return this.sim.simulatedRawLog(instrumentId, limit);
    try { return (await a.rawLog(instrumentId, limit)) ?? []; } catch { return []; }
  }

  async listSerialPorts(): Promise<SerialPortInfo[]> {
    const a = this.api;
    if (!a) return this.sim.listSimulatedSerialPorts();
    try { return (await a.listSerialPorts()) ?? []; } catch { return []; }
  }

  async listenStart(opts: { transport: object; link?: object; parser?: object }): Promise<{ sessionId: string } | { error: string }> {
    const a = this.api;
    if (!a) return this.sim.startSimulatedListen(opts);
    try { return await a.listenStart(opts); } catch (e) { return { error: errText(e) }; }
  }

  async listenStop(sessionId: string): Promise<ListenResult | null> {
    const a = this.api;
    if (!a) return this.sim.stopSimulatedListen(sessionId);
    try { return await a.listenStop(sessionId); } catch { return null; }
  }

  onListen(cb: (e: ListenEvent) => void): () => void {
    const a = this.api;
    if (!a) return this.sim.onListen(cb);
    try { return a.onListen(cb) ?? (() => undefined); } catch { return () => undefined; }
  }

  async preview(raw: string, config?: { link?: object; parser?: object }): Promise<ListenResult | null> {
    const a = this.api;
    if (!a) return this.sim.previewSimulatedRaw(raw, (config?.parser as { type?: any })?.type);
    try { return await a.preview(raw, config); } catch { return null; }
  }
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? 'Failed');
}
