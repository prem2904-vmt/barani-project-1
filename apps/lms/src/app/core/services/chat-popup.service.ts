import { Injectable, OnDestroy, signal } from '@angular/core';

/** What ChatService hands over for one incoming message. */
export interface ChatPopupInput {
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName: string;
  /** Group name when the thread is a group, else null. */
  groupName: string | null;
  /** One-line preview (already emoji-free / trimmed). */
  preview: string;
  sentAt: string;
}

/** One card on screen — one per conversation; repeat messages collapse. */
export interface ChatPopup extends ChatPopupInput {
  id: number;
  /** Messages folded into this card ("3 new messages from Priya"). */
  count: number;
}

/**
 * In-app "new message" pop-ups (Messages RCA 2026-09-27, issue 3 — the
 * Facebook-style pop-up the owner asked for). ChatService decides WHEN
 * (not mine, not muted, not the thread on screen, tab visible); this service
 * owns the stack:
 *  - one card per conversation, newest first, at most {@link MAX} cards;
 *    more messages in the same thread fold into its card (count++);
 *  - each card auto-dismisses after {@link DISMISS_MS}; hovering / focusing
 *    the stack pauses every timer, and timers only run while the page is
 *    visible (a card that arrives in a hidden tab waits for you);
 *  - cleared on account switch / sign-out (ChatService.resetForSession).
 */
@Injectable({ providedIn: 'root' })
export class ChatPopupService implements OnDestroy {
  static readonly MAX = 3;
  static readonly DISMISS_MS = 5000;

  private seq = 1;
  private readonly _popups = signal<ChatPopup[]>([]);
  readonly popups = this._popups.asReadonly();

  /** id → remaining ms + running timer handle. */
  private readonly timers = new Map<number, { remaining: number; startedAt: number; handle: ReturnType<typeof setTimeout> | null }>();
  private paused = false;
  /** Recently shown message ids — the same message never pops twice
   *  (e.g. a hub echo + a push relay). Bounded. */
  private readonly seen: string[] = [];

  private readonly onVisibility = () => this.syncTimers();

  constructor() {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  push(input: ChatPopupInput): void {
    if (input.messageId) {
      if (this.seen.includes(input.messageId)) return;
      this.seen.push(input.messageId);
      if (this.seen.length > 200) this.seen.shift();
    }
    const list = this._popups();
    const existing = list.find(p => p.conversationId === input.conversationId);
    let card: ChatPopup;
    if (existing) {
      card = { ...existing, ...input, id: existing.id, count: existing.count + 1 };
      this.stopTimer(existing.id);
      this.timers.delete(existing.id);
    } else {
      card = { ...input, id: this.seq++, count: 1 };
    }
    const next = [card, ...list.filter(p => p.id !== card.id)];
    // Over the cap: the oldest card goes (its thread keeps its unread badge).
    while (next.length > ChatPopupService.MAX) {
      const drop = next.pop()!;
      this.stopTimer(drop.id);
      this.timers.delete(drop.id);
    }
    this._popups.set(next);
    this.timers.set(card.id, { remaining: ChatPopupService.DISMISS_MS, startedAt: 0, handle: null });
    this.syncTimers();
  }

  dismiss(id: number): void {
    this.stopTimer(id);
    this.timers.delete(id);
    this._popups.update(list => list.filter(p => p.id !== id));
  }

  /** Drop the card for a conversation (e.g. the user just opened it). */
  dismissConversation(conversationId: string): void {
    const p = this._popups().find(x => x.conversationId === conversationId);
    if (p) this.dismiss(p.id);
  }

  clear(): void {
    for (const id of Array.from(this.timers.keys())) this.stopTimer(id);
    this.timers.clear();
    this._popups.set([]);
    this.seen.length = 0;
    this.paused = false;
  }

  /** Hover / focus inside the stack: freeze every card. */
  pause(): void { this.paused = true; this.syncTimers(); }
  resume(): void { this.paused = false; this.syncTimers(); }

  /** Start or stop every card's timer to match (paused, page visible). */
  private syncTimers(): void {
    const run = !this.paused && (typeof document === 'undefined' || document.visibilityState !== 'hidden');
    for (const [id, t] of this.timers) {
      if (run && !t.handle) {
        t.startedAt = Date.now();
        t.handle = setTimeout(() => this.dismiss(id), t.remaining);
      } else if (!run && t.handle) {
        this.stopTimer(id);
      }
    }
  }

  private stopTimer(id: number): void {
    const t = this.timers.get(id);
    if (!t?.handle) return;
    clearTimeout(t.handle);
    t.handle = null;
    t.remaining = Math.max(400, t.remaining - (Date.now() - t.startedAt));
  }

  ngOnDestroy(): void {
    this.clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
