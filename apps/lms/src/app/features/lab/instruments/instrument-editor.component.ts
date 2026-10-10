import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { analyzerLabel, analyzerSampleAsset } from '../../../shared/utils/report-profile-layout';
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
import {
  BAUD_RATES, CodeMapRow, ConfigBase, DATA_BITS, FLOW_CONTROLS, FlowControl, HL7_SAMPLE_ID_FIELDS, InstrumentForm, PARITIES,
  PROTOCOL_OPTIONS, RawSegment, STOP_BITS, TRANSPORT_OPTIONS, WizardStep, applyDetectProposal, buildInstrumentConfig, buildUpsert,
  codesFromMessages, connectionSummary, connectorStateWord, emptyCodeMapRow, emptyInstrumentForm, fmtIst, formFromInstrument,
  mergeUnmappedCodes, previewLine, previewRows, renderControlChars, rowFromDto, statusWord, toCodeMapUpserts, validateCodeMaps,
  validateInstrumentForm, withCbcDefaults, withM51Defaults,
} from '../../../shared/instruments/instrument-config';
import {
  ConnectorStatus, DetectResult, Hl7SampleIdField, ImageCodeDto, InstrumentDto, InstrumentMessage, ListenEvent, MessageSummaryDto,
  PairedInstrument, ParserType, RawLogEntry, TransportType,
} from '../../../shared/instruments/instrument.models';
import { InstrumentsApiService } from '../../../shared/instruments/instruments-api.service';
import { BridgesApiService } from '../../../shared/bridges/bridges-api.service';
import type { BridgeDto } from '../../../shared/bridges/bridge.models';
import { connectedViaOptions, transportOptionsFor } from '../../../shared/bridges/bridge-assign';
import { bridgeErrorText } from '../../../shared/bridges/bridge-status';

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
  imports: [NgTemplateOutlet, HeroBandComponent, ScreenHeaderComponent, SelectComponent, BusyDirective, SkeletonFormComponent],
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
  readonly protocolOptions: PfSelectOption<ParserType>[] = PROTOCOL_OPTIONS;
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
  imageSrc(r: ImageCodeDto): string { return (r.lastUrl ? this.uploads.src(r.lastUrl) : '') || analyzerSampleAsset(r.code); }
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
  readonly liveWord = computed(() => connectorStateWord(this.live()?.state));
  readonly connection = computed(() => connectionSummary(buildInstrumentConfig(this.form(), this.configBase)));
  private offStatus: (() => void) | null = null;

  constructor() {
    const raw = this.route.snapshot.paramMap.get('id');
    this.id.set(raw && raw !== 'new' ? raw : null);
    if (!this.id()) this.tab.set('basics');
    void this.init();
    this.destroyRef.onDestroy(() => {
      this.offListen?.();
      this.offStatus?.();
      const sid = this.sessionId();
      if (sid) void this.bridge.listenStop(sid);
    });
  }

  private async init() {
    this.loadTests();
    // Bridges are optional: an older server (404) or no permission → none.
    this.pfBridgesApi.list().subscribe({ next: (l) => this.pfBridges.set(Array.isArray(l) ? l : []), error: () => undefined });
    if (this.bridge.available) void this.loadPorts();
    const id = this.id();
    if (!id) { this.loading.set(false); return; }
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
    this.configBase = dto.config ?? null;
    this.form.set(formFromInstrument(dto));
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
      next: (list) => this.tests.set(Array.isArray(list) ? list : []),
      error: () => this.tests.set([]),
    });
  }

  private loadMaps(id: string) {
    this.loadImageMaps(id);
    this.api.codeMaps(id).subscribe({
      next: (list) => { this.maps.set((list ?? []).map(rowFromDto)); this.mapsDirty.set(false); },
      error: () => undefined,
    });
    // Codes the server saw but could not map (any state) — "Add unmapped codes".
    this.api.messages({ state: 'all', instrumentId: id, pageSize: 100 }).subscribe({
      next: (page) => {
        const codes = new Set<string>();
        for (const m of page?.items ?? []) for (const c of m.unmappedCodes ?? []) codes.add(c);
        this.serverUnmapped.set([...codes]);
      },
      error: () => undefined,
    });
  }

  loadRecent(id = this.id()) {
    if (!id) return;
    this.api.messages({ state: 'all', instrumentId: id, pageSize: 20 }).subscribe({
      next: (page) => this.recent.set(page?.items ?? []),
      error: () => this.recent.set([]),
    });
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
  setFlow(v: FlowControl) { this.patchSerial({ flow: v }); }

  // ── Steps ────────────────────────────────────────────────────────────
  go(t: Tab) { this.tab.set(t); if (t === 'status') { this.loadRecent(); void this.refreshRawLog(); } }
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
    this.patchMap(i, { testCatalogKey: key, testName: t?.name ?? null, unit });
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
    this.toasts.success(added > 0 ? `${plural(added, 'Medonic M51 code')} added` : 'Medonic M51 codes are already mapped');
  }
  readonly unmappedCandidates = computed(() => {
    const onGrid = new Set(this.maps().map((r) => r.analyzerCode.trim().toUpperCase()));
    const all = [...this.listenCodes(), ...this.serverUnmapped()];
    return [...new Set(all.map((c) => c.trim()).filter((c) => c && !onGrid.has(c.toUpperCase())))];
  });
  addUnmapped() {
    const { rows, added } = mergeUnmappedCodes(this.maps(), this.unmappedCandidates());
    if (added) this.setMaps(rows);
    this.toasts.success(added ? `${plural(added, 'code')} added — pick the test for each` : 'No new codes to add');
  }
  mapIssueAt(i: number): string | null { return this.mapIssues().find((x) => x.index === i)?.message ?? null; }

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

  back() { void this.router.navigate(['/admin/instruments']); }
}

function toInt(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
