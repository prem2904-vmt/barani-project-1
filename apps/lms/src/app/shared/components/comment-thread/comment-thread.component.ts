import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, Output, ViewChild, ViewChildren, QueryList, computed, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommentThread, OrderTestComment, groupIntoThreads } from '../../models/comment.model';

/**
 * Reusable conversation thread between validator and tech.
 *
 * Inputs
 *   comments      — flat OrderTestComment[] (will be grouped into threads)
 *   currentRole   — 'tech' | 'validator' (drives "Reply" + "Add" wording)
 *   parameterName — null = overall section; "x" = filtered to that param
 *   compose       — if true, renders the "Add new comment" composer at
 *                   bottom (off for resolved-only views).
 *   composeLabel  — text on the "Add" button (defaults differ by role)
 *
 * Outputs
 *   add(body, type)        — user wrote a new root comment
 *   reply(parentId, body)  — user replied to an existing root
 */
@Component({
  selector: 'pf-comment-thread',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (threads().length === 0 && !compose) {
      <p class="pf-ct__empty">No comments yet.</p>
    }

    @for (th of threads(); track th.root.id) {
      <div class="pf-ct__thread"
           [class.pf-ct__thread--resolved]="th.root.isResolved"
           [class.pf-ct__thread--observation]="th.root.commentType === 'observation'"
           [class.pf-ct__thread--correction]="th.root.commentType === 'correction'"
           [class.pf-ct__thread--awaiting]="awaitingReply(th)">
        @if (awaitingReply(th)) {
          <div class="pf-ct__awaiting-banner">
            <span class="pf-ct__pulse" aria-hidden="true"></span>
            Awaiting your reply
          </div>
        }
        <div class="pf-ct__msg">
          <div class="pf-ct__msg-meta">
            <span class="pf-ct__author">{{ authorLabel(th.root) }}</span>
            <span class="pf-ct__role-pill" [attr.data-role]="th.root.authorRole">{{ roleLabel(th.root.authorRole) }}</span>
            @if (th.root.commentType === 'observation') {
              <span class="pf-ct__type-pill pf-ct__type-pill--obs">Observation</span>
            } @else {
              <span class="pf-ct__type-pill pf-ct__type-pill--cor">Correction</span>
            }
            @if (th.root.isResolved) {
              <span class="pf-ct__resolved">✓ Resolved</span>
            }
            <span class="pf-ct__time">{{ th.root.createdAt | date:'short' }}</span>
          </div>
          <p class="pf-ct__body">{{ th.root.body }}</p>
        </div>

        @for (r of th.replies; track r.id) {
          <div class="pf-ct__reply">
            <div class="pf-ct__msg-meta">
              <span class="pf-ct__author">{{ authorLabel(r) }}</span>
              <span class="pf-ct__role-pill" [attr.data-role]="r.authorRole">{{ roleLabel(r.authorRole) }}</span>
              <span class="pf-ct__time">{{ r.createdAt | date:'short' }}</span>
            </div>
            <p class="pf-ct__body">{{ r.body }}</p>
          </div>
        }

        @if (compose && !th.root.isResolved) {
          @if (replyOpen() === th.root.id) {
            <div class="pf-ct__composer pf-ct__composer--reply">
              <textarea #replyBox class="pf-ct__textarea"
                        rows="2"
                        placeholder="Write a reply…"
                        [ngModel]="replyDraft()"
                        (ngModelChange)="replyDraft.set($event)"
                        autofocus></textarea>
              <div class="pf-ct__composer-actions">
                <button type="button" class="pf-ct__btn pf-ct__btn--ghost" (click)="cancelReply()">Cancel</button>
                <button type="button" class="pf-ct__btn pf-ct__btn--primary"
                        [disabled]="!replyDraft().trim()"
                        (click)="submitReply(th.root.id)">Send reply</button>
              </div>
            </div>
          } @else {
            <!-- Promoted Reply: pill button with icon, secondary
                 styling so it reads as an obvious tappable action
                 instead of a tiny inline link. -->
            <button type="button" class="pf-ct__reply-btn" (click)="openReply(th.root.id)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 17l-5-5 5-5"/>
                <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
              </svg>
              Reply
            </button>
          }
        }
      </div>
    }

    @if (compose) {
      @if (newOpen()) {
        <div class="pf-ct__composer">
          <textarea #newBox class="pf-ct__textarea"
                    rows="2"
                    [placeholder]="composePlaceholder()"
                    [ngModel]="newDraft()"
                    (ngModelChange)="newDraft.set($event)"
                    autofocus></textarea>
          <div class="pf-ct__composer-actions">
            <button type="button" class="pf-ct__btn pf-ct__btn--ghost" (click)="cancelNew()">Cancel</button>
            <button type="button" class="pf-ct__btn pf-ct__btn--primary"
                    [disabled]="!newDraft().trim()"
                    (click)="submitNew()">{{ composeSubmitLabel() }}</button>
          </div>
        </div>
      } @else {
        <button type="button" class="pf-ct__add" (click)="openNew()">
          + {{ composeLabel || defaultComposeLabel() }}
        </button>
      }
    }
  `,
  styles: [`
    :host { display: block; }

    .pf-ct__empty {
      margin: 4px 0; font-size: 12px; color: var(--text-tertiary);
    }

    .pf-ct__thread {
      padding: 10px 12px;
      margin-bottom: 8px;
      border-radius: 10px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-left: 3px solid var(--text-muted);
    }
    .pf-ct__thread--observation {
      border-left-color: #60a5fa;   /* blue: tech raised */
      background: linear-gradient(180deg, rgba(96, 165, 250, 0.05), var(--glass-bg) 60%);
    }
    .pf-ct__thread--correction {
      border-left-color: #ef4444;   /* red: validator raised */
      background: linear-gradient(180deg, rgba(239, 68, 68, 0.05), var(--glass-bg) 60%);
    }
    .pf-ct__thread--resolved {
      opacity: 0.65;
      border-left-color: #10b981;
    }
    /* Awaiting-reply: subtle warm glow + thicker accent so the user
       sees there's a thread waiting on them without being shouty. */
    .pf-ct__thread--awaiting {
      box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.34), 0 4px 14px rgba(245, 158, 11, 0.10);
      border-left-width: 4px;
    }
    .pf-ct__awaiting-banner {
      display: flex; align-items: center; gap: 6px;
      margin: -2px -2px 8px;
      padding: 4px 10px;
      background: rgba(245, 158, 11, 0.16);
      border-radius: 6px;
      font-size: 11px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
      color: #fbbf24;
    }
    .pf-ct__pulse {
      width: 8px; height: 8px;
      border-radius: 9999px;
      background: #fbbf24;
      box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.7);
      animation: pf-ct-pulse 1.6s ease-in-out infinite;
    }
    @keyframes pf-ct-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.7); }
      50%      { box-shadow: 0 0 0 8px rgba(251, 191, 36, 0); }
    }

    .pf-ct__msg-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
      font-size: 11px;
    }
    .pf-ct__author { font-weight: 600; color: var(--text-primary); }
    .pf-ct__role-pill {
      font-size: 9.5px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
      padding: 1px 6px; border-radius: 9999px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      color: var(--text-secondary);
    }
    .pf-ct__role-pill[data-role='validator'] {
      background: rgba(239, 68, 68, 0.16); color: #fca5a5; border-color: rgba(239, 68, 68, 0.34);
    }
    .pf-ct__role-pill[data-role='tech'] {
      background: rgba(96, 165, 250, 0.16); color: #93c5fd; border-color: rgba(96, 165, 250, 0.34);
    }
    .pf-ct__type-pill {
      font-size: 9.5px; font-weight: 600;
      padding: 1px 6px; border-radius: 9999px;
    }
    .pf-ct__type-pill--obs { background: rgba(96, 165, 250, 0.12); color: #93c5fd; }
    .pf-ct__type-pill--cor { background: rgba(239, 68, 68, 0.12); color: #fca5a5; }
    .pf-ct__resolved {
      font-size: 9.5px; font-weight: 600;
      color: #6ee7b7;
      padding: 1px 6px; border-radius: 9999px;
      background: rgba(16, 185, 129, 0.12);
    }
    .pf-ct__time { color: var(--text-tertiary); font-size: 10.5px; margin-left: auto; }

    .pf-ct__body {
      margin: 2px 0 0;
      font-size: 13px;
      color: var(--text-primary);
      white-space: pre-wrap;
      line-height: 1.4;
    }

    .pf-ct__reply {
      margin-top: 8px; padding-left: 14px;
      border-left: 2px solid var(--glass-border);
    }

    .pf-ct__reply-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      padding: 6px 14px;
      background: rgba(96, 165, 250, 0.12);
      border: 1px solid rgba(96, 165, 250, 0.34);
      color: #93c5fd;
      border-radius: 9999px;
      font-size: 12.5px; font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .pf-ct__reply-btn:hover {
      background: rgba(96, 165, 250, 0.22);
      border-color: rgba(96, 165, 250, 0.55);
      color: #bfdbfe;
    }
    .pf-ct__reply-btn:active { transform: scale(0.98); }

    .pf-ct__composer { margin-top: 8px; }
    .pf-ct__composer--reply { margin-left: 14px; }
    .pf-ct__textarea {
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--bg-card-solid, rgba(20, 22, 30, 0.6));
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 13px;
      font-family: inherit;
      resize: vertical;
    }
    .pf-ct__textarea:focus { outline: none; border-color: #a855f7; }

    .pf-ct__composer-actions {
      display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px;
    }
    .pf-ct__btn {
      height: 30px; padding: 0 12px;
      border-radius: 6px;
      font-size: 12.5px; font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--glass-border);
    }
    .pf-ct__btn--ghost {
      background: var(--glass-bg); color: var(--text-secondary);
    }
    .pf-ct__btn--primary {
      background: var(--gradient-primary, #a855f7); color: #fff; border: none;
    }
    .pf-ct__btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .pf-ct__add {
      margin-top: 4px;
      padding: 6px 12px;
      background: var(--glass-bg); border: 1px dashed var(--glass-border);
      color: var(--text-secondary);
      border-radius: 8px;
      font-size: 12px; font-weight: 500;
      cursor: pointer;
    }
    .pf-ct__add:hover { color: var(--text-primary); border-color: var(--text-secondary); }

    /* Phones (<640px): drop role pill + time from the meta line so
       author + type fit on one line without wrapping. Bigger tap
       targets on the action buttons (44px is the iOS guideline). */
    @media (max-width: 639px) {
      .pf-ct__role-pill { display: none; }
      .pf-ct__time { display: none; }
      .pf-ct__type-pill { font-size: 9px; }
      .pf-ct__author { font-size: 12px; }
      .pf-ct__body { font-size: 13.5px; }   /* slightly bigger for legibility */
      .pf-ct__btn { height: 36px; min-width: 80px; font-size: 13px; }
      .pf-ct__add  { padding: 10px 14px; font-size: 13px; }
      .pf-ct__reply-btn { padding: 6px 0; font-size: 12.5px; }
      .pf-ct__textarea { font-size: 14px; padding: 10px 12px; }
    }

    /* Tablets / iPads (640-1023px): keep desktop-ish density but
       slightly more padding inside threads for touch comfort. */
    @media (min-width: 640px) and (max-width: 1023px) {
      .pf-ct__btn { height: 34px; }
    }
  `]
})
export class CommentThreadComponent {
  @Input({ required: true }) set comments(value: OrderTestComment[]) {
    this._comments.set(value ?? []);
  }
  @Input() currentRole: 'tech' | 'validator' = 'tech';
  @Input() compose: boolean = true;
  @Input() composeLabel: string | null = null;

  @Output() add = new EventEmitter<{ body: string; type: 'observation' | 'correction' }>();
  @Output() reply = new EventEmitter<{ parentId: string; body: string }>();

  private readonly _comments = signal<OrderTestComment[]>([]);
  readonly threads = computed<CommentThread[]>(() => groupIntoThreads(this._comments()));

  readonly newOpen = signal<boolean>(false);
  readonly newDraft = signal<string>('');
  readonly replyOpen = signal<string | null>(null);
  readonly replyDraft = signal<string>('');

  /** True when the thread is unresolved AND the most-recent message
   *  is from the OTHER role — i.e. it's the current user's turn to
   *  respond. Used to pulse + banner the thread so the user can't
   *  miss it. */
  awaitingReply(th: CommentThread): boolean {
    if (th.root.isResolved) return false;
    const messages = [th.root, ...th.replies];
    const last = messages[messages.length - 1];
    return last.authorRole !== this.currentRole;
  }

  authorLabel(c: OrderTestComment): string {
    const a = c.author;
    if (!a) return c.authorRole === 'validator' ? 'Pathologist' : 'Lab tech';
    return (a.displayName
        ?? `${a.firstName ?? ''} ${a.fathersName ?? ''}`.trim())
        || (c.authorRole === 'validator' ? 'Pathologist' : 'Lab tech');
  }

  roleLabel(role: string): string {
    return role === 'validator' ? 'Validator' : 'Tech';
  }

  defaultComposeLabel(): string {
    return this.currentRole === 'validator' ? 'Add Overall Correction' : 'Add Overall Observation';
  }
  composePlaceholder(): string {
    return this.currentRole === 'validator'
      ? 'Note for the tech (e.g. "Recheck platelet count")…'
      : 'Note for the validator (e.g. "Patient was nervous, two attempts")…';
  }
  composeSubmitLabel(): string {
    return this.currentRole === 'validator' ? 'Post correction' : 'Post observation';
  }

  openNew() {
    this.newOpen.set(true);
    this.newDraft.set('');
    setTimeout(() => this.newBox?.nativeElement?.focus(), 0);
  }
  cancelNew()  { this.newOpen.set(false); this.newDraft.set(''); }
  submitNew() {
    const body = this.newDraft().trim();
    if (!body) return;
    const type: 'observation' | 'correction' =
      this.currentRole === 'validator' ? 'correction' : 'observation';
    this.add.emit({ body, type });
    this.newOpen.set(false);
    this.newDraft.set('');
  }

  @ViewChildren('replyBox') replyBoxes?: QueryList<ElementRef<HTMLTextAreaElement>>;
  @ViewChild('newBox') newBox?: ElementRef<HTMLTextAreaElement>;

  openReply(rootId: string) {
    this.replyOpen.set(rootId);
    this.replyDraft.set('');
    // Wait one tick for the @if to actually render the textarea, then
    // focus it. autofocus alone isn't reliable for dynamically-shown
    // elements (Safari especially ignores it).
    setTimeout(() => {
      const el = this.replyBoxes?.first?.nativeElement;
      el?.focus();
    }, 0);
  }
  cancelReply() { this.replyOpen.set(null); this.replyDraft.set(''); }
  submitReply(rootId: string) {
    const body = this.replyDraft().trim();
    if (!body) return;
    this.reply.emit({ parentId: rootId, body });
    this.replyOpen.set(null);
    this.replyDraft.set('');
  }
}
