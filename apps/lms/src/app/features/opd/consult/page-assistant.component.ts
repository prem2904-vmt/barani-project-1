import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChatService } from '../../../core/services/chat.service';
import { ToastService } from '../../../core/services/toast.service';

/** The quick messages to the doctor's assistant (consult v6). Pure. */
export function pageQuick(patientName: string): string[] {
  const first = patientName.replace(/^(dr|mr|mrs|ms|master|baby)\.?\s+/i, '').trim().split(/\s+/)[0] || 'the patient';
  return ['Send the next patient', `Recheck BP for ${first}`, "Bring today's reports", 'Need 5 minutes', 'Call the nurse'];
}

/** What a sent page shows: Seen once the assistant's read receipt passes it. Pure. */
export function pageStatus(sentAt: string, readAt: string | null | undefined): 'Seen' | 'Delivered' {
  return readAt && readAt >= sentAt ? 'Seen' : 'Delivered';
}

interface Sent { text: string; at: string; conv: string; }

/** "Ritu" from "Ritu S." — how the button and the toast name the assistant. Pure. */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').replace(/^(dr|mr|mrs|ms)\.?\s+/i, '').trim().split(/\s+/)[0] || 'your assistant';
}

/**
 * Page (consult v6, the clinical term — owner): a quick message to the
 * doctor's assistant without leaving the consult. Quick messages or a typed
 * one, sent through the app's chat as a thread anchored to this patient
 * ("<name> · Token X"). Delivered → Seen from the chat's read receipts. The
 * host shows it whenever Messages is on; with no assistant set (or a server
 * that doesn't send one yet) the popover says so, with a link for admins.
 */
@Component({
  selector: 'pf-consult-page-assistant',
  imports: [RouterLink],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="nd-btn nd-btn--secondary ng__btn" (click)="open.set(!open())" [attr.aria-expanded]="open()" aria-haspopup="dialog"
            title="Page your assistant" aria-label="Page your assistant" data-page>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></svg>
      @if (!iconOnly()) { <span class="ng__lab">Page</span> }
    </button>
    @if (open()) {
      <div class="ng__pop" role="dialog" [attr.aria-label]="title()">
        <div class="ng__h">
          <span class="ng__av" aria-hidden="true">{{ initials() || '?' }}</span>
          <div><b>{{ title() }}</b>@if (assistantId()) { <div class="ng__s">A message on this patient's thread</div> }</div>
        </div>
        @if (assistantId()) {
          <div class="ng__b">
            <div class="ng__qs">
              @for (q of quick(); track q) {
                <button type="button" class="ng__q" [disabled]="busy()" (click)="send(q)">{{ q }}</button>
              }
            </div>
            <div class="ng__row">
              <input #msg class="nd-input ng__in" type="text" placeholder="Type a message" aria-label="Message to your assistant" maxlength="500"
                     (keydown.enter)="send(msg.value); msg.value = ''" />
              <button type="button" class="nd-btn nd-btn--primary" [disabled]="busy()" (click)="send(msg.value); msg.value = ''">Page</button>
            </div>
            <p class="ng__hint">{{ patientName() }} · Token {{ token() }} is attached.</p>
            @if (sent().length) {
              <div class="ng__sent" aria-live="polite">
                @for (n of recent(); track n.at) {
                  <div><span>{{ n.text }}</span><span class="nd-num" [class.ng__ok]="status(n) === 'Seen'">{{ status(n) }} · {{ time(n.at) }}</span></div>
                }
              </div>
            }
          </div>
        } @else {
          <div class="ng__b" data-no-assistant>
            <p class="ng__hint ng__none">No assistant set for you yet. An admin sets it in OPD → Doctors.</p>
            @if (isAdmin()) { <a class="nd-btn nd-btn--secondary" routerLink="/admin/opd/doctors" (click)="open.set(false)">Open OPD → Doctors</a> }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: inline-flex; }
    .ng__btn { height: 36px; min-height: 36px; color: var(--violet-text, #6d28d9); border-color: transparent; background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .ng__pop { position: absolute; top: calc(100% + 8px); right: 0; z-index: 60; width: 340px; max-width: calc(100vw - 32px); overflow: hidden;
      border-radius: var(--nd-radius-card, 16px); background: var(--nd-card-bg); border: 1px solid var(--nd-line); box-shadow: 0 18px 44px rgba(15, 23, 42, 0.22); }
    :host-context(html.dark) .ng__pop { box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55); }
    .ng__h { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--nd-line);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 3%, var(--nd-card-bg)); }
    .ng__h b { font-size: 14px; color: var(--text-primary); }
    .ng__av { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700;
      color: var(--violet-text, #6d28d9); background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .ng__s { font-size: 12px; color: var(--text-tertiary); }
    .ng__b { display: grid; gap: 10px; padding: 12px 14px; }
    .ng__qs { display: flex; flex-wrap: wrap; gap: 6px; }
    .ng__q { min-height: 32px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--nd-line); background: none; font: inherit; font-size: 12.5px;
      color: var(--text-secondary); cursor: pointer; }
    .ng__q:hover:not(:disabled) { border-color: var(--color-violet-600, #7c3aed); color: var(--text-primary); }
    .ng__q:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .ng__row { display: flex; gap: 6px; }
    .ng__in { flex: 1; min-width: 0; min-height: 44px; }
    .ng__hint { margin: 0; font-size: 12px; color: var(--text-tertiary); }
    .ng__none { font-size: 13px; color: var(--text-secondary); line-height: 1.45; }
    .ng__sent { display: grid; gap: 4px; padding-top: 8px; border-top: 1px solid var(--nd-line); }
    .ng__sent div { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; color: var(--text-primary); }
    .ng__sent span:last-child { flex: none; color: var(--text-tertiary); }
    .ng__ok { color: var(--green-text, #047857) !important; font-weight: 600; }
    @media (max-width: 600px) { .ng__lab { display: none; } .ng__pop { position: fixed; left: 12px; right: 12px; top: 120px; width: auto; } .ng__in { font-size: 16px; } }
  `],
})
export class ConsultPageAssistantComponent {
  private readonly chat = inject(ChatService);
  private readonly toast = inject(ToastService);
  private readonly el = inject(ElementRef<HTMLElement>);

  /** Null / empty = no assistant set (or an older server). */
  readonly assistantId = input<string | null>(null);
  readonly assistantName = input<string | null>(null);
  /** Admins get a link to OPD → Doctors when no assistant is set. */
  readonly isAdmin = input(false);
  /** The pad's band: just the icon (the tooltip names it). */
  readonly iconOnly = input(false);
  readonly patientId = input.required<string>();
  readonly patientName = input.required<string>();
  readonly token = input('');

  readonly open = signal(false);
  readonly busy = signal(false);
  readonly sent = signal<Sent[]>([]);
  readonly quick = computed(() => pageQuick(this.patientName()));
  readonly first = computed(() => firstName(this.assistantName()));
  readonly title = computed(() => (this.assistantId() ? `Page ${this.first()} (assistant)` : 'Page your assistant'));
  readonly recent = computed(() => this.sent().slice(-3).reverse());
  readonly initials = computed(() => (this.assistantName() ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase());

  status(n: Sent) { return pageStatus(n.at, this.chat.readReceipts().get(n.conv)?.get(this.assistantId() ?? '')); }
  time(iso: string) { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }

  async send(raw: string) {
    const text = (raw ?? '').trim();
    const to = this.assistantId();
    if (!text || this.busy() || !to) return;
    this.busy.set(true);
    try {
      const conv = await this.chat.openConversationWithContext(to, 'patient', this.patientId(), `${this.patientName()} · Token ${this.token()}`);
      const at = new Date().toISOString();
      await this.chat.sendMessage(conv, text);
      this.sent.update(l => [...l, { text, at, conv }]);
      this.toast.success(`Paged ${this.first()}`);
    } catch (e) {
      this.toast.error((e as Error)?.message || 'Could not send the message');
    } finally {
      this.busy.set(false);
    }
  }

  @HostListener('document:pointerdown', ['$event'])
  onDoc(e: PointerEvent) { if (this.open() && !(this.el.nativeElement as HTMLElement).contains(e.target as Node)) this.open.set(false); }
  @HostListener('document:keydown.escape')
  onEsc() { this.open.set(false); }
}
