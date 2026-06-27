import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  ChangeDetectionStrategy, Component, ElementRef, OnInit, OnDestroy, ViewChild,
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
import { KeyboardService } from '../../core/services/keyboard.service';
import { NavBackService } from '../../core/services/nav-back.service';
import { CallLog, ChatMessage, Conversation } from '../../shared/models/chat.model';

interface DirectoryUser { id: string; displayName: string; email: string; isActive: boolean; }
interface PatientLite {
  id: string;
  firstName: string;
  fathersName: string;
  mrn?: string | null;
  phone?: string | null;
}
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
  imports: [CommonModule, FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './messages-page.component.html',
  styleUrls: ['./messages-page.component.scss']
})
export class MessagesPageComponent implements OnInit, OnDestroy {
  protected readonly chat = inject(ChatService);
  protected readonly signaling = inject(SignalingService);
  protected readonly webrtc = inject(WebrtcService);
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly chatNotify = inject(ChatNotifyService);
  protected readonly ringtone = inject(RingtoneService);
  /** Soft-keyboard visibility — drops the composer's nav-clearance padding so
   *  it sits right above the keyboard while typing (phone). */
  protected readonly kbd = inject(KeyboardService);
  /** Lets the edge-swipe / hardware back close the open thread instead of
   *  leaving /messages (the thread is signal-driven, not a route). */
  private readonly navBack = inject(NavBackService);
  private readonly closeThreadBack = (): boolean => {
    if (this.chat.activeConversationId()) { this.chat.closeConversation(); return true; }
    return false;
  };

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
  /** Touch toggle — on coarse pointers a tap on the bubble surfaces the
   *  action row instead of hover. Same signal so the template stays simple. */
  protected toggleBubbleActions(messageId: string): void {
    this.hoveredMessageId.set(this.hoveredMessageId() === messageId ? null : messageId);
  }
  /** True for coarse pointers (phones/tablets). Drives a few mobile
   *  affordances: tap-to-toggle bubble actions, larger composer height. */
  protected readonly isTouchDevice =
    typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
  protected readonly emojiOpen = signal(false);
  /** Phone composer "+" menu: collapses Attach / Patient / Emoji into one
   *  popover so the text box can be wider. */
  protected readonly composerMenuOpen = signal(false);
  protected toggleComposerMenu(): void { this.composerMenuOpen.set(!this.composerMenuOpen()); }
  /** Staged attachment: uploaded to server, waiting for the user to hit send. */
  protected readonly pendingAttachment = signal<{ url: string; name: string; contentType: string; size: number } | null>(null);
  protected readonly attachmentUploading = signal(false);

  // ── Mention autocomplete state ──────────────────────────────────────
  protected readonly mentionOpen = signal(false);
  protected readonly mentionQuery = signal('');
  protected readonly mentionAnchorPos = signal(0);
  /** Active mention-suggestion index for arrow-key navigation. */
  protected readonly mentionActiveIdx = signal(0);
  protected readonly mentionCandidates = computed(() => {
    const conv = this.chat.activeConversation();
    if (!conv) return [];
    const q = this.mentionQuery().toLowerCase();
    const me = this.me();
    return conv.participants
      .filter(p => p.userId !== me)
      .filter(p => !q || p.displayName.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 8);
  });

  // ── Pinned-strip + search + forward state ───────────────────────────
  protected readonly pinnedMessages = signal<ChatMessage[]>([]);
  protected readonly pinnedStripCollapsed = signal(false);
  protected readonly searchOpen = signal(false);
  protected readonly searchQuery = signal('');
  protected readonly searchResults = signal<ChatMessage[]>([]);
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  protected readonly forwardingMessage = signal<ChatMessage | null>(null);
  protected readonly forwardSearch = signal('');

  /** Share-record picker (currently patient-only; order/report could be
   *  added by extending sharePickerType). Opens a popover above the
   *  composer with a live search box. */
  protected readonly sharePickerOpen = signal(false);
  protected readonly sharePatientSearch = signal('');
  protected readonly sharePatientResults = signal<PatientLite[]>([]);
  protected readonly sharePatientLoading = signal(false);
  private sharePatientDebounce: ReturnType<typeof setTimeout> | null = null;

  /** Voice-message recording state. While recording, the composer shows
   *  an inline waveform-style indicator + elapsed time. Release to send. */
  protected readonly recording = signal(false);
  protected readonly recordElapsedMs = signal(0);
  private mediaRecorder: MediaRecorder | null = null;
  private recordChunks: Blob[] = [];
  private recordStartedAt = 0;
  private recordTimer: ReturnType<typeof setInterval> | null = null;
  private recordStream: MediaStream | null = null;
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

  /** Display name for a conversation: group name OR the other participant.
      For Notes-to-Self (1:1 where every participant is the current user),
      use the conversation's own name ("Notes to self") rather than falling
      back to "Unknown" — which is what happened because `find(p => p.userId
      !== me)` returns undefined when there's no other participant. */
  protected displayName(c: Conversation): string {
    if (c.isGroup) return c.name ?? 'Untitled group';
    const me = this.me();
    const other = c.participants.find(p => p.userId !== me);
    if (other) return other.displayName ?? 'Unknown';
    // No "other" → it's a notes-to-self conversation.
    return c.name ?? 'Notes to self';
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

  /**
   * Consecutive-message grouping (Teams/Slack pattern). Returns true when
   * the previous message in the list was sent by the same author within
   * 5 minutes AND neither row is a system/call row AND no day separator
   * is rendered between them. Used by the template to:
   *   - hide the author label on follow-up bubbles in a group
   *   - hide the per-bubble timestamp on all but the LAST in a run
   *   - tighten vertical spacing on follow-up bubbles
   */
  protected isGroupedWithPrev(idx: number): boolean {
    if (idx === 0) return false;
    const messages = this.chat.activeMessages();
    const prev = messages[idx - 1];
    const curr = messages[idx];
    if (!prev || !curr) return false;
    if ((prev.kind && prev.kind !== 'user') || (curr.kind && curr.kind !== 'user')) return false;
    if (prev.fromUserId !== curr.fromUserId) return false;
    // Day separator in between → new day, restart grouping.
    if (this.showDaySeparatorBefore(idx).show) return false;
    const dt = new Date(curr.sentAt).getTime() - new Date(prev.sentAt).getTime();
    return dt >= 0 && dt < 5 * 60 * 1000;
  }

  /** True when the NEXT message continues the current group → hide
   *  the current bubble's timestamp (it'll show on the last in the run). */
  protected isGroupedWithNext(idx: number): boolean {
    const messages = this.chat.activeMessages();
    if (idx >= messages.length - 1) return false;
    return this.isGroupedWithPrev(idx + 1);
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
    // Refresh pinned strip + reset search whenever active thread changes.
    effect(() => {
      const id = this.chat.activeConversationId();
      this.pinnedMessages.set([]);
      this.searchOpen.set(false);
      this.searchQuery.set('');
      this.searchResults.set([]);
      if (!id) return;
      void this.refreshPinned(id);
    });
    // Local fallback: keep pinned strip in sync with bubble pin toggles.
    effect(() => {
      const id = this.chat.activeConversationId();
      const messages = this.chat.activeMessages();
      if (!id) return;
      const pinned = messages.filter(m => m.isPinned && !m.deleted);
      // Only patch when our cached list disagrees — avoids infinite loop.
      const current = this.pinnedMessages();
      if (current.length !== pinned.length
          || current.some((c, i) => c.id !== pinned[i]?.id)) {
        // Merge: use the loaded messages where present, fall back to the
        // last server fetch for ids not in the active page (older pins).
        const ids = new Set(pinned.map(p => p.id));
        const fromServer = current.filter(c => !ids.has(c.id));
        this.pinnedMessages.set([...pinned, ...fromServer]);
      }
    });

    // WhatsApp-style immersive thread on phone: while a conversation is open,
    // hide the floating bottom-nav (the composer owns the bottom) by tagging
    // <html>. Shell + bottom-nav react to .pf-chat-immersive (phone-scoped CSS).
    effect(() => {
      const open = !!this.chat.activeConversationId();
      const phone = typeof window !== 'undefined'
        && window.matchMedia('(max-width: 640px)').matches;
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('pf-chat-immersive', open && phone);
      }
      // While a thread is open on phone, route edge-swipe / hardware back through
      // closeConversation() (the thread is a signal, not a route) so swiping back
      // returns to the conversation list instead of leaving /messages.
      if (open && phone) {
        this.navBack.registerBackInterceptor(this.closeThreadBack);
      } else {
        this.navBack.clearBackInterceptor(this.closeThreadBack);
      }
    });

    // Auto-grow the composer (single line → grows → caps → scrolls) whenever the
    // draft changes — covers typing AND programmatic resets (send/edit/cancel).
    effect(() => {
      this.draft();                                   // track
      queueMicrotask(() => this.autoGrowComposer());
    });
  }

  /** Resize the composer textarea to fit its content (WhatsApp-style):
   *  reset to auto, grow to scrollHeight capped at a max, scroll past the cap. */
  private autoGrowComposer(): void {
    const ta = this.composerEl?.nativeElement;
    if (!ta) return;
    const MAX = 140;   // matches the textarea's CSS max-height
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, MAX);
    ta.style.height = next + 'px';
    ta.style.overflowY = ta.scrollHeight > MAX ? 'auto' : 'hidden';
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('pf-chat-immersive');
    }
    this.navBack.clearBackInterceptor(this.closeThreadBack);
  }

  private async refreshPinned(conversationId: string): Promise<void> {
    try {
      const rows = await this.chat.getPinned(conversationId);
      this.pinnedMessages.set(rows);
    } catch { this.pinnedMessages.set([]); }
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
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    await this.handleIncomingFiles(files);
  }

  /**
   * Common pipeline for file batches: file-picker, drag-drop, and paste.
   * For 1 file: stage in the pending-attachment chip (user can add caption).
   * For N files: send each as its own message, sequentially. This avoids
   * the schema change a true multi-attachment column would need.
   */
  private async handleIncomingFiles(files: File[]): Promise<void> {
    const valid = files.filter(f => {
      if (f.size > 15 * 1024 * 1024) {
        this.toasts.error(`${f.name} is larger than 15 MB.`);
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;

    const convId = this.chat.activeConversationId();
    this.attachmentUploading.set(true);
    try {
      if (valid.length === 1) {
        // Single → stage as pending so the user can add a caption.
        const toUpload = await this.maybeCompressImage(valid[0]);
        const uploaded = await this.chat.uploadAttachment(toUpload);
        this.pendingAttachment.set(uploaded);
        queueMicrotask(() => this.composerEl?.nativeElement.focus());
      } else {
        if (!convId) return;
        // Multi → upload + send each. No caption is added to any of them;
        // first message includes any text already in the composer, the
        // rest are caption-less. Sequential to keep the order deterministic.
        const caption = this.draft().trim();
        this.draft.set('');
        for (let i = 0; i < valid.length; i++) {
          const toUpload = await this.maybeCompressImage(valid[i]);
          const uploaded = await this.chat.uploadAttachment(toUpload);
          await this.chat.sendMessage(convId, i === 0 ? caption : '', null, uploaded);
        }
      }
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Upload failed.');
    } finally { this.attachmentUploading.set(false); }
  }

  /** Paste handler — wired on the textarea. Grabs image data off the
   *  clipboard and routes it into the file pipeline. Falls through to
   *  default behaviour (text paste) when there's no image. */
  protected onComposerPaste(ev: ClipboardEvent): void {
    const items = ev.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    ev.preventDefault();
    void this.handleIncomingFiles(files);
  }

  /** Drag-drop handler — wired on the thread scroller. */
  protected onScrollerDragOver(ev: DragEvent): void {
    if (!ev.dataTransfer?.types.includes('Files')) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  }
  protected onScrollerDrop(ev: DragEvent): void {
    const files = Array.from(ev.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    ev.preventDefault();
    void this.handleIncomingFiles(files);
  }

  /**
   * Downscale a large image to 1600px on its long side and re-encode at
   * JPEG quality 0.85. Returns the original file unchanged for non-images,
   * very-small images (<300KB), or when the browser fails to decode.
   */
  private async maybeCompressImage(file: File): Promise<File> {
    if (!file.type.startsWith('image/')) return file;
    if (file.type === 'image/gif') return file;            // animation
    if (file.size < 300 * 1024) return file;               // already small
    const MAX_SIDE = 1600;
    try {
      const bitmap = await createImageBitmap(file);
      const longSide = Math.max(bitmap.width, bitmap.height);
      const scale = longSide > MAX_SIDE ? MAX_SIDE / longSide : 1;
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();
      const blob: Blob | null = await new Promise(resolve =>
        canvas.toBlob(b => resolve(b), 'image/jpeg', 0.85));
      if (!blob) return file;
      // Only use the compressed copy if it's actually smaller.
      if (blob.size >= file.size * 0.95) return file;
      const base = file.name.replace(/\.[^.]+$/, '');
      return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
    } catch { return file; }
  }

  protected clearAttachment(): void { this.pendingAttachment.set(null); }

  /** True for image MIME types — drives inline preview vs file-card render. */
  protected isImage(mime: string | null | undefined): boolean {
    return !!mime && mime.startsWith('image/');
  }

  /**
   * True when the bubble's only content is the image (no caption, no
   * reply chip). Drives the image-dominant render: image fills the
   * bubble, padding/border drop, timestamp floats over the image.
   */
  protected isImageDominant(m: { body: string; attachmentUrl?: string | null; attachmentMime?: string | null; replyPreview?: string | null }): boolean {
    return !!m.attachmentUrl
      && this.isImage(m.attachmentMime)
      && !m.body.trim()
      && !m.replyPreview;
  }

  /**
   * True when the bubble is 1–3 emoji characters with nothing else.
   * Renders WhatsApp/Telegram-style: 2x font size, no chrome.
   * Uses Intl.Segmenter to count user-perceived "emoji clusters"
   * correctly (compound emoji like 👨‍⚕️ count as one).
   */
  protected isEmojiOnly(m: { body: string; attachmentUrl?: string | null; replyPreview?: string | null }): boolean {
    if (m.attachmentUrl || m.replyPreview) return false;
    const body = m.body.trim();
    if (!body) return false;
    // Quick reject: contains any letter/digit → definitely not emoji-only.
    if (/[A-Za-z0-9]/.test(body)) return false;
    // Use Intl.Segmenter where available (modern Chrome/Safari/Firefox).
    if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
      const seg = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
      const clusters = [...seg.segment(body)] as Array<{ segment: string }>;
      // 1-3 grapheme clusters AND every cluster must be an emoji-like char.
      if (clusters.length === 0 || clusters.length > 3) return false;
      return clusters.every(c => /\p{Extended_Pictographic}/u.test(c.segment));
    }
    // Fallback: best-effort regex (won't perfectly handle compound emoji).
    const stripped = body.replace(/\s+/g, '');
    return stripped.length > 0 && stripped.length <= 8 && /^\p{Extended_Pictographic}+$/u.test(stripped);
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

  /** True for audio MIME types — drives voice-message bubble render. */
  protected isAudio(mime: string | null | undefined): boolean {
    return !!mime && mime.startsWith('audio/');
  }

  /** Deep-link for the thread-header context chip. */
  protected contextLink(c: { contextType?: string | null; contextId?: string | null }): any[] | null {
    if (!c.contextType || !c.contextId) return null;
    switch (c.contextType) {
      case 'patient': return ['/frontdesk', 'patients', c.contextId];
      case 'order':   return ['/lab', 'my-work'];   // no per-order route yet; closest landing
      case 'report':  return ['/reports', 'view', c.contextId];
      default: return null;
    }
  }

  // ── Shared-record cards (patient / order / report in a bubble) ──────

  /** Has *any* shared record? New generic field OR legacy report field. */
  protected hasSharedRecord(m: ChatMessage): boolean {
    return !!(m.sharedRecordType && m.sharedRecordId) || !!m.sharedReportId;
  }

  /** Normalised view of the shared record. Prefers the generic columns
   *  but falls back to legacy SharedReport* so old rows still render. */
  protected sharedRecord(m: ChatMessage): { type: 'patient' | 'order' | 'report'; id: string; title: string; subtitle: string } | null {
    if (m.sharedRecordType && m.sharedRecordId) {
      return {
        type: m.sharedRecordType,
        id: m.sharedRecordId,
        title: m.sharedRecordTitle ?? '(record)',
        subtitle: m.sharedRecordSubtitle ?? ''
      };
    }
    if (m.sharedReportId) {
      return {
        type: 'report',
        id: m.sharedReportId,
        title: m.sharedReportPatientName ?? 'Lab report',
        subtitle: m.sharedReportTestSummary ?? ''
      };
    }
    return null;
  }

  /** Router link target for a shared-record card. Matches contextLink. */
  protected sharedRecordLink(rec: { type: string; id: string }): any[] | null {
    switch (rec.type) {
      case 'patient': return ['/frontdesk', 'patients', rec.id];
      case 'order':   return ['/lab', 'my-work'];
      case 'report':  return ['/reports', 'view', rec.id];
      default: return null;
    }
  }
  protected sharedRecordEyebrow(type: string): string {
    return type === 'patient' ? 'Patient' : type === 'order' ? 'Order' : 'Lab report';
  }

  // ── Share-record popover (patient picker) ──────────────────────────

  protected toggleSharePicker(): void {
    const open = !this.sharePickerOpen();
    this.sharePickerOpen.set(open);
    if (open) {
      this.sharePatientSearch.set('');
      this.sharePatientResults.set([]);
      void this.searchPatients('');
    }
  }
  protected closeSharePicker(): void { this.sharePickerOpen.set(false); }

  protected onSharePatientInput(value: string): void {
    this.sharePatientSearch.set(value);
    if (this.sharePatientDebounce) clearTimeout(this.sharePatientDebounce);
    // Debounce 200ms so we don't hammer the search endpoint per keystroke.
    this.sharePatientDebounce = setTimeout(() => void this.searchPatients(value), 200);
  }

  private async searchPatients(q: string): Promise<void> {
    this.sharePatientLoading.set(true);
    try {
      const path = q.trim().length > 0
        ? `/api/patients?q=${encodeURIComponent(q.trim())}&limit=12`
        : '/api/patients?limit=12';
      const rows = await firstValueFrom(this.api.get<PatientLite[]>(path));
      this.sharePatientResults.set(rows ?? []);
    } catch { this.sharePatientResults.set([]); }
    finally { this.sharePatientLoading.set(false); }
  }

  /** Format a patient row's subtitle: MRN if present, else phone. */
  protected patientSubtitle(p: PatientLite): string {
    if (p.mrn) return p.mrn;
    if (p.phone) return `📞 ${p.phone}`;
    return '—';
  }
  protected patientName(p: PatientLite): string {
    const n = `${p.firstName ?? ''} ${p.fathersName ?? ''}`.trim();
    return n || '(unknown)';
  }

  protected async confirmSharePatient(p: PatientLite): Promise<void> {
    const convId = this.chat.activeConversationId();
    if (!convId) return;
    try {
      await this.chat.sharePatient(convId, p.id);
      this.closeSharePicker();
      this.toasts.info(`Shared ${this.patientName(p)}`);
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not share patient.');
    }
  }

  // ── Voice messages ──────────────────────────────────────────────────

  /**
   * Mic button: press to start recording, release (or click again) to
   * stop + send. Auto-stops at 60s. Permission prompt fires the first
   * time. Falls back gracefully if MediaRecorder is unsupported.
   */
  protected async toggleRecord(): Promise<void> {
    if (this.recording()) { this.stopRecording(true); return; }
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      this.toasts.error('Voice messages aren\'t supported on this browser.');
      return;
    }
    try {
      this.recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Prefer audio/webm with opus (Chrome/Firefox); Safari picks audio/mp4.
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
      this.mediaRecorder = mime
        ? new MediaRecorder(this.recordStream, { mimeType: mime })
        : new MediaRecorder(this.recordStream);
      this.recordChunks = [];
      this.mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) this.recordChunks.push(e.data);
      };
      this.mediaRecorder.onstop = () => void this.finalizeRecording();
      this.mediaRecorder.start();
      this.recordStartedAt = Date.now();
      this.recording.set(true);
      this.recordTimer = setInterval(() => {
        const elapsed = Date.now() - this.recordStartedAt;
        this.recordElapsedMs.set(elapsed);
        if (elapsed >= 60000) this.stopRecording(true); // hard cap at 60s
      }, 100);
    } catch (err) {
      this.toasts.error('Microphone permission denied.');
    }
  }

  protected cancelRecord(): void { this.stopRecording(false); }

  /** Stops the recorder. send=true → upload + queue as attachment;
   *  send=false → discard. */
  private stopRecording(send: boolean): void {
    if (!this.recording()) return;
    this.recording.set(false);
    if (this.recordTimer) { clearInterval(this.recordTimer); this.recordTimer = null; }
    try { this.mediaRecorder?.stop(); } catch { /* ignore */ }
    this.recordStream?.getTracks().forEach(t => t.stop());
    this.recordStream = null;
    if (!send) this.recordChunks = [];
  }

  /** After MediaRecorder fires onstop, upload + queue the voice clip. */
  private async finalizeRecording(): Promise<void> {
    if (this.recordChunks.length === 0) return;
    const durationSec = Math.max(1, Math.round((Date.now() - this.recordStartedAt) / 1000));
    const mime = this.mediaRecorder?.mimeType?.split(';')[0] ?? 'audio/webm';
    const ext = mime === 'audio/mp4' ? 'm4a' : 'webm';
    const blob = new Blob(this.recordChunks, { type: mime });
    this.recordChunks = [];
    const file = new File([blob], `voice-${durationSec}s.${ext}`, { type: mime });
    this.attachmentUploading.set(true);
    try {
      const uploaded = await this.chat.uploadAttachment(file);
      this.pendingAttachment.set(uploaded);
      // Auto-send: voice messages are usually meant to send immediately.
      await this.sendDraft();
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Voice upload failed.');
    } finally { this.attachmentUploading.set(false); }
  }

  protected formatRecordTime(): string {
    const ms = this.recordElapsedMs();
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
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

  protected async togglePin(messageId: string, currentlyPinned: boolean): Promise<void> {
    try { await this.chat.setPinned(messageId, !currentlyPinned); }
    catch (err) { this.toasts.error((err as Error).message ?? 'Could not pin/unpin.'); }
  }

  protected async addReaction(messageId: string, emoji: string): Promise<void> {
    try { await this.chat.toggleReaction(messageId, emoji); }
    catch (err) { this.toasts.error((err as Error).message ?? 'Could not react.'); }
  }

  /** Default reactions surfaced inline on every bubble hover. */
  protected readonly quickReactions = ['👍', '❤️', '😂', '🎉', '😢', '🙏'];

  /** True when I've already reacted with this emoji on a message. */
  protected didIReact(m: ChatMessage, emoji: string): boolean {
    const me = this.me();
    return !!m.reactions?.find(r => r.emoji === emoji)?.userIds.includes(me);
  }

  // ── Forward ─────────────────────────────────────────────────────────

  protected startForward(m: ChatMessage): void {
    this.forwardingMessage.set(m);
    this.forwardSearch.set('');
  }
  protected cancelForward(): void { this.forwardingMessage.set(null); }
  protected readonly forwardCandidates = computed(() => {
    const q = this.forwardSearch().toLowerCase().trim();
    const skipId = this.chat.activeConversationId();
    return this.chat.conversations()
      .filter(c => c.id !== skipId)
      .filter(c => !q || this.displayName(c).toLowerCase().includes(q));
  });
  protected async confirmForward(c: Conversation): Promise<void> {
    const m = this.forwardingMessage();
    if (!m) return;
    try {
      await this.chat.forwardMessage(c.id, m);
      this.toasts.info(`Forwarded to ${this.displayName(c)}`);
      this.cancelForward();
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not forward.');
    }
  }

  // ── Per-conversation mute ───────────────────────────────────────────

  protected async toggleConvMute(): Promise<void> {
    const conv = this.chat.activeConversation();
    if (!conv) return;
    try { await this.chat.setConversationMute(conv.id, !conv.isMuted); }
    catch (err) { this.toasts.error((err as Error).message ?? 'Could not update mute.'); }
  }

  // ── In-thread search ────────────────────────────────────────────────

  protected toggleSearch(): void {
    const open = !this.searchOpen();
    this.searchOpen.set(open);
    if (!open) { this.searchQuery.set(''); this.searchResults.set([]); }
  }
  protected onSearchInput(value: string): void {
    this.searchQuery.set(value);
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => void this.runSearch(), 200);
  }
  private async runSearch(): Promise<void> {
    const id = this.chat.activeConversationId();
    const q = this.searchQuery();
    if (!id || !q.trim()) { this.searchResults.set([]); return; }
    try { this.searchResults.set(await this.chat.searchConversation(id, q)); }
    catch { this.searchResults.set([]); }
  }
  protected jumpToSearchResult(m: ChatMessage): void {
    // Closing the search overlay; user scrolls to context themselves
    // (full message-jump-and-highlight is a future polish).
    this.searchOpen.set(false);
  }

  // ── Notes-to-self ───────────────────────────────────────────────────

  protected async openNotesToSelf(): Promise<void> {
    try { await this.chat.openNotesToSelf(); }
    catch (err) { this.toasts.error((err as Error).message ?? 'Could not open Notes.'); }
  }

  // ── Mention autocomplete ────────────────────────────────────────────

  /** Called from the composer (input). Detects an open '@…' token at
   *  caret and opens the suggestion popover. */
  protected detectMention(): void {
    const ta = this.composerEl?.nativeElement;
    if (!ta) return;
    const value = this.draft();
    const caret = ta.selectionStart ?? value.length;
    // Find the start of the @-token immediately before the caret.
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\w]*)$/);
    if (m) {
      this.mentionOpen.set(true);
      this.mentionQuery.set(m[1] ?? '');
      this.mentionAnchorPos.set(caret - (m[1].length + 1));
      this.mentionActiveIdx.set(0);
    } else {
      this.mentionOpen.set(false);
    }
  }

  /** Insert @<authId> at the mention anchor, replacing the typed query. */
  protected pickMention(p: { userId: string; displayName: string }): void {
    const ta = this.composerEl?.nativeElement;
    if (!ta) return;
    const value = this.draft();
    const anchor = this.mentionAnchorPos();
    const caret = ta.selectionStart ?? value.length;
    // Inserted token: '@<authId> ' (trailing space). The body stores the
    // AuthId GUID; the bubble renderer swaps it for the display name.
    const inserted = `@${p.userId} `;
    const next = value.slice(0, anchor) + inserted + value.slice(caret);
    this.draft.set(next);
    this.mentionOpen.set(false);
    queueMicrotask(() => {
      const newCaret = anchor + inserted.length;
      ta.focus();
      ta.setSelectionRange(newCaret, newCaret);
    });
  }

  /** Render a message body with @<authId> tokens replaced by names +
   *  highlight when I'm the mentioned user. Returns an HTML string;
   *  template uses [innerHTML] so we sanitise here.
   *
   *  Keep this fast — runs per bubble per render. */
  protected renderBodyHtml(m: ChatMessage): string {
    const conv = this.chat.activeConversation();
    if (!conv) return this.escapeHtml(m.body);
    const me = this.me();
    return this.escapeHtml(m.body).replace(
      /@([0-9a-fA-F-]{36})/g,
      (_full, id) => {
        const part = conv.participants.find(p => p.userId === id);
        const name = part?.displayName ?? '@user';
        const youCls = id === me ? ' pf-msgs__mention--you' : '';
        return `<span class="pf-msgs__mention${youCls}">@${this.escapeHtml(name)}</span>`;
      });
  }
  private escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]!));
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
