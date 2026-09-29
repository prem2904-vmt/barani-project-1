import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { ToastService } from '../../../core/services/toast.service';
import {
  WaMessageChoice, WaSettings, WhatsAppService, waFillTemplate,
} from '../../../core/services/whatsapp.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';

/**
 * Lab settings → WhatsApp → the MESSAGE the patient receives (owner 2026-09-29:
 * labs never see or type template codes). A "Message" pf-select lists only the
 * templates Meta APPROVED on this lab's sender (its own number, else the
 * shared Prefrontal one) with human labels; "Language" is a pf-select when a
 * template is approved in several languages, else a read-only chip; a live
 * WhatsApp-style preview renders the chosen template's components (from the
 * server, never hard-coded text) with sample values — the patient's first
 * name and THIS lab's name — plus the "View report" button and "Sent from".
 * Saving PUTs the code + language; the server validates against its list.
 */
@Component({
  selector: 'pf-wa-message-picker',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (menu(); as m) {
    <div class="pf-wmp" data-testid="wa-message-picker" [attr.data-kind]="kind()">
      <div class="pf-wmp__fields">
        <label class="pf-wmp__field">
          <span class="nd-field__lbl">Message</span>
          @if (options().length) {
            <pf-select data-testid="wmp-message" [options]="options()" [value]="code()" [disabled]="!canEdit() || busy()"
                       placeholder="Choose a message" (valueChange)="pick($event)"></pf-select>
          } @else {
            <span class="nd-chip nd-chip--static pf-wmp__chip" data-testid="wmp-none">No approved message yet</span>
          }
        </label>
        <label class="pf-wmp__field pf-wmp__field--lang">
          <span class="nd-field__lbl">Language</span>
          @if (languages().length > 1) {
            <pf-select data-testid="wmp-language" [options]="languageOptions()" [value]="language()" [disabled]="!canEdit() || busy()"
                       (valueChange)="pickLanguage($event)"></pf-select>
          } @else {
            <span class="nd-chip nd-chip--static pf-wmp__chip" data-testid="wmp-language-chip">{{ languages()[0]?.label || 'English' }}</span>
          }
        </label>
      </div>
      @if (m.pending.length) {
        <p class="pf-wmp__hint" data-testid="wmp-pending">
          @for (p of m.pending; track p.kind) {
            <span><strong>{{ p.label }}</strong> {{ pendingWords(p.status) }}@if (p.reason) { ({{ p.reason }})}. </span>
          }
          It appears here once approved.
        </p>
      }

      <!-- WhatsApp-style preview: rendered from the template's components + the sample. -->
      @if (choice(); as t) {
        <div class="pf-wmp__chat" data-testid="wmp-preview" aria-label="Preview of the WhatsApp message">
          <div class="pf-wmp__bubble">
            @if (t.components.header?.format === 'DOCUMENT') {
              <div class="pf-wmp__doc" data-testid="wmp-doc">
                <span class="pf-wmp__doc-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>
                </span>
                <span class="pf-wmp__doc-name">{{ m.sample.documentFilename }}</span>
                <span class="pf-wmp__doc-kind">PDF</span>
              </div>
            }
            <p class="pf-wmp__body" data-testid="wmp-body">{{ body() }}</p>
            @if (t.components.footer) { <p class="pf-wmp__footer">{{ t.components.footer }}</p> }
            <span class="pf-wmp__time" aria-hidden="true">{{ time }}</span>
          </div>
          @for (b of t.components.buttons; track b.text) {
            <div class="pf-wmp__button" data-testid="wmp-button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7M21 3l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>
              {{ b.text }}
            </div>
          }
          <p class="pf-wmp__from" data-testid="wmp-from">Sent from: <strong>{{ m.senderLine }}</strong></p>
        </div>
      }
    </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-wmp { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
    .pf-wmp__fields { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: flex-end; }
    .pf-wmp__field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 260px; max-width: 360px; min-width: 0; }
    .pf-wmp__field--lang { flex: 0 1 200px; }
    .pf-wmp__chip { align-self: flex-start; height: auto; min-height: 40px; }
    .pf-wmp__hint { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-tertiary); }
    .pf-wmp__hint strong { color: var(--text-secondary); font-weight: 600; }

    /* The chat: a WhatsApp-like canvas with one incoming bubble + the template button. */
    .pf-wmp__chat { --wa-bg: #e5ddd5; --wa-bubble: #ffffff; --wa-text: #111b21; --wa-muted: #667781; --wa-link: #027eb5; --wa-line: rgba(0,0,0,0.08);
      background: var(--wa-bg); border-radius: 14px; padding: 14px; max-width: 380px; display: flex; flex-direction: column; gap: 4px;
      background-image: radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px); background-size: 14px 14px; }
    .pf-wmp__bubble { position: relative; background: var(--wa-bubble); color: var(--wa-text); border-radius: 10px; border-top-left-radius: 2px;
      padding: 8px 10px 18px; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13); font-size: 14px; line-height: 1.45; }
    .pf-wmp__doc { display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.05); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
    .pf-wmp__doc-icon { color: #d93025; display: inline-flex; flex-shrink: 0; }
    .pf-wmp__doc-name { flex: 1 1 auto; min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
    .pf-wmp__doc-kind { font-size: 11px; color: var(--wa-muted); text-transform: uppercase; }
    .pf-wmp__body { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .pf-wmp__footer { margin: 6px 0 0; font-size: 12.5px; color: var(--wa-muted); }
    .pf-wmp__time { position: absolute; right: 8px; bottom: 4px; font-size: 11px; color: var(--wa-muted); }
    .pf-wmp__button { background: var(--wa-bubble); color: var(--wa-link); border-radius: 8px; padding: 9px 10px; text-align: center; font-size: 14px; font-weight: 500;
      display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13); }
    .pf-wmp__from { margin: 6px 0 0; font-size: 11.5px; color: #3b4a54; }
    .pf-wmp__from strong { font-weight: 600; }
    :host-context([data-theme='dark']) .pf-wmp__chat { --wa-bg: #0b141a; --wa-bubble: #202c33; --wa-text: #e9edef; --wa-muted: #8696a0; --wa-link: #53bdeb;
      background-image: radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px); }
    :host-context([data-theme='dark']) .pf-wmp__from { color: #8696a0; }
    :host-context([data-theme='dark']) .pf-wmp__doc { background: rgba(255,255,255,0.06); }
    @media (max-width: 640px) {
      .pf-wmp__field, .pf-wmp__field--lang { flex-basis: 100%; max-width: none; }
      .pf-wmp__chat { max-width: none; }
    }
  `],
})
export class WaMessagePickerComponent {
  readonly settings = input.required<WaSettings>();
  /** The caller's permission (manage_lab_settings / manage_notifications; superadmin in the console). */
  readonly canEdit = input<boolean>(true);
  /** New settings after a save — the page replaces its copy. */
  readonly changed = output<WaSettings>();

  private readonly wa = inject(WhatsAppService);
  private readonly toasts = inject(ToastService);

  protected readonly busy = signal(false);
  private readonly localCode = signal<string | null>(null);
  private readonly localLanguage = signal<string | null>(null);
  protected readonly time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  protected readonly menu = computed(() => this.settings().message ?? null);
  protected readonly options = computed<PfSelectOption<string>[]>(() =>
    (this.menu()?.templates ?? []).map(t => ({ value: t.code, label: t.label })));
  /** The effective code: the local pick while saving, else the server's. */
  protected readonly code = computed(() => this.localCode() ?? this.menu()?.code ?? '');
  protected readonly choice = computed<WaMessageChoice | null>(() => {
    const m = this.menu();
    if (!m) return null;
    return m.templates.find(t => t.code === this.code()) ?? m.templates[0] ?? null;
  });
  protected readonly kind = computed(() => this.choice()?.kind ?? m0(this.menu()?.kind));
  protected readonly languages = computed(() => this.choice()?.languages ?? []);
  protected readonly languageOptions = computed<PfSelectOption<string>[]>(() => this.languages().map(l => ({ value: l.code, label: l.label })));
  protected readonly language = computed(() => {
    const l = this.localLanguage() ?? this.menu()?.language ?? '';
    return this.languages().some(x => x.code === l) ? l : (this.languages()[0]?.code ?? l);
  });
  protected readonly body = computed(() => {
    const t = this.choice();
    const m = this.menu();
    return t && m ? waFillTemplate(t.components.body, m.sample.bodyParams) : '';
  });

  constructor() {
    // A fresh server copy wins over a stale local pick.
    effect(() => { this.settings(); this.localCode.set(null); this.localLanguage.set(null); });
  }

  protected pendingWords(status: string): string {
    switch ((status ?? '').toUpperCase()) {
      case 'PENDING': case 'IN_APPEAL': return 'is waiting for Meta\'s review';
      case 'REJECTED': return 'was rejected by Meta';
      case 'PAUSED': return 'is paused by Meta';
      case 'DISABLED': return 'is disabled by Meta';
      default: return 'is not available yet';
    }
  }

  pick(code: string) {
    if (!this.canEdit() || this.busy() || !code || code === this.code()) return;
    this.localCode.set(code);
    const t = this.menu()?.templates.find(x => x.code === code);
    const lang = t?.languages.some(l => l.code === this.language()) ? this.language() : (t?.languages[0]?.code ?? null);
    this.save(code, lang);
  }

  pickLanguage(lang: string) {
    if (!this.canEdit() || this.busy() || !lang || lang === this.language()) return;
    this.localLanguage.set(lang);
    this.save(this.code(), lang);
  }

  private save(code: string, language: string | null) {
    const cur = this.settings();
    this.busy.set(true);
    this.wa.saveSettings({ autoSendEnabled: cur.autoSendEnabled, sendUpdatedReports: cur.sendUpdatedReports, templateCode: code, templateLanguage: language }).subscribe({
      next: s => {
        this.busy.set(false);
        this.changed.emit(s);
        const label = this.menu()?.templates.find(t => t.code === code)?.label ?? 'Message';
        this.toasts.success(`Patients will get "${label}"`);
      },
      error: e => {
        this.busy.set(false);
        this.localCode.set(null);
        this.localLanguage.set(null);
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }
}

function m0(k: string | undefined): 'link' | 'pdf' { return k === 'pdf' ? 'pdf' : 'link'; }
