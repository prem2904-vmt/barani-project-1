import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { analyzerLabel } from '../../../shared/utils/report-profile-layout';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ApiError } from '../../../shared/models/api-response.model';
import { Test } from '../../../shared/models/test.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';
import { plural } from '../../../shared/utils/plural';
import { testListUrl } from '../../../shared/utils/test-list-url';
import { InstrumentBridgeService } from '../../../shared/instruments/instrument-bridge.service';
import { InstrumentSimulatorComponent } from '../../../shared/instruments/mock-simulator/instrument-simulator.component';
import {
  BAUD_RATES, CodeMapRow, ConfigBase, DATA_BITS, DEFAULT_SINOCARE_ACK_JSON, DESKTOP_ONLY_PROTOCOLS, FLOW_CONTROLS, SINOCARE_REPLY_MODES, SINOCARE_SAMPLE_ID_FIELDS, FlowControl, HL7_SAMPLE_ID_FIELDS, InstrumentForm, LoincSkip, PARITIES,
  PROTOCOL_OPTIONS, RawSegment, STOP_BITS, TRANSPORT_OPTIONS, WizardStep, applyDetectProposal, applyLoincSuggestions, buildInstrumentConfig,
  buildUpsert, coerceConfig, codesFromMessages, connectedFromLine, connectionSummary, connectorStateWord, statusSubline, emptyCodeMapRow, emptyInstrumentForm, fmtIst, formFromInstrument,
  mergeUnmappedCodes, previewLine, previewRows, renderControlChars, rowFromDto, sharedCodeHint, statusWord, toCodeMapUpserts, validateCodeMaps,
  validateInstrumentForm, withCbcDefaults, withM51Defaults,
} from '../../../shared/instruments/instrument-config';
import {
  ConnectorState, ConnectorStatus, DetectResult, Hl7SampleIdField, ImageCodeDto, InstrumentDto, InstrumentMessage, ListenEvent, LoincSuggestionDto,
  MessageSummaryDto, PairedInstrument, ParserType, RawLogEntry, TransportType,
} from '../../../shared/instruments/instrument.models';
import { InstrumentsApiService } from '../../../shared/instruments/instruments-api.service';
import { TwoWayForm, modeLabel } from '../../../shared/instruments/instrument-two-way';
import { InstrumentTwoWayComponent } from './instrument-two-way.component';
import { SampleIdPickerComponent } from './sample-id-picker.component';
import { SampleIdFormat, formatFor } from '../../../shared/instruments/sample-id-path';
import { applyMappingPrefill, isMappingPrefill } from '../../../shared/instruments/mapping-prefill';
import { AssistantButtonComponent } from '../../../shared/assistant/assistant-button.component';
import { AssistantPanelComponent } from '../../../shared/assistant/assistant-panel.component';
import { AssistantPageContext, MAP_PREFILL_STATE_KEY, MappingPrefill } from '../../../shared/assistant/assistant.models';
import { BridgesApiService } from '../../../shared/bridges/bridges-api.service';
import type { BridgeDto } from '../../../shared/bridges/bridge.models';
import { connectedViaOptions, transportOptionsFor } from '../../../shared/bridges/bridge-assign';
import { bridgeErrorText } from '../../../shared/bridges/bridge-status';
import { AuthService } from '../../../core/auth/auth.service';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { TestMappingService } from '../../../shared/instruments/test-mapping.service';
import { TEST_MAPPING_PERMS, canTestWithId, isViaTestMapping, latestUnmatchedAnalyzerId } from '../../../shared/instruments/test-mapping';
import { TestMappingCardComponent } from './test-mapping-card.component';

type Tab = 'status' | WizardStep;
const RAW_CAP = 64_000;

interface TabDef { id: Tab; label: string }

/**
 * One instrument: the setup WIZARD (Basics → Connection → Protocol → Listen →
 * Code mapping → Device) and, once saved, its live STATUS. ND editor pattern
 * (§14): band = back · tenant · Remove + the ONE primary (Create / Save);
 * the pill = the instrument's name + the step tabs; the focused step is one
 * card with Back / Next; the side card shows the connector (live on the
 * paired desktop app, the server's last heartbeat on the web).
 *
 * Listening, port lists and pairing need the Electron desktop app
 * (InstrumentBridgeService.available); the web shows what runs where.
 */
@Component({
  selector: 'pf-instrument-editor',
  standalone: true,
  imports: [NgTemplateOutlet, HeroBandComponent, ScreenHeaderComponent, SelectComponent, BusyDirective, SkeletonFormComponent, InstrumentTwoWayComponent, SampleIdPickerComponent, AssistantButtonComponent, AssistantPanelComponent, TestMappingCardComponent, InstrumentSimulatorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './instrument-editor.component.html',
  styleUrl: './instrument-editor.component.scss',
})
export class InstrumentEditorComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(InstrumentsApiService);
  private readonly rawApi = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly platform = inject(PlatformService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);
  protected readonly bridge = inject(InstrumentBridgeService);
  protected readonly plural = plural;
  protected readonly fmtIst = fmtIst;
  protected readonly previewLine = previewLine;

  // ── Option lists ─────────────────────────────────────────────────────
  // Prefrontal Bridge (bridge-api v1): "Connected through: This computer |
  // Prefrontal Bridge ‹pick›". Through a Bridge only listen / connect exist,
  // and the save also calls PUT /api/instruments/{id}/bridge.
  private readonly pfBridgesApi = inject(BridgesApiService);
  readonly pfBridges = signal<BridgeDto[]>([]);
  /** '' = this computer; else the Bridge id. */
  readonly connectedVia = signal<string>('');
  readonly connectedViaOptions = computed<PfSelectOption<string>[]>(() => connectedViaOptions(this.pfBridges()));
  readonly showConnectedVia = computed(() => this.pfBridges().length > 0 || !!this.dto()?.bridgeId);
  readonly transportOptions = computed<PfSelectOption<TransportType>[]>(() => transportOptionsFor(TRANSPORT_OPTIONS, !!this.connectedVia()));
  readonly baudOptions: PfSelectOption<number>[] = BAUD_RATES.map((b) => ({ value: b, label: String(b) }));
  readonly dataBitOptions: PfSelectOption<number>[] = DATA_BITS.map((b) => ({ value: b, label: String(b) }));
  readonly parityOptions = PARITIES;
  readonly stopBitOptions: PfSelectOption<number>[] = STOP_BITS.map((b) => ({ value: b, label: String(b) }));
  readonly flowOptions = FLOW_CONTROLS;
  /** Through a Prefrontal Bridge the desktop-only presets are hidden (unless already chosen). */
  readonly protocolOptions = computed<PfSelectOption<ParserType>[]>(() => this.connectedVia()
    ? PROTOCOL_OPTIONS.filter((o) => !DESKTOP_ONLY_PROTOCOLS.includes(o.value) || o.value === this.form().protocol)
    : PROTOCOL_OPTIONS);
  readonly sinocareReplyOptions = SINOCARE_REPLY_MODES;
  readonly sinocareSampleIdOptions = SINOCARE_SAMPLE_ID_FIELDS;
  readonly defaultSinocareAck = DEFAULT_SINOCARE_ACK_JSON;
  readonly idToken = '{{id}}';
  readonly hl7FieldOptions: PfSelectOption<Hl7SampleIdField>[] = HL7_SAMPLE_ID_FIELDS;


  // ── Record ───────────────────────────────────────────────────────────
  readonly id = signal<string | null>(null);
  readonly isNew = computed(() => !this.id());
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly removing = signal(false);
  readonly dto = signal<InstrumentDto | null>(null);
  readonly form = signal<InstrumentForm>(emptyInstrumentForm());
  private configBase: ConfigBase | null = null;
  readonly dirty = signal(false);
  readonly issues = computed(() => validateInstrumentForm(this.form()));
  readonly tab = signal<Tab>('basics');
  readonly tabs = computed<TabDef[]>(() => [
    ...(this.isNew() ? [] : [{ id: 'status' as Tab, label: 'Status' }]),
    { id: 'basics', label: 'Basics' },
    { id: 'connection', label: 'Connection' },
    { id: 'protocol', label: 'Protocol' },
    { id: 'listen', label: 'Listen' },
    { id: 'mapping', label: 'Code mapping' },
    { id: 'twoway', label: 'Two-way' },
    { id: 'device', label: 'Device' },
  ]);
  readonly title = computed(() => this.form().name.trim() || this.dto()?.name || 'New instrument');
  readonly primaryLabel = computed(() => (this.isNew() ? 'Create instrument' : 'Save'));
  readonly canSave = computed(() => !this.loading() && this.issues().length === 0 && this.mapIssues().length === 0);

  /** Violet dot = complete, ring = something to finish. */
  tabDone(t: Tab): boolean {
    const issues = this.issues();
    switch (t) {
      case 'basics': return !issues.some((i) => i.step === 'basics');
      case 'connection': return !issues.some((i) => i.step === 'connection');
      case 'protocol': return !issues.some((i) => i.step === 'protocol');
      case 'listen': return this.detect() !== null || !!this.dto()?.lastMessageAt;
      case 'mapping': return this.maps().some((r) => r.testCatalogKey) && this.mapIssues().length === 0;
      case 'twoway': return !issues.some((i) => i.step === 'twoway');
      case 'device': return !!this.dto()?.hasDeviceKey;
      default: return true;
    }
  }
  issueFor(field: string): string | null {
    return this.issues().find((i) => i.field === field)?.message ?? null;
  }

  // ── Code maps ────────────────────────────────────────────────────────
  readonly maps = signal<CodeMapRow[]>([]);
  readonly mapsDirty = signal(false);
  // ── Analyzer images → profiles (owner 2026-10-02) ───────────────────
  private readonly uploads = inject(UploadsService);
  readonly imageMaps = signal<ImageCodeDto[]>([]);
  readonly imageMapsDirty = signal(false);
  readonly newImageCode = signal('');
  /** Profiles (by catalogue key) an image can be mapped to. */
  readonly profileOptions = computed((): PfSelectOption[] => this.tests()
    .filter(t => t.type !== 'individual' && !!t.catalogKey)
    .map(t => ({ value: t.catalogKey!, label: t.name, hint: t.catalogKey! }))
    .sort((a, b) => a.label.localeCompare(b.label)));
  profileNames(keys: string[]): string { return keys.map(k => this.profileName(k)).join(', '); }
  profileName(key: string): string { return this.profileOptions().find(o => o.value === key)?.label ?? key; }
  imageLabel(r: ImageCodeDto): string { return r.label || analyzerLabel(r.code); }
  /** The newest received graph (session fetch), else a sample look-alike. */
  /** Only a graph this analyzer actually sent — never a built-in sample (owner rule). '' = placeholder. */
  imageSrc(r: ImageCodeDto): string { return r.lastUrl ? this.uploads.src(r.lastUrl) || '' : ''; }
  setImageProfiles(i: number, keys: string[]) {
    this.imageMaps.update(list => list.map((r, j) => (j === i ? { ...r, profileKeys: keys } : r)));
    this.imageMapsDirty.set(true);
  }
  addImageCode() {
    const code = this.newImageCode().trim();
    if (!code || this.imageMaps().some(r => r.code === code)) { this.newImageCode.set(''); return; }
    this.imageMaps.update(list => [...list, { code, label: null, seen: 0, lastUrl: null, lastAt: null, profileKeys: [] }]);
    this.imageMapsDirty.set(true);
    this.newImageCode.set('');
  }
  private loadImageMaps(id: string) {
    this.api.imageMaps(id).subscribe({
      next: list => { this.imageMaps.set(list ?? []); this.imageMapsDirty.set(false); },
      error: () => this.imageMaps.set([]),
    });
  }
  readonly mapIssues = computed(() => validateCodeMaps(this.maps()));
  readonly tests = signal<Test[]>([]);
  readonly testOptions = computed<PfSelectOption<string>[]>(() => {
    const seen = new Set<string>();
    const out: PfSelectOption<string>[] = [];
    for (const t of this.tests()) {
      if (!t.catalogKey || t.type !== 'individual' || seen.has(t.catalogKey)) continue;
      seen.add(t.catalogKey);
      out.push({ value: t.catalogKey, label: t.name, hint: [t.testCode || t.code, t.catalogKey].filter(Boolean).join(' · ') });
    }
    // A mapped key the list doesn't carry (switched off / other branch) keeps its label.
    for (const r of this.maps()) {
      if (r.testCatalogKey && !seen.has(r.testCatalogKey)) {
        seen.add(r.testCatalogKey);
        out.push({ value: r.testCatalogKey, label: r.testName || r.testCatalogKey, hint: r.testCatalogKey });
      }
    }
    return out;
  });
  readonly serverUnmapped = signal<string[]>([]);
  /** code (uppercased) → a unit seen for it (server message preview / listen
   *  session) — passed to the suggestions endpoint so a single-candidate
   *  WBC/PLT match can be ×1000-suggested; best-effort, never required. */
  private serverUnmappedUnits = new Map<string, string>();
  /** Codes on the ignore list the last "Add unmapped codes" / typed lookup
   *  skipped (age/sex/height/weight…) — the quiet note under the table. */
  readonly loincSkipped = signal<LoincSkip[]>([]);
  private readonly loincLookupTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // ── Serial ports (Electron) ──────────────────────────────────────────
  readonly ports = signal<PfSelectOption<string>[]>([]);

  // ── Listen mode (Electron) ───────────────────────────────────────────
  readonly sessionId = signal<string | null>(null);
  readonly listenBusy = signal(false);
  readonly listenState = signal<string | null>(null);
  readonly listenError = signal<string | null>(null);
  readonly rawText = signal('');
  readonly rawSegments = computed<RawSegment[]>(() => renderControlChars(this.rawText()));
  readonly detect = signal<DetectResult | null>(null);
  readonly messages = signal<InstrumentMessage[]>([]);
  readonly previewData = computed(() => previewRows(this.messages()));
  readonly listenCodes = computed(() => codesFromMessages(this.messages()));
  readonly pasteText = signal('');
  readonly pasteOpen = signal(false);
  readonly previewBusy = signal(false);
  private offListen: (() => void) | null = null;

  // ── Device & pairing ─────────────────────────────────────────────────
  readonly freshKey = signal<string | null>(null);
  readonly keyBusy = signal(false);
  readonly paired = signal<PairedInstrument | null>(null);
  readonly pairBusy = signal(false);

  // ── Status ───────────────────────────────────────────────────────────
  readonly live = signal<ConnectorStatus | null>(null);
  readonly rawLog = signal<RawLogEntry[]>([]);
  readonly recent = signal<MessageSummaryDto[]>([]);
  readonly serverStatus = computed(() => statusWord(this.dto()?.status));
  readonly liveWord = computed(() => connectorStateWord(this.live()?.state, this.live()?.link));
  /** "connected from 192.168.1.21 · last data 2 min ago" (this PC, live). */
  readonly liveFrom = computed(() => connectedFromLine(this.live()));
  /** The connector's last heartbeat state in words (never the raw "listening"). */
  readonly hbWord = computed(() => { const hb = this.dto()?.lastStatus; return hb ? connectorStateWord(hb.status, hb.link).label : ''; });
  /** The same line from the server's view (web / another PC). */
  readonly serverSub = computed(() => statusSubline(this.dto()));
  /** A plain-words problem (port busy / access denied / refused) beats the raw last error. */
  readonly liveProblem = computed(() => this.live()?.errorDetail || this.live()?.lastError || null);
  readonly connection = computed(() => connectionSummary(buildInstrumentConfig(this.form(), this.configBase)));
  private offStatus: (() => void) | null = null;

  constructor() {
    // "Add to mapping" from another screen's assistant: the row arrives in
    // the navigation state (never in the URL); the input serves embedding.
    const nav = this.router.getCurrentNavigation()?.extras.state?.[MAP_PREFILL_STATE_KEY];
    if (isMappingPrefill(nav)) this.queuePrefill(nav, true);
    effect(() => { const p = this.mapPrefill(); if (isMappingPrefill(p)) untracked(() => this.queuePrefill(p)); });
    const raw = this.route.snapshot.paramMap.get('id');
    this.id.set(raw && raw !== 'new' ? raw : null);
    if (!this.id()) this.tab.set('basics');
    void this.init();
    this.destroyRef.onDestroy(() => {
      this.offListen?.();
      this.offStatus?.();
      for (const t of this.loincLookupTimers.values()) clearTimeout(t);
      const sid = this.sessionId();
      if (sid) void this.bridge.listenStop(sid);
      // Leaving the PAGE (not a tab switch — the session lives in the root service) ends a running test.
      const t = this.testMapping.active();
      if (t && t.instrumentId === this.id()) void this.testMapping.end('left');
    });
  }

  private async init() {
    this.loadTests();
    // Bridges are optional: an older server (404) or no permission → none.
    this.pfBridgesApi.list().subscribe({ next: (l) => this.pfBridges.set(Array.isArray(l) ? l : []), error: () => undefined });
    if (this.bridge.available) void this.loadPorts();
    const id = this.id();
    if (!id) { this.loading.set(false); this.mapsReady = true; this.flushPrefill(); return; }
    try {
      const dto = await firstValueFrom(this.api.get(id));
      this.applyDto(dto);
      this.tab.set('status');
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.loading.set(false);
    }
    this.loadMaps(id);
    this.loadRecent(id);
    void this.loadPaired(id);
    if (this.bridge.available) {
      const all = await this.bridge.status();
      this.live.set(all.find((s) => s.instrumentId === id) ?? null);
      this.offStatus = this.bridge.onStatus((s) => { if (s.instrumentId === id) this.live.set(s); });
      void this.refreshRawLog();
    }
  }

  private applyDto(dto: InstrumentDto) {
    this.dto.set(dto);
    this.configBase = coerceConfig<ConfigBase>(dto.config);
    this.form.set(formFromInstrument(dto));
    this.sampleIdMode.set(this.form().sampleIdPath?.path ? 'custom' : 'standard');
    if (this.sampleIdMode() === 'custom' && this.tab() === 'protocol') void this.loadPickerMessage();
    this.connectedVia.set(dto.bridgeId ?? '');
    this.dirty.set(false);
  }

  /** Pick "This computer" or a Bridge; a Bridge can't do serial / folder. */
  setConnectedVia(v: string) {
    this.connectedVia.set(v ?? '');
    const t = this.form().transport;
    if (v && t !== 'tcp-server' && t !== 'tcp-client') this.patch({ transport: 'tcp-server' });
    else this.dirty.set(true);
  }

  private loadTests() {
    this.rawApi.get<Test[]>(testListUrl({})).subscribe({
      next: (list) => { this.tests.set(Array.isArray(list) ? list : []); this.testsReady = true; this.flushPrefill(); },
      error: () => { this.tests.set([]); this.testsReady = true; this.flushPrefill(); },
    });
  }

  private loadMaps(id: string) {
    this.loadImageMaps(id);
    this.api.codeMaps(id).subscribe({
      next: (list) => { this.maps.set((list ?? []).map(rowFromDto)); this.mapsDirty.set(false); this.mapsReady = true; this.flushPrefill(); },
      error: () => { this.mapsReady = true; this.flushPrefill(); },
    });
    // Codes the server saw but could not map (any state) — "Add unmapped codes".
    this.api.messages({ state: 'all', instrumentId: id, pageSize: 100 }).subscribe({
      next: (page) => {
        const codes = new Set<string>();
        this.serverUnmappedUnits.clear();
        for (const m of page?.items ?? []) {
          for (const c of m.unmappedCodes ?? []) codes.add(c);
          for (const p of m.preview ?? []) if (p.code && p.unit) this.serverUnmappedUnits.set(p.code.trim().toUpperCase(), p.unit);
        }
        this.serverUnmapped.set([...codes]);
      },
      error: () => undefined,
    });
  }

  /** A known unit for `code` (listen session first, else a server message's
   *  preview) — best-effort context for the LOINC factor suggestion. */
  private codeUnitHint(code: string): string | null {
    const key = code.trim().toUpperCase();
    for (const r of this.previewData()) if (r.code.trim().toUpperCase() === key && r.unit) return r.unit;
    return this.serverUnmappedUnits.get(key) ?? null;
  }

  loadRecent(id = this.id()) {
    if (!id) return;
    this.api.messages({ state: 'all', instrumentId: id, pageSize: 20 }).subscribe({
      next: (page) => this.recent.set(page?.items ?? []),
      error: () => this.recent.set([]),
    });
  }

  /** "N codes auto-matched by LOINC — confirm in Code mapping" banner
   *  (Status tab): summed across the recent-results list. */
  readonly recentAutoMatchedCount = computed(() => this.recent().reduce((n, m) => n + (m.autoMatchedCodes?.length ?? 0), 0));

  // ── Test with an analyzer ID (one-time temporary mapping, 2026-10-31) ──
  private readonly auth = inject(AuthService);
  protected readonly testMapping = inject(TestMappingService);
  protected readonly web = webPointerSignal();
  protected readonly isViaTestMapping = isViaTestMapping;
  protected readonly canTestWithId = canTestWithId;
  /** The server's set for test sessions (it enforces it too). */
  readonly canTestMapping = computed(() => this.auth.hasAnyPermission(TEST_MAPPING_PERMS));
  /** The card's prefill: the newest unmatched result's analyzer ID. */
  readonly suggestedTestId = computed(() => latestUnmatchedAnalyzerId(this.recent()));
  private readonly testCard = viewChild(TestMappingCardComponent);
  /** A test is running for THIS instrument (the Status tab label shows "Testing…" on any tab). */
  readonly testingHere = computed(() => { const t = this.testMapping.active(); return !!t && t.instrumentId === this.id(); });

  /** "Test with this ID" on an unmatched result: if a test already waits for
   *  that ID, re-run this result through it; else prefill the card. */
  async testWithId(m: MessageSummaryDto) {
    const id = this.id();
    if (!id || !m.sampleId) return;
    if (this.testMapping.isRunningFor(id, m.sampleId)) {
      const r = await this.testMapping.reingest(m.id);
      if (r.ok) { this.toasts.success(`Sent ${m.sampleId} again through the test`); this.loadRecent(); }
      else this.toasts.error(r.error);
      return;
    }
    this.testCard()?.useId(m.sampleId);
  }

  private async loadPorts() {
    const list = await this.bridge.listSerialPorts();
    this.ports.set(list.map((p) => ({ value: p.path, label: p.path, hint: [p.manufacturer, p.serialNumber].filter(Boolean).join(' · ') || undefined })));
  }

  private async loadPaired(id: string) {
    if (!this.bridge.available) return;
    const list = await this.bridge.list();
    this.paired.set(list.find((p) => p.instrumentId === id) ?? null);
  }

  async refreshRawLog() {
    const id = this.id();
    if (!id || !this.bridge.available) return;
    this.rawLog.set(await this.bridge.rawLog(id, 200));
  }
  rawLogSegments(e: RawLogEntry): RawSegment[] { return renderControlChars(e.text); }
  previewText(m: MessageSummaryDto): string {
    return (m.preview ?? []).slice(0, 4).map((p) => `${p.code} ${p.value}`).join(' · ');
  }

  // ── Form edits ───────────────────────────────────────────────────────
  patch(p: Partial<InstrumentForm>) { this.form.update((f) => ({ ...f, ...p })); this.dirty.set(true); }
  patchSerial(p: Partial<InstrumentForm['serial']>) { this.form.update((f) => ({ ...f, serial: { ...f.serial, ...p } })); this.dirty.set(true); }
  patchTcpServer(port: unknown) { this.form.update((f) => ({ ...f, tcpServer: { port: toInt(port) } })); this.dirty.set(true); }
  patchTcpClient(p: { host?: string; port?: unknown }) {
    this.form.update((f) => ({ ...f, tcpClient: { host: p.host ?? f.tcpClient.host, port: p.port === undefined ? f.tcpClient.port : toInt(p.port) } }));
    this.dirty.set(true);
  }
  patchFolder(p: Partial<InstrumentForm['folder']>) { this.form.update((f) => ({ ...f, folder: { ...f.folder, ...p } })); this.dirty.set(true); }
  patchAstm(p: { sampleIdField?: unknown; sampleIdComponent?: unknown }) {
    this.form.update((f) => ({ ...f, astm: {
      sampleIdField: p.sampleIdField === undefined ? f.astm.sampleIdField : toInt(p.sampleIdField) ?? 0,
      sampleIdComponent: p.sampleIdComponent === undefined ? f.astm.sampleIdComponent : toInt(p.sampleIdComponent) ?? 1,
    } }));
    this.dirty.set(true);
  }
  patchHl7(v: Hl7SampleIdField) { this.form.update((f) => ({ ...f, hl7: { sampleIdField: v } })); this.dirty.set(true); }
  patchText(p: Partial<InstrumentForm['text']>) { this.form.update((f) => ({ ...f, text: { ...f.text, ...p } })); this.dirty.set(true); }
  patchHbpro(fields: string) { this.form.update((f) => ({ ...f, hbpro: { fields } })); this.dirty.set(true); }
  patchSinocare(p: Partial<InstrumentForm['sinocare']>) { this.form.update((f) => ({ ...f, sinocare: { ...f.sinocare, ...p } })); this.dirty.set(true); }
  setFlow(v: FlowControl) { this.patchSerial({ flow: v }); }
  patchTwoWay(v: TwoWayForm) { this.patch({ twoWay: v }); }
  /** Side card: the two-way mode in plain words. */
  readonly twoWayLabel = computed(() => modeLabel(this.form().twoWay.mode));

  // ── Sample number: standard field | custom (picked from a real message) ──
  readonly sampleIdModeOptions: PfSelectOption<'standard' | 'custom'>[] = [
    { value: 'standard', label: 'Standard (the setting above)' },
    { value: 'custom', label: 'Custom — pick from a received message', hint: 'Tap the sample number in the last message the analyzer sent' },
  ];
  readonly sampleIdMode = signal<'standard' | 'custom'>('standard');
  /** The message the picker shows (raw text) and where it came from. */
  readonly pickerRaw = signal<string | null>(null);
  readonly pickerSource = signal('');
  readonly pickerLoading = signal(false);
  /** Newest message this Listen session captured (raw text), if any. */
  private readonly listenRaw = computed(() => {
    const ms = this.messages();
    for (let i = ms.length - 1; i >= 0; i--) if (ms[i].raw) return ms[i];
    return null;
  });
  readonly pickerFormat = computed<SampleIdFormat>(() => formatFor(this.form().protocol, this.pickerRaw()));
  /** The path shown in the picker: only one that fits the message's format. */
  readonly pickerPath = computed(() => {
    const c = this.form().sampleIdPath;
    return c && c.format === this.pickerFormat() ? c.path : '';
  });

  setSampleIdMode(v: 'standard' | 'custom') {
    this.sampleIdMode.set(v);
    if (v === 'standard') { if (this.form().sampleIdPath) this.patch({ sampleIdPath: null }); return; }
    void this.loadPickerMessage();
  }

  /** Listen capture first; else the newest message the server stored for this instrument. */
  async loadPickerMessage() {
    const live = this.listenRaw();
    if (live?.raw) {
      this.pickerRaw.set(live.raw);
      this.pickerSource.set(`just now (Listen)${live.sampleId ? ` · sample ${live.sampleId}` : ''}`);
      return;
    }
    const id = this.id();
    if (!id) { this.pickerRaw.set(null); return; }
    this.pickerLoading.set(true);
    try {
      const page = await firstValueFrom(this.api.messages({ state: 'all', instrumentId: id, pageSize: 1 }));
      const last = page?.items?.[0];
      if (!last) { this.pickerRaw.set(null); return; }
      const detail = await firstValueFrom(this.api.message(last.id));
      this.pickerRaw.set(detail?.raw || null);
      this.pickerSource.set(`${fmtIst(last.receivedAt)}${last.sampleId ? ` · sample ${last.sampleId}` : ''}`);
    } catch {
      this.pickerRaw.set(null);
    } finally {
      this.pickerLoading.set(false);
    }
  }

  onSampleIdPick(path: string) {
    this.patch({ sampleIdPath: path ? { format: this.pickerFormat(), path } : null });
  }

  // ── Steps ────────────────────────────────────────────────────────────
  go(t: Tab) { this.tab.set(t); if (t === 'protocol' && this.sampleIdMode() === 'custom') void this.loadPickerMessage(); if (t === 'status') { this.loadRecent(); void this.refreshRawLog(); } }
  private stepIndex() { return this.tabs().findIndex((t) => t.id === this.tab()); }
  readonly prevTab = computed(() => { const i = this.stepIndex(); return i > 0 ? this.tabs()[i - 1] : null; });
  readonly nextTab = computed(() => { const i = this.stepIndex(); const all = this.tabs(); return i >= 0 && i < all.length - 1 ? all[i + 1] : null; });

  // ── Save / remove ────────────────────────────────────────────────────
  async save() {
    if (!this.canSave() || this.saving()) {
      const first = this.issues()[0];
      if (first) { this.tab.set(first.step); this.toasts.error(first.message); }
      else if (this.mapIssues()[0]) { this.tab.set('mapping'); this.toasts.error(this.mapIssues()[0].message); }
      return;
    }
    this.saving.set(true);
    try {
      const body = buildUpsert(this.form(), this.configBase, this.dto()?.profileKey ?? null);
      const id = this.id();
      let saved = await firstValueFrom(id ? this.api.update(id, body) : this.api.create(body));
      const via = this.connectedVia() || null;
      if ((saved.bridgeId ?? null) !== via) {
        try {
          saved = await firstValueFrom(this.pfBridgesApi.assignInstrument(saved.id, via));
        } catch (e) {
          const err = ApiError.from(e);
          this.toasts.error(bridgeErrorText(err.code, err.message));
        }
      }
      this.applyDto(saved);
      if (this.mapsDirty() || (!id && this.maps().length)) {
        const maps = await firstValueFrom(this.api.saveCodeMaps(saved.id, toCodeMapUpserts(this.maps())));
        this.maps.set((maps ?? []).map(rowFromDto));
        this.mapsDirty.set(false);
      }
      if (this.imageMapsDirty()) {
        const im = await firstValueFrom(this.api.saveImageMaps(saved.id, this.imageMaps()
          .filter(r => r.profileKeys.length).map(r => ({ code: r.code, label: r.label, profileKeys: r.profileKeys }))));
        this.imageMaps.set(im ?? []);
        this.imageMapsDirty.set(false);
      }
      this.toasts.success(id ? 'Instrument saved' : 'Instrument created');
      // Paired here? Apply the saved settings to the running connector now
      // (live reload — no re-pair / restart; other PCs pick it up on heartbeat).
      if (id && this.bridge.available && this.paired()) {
        const r = await this.bridge.reload(id);
        if (r.ok && r.changed) this.toasts.success(r.restarted ? 'Connection restarted with the new settings' : 'New settings applied on this PC');
        await this.loadPaired(id);
      }
      if (!id) {
        this.id.set(saved.id);
        void this.router.navigate(['/admin/instruments', saved.id], { replaceUrl: true });
      }
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.saving.set(false);
    }
  }

  async remove() {
    const id = this.id();
    if (!id) return;
    const ok = await this.dialog.confirm({
      title: `Remove ${this.title()}?`, tone: 'danger', confirmLabel: 'Remove',
      message: 'The analyzer stops sending results. Results already received stay on record.',
    });
    if (!ok) return;
    this.removing.set(true);
    try {
      await firstValueFrom(this.api.remove(id));
      if (this.bridge.available && this.paired()) await this.bridge.unpair(id);
      this.toasts.success('Instrument removed');
      void this.router.navigate(['/admin/instruments']);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.removing.set(false);
    }
  }

  // ── Code mapping ─────────────────────────────────────────────────────
  private setMaps(rows: CodeMapRow[]) { this.maps.set(rows); this.mapsDirty.set(true); }
  patchMap(i: number, p: Partial<CodeMapRow>) {
    this.setMaps(this.maps().map((r, j) => (j === i ? { ...r, ...p } : r)));
  }
  pickTest(i: number, key: string) {
    const t = this.tests().find((x) => x.catalogKey === key);
    const unit = this.maps()[i]?.unit || t?.derivedUnit || t?.unit || '';
    // A human pick from the full list always wins over an earlier LOINC
    // auto-fill — the chip only ever describes the CURRENT test.
    this.patchMap(i, { testCatalogKey: key, testName: t?.name ?? null, unit, loincMatched: false });
  }
  numOrNull(v: unknown): number | null { const s = String(v ?? '').trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }
  addRow() { this.setMaps([...this.maps(), emptyCodeMapRow()]); }
  removeRow(i: number) { this.setMaps(this.maps().filter((_, j) => j !== i)); }
  loadCbc() {
    const before = this.maps().filter((r) => r.testCatalogKey).length;
    this.setMaps(withCbcDefaults(this.maps()));
    const added = this.maps().filter((r) => r.testCatalogKey).length - before;
    this.toasts.success(added > 0 ? `${plural(added, 'CBC code')} added` : 'CBC codes are already mapped');
  }
  loadM51() {
    const before = this.maps().filter((r) => r.testCatalogKey).length;
    this.setMaps(withM51Defaults(this.maps()));
    const added = this.maps().filter((r) => r.testCatalogKey).length - before;
    this.toasts.success(added > 0 ? `${plural(added, 'Mindray / Medonic code')} added` : 'Mindray / Medonic codes are already mapped');
  }
  readonly unmappedCandidates = computed(() => {
    const onGrid = new Set(this.maps().map((r) => r.analyzerCode.trim().toUpperCase()));
    const all = [...this.listenCodes(), ...this.serverUnmapped()];
    return [...new Set(all.map((c) => c.trim()).filter((c) => c && !onGrid.has(c.toUpperCase())))];
  });
  /** "Add unmapped codes": asks the server for a LOINC match per code first
   *  (single match pre-fills test + factor/decimals/unit, several candidates
   *  get a picker limited to them, a non-analyte code is skipped — never
   *  added); falls back to plain blank rows (old behaviour) if the lookup
   *  can't run (no saved instrument yet, or the request fails). */
  async addUnmapped() {
    const codes = this.unmappedCandidates();
    if (!codes.length) { this.toasts.success('No new codes to add'); return; }
    const id = this.id();
    let suggestions: LoincSuggestionDto[] | null = null;
    if (id) {
      try { suggestions = await firstValueFrom(this.api.codeMapSuggestions(id, codes, codes.map((c) => this.codeUnitHint(c)))); }
      catch { suggestions = null; }
    }
    if (suggestions?.length) {
      const { rows, added, matched, skipped } = applyLoincSuggestions(this.maps(), suggestions);
      this.loincSkipped.set(skipped);
      if (added) this.setMaps(rows);
      const msg = added
        ? `${plural(added, 'code')} added${matched ? ` (${plural(matched, 'match')} by LOINC)` : ''}`
        : (skipped.length ? 'No new codes to add — the rest aren’t tests' : 'No new codes to add');
      this.toasts.success(msg);
      return;
    }
    const { rows, added } = mergeUnmappedCodes(this.maps(), codes);
    if (added) this.setMaps(rows);
    this.toasts.success(added ? `${plural(added, 'code')} added — pick the test for each` : 'No new codes to add');
  }
  mapIssueAt(i: number): string | null { return this.mapIssues().find((x) => x.index === i)?.message ?? null; }
  sharedCodeAt(i: number): string | null { return sharedCodeHint(this.maps(), i); }
  skippedCodesText(): string { return this.loincSkipped().map((s) => `${s.code} (${s.reason})`).join(', '); }

  /** Analyzer-code box: edits the row as usual, and debounces a LOINC
   *  lookup for a blank-test row so typing a LOINC code (e.g. straight off
   *  an HL7 capture) auto-fills the same way "Add unmapped codes" does. */
  onAnalyzerCodeInput(i: number, value: string) {
    this.patchMap(i, { analyzerCode: value, loincMatched: false, loincCandidates: undefined });
    const existing = this.loincLookupTimers.get(i);
    if (existing) clearTimeout(existing);
    const code = value.trim();
    const id = this.id();
    if (!code || !id) return;
    this.loincLookupTimers.set(i, setTimeout(() => void this.lookupLoincForRow(i, code), 400));
  }
  private async lookupLoincForRow(i: number, code: string) {
    const id = this.id();
    const row = this.maps()[i];
    if (!id || !row || row.testCatalogKey || row.analyzerCode.trim() !== code) return;
    let suggestions: LoincSuggestionDto[];
    try { suggestions = await firstValueFrom(this.api.codeMapSuggestions(id, [code], [this.codeUnitHint(code)])); }
    catch { return; }
    const sug = suggestions[0];
    const current = this.maps()[i];
    // Stale by the time the response lands (row removed, test picked, or the
    // code box moved on) — never clobber whatever is there now.
    if (!sug || !current || current.testCatalogKey || current.analyzerCode.trim() !== code) return;
    if (!sug.isTest) return; // a typed ignore-list code is left to the human, never mutated
    if (sug.candidates.length === 1) {
      const c = sug.candidates[0];
      this.patchMap(i, {
        testCatalogKey: c.catalogKey, testName: c.testName,
        factor: sug.suggestedFactor ?? 1, decimals: sug.suggestedDecimals ?? null,
        unit: sug.suggestedUnit ?? c.unit ?? current.unit, loincMatched: true,
      });
      this.toasts.success(`Matched by LOINC: ${c.testName}`);
    } else if (sug.candidates.length > 1) {
      this.patchMap(i, { loincCandidates: [...sug.candidates] });
    }
  }
  loincCandidateOptions(r: CodeMapRow): PfSelectOption<string>[] {
    return (r.loincCandidates ?? []).map((c) => ({ value: c.catalogKey, label: c.testName, hint: c.catalogKey }));
  }
  /** Choosing from the LOINC-ambiguous picker — same effect as `pickTest`,
   *  scoped to the candidates the server actually matched. */
  pickLoincCandidate(i: number, catalogKey: string) {
    const row = this.maps()[i];
    const c = row?.loincCandidates?.find((x) => x.catalogKey === catalogKey);
    if (!c) return;
    this.patchMap(i, { testCatalogKey: c.catalogKey, testName: c.testName, unit: row.unit || c.unit || '', loincCandidates: undefined });
  }

  // ── Listen mode ──────────────────────────────────────────────────────
  async startListen() {
    if (!this.bridge.available || this.sessionId()) return;
    const issues = this.issues().filter((i) => i.step === 'connection');
    if (issues.length) { this.tab.set('connection'); this.toasts.error(issues[0].message); return; }
    this.listenBusy.set(true);
    this.listenError.set(null);
    this.rawText.set('');
    this.messages.set([]);
    this.detect.set(null);
    const cfg = buildInstrumentConfig(this.form(), this.configBase);
    this.offListen?.();
    this.offListen = this.bridge.onListen((e) => this.onListenEvent(e));
    const res = await this.bridge.listenStart({ transport: cfg.transport, link: cfg.link, parser: cfg.parser });
    this.listenBusy.set(false);
    if ('error' in res) { this.listenError.set(res.error); this.offListen?.(); this.offListen = null; return; }
    this.sessionId.set(res.sessionId);
    this.listenState.set('listening');
  }

  async stopListen() {
    const sid = this.sessionId();
    if (!sid) return;
    this.listenBusy.set(true);
    const res = await this.bridge.listenStop(sid);
    this.listenBusy.set(false);
    this.sessionId.set(null);
    this.listenState.set('stopped');
    this.offListen?.();
    this.offListen = null;
    if (res) this.applyListenResult(res.raw, res.detect, res.messages, false);
  }

  private onListenEvent(e: ListenEvent) {
    if (!e || e.sessionId !== this.sessionId()) return;
    switch (e.kind) {
      case 'raw': if (e.text) this.rawText.update((t) => (t + e.text).slice(-RAW_CAP)); break;
      case 'detect': if (e.detect) this.detect.set(e.detect); break;
      case 'message': if (e.message) this.messages.update((m) => [...m, e.message!]); break;
      case 'error': this.listenError.set(e.error ?? 'Listening failed'); break;
      case 'status': this.listenState.set(e.state ?? null); break;
    }
  }

  private applyListenResult(raw: string | undefined, d: DetectResult | undefined, msgs: InstrumentMessage[] | undefined, replaceRaw: boolean) {
    if (replaceRaw || (raw && !this.rawText())) this.rawText.set((raw ?? '').slice(-RAW_CAP));
    if (d) this.detect.set(d);
    if (msgs?.length || replaceRaw) this.messages.set(msgs ?? []);
  }

  async previewPaste() {
    const raw = this.pasteText();
    if (!raw.trim() || !this.bridge.available) return;
    this.previewBusy.set(true);
    const cfg = buildInstrumentConfig(this.form(), this.configBase);
    // Auto-detect unless the tech already chose a protocol.
    const res = await this.bridge.preview(raw, { link: cfg.link, parser: cfg.parser });
    this.previewBusy.set(false);
    if (!res) { this.listenError.set('Could not read that sample'); return; }
    this.listenError.set(null);
    this.applyListenResult(res.raw ?? raw, res.detect, res.messages, true);
  }

  useDetected() {
    const d = this.detect();
    if (!d) return;
    const { form, link } = applyDetectProposal(this.form(), d);
    this.form.set(form);
    if (link) this.configBase = { ...(this.configBase ?? {}), link };
    this.dirty.set(true);
    this.toasts.success(`Protocol set to ${PROTOCOL_OPTIONS.find((o) => o.value === form.protocol)?.label ?? form.protocol}`);
  }
  confidencePct(d: DetectResult): number { return Math.round((d.confidence <= 1 ? d.confidence * 100 : d.confidence)); }


  // ── Device key + pairing ─────────────────────────────────────────────
  async generateKey(): Promise<string | null> {
    const id = this.id();
    if (!id || this.keyBusy()) return null;
    if (this.dto()?.hasDeviceKey) {
      const ok = await this.dialog.confirm({
        title: 'Rotate the device key?', tone: 'danger', confirmLabel: 'Rotate key',
        message: 'The PC paired with the current key stops sending results until it is paired again with the new key.',
      });
      if (!ok) return null;
    }
    this.keyBusy.set(true);
    try {
      const k = await firstValueFrom(this.api.generateDeviceKey(id));
      this.freshKey.set(k.deviceKey);
      this.dto.update((d) => (d ? { ...d, hasDeviceKey: true, deviceKeyPrefix: k.prefix, deviceKeyRotatedAt: k.rotatedAt } : d));
      return k.deviceKey;
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
      return null;
    } finally {
      this.keyBusy.set(false);
    }
  }

  async copyKey() {
    const k = this.freshKey();
    if (!k) return;
    try { await navigator.clipboard.writeText(k); this.toasts.success('Device key copied'); }
    catch { this.toasts.error('Copy failed — select the key and copy it'); }
  }

  /** Pair this PC: needs a freshly generated key (generate + pair in one go). */
  async pairThisPc() {
    const id = this.id();
    if (!id || !this.bridge.available || this.pairBusy()) return;
    const key = this.freshKey() ?? (await this.generateKey());
    if (!key) return;
    this.pairBusy.set(true);
    const res = await this.bridge.pair({ instrumentId: id, deviceKey: key, apiUrl: this.platform.getApiUrl(), name: this.title() });
    this.pairBusy.set(false);
    if (!res.ok) { this.toasts.error(res.error || 'Pairing failed'); return; }
    this.toasts.success('This PC is paired — it will send results for this instrument');
    await this.loadPaired(id);
  }

  async unpairThisPc() {
    const id = this.id();
    if (!id) return;
    const ok = await this.dialog.confirm({ title: 'Unpair this PC?', tone: 'danger', confirmLabel: 'Unpair', message: 'This PC stops listening to the analyzer.' });
    if (!ok) return;
    await this.bridge.unpair(id);
    await this.loadPaired(id);
  }

  // ── Assistant (beta): suggestions → the Code mapping rows, prefilled ──
  /** A mapping row to open prefilled (assistant hand-off). Never saved here:
   *  the row is added / filled, the tab opens, the person presses Save. */
  readonly mapPrefill = input<MappingPrefill | null>(null);
  readonly assistantOpen = signal(false);
  readonly assistantContext = computed<AssistantPageContext>(() => ({
    page: 'instruments', subject: this.title(), instrumentId: this.id(), canAddMapping: true,
  }));
  /** The mapping row the last hand-off landed on (highlighted). */
  readonly prefillRow = signal<number | null>(null);
  private testsReady = false;
  private mapsReady = false;
  private pendingPrefill: MappingPrefill[] = [];

  queuePrefill(p: MappingPrefill, fromNavigation = false) {
    if (p.instrumentId && this.id() && p.instrumentId !== this.id()) return;
    this.pendingPrefill.push(p);
    if (fromNavigation) {
      // A reload must not re-apply it.
      try { const st = { ...(history.state ?? {}) }; delete st[MAP_PREFILL_STATE_KEY]; history.replaceState(st, ''); } catch { /* noop */ }
    }
    this.flushPrefill();
  }

  private flushPrefill() {
    if (!this.testsReady || !this.mapsReady || !this.pendingPrefill.length) return;
    const list = this.pendingPrefill.splice(0);
    for (const p of list) {
      const r = applyMappingPrefill(this.maps(), p, this.tests());
      if (r.outcome !== 'exists') this.setMaps(r.rows);
      this.prefillRow.set(r.index);
      const code = p.analyzerCode.trim();
      if (r.outcome === 'exists' && r.testFound) this.toasts.success(`${code} is already mapped to that test`);
      else if (!r.testFound) this.toasts.success(`${code} is in Code mapping — pick its test, then Save`);
      else this.toasts.success(`${code} added to Code mapping — check it, then Save`);
    }
    this.go('mapping');
  }

  onAssistantMapping(p: MappingPrefill) {
    this.queuePrefill(p);
    // Phones: the panel covers the screen — close it so the row is visible.
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches) this.assistantOpen.set(false);
  }

  back() { void this.router.navigate(['/admin/instruments']); }
}

function toInt(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
