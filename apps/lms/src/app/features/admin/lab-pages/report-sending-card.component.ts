import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { COMMS_SETTINGS_PERMS } from '../../../core/auth/route-access';
import { ToastService } from '../../../core/services/toast.service';
import { WaSettings, WhatsAppService, waSenderLine } from '../../../core/services/whatsapp.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { SkeletonCardComponent } from '../../../shared/primitives/skeleton-kit.component';
import { WaMessagePickerComponent } from '../communication/wa-message-picker.component';

/** Where the WhatsApp number / templates / limits live (Organization › Message channels). */
export const MESSAGE_CHANNELS_PATH = '/admin/org/channels';

/**
 * Lab › Report options › Send reports on WhatsApp. What the LAB sends:
 * WhatsApp Auto (the final report goes out once it is ready and paid), send
 * again when a report is corrected, and which approved message goes. The
 * WhatsApp account itself (number, templates, monthly limit) is ONE set for
 * the organisation in Message channels — linked, never repeated here.
 * Same API as before: GET/PUT /api/settings/whatsapp via `WhatsAppService`.
 */
@Component({
  selector: 'pf-report-sending-card',
  standalone: true,
  imports: [RouterLink, SkeletonCardComponent, WaMessagePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <pf-skeleton-card [lines]="4" label="Loading WhatsApp settings…"></pf-skeleton-card>
    } @else if (wa(); as w) {
      <section class="pf-card pf-rs" data-testid="rs-auto">
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.6 8.6 0 0 1-3.9-.9L3 21l1.9-5.6a8.4 8.4 0 0 1-.9-3.9A8.5 8.5 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z"/></svg></span>
          <h3 class="pf-card__label pf-rs__title">WhatsApp Auto</h3>
          <span class="pf-card__spacer"></span>
          <button type="button" class="pf-toggle pf-rs__switch" role="switch" data-testid="rs-auto-switch" [attr.aria-checked]="w.autoSendEnabled"
                  aria-label="WhatsApp Auto: send the report automatically when it is ready" [disabled]="saving() || !canManage() || autoOff()"
                  (click)="save({ autoSendEnabled: !w.autoSendEnabled })">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
        <div class="pf-rs__body">
          @if (autoOff()) {
            <p class="pf-rs__warn" role="status" data-testid="rs-auto-off">WhatsApp Auto is turned off for your lab by Prefrontal. Ask Prefrontal to turn it on.</p>
          }
          <p class="pf-rs__hint">
            When every test on an order is validated and its <strong>final</strong> report is ready, the patient gets one
            WhatsApp message on their registered mobile — the report PDF plus the secure report link. It goes only when
            <strong>the bill is fully paid</strong>: while anything is owed it waits as <strong>On hold</strong> and sends by itself
            once the balance is cleared. Partial reports are never sent.
          </p>
          <div class="pf-rs__sender">
            <span class="pf-chip pf-chip--static" data-testid="rs-sender">Sender — <strong>{{ sender() }}</strong></span>
            <a class="pf-rs__link" [routerLink]="channelsPath" data-testid="rs-channels-link">WhatsApp number, templates and limits: Message channels</a>
          </div>
          <div class="pf-rs__row">
            <button type="button" class="pf-toggle pf-rs__switch pf-rs__switch--row" role="switch" data-testid="rs-resend-switch"
                    [attr.aria-checked]="w.sendUpdatedReports" [disabled]="saving() || !canManage() || autoOff()"
                    (click)="save({ sendUpdatedReports: !w.sendUpdatedReports })">
              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
              Send again when a report is regenerated or corrected
            </button>
            <p class="pf-rs__hint">Off by default — the link the patient already has always opens the latest report.</p>
          </div>
          <pf-wa-message-picker [settings]="w" [canEdit]="canManage() && !saving() && !autoOff()" (changed)="wa.set($event)"></pf-wa-message-picker>
          <p class="pf-rs__hint">The manual "Send WhatsApp" button on each report keeps working as a fallback.</p>
        </div>
      </section>
    } @else {
      <p class="pf-rs__hint" data-testid="rs-none">WhatsApp settings aren't available for your account.</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-rs { margin-bottom: 16px; overflow: visible; }
    .pf-rs__title { margin: 0; font-size: 13px; }
    .pf-rs__body { display: flex; flex-direction: column; gap: 12px; padding: 14px 18px 18px; }
    .pf-rs__hint { margin: 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; text-wrap: pretty; }
    .pf-rs__warn { margin: 0; font-size: 12.5px; color: var(--text-secondary); font-style: italic; }
    .pf-rs__switch { flex: none; }
    .pf-rs__switch--row { white-space: normal; text-align: left; }
    .pf-rs__sender { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
    .pf-rs__sender .pf-chip { height: auto; min-height: 30px; white-space: normal; }
    .pf-rs__sender strong { color: var(--text-primary); }
    .pf-rs__link { font-size: 12.5px; font-weight: 600; color: var(--violet-text, #7c3aed); text-decoration: underline; text-underline-offset: 3px; }
    @media (pointer: coarse) { :host .pf-rs__switch:not(.pf-rs__switch--row) { min-width: 44px; min-height: 44px; justify-content: flex-end; } }
  `],
})
export class ReportSendingCardComponent implements OnInit {
  private readonly svc = inject(WhatsAppService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly channelsPath = MESSAGE_CHANNELS_PATH;
  readonly wa = signal<WaSettings | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly autoOff = computed(() => this.wa()?.autoEntitled === false);
  readonly sender = computed(() => waSenderLine(this.wa()?.sender));
  readonly canManage = computed(() => COMMS_SETTINGS_PERMS.some(p => this.auth.hasPermission(p)));

  ngOnInit() {
    const sub = this.svc.settings().subscribe({
      next: s => { this.loading.set(false); if (s && typeof s === 'object' && 'autoSendEnabled' in s) this.wa.set(s); },
      error: () => { this.loading.set(false); this.wa.set(null); },
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  save(patch: Partial<{ autoSendEnabled: boolean; sendUpdatedReports: boolean }>) {
    const cur = this.wa();
    if (!cur || this.saving()) return;
    // Only the switches: the message pick lives in the picker (the server keeps it).
    const next = {
      autoSendEnabled: patch.autoSendEnabled ?? cur.autoSendEnabled,
      sendUpdatedReports: patch.sendUpdatedReports ?? cur.sendUpdatedReports,
    };
    this.wa.set({ ...cur, ...next });
    this.saving.set(true);
    this.svc.saveSettings(next).subscribe({
      next: s => {
        this.saving.set(false);
        if (s && typeof s === 'object' && 'autoSendEnabled' in s) this.wa.set(s);
        this.toasts.success(patch.autoSendEnabled !== undefined
          ? (s.autoSendEnabled ? 'WhatsApp Auto is on: reports are sent once paid' : 'WhatsApp Auto is off')
          : 'WhatsApp settings saved');
      },
      error: e => { this.saving.set(false); this.wa.set(cur); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
