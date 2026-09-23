import { Injectable, signal } from '@angular/core';

/**
 * Chat dock — Facebook-style conversation shortcuts on the bar (owner:
 * "if I make a chat, it should come like the drafts do"). Opening a
 * conversation from the Messages dropdown pins its id here; chips render
 * next to the draft shelf, one click back into the thread. Session-
 * scoped on purpose: the dock mirrors what you're actively juggling.
 */
@Injectable({ providedIn: 'root' })
export class ChatDockService {
  private static readonly MAX = 4;
  private readonly _ids = signal<string[]>([]);
  readonly ids = this._ids.asReadonly();

  /** Pin a conversation (most-recent first, deduped, capped). */
  add(conversationId: string): void {
    this._ids.update(ids => [conversationId, ...ids.filter(i => i !== conversationId)]
      .slice(0, ChatDockService.MAX));
  }

  remove(conversationId: string): void {
    this._ids.update(ids => ids.filter(i => i !== conversationId));
  }
}
