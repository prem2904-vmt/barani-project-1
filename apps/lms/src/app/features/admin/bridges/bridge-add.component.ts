import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { BridgesApiService } from '../../../shared/bridges/bridges-api.service';
import { BridgeLocalService, lanTarget } from '../../../shared/bridges/bridge-local.service';
import { BridgeNearbyService } from '../../../shared/bridges/bridge-nearby.service';
import {
  BRIDGE_QR_HANDOFF_KEY, BridgeQrPayload, bridgeQrErrorText, formatClaimCodeInput, normalizeClaimCode, parseBridgeQr,
} from '../../../shared/bridges/bridge-qr';
import { BridgeRelayFlow, RelayStep } from '../../../shared/bridges/bridge-relay-flow';
import { BRIDGE_COMMAND_CLOCK } from '../../../shared/bridges/bridge-commands';
import type { ClaimRequest, ClaimResultDto, DiscoveredBridge } from '../../../shared/bridges/bridge.models';
import { WifiForm, eapWithoutCaValidation, toWifiCredentials, validateWifi } from '../../../shared/bridges/bridge-wifi';
import { agoText, bridgeErrorText, bridgeStatusWord } from '../../../shared/bridges/bridge-status';
import { DialogService } from '../../../core/services/dialog.service';
import { BridgeWifiFormComponent } from './bridge-wifi-form.component';

export type AddMethod = 'qr' | 'code' | 'nearby' | 'local';

/** Read (and clear) the QR the public `/b` page handed over. Never throws. */
export function takeQrHandoff(): string | null {
  try {
    const v = sessionStorage.getItem(BRIDGE_QR_HANDOFF_KEY);
    if (v) sessionStorage.removeItem(BRIDGE_QR_HANDOFF_KEY);
    return v;
  } catch { return null; }
}

const RELAY_STEPS: { id: RelayStep; label: string }[] = [
  { id: 'claiming', label: 'Add it to the lab' },
  { id: 'joining', label: "Join the Bridge's setup Wi-Fi" },
  { id: 'verifying', label: 'Check it is the right Bridge' },
  { id: 'pick_network', label: "Pick the lab's Wi-Fi" },
  { id: 'sending', label: 'Send the Wi-Fi details' },
  { id: 'waiting_online', label: 'Wait for it to come online' },
];
const RELAY_ORDER: RelayStep[] = ['claiming', 'joining', 'verifying', 'scanning', 'pick_network', 'sending', 'leaving', 'waiting_online', 'online'];

/**
 * Add a Bridge (bridge-api v1, D.2). Four ways in, ONE claim endpoint:
 *  1 Scan its QR (the shared scanner modal) — secret + serial, works before
 *    the Bridge is online (a reservation);
 *  2 Type the claim code under the QR;
 *  3 Found on this network (the server's nearby offer — offer + admin confirm);
 *  4 On this Wi-Fi (mDNS — phone / desktop apps only): nonce → signed ticket.
 * Plus, on the phone app after a QR: "Set up its Wi-Fi with this phone" — the
 * hotspot relay (BridgeRelayFlow). Plain web never shows the local options.
 */
@Component({
  selector: 'pf-bridge-add',
  standalone: true,
  imports: [NgTemplateOutlet, HeroBandComponent, BarcodeScannerModalComponent, ScreenHeaderComponent, SkeletonRowsComponent, SelectComponent, BusyDirective, BridgeWifiFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-bra pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/admin/bridges" [customSearch]="true" [contextBar]="true" [standardPill]="true">
          <div band-search class="pf-ctx">
            <span class="pf-ctx__primary">Add a Bridge</span>
            @if (qr(); as q) { <span class="pf-ctx__chip"><span class="pf-ctx__k">Serial</span><span class="pf-num">{{ q.serialShort }}</span></span> }
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Lab settings · Bridges" title="Add a Bridge" parentRoute="/admin/bridges"></pf-screen-header>

      <div class="pf-band-body pf-bra__body">
        <div class="pf-bra__split">
          <!-- ── MAIN: how to find the Bridge / the relay / the result ── -->
          <section class="pf-card pf-bra__main" aria-label="Add a Bridge">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 17h.01M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0"/></svg></span>
              <h2 class="pf-card__label">{{ relay() ? 'Set up its Wi-Fi' : result() ? 'Added' : 'Find the Bridge' }}</h2>
            </header>
            <div class="pf-card__body pf-bra__mainbody">
              @if (relay(); as flow) {
                <ol class="pf-bra__steps" aria-label="Setup steps">
                  @for (s of relaySteps; track s.id) {
                    <li class="pf-bra__step" [attr.data-state]="stepState(s.id)">
                      <span class="pf-bra__step-dot" aria-hidden="true">
                        @if (stepState(s.id) === 'done') { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg> }
                      </span>
                      <span>{{ s.label }}</span>
                    </li>
                  }
                </ol>
                @switch (flow.state().step) {
                  @case ('pick_network') {
                    <pf-bridge-wifi-form [networks]="flow.state().networks ?? []" [touched]="wifiTouched()" (formChange)="wifiForm.set($event)"></pf-bridge-wifi-form>
                    <button type="button" class="pf-btn pf-btn--tertiary press pf-bra__rescan" (click)="flow.rescan()">Scan again (the setup Wi-Fi drops for ~10 seconds)</button>
                    @if (flow.state().error) { <p class="pf-bra__err" role="alert">{{ errText(flow.state().error, flow.state().errorMessage) }}</p> }
                  }
                  @case ('scanning') { <pf-skeleton-rows [rows]="4" label="Reading the networks the Bridge sees…"></pf-skeleton-rows> }
                  @case ('waiting_online') {
                    <p class="pf-bra__note">The Bridge is joining the lab's Wi-Fi and checking in. This usually takes under a minute.</p>
                  }
                  @case ('timeout') {
                    <div class="pf-bra__callout" role="status">
                      <p class="pf-bra__callout-t">The Bridge hasn't checked in yet</p>
                      <ul class="pf-bra__tips">
                        <li>If the password was wrong, the Bridge starts its setup Wi-Fi again within 2 minutes — run this again.</li>
                        <li>Guest Wi-Fi with a sign-in page doesn't work. Ask IT to allow the Bridge's MAC address.</li>
                        <li>Make sure the network can reach the internet (port 443).</li>
                      </ul>
                    </div>
                  }
                  @case ('online') {
                    <div class="pf-bra__done" role="status">
                      <span class="pf-bra__ok" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></span>
                      <div><p class="pf-bra__callout-t">{{ flow.state().bridge?.name }} is online</p><p class="pf-bra__note">Cable an analyzer to its network port and send a result — the Bridge shows it to link.</p></div>
                    </div>
                  }
                  @case ('failed') {
                    <p class="pf-bra__err" role="alert">{{ errText(flow.state().error, flow.state().errorMessage) }}</p>
                  }
                  @default { <p class="pf-bra__note">{{ relayNote() }}</p> }
                }
              } @else if (result(); as r) {
                <div class="pf-bra__done" role="status">
                  <span class="pf-bra__ok" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></span>
                  <div>
                    <p class="pf-bra__callout-t">{{ r.bridge.name }} is in your lab</p>
                    @if (r.state === 'pending_device') {
                      <p class="pf-bra__note">It finishes setting up the moment it reaches the internet. Power it on near the lab's Wi-Fi; if it can't join by itself it opens its own setup Wi-Fi ({{ qr()?.hotspotSsid || 'Prefrontal-Bridge-…' }}) — join that from any phone and pick the lab's network.</p>
                    } @else {
                      <p class="pf-bra__note">Status: {{ statusWord(r.bridge.status).label }}. Cable an analyzer to its network port and send a result — the Bridge shows it to link.</p>
                    }
                  </div>
                </div>
              } @else {
                <div class="pf-bra__methods" role="radiogroup" aria-label="How to find the Bridge">
                  @for (m of methods(); track m.id) {
                    <button type="button" class="pf-tile-sel pf-bra__method press" role="radio" [attr.aria-checked]="method() === m.id" (click)="choose(m.id)">
                      <span class="pf-card__icon pf-bra__method-ic" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="m.icon"/></svg>
                      </span>
                      <span class="pf-bra__method-t">{{ m.title }}</span>
                      <span class="pf-bra__method-s">{{ m.sub }}</span>
                      @if (m.count != null) { <span class="pf-bra__method-n pf-num" [attr.aria-label]="m.count + ' found'">{{ m.count }}</span> }
                    </button>
                  }
                </div>

                <div class="pf-bra__panel" aria-live="polite">
                  @switch (method()) {
                    @case ('qr') {
                      @if (qr(); as q) {
                        <dl class="pf-bra__facts">
                          <div><dt>Serial</dt><dd class="pf-num">{{ q.serial }}</dd></div>
                          <div><dt>Claim code</dt><dd class="pf-num">{{ q.claimCode }}</dd></div>
                          <div><dt>Setup Wi-Fi</dt><dd>{{ q.hotspotSsid }}{{ q.hotspotPsk ? '' : ' (open)' }}</dd></div>
                        </dl>
                        <button type="button" class="pf-btn pf-btn--tertiary press" (click)="scanning.set(true)">Scan a different QR</button>
                      } @else {
                        <p class="pf-bra__note">The QR is on the Bridge's label and on its setup page (join its Wi-Fi from a phone).</p>
                        <button type="button" class="pf-btn pf-btn--secondary press" (click)="scanning.set(true)">Open the camera</button>
                      }
                      @if (qrError()) { <p class="pf-bra__err" role="alert">{{ qrError() }}</p> }
                    }
                    @case ('code') {
                      <label class="pf-field pf-bra__code">
                        <span class="pf-field__lbl">Claim code</span>
                        <input class="pf-input pf-num pf-bra__code-in" [value]="code()" (input)="onCode($any($event.target))" placeholder="XXXXX-XXXXX"
                               autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" maxlength="11" aria-describedby="pf-bra-code-h" />
                        <span class="pf-field__hint" id="pf-bra-code-h">Ten letters and numbers, printed under the QR. The Bridge must be online — otherwise scan the QR.</span>
                      </label>
                    }
                    @case ('nearby') {
                      @if (nearby.offers().length) {
                        <ul class="pf-bra__list" role="radiogroup" aria-label="Bridges found on this network">
                          @for (n of nearby.offers(); track n.announcementId) {
                            <li><button type="button" class="pf-row pf-tile-sel pf-bra__pick press" role="radio" [attr.aria-checked]="nearbyId() === n.announcementId" (click)="nearbyId.set(n.announcementId)">
                              <span class="pf-bra__pick-main">
                                <span class="pf-row__name">Prefrontal Bridge <span class="pf-num">{{ n.serialShort }}</span></span>
                                <span class="pf-row__meta pf-num">{{ [n.model, n.version].filter(isText).join(' · ') }}{{ n.lastSeenAt ? ' · seen ' + ago(n.lastSeenAt).toLowerCase() : '' }}</span>
                              </span>
                            </button></li>
                          }
                        </ul>
                        <p class="pf-field__hint">Check the serial against the Bridge's label before adding — another lab on the same internet connection could see the same offer.</p>
                      } @else {
                        <div class="pf-empty pf-empty--compact">
                          <p class="pf-empty__title">No new Bridge on this network</p>
                          <p class="pf-empty__body">A Bridge shows here a minute after it reaches the internet from the same network as you. Otherwise scan its QR.</p>
                        </div>
                      }
                    }
                    @case ('local') {
                      @if (local.discovered().length) {
                        <ul class="pf-bra__list" role="radiogroup" aria-label="Bridges on this Wi-Fi">
                          @for (d of local.discovered(); track d.serial) {
                            <li><button type="button" class="pf-row pf-tile-sel pf-bra__pick press" role="radio" [attr.aria-checked]="localSerial() === d.serial" [disabled]="d.claimState === 'claimed'" (click)="localSerial.set(d.serial)">
                              <span class="pf-bra__pick-main">
                                <span class="pf-row__name">{{ d.name }}</span>
                                <span class="pf-row__meta pf-num">{{ d.host }}{{ d.version ? ' · ' + d.version : '' }}{{ d.claimState === 'claimed' ? ' · already in a lab' : '' }}</span>
                              </span>
                            </button></li>
                          }
                        </ul>
                      } @else {
                        <pf-skeleton-rows [rows]="2" label="Looking for Bridges on this Wi-Fi…"></pf-skeleton-rows>
                        <p class="pf-field__hint">Searching this Wi-Fi. {{ local.kind === 'native' ? 'If nothing appears, allow Local Network access for Prefrontal in Settings.' : '' }}</p>
                      }
                    }
                  }
                </div>
              }
            </div>
          </section>

          <!-- ── SIDE: name, branch and the ONE primary ── -->
          <aside class="pf-card pf-bra__side" aria-label="Details">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h10M4 17h7"/></svg></span>
              <h2 class="pf-card__label">Details</h2>
            </header>
            <div class="pf-card__body pf-bra__sidebody">
              @if (!result() && !relay()) {
                <label class="pf-field">
                  <span class="pf-field__lbl">Name <span class="pf-bra__opt">optional</span></span>
                  <input class="pf-input" [value]="name()" (input)="name.set($any($event.target).value)" maxlength="120" placeholder="e.g. Haematology Bridge" autocomplete="off" />
                </label>
                @if (branchOptions().length > 1) {
                  <div class="pf-field">
                    <span class="pf-field__lbl" id="pf-bra-br">Branch</span>
                    <pf-select aria-labelledby="pf-bra-br" [options]="branchOptions()" [value]="branchId()" (valueChange)="branchId.set($event)"></pf-select>
                  </div>
                }
                <p class="pf-bra__note">Results from its analyzers arrive as a prefill; the technician still checks and submits every value.</p>
              } @else {
                <p class="pf-bra__note">{{ sideNote() }}</p>
              }
              @if (error()) { <p class="pf-bra__err" role="alert">{{ error() }}</p> }
            </div>
            @if (!isPhone) {
              <div class="pf-card__foot"><ng-container *ngTemplateOutlet="actionsTpl"></ng-container></div>
            }
          </aside>
        </div>
      </div>
    </section>

    <!-- The side card's actions: its footer on web / tablet, the kit's
         bottom bar above the navbar on phones (ND §8) — ONE copy rendered. -->
    <ng-template #actionsTpl>
              @if (relay(); as flow) {
                @switch (flow.state().step) {
                  @case ('pick_network') {
                    <button type="button" class="pf-btn pf-btn--secondary press" (click)="cancelRelay()">Cancel</button>
                    <button type="button" class="pf-btn pf-btn--primary press" [disabled]="!wifiForm()" (click)="sendWifi()">Send to Bridge</button>
                  }
                  @case ('online') { <button type="button" class="pf-btn pf-btn--primary pf-span press" (click)="open(flow.state().bridge?.id)">Open Bridge</button> }
                  @case ('timeout') {
                    <button type="button" class="pf-btn pf-btn--secondary press" (click)="open(flow.state().bridge?.id)">Open Bridge</button>
                    <button type="button" class="pf-btn pf-btn--primary press" (click)="flow.waitOnline()">Check again</button>
                  }
                  @case ('failed') {
                    <button type="button" class="pf-btn pf-btn--secondary press" (click)="cancelRelay()">Close</button>
                    <button type="button" class="pf-btn pf-btn--primary press" (click)="flow.start()">Try again</button>
                  }
                  @default { <button type="button" class="pf-btn pf-btn--secondary pf-span press" (click)="cancelRelay()">Cancel</button> }
                }
              } @else if (result(); as r) {
                @if (r.state === 'pending_device' && canRelay() && qr()) {
                  <button type="button" class="pf-btn pf-btn--secondary press" (click)="startRelay(true)">Set up its Wi-Fi</button>
                  <button type="button" class="pf-btn pf-btn--primary press" (click)="open(r.bridge.id)">Open Bridge</button>
                } @else {
                  <button type="button" class="pf-btn pf-btn--secondary press" (click)="reset()">Add another</button>
                  <button type="button" class="pf-btn pf-btn--primary press" (click)="open(r.bridge.id)">Open Bridge</button>
                }
              } @else {
                @if (method() === 'qr' && qr() && canRelay()) {
                  <button type="button" class="pf-btn pf-btn--secondary press" [disabled]="busy()" (click)="startRelay(false)">Add + set up Wi-Fi</button>
                }
                <button type="button" class="pf-btn pf-btn--primary press" [class.pf-span]="!(method() === 'qr' && qr() && canRelay())"
                        [disabled]="!canSubmit() || busy()" [pfBusy]="busy()" pfBusyLabel="Adding…" (click)="submit()">
                  {{ busy() ? 'Adding…' : 'Add Bridge' }}
                </button>
              }
    </ng-template>
    @if (isPhone) {
      <div class="pf-bottombar pf-bra__bar"><ng-container *ngTemplateOutlet="actionsTpl"></ng-container></div>
    }

    @if (scanning()) {
      <pf-barcode-scanner-modal title="Scan the Bridge QR" noun="Bridge QR" (matched)="onScanned($event)" (cancelled)="scanning.set(false)"></pf-barcode-scanner-modal>
    }
  `,
  styles: [`
    @use '../../../shared/styles/nd-mixins' as nd;
    :host { display: block; min-height: 0; }
    .pf-bra__split { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start; }
    @media (max-width: 1023px) { .pf-bra__split { grid-template-columns: minmax(0, 1fr); } }
    .pf-bra__main, .pf-bra__side { min-width: 0; }
    .pf-bra__mainbody { gap: 16px; }
    .pf-bra__methods { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
    .pf-bra__method { position: relative; display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 12px; row-gap: 2px;
      align-items: center; min-height: 76px; padding: 12px 14px; text-align: left; border-radius: 14px; border: 1px solid var(--pf-line);
      background: transparent; color: var(--text-primary); cursor: pointer; }
    .pf-bra__method-ic { grid-row: 1 / span 2; }
    .pf-bra__method-t { font-size: 14px; font-weight: 600; }
    .pf-bra__method-s { font-size: 12px; color: var(--text-tertiary); line-height: 1.35; }
    .pf-bra__method-n { position: absolute; top: 10px; right: 12px; font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
    .pf-bra__panel { display: flex; flex-direction: column; gap: 12px; }
    .pf-bra__code { max-width: 320px; }
    .pf-bra__code-in { font-size: 20px; letter-spacing: 0.08em; text-transform: uppercase; }
    .pf-bra__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .pf-bra__pick { width: 100%; min-height: 56px; padding: 8px 12px; text-align: left; border-radius: 12px; border: 1px solid var(--pf-line); background: transparent; color: var(--text-primary); cursor: pointer; }
    .pf-bra__pick:disabled { opacity: 0.55; cursor: not-allowed; }
    /* The kit's neutral selected state (the base rules above would out-rank it). */
    .pf-bra__method[aria-checked='true'], .pf-bra__pick[aria-checked='true'] { @include nd.neutral-selected; }
    .pf-bra__pick-main { display: flex; flex-direction: column; gap: 2px; }
    .pf-bra__facts { margin: 0; display: grid; }
    .pf-bra__facts > div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--pf-line); }
    .pf-bra__facts dt { font-size: 12.5px; color: var(--text-tertiary); }
    .pf-bra__facts dd { margin: 0; font-size: 13.5px; overflow-wrap: anywhere; }
    .pf-bra__note { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
    .pf-bra__opt { font-weight: 400; color: var(--text-tertiary); }
    .pf-bra__err { margin: 0; font-size: 13px; line-height: 1.5; color: var(--red-text, #dc2626); }
    .pf-bra__sidebody { gap: 14px; }
    .pf-bra__done { display: flex; gap: 12px; align-items: flex-start; }
    .pf-bra__ok { flex: none; display: inline-flex; width: 32px; height: 32px; align-items: center; justify-content: center; border-radius: 999px;
      color: var(--color-primary, #7c3aed); background: var(--pf-done-tint, color-mix(in srgb, #7c3aed 12%, transparent)); }
    .pf-bra__callout { padding: 12px 14px; border-radius: 12px; border: 1px solid var(--pf-line); }
    .pf-bra__callout-t { margin: 0 0 4px; font-size: 14.5px; font-weight: 600; color: var(--text-primary); }
    .pf-bra__tips { margin: 6px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
    .pf-bra__steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .pf-bra__step { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-tertiary); min-height: 28px; }
    .pf-bra__step[data-state='active'] { color: var(--text-primary); font-weight: 500; }
    .pf-bra__step[data-state='done'] { color: var(--text-secondary); }
    .pf-bra__step-dot { flex: none; display: inline-flex; width: 20px; height: 20px; align-items: center; justify-content: center; border-radius: 999px;
      border: 1.5px solid var(--pf-line); color: #fff; }
    .pf-bra__step[data-state='done'] .pf-bra__step-dot { background: var(--color-primary, #7c3aed); border-color: var(--color-primary, #7c3aed); }
    .pf-bra__step[data-state='active'] .pf-bra__step-dot { border-color: var(--color-primary, #7c3aed); box-shadow: inset 0 0 0 4px var(--pf-card-bg); background: var(--color-primary, #7c3aed); }
    .pf-bra__rescan { align-self: flex-start; }
    @media (max-width: 640px) {
      /* ND §12: card labels are 12px on phones — beat the global phone h2 cap. */
      .pf-card__label { font-size: 12px !important; line-height: 1.3 !important; }
      .pf-bra__methods { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .pf-bra__method { grid-template-columns: minmax(0, 1fr); min-height: 96px; }
      .pf-bra__method-ic { grid-row: auto; margin-bottom: 4px; }
      .pf-bra__code { max-width: none; }
      .pf-bra__facts > div { grid-template-columns: 100px minmax(0, 1fr); }
      .pf-bra__body { padding-bottom: 96px !important; }
      .pf-bra__bar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 10px; }
      .pf-bra__bar > :only-child, .pf-bra__bar > .pf-span { grid-column: 1 / -1; }
      .pf-bra__bar .pf-btn { min-height: 44px; }
    }
  `],
})
export class BridgeAddComponent implements OnInit, OnDestroy {
  private readonly api = inject(BridgesApiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(DialogService);
  private readonly clock = inject(BRIDGE_COMMAND_CLOCK);
  protected readonly theme = inject(ThemeService);
  protected readonly local = inject(BridgeLocalService);
  protected readonly nearby = inject(BridgeNearbyService);
  protected readonly relaySteps = RELAY_STEPS;
  readonly isPhone = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  protected readonly ago = (iso: string | null | undefined) => agoText(iso);
  protected readonly isText = (s: unknown): s is string => typeof s === 'string' && !!s;
  protected readonly statusWord = bridgeStatusWord;
  protected readonly errText = bridgeErrorText;

  /** Query params (withComponentInputBinding): `?nearby=<announcementId>`, `?relay=1`. */
  readonly nearbyParam = input<string | undefined>(undefined, { alias: 'nearby' });
  readonly relayParam = input<string | undefined>(undefined, { alias: 'relay' });

  readonly method = signal<AddMethod>('qr');
  readonly qr = signal<BridgeQrPayload | null>(null);
  readonly qrError = signal<string | null>(null);
  readonly code = signal('');
  readonly nearbyId = signal<string | null>(null);
  readonly localSerial = signal<string | null>(null);
  readonly name = signal('');
  readonly branchId = signal<string>('');
  readonly scanning = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<ClaimResultDto | null>(null);
  readonly relay = signal<BridgeRelayFlow | null>(null);
  readonly wifiForm = signal<WifiForm | null>(null);
  readonly wifiTouched = signal(false);
  private relayOnScan = false;

  readonly canRelay = computed(() => this.local.canJoinHotspot());
  readonly branchOptions = computed<PfSelectOption<string>[]>(() => (this.auth.user()?.branches ?? []).map((b) => ({ value: b.id, label: b.name })));
  readonly methods = computed(() => {
    const list: { id: AddMethod; title: string; sub: string; icon: string; count?: number | null }[] = [
      { id: 'qr', title: 'Scan its QR', sub: 'On the label or its setup page', icon: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 8h3v3H8zM13 13h3v3h-3zM13 8h3M8 16h3' },
      { id: 'code', title: 'Type the code', sub: 'XXXXX-XXXXX under the QR', icon: 'M4 7h16M4 12h16M4 17h10' },
      { id: 'nearby', title: 'Found on this network', sub: 'The server saw it from here', icon: 'M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 14 0', count: this.nearby.offers().length },
    ];
    if (this.local.available && this.local.canDiscover()) {
      list.push({ id: 'local', title: 'On this Wi-Fi', sub: 'Search the network directly', icon: 'M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z', count: this.local.discovered().length || null });
    }
    return list;
  });
  readonly canSubmit = computed(() => {
    switch (this.method()) {
      case 'qr': return !!this.qr();
      case 'code': return !!normalizeClaimCode(this.code());
      case 'nearby': return !!this.nearbyId() && this.nearby.offers().some((n) => n.announcementId === this.nearbyId());
      case 'local': return !!this.localSerial();
    }
  });
  readonly relayNote = computed(() => {
    switch (this.relay()?.state().step) {
      case 'claiming': return 'Adding the Bridge to your lab…';
      case 'joining': return "Joining the Bridge's setup Wi-Fi. Your phone may ask you to confirm.";
      case 'verifying': return 'Checking it is the Bridge from the QR…';
      case 'sending': return 'Sending the Wi-Fi details to the Bridge…';
      case 'leaving': return 'Back on your own network…';
      default: return '';
    }
  });
  readonly sideNote = computed(() => this.relay()
    ? 'Keep this phone next to the Bridge until it is online. The phone joins the Bridge\'s own Wi-Fi for a moment, then goes back to yours.'
    : 'You can rename it, move it to another branch or remove it from its page.');

  ngOnInit(): void {
    this.branchId.set(this.auth.activeBranchId?.() ?? this.auth.user()?.branches?.[0]?.id ?? '');
    this.nearby.start();
    void this.nearby.poll();
    if (this.nearbyParam()) { this.method.set('nearby'); this.nearbyId.set(this.nearbyParam()!); }
    const handed = takeQrHandoff();
    if (handed) this.onScanned(handed);
    else if (this.relayParam()) { this.relayOnScan = true; this.method.set('qr'); this.scanning.set(true); }
  }

  ngOnDestroy(): void {
    void this.local.stopDiscovery();
    this.relay()?.cancel();
  }

  choose(m: AddMethod): void {
    this.method.set(m);
    this.error.set(null);
    if (m === 'local') void this.local.startDiscovery(); else void this.local.stopDiscovery();
    if (m === 'qr' && !this.qr()) this.scanning.set(true);
    if (m === 'nearby') void this.nearby.poll();
  }

  onCode(el: HTMLInputElement): void {
    const v = formatClaimCodeInput(el.value);
    this.code.set(v);
    if (el.value !== v) el.value = v;
  }

  onScanned(text: string): void {
    this.scanning.set(false);
    const p = parseBridgeQr(text);
    this.method.set('qr');
    if (!p.ok) { this.qr.set(null); this.qrError.set(bridgeQrErrorText(p.error)); return; }
    this.qrError.set(null);
    this.qr.set(p.payload);
    if (this.relayOnScan && this.canRelay()) { this.relayOnScan = false; this.startRelay(false); return; }
  }

  private request(): ClaimRequest | null {
    const extras = { name: this.name().trim() || undefined, branchId: this.branchId() || undefined };
    switch (this.method()) {
      case 'qr': { const q = this.qr(); return q ? { method: 'secret', claimSecret: q.claimCode, serial: q.serial, ...extras } : null; }
      case 'code': { const c = normalizeClaimCode(this.code()); return c ? { method: 'secret', claimSecret: c, ...extras } : null; }
      case 'nearby': return this.nearbyId() ? { method: 'nearby', announcementId: this.nearbyId()!, ...extras } : null;
      default: return null;
    }
  }

  async submit(): Promise<void> {
    if (!this.canSubmit() || this.busy()) return;
    this.error.set(null);
    if (this.method() === 'nearby') {
      const n = this.nearby.offers().find((x) => x.announcementId === this.nearbyId());
      const ok = await this.dialogs.confirm({
        title: `Add Prefrontal Bridge ${n?.serialShort ?? ''}?`,
        message: 'Check that this serial matches the label on the Bridge in your lab. It then belongs to your lab until you remove it.',
        confirmLabel: 'Add Bridge',
      });
      if (!ok) return;
    }
    this.busy.set(true);
    try {
      const r = this.method() === 'local' ? await this.claimLocal() : await firstValueFrom(this.api.claim(this.request()!));
      if (!r) return;
      if (this.method() === 'nearby' && this.nearbyId()) this.nearby.forget(this.nearbyId()!);
      this.result.set(r);
      void this.local.stopDiscovery();
    } catch (e) {
      const err = ApiError.from(e);
      this.error.set(bridgeErrorText(err.code, err.message));
    } finally {
      this.busy.set(false);
    }
  }

  /** mDNS claim: nonce (server) → signed ticket (Bridge, pinned) → claim (server). */
  private async claimLocal(): Promise<ClaimResultDto | null> {
    const d: DiscoveredBridge | undefined = this.local.discovered().find((x) => x.serial === this.localSerial());
    if (!d) return null;
    const target = lanTarget(d);
    const id = await this.local.verifiedIdentity(target, d.serial);
    if (!id.ok) { this.error.set(bridgeErrorText(id.error, id.message)); return null; }
    if (id.data.claimState === 'claimed') { this.error.set(bridgeErrorText('already_claimed')); return null; }
    const nonce = await firstValueFrom(this.api.claimNonce());
    const ticket = await this.local.claimTicket(target, nonce.nonce);
    if (!ticket.ok) { this.error.set(bridgeErrorText(ticket.error, ticket.message)); return null; }
    return firstValueFrom(this.api.claim({ method: 'local', ticket: ticket.data, name: this.name().trim() || undefined, branchId: this.branchId() || undefined }));
  }

  /** Native only: claim (if not yet) and run the hotspot relay. */
  startRelay(alreadyClaimed: boolean): void {
    const q = this.qr();
    if (!q || !this.canRelay()) return;
    const flow = new BridgeRelayFlow({
      claim: (b) => firstValueFrom(this.api.claim(b)),
      getBridge: (id) => firstValueFrom(this.api.get(id)),
      joinHotspot: (s, p) => this.local.joinHotspot(s, p),
      leaveHotspot: () => this.local.leaveHotspot(),
      verifiedIdentity: (t, s) => this.local.verifiedIdentity(t, s),
      wifiNetworks: (t, r) => this.local.wifiNetworks(t, r),
      activate: (t, a) => this.local.activate(t, a),
      setWifi: (t, c) => this.local.setWifi(t, c),
      sleep: this.clock.sleep,
      now: this.clock.now,
    }, q, { name: this.name().trim() || undefined, branchId: this.branchId() || undefined });
    this.wifiForm.set(null);
    this.wifiTouched.set(false);
    this.relay.set(flow);
    void flow.start(alreadyClaimed ? this.result() : null);
  }

  async sendWifi(): Promise<void> {
    const f = this.wifiForm();
    const flow = this.relay();
    if (!f || !flow) return;
    this.wifiTouched.set(true);
    if (validateWifi(f).length) return;
    if (eapWithoutCaValidation(f)) {
      const go = await this.dialogs.confirm({
        title: 'Join without checking the network?',
        message: "There is no CA certificate or server domain, so the Bridge can't be sure this is the real network. A look-alike network could collect the password.",
        confirmLabel: 'Join anyway', cancelLabel: 'Go back', tone: 'danger',
      });
      if (!go) return;
    }
    await flow.sendWifi(toWifiCredentials(f));
  }

  cancelRelay(): void {
    const flow = this.relay();
    flow?.cancel();
    void this.local.leaveHotspot();
    const b = flow?.state().bridge;
    this.relay.set(null);
    if (b) this.result.set({ state: b.status === 'online' ? 'claimed' : 'pending_device', bridge: b });
  }

  stepState(id: RelayStep): 'done' | 'active' | 'todo' {
    const cur = this.relay()?.state().step ?? 'idle';
    if (cur === 'online') return 'done';
    const at = (s: RelayStep) => RELAY_ORDER.indexOf(s === 'scanning' ? 'pick_network' : s === 'leaving' ? 'waiting_online' : s);
    const failedAt = this.relay()?.state().failedAt ?? 'claiming';
    const curIdx = cur === 'failed' ? at(failedAt) : cur === 'timeout' ? at('waiting_online') : at(cur);
    const idx = at(id);
    if (cur === 'timeout' && id === 'waiting_online') return 'active';
    return idx < curIdx ? 'done' : idx === curIdx ? 'active' : 'todo';
  }

  open(id: string | undefined | null): void { if (id) void this.router.navigate(['/admin/bridges', id]); }

  reset(): void {
    this.result.set(null);
    this.qr.set(null);
    this.code.set('');
    this.nearbyId.set(null);
    this.localSerial.set(null);
    this.name.set('');
    this.error.set(null);
    this.method.set('qr');
  }
}
