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

  @ViewChild('thread') private threadEl?: ElementRef<HTMLDivElement>;
  @ViewChild('composer') private composerEl?: ElementRef<HTMLTextAreaElement>;

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

  private lastTypingSent = 0;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly me = computed(() =>
    this.auth.user()?.authId ?? this.auth.user()?.id ?? ''
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
    // Auto-scroll to bottom whenever messages change or active thread switches.
    effect(() => {
      const _len = this.chat.activeMessages().length;
      const _id = this.chat.activeConversationId();
      queueMicrotask(() => {
        const pane = this.threadEl?.nativeElement;
        if (pane) pane.scrollTop = pane.scrollHeight;
      });
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

  // ── Thread actions ──────────────────────────────────────────────────

  protected async openThread(c: Conversation): Promise<void> {
    try { await this.chat.openConversation(c.id); }
    catch (err) { this.toasts.error((err as Error).message ?? 'Could not open chat.'); }
    queueMicrotask(() => this.composerEl?.nativeElement.focus());
  }

  protected async sendDraft(): Promise<void> {
    const body = this.draft().trim();
    const convId = this.chat.activeConversationId();
    if (!body || !convId) return;
    this.draft.set('');
    try {
      await this.chat.sendMessage(convId, body);
      void this.chat.setTyping(convId, false);
    } catch (err) {
      this.draft.set(body);
      this.toasts.error((err as Error).message ?? 'Could not send.');
    }
  }

  protected onComposerKeyDown(ev: KeyboardEvent): void {
    // Enter sends, Shift+Enter inserts newline — Teams parity.
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      void this.sendDraft();
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
