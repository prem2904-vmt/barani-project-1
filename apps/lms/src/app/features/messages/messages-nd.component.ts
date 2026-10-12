import { ZoomSourceDirective } from '../../core/navigation/zoom.directive';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewChild,
  computed, effect, inject, signal, untracked
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MessagesPageComponent } from './messages-page.component';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { PresenceDotComponent } from '../../shared/components/presence-avatar/presence-avatar.component';
import { ModalPortalDirective } from '../../shared/directives/modal-portal.directive';
import { CallLog, ChatMessage, Conversation } from '../../shared/models/chat.model';
import { ApiError } from '../../shared/models/api-response.model';
import { SkeletonRowsComponent } from '../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../shared/directives/busy.directive';

/** The band pill's filter segment. `calls` swaps the list for the call log. */
export type MsgFilter = 'all' | 'unread' | 'groups' | 'calls';

interface DirectoryPerson { id: string; displayName: string; email: string; isActive: boolean; }

/** A reactive media query: the current match + a live listener, cleaned up
 *  with the owner. Safe where matchMedia is missing (SSR / old engines). */
function mq(query: string, ref: DestroyRef, on: (m: boolean) => void): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const m = window.matchMedia(query);
  const fn = (e: MediaQueryListEvent) => on(e.matches);
  try { m.addEventListener?.('change', fn); ref.onDestroy(() => m.removeEventListener?.('change', fn)); } catch { /* old engines */ }
  return !!m.matches;
}

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

/**
 * MESSAGES — the new-design screen (docs/PF-PATTERN.md §17).
 *
 * Same behaviour as the classic page (it EXTENDS it: realtime, unread,
 * typing, receipts, attachments, voice notes, calls, deep links, modals),
 * laid out on the pf-kit:
 *
 *   band  ‹ tenant                              [Reconnecting] [sounds] [New chat]
 *   pill  [search conversations and people]  | All · Unread · Groups · Calls
 *   ┌ CONVERSATIONS (left, collapsible) ┐ ┌ THREAD (main) ───────────────────┐
 *   │ rows: avatar · name · preview     │ │ head: name + status · quiet icons │
 *   │       time · unread chip          │ │ bubbles (scroll)                  │
 *   └───────────────────────────────────┘ │ composer: attach · [text  mic] ▶ │
 *                                         └───────────────────────────────────┘
 *
 * ≤900px: one pane at a time — the list fills the body, tapping a row
 * PUSHES the thread (slide), the band's back chevron pops it. The bottom
 * navbar is never hidden (no html.pf-chat-immersive here).
 */
@Component({
  selector: 'pf-messages-nd',
  standalone: true,
  imports: [BusyDirective, SkeletonRowsComponent, CommonModule, FormsModule, DatePipe, RouterLink, ModalPortalDirective, HeroBandComponent, ZoomSourceDirective, PresenceDotComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './messages-nd.component.html',
  styleUrls: ['./messages-nd.component.scss']
})
export class MessagesNdComponent extends MessagesPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly hostEl: ElementRef<HTMLElement> = inject(ElementRef);

  @ViewChild('sendBtn') private sendBtnEl?: ElementRef<HTMLButtonElement>;

  // ── Overrides of the classic page ────────────────────────────────────
  /** The navbar is ALWAYS visible in the new design. */
  protected override hidesNavInThread(): boolean { return false; }
  /** Voice notes preview before sending (chat-windows contract). */
  protected override voicePreviewBeforeSend(): boolean { return true; }
  /** Stop → focus Send, so Enter sends the previewed clip. */
  protected override onVoiceDraftReady(): void {
    this.voicePlaying.set(false);
    this.voicePos.set(0);
    setTimeout(() => this.sendBtnEl?.nativeElement.focus(), 60);
  }

  // ── Layout state ─────────────────────────────────────────────────────
  /** ≤900px: one pane at a time (list OR thread), push navigation. */
  protected readonly narrow = signal(mq('(max-width: 900px)', this.destroyRef, m => this.narrow?.set(m)));
  /** Which pane a narrow screen shows. */
  protected readonly pane = computed<'list' | 'thread'>(() =>
    this.chat.activeConversationId() ? 'thread' : 'list');
  /** Slide direction for the narrow push (step → step = slide). */
  protected readonly pushDir = signal<'forward' | 'back' | null>(null);
  private lastRowTap = 0;

  /** The CONVERSATIONS card collapsed to a strip (desktop), per user. */
  protected readonly sideCollapsed = signal(readFlag(this.collapseKey()));
  protected toggleSide(): void {
    const next = !this.sideCollapsed();
    this.sideCollapsed.set(next);
    try { localStorage.setItem(this.collapseKey(), next ? '1' : '0'); } catch { /* private mode */ }
  }
  private collapseKey(): string {
    let uid = '';
    try { uid = this.auth.user()?.id ?? ''; } catch { /* no session */ }
    return 'pf:msgs:list-collapsed:' + (uid || 'anon');
  }

  /** Back chevron: on a narrow screen with a thread open it pops the thread;
   *  otherwise the band's normal history back. */
  protected readonly closeThreadFn = (): void => this.closeThread();
  protected readonly bandBack = computed(() =>
    this.narrow() && this.pane() === 'thread' ? this.closeThreadFn : null);

  protected closeThread(): void {
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.chat.closeConversation();
  }

  // ── Band pill: search + filter ───────────────────────────────────────
  protected readonly filter = signal<MsgFilter>('all');
  protected readonly filters: ReadonlyArray<{ key: MsgFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'groups', label: 'Groups' },
    { key: 'calls', label: 'Calls' },
  ];
  protected setFilter(f: MsgFilter): void {
    this.filter.set(f);
    this.switchTab(f === 'calls' ? 'calls' : 'chats');
  }
  /** Arrow keys move within the radio group (one Tab stop). */
  protected onFilterKey(ev: KeyboardEvent): void {
    const keys = this.filters.map(f => f.key);
    const i = keys.indexOf(this.filter());
    let next = i;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (i + 1) % keys.length;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (i - 1 + keys.length) % keys.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = keys.length - 1;
    else return;
    ev.preventDefault();
    this.setFilter(keys[next]);
    queueMicrotask(() => {
      const btn = this.hostEl.nativeElement.querySelector<HTMLElement>(`[data-filter="${keys[next]}"]`);
      btn?.focus();
    });
  }

  /** Band search: conversations (name + every participant) and people. */
  protected onBandSearch(v: string): void {
    this.searchTerm.set(v);
    if (v.trim()) void this.ensureDirectory();
  }
  /** Phone thread: the pill is the in-conversation search. */
  protected onThreadSearch(v: string): void {
    if (!this.searchOpen()) this.searchOpen.set(true);
    this.onSearchInput(v);
  }

  protected readonly listConversations = computed<Conversation[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const f = this.filter();
    return this.chat.conversations().filter(c => {
      if (f === 'unread' && !(c.unreadCount > 0)) return false;
      if (f === 'groups' && !c.isGroup) return false;
      if (!term) return true;
      if (this.displayName(c).toLowerCase().includes(term)) return true;
      return c.participants.some(p => (p.displayName ?? '').toLowerCase().includes(term)
        || (p.email ?? '').toLowerCase().includes(term));
    });
  });

  /** People matching the search who don't already have a 1:1 here — a tap
   *  opens (or creates) the direct chat. */
  protected readonly peopleMatches = computed<DirectoryPerson[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    if (!term || this.filter() === 'calls' || this.filter() === 'groups') return [];
    const me = this.me();
    const direct = new Set(this.chat.conversations()
      .filter(c => !c.isGroup)
      .flatMap(c => c.participants.map(p => p.userId))
      .filter(id => id !== me));
    return this.directoryUsers()
      .filter(u => !direct.has(u.id))
      .filter(u => u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
      .slice(0, 12);
  });

  protected readonly callsList = computed<CallLog[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const rows = this.filteredCalls();
    return term ? rows.filter(c => c.peer.displayName.toLowerCase().includes(term)) : rows;
  });

  private directoryLoading = false;
  private async ensureDirectory(): Promise<void> {
    if (this.directoryUsers().length > 0 || this.directoryLoading) return;
    this.directoryLoading = true;
    try {
      const users = await firstValueFrom(this.api.get<DirectoryPerson[]>('/api/directory/users'));
      const me = this.me();
      this.directoryUsers.set((users ?? []).filter(u => u.id !== me && u.isActive));
    } catch { /* people search just stays empty */ }
    finally { this.directoryLoading = false; }
  }

  // ── Rows ─────────────────────────────────────────────────────────────
  /** A row tap: open the thread (narrow: push it with a slide). */
  protected async openRow(c: Conversation): Promise<void> {
    this.lastRowTap = Date.now();
    await this.openThread(c);
  }

  protected async openPerson(u: DirectoryPerson): Promise<void> {
    this.lastRowTap = Date.now();
    try {
      await this.chat.openDirectConversation(u.id);
      this.searchTerm.set('');
    } catch (err) { this.toasts.error(ApiError.from(err).message); }
  }

  protected async openNotes(): Promise<void> {
    this.lastRowTap = Date.now();
    await this.openNotesToSelf();
  }

  /** What the last message was — drives the SVG kind icon (never emoji). */
  protected previewKind(c: Conversation): 'none' | 'text' | 'attachment' | 'deleted' {
    const m = c.lastMessage;
    if (!m) return 'none';
    if (m.body === '(message deleted)') return 'deleted';
    if (!m.body.trim()) return 'attachment';
    return 'text';
  }
  /** The preview line, WITHOUT a cut in code (CSS ellipsis on one row). */
  protected previewText(c: Conversation): string {
    const m = c.lastMessage;
    if (!m) return 'No messages yet';
    const kind = this.previewKind(c);
    const body = kind === 'attachment' ? 'Attachment' : kind === 'deleted' ? 'Message deleted'
      : this.plainBody(m.body, c);
    return body;
  }
  protected previewMine(c: Conversation): boolean {
    return !!c.lastMessage && c.lastMessage.fromUserId === this.me();
  }
  /** @<authId> mention tokens → @Name for plain-text previews. */
  private plainBody(body: string, c: Conversation): string {
    return body.replace(/@([0-9a-fA-F-]{36})/g, (_f, id) =>
      '@' + (c.participants.find(p => p.userId === id)?.displayName ?? 'user'));
  }

  /** Row time: today → clock time, this week → weekday, else a short date. */
  protected rowTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(d); that.setHours(0, 0, 0, 0);
    const days = Math.round((today.getTime() - that.getTime()) / 86400000);
    if (days <= 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  /** Presence → a calm dot: violet reachable, slate busy/away, muted red
   *  when calls are blocked, hollow offline. */
  protected presenceTone(p: string): 'on' | 'busy' | 'dnd' | 'off' {
    if (p === 'active' || p === 'available') return 'on';
    if (p === 'offline') return 'off';
    if (p === 'in-a-call' || p === 'dnd' || p === 'surgery') return 'dnd';
    return 'busy';
  }

  // ── Thread ───────────────────────────────────────────────────────────
  protected authorName(conv: Conversation, userId: string): string {
    return conv.participants.find(p => p.userId === userId)?.displayName ?? 'Unknown';
  }

  /** Mine + read by someone at/after it → the violet double check. */
  protected isSeen(i: number): boolean {
    const last = this.lastSeenMineIndex();
    return last >= 0 && i <= last;
  }

  /** Messages that arrived / were sent WHILE the thread is open fade + slide
   *  in; history (initial load and older pages) never animates. */
  protected readonly freshIds = signal<ReadonlySet<string>>(new Set());
  private tailConv: string | null = null;
  private tailId: string | null = null;
  private settled = false;

  // ── Voice-note preview + players ─────────────────────────────────────
  protected readonly voicePlaying = signal(false);
  protected readonly voicePos = signal(0);
  protected toggleVoicePreview(aud: HTMLAudioElement): void {
    if (aud.paused) { void aud.play(); this.voicePlaying.set(true); }
    else { aud.pause(); this.voicePlaying.set(false); }
  }
  protected discardVoice(): void {
    this.discardVoiceDraft();
    this.voicePlaying.set(false);
    this.voicePos.set(0);
  }

  /** Received / sent voice notes: one plays at a time. */
  protected readonly audioId = signal<string | null>(null);
  protected readonly audioPos = signal(0);
  protected readonly audioDur = signal(0);
  protected toggleAudio(aud: HTMLAudioElement, id: string): void {
    if (this.audioId() === id && !aud.paused) { aud.pause(); this.audioId.set(null); return; }
    this.hostEl.nativeElement.querySelectorAll<HTMLAudioElement>('audio.pf-mnd-voice__el')
      .forEach(a => { if (a !== aud) a.pause(); });
    this.audioId.set(id);
    this.audioPos.set(aud.currentTime || 0);
    void aud.play();
  }
  protected onAudioTime(aud: HTMLAudioElement, id: string): void {
    if (this.audioId() !== id) return;
    this.audioPos.set(aud.currentTime);
    if (isFinite(aud.duration) && aud.duration > 0) this.audioDur.set(aud.duration);
  }
  protected onAudioEnded(id: string): void {
    if (this.audioId() === id) { this.audioId.set(null); this.audioPos.set(0); }
  }
  /** Seconds of a voice note from its file name ("voice-12s.webm"). */
  protected voiceSecs(m: ChatMessage): number {
    const hit = /voice-(\d+)s\./.exec(m.attachmentName ?? '');
    return hit ? Number(hit[1]) : 0;
  }
  protected voiceProgress(m: ChatMessage): number {
    if (this.audioId() !== m.id) return 0;
    const total = this.audioDur() || this.voiceSecs(m);
    return total > 0 ? Math.min(100, (this.audioPos() / total) * 100) : 0;
  }
  protected fmtSecs(v: number): string {
    const t = Math.max(0, Math.floor(v || 0));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  // ── Composer ─────────────────────────────────────────────────────────
  protected readonly attachMenuOpen = signal(false);
  protected toggleAttachMenu(): void { this.attachMenuOpen.set(!this.attachMenuOpen()); }

  protected canSend(): boolean {
    return !this.recording() && !this.attachmentUploading()
      && (!!this.draft().trim() || !!this.pendingAttachment() || !!this.voiceDraft());
  }

  /** Enter on the field while a voice preview is up sends it. */
  protected onFieldKey(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey && this.voiceDraft()) {
      ev.preventDefault();
      void this.sendDraft();
    }
  }

  protected shareSub(p: { mrn?: string | null; phone?: string | null }): string {
    return p.mrn || p.phone || '';
  }

  constructor() {
    super();
    // Narrow push direction: a row tap slides the thread in; closing slides
    // the list back. Deep links (?c=…) and restores open instantly.
    let wasOpen = false;
    effect(() => {
      const open = !!this.chat.activeConversationId();
      untracked(() => {
        if (open && !wasOpen) this.pushDir.set(Date.now() - this.lastRowTap < 1500 ? 'forward' : null);
        else if (!open && wasOpen) {
          this.pushDir.set('back');
          this.discardVoice();
          this.attachMenuOpen.set(false);
        }
        wasOpen = open;
      });
    });
    // Fresh-message tracking (fade + slide in for NEW bubbles only).
    effect(() => {
      const conv = this.chat.activeConversationId();
      const msgs = this.chat.activeMessages();
      const loading = this.chat.loadingHistory();
      untracked(() => {
        if (conv !== this.tailConv) {
          this.tailConv = conv; this.settled = false; this.freshIds.set(new Set());
        }
        const last = msgs.length ? msgs[msgs.length - 1].id : null;
        if (loading || !this.settled) {
          if (!loading && conv) this.settled = true;
          this.tailId = last;
          return;
        }
        const idx = this.tailId ? msgs.findIndex(m => m.id === this.tailId) : -1;
        const added = idx >= 0 ? msgs.slice(idx + 1) : (this.tailId ? [] : msgs);
        this.tailId = last;
        if (!added.length) return;
        const next = new Set(this.freshIds());
        added.forEach(m => next.add(m.id));
        this.freshIds.set(next);
      });
    });
  }
}
