import { SettingsSavebarComponent } from '../../../shared/components/setting-row/settings-savebar.component';
import { injectSettingsHosted } from '../../../shared/utils/settings-host';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { HasUnsavedChanges, guardUnsavedOnUnload } from '../../../shared/utils/unsaved-changes';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { CommsShareService, looksLikeEmail } from '../../../core/services/comms-share.service';
import {
  CommunicationService, CommunicationSettings, EmailMode, EmailSettings, EmailSettingsInput, SmtpSecurity,
} from '../../../core/services/communication.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SkeletonCardComponent } from '../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { COMMS_MANAGE_PERMS, WaSettingsSectionComponent } from './wa-settings-section.component';

/** Band pill tabs (`?tab=`). */
export const COMMS_TABS = ['whatsapp', 'email', 'sms'] as const;
export type CommsTab = typeof COMMS_TABS[number];

/** The Email form as the person edits it (password is write-only: '' = keep the saved one). */
export interface EmailForm {
  enabled: boolean;
  mode: EmailMode;
  fromName: string;
  replyTo: string;
  host: string;
  port: number | null;
  security: SmtpSecurity;
  username: string;
  password: string;
  fromAddress: string;
}

/** Defaults the server uses when nothing is saved yet (Prefrontal address, the lab's name). */
export function emailFormFrom(s: EmailSettings | null | undefined, labName = ''): EmailForm {
  return {
    enabled: s?.enabled ?? true,
    mode: s?.mode === 'own' ? 'own' : 'platform',
    fromName: s?.fromName ?? labName,
    replyTo: s?.replyTo ?? '',
    host: s?.own?.host ?? '',
    port: s?.own?.port ?? 587,
    security: s?.own?.security ?? 'starttls',
    username: s?.own?.username ?? '',
    password: '',
    fromAddress: s?.own?.fromAddress ?? '',
  };
}

/** The PUT body. The password goes only when typed (omitted = keep). The own mailbox is kept on the
 *  server while the Prefrontal address is in use, so switching back does not lose it. */
export function emailInputFrom(f: EmailForm, hadOwn: boolean): EmailSettingsInput {
  const useOwn = f.mode === 'own' || hadOwn || !!f.host.trim();
  const own = useOwn ? {
    host: f.host.trim(), port: Number(f.port) || 0, security: f.security,
    username: f.username.trim(), fromAddress: f.fromAddress.trim(),
    ...(f.password ? { password: f.password } : {}),
  } : null;
  return { enabled: f.enabled, mode: f.mode, fromName: f.fromName.trim(), replyTo: f.replyTo.trim() || null, own };
}

/** Plain-words problems that stop a save (empty = fine). */
export function emailFormProblems(f: EmailForm, passwordSet: boolean): string[] {
  const out: string[] = [];
  if (!f.fromName.trim()) out.push('Add the name patients see as the sender.');
  if (f.replyTo.trim() && !looksLikeEmail(f.replyTo)) out.push('The reply-to address is not a valid email.');
  if (f.mode === 'own') {
    if (!f.host.trim()) out.push('Add your mail server (SMTP host).');
    const port = Number(f.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) out.push('The port must be a number from 1 to 65535.');
    if (!looksLikeEmail(f.fromAddress)) out.push('Add the address your emails come from.');
    if (!passwordSet && !f.password && f.username.trim()) out.push('Add the mailbox password.');
  }
  return out;
}

const SAME = (a: EmailForm, b: EmailForm) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings → Communication (owner 2026-11-13): WhatsApp, Email and SMS in ONE place.
 * - WhatsApp: the cards that lived in Lab settings → Report (moved here; the old link redirects).
 * - Email: who sends (the Prefrontal address under the lab's name, or the lab's own mailbox over SMTP),
 *   the sender name and reply-to, a test send, and whether it can send now — in plain words.
 * - SMS: SMS Chat (phones / tablets open their Messages app) + a note that automatic SMS comes later.
 */
@Component({
  selector: 'pf-communication-settings',
  standalone: true,
  imports: [SettingsSavebarComponent, FormsModule, HeroBandComponent, ScreenHeaderComponent, SegmentedComponent, SelectComponent, SkeletonCardComponent, BusyDirective, WaSettingsSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10 max-w-3xl mx-auto w-full" data-testid="comms-page">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <pf-segmented class="pf-hb-tabs" size="sm" [options]="tabOptions" [value]="tab()" ariaLabel="Communication channel"
                          (valueChange)="pickTab($event)"></pf-segmented>
          </ng-container>
          <ng-container band-actions>
            @if (tab() === 'email' && canManage() && !hosted) {
              <button type="button" class="pf-hb-btn pf-hb-btn--primary press" data-testid="cm-email-save"
                      [disabled]="!emailDirty() || emailSaving() || loading()" [pfBusy]="emailSaving()" pfBusyLabel="Saving…"
                      (click)="saveEmail()" aria-label="Save email settings">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
                {{ emailSaving() ? 'Saving…' : 'Save' }}
              </button>
            }
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Lab" title="Communication"
        subtitle="WhatsApp, email and SMS — how reports and invoices reach patients and doctors." parentRoute="/lab/settings">
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-band-narrow">
      @if (showSec('whatsapp')) {
        <h2 class="pf-cm__sec pf-classic-only">WhatsApp</h2>
        <pf-wa-settings-section [chatOn]="waChatOn()"></pf-wa-settings-section>
      }

      @if (showSec('email')) {
        <h2 class="pf-cm__sec pf-classic-only">Email</h2>
        @if (loading()) {
          <pf-skeleton-card [lines]="5" label="Loading email settings…"></pf-skeleton-card>
        } @else {
        <section class="pf-card pf-cm__card" data-testid="cm-email">
          <div class="pf-card__head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="m22 7-10 6L2 7"/></svg></span>
            <h3 class="pf-card__label pf-cm__title">Email reports and invoices</h3>
            <span class="pf-card__spacer"></span>
            <button type="button" class="pf-toggle pf-cm__switch" role="switch" data-testid="cm-email-enabled"
                    [attr.aria-checked]="form().enabled" aria-label="Email reports and invoices"
                    [disabled]="!canManage() || emailOffByPrefrontal()" (click)="patch({ enabled: !form().enabled })">
              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
            </button>
          </div>
          <div class="pf-card__body pf-cm__body">
            @if (emailOffByPrefrontal()) {
              <p class="pf-cm__warn" role="status" data-testid="cm-email-off">Prefrontal turned email off for your lab. Ask Prefrontal to turn it on.</p>
            }
            <!-- Ready / problem in plain words (the server decides). -->
            <p class="pf-cm__status" role="status" data-testid="cm-email-status" [attr.data-ready]="email()?.ready ? 'yes' : 'no'">
              <span class="pf-cm__dot" aria-hidden="true"></span>
              @if (email()?.ready) {
                Ready — staff can email reports from the Share menu.
              } @else {
                {{ email()?.problem || 'Email can’t be sent yet.' }}
              }
            </p>
            <p class="pf-cm__hint">The lab emails the report PDF to the patient — and to the referral doctor when they have an email. Invoices go to the patient only.</p>

            <div class="pf-cm__label">Send from</div>
            <pf-segmented class="pf-cm__seg" size="sm" [options]="modeOptions" [value]="form().mode" ariaLabel="Send from"
                          data-testid="cm-email-mode" (valueChange)="canManage() && patch({ mode: $event })"></pf-segmented>
            @if (form().mode === 'platform') {
              <p class="pf-cm__hint" data-testid="cm-email-platform">
                Emails go from <strong class="pf-cm__mono">{{ email()?.platformAddress || 'the Prefrontal address' }}</strong> with your lab's name
                as the sender. When a patient replies, it reaches your reply-to address.
              </p>
            } @else {
              <p class="pf-cm__hint">Emails go from your own mailbox. Your email provider gives you these details (often under “SMTP” or “app password”).</p>
            }

            <div class="pf-cm__grid">
              <label class="pf-field">
                <span class="pf-field__lbl">Sender name</span>
                <input class="pf-input" data-testid="cm-email-fromname" maxlength="80" [disabled]="!canManage()"
                       [ngModel]="form().fromName" (ngModelChange)="patch({ fromName: $event })" placeholder="e.g. Arun Labs" />
              </label>
              <label class="pf-field">
                <span class="pf-field__lbl">Reply-to address</span>
                <input class="pf-input" type="email" inputmode="email" autocapitalize="off" spellcheck="false" data-testid="cm-email-replyto"
                       [disabled]="!canManage()" [ngModel]="form().replyTo" (ngModelChange)="patch({ replyTo: $event })" placeholder="e.g. reports@yourlab.in" />
              </label>
            </div>

            @if (form().mode === 'own') {
              <div class="pf-cm__grid" data-testid="cm-email-own">
                <label class="pf-field pf-cm__wide">
                  <span class="pf-field__lbl">Mail server (SMTP host)</span>
                  <input class="pf-input" data-testid="cm-smtp-host" autocapitalize="off" spellcheck="false" [disabled]="!canManage()"
                         [ngModel]="form().host" (ngModelChange)="patch({ host: $event })" placeholder="e.g. smtp.gmail.com" />
                </label>
                <label class="pf-field">
                  <span class="pf-field__lbl">Port</span>
                  <input class="pf-input pf-num" data-testid="cm-smtp-port" type="number" inputmode="numeric" min="1" max="65535" [disabled]="!canManage()"
                         [ngModel]="form().port" (ngModelChange)="patch({ port: $event })" />
                </label>
                <div class="pf-field">
                  <span class="pf-field__lbl">Security</span>
                  <pf-select data-testid="cm-smtp-security" [options]="securityOptions" [value]="form().security" [disabled]="!canManage()"
                             (valueChange)="patch({ security: $event })"></pf-select>
                </div>
                <label class="pf-field">
                  <span class="pf-field__lbl">Username</span>
                  <input class="pf-input" data-testid="cm-smtp-user" autocomplete="off" autocapitalize="off" spellcheck="false" [disabled]="!canManage()"
                         [ngModel]="form().username" (ngModelChange)="patch({ username: $event })" placeholder="Usually your email address" />
                </label>
                <div class="pf-field">
                  <span class="pf-field__lbl">Password</span>
                  @if (passwordSet() && !changingPassword()) {
                    <div class="pf-cm__saved" data-testid="cm-smtp-pass-saved">
                      <span class="pf-chip pf-chip--static">Saved</span>
                      @if (canManage()) {
                        <button type="button" class="pf-btn pf-btn--tertiary pf-cm__small" data-testid="cm-smtp-pass-change" (click)="changingPassword.set(true)">Change</button>
                      }
                    </div>
                  } @else {
                    <input class="pf-input" data-testid="cm-smtp-pass" type="password" autocomplete="new-password" [disabled]="!canManage()"
                           [ngModel]="form().password" (ngModelChange)="patch({ password: $event })"
                           [placeholder]="passwordSet() ? 'New password' : 'Mailbox or app password'" />
                    @if (passwordSet()) {
                      <button type="button" class="pf-btn pf-btn--tertiary pf-cm__small" data-testid="cm-smtp-pass-keep"
                              (click)="changingPassword.set(false); patch({ password: '' })">Keep the saved password</button>
                    }
                  }
                </div>
                <label class="pf-field pf-cm__wide">
                  <span class="pf-field__lbl">Send from address</span>
                  <input class="pf-input" data-testid="cm-smtp-from" type="email" inputmode="email" autocapitalize="off" spellcheck="false" [disabled]="!canManage()"
                         [ngModel]="form().fromAddress" (ngModelChange)="patch({ fromAddress: $event })" placeholder="e.g. reports@yourlab.in" />
                </label>
              </div>
            }

            @if (emailDirty() && problems().length) {
              <ul class="pf-cm__problems" data-testid="cm-email-problems">
                @for (p of problems(); track p) { <li>{{ p }}</li> }
              </ul>
            }
            @if (!theme.isNewDesign() && canManage()) {
              <div class="pf-cm__actions">
                <button type="button" class="pf-btn pf-btn--primary press" [disabled]="!emailDirty() || emailSaving()"
                        [pfBusy]="emailSaving()" (click)="saveEmail()">{{ emailSaving() ? 'Saving…' : 'Save' }}</button>
              </div>
            }
          </div>
        </section>

        @if (hosted && canManage()) {
          <!-- Settings (owner): Save sits IN the card — the Save bar, only while the email settings changed. -->
          <pf-settings-savebar saveTestId="cm-email-save" [dirty]="emailDirty()" [saving]="emailSaving()" [canSave]="!loading()"
                               (save)="saveEmail()" (discard)="discardEmail()"></pf-settings-savebar>
        }
        <!-- Test send: proves the SAVED settings reach a real inbox. -->
        <section class="pf-card pf-cm__card" data-testid="cm-email-test">
          <div class="pf-card__head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg></span>
            <h3 class="pf-card__label pf-cm__title">Send a test email</h3>
          </div>
          <div class="pf-card__body pf-cm__body">
            <p class="pf-cm__hint">Sends one short email with the saved settings, so you can see it arrive.</p>
            <div class="pf-cm__row">
              <label class="pf-field pf-cm__grow">
                <span class="pf-field__lbl">Send to</span>
                <input class="pf-input" data-testid="cm-test-to" type="email" inputmode="email" autocapitalize="off" spellcheck="false"
                       [ngModel]="testTo()" (ngModelChange)="testTo.set($event)" placeholder="you@example.com" />
              </label>
              <button type="button" class="pf-btn pf-btn--secondary press pf-cm__testbtn" data-testid="cm-test-send"
                      [disabled]="!canManage() || testing() || emailDirty() || !looksLikeEmail(testTo())"
                      [pfBusy]="testing()" pfBusyLabel="Sending…" (click)="sendTest()">Send test email</button>
            </div>
            @if (emailDirty()) {
              <p class="pf-cm__hint" data-testid="cm-test-save-first">Save your changes first — the test uses the saved settings.</p>
            }
            @if (testResult(); as r) {
              <p class="pf-cm__result" role="status" data-testid="cm-test-result" [attr.data-ok]="r.ok ? 'yes' : 'no'">
                {{ r.ok ? 'Sent to ' + r.to + ' — check that inbox (and its spam folder).' : 'Not sent: ' + r.error }}
              </p>
            }
          </div>
        </section>
        }
      }

      @if (showSec('sms')) {
        <h2 class="pf-cm__sec pf-classic-only">SMS</h2>
        @if (loading()) {
          <pf-skeleton-card [lines]="3" label="Loading SMS settings…"></pf-skeleton-card>
        } @else {
        <section class="pf-card pf-cm__card" data-testid="cm-sms">
          <div class="pf-card__head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M7 8h10M7 12h6"/></svg></span>
            <h3 class="pf-card__label pf-cm__title">SMS Chat</h3>
            <span class="pf-card__spacer"></span>
            <button type="button" class="pf-toggle pf-cm__switch" role="switch" data-testid="cm-sms-chat"
                    [attr.aria-checked]="smsChat()" aria-label="SMS Chat"
                    [disabled]="!canManage() || smsSaving() || smsOffByPrefrontal()" (click)="saveSms(!smsChat())">
              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
            </button>
          </div>
          <div class="pf-card__body pf-cm__body">
            @if (smsOffByPrefrontal()) {
              <p class="pf-cm__warn" role="status" data-testid="cm-sms-off">Prefrontal turned SMS Chat off for your lab. Ask Prefrontal to turn it on.</p>
            }
            <p class="pf-cm__hint" data-testid="cm-sms-explain">
              On a phone or tablet, <strong>Share → SMS</strong> opens the phone's own Messages app with the report link
              already typed — staff press Send. It does not show on computers.
            </p>
          </div>
        </section>
        <section class="pf-card pf-cm__card pf-cm__note" data-testid="cm-sms-auto-note">
          <div class="pf-card__head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
            <h3 class="pf-card__label pf-cm__title">Automatic SMS — coming later</h3>
          </div>
          <div class="pf-card__body pf-cm__body">
            <p class="pf-cm__hint">
              Sending SMS by itself (without opening Messages) needs a registered SMS provider — in India the
              sender and message must be registered (DLT). We will add it later; until then use SMS Chat or WhatsApp.
            </p>
          </div>
        </section>
        }
      }
      </div>
      </div>
    </section>
  `,
  styles: [`
    .pf-cm__sec { margin: 18px 0 10px; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-secondary); }
    .pf-cm__card { margin-bottom: 16px; }
    .pf-cm__title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-cm__switch { flex: none; }
    .pf-cm__body { padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 10px; }
    .pf-cm__hint { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--text-tertiary); text-wrap: pretty; }
    .pf-cm__hint strong { color: var(--text-secondary); font-weight: 600; }
    .pf-cm__mono { font-family: 'JetBrains Mono', ui-monospace, monospace; overflow-wrap: anywhere; }
    .pf-cm__warn { margin: 0; font-size: 12.5px; color: var(--text-secondary); font-style: italic; }
    .pf-cm__label { margin-top: 4px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .pf-cm__seg { align-self: flex-start; max-width: 100%; }
    .pf-cm__status {
      display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 10px 12px; border-radius: 10px;
      font-size: 13px; line-height: 1.45; color: var(--text-primary);
      background: var(--pf-chip-bg); border: 1px solid var(--pf-line);
    }
    .pf-cm__dot { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 999px; background: var(--text-tertiary); }
    .pf-cm__status[data-ready='yes'] .pf-cm__dot { background: var(--color-emerald-500, #10b981); }
    .pf-cm__status[data-ready='no'] .pf-cm__dot { background: var(--color-amber-500, #f59e0b); }
    .pf-cm__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 14px; }
    .pf-cm__wide { grid-column: 1 / -1; }
    .pf-cm__grid .pf-field { min-width: 0; }
    .pf-cm__saved { display: flex; align-items: center; gap: 10px; min-height: 40px; }
    .pf-cm__small { min-height: 32px; height: 32px; padding: 0 10px; font-size: 12.5px; align-self: flex-start; margin-top: 4px; }
    .pf-cm__saved .pf-cm__small { margin-top: 0; }
    .pf-cm__problems { margin: 0; padding: 10px 12px 10px 28px; border-radius: 10px; font-size: 12.5px; line-height: 1.5;
      color: var(--text-secondary); background: var(--pf-chip-bg); border: 1px solid var(--pf-line); }
    .pf-cm__actions { display: flex; justify-content: flex-end; }
    .pf-cm__row { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .pf-cm__grow { flex: 1 1 240px; min-width: 0; }
    .pf-cm__testbtn { flex: none; }
    .pf-cm__result { margin: 0; font-size: 13px; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-cm__result[data-ok='no'] { color: var(--text-secondary); }
    /* Inputs ≥16px on touch (the keyboard never zooms); one column on phones. */
    @media (max-width: 640px) {
      .pf-cm__grid { grid-template-columns: 1fr; }
      .pf-cm__body .pf-input { font-size: 16px; }
      .pf-cm__testbtn { width: 100%; min-height: 44px; }
      .pf-cm__card .pf-card__head { flex-wrap: wrap; row-gap: 6px; }
      .pf-cm__title { flex: 1 1 60%; min-width: 0; }
    }
  `],
})
export class CommunicationSettingsPage implements OnInit, HasUnsavedChanges {
  protected readonly theme = inject(ThemeService);
  private readonly api = inject(CommunicationService);
  private readonly share = inject(CommsShareService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly looksLikeEmail = looksLikeEmail;

  readonly tabOptions: SegmentedOption<CommsTab>[] = [
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
  ];
  readonly modeOptions: SegmentedOption<EmailMode>[] = [
    { value: 'platform', label: 'Prefrontal address' },
    { value: 'own', label: 'Our own mailbox' },
  ];
  readonly securityOptions: PfSelectOption<SmtpSecurity>[] = [
    { value: 'starttls', label: 'STARTTLS (usually port 587)' },
    { value: 'ssl', label: 'SSL / TLS (usually port 465)' },
    { value: 'none', label: 'None (not recommended)' },
  ];
  readonly tab = signal<CommsTab>('whatsapp');

  private readonly loadHold = createLoadHold(true);
  readonly loading = this.loadHold.active;
  readonly settings = signal<CommunicationSettings | null>(null);
  readonly email = computed(() => this.settings()?.email ?? null);
  readonly waChatOn = computed(() => this.settings()?.whatsapp?.chat ?? this.entitlements.moduleEnabled('whatsappChat'));

  /** Email form + the saved copy it is compared with. */
  readonly form = signal<EmailForm>(emailFormFrom(null));
  private readonly saved = signal<EmailForm>(emailFormFrom(null));
  readonly emailDirty = computed(() => !SAME(this.form(), this.saved()));
  readonly passwordSet = computed(() => this.email()?.own?.passwordSet === true);
  readonly changingPassword = signal(false);
  readonly problems = computed(() => emailFormProblems(this.form(), this.passwordSet()));
  readonly emailSaving = signal(false);
  /** In the Settings frame Save sits in the card's Save bar (owner: no button in the band's corner). */
  protected readonly hosted = injectSettingsHosted();
  discardEmail(): void { this.form.set({ ...this.saved() }); this.changingPassword.set(false); }

  // ── Leaving with unsaved email / SMTP edits asks first (WhatsApp and SMS switches save as they flip). ──
  readonly unsavedLabel = 'the email settings';
  hasUnsavedChanges(): boolean { return this.emailDirty(); }
  /** Save from the prompt: the email form's own Save (it warns on a problem and stays); true once nothing is left unsaved. */
  async saveChanges(): Promise<boolean> {
    await this.saveEmail();
    return !this.emailDirty();
  }
  private readonly _unloadGuard = guardUnsavedOnUnload(this);

  readonly testTo = signal('');
  readonly testing = signal(false);
  readonly testResult = signal<{ ok: boolean; to: string; error?: string } | null>(null);

  readonly smsChat = signal(true);
  readonly smsSaving = signal(false);

  readonly canManage = computed(() => COMMS_MANAGE_PERMS.some(p => this.auth.hasPermission(p)));
  readonly emailOffByPrefrontal = computed(() => !this.entitlements.moduleEnabled('emailShare'));
  readonly smsOffByPrefrontal = computed(() => !this.entitlements.moduleEnabled('smsChat'));

  showSec(key: CommsTab): boolean { return !this.theme.isNewDesign() || this.tab() === key; }

  pickTab(t: CommsTab): void {
    this.tab.set(t);
    void this.router.navigate([], { queryParams: { tab: t }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.loadHold.cancel());
    const t = this.router.parseUrl(this.router.url).queryParams['tab'];
    if ((COMMS_TABS as readonly string[]).includes(t)) this.tab.set(t as CommsTab);
    // A later ?tab= on the same screen (settings search, a deep link, the desktop app's hash routes) follows too.
    this.route?.queryParamMap?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(q => {
      const next = q.get('tab');
      if (next && (COMMS_TABS as readonly string[]).includes(next) && next !== this.tab()) this.tab.set(next as CommsTab);
    });
    void this.entitlements.ensureLoaded?.();
    this.testTo.set(this.auth.user()?.email ?? '');
    this.api.settings().subscribe({
      next: s => { this.loadHold.done(); this.applySettings(s); },
      error: () => { this.loadHold.done(); this.applySettings(null); },
    });
  }

  private labName(): string { return this.auth.user()?.tenantName ?? ''; }

  private applySettings(s: CommunicationSettings | null): void {
    const ok = s && typeof s === 'object' && !Array.isArray(s) ? s : null;
    this.settings.set(ok);
    const f = emailFormFrom(ok?.email, this.labName());
    this.form.set(f);
    this.saved.set(f);
    this.changingPassword.set(false);
    this.smsChat.set(ok?.sms?.chat ?? true);
  }

  patch(p: Partial<EmailForm>): void {
    this.form.update(f => ({ ...f, ...p }));
  }

  async saveEmail(): Promise<void> {
    if (!this.canManage() || this.emailSaving() || !this.emailDirty()) return;
    const problems = this.problems();
    if (problems.length) { this.toasts.warning(problems[0]); return; }
    this.emailSaving.set(true);
    try {
      const body = emailInputFrom(this.form(), !!this.email()?.own);
      const res = await firstValueFrom(this.api.saveEmail(body));
      const cur = this.settings();
      const next = { ...(cur ?? { whatsapp: { auto: true, chat: true }, sms: { chat: this.smsChat() } }), email: res } as CommunicationSettings;
      this.applySettings(next);
      this.share.apply({ email: res });
      if (res?.ready) this.toasts.success('Email settings saved — ready to send');
      else this.toasts.warning(`Email settings saved. ${res?.problem || 'Email can’t be sent yet.'}`, 7000);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message || 'Could not save the email settings');
    } finally {
      this.emailSaving.set(false);
    }
  }

  async sendTest(): Promise<void> {
    const to = this.testTo().trim();
    if (!this.canManage() || this.testing() || this.emailDirty() || !looksLikeEmail(to)) return;
    this.testing.set(true);
    this.testResult.set(null);
    try {
      const r = await firstValueFrom(this.api.testEmail(to));
      if (r?.ok) {
        this.testResult.set({ ok: true, to });
        this.toasts.success(`Test email sent to ${to}`);
      } else {
        this.testResult.set({ ok: false, to, error: r?.error || 'the mail server did not accept it' });
      }
    } catch (e) {
      this.testResult.set({ ok: false, to, error: ApiError.from(e).message || 'it could not be sent' });
    } finally {
      this.testing.set(false);
    }
  }

  saveSms(on: boolean): void {
    if (!this.canManage() || this.smsSaving()) return;
    const prev = this.smsChat();
    this.smsChat.set(on);
    this.smsSaving.set(true);
    this.api.saveSms(on).subscribe({
      next: r => {
        this.smsSaving.set(false);
        const v = typeof r?.chat === 'boolean' ? r.chat : on;
        this.smsChat.set(v);
        this.share.apply({ sms: { chat: v } });
        this.toasts.success(v ? 'SMS Chat is on for phones and tablets' : 'SMS Chat is off');
      },
      error: e => { this.smsSaving.set(false); this.smsChat.set(prev); this.toasts.error(ApiError.from(e).message || 'Could not save'); },
    });
  }
}
