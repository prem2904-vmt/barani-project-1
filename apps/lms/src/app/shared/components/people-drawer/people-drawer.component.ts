import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { PeopleDrawerService } from '../../../core/services/people-drawer.service';
import { PresenceService } from '../../../core/services/presence.service';
import { isPresenceKey, presenceLabel as presetLabel } from '../../models/presence.model';
import { SignalingService } from '../../../core/services/signaling.service';
import { CallReachService } from '../../../core/services/call-reach.service';
import { ToastService } from '../../../core/services/toast.service';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { User, userDisplayName } from '../../models/user.model';
import { AvatarComponent } from '../../primitives/avatar.component';
import { SkeletonRowsComponent } from '../../primitives/skeleton-kit.component';

/**
 * Global People drawer — slide-out from the right edge. Shows every active
 * user in the tenant with their live presence dot + unread chat badge.
 *
 * Two modes:
 *   - "list" (default) — every tenant user, grouped by presence.
 *   - "chat" — message thread with a specific user, with call button.
 *
 * Tenant scope is enforced server-side at every layer (chat hub,
 * /api/users, signaling hub) so this component never has to filter.
 */
@Component({
  selector: 'pf-people-drawer',
  standalone: true,
  imports: [SkeletonRowsComponent, FormsModule, DatePipe, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="pf-pd-backdrop" (click)="close()"></div>
      <aside class="pf-pd" role="dialog" aria-label="People">
        <header class="pf-pd__hdr">
          @if (mode() === 'chat' && otherUser(); as ou) {
            <button type="button" class="pf-pd__icon-btn" (click)="backToList()" aria-label="Back to people list">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 18-6-6 6-6"/>
              </svg>
            </button>
            <pf-avatar [name]="ou.displayName" [size]="36"></pf-avatar>
            <div class="pf-pd__chat-id">
              <p class="pf-pd__chat-name">{{ ou.displayName }}</p>
              <p class="pf-pd__chat-status">
                <span class="pf-pd__dot" [attr.data-status]="presence(ou.id)"></span>
                {{ presenceLabel(presence(ou.id)) }}
              </p>
            </div>
            <button type="button" class="pf-pd__call-btn"
                    [disabled]="webrtc.inCall()"
                    [title]="webrtc.inCall() ? 'You are already in a call' : reach.hint(ou.id)"
                    (click)="callActive()" aria-label="Voice call">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>
              </svg>
            </button>
          } @else {
            <h2 class="pf-pd__title">People</h2>
            <span class="pf-pd__count">{{ activeUsers().length }} · {{ onlineCount() }} online</span>
          }
          <button type="button" class="pf-pd__icon-btn pf-pd__close" (click)="close()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </header>

        @if (mode() === 'list') {
          <div class="pf-pd__search">
            <input type="search" placeholder="Search people…"
                   [(ngModel)]="search" (ngModelChange)="search.set($event)" />
          </div>

          <div class="pf-pd__list" role="list">
            @for (group of groupedUsers(); track group.key) {
              <p class="pf-pd__group-label">{{ group.label }}</p>
              @for (u of group.users; track u.id) {
                <button type="button" class="pf-pd__row" role="listitem"
                        (click)="openChat(u)">
                  <div class="pf-pd__row-av">
                    <pf-avatar [name]="u.displayName" [size]="36"></pf-avatar>
                    <span class="pf-pd__row-dot" [attr.data-status]="presence(u.id)"></span>
                  </div>
                  <div class="pf-pd__row-body">
                    <p class="pf-pd__row-name">{{ u.displayName }}</p>
                    <p class="pf-pd__row-meta">
                      @if (lastBodyFor(u.id); as last) {
                        {{ last }}
                      } @else {
                        {{ presenceLabel(presence(u.id)) }}
                      }
                    </p>
                  </div>
                  @if (unreadFor(u.id) > 0) {
                    <span class="pf-pd__row-badge">{{ unreadFor(u.id) }}</span>
                  }
                </button>
              }
            } @empty {
              <p class="pf-pd__empty">No teammates yet.</p>
            }
            @if (groupedUsers().length === 0 && activeUsers().length > 0) {
              <p class="pf-pd__empty">No matches.</p>
            }
          </div>
        } @else if (mode() === 'chat') {
          <div #scrollPane class="pf-pd__chat">
            @if (chat.loadingHistory()) {
              <pf-skeleton-rows [rows]="4" [dense]="true" [trailing]="false" label="Loading messages…"></pf-skeleton-rows>
            } @else if (chat.activeMessages().length === 0) {
              <p class="pf-pd__empty">No messages yet. Say hi 👋</p>
            }
            @for (m of chat.activeMessages(); track m.id) {
              <div class="pf-pd__bubble"
                   [class.pf-pd__bubble--mine]="m.fromUserId === me()">
                <div class="pf-pd__bubble-body">{{ m.body }}</div>
                <div class="pf-pd__bubble-meta">
                  {{ m.sentAt | date:'shortTime' }}
                  @if (m.fromUserId === me()) {
                    <span class="pf-pd__bubble-tick" [class.pf-pd__bubble-tick--read]="!m.pending">
                      @if (m.pending) { ⏳ } @else { ✓ }
                    </span>
                  }
                </div>
              </div>
            }
            @if (otherTyping()) {
              <div class="pf-pd__typing"><span></span><span></span><span></span></div>
            }
          </div>
          <div class="pf-pd__composer">
            <input type="text" class="pf-pd__composer-input"
                   #composer
                   placeholder="Type a message…"
                   [(ngModel)]="draft"
                   (ngModelChange)="draft.set($event); onComposerInput()"
                   (keydown.enter)="send()"
                   maxlength="4000" />
            <button type="button" class="pf-pd__composer-send"
                    [disabled]="!draft().trim()"
                    (click)="send()" aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        }
      </aside>
    }
  `,
  styles: [`
    :host { display: contents; }

    .pf-pd-backdrop { position: fixed; inset: 0; z-index: 70;
      background: rgba(0,0,0,0.45); backdrop-filter: blur(4px);
      animation: pf-pd-fade 0.15s ease-out; }
    @keyframes pf-pd-fade { from { opacity: 0; } to { opacity: 1; } }
    .pf-pd { position: fixed; top: 0; right: 0; bottom: 0; width: 100%;
      max-width: 380px; z-index: 71;
      display: flex; flex-direction: column;
      background: var(--bg-card-solid, #14142a);
      border-left: 1px solid var(--glass-border);
      box-shadow: -10px 0 40px rgba(0,0,0,0.4);
      animation: pf-pd-slide 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes pf-pd-slide { from { transform: translateX(100%); } to { transform: none; } }

    .pf-pd__hdr { display: flex; align-items: center; gap: 10px;
      padding: 14px 14px 12px; border-bottom: 1px solid var(--glass-border); }
    .pf-pd__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); flex: 1; }
    .pf-pd__count { font-size: 11px; color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .pf-pd__icon-btn { background: transparent; border: none; padding: 6px;
      color: var(--text-secondary); cursor: pointer; border-radius: 8px; }
    .pf-pd__icon-btn:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-pd__close { margin-left: auto; }

    .pf-pd__search { padding: 10px 14px; }
    .pf-pd__search input { width: 100%; height: 36px; padding: 0 12px;
      border-radius: 9px; border: 1px solid var(--glass-border);
      background: var(--glass-bg); color: var(--text-primary); font-size: 13px;
      outline: none; transition: border-color 0.15s; }
    .pf-pd__search input:focus { border-color: rgba(168, 85, 247, 0.55); }

    .pf-pd__list { flex: 1; overflow-y: auto; padding: 4px 6px 16px; }
    .pf-pd__group-label { padding: 12px 10px 6px; margin: 0;
      font-size: 10.5px; font-weight: 600; letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--text-muted); }
    .pf-pd__row { display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 8px 10px; border-radius: 10px;
      background: transparent; border: none; cursor: pointer;
      text-align: left; color: var(--text-primary);
      transition: background 0.12s; }
    .pf-pd__row:hover { background: var(--glass-bg-hover); }
    .pf-pd__row-av { position: relative; }
    .pf-pd__row-dot { position: absolute; bottom: -1px; right: -1px;
      width: 11px; height: 11px; border-radius: 50%;
      border: 2px solid var(--bg-card-solid, #14142a);
      background: var(--text-muted); }
    .pf-pd__row-dot[data-status='active']      { background: #10b981; }
    .pf-pd__row-dot[data-status='in-a-call']   { background: #f43f5e; }
    .pf-pd__row-dot[data-status='offline'],
    .pf-pd__row-dot[data-status='']            { background: #6b7280; }
    /* Custom Teams-style statuses (presence.model.ts colors). */
    .pf-pd__row-dot[data-status='available']    { background: #34d399; }
    .pf-pd__row-dot[data-status='busy'],
    .pf-pd__row-dot[data-status='with_patient'] { background: #f87171; }
    .pf-pd__row-dot[data-status='rounds']       { background: #fbbf24; }
    .pf-pd__row-dot[data-status='surgery'],
    .pf-pd__row-dot[data-status='dnd']          { background: #dc2626; }
    .pf-pd__row-dot[data-status='surgery']::after,
    .pf-pd__row-dot[data-status='dnd']::after {
      content: ''; position: absolute; left: 20%; right: 20%; top: 50%;
      height: 1.5px; margin-top: -0.75px; border-radius: 2px; background: #fff; }
    .pf-pd__row-dot[data-status='away'] {
      background: var(--bg-card-solid, #14142a);
      box-shadow: inset 0 0 0 1.5px #9ca3af; }
    .pf-pd__row-body { flex: 1; min-width: 0; }
    .pf-pd__row-name { margin: 0; font-size: 13.5px; font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-pd__row-meta { margin: 1px 0 0; font-size: 11.5px;
      color: var(--text-tertiary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-pd__row-badge { flex: 0 0 auto; min-width: 18px; padding: 2px 6px;
      border-radius: 999px; background: #a78bfa;
      color: #fff; font-size: 10.5px; font-weight: 700; text-align: center; }
    .pf-pd__empty { padding: 24px 14px; text-align: center;
      color: var(--text-tertiary); font-size: 13px; }

    /* ── Chat panel ────────────────────────────────────────────── */
    .pf-pd__dot { position: relative; display: inline-block; width: 8px; height: 8px;
      border-radius: 50%; vertical-align: middle; margin-right: 4px; }
    .pf-pd__dot[data-status='active']    { background: #10b981; }
    .pf-pd__dot[data-status='in-a-call'] { background: #f43f5e; }
    .pf-pd__dot[data-status='offline'],
    .pf-pd__dot[data-status='']          { background: #6b7280; }
    /* Custom Teams-style statuses (presence.model.ts colors). */
    .pf-pd__dot[data-status='available']    { background: #34d399; }
    .pf-pd__dot[data-status='busy'],
    .pf-pd__dot[data-status='with_patient'] { background: #f87171; }
    .pf-pd__dot[data-status='rounds']       { background: #fbbf24; }
    .pf-pd__dot[data-status='surgery'],
    .pf-pd__dot[data-status='dnd']          { background: #dc2626; }
    .pf-pd__dot[data-status='surgery']::after,
    .pf-pd__dot[data-status='dnd']::after {
      content: ''; position: absolute; left: 18%; right: 18%; top: 50%;
      height: 1.5px; margin-top: -0.75px; border-radius: 2px; background: #fff; }
    .pf-pd__dot[data-status='away'] {
      background: transparent;
      box-shadow: inset 0 0 0 1.5px #9ca3af; }
    .pf-pd__chat-id { flex: 1; min-width: 0; }
    .pf-pd__chat-name { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-pd__chat-status { margin: 1px 0 0; font-size: 11px; color: var(--text-tertiary); }
    .pf-pd__call-btn { width: 34px; height: 34px; border-radius: 50%;
      background: rgba(16, 185, 129, 0.18); color: var(--green-text);
      border: 1px solid rgba(16, 185, 129, 0.35);
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; transition: background 0.15s, transform 0.08s; }
    .pf-pd__call-btn:hover:not(:disabled) { background: rgba(16, 185, 129, 0.28); }
    .pf-pd__call-btn:active { transform: scale(0.92); }
    .pf-pd__call-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .pf-pd__chat { flex: 1; overflow-y: auto; padding: 14px;
      display: flex; flex-direction: column; gap: 8px; }
    .pf-pd__bubble { max-width: 78%; padding: 8px 12px; border-radius: 12px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      align-self: flex-start; }
    .pf-pd__bubble--mine { align-self: flex-end;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.35), rgba(168, 85, 247, 0.22));
      border-color: rgba(168, 85, 247, 0.35); }
    .pf-pd__bubble-body { font-size: 13.5px; color: var(--text-primary);
      white-space: pre-wrap; word-break: break-word; line-height: 1.4; }
    .pf-pd__bubble-meta { font-size: 10.5px; color: var(--text-tertiary);
      margin-top: 2px; text-align: right;
      font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .pf-pd__bubble-tick { margin-left: 4px; }
    .pf-pd__bubble-tick--read { color: #38bdf8; }

    .pf-pd__typing { display: inline-flex; gap: 3px; padding: 6px 12px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 12px; align-self: flex-start; }
    .pf-pd__typing span { width: 6px; height: 6px; border-radius: 50%;
      background: var(--text-tertiary); animation: pf-pd-bounce 1.2s infinite; }
    .pf-pd__typing span:nth-child(2) { animation-delay: 0.15s; }
    .pf-pd__typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes pf-pd-bounce { 0%,80%,100% { opacity:0.3; transform: scale(0.8);} 40% { opacity:1; transform: scale(1.1);} }

    .pf-pd__composer { display: flex; gap: 8px; padding: 10px 12px;
      border-top: 1px solid var(--glass-border); }
    .pf-pd__composer-input { flex: 1; height: 36px; padding: 0 12px;
      border-radius: 18px; border: 1px solid var(--glass-border);
      background: var(--glass-bg); color: var(--text-primary);
      font-size: 13px; outline: none; }
    .pf-pd__composer-input:focus { border-color: rgba(168, 85, 247, 0.55); }
    .pf-pd__composer-send { width: 36px; height: 36px; border-radius: 50%;
      background: #a78bfa; color: #fff; border: none;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; }
    .pf-pd__composer-send:disabled { opacity: 0.35; cursor: not-allowed; }
  `]
})
export class PeopleDrawerComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly chat = inject(ChatService);
  protected readonly signaling = inject(SignalingService);
  protected readonly reach = inject(CallReachService);
  private readonly presenceSvc = inject(PresenceService);
  protected readonly webrtc = inject(WebrtcService);
  private readonly drawer = inject(PeopleDrawerService);
  private readonly toasts = inject(ToastService);

  /** Backed by PeopleDrawerService.open so the top-strip button can toggle us. */
  readonly open = this.drawer.open;
  readonly mode = signal<'list' | 'chat'>('list');
  readonly otherUser = signal<User | null>(null);
  readonly search = signal('');
  readonly draft = signal('');

  private readonly users = signal<User[]>([]);
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTypingSent = 0;

  protected readonly scrollPane = viewChild<ElementRef<HTMLDivElement>>('scrollPane');

  /** Used to exclude myself from the People list. Must be the same id space
   *  the directory hands us — i.e. the Supabase authId (matches SubClaimUserIdProvider
   *  + DirectoryUser.Id). Falls back to UserEntity.Id only if authId isn't
   *  loaded yet, which would mean the filter quietly fails-open until the
   *  next render. */
  protected readonly me = computed(() => this.auth.user()?.authId ?? this.auth.user()?.id ?? '');

  /** Active, non-self users in my tenant. */
  protected readonly activeUsers = computed(() =>
    this.users().filter(u => u.isActive && u.id !== this.me())
  );

  /** Online count for the header. */
  protected readonly onlineCount = computed(() => {
    const online = this.signaling.onlineUserIds();
    return this.activeUsers().filter(u => online.has(u.id)).length;
  });

  /** Group users by presence — Online / In a call / Away / Offline. */
  protected readonly groupedUsers = computed(() => {
    const q = this.search().trim().toLowerCase();
    const filtered = q
      ? this.activeUsers().filter(u =>
          (u.displayName ?? '').toLowerCase().includes(q)
          || u.email.toLowerCase().includes(q))
      : this.activeUsers();

    const presences = this.signaling.userPresences();
    const reachable = this.reach.reachable();
    const buckets: Record<string, { key: string; label: string; rank: number; users: User[] }> = {
      'in-a-call': { key: 'in-a-call', label: 'On a call',   rank: 1, users: [] },
      'active':    { key: 'active',    label: 'Online now',  rank: 2, users: [] },
      'away':      { key: 'away',      label: 'Away',        rank: 3, users: [] },
      'offline':   { key: 'offline',   label: 'Offline',     rank: 4, users: [] }
    };
    for (const u of filtered) {
      // No socket but a phone / browser we can ring by push → "Away" (callable).
      const p = presences.get(u.id) ?? (reachable.has(u.id) ? 'away' : 'offline');
      (buckets[p] ?? buckets['offline']).users.push(u);
    }
    return Object.values(buckets)
      .filter(g => g.users.length > 0)
      .sort((a, b) => a.rank - b.rank)
      .map(g => ({ ...g, users: g.users.slice().sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '')) }));
  });

  protected readonly otherTyping = computed(() => {
    const otherId = this.otherUser()?.id;
    const convId = this.chat.activeConversationId();
    if (!otherId || !convId) return false;
    return this.chat.typingByConversation().get(convId)?.has(otherId) ?? false;
  });

  constructor() {
    // The open drawer shows the active thread (classic design): reads +
    // alert suppression follow it; closing / destroying unregisters.
    const unregister = this.chat.registerViewer('reader', () => this.open() ? [this.chat.activeConversationId()] : []);
    inject(DestroyRef).onDestroy(unregister);

    // Auto-scroll the chat pane to bottom whenever messages change.
    effect(() => {
      const _ = this.chat.activeMessages().length; // dependency
      const pane = this.scrollPane()?.nativeElement;
      if (pane) queueMicrotask(() => { pane.scrollTop = pane.scrollHeight; });
    });

    // When the drawer opens (from anywhere — top-strip button etc.), refresh
    // users + conversations + presence. The shell already tries to connect
    // both hubs at boot but the order is not guaranteed — if a user opens
    // the drawer before the signaling connect completes, presence dots stay
    // grey. Force a fresh fetch here so what's shown matches who's online.
    // Close transitions reset to list mode.
    effect(() => {
      const isOpen = this.open();
      if (isOpen) {
        this.mode.set('list');
        queueMicrotask(async () => {
          await Promise.all([
            this.signaling.connect().catch(() => undefined),
            this.chat.connect().catch(() => undefined)
          ]);
          await Promise.all([
            this.fetchUsers(),
            this.chat.loadConversations().catch(() => undefined),
            this.signaling.getOnlineUsersWithStatus().catch(() => undefined)
          ]);
        });
      } else {
        this.mode.set('list');
        this.chat.closeConversation();
      }
    });
  }

  close(): void {
    this.drawer.close();
  }

  backToList(): void {
    this.mode.set('list');
    this.chat.closeConversation();
  }

  // ── List → Chat ─────────────────────────────────────────────────

  async openChat(u: User): Promise<void> {
    this.otherUser.set(u);
    this.mode.set('chat');
    this.draft.set('');
    // Resolve the 1:1 conversation (server creates one if it doesn't exist).
    try { await this.chat.openDirectConversation(u.id); }
    catch (err) { this.toasts.error((err as Error).message ?? 'Could not open chat.'); }
  }

  // ── Compose ─────────────────────────────────────────────────────

  async send(): Promise<void> {
    const body = this.draft().trim();
    const ou = this.otherUser();
    const convId = this.chat.activeConversationId();
    if (!body || !ou || !convId) return;
    const wasOffline = !this.isOnline(ou.id);
    this.draft.set('');
    try {
      await this.chat.sendMessage(convId, body);
      void this.chat.setTyping(convId, false);
      if (wasOffline) this.toasts.info(`${ou.displayName} is offline — they'll see it when they're back.`);
    } catch (err) {
      this.draft.set(body);
      this.toasts.error((err as Error).message ?? 'Message failed to send.');
    }
  }

  /** Throttled "typing" broadcast — at most one event per 2s while composing. */
  onComposerInput(): void {
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

  // ── Call ────────────────────────────────────────────────────────

  async callActive(): Promise<void> {
    const ou = this.otherUser();
    if (!ou) return;
    // Presence never blocks a call — offline colleagues ring by push.
    try {
      await this.webrtc.startCall(ou.id, 'admin_internal', ou.displayName);
      this.toasts.info(`Ringing ${ou.displayName}…`);
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not start call.');
    }
  }

  // ── Presence helpers ────────────────────────────────────────────

  /** Display presence: the hub's connection presence decides reachability
   *  (offline / in-a-call always win); otherwise the user's custom
   *  Teams-style status (In surgery, On rounds, …) when one is known,
   *  falling back to the plain connection presence. */
  protected presence(userId: string): string {
    // Offline but reachable by push reads "away" (callable), never "online".
    const conn = this.reach.displayConnection(userId);
    // Not connected / on a call wins over a custom status (see messages page).
    if (conn !== 'active') return conn;
    return this.presenceSvc.statusFor(userId) ?? conn;
  }
  protected presenceLabel(p: string): string {
    if (isPresenceKey(p)) return presetLabel(p);
    return p === 'active' ? 'Online' : p === 'in-a-call' ? 'On a call' : p === 'away' ? 'Away' : 'Offline';
  }
  protected isOnline(userId: string): boolean {
    return this.signaling.onlineUserIds().has(userId);
  }
  /** 1:1 conversation with this user, if one exists. */
  private directConversation(userId: string) {
    return this.chat.conversations().find(c =>
      !c.isGroup && c.participants.some(p => p.userId === userId)
    );
  }
  protected unreadFor(userId: string): number {
    return this.directConversation(userId)?.unreadCount ?? 0;
  }
  protected lastBodyFor(userId: string): string | null {
    return this.directConversation(userId)?.lastMessage?.body ?? null;
  }

  private async fetchUsers(): Promise<void> {
    try {
      // Use the directory endpoint (auth-only, no admin permission required)
      // — /api/users is admin-only and would 403 for reception / lab staff.
      const res = await firstValueFrom(
        this.api.get<Array<{ id: string; displayName: string; email: string; isActive: boolean }>>(
          '/api/directory/users'
        )
      );
      this.users.set((res ?? []).map(u => ({
        id: u.id,
        tenantId: '',
        firstName: '',
        fathersName: '',
        displayName: u.displayName,
        email: u.email,
        isActive: u.isActive,
        createdAt: ''
      } as unknown as User)));
    } catch { /* swallow */ }
  }
}
