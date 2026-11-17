import { SettingRowComponent } from '../../../shared/components/setting-row/setting-row.component';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, output, signal } from '@angular/core';
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
 * Report design › Sending (one page with the report's design, owner 2026-11-17). What the LAB sends:
 * WhatsApp Auto (the final report goes out once it is ready and paid), send
 * again when a report is corrected, and which approved message goes. The
 * WhatsApp account itself (number, templates, monthly limit) is ONE set for
 * the organisation in Message channels — linked, never repeated here.
 * Same API as before: GET/PUT /api/settings/whatsapp via `WhatsAppService`.
 */
@Component({
  selector: 'pf-report-sending-card',
  standalone: true,
  imports: [SettingRowComponent, RouterLink, SkeletonCardComponent, WaMessagePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <pf-skeleton-card [lines]="3" label="Loading WhatsApp settings…"></pf-skeleton-card>
    } @else if (wa(); as w) {
      <div class="pf-rs" data-testid="rs-auto">
        @if (autoOff()) {
          <p class="pf-rs__warn" role="status" data-testid="rs-auto-off">WhatsApp Auto is turned off for your lab by Prefrontal. Ask Prefrontal to turn it on.</p>
        }
        <pf-setting-row label="WhatsApp Auto" hint="When the final report is ready and the bill is fully paid, the patient gets the PDF and secure link. Owed: waits On hold.">
          <button type="button" class="pf-toggle pf-rs__switch" role="switch" data-testid="rs-auto-switch" [attr.aria-checked]="w.autoSendEnabled"
                  aria-label="WhatsApp Auto: send the report automatically when it is ready" [disabled]="saving() || !canManage() || autoOff()"
                  (click)="save({ autoSendEnabled: !w.autoSendEnabled })">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </pf-setting-row>
        <pf-setting-row label="Send again when a report is corrected" hint="Off by default — the patient's link always opens the latest report.">
          <button type="button" class="pf-toggle pf-rs__switch" role="switch" data-testid="rs-resend-switch"
                  aria-label="Send again when a report is regenerated or corrected"
                  [attr.aria-checked]="w.sendUpdatedReports" [disabled]="saving() || !canManage() || autoOff()"
                  (click)="save({ sendUpdatedReports: !w.sendUpdatedReports })">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </pf-setting-row>
        <pf-setting-row label="Sender" data-testid="rs-sender">
          <span row-hint class="pf-rs__hint"><a class="pf-rs__link" [routerLink]="channelsPath" data-testid="rs-channels-link">Number, templates and limits: Message channels</a></span>
          <span class="pf-rs__sender">{{ sender() }}</span>
        </pf-setting-row>
        <pf-setting-row label="Message" hint="The manual Send WhatsApp button on each report keeps working as a fallback." [stack]="true">
          <pf-wa-message-picker [settings]="w" [canEdit]="canManage() && !saving() && !autoOff()" (changed)="wa.set($event)"></pf-wa-message-picker>
        </pf-setting-row>
      </div>
    } @else {
      <p class="pf-rs__hint" data-testid="rs-none">WhatsApp settings aren't available for your account.</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-rs__hint { font-size: 12.5px; color: var(--text-tertiary); line-height: 1.4; }
    .pf-rs__warn { margin: 8px 0 0; font-size: 12.5px; color: var(--text-secondary); }
    .pf-rs__switch { flex: none; }
    .pf-rs__sender { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-rs__link { color: var(--violet-text, #7c3aed); text-decoration: underline; text-underline-offset: 3px; }
    @media (pointer: coarse) { :host .pf-rs__switch { min-width: 44px; min-height: 44px; justify-content: flex-end; } }
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
  /** Each switch save in flight / done — the host page's band save state shows it (no second Save button). */
  readonly savingChange = output<boolean>();
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
    this.savingChange.emit(true);
    this.svc.saveSettings(next).subscribe({
      next: s => {
        this.saving.set(false);
        this.savingChange.emit(false);
        if (s && typeof s === 'object' && 'autoSendEnabled' in s) this.wa.set(s);
        this.toasts.success(patch.autoSendEnabled !== undefined
          ? (s.autoSendEnabled ? 'WhatsApp Auto is on: reports are sent once paid' : 'WhatsApp Auto is off')
          : 'WhatsApp settings saved');
      },
      error: e => { this.saving.set(false); this.savingChange.emit(false); this.wa.set(cur); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
