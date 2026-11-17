import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AllCommunityModule, CellClickedEvent, ColDef, GetRowIdParams, ModuleRegistry } from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { WorkEventsService } from '../../../core/services/work-events.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ActionsMenuComponent, ActionsMenuTriggerDirective, PfAction } from '../../../shared/components/actions-menu/actions-menu.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonDetailComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ndGridDark, ndGridLight } from '../../../shared/utils/nd-grid-theme';
import { plural } from '../../../shared/utils/plural';
import { heldFlag } from '../../../shared/utils/min-duration';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { BridgesApiService } from '../../../shared/bridges/bridges-api.service';
import { BridgeLocalService } from '../../../shared/bridges/bridge-local.service';
import { MANAGE_BRIDGES } from '../../../shared/bridges/bridge-nearby.service';
import { clampHotspotMinutes } from '../../../shared/bridges/bridge-commands';
import { bridgeConnectionText } from '../../../shared/bridges/bridge-assign';
import type { BridgeCommandType, BridgeDetailDto, DetectedSourceDto } from '../../../shared/bridges/bridge.models';
import {
  BridgeTone, agoText, bridgeErrorText, bridgeStatusWord, commandLine, commandStateWord, detectedSourceHeadline, framingWord,
  linkStateWord, networkModeWord, signalWord, versionText,
} from '../../../shared/bridges/bridge-status';
import { InstrumentsApiService } from '../../../shared/instruments/instruments-api.service';
import type { InstrumentDto } from '../../../shared/instruments/instrument.models';
import { fmtIst } from '../../../shared/instruments/instrument-config';
import { BridgeWifiDialogComponent } from './bridge-wifi-dialog.component';
import { DetectedSourceLinkDialogComponent } from './detected-source-link-dialog.component';
import { BridgeAssignDialogComponent } from './bridge-assign-dialog.component';

ModuleRegistry.registerModules([AllCommunityModule]);

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
const sdotTone = (t: BridgeTone) => (t === 'green' ? 'done' : t === 'amber' ? 'warn' : t === 'red' ? 'bad' : '');

/** One analyzer row: the instrument joined with the Bridge's live link report. */
export interface BridgeAnalyzerRow {
  id: string;
  name: string;
  makeModel: string;
  connection: string;
  framing: string;
  linkState: string | null;
  lastMessageAt: string | null;
  queueDepth: number;
  instrument: InstrumentDto | null;
}

/** Join the lab's instruments on this Bridge with the heartbeat's per-analyzer state. */
export function analyzerRows(b: BridgeDetailDto, instruments: readonly InstrumentDto[]): BridgeAnalyzerRow[] {
  const live = new Map((b.analyzers ?? []).map((a) => [a.instrumentId, a]));
  const mine = instruments.filter((i) => i.bridgeId === b.id);
  const ids = new Set([...mine.map((i) => i.id), ...live.keys()]);
  return [...ids].map((id) => {
    const i = mine.find((x) => x.id === id) ?? instruments.find((x) => x.id === id) ?? null;
    const a = live.get(id);
    return {
      id,
      name: i?.name ?? a?.name ?? 'Analyzer',
      makeModel: [i?.make, i?.model].filter(Boolean).join(' '),
      connection: i ? bridgeConnectionText(i.config) : '—',
      framing: framingWord(i?.config?.link?.type),
      linkState: a?.linkState ?? null,
      lastMessageAt: a?.lastMessageAt ?? i?.lastMessageAt ?? null,
      queueDepth: a?.queueDepth ?? 0,
      instrument: i,
    };
  }).sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * One Bridge (bridge-api v1). ND pattern — band (back, context chips, Refresh
 * + the ⋮ menu for Rename / Move branch / Restart / Remove), the ANALYZERS
 * card (new-source callouts "… connected on port 6661 — link it?" + the
 * assigned analyzers grid; its ONE primary is "Assign analyzer") and the
 * BRIDGE side card (status, network, queue, version, recent activity; Change
 * Wi-Fi / setup hotspot). Every destructive step confirms via DialogService.
 */
@Component({
  selector: 'pf-bridge-detail',
  standalone: true,
  imports: [
    AgGridAngular, HeroBandComponent, ScreenHeaderComponent, SkeletonDetailComponent, BusyDirective, ActionsMenuComponent, ActionsMenuTriggerDirective,
    BridgeWifiDialogComponent, DetectedSourceLinkDialogComponent, BridgeAssignDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-brd pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/admin/bridges" [customSearch]="true" [contextBar]="true">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="loading()" [pfBusy]="loading() && !!b()" pfBusyLabel="Refreshing…"
                    (click)="load()" aria-label="Refresh" title="Refresh">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>
              <span class="pf-brd__hide-phone">Refresh</span>
            </button>
            @if (b() && canManage()) {
              <pf-actions-menu [actions]="menuActions()" label="Bridge actions" [heading]="b()!.name" (action)="runAction($event)">
                <button pfActionsTrigger type="button" class="pf-hb-btn pf-hb-btn--ghost press" aria-label="Bridge actions" title="More" [pfBusy]="acting()" pfBusyLabel="Working…">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5h.01M12 12h.01M12 19h.01"/></svg>
                </button>
              </pf-actions-menu>
            }
          </ng-container>
          <div band-search class="pf-ctx">
            @if (b(); as br) {
              <span class="pf-ctx__primary">{{ br.name }}</span>
              <span class="pf-ctx__chip"><span class="pf-sdot" [attr.data-tone]="sdot(status().tone)">{{ status().label }}</span></span>
              @if (br.serialShort) { <span class="pf-ctx__chip"><span class="pf-ctx__k">Serial</span><span class="pf-num">{{ br.serialShort }}</span></span> }
              @if (br.branchName) { <span class="pf-ctx__chip"><span class="pf-ctx__k">Branch</span>{{ br.branchName }}</span> }
            } @else {
              <span class="pf-ctx__primary">Bridge</span>
            }
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Lab settings · Bridges" [title]="b()?.name || 'Bridge'" parentRoute="/admin/bridges"></pf-screen-header>

      <div class="pf-band-body pf-band-body--fill pf-brd__body">
        @if (skeleton()) {
          <pf-skeleton-detail label="Loading Bridge…"></pf-skeleton-detail>
        } @else if (notFound()) {
          <section class="pf-card"><div class="pf-empty">
            <p class="pf-empty__title">This Bridge was not found</p>
            <p class="pf-empty__body">It may have been removed. Go back to the list.</p>
          </div></section>
        } @else if (b(); as br) {
          <div class="pf-brd__split">
            <section class="pf-card pf-brd__main" aria-label="Analyzers">
              <header class="pf-card__head">
                <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2"/></svg></span>
                <h2 class="pf-card__label">Analyzers</h2>
                <span class="pf-card__spacer"></span>
                <span class="pf-brd__count pf-num">{{ plural(rows().length, 'analyzer') }}</span>
              </header>
              <div class="pf-card__body pf-brd__mainbody">
                @if (br.status === 'pending') {
                  <div class="pf-brd__pending" role="status">
                    <span class="pf-brd__pulse" aria-hidden="true"></span>
                    <div>
                      <p class="pf-brd__pending-t">Waiting for the Bridge to come online</p>
                      <p class="pf-brd__note">Power it on near Wi-Fi. If it can't join a network by itself it starts its own setup Wi-Fi ({{ hotspotName() }}) — join it from a phone and pick the lab's network.</p>
                      @if (local.canJoinHotspot()) {
                        <button type="button" class="pf-btn pf-btn--secondary press pf-brd__relay" (click)="relay()">Set up its Wi-Fi with this phone</button>
                      }
                    </div>
                  </div>
                }

                @if (sources().length) {
                  <ul class="pf-brd__sources" aria-label="New analyzers found">
                    @for (s of sources(); track s.id) {
                      <li class="pf-row pf-brd__source">
                        <span class="pf-brd__source-ic" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/></svg></span>
                        <span class="pf-brd__source-main">
                          <span class="pf-brd__source-t">{{ headline(s) }} — link it?</span>
                          <span class="pf-row__meta pf-num">{{ sourceMeta(s) }}</span>
                        </span>
                        @if (canManage()) {
                          <span class="pf-brd__source-acts">
                            <button type="button" class="pf-btn pf-btn--tertiary press" [pfBusy]="ignoring() === s.id" pfBusyLabel="Ignoring…" (click)="ignore(s)">Ignore</button>
                            <button type="button" class="pf-btn pf-btn--secondary press" (click)="linkSource.set(s)">Link it</button>
                          </span>
                        }
                      </li>
                    }
                  </ul>
                }

                @if (rows().length === 0) {
                  @if (br.status !== 'pending') {
                    <div class="pf-empty pf-empty--compact">
                      <p class="pf-empty__title">No analyzers on this Bridge yet</p>
                      <p class="pf-empty__body">Cable an analyzer to the Bridge's network port and send a result — it shows up here to link. Or assign one you already set up.</p>
                    </div>
                  }
                } @else {
                  <ag-grid-angular class="pf-brd__grid" [theme]="gridTheme()" [rowData]="rows()" [columnDefs]="colDefs()"
                                   [defaultColDef]="defaultColDef" [getRowId]="getRowId" [domLayout]="'autoHeight'"
                                   [suppressCellFocus]="true" (cellClicked)="onCellClicked($event)"></ag-grid-angular>
                }
              </div>
              @if (canManage()) {
                <div class="pf-card__foot">
                  <button type="button" class="pf-btn pf-btn--primary pf-span press" [disabled]="br.status === 'pending'" (click)="assignOpen.set(true)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                    Assign analyzer
                  </button>
                </div>
              }
            </section>

            <aside class="pf-card pf-brd__side" aria-label="Bridge">
              <header class="pf-card__head">
                <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 17h.01M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0"/></svg></span>
                <h2 class="pf-card__label">Bridge</h2>
              </header>
              <div class="pf-card__body pf-brd__sidebody">
                <p class="pf-brd__statusline"><span class="pf-sdot" [attr.data-tone]="sdot(status().tone)">{{ status().label }}</span>
                  @if (br.lastSeenAt) { <span class="pf-brd__muted">· {{ br.status === 'online' ? 'checked in' : 'last seen' }} {{ ago(br.lastSeenAt).toLowerCase() }}</span> }
                </p>
                @if (br.serialConflict) {
                  <p class="pf-brd__warn" role="note">{{ errorText('serial_conflict') }} Check the device, or remove and add it again.</p>
                }
                <dl class="pf-brd__facts">
                  <div><dt>Wi-Fi</dt><dd>{{ wifiLine() }}</dd></div>
                  @if (br.network?.ipv4) { <div><dt>Address</dt><dd class="pf-num">{{ br.network?.ipv4 }}</dd></div> }
                  <div><dt>Last result</dt><dd>{{ br.lastMessageAt ? ago(br.lastMessageAt) : '—' }}</dd></div>
                  <div><dt>Waiting to send</dt><dd class="pf-num">{{ plural(br.queueTotal ?? 0, 'result') }}{{ (br.quarantineTotal ?? 0) ? ' · ' + br.quarantineTotal + ' held for linking' : '' }}</dd></div>
                  <div><dt>Software</dt><dd>{{ version() }}</dd></div>
                  <div><dt>Model</dt><dd>{{ modelWord() }}</dd></div>
                  @if (br.serial) { <div><dt>Serial</dt><dd class="pf-num">{{ br.serial }}</dd></div> }
                  @if (br.claimedAt) { <div><dt>Added</dt><dd>{{ fmt(br.claimedAt) }}{{ br.claimedByName ? ' by ' + br.claimedByName : '' }}</dd></div> }
                  @if (br.tlsFingerprint) { <div><dt>Security pin</dt><dd class="pf-num">{{ br.tlsFingerprint }}</dd></div> }
                </dl>

                @if (br.recentCommands?.length) {
                  <h3 class="pf-brd__sec">Recent activity</h3>
                  <ul class="pf-brd__acts">
                    @for (c of br.recentCommands; track c.id) {
                      <li class="pf-brd__act">
                        <span class="pf-brd__act-main">
                          <span class="pf-brd__act-t">{{ cmdLine(c) }}</span>
                          <span class="pf-brd__muted pf-num">{{ ago(c.issuedAt) }}{{ c.issuedByName ? ' · ' + c.issuedByName : '' }}</span>
                          @if (c.state === 'failed' && c.result?.error) { <span class="pf-brd__act-err">{{ errorText(c.result?.error, c.result?.message) }}</span> }
                        </span>
                        <span class="pf-sdot" [attr.data-tone]="sdot(cmdState(c.state).tone)">{{ cmdState(c.state).label }}</span>
                      </li>
                    }
                  </ul>
                }
              </div>
              @if (canManage()) {
                <div class="pf-card__foot">
                  <button type="button" class="pf-btn pf-btn--secondary press" [disabled]="br.status === 'pending'" (click)="wifiOpen.set(true)">Change Wi-Fi</button>
                  <button type="button" class="pf-btn pf-btn--secondary press" [disabled]="br.status !== 'online' || acting()" (click)="startHotspot()">Setup hotspot</button>
                </div>
              }
            </aside>
          </div>
        }
      </div>
    </section>

    @if (wifiOpen() && b(); as br) {
      <pf-bridge-wifi-dialog [bridge]="br" (closed)="wifiOpen.set(false); load(true)" (changed)="load(true)"></pf-bridge-wifi-dialog>
    }
    @if (linkSource(); as s) {
      <pf-detected-source-link-dialog [bridge]="b()!" [source]="s" [instruments]="instruments()" (closed)="linkSource.set(null)" (linked)="onLinked($event.instrument)"></pf-detected-source-link-dialog>
    }
    @if (assignOpen() || editRow()) {
      <pf-bridge-assign-dialog [bridge]="b()!" [instruments]="instruments()" [instrument]="editRow()?.instrument ?? null"
                               (closed)="assignOpen.set(false); editRow.set(null)" (saved)="onAssigned($event)"></pf-bridge-assign-dialog>
    }
  `,
  styles: [`
    :host { display: block; min-height: 0; }
    /* Desktop: the two cards fill the band body and only their bodies scroll
       (ND §1); one column below 1024px, where the body scrolls as usual. */
    .pf-brd__split { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: stretch; flex: 1 1 auto; min-height: 0; }
    @media (max-width: 1023px) {
      .pf-brd__split { grid-template-columns: minmax(0, 1fr); align-items: start; flex: none; }
      .pf-brd .pf-brd__body.pf-band-body--fill { overflow-y: auto; display: block; }
    }
    .pf-brd__main, .pf-brd__side { min-width: 0; }
    .pf-brd__count { margin-left: auto; font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); }
    .pf-brd__mainbody { gap: 12px; }
    .pf-brd__grid { display: block; width: 100%; }
    .pf-brd__main ::ng-deep .ag-root-wrapper { border: 0; border-radius: 0; }
    .pf-brd__main ::ng-deep .pf-brd-cell { line-height: 1.3; display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 6px 0; }
    .pf-brd__main ::ng-deep .pf-brd-cell__sub { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-brd__main ::ng-deep .pf-brd-cell__name { font-weight: 600; color: var(--text-primary); }
    .pf-brd__main ::ng-deep .ag-row { cursor: pointer; }
    .pf-brd__main ::ng-deep .pf-brd-acts { display: flex; gap: 6px; align-items: center; height: 100%; }
    .pf-brd__main ::ng-deep .ag-cell.pf-brd-actcell { padding-left: 6px; padding-right: 6px; }
    .pf-brd__sources { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .pf-brd__source { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 10px 12px; border-radius: 12px;
      border: 1px solid var(--pf-sel-border, rgba(124, 58, 237, 0.4)); background: var(--pf-done-tint, color-mix(in srgb, #7c3aed 6%, transparent)); flex-wrap: wrap; }
    .pf-brd__source-ic { flex: none; display: inline-flex; width: 32px; height: 32px; align-items: center; justify-content: center; border-radius: 10px;
      color: var(--color-primary, #7c3aed); background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent); }
    .pf-brd__source-main { flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-brd__source-t { font-size: 14px; font-weight: 500; color: var(--text-primary); }
    .pf-brd__source-acts { display: flex; gap: 8px; margin-left: auto; }
    .pf-brd__pending { display: flex; gap: 12px; align-items: flex-start; padding: 12px; border-radius: 12px; border: 1px dashed var(--pf-line); }
    .pf-brd__pending-t { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-brd__note { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-brd__relay { margin-top: 10px; }
    .pf-brd__pulse { flex: none; width: 10px; height: 10px; margin-top: 6px; border-radius: 999px; background: var(--color-primary, #7c3aed); animation: pf-brd-pulse 1.4s ease-in-out infinite; }
    @keyframes pf-brd-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    @media (prefers-reduced-motion: reduce) { .pf-brd__pulse { animation: none; } }
    .pf-brd__sidebody { gap: 12px; }
    .pf-brd__statusline { margin: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; }
    .pf-brd__muted { font-size: 12px; color: var(--text-tertiary); }
    .pf-brd__warn { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--amber-text, #b45309); }
    .pf-brd__facts { margin: 0; display: grid; gap: 0; }
    .pf-brd__facts > div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--pf-line); }
    .pf-brd__facts dt { font-size: 12.5px; color: var(--text-tertiary); }
    .pf-brd__facts dd { margin: 0; font-size: 13px; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-brd__sec { margin: 4px 0 0; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-brd__acts { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    .pf-brd__act { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; padding: 8px 2px; border-bottom: 1px solid var(--pf-line); }
    .pf-brd__act-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-brd__act-t { font-size: 13px; color: var(--text-primary); }
    .pf-brd__act-err { font-size: 12px; color: var(--red-text, #dc2626); }
    @media (max-width: 640px) {
      /* ND §12: card labels are 12px on phones — beat the global phone h2 cap. */
      .pf-card__label { font-size: 12px !important; line-height: 1.3 !important; }
      .pf-brd__hide-phone { display: none; }
      .pf-brd__source-acts { width: 100%; }
      .pf-brd__source-acts .pf-btn { flex: 1 1 0; min-height: 44px; }
      .pf-brd__facts > div { grid-template-columns: 110px minmax(0, 1fr); }
    }
  `],
})
export class BridgeDetailComponent implements OnInit {
  private readonly api = inject(BridgesApiService);
  private readonly instrumentsApi = inject(InstrumentsApiService);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly local = inject(BridgeLocalService);
  protected readonly plural = plural;
  protected readonly ago = (iso: string | null | undefined) => agoText(iso);
  protected readonly fmt = (iso: string | null | undefined) => fmtIst(iso, 'd MMM yyyy');
  protected readonly headline = detectedSourceHeadline;
  protected readonly cmdLine = commandLine;
  protected readonly cmdState = commandStateWord;
  protected readonly errorText = bridgeErrorText;
  protected readonly sdot = sdotTone;
  readonly web = webPointerSignal();
  readonly isPhone = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 640px)').matches;

  /** Route param (withComponentInputBinding). */
  readonly id = input.required<string>();

  readonly b = signal<BridgeDetailDto | null>(null);
  readonly instruments = signal<InstrumentDto[]>([]);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly skeleton = heldFlag(computed(() => this.loading() && !this.b()));
  readonly acting = signal(false);
  readonly ignoring = signal<string | null>(null);
  readonly wifiOpen = signal(false);
  readonly assignOpen = signal(false);
  readonly linkSource = signal<DetectedSourceDto | null>(null);
  readonly editRow = signal<BridgeAnalyzerRow | null>(null);

  readonly canManage = computed(() => { try { return this.auth.hasAnyPermission([MANAGE_BRIDGES]); } catch { return false; } });
  readonly status = computed(() => bridgeStatusWord(this.b()?.status));
  readonly sources = computed(() => (this.b()?.detectedSources ?? []).filter((s) => s.state === 'new'));
  readonly rows = computed(() => (this.b() ? analyzerRows(this.b()!, this.instruments()) : []));
  readonly hotspotName = computed(() => `Prefrontal-Bridge-${(this.b()?.serial ?? '').slice(-4) || 'XXXX'}`);
  readonly version = computed(() => versionText(this.b() ?? { version: null }));
  readonly modelWord = computed(() => ({ pi5: 'Raspberry Pi 5', pi4: 'Raspberry Pi 4' } as Record<string, string>)[this.b()?.model ?? ''] ?? (this.b()?.model || '—'));
  readonly wifiLine = computed(() => {
    const n = this.b()?.network;
    if (!n) return '—';
    if (n.mode && n.mode !== 'client') return networkModeWord(n.mode);
    return [n.ssid, signalWord(n.signal)].filter(Boolean).join(' · ') || '—';
  });

  readonly menuActions = computed<PfAction[]>(() => {
    const br = this.b();
    const online = br?.status === 'online';
    return [
      { id: 'rename', label: 'Rename', icon: 'edit' },
      { id: 'move', label: 'Move to another branch', icon: 'reassign', disabled: (this.auth.user()?.branches?.length ?? 0) < 2 },
      { id: 'refresh', label: 'Refresh settings', icon: 'regenerate', disabled: !online, hint: 'Sends the latest analyzer setup to the Bridge' },
      { id: 'reboot', label: 'Restart', icon: 'repeat', disabled: !online },
      { id: 'remove', label: 'Remove Bridge', tone: 'danger' },
    ];
  });

  readonly gridTheme = computed(() => (this.theme.isDark() ? ndGridDark : ndGridLight));
  readonly getRowId = (p: GetRowIdParams<BridgeAnalyzerRow>) => p.data.id;
  readonly defaultColDef: ColDef<BridgeAnalyzerRow> = { sortable: true, resizable: true, filter: false, minWidth: 100, autoHeight: true, wrapText: true };
  readonly colDefs = computed<ColDef<BridgeAnalyzerRow>[]>(() => {
    const web = this.web() && !this.isPhone;
    const manage = this.canManage();
    const cell = (main: string, sub?: string, cls = '') =>
      `<div class="pf-brd-cell"><span class="${cls}">${esc(main)}</span>${sub ? `<span class="pf-brd-cell__sub">${esc(sub)}</span>` : ''}</div>`;
    const btn = (act: string, label: string, d: string, name: string) =>
      `<button type="button" class="pf-rowact${web ? '' : ' pf-rowact--icon'}" data-act="${act}" aria-label="${esc(label)} ${esc(name)}" title="${esc(label)}">` +
      `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>` +
      `<span class="pf-rowact__t">${esc(label)}</span></button>`;
    const cols: ColDef<BridgeAnalyzerRow>[] = [
      { colId: 'name', headerName: 'Analyzer', flex: 1.3, minWidth: this.isPhone ? 120 : 170, sort: 'asc', valueGetter: (p) => p.data?.name ?? '',
        cellRenderer: (p: { data?: BridgeAnalyzerRow }) => cell(p.data?.name ?? '',
          this.isPhone ? [p.data?.connection, linkStateWord(p.data?.linkState).label].filter(Boolean).join(' · ')
            : (p.data?.makeModel && p.data.makeModel !== p.data.name ? p.data.makeModel : ''), 'pf-brd-cell__name') },
      { colId: 'connection', headerName: 'Connection', flex: 1.3, minWidth: 170, valueGetter: (p) => p.data?.connection ?? '',
        cellRenderer: (p: { data?: BridgeAnalyzerRow }) => cell(p.data?.connection ?? '', p.data?.framing) },
      { colId: 'link', headerName: 'Link', flex: 1, minWidth: this.isPhone ? 96 : 120, valueGetter: (p) => p.data?.linkState ?? '',
        cellRenderer: (p: { data?: BridgeAnalyzerRow }) => {
          const w = linkStateWord(p.data?.linkState);
          return `<div class="pf-brd-cell"><span class="pf-sdot" data-tone="${sdotTone(w.tone)}">${esc(w.label)}</span>${p.data?.lastMessageAt ? `<span class="pf-brd-cell__sub">Last result ${esc(agoText(p.data.lastMessageAt).toLowerCase())}</span>` : ''}</div>`;
        } },
      { colId: 'queue', headerName: 'Queue', width: 96, minWidth: 90, flex: 0, type: 'rightAligned', valueGetter: (p) => p.data?.queueDepth ?? 0,
        cellRenderer: (p: { data?: BridgeAnalyzerRow }) => `<span class="pf-num">${esc(p.data?.queueDepth ?? 0)}</span>` },
    ];
    if (manage) {
      cols.push({ colId: 'actions', headerName: '', sortable: false, resizable: false, width: web ? 224 : 124, minWidth: web ? 224 : 124, flex: 0, cellClass: 'pf-brd-actcell',
        cellRenderer: (p: { data?: BridgeAnalyzerRow }) => `<div class="pf-brd-acts">${
          btn('edit', 'Connection', 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z', p.data?.name ?? '')}${
          btn('unassign', 'Remove', 'M18 6 6 18M6 6l12 12', p.data?.name ?? '')}</div>` });
    }
    // Phones: the connection + link state ride the name cell's second line.
    if (this.isPhone) return cols.filter((c) => ['name', 'actions'].includes(c.colId ?? ''));
    return cols;
  });

  ngOnInit(): void { this.load(); }

  constructor() {
    this.loadInstruments();
    inject(WorkEventsService).on('bridges').pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((c) => {
      if (!c.event?.id || c.event.id === this.id() || c.event.type === 'bridge.source_detected') this.load(true);
    });
  }

  load(quiet = false): void {
    if (!quiet) this.loading.set(true);
    this.api.get(this.id()).subscribe({
      next: (d) => { this.b.set(d); this.notFound.set(false); this.loading.set(false); },
      error: (e) => {
        this.loading.set(false);
        const err = ApiError.from(e);
        if (err.code === 'bridge_not_found') { this.notFound.set(true); return; }
        if (!quiet) this.toasts.error(bridgeErrorText(err.code, err.message));
      },
    });
  }

  loadInstruments(): void {
    this.instrumentsApi.list().subscribe({ next: (l) => this.instruments.set(Array.isArray(l) ? l : []), error: () => undefined });
  }

  sourceMeta(s: DetectedSourceDto): string {
    return [framingWord(s.framing), s.peerIp, s.quarantined ? plural(s.quarantined, 'result') + ' held' : '', s.lastSeenAt ? 'seen ' + agoText(s.lastSeenAt).toLowerCase() : '']
      .filter(Boolean).join(' · ');
  }

  onCellClicked(ev: CellClickedEvent<BridgeAnalyzerRow>): void {
    const row = ev.data;
    if (!row) return;
    const act = (ev.event?.target as HTMLElement | null)?.closest?.('[data-act]')?.getAttribute('data-act');
    if (act === 'unassign') { void this.unassign(row); return; }
    if (act === 'edit' || this.canManage()) { if (row.instrument) this.editRow.set(row); return; }
    void this.router.navigate(['/admin/instruments', row.id]);
  }

  async unassign(row: BridgeAnalyzerRow): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: `Take ${row.name} off this Bridge?`,
      message: row.queueDepth
        ? `The Bridge stops listening for it. ${plural(row.queueDepth, 'result')} it still holds for this analyzer are sent first if it is online. The analyzer's setup and code mapping stay.`
        : "The Bridge stops listening for it. The analyzer's setup and code mapping stay — connect it from a lab computer or another Bridge.",
      confirmLabel: 'Take off',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.assignInstrument(row.id, null));
      this.toasts.success(`${row.name} is off the Bridge`);
      this.loadInstruments();
      this.load(true);
    } catch (e) {
      const err = ApiError.from(e);
      this.toasts.error(bridgeErrorText(err.code, err.message));
    }
  }

  async ignore(s: DetectedSourceDto): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Ignore this connection?',
      message: `${detectedSourceHeadline(s)}. The Bridge drops the ${plural(s.quarantined, 'result')} it is holding from it and stops reporting it.`,
      confirmLabel: 'Ignore',
      tone: 'danger',
    });
    if (!ok) return;
    this.ignoring.set(s.id);
    this.api.ignoreSource(this.id(), s.id).subscribe({
      next: () => { this.ignoring.set(null); this.load(true); },
      error: (e) => { this.ignoring.set(null); const err = ApiError.from(e); this.toasts.error(bridgeErrorText(err.code, err.message)); },
    });
  }

  onLinked(instrument: InstrumentDto): void {
    this.linkSource.set(null);
    this.toasts.success(`${instrument?.name ?? 'Analyzer'} linked — held results are on their way`);
    this.loadInstruments();
    this.load(true);
  }

  onAssigned(instrument: InstrumentDto): void {
    const wasEdit = !!this.editRow();
    this.assignOpen.set(false);
    this.editRow.set(null);
    this.toasts.success(wasEdit ? 'Connection saved — the Bridge picks it up in a moment' : `${instrument?.name ?? 'Analyzer'} assigned to the Bridge`);
    this.loadInstruments();
    this.load(true);
  }

  relay(): void {
    void this.router.navigate(['/admin/bridges', 'add'], { queryParams: { relay: 1 } });
  }

  async runAction(id: string): Promise<void> {
    switch (id) {
      case 'rename': return this.rename();
      case 'move': return this.move();
      case 'refresh': return this.command('refresh', {}, 'Settings sent — the Bridge applies them within a minute');
      case 'reboot': {
        const ok = await this.dialogs.confirm({
          title: `Restart ${this.b()?.name}?`,
          message: 'It is back in about a minute. Analyzers that send results meanwhile retry, and nothing it holds is lost.',
          confirmLabel: 'Restart',
        });
        if (ok) await this.command('reboot', {}, 'Restart requested — back in about a minute');
        return;
      }
      case 'remove': return this.remove();
    }
  }

  async startHotspot(): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Start the setup hotspot?',
      message: `For 30 minutes the Bridge also offers its own Wi-Fi (${this.hotspotName()}) so a phone can reach it directly. Analyzers keep working.`,
      confirmLabel: 'Start for 30 minutes',
    });
    if (ok) await this.command('hotspot.start', { minutes: clampHotspotMinutes(30) }, 'Setup hotspot starting');
  }

  private async command(type: BridgeCommandType, payload: Record<string, unknown>, done: string): Promise<void> {
    this.acting.set(true);
    try {
      await firstValueFrom(this.api.sendCommand(this.id(), type, payload));
      this.toasts.success(done);
      this.load(true);
    } catch (e) {
      const err = ApiError.from(e);
      this.toasts.error(bridgeErrorText(err.code, err.message));
    } finally {
      this.acting.set(false);
    }
  }

  private async rename(): Promise<void> {
    const name = await this.dialogs.prompt({ title: 'Rename Bridge', placeholder: 'e.g. Haematology Bridge', initialValue: this.b()?.name ?? '', required: true, confirmLabel: 'Save' });
    const n = (name ?? '').trim();
    if (!n || n === this.b()?.name) return;
    if (n.length > 120) { this.toasts.error(bridgeErrorText('invalid_name')); return; }
    await this.patch({ name: n }, 'Renamed');
  }

  private async move(): Promise<void> {
    const branches = (this.auth.user()?.branches ?? []).filter((x) => x.id !== this.b()?.branchId);
    if (!branches.length) return;
    const to = await this.dialogs.choose({
      title: 'Move to another branch',
      message: 'Only a Bridge with no analyzers can move. Its analyzers belong to this branch.',
      choices: branches.map((x) => ({ value: x.id, label: x.name })),
      initialChoice: branches[0].id,
      confirmLabel: 'Move',
    });
    if (to) await this.patch({ branchId: to }, 'Moved');
  }

  private async patch(body: { name?: string; branchId?: string }, done: string): Promise<void> {
    this.acting.set(true);
    try {
      await firstValueFrom(this.api.patch(this.id(), body));
      this.toasts.success(done);
      this.load(true);
    } catch (e) {
      const err = ApiError.from(e);
      this.toasts.error(bridgeErrorText(err.code, err.message));
    } finally {
      this.acting.set(false);
    }
  }

  private async remove(): Promise<void> {
    const br = this.b();
    if (!br) return;
    const q = br.queueTotal ?? 0;
    const held = br.quarantineTotal ?? 0;
    const n = this.rows().length;
    const items = [
      n ? `${plural(n, 'analyzer')} go back to "not connected" (their setup and code mapping stay).` : '',
      q ? `${plural(q, 'result')} still waiting on the Bridge ${q === 1 ? 'is' : 'are'} discarded.` : 'No results are waiting on the Bridge.',
      held ? `${plural(held, 'held result')} from unlinked analyzers ${held === 1 ? 'is' : 'are'} discarded.` : '',
      'The Bridge forgets this lab. To use it again, add it again.',
    ].filter(Boolean);
    const ok = await this.dialogs.confirm({
      title: `Remove ${br.name}?`,
      message: q ? `${plural(q, 'result')} not yet sent will be lost.` : undefined,
      items,
      confirmLabel: 'Remove Bridge',
      tone: 'danger',
    });
    if (!ok) return;
    this.acting.set(true);
    try {
      const r = await firstValueFrom(this.api.remove(br.id));
      this.toasts.success(r?.discardedQueue ? `Removed — ${plural(r.discardedQueue, 'queued result')} discarded` : 'Bridge removed');
      void this.router.navigate(['/admin/bridges']);
    } catch (e) {
      const err = ApiError.from(e);
      this.toasts.error(bridgeErrorText(err.code, err.message));
    } finally {
      this.acting.set(false);
    }
  }
}
