import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../../core/auth/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { ChatWindowsService } from '../../../core/services/chat-windows.service';
import { ThemeService } from '../../../core/services/theme.service';
import { Conversation } from '../../models/chat.model';
import { conversationInitials, conversationTitle } from '../../models/conversation-name';

/**
 * Floating chat windows — the Messenger model the owner asked for:
 * conversations open as small windows docked bottom-right above the app
 * bar, side by side up to the viewport's capacity (3 max, iPad ≈ 2), and
 * the overflow parks as circular heads on the right rail. Clicking a
 * head brings that thread back (evicting the least-recently-used one).
 *
 * NEW design only — classic keeps the people drawer untouched, and so do
 * phones (capacity 0), where a 330px window has nowhere to live.
 */
@Component({
  selector: 'pf-chat-windows',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (theme.isNewDesign() && windows().length + heads().length > 0) {
      <div class="pf-cw">
        @for (c of windows(); track c.id) {
          <section class="pf-cw__win" (click)="windowsSvc.focus(c.id)">
            <header class="pf-cw__hdr">
              <span class="pf-cw__init">{{ initials(c) }}</span>
              <span class="pf-cw__name">{{ title(c) }}</span>
              <button type="button" class="pf-cw__icon press" (click)="windowsSvc.minimize(c.id); $event.stopPropagation()"
                      aria-label="Minimize chat">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M5 12h14"/>
                </svg>
              </button>
              <button type="button" class="pf-cw__icon press" (click)="closeWindow(c.id); $event.stopPropagation()"
                      aria-label="Close chat">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18"/>
                </svg>
              </button>
            </header>

            <div class="pf-cw__msgs" [attr.data-conv]="c.id">
              @for (m of chat.messagesFor(c.id); track m.id) {
                <div class="pf-cw__row" [class.pf-cw__row--mine]="m.fromUserId === meId()">
                  <div class="pf-cw__bubble" [class.pf-cw__bubble--mine]="m.fromUserId === meId()"
                       [class.pf-cw__bubble--pending]="m.pending">
                    {{ m.body }}
                    <span class="pf-cw__time">{{ m.sentAt | date:'shortTime' }}</span>
                  </div>
                </div>
              } @empty {
                <p class="pf-cw__empty">No messages yet — say hello.</p>
              }
            </div>

            <div class="pf-cw__composer">
              <input #box type="text" class="pf-cw__input" placeholder="Write a message…"
                     [attr.aria-label]="'Message ' + title(c)"
                     (focus)="windowsSvc.focus(c.id)"
                     (keydown.enter)="send(c.id, box)" />
              <button type="button" class="pf-cw__send press" (click)="send(c.id, box)" aria-label="Send">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m22 2-7 20-4-9-9-4Z"/>
                </svg>
              </button>
            </div>
          </section>
        }

        @if (heads().length) {
          <div class="pf-cw__rail">
            @for (c of heads(); track c.id) {
              <button type="button" class="pf-cw__head press" (click)="windowsSvc.openWindow(c.id)"
                      [title]="title(c)" [attr.aria-label]="'Open chat with ' + title(c)">
                <span class="pf-cw__init">{{ initials(c) }}</span>
                @if (c.unreadCount > 0) {
                  <span class="pf-cw__head-badge">{{ c.unreadCount > 9 ? '9+' : c.unreadCount }}</span>
                }
              </button>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    /* Dock: bottom-right, above the app bar when it's docked there. */
    .pf-cw {
      position: fixed;
      right: 16px;
      bottom: calc(var(--pf-botbar-h, 0px) + 12px);
      z-index: 48;
      display: flex;
      align-items: flex-end;
      gap: 12px;
      pointer-events: none;
    }
    .pf-cw > * { pointer-events: auto; }
    @media (max-width: 767px) { .pf-cw { display: none; } }

    .pf-cw__win {
      width: 330px;
      height: 420px;
      max-height: calc(100dvh - var(--pf-botbar-h, 0px) - 90px);
      display: flex;
      flex-direction: column;
      border-radius: 16px 16px 12px 12px;
      overflow: hidden;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
    }

    .pf-cw__hdr {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 8px 8px 10px;
      border-bottom: 1px solid var(--border-muted);
      background: var(--bg-secondary);
    }
    .pf-cw__name {
      flex: 1; min-width: 0;
      font-size: 12.5px; font-weight: 500; color: var(--text-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pf-cw__icon {
      width: 26px; height: 26px; border-radius: 9999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: none; cursor: pointer;
      color: var(--text-secondary);
    }
    .pf-cw__icon:hover { background: var(--bg-hover); color: var(--text-primary); }

    .pf-cw__init {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 9999px; flex-shrink: 0;
      background: #eee1fd; color: #7c3aed; border: 1px solid #ecd8ff;
      font-size: 10.5px; font-weight: 600;
    }
    :host-context(.dark) .pf-cw__init {
      background: rgba(139, 92, 246, 0.18); color: #c4b5fd;
      border-color: rgba(168, 85, 247, 0.3);
    }

    .pf-cw__msgs {
      flex: 1; min-height: 0;
      overflow-y: auto; overscroll-behavior: contain;
      padding: 10px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .pf-cw__empty { margin: auto; font-size: 12px; color: var(--text-muted); }
    .pf-cw__row { display: flex; }
    .pf-cw__row--mine { justify-content: flex-end; }
    .pf-cw__bubble {
      max-width: 78%;
      padding: 7px 10px;
      border-radius: 14px;
      background: var(--bg-hover);
      color: var(--text-primary);
      font-size: 12.5px; line-height: 1.45;
      word-break: break-word;
    }
    .pf-cw__bubble--mine { background: rgba(124, 58, 237, 0.14); }
    .pf-cw__bubble--pending { opacity: 0.6; }
    .pf-cw__time {
      display: block; margin-top: 2px;
      font-size: 10px; color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }

    .pf-cw__composer {
      display: flex; align-items: center; gap: 6px;
      padding: 8px;
      border-top: 1px solid var(--border-muted);
    }
    .pf-cw__input {
      flex: 1; min-width: 0; height: 34px;
      padding: 0 12px; border-radius: 9999px;
      background: var(--bg-input, transparent);
      border: 1px solid var(--input-border, var(--border-muted));
      color: var(--text-primary);
      font-size: 12.5px; font-family: inherit;
      outline: none;
    }
    .pf-cw__input:focus { border-color: #7c3aed; }
    .pf-cw__send {
      width: 32px; height: 32px; border-radius: 9999px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: 1px solid #7c3aed; color: #7c3aed;
      cursor: pointer;
    }
    .pf-cw__send:hover { background: rgba(124, 58, 237, 0.1); }

    /* Minimized heads rail — stacked at the right edge. */
    .pf-cw__rail { display: flex; flex-direction: column-reverse; gap: 8px; }
    .pf-cw__head {
      position: relative;
      width: 44px; height: 44px; border-radius: 9999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
      cursor: pointer;
    }
    .pf-cw__head .pf-cw__init { width: 34px; height: 34px; font-size: 12px; }
    .pf-cw__head-badge {
      position: absolute; top: -2px; right: -2px;
      min-width: 17px; height: 17px; padding: 0 4px;
      border-radius: 9999px;
      background: var(--gradient-primary); color: #fff;
      font-size: 10px; font-weight: 700; line-height: 17px; text-align: center;
      box-shadow: 0 0 0 2px var(--bg-card-solid);
    }
  `]
})
export class ChatWindowsComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly chat = inject(ChatService);
  protected readonly windowsSvc = inject(ChatWindowsService);
  private readonly auth = inject(AuthService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  protected readonly meId = computed(() =>
    this.auth.user()?.authId ?? this.auth.user()?.id ?? '');

  /** Open windows resolved against the live conversation list. */
  protected readonly windows = computed(() => this.resolve(this.windowsSvc.open()));
  /** Minimized heads, same resolution. */
  protected readonly heads = computed(() => this.resolve(this.windowsSvc.minimized()));

  constructor() {
    // Keep every open thread pinned to its newest message.
    effect(() => {
      this.chat.threads();                    // re-run on any thread change
      queueMicrotask(() => {
        const panes = this.host.nativeElement.querySelectorAll<HTMLElement>('.pf-cw__msgs');
        panes.forEach(p => { p.scrollTop = p.scrollHeight; });
      });
    });
  }

  protected title(c: Conversation): string { return conversationTitle(c, this.meId()); }
  protected initials(c: Conversation): string { return conversationInitials(c, this.meId()); }

  protected send(conversationId: string, box: HTMLInputElement): void {
    const body = box.value.trim();
    if (!body) return;
    box.value = '';
    this.windowsSvc.focus(conversationId);
    void this.chat.sendMessage(conversationId, body);
  }

  protected closeWindow(conversationId: string): void {
    this.windowsSvc.close(conversationId);
    this.chat.forgetThread(conversationId);
  }

  private resolve(ids: readonly string[]): Conversation[] {
    const byId = new Map(this.chat.conversations().map(c => [c.id, c] as const));
    return ids.map(id => byId.get(id)).filter((c): c is Conversation => !!c);
  }
}
