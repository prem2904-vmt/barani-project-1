import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ChatMessage, Conversation } from '../../shared/models/chat.model';
import { ApiService } from './api.service';
import { RingtoneService } from './ringtone.service';
import { ChatNotifyService } from './chat-notify.service';

/**
 * Conversation-based chat (1:1 + group). One persistent SignalR
 * connection to /hubs/chat for realtime; REST for create/list.
 *
 * Public signals:
 *   - conversations: every conversation I'm a member of, newest first
 *   - activeConversationId: which thread the right pane is showing
 *   - activeMessages: messages for the active thread, chronological
 *   - typingByConversation: { convId → set of userIds typing }
 *   - totalUnread: sum across all conversations (for sidebar badge)
 *
 * Optimistic send: append with `pending: true` immediately, replace with
 * server echo when it arrives (matched by sent body + sender for the
 * one rare race where the user sends two identical messages back-to-back).
 */
@Injectable({ providedIn: 'root' })
export class ChatService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly ringtone = inject(RingtoneService);
  private readonly notify = inject(ChatNotifyService);
  private connection: signalR.HubConnection | null = null;
  private connecting: Promise<void> | null = null;
  private typingClearTimers = new Map<string, number>(); // convId|userId → setTimeout id

  readonly isConnected = signal(false);
  readonly conversations = signal<Conversation[]>([]);
  readonly activeConversationId = signal<string | null>(null);
  readonly activeMessages = signal<ChatMessage[]>([]);
  readonly typingByConversation = signal<Map<string, Set<string>>>(new Map());
  readonly loadingHistory = signal(false);

  readonly activeConversation = computed(() => {
    const id = this.activeConversationId();
    if (!id) return null;
    return this.conversations().find(c => c.id === id) ?? null;
  });

  readonly totalUnread = computed(() =>
    this.conversations().reduce((sum, c) => sum + c.unreadCount, 0)
  );

  // ── Connection lifecycle ────────────────────────────────────────────

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
    this.connection.on('MessageRead', (p: { conversationId: string; userId: string; readAt: string }) =>
      this.onMessageRead(p));
    this.connection.on('Typing', (p: { conversationId: string; fromUserId: string; isTyping: boolean }) =>
      this.onTyping(p));
    this.connection.on('ConversationCreated', (_p: { conversationId: string }) =>
      void this.loadConversations());
    this.connection.on('ConversationUpdated',
      (p: { conversationId: string; lastMessage: any; lastMessageAt: string }) =>
        this.onConversationUpdated(p));

    this.connection.onreconnected(async () => {
      this.isConnected.set(true);
      try { await this.loadConversations(); } catch { /* best-effort */ }
    });
    this.connection.onclose(() => this.isConnected.set(false));

    await this.connection.start();
    this.isConnected.set(true);
    try { await this.loadConversations(); } catch { /* user has no chats yet */ }
  }

  // ── REST actions ────────────────────────────────────────────────────

  /** Get-or-create a 1:1 conversation with the given AuthId. Returns the id. */
  async openDirectConversation(otherUserId: string): Promise<string> {
    const res = await firstValueFrom(this.api.post<{ conversationId: string }>(
      '/api/chat/conversations/direct', { otherUserId }
    ));
    if (!res?.conversationId) throw new Error('Failed to open conversation.');
    await this.loadConversations();
    await this.openConversation(res.conversationId);
    return res.conversationId;
  }

  /** Create a group chat. Returns the conversation id. */
  async createGroup(name: string, memberIds: string[]): Promise<string> {
    const res = await firstValueFrom(this.api.post<{ conversationId: string }>(
      '/api/chat/conversations/group', { name, memberIds }
    ));
    if (!res?.conversationId) throw new Error('Failed to create group.');
    await this.loadConversations();
    await this.openConversation(res.conversationId);
    return res.conversationId;
  }

  async loadConversations(): Promise<void> {
    const res = await firstValueFrom(this.api.get<Conversation[]>(
      '/api/chat/conversations'
    ));
    this.conversations.set(res ?? []);
  }

  // ── Thread actions ──────────────────────────────────────────────────

  async openConversation(conversationId: string): Promise<void> {
    await this.connect();
    this.activeConversationId.set(conversationId);
    this.activeMessages.set([]);
    this.loadingHistory.set(true);
    try {
      const res = await firstValueFrom(this.api.get<ChatMessage[]>(
        `/api/chat/conversations/${conversationId}/messages?skip=0&take=50`
      ));
      this.activeMessages.set(res ?? []);

      // Tell the server we've read up to now; clears unread for the badge.
      try { await this.connection!.invoke('MarkConversationRead', conversationId); } catch { /* offline ok */ }
      this.conversations.update(list =>
        list.map(c => c.id === conversationId ? { ...c, unreadCount: 0 } : c)
      );
    } finally {
      this.loadingHistory.set(false);
    }
  }

  closeConversation(): void {
    this.activeConversationId.set(null);
    this.activeMessages.set([]);
  }

  async sendMessage(conversationId: string, body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) return;
    await this.connect();

    // Optimistic append — instant feedback, replaced when server echoes back.
    const me = this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic: ChatMessage = {
      id: tempId,
      conversationId,
      fromUserId: me,
      body: trimmed,
      sentAt: new Date().toISOString(),
      pending: true
    };
    if (this.activeConversationId() === conversationId) {
      this.activeMessages.update(list => [...list, optimistic]);
    }

    try {
      await this.connection!.invoke('SendMessage', conversationId, trimmed);
      // Server fires MessageReceived back — onMessageReceived reconciles the
      // pending entry. If it never arrives (timeout/error), the pending row
      // sticks; user can retry by re-sending.
    } catch (err) {
      // Mark the optimistic row as failed so the UI can show a retry affordance.
      this.activeMessages.update(list =>
        list.map(m => m.id === tempId ? { ...m, pending: false, body: m.body + ' (failed)' } : m)
      );
      throw err;
    }
  }

  /** Throttled typing broadcast. Caller should debounce to ~1Hz. */
  async setTyping(conversationId: string, isTyping: boolean): Promise<void> {
    await this.connect();
    try { await this.connection!.invoke('Typing', conversationId, isTyping); } catch { /* ignore */ }
  }

  // ── Server event handlers ───────────────────────────────────────────

  private onMessageReceived(m: ChatMessage) {
    const me = this.auth.user()?.authId ?? this.auth.user()?.id ?? '';

    // Reconcile optimistic pending row if this is my echoed message.
    if (m.fromUserId === me && this.activeConversationId() === m.conversationId) {
      let replaced = false;
      this.activeMessages.update(list => {
        const idx = list.findIndex(x => x.pending && x.body === m.body && x.fromUserId === me);
        if (idx >= 0) {
          replaced = true;
          const next = [...list]; next[idx] = m; return next;
        }
        return list;
      });
      if (replaced) {
        // Conversation summary still needs the last-message bump below.
      } else if (this.activeConversationId() === m.conversationId) {
        this.activeMessages.update(list => [...list, m]);
      }
    } else if (this.activeConversationId() === m.conversationId) {
      this.activeMessages.update(list => [...list, m]);
      // I'm reading this conversation — mark read so badge stays at 0.
      void this.connection?.invoke('MarkConversationRead', m.conversationId);
    }

    // Update / insert conversation summary.
    this.conversations.update(list => {
      const idx = list.findIndex(c => c.id === m.conversationId);
      const isToMe = m.fromUserId !== me;
      const incUnread = isToMe && this.activeConversationId() !== m.conversationId ? 1 : 0;
      if (idx >= 0) {
        const current = list[idx];
        const updated: Conversation = {
          ...current,
          lastMessage: { id: m.id, fromUserId: m.fromUserId, body: m.body, sentAt: m.sentAt },
          lastMessageAt: m.sentAt,
          unreadCount: current.unreadCount + incUnread
        };
        const next = [...list]; next.splice(idx, 1);
        return [updated, ...next];
      }
      // Message for a conversation we don't yet have in the list — refetch.
      void this.loadConversations();
      return list;
    });

    // Notification side-effect: a message from someone else, NOT in the
    // conversation I'm currently reading → audible ping + browser
    // Notification (if granted) + title-bar flash. Skipped for my own
    // echoes (so I don't ping myself on send).
    if (m.fromUserId !== me && this.activeConversationId() !== m.conversationId) {
      this.ringtone.playPing();
      const conv = this.conversations().find(c => c.id === m.conversationId);
      const senderName = conv?.participants.find(p => p.userId === m.fromUserId)?.displayName ?? 'New message';
      const title = conv?.isGroup && conv.name ? `${senderName} · ${conv.name}` : senderName;
      this.notify.notify(title, m.body, m.conversationId);
    }
  }

  private onMessageRead(p: { conversationId: string; userId: string; readAt: string }) {
    // Currently a no-op for the per-user "they've read up to" model; group
    // read receipts are a future enhancement. Kept as a hook so the
    // server-side broadcast doesn't error in the client logs.
    void p;
  }

  private onTyping(p: { conversationId: string; fromUserId: string; isTyping: boolean }) {
    const map = new Map(this.typingByConversation());
    const set = new Set(map.get(p.conversationId) ?? []);
    const key = `${p.conversationId}|${p.fromUserId}`;
    // Clear any existing auto-clear timer for this (conv, user) pair.
    const existingTimer = this.typingClearTimers.get(key);
    if (existingTimer) { clearTimeout(existingTimer); this.typingClearTimers.delete(key); }

    if (p.isTyping) {
      set.add(p.fromUserId);
      // Auto-clear after 3s of silence — matches HMS UX. If another
      // Typing(true) arrives, this timer is reset.
      const t = setTimeout(() => {
        const m2 = new Map(this.typingByConversation());
        const s2 = new Set(m2.get(p.conversationId) ?? []);
        s2.delete(p.fromUserId);
        if (s2.size === 0) m2.delete(p.conversationId); else m2.set(p.conversationId, s2);
        this.typingByConversation.set(m2);
        this.typingClearTimers.delete(key);
      }, 3000) as unknown as number;
      this.typingClearTimers.set(key, t);
    } else {
      set.delete(p.fromUserId);
    }
    if (set.size === 0) map.delete(p.conversationId); else map.set(p.conversationId, set);
    this.typingByConversation.set(map);
  }

  private onConversationUpdated(p: { conversationId: string; lastMessage: any; lastMessageAt: string }) {
    // ConversationUpdated is a lightweight refresh hint; MessageReceived
    // already does the heavy lifting (last-message + unread). Used today
    // only to bump lastMessageAt for conversations we're not actively
    // looking at — keeps the left rail in order without a full refetch.
    this.conversations.update(list => {
      const idx = list.findIndex(c => c.id === p.conversationId);
      if (idx < 0) return list;
      const updated = { ...list[idx], lastMessageAt: p.lastMessageAt };
      const next = [...list]; next.splice(idx, 1);
      return [updated, ...next];
    });
  }

  async disconnect(): Promise<void> {
    if (!this.connection) return;
    try { await this.connection.stop(); } catch { /* ignore */ }
    this.connection = null;
    this.isConnected.set(false);
  }

  ngOnDestroy(): void {
    for (const t of this.typingClearTimers.values()) clearTimeout(t);
    this.typingClearTimers.clear();
    void this.disconnect();
  }
}
