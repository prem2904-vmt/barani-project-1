import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DialogService } from '../../../../core/services/dialog.service';
import { PlatformService } from '../../../../core/services/platform.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { ToastService } from '../../../../core/services/toast.service';
import { HeroBandComponent } from '../../../../shared/components/hero-band/hero-band.component';
import { BusyDirective } from '../../../../shared/directives/busy.directive';
import { ApiError } from '../../../../shared/models/api-response.model';
import { SelectComponent } from '../../../../shared/primitives/select.component';
import { ScreenHeaderComponent } from '../../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../../shared/primitives/segmented.component';
import { InstrumentBridgeService } from '../../../../shared/instruments/instrument-bridge.service';
import { InstrumentsApiService } from '../../../../shared/instruments/instruments-api.service';
import { connectorStateWord, remoteHost } from '../../../../shared/instruments/instrument-config';
import type {
  AnalyzerGuess, ConnectorStatus, DetectResult, DiagArpEntry, DiagScanEvent, DiagSnapshot, InstrumentDto, ListenEvent,
} from '../../../../shared/instruments/instrument.models';
import {
  CheckItem, ConnectMode, WIZARD_STEPS, WizardStepId, cardChoices, cardOptions, checklist, detectHeadline, firewallFixPlan,
  fixableProblems, pickAnalyzerCard, scanPorts, wizardUpsert,
} from './connect-wizard.logic';
import { AssistantButtonComponent } from '../../../../shared/assistant/assistant-button.component';
import { AssistantPanelComponent } from '../../../../shared/assistant/assistant-panel.component';
import { AssistantPageContext, MAP_PREFILL_STATE_KEY, MappingPrefill } from '../../../../shared/assistant/assistant.models';

interface Hit { port: number; remote: string | null; local: string | null }

/**
 * Lab settings → Instruments → "Connect an analyzer" (desktop app only).
 * A layman's path from "a cable in the PC" to "results arrive":
 *   1. THIS PC — its addresses, and what is in the way (two cards on one
 *      network, a Public network, firewall rules blocking Prefrontal, a port
 *      some old program holds) with ONE Fix (one Windows permission prompt,
 *      only after the user said yes here);
 *   2. FIND THE ANALYZER — "set its host to 192.168.1.10, port 5603" and a
 *      live wait on that port + the usual ones; who connected, and what it
 *      looks like (header → make/model, detected protocol). Or, for an
 *      analyzer that waits to be dialled: the devices this PC has seen, an
 *      opt-in look-around, then connect to it;
 *   3. CREATE & PAIR — creates the instrument with the detected protocol and
 *      pairs this PC (same calls as the editor: applyDetectProposal / pair);
 *   4. CHECKLIST — every check, passed or failed, in plain words.
 * ND pattern: band (back · tenant) with the step tabs in the pill; the step
 * is the main card; the side card holds the checks so far + the ONE primary.
 */
@Component({
  selector: 'pf-connect-wizard',
  standalone: true,
  imports: [NgTemplateOutlet, HeroBandComponent, ScreenHeaderComponent, SelectComponent, SegmentedComponent, BusyDirective, AssistantButtonComponent, AssistantPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './connect-wizard.component.html',
  styleUrl: './connect-wizard.component.scss',
})
export class ConnectWizardComponent {
  private readonly router = inject(Router);
  private readonly api = inject(InstrumentsApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly platform = inject(PlatformService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);
  protected readonly bridge = inject(InstrumentBridgeService);
  protected readonly remoteHost = remoteHost;
  readonly steps = WIZARD_STEPS;
  readonly available = this.bridge.diagAvailable;

  readonly step = signal<WizardStepId>('pc');
  readonly stepIndex = computed(() => this.steps.findIndex((s) => s.id === this.step()));

  // ── 1. This PC ───────────────────────────────────────────────────────
  readonly snap = signal<DiagSnapshot | null>(null);
  readonly snapBusy = signal(false);
  readonly fixBusy = signal(false);
  readonly choices = computed(() => cardChoices(this.snap()?.adapters));
  readonly cardOpts = computed(() => cardOptions(this.choices()));
  readonly card = signal<string | null>(null);
  readonly cardName = computed(() => this.choices().find((c) => c.address === this.card())?.card ?? null);
  readonly problems = computed(() => this.snap()?.problems ?? []);
  readonly fixable = computed(() => fixableProblems(this.problems()));
  readonly profileOf = (alias: string) => this.snap()?.profiles?.find((p) => p.alias === alias)?.category ?? null;

  // ── 2. Find the analyzer ─────────────────────────────────────────────
  readonly modeOptions: SegmentedOption<ConnectMode>[] = [
    { value: 'listen', label: 'It connects to this PC' },
    { value: 'dial', label: 'This PC connects to it' },
  ];
  readonly mode = signal<ConnectMode>('listen');
  readonly port = signal<number | null>(null);
  readonly scanId = signal<string | null>(null);
  readonly scanning = signal(false);
  readonly scanList = signal<number[]>([]);
  readonly scanSkipped = signal<{ port: number; error?: string }[]>([]);
  readonly hit = signal<Hit | null>(null);
  readonly detect = signal<DetectResult | null>(null);
  readonly guess = signal<AnalyzerGuess | null>(null);
  readonly skipped = signal(false);
  readonly headline = computed(() => detectHeadline(this.guess(), this.detect()));
  /** The analyzer reached this PC on another card than the one picked. */
  readonly otherCard = computed(() => {
    const h = this.hit();
    const local = h?.local ? remoteHost(h.local) : null;
    if (!local || !this.card() || local === this.card() || local === '127.0.0.1') return null;
    return this.choices().find((c) => c.address === local) ?? { card: 'another card', address: local };
  });
  // dial mode
  readonly arp = signal<DiagArpEntry[]>([]);
  readonly probeBusy = signal(false);
  readonly probeOpen = signal<{ host: string; port: number }[] | null>(null);
  readonly dialHost = signal('');
  readonly dialPort = signal<number | null>(5100);
  readonly dialSession = signal<string | null>(null);
  readonly dialState = signal<string | null>(null);
  private offScan: (() => void) | null = null;
  private offListen: (() => void) | null = null;

  // ── 3. Create & pair ─────────────────────────────────────────────────
  readonly name = signal('');
  readonly make = signal('');
  readonly model = signal('');
  readonly createBusy = signal(false);
  readonly created = signal<InstrumentDto | null>(null);
  readonly paired = signal(false);

  // ── 4. Checklist ─────────────────────────────────────────────────────
  readonly live = signal<ConnectorStatus | null>(null);
  readonly portState = signal<{ state: string; message?: string } | null>(null);
  readonly liveWord = computed(() => connectorStateWord(this.live()?.state, this.live()?.link));
  private offStatus: (() => void) | null = null;

  readonly checks = computed<CheckItem[]>(() => checklist({
    snapshot: this.snap(), card: this.card(), mode: this.mode(), port: this.mode() === 'listen' ? this.port() : this.dialPort(),
    portReport: this.portState(),
    connectedFrom: this.hit() ? remoteHost(this.hit()!.remote) : null,
    detect: this.detect(), guess: this.guess(),
    created: !!this.created(), paired: this.paired(),
    liveLink: this.live()?.link ?? null, liveProblem: this.live()?.errorDetail ?? null,
  }));
  readonly checksDone = computed(() => this.checks().filter((c) => c.ok === true).length);

  readonly canNext = computed(() => {
    switch (this.step()) {
      case 'pc': return !!this.snap() && !!this.card();
      case 'find': return this.mode() === 'listen'
        ? (!!this.hit() || this.skipped()) && !!this.port()
        : !!this.dialHost().trim() && !!this.dialPort();
      case 'create': return !!this.created();
      default: return false;
    }
  });
  readonly primaryDisabled = computed(() => {
    if (this.createBusy()) return true;
    if (this.step() === 'check') return false;
    if (this.step() === 'create') return !this.created() && !(this.mode() === 'listen' ? this.port() : this.dialPort());
    return !this.canNext();
  });
  /** "5599, 5600, 5601 …" — the other ports this PC is listening on. */
  readonly otherPorts = computed(() => this.scanList().filter((p) => p !== this.port()).join(', '));
  readonly protocolText = computed(() => {
    const d = this.detect();
    return d && d.protocol !== 'unknown' ? this.headline().replace(/^Looks like |^Speaks /, '') : 'Auto-detect (set it later in the instrument)';
  });
  readonly primaryLabel = computed(() => {
    switch (this.step()) {
      case 'pc': return 'Next: find the analyzer';
      case 'find': return 'Next: create & pair';
      case 'create': return this.created() ? 'Next: checklist' : 'Create and pair this PC';
      default: return 'Open the instrument';
    }
  });

  constructor() {
    this.destroyRef.onDestroy(() => { void this.stopScan(); void this.stopDial(); this.offStatus?.(); });
    if (this.available) void this.refresh();
  }

  // ── step 1 ───────────────────────────────────────────────────────────
  async refresh() {
    const d = this.bridge.diag;
    if (!d || this.snapBusy()) return;
    this.snapBusy.set(true);
    try {
      const s = await d.snapshot();
      this.snap.set(s);
      if (!this.card() || !cardChoices(s.adapters).some((c) => c.address === this.card())) this.card.set(pickAnalyzerCard(cardChoices(s.adapters)));
      if (!this.port() && s.suggestedPort) this.port.set(s.suggestedPort);
    } catch (e) {
      this.toasts.error(errText(e, 'Could not read this PC\'s network'));
    } finally {
      this.snapBusy.set(false);
    }
  }

  /** The ONE elevated action — says exactly what changes, then Windows asks once. */
  async fixFirewall() {
    const d = this.bridge.diag;
    if (!d || this.fixBusy()) return;
    const adapter = this.cardName();
    if (!adapter) { this.toasts.info('Pick the network card the analyzer cable goes into first'); return; }
    const plan = firewallFixPlan(this.snap(), adapter, scanPorts(this.port()));
    const ok = await this.dialog.confirm({
      title: 'Let analyzers reach Prefrontal?', tone: 'primary', confirmLabel: 'Fix with Windows permission',
      message: 'Prefrontal will make these changes:', items: plan.lines,
      question: 'Prefrontal asks once more, then Windows asks "Do you want to allow this app to make changes?" — choose Yes both times.',
    });
    if (!ok) return;
    this.fixBusy.set(true);
    try {
      const r = await d.fixFirewall({ ports: plan.ports, adapter });
      if (r.ok && !r.partial) this.toasts.success('Fixed — analyzers on this network can reach Prefrontal');
      else if (r.ok) this.toasts.info(r.error || 'Partly fixed');
      else if (r.cancelled) this.toasts.info(r.error || 'Nothing was changed');
      else this.toasts.error(r.error || 'The fix did not work');
    } catch (e) {
      this.toasts.error(errText(e, 'The fix did not work'));
    } finally {
      this.fixBusy.set(false);
    }
    await this.refresh();
  }

  // ── step 2 ───────────────────────────────────────────────────────────
  setMode(m: ConnectMode) {
    if (m === this.mode()) return;
    this.mode.set(m);
    this.hit.set(null); this.detect.set(null); this.guess.set(null); this.skipped.set(false);
    if (m === 'listen') { void this.stopDial(); void this.startScan(); }
    else { void this.stopScan(); void this.loadArp(); }
  }

  async startScan() {
    const d = this.bridge.diag;
    if (!d || this.scanning()) return;
    const ports = scanPorts(this.port());
    this.offScan?.();
    this.offScan = d.onScan((e) => this.onScan(e));
    this.scanning.set(true);
    const r = await d.scanStart({ ports }).catch((e) => ({ error: errText(e, 'Could not open the ports') }));
    if ('error' in r) { this.scanning.set(false); this.toasts.error(r.error); return; }
    this.scanId.set(r.scanId);
    this.scanList.set(r.ports.filter((p) => p.ok).map((p) => p.port));
    this.scanSkipped.set(r.ports.filter((p) => !p.ok));
    if (!r.scanId) { this.scanning.set(false); this.toasts.error(r.ports[0]?.error || 'Could not open any port'); return; }
    // The suggested port itself could not open — offer the first one that did.
    if (this.port() && !this.scanList().includes(this.port()!)) this.port.set(this.scanList()[0] ?? null);
  }

  private onScan(e: DiagScanEvent) {
    if (!this.scanId() || e.scanId !== this.scanId()) return;
    if (e.kind === 'connected') {
      // The first analyzer to connect wins; its port is the one we keep.
      if (!this.hit()) { this.hit.set({ port: e.port, remote: e.remote ?? null, local: e.local ?? null }); this.port.set(e.port); }
    } else if (e.kind === 'detect' && (!this.hit() || this.hit()!.port === e.port)) {
      if (!this.hit()) { this.hit.set({ port: e.port, remote: e.remote ?? null, local: null }); this.port.set(e.port); }
      if (e.detect) this.detect.set(e.detect);
      if (e.guess) { this.guess.set(e.guess); this.prefillName(e.guess); }
    }
  }

  async stopScan() {
    const id = this.scanId();
    this.offScan?.(); this.offScan = null;
    this.scanId.set(null);
    this.scanning.set(false);
    if (id) { try { await this.bridge.diag?.scanStop(id); } catch { /* the 15-min safety net closes it */ } }
  }

  async loadArp() {
    try { this.arp.set((await this.bridge.diag?.arp()) ?? []); } catch { this.arp.set([]); }
  }

  /** Opt-in: "look around" this card's network for analyzers that wait to be dialled. */
  async probe() {
    const d = this.bridge.diag;
    const address = this.card();
    if (!d || !address || this.probeBusy()) return;
    const net = address.split('.').slice(0, 3).join('.') + '.x';
    const ok = await this.dialog.confirm({
      title: `Look for analyzers on ${net}?`, tone: 'primary', confirmLabel: 'Look now',
      message: 'This PC briefly knocks on the usual LIS ports of the devices it has seen on this network. It only connects and hangs up — nothing is sent.',
    });
    if (!ok) return;
    this.probeBusy.set(true);
    try {
      const r = await d.probe({ address });
      if (r.error === 'rate_limited') { this.toasts.info('Just looked — try again in a minute'); return; }
      if (r.error) { this.toasts.error('Could not look on that network'); return; }
      this.probeOpen.set(r.open ?? []);
      await this.loadArp();
    } finally {
      this.probeBusy.set(false);
    }
  }

  pickDial(host: string, port?: number) {
    this.dialHost.set(host);
    if (port) this.dialPort.set(port);
  }

  /** Dial the analyzer through the existing listen mode (nothing uploaded). */
  async tryDial() {
    const host = this.dialHost().trim();
    const port = this.dialPort();
    if (!host || !port) return;
    await this.stopDial();
    this.hit.set(null); this.detect.set(null); this.guess.set(null);
    this.offListen = this.bridge.onListen((e) => this.onDialEvent(e));
    const r = await this.bridge.listenStart({ transport: { type: 'tcp-client', host, port, reconnectMs: 5000 } });
    if ('error' in r) { this.offListen?.(); this.offListen = null; this.toasts.error(r.error); return; }
    this.dialSession.set(r.sessionId);
    this.dialState.set('connecting');
  }

  private onDialEvent(e: ListenEvent) {
    if (e.sessionId !== this.dialSession()) return;
    if (e.kind === 'status') {
      this.dialState.set(e.state ?? null);
      if (e.state === 'connected' && !this.hit()) this.hit.set({ port: this.dialPort() ?? 0, remote: `${this.dialHost()}:${this.dialPort()}`, local: null });
    } else if (e.kind === 'detect' && e.detect) {
      this.detect.set(e.detect);
    }
  }

  async stopDial() {
    const id = this.dialSession();
    this.offListen?.(); this.offListen = null;
    this.dialSession.set(null);
    this.dialState.set(null);
    if (id) await this.bridge.listenStop(id);
  }

  private prefillName(g: AnalyzerGuess) {
    if (!this.name().trim() && g.label) this.name.set(g.label);
    if (!this.make().trim() && g.make) this.make.set(g.make);
    if (!this.model().trim() && g.model) this.model.set(g.model);
  }

  // ── step 3 ───────────────────────────────────────────────────────────
  async createAndPair() {
    if (this.createBusy() || this.created()) return;
    const listen = this.mode() === 'listen';
    const port = listen ? this.port() : this.dialPort();
    if (!port) return;
    this.createBusy.set(true);
    // Free the port first: the new connector must be the one listening on it.
    await this.stopScan();
    await this.stopDial();
    try {
      const body = wizardUpsert({
        name: this.name() || this.guess()?.label || 'Analyzer', make: this.make() || null, model: this.model() || null,
        mode: this.mode(), port, host: this.dialHost(), detect: this.detect(),
      });
      const dto = await firstValueFrom(this.api.create(body));
      this.created.set(dto);
      const key = await firstValueFrom(this.api.generateDeviceKey(dto.id));
      const res = await this.bridge.pair({ instrumentId: dto.id, deviceKey: key.deviceKey, apiUrl: this.platform.getApiUrl(), name: dto.name });
      this.paired.set(res.ok);
      if (!res.ok) { this.toasts.error(res.error || 'Created, but this PC could not be paired — pair it from the instrument'); return; }
      this.toasts.success(`${dto.name} is set up on this PC`);
      this.watch(dto.id);
      void this.check();
      this.step.set('check');
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.createBusy.set(false);
    }
  }

  private watch(id: string) {
    this.offStatus?.();
    this.offStatus = this.bridge.onStatus((s) => { if (s.instrumentId === id) this.live.set(s); });
    void this.bridge.status().then((all) => { const s = all.find((x) => x.instrumentId === id); if (s) this.live.set(s); });
  }

  // ── step 4 ───────────────────────────────────────────────────────────
  async check() {
    await this.refresh();
    const port = this.mode() === 'listen' ? this.port() : null;
    if (port && this.bridge.diag) {
      try { this.portState.set((await this.bridge.diag.ports([port]))[0] ?? null); } catch { this.portState.set(null); }
    }
  }

  // ── navigation ───────────────────────────────────────────────────────
  go(id: WizardStepId) {
    const target = this.steps.findIndex((s) => s.id === id);
    if (target > this.stepIndex() && !this.reachable(id)) return;
    if (this.step() === 'find' && id !== 'find') { void this.stopScan(); void this.stopDial(); }
    this.step.set(id);
    if (id === 'find' && this.mode() === 'listen' && !this.scanId() && !this.created()) void this.startScan();
    if (id === 'find' && this.mode() === 'dial') void this.loadArp();
    if (id === 'check') void this.check();
  }

  reachable(id: WizardStepId): boolean {
    switch (id) {
      case 'pc': return true;
      case 'find': return !!this.snap() && !!this.card();
      case 'create': return this.reachable('find') && (this.mode() === 'listen' ? (!!this.hit() || this.skipped()) : !!this.dialHost().trim());
      case 'check': return !!this.created();
    }
  }

  back() {
    const i = this.stepIndex();
    if (i > 0) this.go(this.steps[i - 1].id);
    else void this.router.navigate(['/admin/instruments']);
  }

  primary() {
    switch (this.step()) {
      case 'pc': this.go('find'); break;
      case 'find': this.go('create'); break;
      case 'create': if (this.created()) this.go('check'); else void this.createAndPair(); break;
      case 'check': { const id = this.created()?.id; void this.router.navigate(id ? ['/admin/instruments', id] : ['/admin/instruments']); break; }
    }
  }

  setPortText(v: string) { const n = Number(String(v).trim()); this.port.set(Number.isInteger(n) && n > 0 && n <= 65535 ? n : null); }
  setDialPortText(v: string) { const n = Number(String(v).trim()); this.dialPort.set(Number.isInteger(n) && n > 0 && n <= 65535 ? n : null); }
  manual() { void this.router.navigate(['/admin/instruments', 'new']); }

  /** Continue without seeing the analyzer (protocol stays auto-detect). */
  skip() { this.skipped.set(true); this.go('create'); }

  // ── Assistant (beta) ─────────────────────────────────────────────────
  readonly assistantOpen = signal(false);
  /** The network check this helper already took goes along (no second run). */
  readonly assistantContext = computed<AssistantPageContext>(() => ({
    page: 'instruments', subject: this.created()?.name || 'Connect an analyzer',
    instrumentId: this.created()?.id ?? null, canAddMapping: !!this.created(),
    addMappingHint: 'Create the instrument first (step 3) — then add its mappings.',
    diag: this.snap() ?? undefined,
  }));

  /** "Add to mapping": the instrument's Code mapping, row prefilled — asks
   *  first because it leaves this helper. The person saves there. */
  async onAssistantMapping(p: MappingPrefill) {
    const id = this.created()?.id;
    if (!id) return;
    const ok = await this.dialog.confirm({
      title: 'Open Code mapping?', tone: 'primary', confirmLabel: 'Open Code mapping',
      message: `Leaves the setup helper and opens ${this.created()?.name || 'the instrument'} with ${p.analyzerCode} filled in. Check it, then press Save.`,
    });
    if (!ok) return;
    void this.router.navigate(['/admin/instruments', id], { state: { [MAP_PREFILL_STATE_KEY]: { ...p, instrumentId: id } } });
  }
}

function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
