import { ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, OnInit, Output, computed, inject, input, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { COMMS_SETTINGS_PERMS, WA_BILLING_VIEW_PERMS } from '../../../core/auth/route-access';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { WaSettings, WhatsAppService, waSenderLine } from '../../../core/services/whatsapp.service';
import { SkeletonCardComponent } from '../../../shared/primitives/skeleton-kit.component';
import { WaConnectCardComponent } from './wa-connect-card.component';
import { WaBillingCardComponent } from './wa-billing-card.component';

/** Who may change the communication settings (the server enforces each PUT the same way). */
export const COMMS_MANAGE_PERMS = COMMS_SETTINGS_PERMS;

/**
 * Settings → Communication → WhatsApp. The ONE place for the lab's WhatsApp setup (moved here from
 * Lab settings → Report on 2026-11-13): WhatsApp Auto (send the report when it is ready), the lab's own
 * number (Embedded Signup) and usage / billing. WhatsApp Chat is a platform switch, shown read-only.
 */
@Component({
  selector: 'pf-wa-settings-section',
  standalone: true,
  imports: [WaConnectCardComponent, WaBillingCardComponent, SkeletonCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <pf-skeleton-card [lines]="4" label="Loading WhatsApp settings…"></pf-skeleton-card>
    } @else if (waSettings(); as wa) {
      <!-- WhatsApp Chat: staff open WhatsApp from a report and press Send (a platform switch, read-only here). -->
      <section class="pf-card pf-ls__card" data-testid="ls-wa-chat">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><h3 class="pf-card__label pf-ls__title">WhatsApp Chat</h3><span class="pf-card__spacer"></span>
          <span class="pf-chip pf-chip--static" data-testid="ls-wa-chat-state">{{ chatOn() ? 'On' : 'Off' }}</span>
        </div>
        <div class="pf-ls__cardbody">
          <p class="pf-ls__hint">
            From a report, staff open WhatsApp with the patient's chat and the report link ready, then press Send
            themselves. {{ chatOn() ? 'It is on for your lab.' : 'Prefrontal turned it off for your lab — ask Prefrontal to turn it on.' }}
          </p>
        </div>
      </section>
      <!-- The lab's OWN WhatsApp number (Meta Embedded Signup). -->
      <pf-wa-connect-card [settings]="wa" (changed)="applyWa($event)"></pf-wa-connect-card>
      <!-- Usage, spend, Meta payment health, the prepaid balance (estimated) and the shared-number credits. -->
      @if (canSeeWaBilling()) {
        <pf-wa-billing-card [settings]="wa"></pf-wa-billing-card>
      }
    } @else {
      <p class="pf-ls__hint" data-testid="ls-wa-none">WhatsApp settings aren't available for your account.</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-ls__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__hint  { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; text-wrap: pretty; }
    .pf-ls__card { margin-bottom: 16px; }
    .pf-ls__card .pf-ls__title.pf-card__label { font-size: 13px; }
    .pf-ls__scope {
      flex: none; margin-left: 8px; padding: 2px 8px; border-radius: 999px;
      border: 1px solid var(--pf-line); background: var(--pf-chip-bg);
      font-size: 11px; font-weight: 600; line-height: 1.4; color: var(--text-secondary);
      text-transform: none; letter-spacing: 0; white-space: nowrap;
    }
    .pf-ls__scope--all { color: var(--text-tertiary); }
    .pf-ls__cardbody { padding: 14px 18px 18px; }
    .pf-ls__cardbody > .pf-ls__hint:first-child { margin-top: 0; }
    .pf-ls__switch { flex: none; }
    .pf-ls__wa-row { margin-top: 12px; }
    .pf-ls__wa-sender { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 12px; }
    .pf-ls__wa-row .pf-ls__switch { white-space: normal; text-align: left; }
    .pf-ls__chipm { height: auto; min-height: 30px; white-space: normal; }
    .pf-ls__warn  { margin: 4px 0 0; font-size: 12px; color: var(--text-secondary); font-style: italic; }
    @media (max-width: 640px) {
      .pf-card__head { flex-wrap: wrap; row-gap: 6px; }
      .pf-ls__title { min-width: 0; flex: 1 1 60%; }
    }
  `],
})
export class WaSettingsSectionComponent implements OnInit {
  private readonly wa = inject(WhatsAppService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** A save started / ended — the page's band save state follows it. */
  @Output() saving = new EventEmitter<boolean>();

  protected readonly waSettings = signal<WaSettings | null>(null);
  protected readonly waSaving = signal(false);
  readonly loading = signal(true);
  /** WhatsApp Chat platform switch (read-only mirror from GET /api/settings/communication). */
  readonly chatOn = input(true);
  /** Prefrontal switched WhatsApp Auto off for this lab (the platform console). */
  protected readonly waAutoOff = computed(() => this.waSettings()?.autoEntitled === false);
  readonly waSender = computed(() => waSenderLine(this.waSettings()?.sender));
  readonly canManageWa = computed(() => COMMS_MANAGE_PERMS.some(p => this.auth.hasPermission(p)));
  /** WhatsApp spend / credits — money: organisation / notification admins only. */
  readonly canSeeWaBilling = computed(() => this.auth.hasAnyPermission(WA_BILLING_VIEW_PERMS));

  ngOnInit(): void {
    const sub = this.wa.settings().subscribe({
      next: s => { this.loading.set(false); if (s && typeof s === 'object' && 'autoSendEnabled' in s) this.waSettings.set(s); },
      error: () => { this.loading.set(false); this.waSettings.set(null); },   // no permission / older server → no cards
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  protected applyWa(s: WaSettings) { this.waSettings.set(s); }

  saveWa(patch: Partial<{ autoSendEnabled: boolean; sendUpdatedReports: boolean }>) {
    const cur = this.waSettings();
    if (!cur || this.waSaving()) return;
    // Only the switches: the message pick lives in the picker (the server keeps it).
    const next = {
      autoSendEnabled: patch.autoSendEnabled ?? cur.autoSendEnabled,
      sendUpdatedReports: patch.sendUpdatedReports ?? cur.sendUpdatedReports,
    };
    this.waSettings.set({ ...cur, ...next });
    this.waSaving.set(true);
    this.saving.emit(true);
    this.wa.saveSettings(next).pipe(finalize(() => this.saving.emit(false))).subscribe({
      next: s => {
        this.waSaving.set(false);
        if (s && typeof s === 'object' && 'autoSendEnabled' in s) this.applyWa(s);
        if (patch.autoSendEnabled !== undefined)
          this.toasts.success(s.autoSendEnabled ? 'WhatsApp Auto is on: reports are sent once paid' : 'WhatsApp Auto is off');
        else this.toasts.success('WhatsApp settings saved');
      },
      error: e => { this.waSaving.set(false); this.applyWa(cur); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
