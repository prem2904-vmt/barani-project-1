import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { ChatStore } from './chat.store';

/** The Cortex chat: what you ask, what Cortex did step by step in plain words, and what it says back. */
@Component({
  selector: 'st-cortex-chat',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="cc-banner" data-draft-banner><pf-icon name="info" [size]="16" /> <span>Cortex only edits the draft. You publish.</span></p>
    <div class="cc-list" #list role="log" aria-live="polite" aria-label="Conversation with Cortex" data-messages>
      @if (!chat.messages().length && !chat.working()) {
        <p class="cc-empty" data-empty>Tell Cortex what to add or change, for example “Add a cough question with a follow-up for how many days.”</p>
      }
      @for (m of chat.messages(); track m.id) {
        <div class="cc-msg" [attr.data-from]="m.from" [class.cc-msg--err]="m.error" [attr.role]="m.error ? 'alert' : null">
          <p class="cc-text">{{ m.text }}</p>
          @if (m.steps?.length) {
            <ul class="cc-steps" data-steps>
              @for (s of m.steps; track $index) {
                <li [class.cc-step--skip]="!s.changed" [attr.data-changed]="s.changed"><pf-icon [name]="s.changed ? 'check' : 'alert'" [size]="14" /> <span>{{ s.summary }}</span></li>
              }
            </ul>
          }
        </div>
      }
      @if (chat.working()) {
        <p class="cc-working" role="status" data-working><span class="cc-dots" aria-hidden="true"></span> Cortex is working…</p>
      }
    </div>
    <form class="cc-form" (submit)="submit($event)">
      <textarea
        class="cc-box"
        rows="2"
        data-box
        aria-label="Message to Cortex"
        placeholder="Ask Cortex to change this case sheet"
        [value]="text()"
        [disabled]="chat.working()"
        (input)="text.set($any($event.target).value)"
        (keydown.enter)="enter($event)"
      ></textarea>
      <button type="submit" class="pf-btn pf-btn--primary" data-act="send" [disabled]="!chat.canSend() || !text().trim()">
        <pf-icon name="send" [size]="16" /> Send
      </button>
    </form>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; gap: 10px; }
    .cc-banner { display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 12px; border-radius: 12px; font-size: 13px;
      background: var(--pf-done-tint, rgba(124, 58, 237, 0.07)); color: var(--text-primary); }
    .cc-banner pf-icon { flex: none; }
    .cc-list { flex: 1; min-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 2px; }
    .cc-empty { margin: 8px 4px; font-size: 13.5px; color: var(--text-secondary); text-wrap: pretty; }
    .cc-msg { max-width: 92%; padding: 9px 12px; border-radius: 14px; font-size: 14px; line-height: 1.45; border: 1px solid var(--pf-line); background: var(--pf-card-bg); color: var(--text-primary); }
    .cc-msg[data-from='user'] { align-self: flex-end; background: color-mix(in srgb, var(--accent-primary, #7c5cff) 12%, var(--pf-card-bg)); border-color: transparent; }
    .cc-msg[data-from='cortex'] { align-self: flex-start; }
    .cc-msg--err { color: var(--red-text, #b91c1c); border-color: color-mix(in srgb, var(--red-text, #b91c1c) 35%, transparent); }
    .cc-text { margin: 0; white-space: pre-wrap; overflow-wrap: break-word; min-width: 0; }
    .cc-steps { list-style: none; margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid var(--pf-line); display: grid; gap: 5px; font-size: 13px; color: var(--text-secondary); }
    .cc-steps li { display: flex; gap: 7px; align-items: flex-start; }
    .cc-steps pf-icon { flex: none; margin-top: 2px; color: var(--accent-primary, #7c5cff); }
    .cc-step--skip pf-icon { color: var(--amber-text, #b45309); }
    .cc-working { margin: 0 4px; display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--text-secondary); }
    .cc-dots { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-primary, #7c5cff); animation: cc-pulse 1.1s ease-in-out infinite; }
    @keyframes cc-pulse { 0%, 100% { opacity: .35; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }
    .cc-form { display: flex; gap: 8px; align-items: flex-end; flex: none; }
    .cc-box { flex: 1; min-width: 0; resize: none; font: inherit; font-size: 14px; padding: 9px 12px; border-radius: 12px; border: 1px solid var(--pf-line);
      background: var(--pf-card-bg); color: var(--text-primary); min-height: var(--pf-touch, 44px); }
    .cc-box:focus-visible { outline: 2px solid var(--accent-primary, #7c5cff); outline-offset: 1px; }
    @media (prefers-reduced-motion: reduce) { .cc-dots { animation: none; } }
  `],
})
export class CortexChatComponent {
  protected readonly chat = inject(ChatStore);
  protected readonly text = signal('');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // newest message / "working" into view
    effect(() => {
      this.chat.messages();
      this.chat.working();
      setTimeout(() => {
        const el = this.list()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }, 0);
    });
  }

  protected enter(e: Event): void {
    if ((e as KeyboardEvent).shiftKey || (e as KeyboardEvent).isComposing) return;
    e.preventDefault();
    void this.submit();
  }

  protected async submit(e?: Event): Promise<void> {
    e?.preventDefault();
    const t = this.text().trim();
    if (!t || !this.chat.canSend()) return;
    this.text.set('');
    await this.chat.send(t);
  }
}
