import {
  ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { ShareService, DirectoryUser, ShareSheetRequest } from '../../../core/services/share.service';
import { ChatService } from '../../../core/services/chat.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiError } from '../../models/api-response.model';
import type { Conversation } from '../../models/chat.model';
import { ShareCardComponent } from '../share-card/share-card.component';
import { draftCard, encodeMentions } from '../../utils/share-card';
import { BusyDirective } from '../../directives/busy.directive';

/** One pickable destination: a person (1:1, get-or-create) or a group chat. */
export interface ShareDest {
  key: string;
  kind: 'person' | 'group';
  /** person: AuthId; group: conversation id. */
  id: string;
  name: string;
  hint: string;
  /** Group members (AuthId + name) for @mentions. */
  members?: Array<{ id: string; name: string }>;
}

const MAX_DESTS = 10;

export function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '')).toUpperCase();
}

/** People + groups + recent conversations for the sheet (pure, unit-tested). */
export function buildDestinations(
  users: readonly DirectoryUser[], conversations: readonly Conversation[], me: string, q: string,
): { recent: ShareDest[]; people: ShareDest[]; groups: ShareDest[] } {
  const term = q.trim().toLowerCase();
  const match = (...s: Array<string | null | undefined>) => !term || s.some(x => (x ?? '').toLowerCase().includes(term));
  const byId = new Map(users.map(u => [u.id, u]));
  const person = (id: string, name: string, email: string): ShareDest => ({ key: `u:${id}`, kind: 'person', id, name, hint: email });
  const group = (c: Conversation): ShareDest => ({
    key: `c:${c.id}`, kind: 'group', id: c.id, name: c.name || 'Group',
    hint: `${c.participants.length} members`,
    members: c.participants.filter(p => p.userId !== me).map(p => ({ id: p.userId, name: p.displayName })),
  });
  const convs = [...conversations]
    .filter(c => c.contextType !== 'self')
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0));

  const recent: ShareDest[] = [];
  const seen = new Set<string>();
  for (const c of convs) {
    if (recent.length >= 5) break;
    if (c.isGroup) {
      if (!match(c.name, ...c.participants.map(p => p.displayName))) continue;
      const d = group(c);
      if (seen.has(d.key)) continue;
      seen.add(d.key); recent.push(d);
    } else {
      const other = c.participants.find(p => p.userId !== me);
      if (!other) continue;
      const u = byId.get(other.userId);
      if (u && !u.isActive) continue;
      if (!match(other.displayName, other.email, u?.email)) continue;
      const d = person(other.userId, u?.displayName || other.displayName, u?.email || other.email);
      if (seen.has(d.key)) continue;
      seen.add(d.key); recent.push(d);
    }
  }
  const people = users
    .filter(u => u.id !== me && u.isActive && !seen.has(`u:${u.id}`) && match(u.displayName, u.email))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map(u => person(u.id, u.displayName, u.email));
  const groups = convs.filter(c => c.isGroup && !seen.has(`c:${c.id}`) && match(c.name, ...c.participants.map(p => p.displayName))).map(group);
  return { recent, people, groups };
}

/**
 * "Send to colleague" — the ONE share sheet (docs/PF-PATTERN.md §18 "Shared
 * records"). Opened from any screen with ShareService.openSheet(); rendered
 * once in the shell (only with the Messages module). What you send (the card
 * preview) · who to (recent chats, people, groups; several at once) · a
 * note with @mentions · Send (the sheet's one primary). A centred pf-card
 * modal on web, a bottom sheet above the navbar on phones.
 */
@Component({
  selector: 'pf-share-sheet',
  standalone: true,
  imports: [ShareCardComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (req(); as r) {
      <div class="pf-ss-scrim" (click)="close()" aria-hidden="true"></div>
      <div class="pf-card pf-ss" role="dialog" aria-modal="true" aria-labelledby="pf-ss-t" (keydown.escape)="onEsc($event)">
        <span class="pf-ss__handle" aria-hidden="true"></span>
        <header class="pf-card__head">
          <span class="pf-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </span>
          <span class="pf-card__label" id="pf-ss-t">{{ r.heading || 'Send to colleague' }}</span>
          <span class="pf-card__spacer"></span>
          <button type="button" class="pf-btn pf-btn--icon pf-ss__close" (click)="close()" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </header>

        <div class="pf-ss__body">
          <pf-share-card class="pf-ss__card" [card]="preview()" [preview]="true"></pf-share-card>

          @if (picked().length) {
            <div class="pf-ss__to" aria-label="Sending to">
              <span class="pf-ss__to-k">To</span>
              @for (d of picked(); track d.key) {
                <span class="pf-chip pf-chip--static pf-ss__pick">
                  {{ d.name }}
                  <button type="button" class="pf-ss__unpick" (click)="toggle(d)" [attr.aria-label]="'Remove ' + d.name">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </span>
              }
            </div>
          }

          <div class="pf-ss__search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input #search type="text" class="pf-input" placeholder="Search people and groups" aria-label="Search people and groups"
                   [value]="q()" (input)="q.set($any($event.target).value)" />
          </div>

          <div class="pf-ss__list" role="group" aria-label="Recipients">
            @if (loading()) {
              @for (i of [1, 2, 3, 4]; track i) { <div class="pf-ss__skel" aria-hidden="true"><span></span><span></span></div> }
              <span class="sr-only" role="status">Loading colleagues…</span>
            } @else {
              @for (sec of sections(); track sec.title) {
                @if (sec.items.length) {
                  <p class="pf-ss__sec">{{ sec.title }}</p>
                  @for (d of sec.items; track d.key) {
                    <button type="button" class="pf-ss__row" [attr.aria-pressed]="isPicked(d)" (click)="toggle(d)"
                            [attr.data-key]="d.key" [disabled]="sending() || (!isPicked(d) && picked().length >= max)">
                      <span class="pf-ss__avatar" aria-hidden="true">
                        @if (d.kind === 'group') {
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        } @else { {{ initials(d.name) }} }
                      </span>
                      <span class="pf-ss__meta">
                        <span class="pf-ss__name">{{ d.name }}</span>
                        @if (d.hint) { <span class="pf-ss__hint">{{ d.hint }}</span> }
                      </span>
                      @if (suggestedKeys().has(d.key)) { <span class="pf-chip pf-chip--static pf-ss__sug">Suggested</span> }
                      <span class="pf-ss__check" aria-hidden="true">
                        @if (isPicked(d)) {
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                        }
                      </span>
                    </button>
                  }
                }
              }
              @if (empty()) {
                <div class="pf-empty pf-empty--compact">
                  <p class="pf-empty__title">{{ q().trim() ? 'No one matches "' + q().trim() + '"' : 'No colleagues yet' }}</p>
                </div>
              }
            }
          </div>

          <div class="pf-ss__note">
            <label class="pf-ss__note-k" for="pf-ss-note">Note <span class="pf-ss__opt">(optional)</span></label>
            <textarea #note id="pf-ss-note" class="pf-input pf-ss__ta" rows="2" maxlength="1000"
                      placeholder="What should they look at? Type @ to mention someone"
                      [value]="caption()" (input)="onNoteInput($any($event.target))" (keydown)="onNoteKey($event)"></textarea>
            @if (mentionOpen() && mentionList().length) {
              <div class="pf-ss__mentions" role="listbox" aria-label="Mention">
                @for (p of mentionList(); track p.id; let i = $index) {
                  <button type="button" role="option" class="pf-ss__mention" [attr.aria-selected]="i === mentionIdx()"
                          (mousedown)="$event.preventDefault()" (click)="pickMention(p)">
                    <span class="pf-ss__avatar pf-ss__avatar--sm" aria-hidden="true">{{ initials(p.name) }}</span>{{ p.name }}
                  </button>
                }
              </div>
            }
          </div>
        </div>

        <footer class="pf-ss__foot">
          <button type="button" class="pf-btn pf-btn--tertiary" (click)="close()">Cancel</button>
          <button type="button" class="pf-btn pf-btn--primary pf-ss__send" [disabled]="!picked().length || sending()"
                  [pfBusy]="sending()" pfBusyLabel="Sending…" (click)="send()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
            {{ sendLabel() }}
          </button>
        </footer>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .pf-ss-scrim {
      position: fixed; top: 0; left: 0; right: 0; bottom: var(--pf-nav-h, 0px); z-index: 120;
      background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(2px);
      animation: pf-ss-fade var(--pf-dur-fast, 200ms) var(--pf-spring) both;
    }
    :host-context(.dark) .pf-ss-scrim, :host-context([data-theme='dark']) .pf-ss-scrim { background: rgba(0, 0, 0, 0.55); }
    @keyframes pf-ss-fade { from { opacity: 0; } to { opacity: 1; } }
    .pf-ss {
      position: fixed; z-index: 121; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(480px, calc(100vw - 32px)); max-height: min(86dvh, 680px);
      display: flex; flex-direction: column; align-items: stretch; overflow: hidden;
      box-shadow: 0 20px 48px rgba(15, 23, 42, 0.22);
      animation: pf-ss-in var(--pf-dur, 320ms) var(--pf-spring) both;
    }
    @keyframes pf-ss-in { from { opacity: 0; transform: translate(-50%, -48%) scale(0.97); } to { opacity: 1; transform: translate(-50%, -50%); } }
    .pf-ss__handle { display: none; }
    .pf-ss__body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; align-self: stretch; width: 100%; box-sizing: border-box; }
    .pf-ss__foot { align-self: stretch; }
    .pf-ss__card { padding: 12px 14px 0; }
    .pf-ss__to { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 14px 0; }
    .pf-ss__to-k { font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-right: 2px; }
    .pf-ss__pick { display: inline-flex; align-items: center; gap: 4px; padding-right: 4px; }
    .pf-ss__unpick {
      display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 999px;
      border: 0; background: transparent; color: var(--text-tertiary); cursor: pointer; position: relative;
    }
    .pf-ss__unpick::after { content: ''; position: absolute; inset: -8px; }
    .pf-ss__unpick:hover { color: var(--text-primary); background: var(--pf-chip-bg); }
    .pf-ss__search { position: relative; flex: none; padding: 10px 14px; }
    .pf-ss__search > svg { position: absolute; z-index: 1; left: 26px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); pointer-events: none; }
    .pf-ss__search .pf-input { padding-left: 36px; }
    .pf-ss__list { padding: 0 6px 6px; border-top: 1px solid var(--pf-line); border-bottom: 1px solid var(--pf-line); min-height: 160px; max-height: 300px; overflow-y: auto; flex: 0 1 auto; }
    .pf-ss__sec { margin: 0; padding: 10px 10px 4px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-ss__row {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 8px 10px;
      border: 1px solid transparent; border-radius: var(--pf-radius-sm, 10px); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
    }
    .pf-ss__row:hover:not(:disabled) { background: var(--pf-chip-bg); }
    .pf-ss__row:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
    .pf-ss__row[aria-pressed='true'] { background: var(--pf-sel-bg); border-color: var(--pf-sel-border); }
    .pf-ss__row:disabled { opacity: .55; cursor: default; }
    .pf-ss__avatar {
      flex: none; width: 34px; height: 34px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
      background: var(--pf-chip-bg); border: 1px solid var(--pf-line); color: var(--text-secondary); font-size: 12px; font-weight: 600;
    }
    .pf-ss__avatar--sm { width: 24px; height: 24px; font-size: 10.5px; }
    .pf-ss__meta { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
    .pf-ss__name { font-size: 13.5px; font-weight: 500; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-ss__hint { font-size: 12px; color: var(--text-tertiary); overflow-wrap: anywhere; }
    .pf-ss__sug { flex: none; font-size: 11px; }
    .pf-ss__check {
      flex: none; width: 22px; height: 22px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
      border: 1.5px solid var(--pf-line); color: var(--violet-text, #7c3aed);
    }
    .pf-ss__row[aria-pressed='true'] .pf-ss__check { border-color: var(--violet-text, #7c3aed); }
    .pf-ss__skel { display: flex; align-items: center; gap: 10px; padding: 10px; }
    .pf-ss__skel span:first-child { width: 34px; height: 34px; border-radius: 999px; background: var(--pf-chip-bg); }
    .pf-ss__skel span:last-child { flex: 1; height: 12px; border-radius: 6px; background: var(--pf-chip-bg); max-width: 180px; }
    .pf-ss__note { position: relative; padding: 10px 14px 12px; }
    .pf-ss__note-k { display: block; margin-bottom: 6px; font-size: 12.5px; font-weight: 600; color: var(--text-secondary); }
    .pf-ss__opt { font-weight: 400; color: var(--text-tertiary); }
    .pf-ss__ta { resize: vertical; min-height: 64px; }
    .pf-ss__mentions {
      position: absolute; left: 14px; right: 14px; bottom: calc(100% - 8px); z-index: 2; padding: 4px;
      background: var(--pf-card-bg); border: 1px solid var(--pf-line); border-radius: 12px; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
      max-height: 200px; overflow-y: auto;
    }
    .pf-ss__mention {
      display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 6px 8px; border: 0; border-radius: 8px;
      background: transparent; color: var(--text-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
    }
    .pf-ss__mention[aria-selected='true'], .pf-ss__mention:hover { background: var(--pf-chip-bg); }
    .pf-ss__foot {
      flex: none; display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 10px 14px;
      border-top: 1px solid var(--pf-line); padding-bottom: max(10px, env(safe-area-inset-bottom, 0px));
    }
    @media (max-width: 640px) {
      .pf-ss {
        top: auto; left: 0; right: 0; bottom: var(--pf-nav-h, 0px); width: auto; transform: none;
        max-height: calc(100dvh - env(safe-area-inset-top, 0px) - var(--pf-nav-h, 0px) - 16px);
        border-radius: 20px 20px 0 0;
        animation: pf-rise var(--pf-dur-sheet, 360ms) var(--pf-spring-bounce) both;
      }
      .pf-ss__handle { display: block; flex: none; width: 40px; height: 5px; margin: 8px auto 2px; border-radius: 999px; background: var(--pf-line); }
      .pf-ss__list { max-height: none; flex: 1 1 auto; }
      .pf-ss__search .pf-input, .pf-ss__ta { font-size: 16px; min-height: 44px; }
      .pf-ss__close { width: 44px !important; height: 44px; min-height: 44px; }
      .pf-ss__foot .pf-btn { min-height: 44px; }
      .pf-ss__send { flex: 1 1 auto; }
    }
    @media (hover: none) and (pointer: coarse) { .pf-ss__row:hover:not(:disabled) { background: transparent; } }
    @media (prefers-reduced-motion: reduce) { .pf-ss-scrim, .pf-ss { animation: none !important; } }
  `],
})
export class ShareSheetComponent {
  private readonly share = inject(ShareService);
  private readonly chat = inject(ChatService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);

  protected readonly req = this.share.sheet;
  protected readonly max = MAX_DESTS;
  protected readonly initials = initialsOf;

  protected readonly q = signal('');
  protected readonly users = signal<DirectoryUser[]>([]);
  protected readonly loading = signal(false);
  protected readonly sending = signal(false);
  protected readonly caption = signal('');
  protected readonly pickedMap = signal<Map<string, ShareDest>>(new Map());
  protected readonly suggestedKeys = signal<Set<string>>(new Set());

  private readonly searchEl = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly noteEl = viewChild<ElementRef<HTMLTextAreaElement>>('note');

  private readonly me = computed(() => this.auth.user()?.authId ?? this.auth.user()?.id ?? '');
  protected readonly preview = computed(() => {
    const r = this.req();
    return r ? draftCard({ ...r.target, title: r.title, subtitle: r.subtitle ?? '' }) : draftCard({ type: 'patient', id: '' });
  });
  protected readonly picked = computed(() => [...this.pickedMap().values()]);
  protected readonly dests = computed(() => buildDestinations(this.users(), this.chat.conversations(), this.me(), this.q()));
  protected readonly sections = computed(() => {
    const d = this.dests();
    return [
      { title: 'Recent', items: d.recent },
      { title: 'People', items: d.people },
      { title: 'Groups', items: d.groups },
    ];
  });
  protected readonly empty = computed(() => this.sections().every(s => !s.items.length));
  protected readonly sendLabel = computed(() => {
    const n = this.picked().length;
    return n > 1 ? `Send to ${n}` : 'Send';
  });

  constructor() {
    // A new request → a fresh sheet: clear, load people, preselect suggestions.
    effect(() => {
      const r = this.req();
      untracked(() => { if (r) void this.start(r); });
    });
  }

  private async start(r: ShareSheetRequest): Promise<void> {
    this.q.set('');
    this.caption.set(r.caption ?? '');
    this.pickedMap.set(new Map());
    this.suggestedKeys.set(new Set());
    this.mentionOpen.set(false);
    this.sending.set(false);
    queueMicrotask(() => this.searchEl()?.nativeElement.focus());
    if (!this.chat.conversationsLoaded()) void this.chat.loadConversations().catch(() => undefined);
    this.loading.set(!this.users().length);
    try {
      this.users.set(await this.share.directory());
    } catch (e) {
      this.toasts.error(ApiError.from(e).message || 'Could not load colleagues.');
    } finally {
      this.loading.set(false);
    }
    if (this.req() !== r) return;
    this.applySuggestions(r);
  }

  /** Preselect the suggested people (by AuthId, else by display name). */
  private applySuggestions(r: ShareSheetRequest): void {
    const me = this.me();
    const keys = new Set<string>();
    const next = new Map(this.pickedMap());
    for (const s of r.suggest ?? []) {
      const u = this.users().find(x => x.isActive && x.id !== me && ((s.userId && x.id === s.userId)
        || (!!s.name && x.displayName.trim().toLowerCase() === s.name.trim().toLowerCase())));
      if (!u) continue;
      const d: ShareDest = { key: `u:${u.id}`, kind: 'person', id: u.id, name: u.displayName, hint: u.email };
      keys.add(d.key);
      if (next.size < MAX_DESTS) next.set(d.key, d);
    }
    this.suggestedKeys.set(keys);
    this.pickedMap.set(next);
  }

  protected isPicked(d: ShareDest): boolean { return this.pickedMap().has(d.key); }
  protected toggle(d: ShareDest): void {
    const next = new Map(this.pickedMap());
    if (next.has(d.key)) next.delete(d.key);
    else if (next.size < MAX_DESTS) next.set(d.key, d);
    this.pickedMap.set(next);
  }

  close(): void {
    if (this.sending()) return;
    this.share.closeSheet();
  }
  protected onEsc(ev: Event): void {
    ev.preventDefault();
    if (this.mentionOpen()) { this.mentionOpen.set(false); return; }
    this.close();
  }

  // ── @mentions in the note ─────────────────────────────────────────────
  protected readonly mentionOpen = signal(false);
  private readonly mentionQ = signal('');
  private mentionAnchor = 0;
  protected readonly mentionIdx = signal(0);
  /** Who can be mentioned: the people picked + the members of picked groups. */
  private readonly mentionable = computed(() => {
    const me = this.me();
    const out = new Map<string, { id: string; name: string }>();
    for (const d of this.picked()) {
      if (d.kind === 'person') out.set(d.id, { id: d.id, name: d.name });
      else for (const m of d.members ?? []) if (m.id !== me) out.set(m.id, m);
    }
    return [...out.values()];
  });
  protected readonly mentionList = computed(() => {
    const q = this.mentionQ().toLowerCase();
    return this.mentionable().filter(p => !q || p.name.toLowerCase().includes(q)).slice(0, 6);
  });

  protected onNoteInput(ta: HTMLTextAreaElement): void {
    this.caption.set(ta.value);
    const caret = ta.selectionStart ?? ta.value.length;
    const m = ta.value.slice(0, caret).match(/(?:^|\s)@([\w.-]*)$/);
    if (m) {
      this.mentionOpen.set(true);
      this.mentionQ.set(m[1] ?? '');
      this.mentionAnchor = caret - (m[1].length + 1);
      this.mentionIdx.set(0);
    } else {
      this.mentionOpen.set(false);
    }
  }

  protected onNoteKey(ev: KeyboardEvent): void {
    if (this.mentionOpen() && this.mentionList().length) {
      const n = this.mentionList().length;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); this.mentionIdx.set((this.mentionIdx() + 1) % n); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); this.mentionIdx.set((this.mentionIdx() - 1 + n) % n); return; }
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); this.pickMention(this.mentionList()[this.mentionIdx()]); return; }
    }
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); void this.send(); }
  }

  protected pickMention(p: { id: string; name: string }): void {
    const ta = this.noteEl()?.nativeElement;
    const value = this.caption();
    const caret = ta?.selectionStart ?? value.length;
    const inserted = `@${p.name} `;
    const next = value.slice(0, this.mentionAnchor) + inserted + value.slice(caret);
    this.caption.set(next);
    this.mentionOpen.set(false);
    const pos = this.mentionAnchor + inserted.length;
    queueMicrotask(() => {
      if (!ta) return;
      ta.value = next;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  // ── Send ──────────────────────────────────────────────────────────────
  async send(): Promise<void> {
    const r = this.req();
    const dests = this.picked();
    if (!r || !dests.length || this.sending()) return;
    this.sending.set(true);
    const everyone = [
      ...this.mentionable(),
      ...this.users().map(u => ({ id: u.id, name: u.displayName })),
    ];
    const { body, mentions } = encodeMentions(this.caption().trim(), everyone);
    const req = { ...r.target, caption: body || null, mentions: mentions.length ? mentions : null };
    const failed: string[] = [];
    let lastError = '';
    for (const d of dests) {
      try {
        if (d.kind === 'group') await this.share.shareToConversation(d.id, req);
        else await this.share.shareTo({ toUserIds: [d.id] }, req);
      } catch (e) {
        failed.push(d.name);
        lastError = ApiError.from(e).message;
      }
    }
    this.sending.set(false);
    if (!failed.length) {
      this.toasts.success(dests.length === 1 ? `Sent to ${dests[0].name}` : `Sent to ${dests.length} people`);
      this.share.closeSheet();
      return;
    }
    // Keep the sheet with only the ones that failed, so a retry never double-sends.
    const left = new Map([...this.pickedMap()].filter(([, d]) => failed.includes(d.name)));
    this.pickedMap.set(left);
    this.toasts.error(failed.length === dests.length ? (lastError || 'Could not send.') : `Couldn't send to ${failed.join(', ')}: ${lastError}`);
  }
}
