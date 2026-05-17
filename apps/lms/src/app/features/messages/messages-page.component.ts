import { CommonModule, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild,
  computed, effect, inject, signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { SignalingService } from '../../core/services/signaling.service';
import { WebrtcService } from '../../core/services/webrtc.service';
import { ToastService } from '../../core/services/toast.service';
import { ChatNotifyService } from '../../core/services/chat-notify.service';
import { RingtoneService } from '../../core/services/ringtone.service';
import { CallLog, Conversation } from '../../shared/models/chat.model';

interface DirectoryUser { id: string; displayName: string; email: string; isActive: boolean; }
type RailTab = 'chats' | 'calls';
type CallFilter = 'all' | 'missed';

/**
 * Teams-style messages page. Layout: left rail (search + conversation
 * list) + right pane (active thread with header / scroller / composer).
 * Includes a New Chat modal that doubles as a multi-select group picker.
 *
 * 1:1 vs group is a UX-level distinction; the data layer is uniformly
 * conversation-based (see ChatService + ConversationEntity). When the
 * picker has exactly one selection it creates/opens a direct chat;
 * with 2+ it prompts for a group name and creates a group.
 */
@Component({
  selector: 'app-messages-page',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './messages-page.component.html',
  styleUrls: ['./messages-page.component.scss']
})
export class MessagesPageComponent implements OnInit {
  protected readonly chat = inject(ChatService);
  protected readonly signaling = inject(SignalingService);
  protected readonly webrtc = inject(WebrtcService);
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly chatNotify = inject(ChatNotifyService);
  protected readonly ringtone = inject(RingtoneService);

  @ViewChild('thread') private threadEl?: ElementRef<HTMLDivElement>;
  @ViewChild('composer') private composerEl?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') private fileInputEl?: ElementRef<HTMLInputElement>;

  // ── Local state ────────────────────────────────────────────────────
  protected readonly activeTab = signal<RailTab>('chats');
  protected readonly callFilter = signal<CallFilter>('all');
  protected readonly searchTerm = signal('');
  protected readonly draft = signal('');
  protected readonly newChatOpen = signal(false);
  protected readonly directoryUsers = signal<DirectoryUser[]>([]);
  protected readonly pickerSelection = signal<Set<string>>(new Set());
  protected readonly groupNameDraft = signal('');
  protected readonly pickerSearch = signal('');
  protected readonly callLog = signal<CallLog[]>([]);
  protected readonly callLogLoading = signal(false);
  // Group members modal (Add / Remove / Leave).
  protected readonly membersOpen = signal(false);
  // Sub-modal for adding a new member — reuses the directory picker.
  protected readonly addMemberOpen = signal(false);
  protected readonly addMemberSearch = signal('');
  protected readonly addMemberBusy = signal(false);

  /** Reply / edit / hover-menu state on the composer. */
  protected readonly replyingTo = signal<{ id: string; preview: string; fromName: string } | null>(null);
  protected readonly editingMessageId = signal<string | null>(null);
  protected readonly hoveredMessageId = signal<string | null>(null);
  protected readonly emojiOpen = signal(false);
  /** Staged attachment: uploaded to server, waiting for the user to hit send. */
  protected readonly pendingAttachment = signal<{ url: string; name: string; contentType: string; size: number } | null>(null);
  protected readonly attachmentUploading = signal(false);
  /** Built-in emoji bank — no third-party dep. ~50 of the most common. */
  protected readonly emojiBank: string[] = [
    '👍','❤️','😂','🙏','🔥','🎉','😍','😊','👏','💯',
    '✅','❌','⚠️','💡','📌','📎','📝','🚀','💪','🤝',
    '😀','😅','😉','😎','🤔','🙄','😴','😢','😭','😱',
    '🥳','🤩','😇','🙃','😬','😏','🤗','🤯','😤','🤧',
    '🤒','🩺','💊','🧪','🔬','📊','📈','📉','💉','🧬'
  ];

  private lastTypingSent = 0;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Suspends the bottom-pinning effect for one cycle after we prepend
   * older messages. Without this, `effect()` sees activeMessages.length
   * change and snaps to the bottom — wiping the user's scroll position.
   */
  private suppressNextAutoScroll = false;

  protected readonly me = computed(() =>
    this.auth.user()?.authId ?? this.auth.user()?.id ?? ''
  );

  /**
   * "Reconnecting…" banner condition. Shown when either hub is
   * disconnected — both must be live for chat OR call to function.
   * Reconnects are silent (no toast), the banner just disappears.
   */
  protected readonly showReconnectBanner = computed(() =>
    !this.chat.isConnected() || !this.signaling.isConnected()
  );

  /** Filtered conversation list: matches against name + participant names. */
  protected readonly filteredConversations = computed<Conversation[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const all = this.chat.conversations();
    if (!term) return all;
    return all.filter(c => this.displayName(c).toLowerCase().includes(term));
  });

  /** Missed-call count — drives the small red dot on the Calls tab. */
  protected readonly missedCount = computed(() =>
    this.callLog().filter(c => this.isMissed(c)).length
  );

  /** Calls filtered by tab sub-filter (all vs missed). */
  protected readonly filteredCalls = computed<CallLog[]>(() => {
    const all = this.callLog();
    return this.callFilter() === 'missed' ? all.filter(c => this.isMissed(c)) : all;
  });

  /** A call is "missed" if it was an incoming ring I never picked up. */
  protected isMissed(c: CallLog): boolean {
    return c.direction === 'incoming' && (c.status === 'missed' || c.status === 'cancelled');
  }
  protected isRejected(c: CallLog): boolean {
    return c.status === 'rejected';
  }
  protected isAnswered(c: CallLog): boolean {
    return c.status === 'ended' || c.status === 'active';
  }
  /** Initials for a directory name — used in the calls list avatars. */
  protected nameInitials(name: string): string {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  /** Compact duration label — "0:42" or "12:05". Empty for unanswered. */
  protected formatDuration(seconds: number | null): string {
    if (!seconds || seconds < 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  protected callStatusLabel(c: CallLog): string {
    if (this.isMissed(c)) return c.direction === 'incoming' && c.status === 'missed' ? 'Missed call' : 'Cancelled';
    if (this.isRejected(c)) return c.direction === 'outgoing' ? 'Declined' : 'Rejected';
    if (this.isAnswered(c)) {
      const d = this.formatDuration(c.durationSeconds);
      return d ? (c.direction === 'incoming' ? `Incoming · ${d}` : `Outgoing · ${d}`) : 'Connected';
    }
    return c.direction === 'incoming' ? 'Incoming' : 'Outgoing';
  }

  /** Display name for a conversation: group name OR the other participant. */
  protected displayName(c: Conversation): string {
    if (c.isGroup) return c.name ?? 'Untitled group';
    const me = this.me();
    return c.participants.find(p => p.userId !== me)?.displayName ?? 'Unknown';
  }

  /** Initials for the avatar pill — group = first 2 chars, person = first+last. */
  protected initials(c: Conversation): string {
    const name = this.displayName(c);
    if (c.isGroup) return name.slice(0, 2).toUpperCase();
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /** Presence dot for 1:1 conversations — group rows show member count instead. */
  protected presenceFor(c: Conversation): string | null {
    if (c.isGroup) return null;
    const other = c.participants.find(p => p.userId !== this.me());
    if (!other) return null;
    return this.signaling.userPresences().get(other.userId) ?? 'offline';
  }

  /** Subline beneath name — last message preview or "No messages yet". */
  protected lastMessagePreview(c: Conversation): string {
    if (!c.lastMessage) return 'No messages yet';
    const body = c.lastMessage.body;
    const mine = c.lastMessage.fromUserId === this.me();
    return (mine ? 'You: ' : '') + (body.length > 60 ? body.slice(0, 60) + '…' : body);
  }

  /** True if the active thread is showing typing indicators from someone else. */
  protected readonly activeTypingNames = computed<string[]>(() => {
    const conv = this.chat.activeConversation();
    if (!conv) return [];
    const userIds = this.chat.typingByConversation().get(conv.id);
    if (!userIds || userIds.size === 0) return [];
    const me = this.me();
    return [...userIds]
      .filter(id => id !== me)
      .map(id => conv.participants.find(p => p.userId === id)?.displayName ?? 'Someone');
  });

  /**
   * Index (into activeMessages) of the LAST message I sent that's been
   * read by at least one other participant. Computed once per render
   * so the bubble template only renders the "Seen" line on that row.
   * Returns -1 if nothing applies.
   */
  protected readonly lastSeenMineIndex = computed<number>(() => {
    const me = this.me();
    const conv = this.chat.activeConversation();
    if (!conv) return -1;
    const receipts = this.chat.readReceipts().get(conv.id);
    if (!receipts || receipts.size === 0) return -1;
    const messages = this.chat.activeMessages();
    // Walk backwards — first match is the latest seen.
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.fromUserId !== me || m.pending) continue;
      // At least one other participant has read past m.sentAt?
      for (const [uid, ts] of receipts) {
        if (uid !== me && ts >= m.sentAt) return i;
      }
    }
    return -1;
  });

  /** "Seen" / "Seen by X" / "Seen by X +N" — depending on group size. */
  protected readReceiptLabel(messageIndex: number): string {
    if (messageIndex !== this.lastSeenMineIndex()) return '';
    const conv = this.chat.activeConversation();
    if (!conv) return '';
    const receipts = this.chat.readReceipts().get(conv.id);
    if (!receipts) return '';
    const me = this.me();
    const m = this.chat.activeMessages()[messageIndex];
    if (!m) return '';
    // Names of OTHER participants who've read past this message.
    const seenBy: string[] = [];
    for (const [uid, ts] of receipts) {
      if (uid === me || ts < m.sentAt) continue;
      const name = conv.participants.find(p => p.userId === uid)?.displayName;
      if (name) seenBy.push(name);
    }
    if (seenBy.length === 0) return '';
    if (!conv.isGroup) return 'Seen';
    if (seenBy.length === 1) return `Seen by ${seenBy[0]}`;
    if (seenBy.length === 2) return `Seen by ${seenBy[0]} and ${seenBy[1]}`;
    return `Seen by ${seenBy[0]} +${seenBy.length - 1}`;
  }

  protected showDaySeparatorBefore(idx: number): { show: boolean; label: string } {
    const list = this.chat.activeMessages();
    if (idx === 0) return { show: true, label: this.dayLabel(list[0]?.sentAt) };
    const prev = new Date(list[idx - 1].sentAt).toDateString();
    const curr = new Date(list[idx].sentAt).toDateString();
    return prev === curr ? { show: false, label: '' } : { show: true, label: this.dayLabel(list[idx].sentAt) };
  }

  private dayLabel(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(d); that.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - that.getTime()) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  constructor() {
    // Auto-scroll to bottom whenever messages change or active thread switches —
    // EXCEPT when the change came from a prepend (load-older). In that case
    // onScroll captured the offset and will restore it manually.
    effect(() => {
      const _len = this.chat.activeMessages().length;
      const _id = this.chat.activeConversationId();
      if (this.suppressNextAutoScroll) { this.suppressNextAutoScroll = false; return; }
      queueMicrotask(() => {
        const pane = this.threadEl?.nativeElement;
        if (pane) pane.scrollTop = pane.scrollHeight;
      });
    });
  }

  /**
   * Top-of-scroller trigger: when the user scrolls to within 80px of the
   * top, fetch the next older page. Preserves visual scroll position by
   * adding the new scrollHeight - old scrollHeight to scrollTop.
   */
  protected async onScrollerScroll(): Promise<void> {
    const pane = this.threadEl?.nativeElement;
    const convId = this.chat.activeConversationId();
    if (!pane || !convId) return;
    if (pane.scrollTop > 80) return;
    if (this.chat.loadingOlder() || !this.chat.hasMoreHistory()) return;
    const oldHeight = pane.scrollHeight;
    this.suppressNextAutoScroll = true;
    await this.chat.loadOlder(convId);
    queueMicrotask(() => {
      const delta = pane.scrollHeight - oldHeight;
      pane.scrollTop = delta;
    });
  }

  async ngOnInit(): Promise<void> {
    // Both hubs must be live before the page is usable.
    await Promise.all([
      this.chat.connect().catch(() => undefined),
      this.signaling.connect().catch(() => undefined)
    ]);
    await Promise.all([
      this.chat.loadConversations().catch(() => undefined),
      this.signaling.getOnlineUsersWithStatus().catch(() => undefined),
      this.loadCallLog().catch(() => undefined)
    ]);
    // Ask for Notification permission once. Landing on /messages counts
    // as the user-gesture browsers want before this prompt fires.
    void this.chatNotify.ensurePermission();
  }

  // ── Calls tab ───────────────────────────────────────────────────────

  protected switchTab(tab: RailTab): void {
    this.activeTab.set(tab);
    if (tab === 'calls') void this.loadCallLog();
  }

  protected setCallFilter(f: CallFilter): void { this.callFilter.set(f); }

  protected async loadCallLog(): Promise<void> {
    this.callLogLoading.set(true);
    try {
      const res = await firstValueFrom(this.api.get<CallLog[]>('/api/calls/recent?take=80'));
      this.callLog.set(res ?? []);
    } catch { /* swallow — empty state is fine */ }
    finally { this.callLogLoading.set(false); }
  }

  /**
   * Call back from a row in the Calls tab. For 1:1 we just re-ring the
   * peer. For group calls (no peerId), the row is informational — user
   * has to find the group in Chats to re-start. We disable the row in
   * that case.
   */
  protected async callBack(c: CallLog): Promise<void> {
    if (!c.peer.userId) return;
    try {
      await this.webrtc.startCall(c.peer.userId, 'calls_tab');
      this.toasts.info(`Ringing ${c.peer.displayName}…`);
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not start call.');
    }
  }

  /** Open the existing 1:1 thread (or create it) from a call-log row. */
  protected async openChatFromCall(c: CallLog): Promise<void> {
    if (!c.peer.userId) return;
    try {
      await this.chat.openDirectConversation(c.peer.userId);
      this.activeTab.set('chats');
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not open chat.');
    }
  }

  // ── Group members ───────────────────────────────────────────────────

  /** I created this group → I can remove others. Everyone can self-leave. */
  protected canManageMembers(): boolean {
    const conv = this.chat.activeConversation();
    return !!conv && conv.isGroup && conv.createdById === this.me();
  }

  protected openMembers(): void {
    if (!this.chat.activeConversation()?.isGroup) return;
    this.membersOpen.set(true);
  }
  protected closeMembers(): void { this.membersOpen.set(false); this.addMemberOpen.set(false); }

  protected async openAddMember(): Promise<void> {
    if (this.directoryUsers().length === 0) {
      try {
        const users = await firstValueFrom(this.api.get<DirectoryUser[]>('/api/directory/users'));
        const me = this.me();
        this.directoryUsers.set((users ?? []).filter(u => u.id !== me && u.isActive));
      } catch { this.toasts.error('Could not load directory.'); }
    }
    this.addMemberSearch.set('');
    this.addMemberOpen.set(true);
  }
  protected closeAddMember(): void { this.addMemberOpen.set(false); }

  /** Directory users not already in the group (and not me). */
  protected readonly addMemberCandidates = computed(() => {
    const conv = this.chat.activeConversation();
    const term = this.addMemberSearch().toLowerCase().trim();
    const memberIds = new Set(conv?.participants.map(p => p.userId) ?? []);
    return this.directoryUsers()
      .filter(u => !memberIds.has(u.id))
      .filter(u => !term || u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));
  });

  protected async addMember(userId: string): Promise<void> {
    const conv = this.chat.activeConversation();
    if (!conv) return;
    this.addMemberBusy.set(true);
    try {
      await this.chat.addMember(conv.id, userId);
      this.toasts.info('Member added.');
      this.closeAddMember();
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not add member.');
    } finally { this.addMemberBusy.set(false); }
  }

  protected async removeMember(userId: string): Promise<void> {
    const conv = this.chat.activeConversation();
    if (!conv) return;
    try {
      await this.chat.removeMember(conv.id, userId);
      this.toasts.info('Member removed.');
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not remove member.');
    }
  }

  protected async leaveGroup(): Promise<void> {
    const conv = this.chat.activeConversation();
    const me = this.me();
    if (!conv || !me) return;
    try {
      await this.chat.removeMember(conv.id, me);
      this.toasts.info('You left the group.');
      this.closeMembers();
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not leave group.');
    }
  }

  // ── Thread actions ──────────────────────────────────────────────────

  protected async openThread(c: Conversation): Promise<void> {
    try { await this.chat.openConversation(c.id); }
    catch (err) { this.toasts.error((err as Error).message ?? 'Could not open chat.'); }
    queueMicrotask(() => this.composerEl?.nativeElement.focus());
  }

  protected async sendDraft(): Promise<void> {
    const body = this.draft().trim();
    const convId = this.chat.activeConversationId();
    const att = this.pendingAttachment();
    // Need either a body or an attachment.
    if ((!body && !att) || !convId) return;
    const editId = this.editingMessageId();
    const reply = this.replyingTo();
    this.draft.set('');
    this.replyingTo.set(null);
    this.editingMessageId.set(null);
    this.pendingAttachment.set(null);
    try {
      if (editId) {
        await this.chat.editMessage(editId, body);
      } else {
        await this.chat.sendMessage(convId, body, reply?.id ?? null, att);
      }
      void this.chat.setTyping(convId, false);
    } catch (err) {
      this.draft.set(body);
      if (editId) this.editingMessageId.set(editId);
      if (reply) this.replyingTo.set(reply);
      if (att) this.pendingAttachment.set(att);
      this.toasts.error((err as Error).message ?? 'Could not send.');
    }
  }

  // ── Attachments ──────────────────────────────────────────────────────

  /** Open the hidden file input. */
  protected pickFile(): void { this.fileInputEl?.nativeElement.click(); }

  protected async onFileChosen(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset the input so the same file can be re-picked after removing it.
    input.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      this.toasts.error('File is larger than 15 MB.');
      return;
    }
    this.attachmentUploading.set(true);
    try {
      const uploaded = await this.chat.uploadAttachment(file);
      this.pendingAttachment.set(uploaded);
      queueMicrotask(() => this.composerEl?.nativeElement.focus());
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Upload failed.');
    } finally { this.attachmentUploading.set(false); }
  }

  protected clearAttachment(): void { this.pendingAttachment.set(null); }

  /** True for image MIME types — drives inline preview vs file-card render. */
  protected isImage(mime: string | null | undefined): boolean {
    return !!mime && mime.startsWith('image/');
  }

  /** "12.3 KB", "4.5 MB" — human-readable size. */
  protected formatSize(bytes: number | null | undefined): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /** Resolve a /uploads/... path against the API base. Absolute URLs (rare)
   *  pass through unchanged. */
  protected resolveAttachmentUrl(url: string | null | undefined): string {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    // Strip trailing /api or /api/ if env.apiUrl includes it; uploads live at root.
    const base = (this.api as any).baseUrl ?? '';
    return `${base}${url}`;
  }

  // ── Reply / edit / delete / emoji ────────────────────────────────────

  protected startReply(messageId: string): void {
    const m = this.chat.activeMessages().find(x => x.id === messageId);
    if (!m || m.deleted) return;
    const conv = this.chat.activeConversation();
    const fromName = m.fromUserId === this.me()
      ? 'yourself'
      : (conv?.participants.find(p => p.userId === m.fromUserId)?.displayName ?? 'Someone');
    const preview = m.body.length > 140 ? m.body.slice(0, 140) + '…' : m.body;
    this.replyingTo.set({ id: m.id, preview, fromName });
    this.editingMessageId.set(null);
    queueMicrotask(() => this.composerEl?.nativeElement.focus());
  }
  protected cancelReply(): void { this.replyingTo.set(null); }

  protected startEdit(messageId: string): void {
    const m = this.chat.activeMessages().find(x => x.id === messageId);
    if (!m || m.fromUserId !== this.me() || m.deleted) return;
    this.editingMessageId.set(messageId);
    this.replyingTo.set(null);
    this.draft.set(m.body);
    queueMicrotask(() => this.composerEl?.nativeElement.focus());
  }
  protected cancelEdit(): void { this.editingMessageId.set(null); this.draft.set(''); }

  protected async deleteOwnMessage(messageId: string): Promise<void> {
    try { await this.chat.deleteMessage(messageId); }
    catch (err) { this.toasts.error((err as Error).message ?? 'Could not delete message.'); }
  }

  protected toggleEmoji(): void { this.emojiOpen.set(!this.emojiOpen()); }
  protected insertEmoji(emoji: string): void {
    const ta = this.composerEl?.nativeElement;
    if (!ta) { this.draft.update(d => d + emoji); return; }
    const start = ta.selectionStart ?? this.draft().length;
    const end = ta.selectionEnd ?? start;
    const next = this.draft().slice(0, start) + emoji + this.draft().slice(end);
    this.draft.set(next);
    // Restore caret right after the inserted emoji.
    queueMicrotask(() => {
      ta.focus();
      const caret = start + emoji.length;
      ta.setSelectionRange(caret, caret);
    });
  }

  protected onComposerKeyDown(ev: KeyboardEvent): void {
    // Enter sends, Shift+Enter inserts newline — Teams parity.
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      void this.sendDraft();
      return;
    }
    if (ev.key === 'Escape') {
      if (this.editingMessageId()) { this.cancelEdit(); ev.preventDefault(); }
      else if (this.replyingTo()) { this.cancelReply(); ev.preventDefault(); }
    }
  }

  protected onComposerInput(): void {
    const convId = this.chat.activeConversationId();
    if (!convId) return;
    const now = Date.now();
    if (now - this.lastTypingSent > 2000) {
      this.lastTypingSent = now;
      void this.chat.setTyping(convId, true);
    }
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => {
      void this.chat.setTyping(convId, false);
      this.lastTypingSent = 0;
    }, 3000);
  }

  // ── Call from thread header ─────────────────────────────────────────

  protected async startCall(): Promise<void> {
    const conv = this.chat.activeConversation();
    if (!conv) return;
    try {
      if (conv.isGroup) {
        await this.webrtc.startGroupCall(conv.id);
        this.toasts.info(`Ringing ${conv.name ?? 'group'}…`);
      } else {
        const other = conv.participants.find(p => p.userId !== this.me());
        if (!other) return;
        if (!this.signaling.onlineUserIds().has(other.userId)) {
          this.toasts.info(`${other.displayName} is offline.`);
          return;
        }
        await this.webrtc.startCall(other.userId, 'messages');
        this.toasts.info(`Ringing ${other.displayName}…`);
      }
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not start call.');
    }
  }

  // ── New chat modal ──────────────────────────────────────────────────

  protected async openNewChatModal(): Promise<void> {
    this.newChatOpen.set(true);
    this.pickerSelection.set(new Set());
    this.groupNameDraft.set('');
    this.pickerSearch.set('');
    if (this.directoryUsers().length === 0) {
      try {
        const users = await firstValueFrom(this.api.get<DirectoryUser[]>('/api/directory/users'));
        const me = this.me();
        this.directoryUsers.set((users ?? []).filter(u => u.id !== me && u.isActive));
      } catch { this.toasts.error('Could not load directory.'); }
    }
  }

  protected closeNewChatModal(): void { this.newChatOpen.set(false); }

  protected togglePick(userId: string): void {
    const next = new Set(this.pickerSelection());
    if (next.has(userId)) next.delete(userId); else next.add(userId);
    this.pickerSelection.set(next);
  }

  protected readonly filteredPickerUsers = computed(() => {
    const term = this.pickerSearch().toLowerCase().trim();
    const all = this.directoryUsers();
    if (!term) return all;
    return all.filter(u => u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));
  });

  protected async confirmPicker(): Promise<void> {
    const selected = [...this.pickerSelection()];
    if (selected.length === 0) return;
    try {
      if (selected.length === 1) {
        await this.chat.openDirectConversation(selected[0]);
      } else {
        const name = this.groupNameDraft().trim();
        if (!name) { this.toasts.info('Group name is required.'); return; }
        await this.chat.createGroup(name, selected);
      }
      this.closeNewChatModal();
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Failed to create chat.');
    }
  }
}
