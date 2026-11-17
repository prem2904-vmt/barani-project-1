import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DialogService } from '../../../core/services/dialog.service';
import { ModalPortalDirective } from '../../../shared/directives/modal-portal.directive';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { ApiError } from '../../../shared/models/api-response.model';
import { BridgesApiService } from '../../../shared/bridges/bridges-api.service';
import { BRIDGE_COMMAND_CLOCK, scanNetworks, waitForCommand } from '../../../shared/bridges/bridge-commands';
import type { BridgeCommandDto, BridgeDto, WifiNetwork } from '../../../shared/bridges/bridge.models';
import { WifiForm, eapWithoutCaValidation, toWifiSetPayload, validateWifi } from '../../../shared/bridges/bridge-wifi';
import { sortNetworks } from '../../../shared/bridges/bridge-relay-flow';
import { bridgeErrorText, commandStateWord } from '../../../shared/bridges/bridge-status';
import { BridgeWifiFormComponent } from './bridge-wifi-form.component';

type Phase = 'scanning' | 'form' | 'sending' | 'done' | 'failed' | 'waiting';

/**
 * Change a Bridge's Wi-Fi from anywhere (server commands, B.4): `wifi.scan`
 * → the networks it sees → `wifi.set` (PSK or PEAP) → the result after the
 * Bridge reconnects (or rolls back to the previous network — `keepPrevious`).
 * Commands ride the 30-second heartbeat, so each step can take a minute.
 */
@Component({
  selector: 'pf-bridge-wifi-dialog',
  standalone: true,
  imports: [ModalPortalDirective, SkeletonRowsComponent, BridgeWifiFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-dialog" role="dialog" aria-modal="true" aria-labelledby="pf-bwd-title" pfModalPortal>
      <div class="pf-dialog__backdrop" (click)="close()"></div>
      <form class="pf-dialog__card pf-bwd" (submit)="$event.preventDefault(); submit()">
        <header class="pf-dialog__head">
          <span class="pf-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 14 0M1.5 9.4a15 15 0 0 1 21 0"/></svg>
          </span>
          <div class="pf-dialog__titles">
            <h2 id="pf-bwd-title" class="pf-card__label">Change Wi-Fi</h2>
            <p class="pf-dialog__sub">{{ bridge().name }}{{ bridge().network?.ssid ? ' · now on ' + bridge().network?.ssid : '' }}</p>
          </div>
          <button type="button" class="pf-btn pf-btn--icon" (click)="close()" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div class="pf-dialog__body" aria-live="polite">
          @switch (phase()) {
            @case ('scanning') {
              <p class="pf-bwd__note">Asking the Bridge which networks it can see. It checks in every 30 seconds, so this can take up to a minute.</p>
              <pf-skeleton-rows [rows]="4" label="Scanning for Wi-Fi…"></pf-skeleton-rows>
            }
            @case ('form') {
              @if (scanNote()) { <p class="pf-bwd__note">{{ scanNote() }}</p> }
              <pf-bridge-wifi-form [networks]="networks()" [touched]="touched()" (formChange)="form.set($event)"></pf-bridge-wifi-form>
              <p class="pf-field__hint">The Bridge keeps its current network and switches back to it if the new one doesn't work.</p>
            }
            @case ('sending') {
              <div class="pf-bwd__state">
                <span class="pf-bwd__pulse" aria-hidden="true"></span>
                <div>
                  <p class="pf-bwd__state-t">Switching to {{ form()?.ssid }}…</p>
                  <p class="pf-bwd__note">{{ sendNote() }}</p>
                </div>
              </div>
            }
            @case ('waiting') {
              <div class="pf-bwd__state">
                <span class="pf-bwd__pulse" aria-hidden="true"></span>
                <div>
                  <p class="pf-bwd__state-t">Still waiting for the Bridge</p>
                  <p class="pf-bwd__note">It reports back once it is online again. You can close this — the result shows under Recent activity.</p>
                </div>
              </div>
            }
            @case ('done') {
              <div class="pf-bwd__state">
                <span class="pf-bwd__ok" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></span>
                <div>
                  <p class="pf-bwd__state-t">Connected to {{ form()?.ssid }}</p>
                  @if (doneIp()) { <p class="pf-bwd__note">Address on that network: <span class="pf-num">{{ doneIp() }}</span></p> }
                </div>
              </div>
            }
            @case ('failed') {
              <p class="pf-bwd__err" role="alert">{{ error() }}</p>
            }
          }
          @if (phase() === 'form' && error()) { <p class="pf-bwd__err" role="alert">{{ error() }}</p> }
        </div>

        <footer class="pf-dialog__foot">
          @if (phase() === 'form') {
            <button type="button" class="pf-btn pf-btn--secondary" (click)="close()">Cancel</button>
            <button type="submit" class="pf-btn pf-btn--primary" [disabled]="!form()">Change Wi-Fi</button>
          } @else if (phase() === 'failed') {
            <button type="button" class="pf-btn pf-btn--secondary" (click)="close()">Close</button>
            <button type="button" class="pf-btn pf-btn--primary" (click)="retry()">Try again</button>
          } @else if (phase() === 'done' || phase() === 'waiting') {
            <button type="button" class="pf-btn pf-btn--secondary pf-span" (click)="close()">Close</button>
          } @else {
            <button type="button" class="pf-btn pf-btn--secondary pf-span" (click)="close()">Cancel</button>
          }
        </footer>
      </form>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .pf-bwd__note { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-bwd__err { margin: 0; font-size: 13px; line-height: 1.5; color: var(--red-text, #dc2626); }
    .pf-bwd__state { display: flex; gap: 12px; align-items: flex-start; padding: 6px 0; }
    .pf-bwd__state-t { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-bwd__pulse { flex: none; width: 10px; height: 10px; margin-top: 6px; border-radius: 999px; background: var(--color-primary, #7c3aed); animation: pf-bwd-pulse 1.4s ease-in-out infinite; }
    .pf-bwd__ok { flex: none; display: inline-flex; width: 28px; height: 28px; align-items: center; justify-content: center; border-radius: 999px;
      color: var(--color-primary, #7c3aed); background: var(--pf-done-tint, color-mix(in srgb, #7c3aed 12%, transparent)); }
    @keyframes pf-bwd-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    @media (max-width: 640px) { .pf-card__label { font-size: 12px !important; line-height: 1.3 !important; } }
    @media (prefers-reduced-motion: reduce) { .pf-bwd__pulse { animation: none; } }
  `],
})
export class BridgeWifiDialogComponent implements OnInit, OnDestroy {
  private readonly api = inject(BridgesApiService);
  private readonly dialogs = inject(DialogService);
  private readonly clock = inject(BRIDGE_COMMAND_CLOCK);

  readonly bridge = input.required<BridgeDto>();
  readonly closed = output<void>();
  /** A command was issued (the host refreshes its activity list). */
  readonly changed = output<void>();

  readonly phase = signal<Phase>('scanning');
  readonly networks = signal<WifiNetwork[]>([]);
  readonly form = signal<WifiForm | null>(null);
  readonly touched = signal(false);
  readonly error = signal<string | null>(null);
  readonly scanNote = signal<string | null>(null);
  readonly lastState = signal<BridgeCommandDto['state'] | null>(null);
  readonly doneIp = signal<string | null>(null);
  readonly sendNote = computed(() => this.lastState() === 'delivered'
    ? 'The Bridge has the new details and is trying them now. If the password is wrong it goes back to its current network.'
    : `Waiting for the Bridge to pick this up (${commandStateWord(this.lastState() ?? 'queued').label.toLowerCase()}).`);

  private gone = false;

  @HostListener('document:keydown.escape')
  onEscape() { this.close(); }

  ngOnInit(): void { void this.scan(); }
  ngOnDestroy(): void { this.gone = true; }

  close(): void { this.gone = true; this.closed.emit(); }

  async scan(): Promise<void> {
    this.phase.set('scanning');
    this.error.set(null);
    if (this.bridge().status !== 'online') {
      this.scanNote.set('The Bridge is offline, so it can\'t scan right now. Type the network name — the change waits up to 15 minutes for the Bridge to come back.');
      this.phase.set('form');
      return;
    }
    try {
      const cmd = await firstValueFrom(this.api.sendCommand(this.bridge().id, 'wifi.scan', {}));
      this.changed.emit();
      const r = await waitForCommand(() => firstValueFrom(this.api.command(this.bridge().id, cmd.id)), {
        intervalMs: 3000, timeoutMs: 90_000, sleep: this.clock.sleep, now: this.clock.now, cancelled: () => this.gone,
      });
      if (this.gone) return;
      if (r.command?.state === 'succeeded') {
        this.networks.set(sortNetworks(scanNetworks(r.command)));
        this.scanNote.set(null);
      } else {
        this.scanNote.set(r.timedOut ? "The Bridge didn't answer the scan in time. You can still type the network name."
          : bridgeErrorText(r.command?.result?.error, r.command?.result?.message));
      }
      this.phase.set('form');
    } catch (e) {
      if (this.gone) return;
      const err = ApiError.from(e);
      this.scanNote.set(bridgeErrorText(err.code, err.message));
      this.phase.set('form');
    }
  }

  async submit(): Promise<void> {
    const f = this.form();
    if (!f || this.phase() !== 'form') return;
    this.touched.set(true);
    if (validateWifi(f).length) return;
    if (eapWithoutCaValidation(f)) {
      const go = await this.dialogs.confirm({
        title: 'Join without checking the network?',
        message: 'There is no CA certificate or server domain, so the Bridge can\'t be sure this is the real network. A look-alike network could collect the password.',
        confirmLabel: 'Join anyway',
        cancelLabel: 'Go back',
        tone: 'danger',
      });
      if (!go) return;
    }
    this.phase.set('sending');
    this.error.set(null);
    this.lastState.set('queued');
    try {
      const cmd = await firstValueFrom(this.api.sendCommand(this.bridge().id, 'wifi.set', toWifiSetPayload(f) as unknown as Record<string, unknown>));
      this.changed.emit();
      const r = await waitForCommand(() => firstValueFrom(this.api.command(this.bridge().id, cmd.id)), {
        intervalMs: 3000, timeoutMs: 180_000, sleep: this.clock.sleep, now: this.clock.now, cancelled: () => this.gone,
        onUpdate: (c) => this.lastState.set(c.state),
      });
      if (this.gone) return;
      this.changed.emit();
      if (r.timedOut) { this.phase.set('waiting'); return; }
      if (r.command?.state === 'succeeded') {
        const ip = r.command.result?.detail?.['ipv4'];
        this.doneIp.set(typeof ip === 'string' ? ip : null);
        this.phase.set('done');
        return;
      }
      this.error.set(r.command?.state === 'expired'
        ? 'The Bridge did not pick this up in 15 minutes. Check that it is online, then try again.'
        : bridgeErrorText(r.command?.result?.error, r.command?.result?.message));
      this.phase.set('failed');
    } catch (e) {
      if (this.gone) return;
      const err = ApiError.from(e);
      this.error.set(bridgeErrorText(err.code, err.message));
      this.phase.set('form');
    }
  }

  retry(): void {
    this.error.set(null);
    this.touched.set(false);
    this.form.set(null);
    this.phase.set('form');
  }
}
