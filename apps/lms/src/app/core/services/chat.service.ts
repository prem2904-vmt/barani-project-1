import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ChatMessage, ConversationSummary } from '../../shared/models/chat.model';

/**
 * 1:1 chat client. One persistent SignalR connection to /hubs/chat.
 * Owns three pieces of state:
 *   - `conversations` — list of every conversation I've ever had, with
 *     last message + unread count.
 *   - `activeMessages` — messages for the currently-open chat, sorted
 *     chronologically.
 *   - `typingFrom` — set of user ids currently typing toward me.
 *
 * Tenant scope is enforced server-side (every query filters TenantId)
 * so this client never has to think about cross-tenant leakage.
 */
@Injectable({ providedIn: 'root' })
export class ChatService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private connection: signalR.HubConnection | null = null;
  private connecting: Promise<void> | null = null;

  readonly isConnected = signal(false);
  readonly conversations = signal<ConversationSummary[]>([]);
  readonly activeOtherUserId = signal<string | null>(null);
  readonly activeMessages = signal<ChatMessage[]>([]);
  readonly typingFrom = signal<Set<string>>(new Set());
  readonly loadingHistory = signal(false);

  /** Total unread across all conversations — for the top-strip badge. */
  readonly totalUnread = computed(() =>
    this.conversations().reduce((sum, c) => sum + c.unread, 0)
  );

  // ── Connection lifecycle ───────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connection?.state === signalR.HubConnectionState.Connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this._connect();
    try { await this.connecting; } finally { this.connecting = null; }
  }

  private async _connect(): Promise<void> {
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${environment.apiUrl}/hubs/chat`, {
        accessTokenFactory: async () => (await this.auth.getAccessToken()) ?? '',
        transport: signalR.HttpTransportType.WebSockets,
        skipNegotiation: true
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this.connection.on('MessageReceived', (m: ChatMessage) => this.onMessageReceived(m));
    this.connection.on('MessageRead',     (p: { id: string; readAt: string }) => this.onMessageRead(p));
    this.connection.on('Typing',          (p: { fromUserId: string; toUserId: string; isTyping: boolean }) => this.onTyping(p));

    this.connection.onreconnected(async () => {
      this.isConnected.set(true);
      try { await this.loadConversations(); } catch { /* best-effort */ }
    });
    this.connection.onclose(() => this.isConnected.set(false));

    await this.connection.start();
    this.isConnected.set(true);
    try { await this.loadConversations(); } catch { /* user has no chats yet */ }
  }

  // ── Public actions ────────────────────────────────────────────────

  async sendMessage(toUserId: string, body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) return;
    await this.connect();
    await this.connection!.invoke('SendMessage', toUserId, trimmed);
    // Don't push optimistically — server broadcasts MessageReceived back to us.
  }

  async openConversation(otherUserId: string): Promise<void> {
    await this.connect();
    this.activeOtherUserId.set(otherUserId);
    this.activeMessages.set([]);
    this.loadingHistory.set(true);
    try {
      const res = await this.connection!.invoke<{ messages: ChatMessage[] }>('LoadConversation', otherUserId, 50);
      this.activeMessages.set(res.messages ?? []);
      await this.connection!.invoke('MarkConversationRead', otherUserId);
      // Clear unread locally — server broadcast will catch any stragglers.
      this.conversations.update(list =>
        list.map(c => c.otherUserId === otherUserId ? { ...c, unread: 0 } : c)
      );
    } finally {
      this.loadingHistory.set(false);
    }
  }

  closeConversation(): void {
    this.activeOtherUserId.set(null);
    this.activeMessages.set([]);
    this.typingFrom.set(new Set());
  }

  async loadConversations(): Promise<void> {
    await this.connect();
    const res = await this.connection!.invoke<{ conversations: ConversationSummary[] }>('LoadConversations');
    this.conversations.set(res.conversations ?? []);
  }

  async setTyping(toUserId: string, isTyping: boolean): Promise<void> {
    await this.connect();
    try { await this.connection!.invoke('Typing', toUserId, isTyping); } catch { /* ignore */ }
  }

  // ── Server event handlers ─────────────────────────────────────────

  private onMessageReceived(m: ChatMessage) {
    // m.fromUserId / m.toUserId are Supabase sub (AuthId) since the backend
    // switched to SubClaimUserIdProvider. Comparing against auth.user().id
    // (prefrontal UserEntity.Id) silently never matched — every echoed
    // message looked like it came from a stranger, so it was dropped from
    // both activeMessages and the conversation summary update.
    const me = this.auth.user()?.authId ?? this.auth.user()?.id;
    const other = m.fromUserId === me ? m.toUserId : m.fromUserId;

    // Append to active conversation if open.
    if (this.activeOtherUserId() === other) {
      this.activeMessages.update(list => [...list, m]);
      // I'm currently looking at this thread — mark read immediately.
      if (m.toUserId === me) void this.connection?.invoke('MarkRead', m.id);
    }

    // Update / insert conversation summary.
    this.conversations.update(list => {
      const idx = list.findIndex(c => c.otherUserId === other);
      const isToMe = m.toUserId === me;
      const inc = isToMe && this.activeOtherUserId() !== other ? 1 : 0;
      const summary: ConversationSummary = {
        otherUserId: other,
        lastMessage: { id: m.id, fromUserId: m.fromUserId, body: m.body, sentAt: m.sentAt, readAt: m.readAt },
        unread: (idx >= 0 ? list[idx].unread : 0) + inc
      };
      if (idx >= 0) {
        const next = [...list]; next.splice(idx, 1);
        return [summary, ...next];
      }
      return [summary, ...list];
    });
  }

  private onMessageRead(p: { id: string; readAt: string }) {
    this.activeMessages.update(list =>
      list.map(m => m.id === p.id ? { ...m, readAt: p.readAt } : m)
    );
  }

  private onTyping(p: { fromUserId: string; toUserId: string; isTyping: boolean }) {
    // toUserId arrives as Supabase sub; compare against authId.
    const me = this.auth.user()?.authId ?? this.auth.user()?.id;
    if (p.toUserId !== me) return;
    const next = new Set(this.typingFrom());
    if (p.isTyping) next.add(p.fromUserId); else next.delete(p.fromUserId);
    this.typingFrom.set(next);
  }

  async disconnect(): Promise<void> {
    if (!this.connection) return;
    try { await this.connection.stop(); } catch { /* ignore */ }
    this.connection = null;
    this.isConnected.set(false);
  }

  ngOnDestroy(): void { void this.disconnect(); }
}
