import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ChatMessage, Conversation } from '../../shared/models/chat.model';
import { ApiService } from './api.service';
import { LiveQueueService } from './live-queue.service';
import { RingtoneService } from './ringtone.service';
import { ChatNotifyService } from './chat-notify.service';
import { PlatformService } from './platform.service';
import { ToastService } from './toast.service';

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
  private readonly liveQueues = inject(LiveQueueService);
  private readonly api = inject(ApiService);
  private readonly ringtone = inject(RingtoneService);
  private readonly notify = inject(ChatNotifyService);
  private readonly platform = inject(PlatformService);
  private readonly toasts = inject(ToastService);
  private connection: signalR.HubConnection | null = null;
  private connecting: Promise<void> | null = null;
  private typingClearTimers = new Map<string, number>(); // convId|userId → setTimeout id

  readonly isConnected = signal(false);
  readonly conversations = signal<Conversation[]>([]);
  readonly activeConversationId = signal<string | null>(null);
  readonly activeMessages = signal<ChatMessage[]>([]);
  readonly typingByConversation = signal<Map<string, Set<string>>>(new Map());
  /**
   * Per-conversation per-user "I've read up to this time" map.
   *   readReceipts.get(convId)?.get(userId) → ISO timestamp
   * Populated from server MessageRead broadcasts. Drives the
   * "Seen / Seen by X" line under my own bubbles.
   */
  readonly readReceipts = signal<Map<string, Map<string, string>>>(new Map());
  /**
   * Per-conversation message store. The floating chat windows show
   * SEVERAL threads at once, so they can't share the single
   * `activeMessages` store the drawer / messages page use. Filled by
   * loadThread() and kept live by onMessageReceived().
   */
  readonly threads = signal<Map<string, ChatMessage[]>>(new Map());
  readonly loadingHistory = signal(false);
  /** True while older messages are being fetched (top of scroller). */
  readonly loadingOlder = signal(false);
  /** Set once a fetch returns <pageSize rows — there's nothing older. */
  readonly hasMoreHistory = signal<boolean>(true);
  /** Page size for both initial load and "load older". */
  private readonly pageSize = 50;

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
    // Work-queue invalidations ride this same pipe (see LiveQueueService).
    this.connection.on('QueueChanged', (e: { area?: string }) => this.liveQueues.push(e?.area ?? ''));
    // Business (bell-catalog) events ride the chat connection — see
    // onBusinessNotification for why this lives here and how each platform
    // surfaces it.
    this.connection.on('BusinessNotification',
      (p: { kind: string; title: string; body?: string | null; critical?: boolean }) =>
        this.onBusinessNotification(p));
    this.connection.on('MessageRead', (p: { conversationId: string; userId: string; readAt: string }) =>
      this.onMessageRead(p));
    this.connection.on('MessageEdited', (p: { id: string; conversationId: string; body: string; editedAt: string }) =>
      this.onMessageEdited(p));
    this.connection.on('MessageDeleted', (p: { id: string; conversationId: string }) =>
      this.onMessageDeleted(p));
    this.connection.on('MessagePinChanged',
      (p: { id: string; conversationId: string; isPinned: boolean }) => this.onMessagePinChanged(p));
    this.connection.on('MessageReactionChanged',
      (p: { id: string; conversationId: string; reactions: Array<{ emoji: string; userIds: string[] }> }) =>
        this.onMessageReactionChanged(p));
    this.connection.on('ConversationMuteChanged',
      (p: { conversationId: string; isMuted: boolean }) => this.onConversationMuteChanged(p));
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

  /**
   * Get-or-create a 1:1 conversation anchored to a clinical record
   * (patient / order / report). Same pair can have multiple context-
   * anchored threads — each (contextType, contextId) is its own thread.
   */
  async openConversationWithContext(
    otherUserId: string,
    contextType: 'patient' | 'order' | 'report',
    contextId: string,
    contextLabel: string
  ): Promise<string> {
    const res = await firstValueFrom(this.api.post<{ conversationId: string }>(
      '/api/chat/conversations/with-context',
      { otherUserId, contextType, contextId, contextLabel }
    ));
    if (!res?.conversationId) throw new Error('Failed to open conversation.');
    await this.loadConversations();
    await this.openConversation(res.conversationId);
    return res.conversationId;
  }

  /** Share a finalized report into an existing conversation. */
  async shareReport(conversationId: string, reportId: string): Promise<void> {
    await firstValueFrom(this.api.post<{ conversationId: string; messageId: string }>(
      `/api/chat/conversations/${conversationId}/share-report`,
      { reportId }
    ));
  }

  /** Share a patient profile into an existing conversation. */
  async sharePatient(conversationId: string, patientId: string): Promise<void> {
    await firstValueFrom(this.api.post<{ conversationId: string; messageId: string }>(
      `/api/chat/conversations/${conversationId}/share-patient`,
      { patientId }
    ));
  }

  /**
   * Convenience for "Send patient to <colleague>": gets-or-creates the
   * 1:1 conversation, shares the patient, opens the thread.
   *
   * When `contextLabel` is provided, the conversation is anchored to
   * the patient (separate from the general 1:1 thread between the two
   * users). The thread-header chip + context chip on /messages then
   * surfaces the anchor.
   */
  async sharePatientWithUser(otherUserId: string, patientId: string, contextLabel?: string): Promise<string> {
    const convId = contextLabel
      ? await this.openConversationWithContext(otherUserId, 'patient', patientId, contextLabel)
      : await this.openDirectConversation(otherUserId);
    await this.sharePatient(convId, patientId);
    return convId;
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

  // ── Group member management ─────────────────────────────────────────

  /** Add a member to a group conversation. Idempotent server-side. */
  async addMember(conversationId: string, userId: string): Promise<void> {
    await firstValueFrom(this.api.post(
      `/api/chat/conversations/${conversationId}/members`, { userId }
    ));
    await this.loadConversations();
  }

  /** Remove a member (creator privilege) OR leave (self). */
  async removeMember(conversationId: string, userId: string): Promise<void> {
    await firstValueFrom(this.api.delete(
      `/api/chat/conversations/${conversationId}/members/${userId}`
    ));
    // If I just left, drop the conversation from view.
    const me = this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
    if (userId === me) {
      this.conversations.update(list => list.filter(c => c.id !== conversationId));
      if (this.activeConversationId() === conversationId) this.closeConversation();
    } else {
      await this.loadConversations();
    }
  }

  // ── Thread actions ──────────────────────────────────────────────────

  async openConversation(conversationId: string): Promise<void> {
    await this.connect();
    this.activeConversationId.set(conversationId);
    this.activeMessages.set([]);
    this.hasMoreHistory.set(true);
    this.loadingHistory.set(true);
    try {
      const rows = await firstValueFrom(this.api.get<ChatMessage[]>(
        `/api/chat/conversations/${conversationId}/messages?skip=0&take=${this.pageSize}`
      )) ?? [];
      this.activeMessages.set(rows);
      // Fewer than a full page back = nothing older to fetch.
      if (rows.length < this.pageSize) this.hasMoreHistory.set(false);

      try { await this.connection!.invoke('MarkConversationRead', conversationId); } catch { /* offline ok */ }
      this.conversations.update(list =>
        list.map(c => c.id === conversationId ? { ...c, unreadCount: 0 } : c)
      );
    } finally {
      this.loadingHistory.set(false);
    }
  }

  /** Messages of one thread from the per-conversation store. */
  messagesFor(conversationId: string): ChatMessage[] {
    return this.threads().get(conversationId) ?? [];
  }

  private setThread(conversationId: string, rows: ChatMessage[]): void {
    this.threads.update(m => new Map(m).set(conversationId, rows));
  }

  /** Append (or reconcile an optimistic row) in the per-conversation store. */
  private pushToThread(conversationId: string, msg: ChatMessage, me: string): void {
    const map = this.threads();
    const rows = map.get(conversationId);
    if (!rows) return;                       // thread not open in a window
    const idx = msg.fromUserId === me
      ? rows.findIndex(x => x.pending && x.body === msg.body && x.fromUserId === me)
      : -1;
    const next = idx >= 0 ? rows.map((x, i) => i === idx ? msg : x) : [...rows, msg];
    this.setThread(conversationId, next);
  }

  /**
   * Load a thread into the per-conversation store WITHOUT hijacking the
   * single "active" conversation — this is what floating windows use, so
   * several threads stay live side by side. Also marks it read.
   */
  async loadThread(conversationId: string): Promise<void> {
    await this.connect();
    if (!this.threads().has(conversationId)) {
      const rows = await firstValueFrom(this.api.get<ChatMessage[]>(
        `/api/chat/conversations/${conversationId}/messages?skip=0&take=${this.pageSize}`
      )) ?? [];
      this.setThread(conversationId, rows);
    }
    try { await this.connection!.invoke('MarkConversationRead', conversationId); } catch { /* offline ok */ }
    this.conversations.update(list =>
      list.map(c => c.id === conversationId ? { ...c, unreadCount: 0 } : c)
    );
  }

  /** Drop a thread's cached messages (window closed for good). */
  forgetThread(conversationId: string): void {
    this.threads.update(m => { const next = new Map(m); next.delete(conversationId); return next; });
  }

  /**
   * Fetch the next page of older messages and prepend them. Caller is
   * responsible for preserving scroll position (capture scrollHeight
   * before, restore delta after — see messages-page.onScroll).
   *
   * Returns the number of rows prepended so the caller can early-out
   * if there were none.
   */
  async loadOlder(conversationId: string): Promise<number> {
    if (this.loadingOlder() || !this.hasMoreHistory()) return 0;
    if (this.activeConversationId() !== conversationId) return 0;
    this.loadingOlder.set(true);
    try {
      const skip = this.activeMessages().length;
      const rows = await firstValueFrom(this.api.get<ChatMessage[]>(
        `/api/chat/conversations/${conversationId}/messages?skip=${skip}&take=${this.pageSize}`
      )) ?? [];
      if (rows.length === 0) { this.hasMoreHistory.set(false); return 0; }
      if (rows.length < this.pageSize) this.hasMoreHistory.set(false);
      // API returns newest-last (chronological) for the requested page;
      // they're older than what's onscreen, so prepend.
      this.activeMessages.update(list => [...rows, ...list]);
      return rows.length;
    } finally {
      this.loadingOlder.set(false);
    }
  }

  closeConversation(): void {
    this.activeConversationId.set(null);
    this.activeMessages.set([]);
  }

  /** POST a file to /api/uploads/chat. Returns the server's metadata
   *  (url, name, mime, size) ready to pass to sendMessage. */
  async uploadAttachment(file: File): Promise<{ url: string; name: string; contentType: string; size: number }> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const res = await firstValueFrom(this.api.post<{ url: string; name: string; contentType: string; size: number }>(
      '/api/uploads/chat', fd
    ));
    if (!res?.url) throw new Error('Upload failed.');
    return res;
  }

  async sendMessage(
    conversationId: string,
    body: string,
    replyToMessageId?: string | null,
    attachment?: { url: string; name: string; contentType: string; size: number } | null
  ): Promise<void> {
    const trimmed = body.trim();
    // Body can be empty if an attachment is being sent (caption-less file share).
    if (!trimmed && !attachment) return;
    await this.connect();

    // Optimistic append — instant feedback, replaced when server echoes back.
    const me = this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // Resolve the quoted preview locally so the optimistic bubble already
    // shows the reply chip — server echo will overwrite with authoritative data.
    let replyPreview: string | null = null;
    let replyFromName: string | null = null;
    if (replyToMessageId) {
      const original = this.activeMessages().find(m => m.id === replyToMessageId);
      if (original) {
        replyPreview = original.body.length > 280 ? original.body.slice(0, 280) : original.body;
        const conv = this.conversations().find(c => c.id === conversationId);
        replyFromName = conv?.participants.find(p => p.userId === original.fromUserId)?.displayName ?? null;
      }
    }
    const optimistic: ChatMessage = {
      id: tempId,
      conversationId,
      fromUserId: me,
      body: trimmed,
      sentAt: new Date().toISOString(),
      replyToMessageId: replyToMessageId ?? null,
      replyPreview,
      replyFromName,
      attachmentUrl: attachment?.url ?? null,
      attachmentName: attachment?.name ?? null,
      attachmentMime: attachment?.contentType ?? null,
      attachmentSize: attachment?.size ?? null,
      pending: true
    };
    if (this.activeConversationId() === conversationId) {
      this.activeMessages.update(list => [...list, optimistic]);
    }
    // Same optimistic row for a floating window showing this thread.
    if (this.threads().has(conversationId)) {
      this.setThread(conversationId, [...this.messagesFor(conversationId), optimistic]);
    }

    try {
      await this.connection!.invoke(
        'SendMessage',
        conversationId,
        trimmed,
        replyToMessageId ?? null,
        attachment?.url ?? null,
        attachment?.name ?? null,
        attachment?.contentType ?? null,
        attachment?.size ?? null
      );
    } catch (err) {
      this.activeMessages.update(list =>
        list.map(m => m.id === tempId ? { ...m, pending: false, body: m.body + ' (failed)' } : m)
      );
      throw err;
    }
  }

  async editMessage(messageId: string, newBody: string): Promise<void> {
    const trimmed = newBody.trim();
    if (!trimmed) return;
    await this.connect();
    await this.connection!.invoke('EditMessage', messageId, trimmed);
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.connect();
    await this.connection!.invoke('DeleteMessage', messageId);
  }

  async setPinned(messageId: string, pinned: boolean): Promise<void> {
    await this.connect();
    await this.connection!.invoke('SetPinned', messageId, pinned);
  }

  async toggleReaction(messageId: string, emoji: string): Promise<void> {
    await this.connect();
    await this.connection!.invoke('ToggleReaction', messageId, emoji);
  }

  /** Per-conversation mute. Updates local state immediately + persists
   *  via the hub; server echoes back ConversationMuteChanged for other tabs. */
  async setConversationMute(conversationId: string, isMuted: boolean): Promise<void> {
    this.conversations.update(list =>
      list.map(c => c.id === conversationId ? { ...c, isMuted } : c));
    await this.connect();
    await this.connection!.invoke('SetConversationMute', conversationId, isMuted);
  }

  /** Get-or-create "Notes to self" — opens it as the active conversation. */
  async openNotesToSelf(): Promise<string> {
    const res = await firstValueFrom(this.api.post<{ conversationId: string }>(
      '/api/chat/conversations/notes-to-self', {}
    ));
    if (!res?.conversationId) throw new Error('Could not open Notes to self.');
    await this.loadConversations();
    await this.openConversation(res.conversationId);
    return res.conversationId;
  }

  /** Server-side search inside a single conversation. Substring match. */
  async searchConversation(conversationId: string, q: string): Promise<ChatMessage[]> {
    if (!q.trim()) return [];
    const res = await firstValueFrom(this.api.get<ChatMessage[]>(
      `/api/chat/conversations/${conversationId}/search?q=${encodeURIComponent(q.trim())}`
    ));
    return res ?? [];
  }

  /** Fetch the pinned-strip messages for a conversation. */
  async getPinned(conversationId: string): Promise<ChatMessage[]> {
    const res = await firstValueFrom(this.api.get<ChatMessage[]>(
      `/api/chat/conversations/${conversationId}/pinned`
    ));
    return res ?? [];
  }

  /** Forward an existing message into another conversation. */
  async forwardMessage(toConversationId: string, original: ChatMessage): Promise<void> {
    // Forward = re-send the body + attachment metadata. We don't carry
    // reactions/edits/replies forward — fresh send in the new thread.
    await this.sendMessage(toConversationId, original.body || '', null,
      original.attachmentUrl ? {
        url: original.attachmentUrl,
        name: original.attachmentName ?? 'forwarded',
        contentType: original.attachmentMime ?? 'application/octet-stream',
        size: original.attachmentSize ?? 0
      } : null);
  }

  /** Throttled typing broadcast. Caller should debounce to ~1Hz. */
  async setTyping(conversationId: string, isTyping: boolean): Promise<void> {
    await this.connect();
    try { await this.connection!.invoke('Typing', conversationId, isTyping); } catch { /* ignore */ }
  }

  // ── Server event handlers ───────────────────────────────────────────

  /**
   * A business notification (bell catalog) arrived over SignalR. The backend
   * broadcasts these alongside the DB bell row + APNs/FCM push, because
   * browser tabs and the Electron shell have no device-push channel — this
   * connection IS their delivery rail.
   *
   *  - every platform: poke the bell so its badge/list update live
   *  - browser/Electron, window hidden: OS notification (macOS Notification
   *    Center / Windows toast / web notification) via ChatNotifyService
   *  - browser/Electron, window visible: toast
   *  - iOS/Android (Capacitor): bell poke ONLY — the real push already
   *    delivers the banner/toast, so anything louder here would double up
   */
  private onBusinessNotification(
    p: { kind: string; title: string; body?: string | null; critical?: boolean }
  ): void {
    window.dispatchEvent(new CustomEvent('pf-notification-received'));
    if (this.platform.isCapacitor()) return;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (hidden) {
      this.notify.notifyBusiness(p.title, p.body ?? '');
    } else {
      this.toasts.info(p.body ? `${p.title} — ${p.body}` : p.title);
    }
  }

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

    // Mirror into the per-conversation store (floating chat windows).
    this.pushToThread(m.conversationId, m, me);

    // Update / insert conversation summary.
    this.conversations.update(list => {
      const idx = list.findIndex(c => c.id === m.conversationId);
      const isToMe = m.fromUserId !== me;
      const isUserKindSummary = !m.kind || m.kind === 'user';
      const incUnread = isToMe && isUserKindSummary && this.activeConversationId() !== m.conversationId ? 1 : 0;
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

    // Notification side-effect. Skipped for:
    //   - my own echoed sends
    //   - non-'user' kinds (system / call rows)
    //   - the conversation I'm currently reading
    //   - per-conversation mute, UNLESS I was @mentioned (mentions override)
    const isUserKind = !m.kind || m.kind === 'user';
    const conv = this.conversations().find(c => c.id === m.conversationId);
    const iAmMentioned = !!m.mentions && m.mentions.includes(me);
    const muted = !!conv?.isMuted && !iAmMentioned;
    if (isUserKind && m.fromUserId !== me
        && this.activeConversationId() !== m.conversationId
        && !muted) {
      this.ringtone.playPing();
      const senderName = conv?.participants.find(p => p.userId === m.fromUserId)?.displayName ?? 'New message';
      const title = conv?.isGroup && conv.name ? `${senderName} · ${conv.name}` : senderName;
      this.notify.notify(title, m.body, m.conversationId);
    }
  }

  private onMessagePinChanged(p: { id: string; conversationId: string; isPinned: boolean }) {
    if (this.activeConversationId() === p.conversationId) {
      this.activeMessages.update(list =>
        list.map(m => m.id === p.id ? { ...m, isPinned: p.isPinned } : m));
    }
  }

  private onMessageReactionChanged(p: { id: string; conversationId: string; reactions: Array<{ emoji: string; userIds: string[] }> }) {
    if (this.activeConversationId() === p.conversationId) {
      this.activeMessages.update(list =>
        list.map(m => m.id === p.id ? { ...m, reactions: p.reactions } : m));
    }
  }

  private onConversationMuteChanged(p: { conversationId: string; isMuted: boolean }) {
    this.conversations.update(list =>
      list.map(c => c.id === p.conversationId ? { ...c, isMuted: p.isMuted } : c));
  }

  private onMessageEdited(p: { id: string; conversationId: string; body: string; editedAt: string }) {
    if (this.activeConversationId() === p.conversationId) {
      this.activeMessages.update(list =>
        list.map(m => m.id === p.id ? { ...m, body: p.body, editedAt: p.editedAt } : m)
      );
    }
    this.conversations.update(list => list.map(c =>
      c.id === p.conversationId && c.lastMessage?.id === p.id
        ? { ...c, lastMessage: { ...c.lastMessage!, body: p.body } }
        : c
    ));
  }

  private onMessageDeleted(p: { id: string; conversationId: string }) {
    if (this.activeConversationId() === p.conversationId) {
      this.activeMessages.update(list =>
        list.map(m => m.id === p.id ? { ...m, deleted: true, body: '', replyPreview: null, replyFromName: null } : m)
      );
    }
    this.conversations.update(list => list.map(c =>
      c.id === p.conversationId && c.lastMessage?.id === p.id
        ? { ...c, lastMessage: { ...c.lastMessage!, body: '(message deleted)' } }
        : c
    ));
  }

  private onMessageRead(p: { conversationId: string; userId: string; readAt: string }) {
    // Update the per-conv per-user lastRead timestamp. Bubble templates
    // compare this against m.sentAt to decide whether to show "Seen".
    this.readReceipts.update(map => {
      const next = new Map(map);
      const inner = new Map(next.get(p.conversationId) ?? []);
      const existing = inner.get(p.userId);
      // Only advance forward; out-of-order broadcasts shouldn't regress.
      if (!existing || existing < p.readAt) inner.set(p.userId, p.readAt);
      next.set(p.conversationId, inner);
      return next;
    });
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

    // Clear all stateful signals on disconnect (logout)
    this.conversations.set([]);
    this.activeConversationId.set(null);
    this.activeMessages.set([]);
    this.typingByConversation.set(new Map());
    this.readReceipts.set(new Map());
    this.loadingHistory.set(false);
    this.loadingOlder.set(false);
    this.hasMoreHistory.set(true);

    for (const t of this.typingClearTimers.values()) clearTimeout(t);
    this.typingClearTimers.clear();
  }

  ngOnDestroy(): void {
    for (const t of this.typingClearTimers.values()) clearTimeout(t);
    this.typingClearTimers.clear();
    void this.disconnect();
  }
}
