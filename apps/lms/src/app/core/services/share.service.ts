import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { TenantEntitlementsService } from './tenant-entitlements.service';
import { AuthService } from '../auth/auth.service';
import { BranchSwitchService } from './branch-switch.service';
import { ChatService } from './chat.service';
import { ApiError } from '../../shared/models/api-response.model';
import type { ChatMessage } from '../../shared/models/chat.model';
import {
  CardRoute, ShareCard, ShareCardMeta, ShareCardType, ShareTarget, cardCaption, cardOf, wireMeta, isShareCardType, localCardRoute, parseCardMeta, prefrontalPath, safeAppRoute,
} from '../../shared/utils/share-card';

/** Query params for the open: an ORDER card always opens the order itself
 *  (`/o/:id?view=detail`), never the scan-to-collect landing a bare `/o/:id`
 *  keeps for the printed order QR. */
export function openParams(card: Pick<ShareTarget, 'type'>, route: string, qp?: Record<string, string>): Record<string, string> {
  const out = { ...(qp ?? {}) };
  if (card.type === 'order' && route.startsWith('/o/') && !out['view']) out['view'] = 'detail';
  return out;
}

/**
 * "Share to Messages" — the ONE home of every share / card HTTP call
 * (docs/PF-PATTERN.md §18 "Shared records"). The wire shapes below are the
 * contract with prefrontal-mw; change them HERE only.
 *
 *   POST /api/chat/conversations/{id}/share  {type, id?, caption?, meta?, mentions?}     → {conversationId, messageId, card}
 *   POST /api/chat/share                     {toUserIds? | conversationId?, groupName?,
 *                                             type, id?, caption?, meta?, mentions?}      → same
 *        (1 user = direct chat; 2+ need groupName; the sheet sends one per person)
 *   client meta: result → {parameter} ONLY; insights → {section, period, from, to, branch}
 *   from-url → {type, id, meta, allowed, title?, subtitle?} (allowed:false → stays text)
 *   GET  /api/chat/cards/resolve?type&id[&meta]  → {route, queryParams, label}
 *                                                | {access:"none"}
 *                                                | {access:"other_branch", branchId, branchName}
 *   POST /api/chat/cards/from-url {url}          → see above | 404 not_a_card
 *
 * The SERVER checks the sender may see the record and builds the card's
 * title / subtitle; the receiver's tap is resolved against the RECEIVER's
 * permissions + branches, so a tap never lands on a raw 403 / 404.
 *
 * Dependencies are resolved lazily (Injector) so any screen can inject this
 * without dragging the router / branch switch into its unit specs.
 */

/** What one share sends. */
export interface ShareRequest extends ShareTarget {
  caption?: string | null;
  /** AuthIds @mentioned in the caption (the caption carries `@<authId>`). */
  mentions?: string[] | null;
}

/** Who receives it: people (1:1 each, or one new group with groupName) or a conversation. */
export interface ShareRecipients {
  toUserIds?: string[];
  conversationId?: string;
  groupName?: string | null;
}

export type CardResolve =
  | { kind: 'open'; route: string; queryParams?: Record<string, string>; label?: string | null }
  | { kind: 'none' }
  | { kind: 'other_branch'; branchId: string; branchName: string; canSwitch?: boolean | null }
  /** Older server without /cards/resolve — the app's own route (guards + API still gate). */
  | { kind: 'fallback'; route: string; queryParams?: Record<string, string> };

/** Opens the "Send to colleague" sheet. */
export interface ShareSheetRequest {
  target: ShareTarget;
  /** Preview only (the server names the card it sends). */
  title: string;
  subtitle?: string | null;
  /** Sheet heading ("Send to colleague", "Ask the technician"). */
  heading?: string;
  /** People to preselect (the technician who entered a value, the assigned
   *  validator). Matched to the directory by id, else by name. */
  suggest?: Array<{ userId?: string | null; name?: string | null }>;
  /** A prefilled note. */
  caption?: string;
}

/** What a share answers: data {conversationId, messageId, card}. */
export interface ShareResult {
  conversationId: string;
  messageId: string;
  card?: { type: string; id: string | null; title: string; subtitle: string; meta?: unknown } | null;
}

export interface DirectoryUser { id: string; displayName: string; email: string; isActive: boolean }

/** Raw resolve body (see the contract above). */
interface ResolveBody {
  route?: string | null;
  queryParams?: Record<string, unknown> | null;
  label?: string | null;
  access?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  /** other_branch: may I switch to it (one of my branches / tenant-wide)? */
  canSwitch?: boolean | null;
}

/** The ENDPOINT is missing on this server (an older build): an empty 404
 *  (no coded body). A coded 404 (`not_found` — the record is gone) is a real
 *  answer and is never mistaken for it. */
export function endpointMissing(e: unknown): boolean {
  const err = ApiError.from(e);
  return !err.code && (err.status === 404 || /\b404\b/.test(err.message ?? ''));
}

const GUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The record id on the wire. An Insights card's id is its dashboard (a GUID)
 *  or nothing — a built-in section travels in meta.section. */
export function wireId(t: Pick<ShareTarget, 'type' | 'id'>): string | null {
  if (t.type === 'insights') return GUID_RX.test(t.id ?? '') ? t.id : null;
  return t.id || null;
}

/** The meta as a query parameter (compact JSON), or undefined when empty. */
function metaParam(meta: ShareCardMeta | null | undefined): string | undefined {
  if (!meta) return undefined;
  const clean = parseCardMeta(meta);
  return clean ? JSON.stringify(clean) : undefined;
}

function stringParams(qp: Record<string, unknown> | null | undefined): Record<string, string> | undefined {
  if (!qp) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(qp)) if (v !== null && v !== undefined && v !== '') out[k] = String(v);
  return Object.keys(out).length ? out : undefined;
}

/** Normalise a resolve body. Anything that isn't an in-app route is "none". */
export function readResolve(body: ResolveBody | null | undefined): CardResolve {
  if (!body) return { kind: 'none' };
  if (body.access === 'other_branch' && body.branchId) {
    return { kind: 'other_branch', branchId: body.branchId, branchName: body.branchName || 'another branch', canSwitch: body.canSwitch ?? null };
  }
  if (body.access === 'none') return { kind: 'none' };
  const route = safeAppRoute(body.route);
  if (!route) return { kind: 'none' };
  return { kind: 'open', route, queryParams: stringParams(body.queryParams), label: body.label ?? null };
}

@Injectable({ providedIn: 'root' })
export class ShareService {
  private readonly injector = inject(Injector);
  private get api(): ApiService { return this.injector.get(ApiService); }

  // ── The sheet (one global host in the shell) ─────────────────────────
  private readonly _sheet = signal<ShareSheetRequest | null>(null);
  readonly sheet = this._sheet.asReadonly();

  /** Messages is in the plan → share actions show (structural, never CSS). */
  readonly available = computed(() => {
    try { return this.injector.get(TenantEntitlementsService).moduleEnabled('messages'); } catch { return false; }
  });

  openSheet(req: ShareSheetRequest): void {
    if (!this.available()) return;
    this._sheet.set(req);
  }
  closeSheet(): void { this._sheet.set(null); }

  // ── Directory (people for the sheet), fetched once per session ───────
  private dirCache: Promise<DirectoryUser[]> | null = null;
  directory(force = false): Promise<DirectoryUser[]> {
    if (!this.dirCache || force) {
      this.dirCache = firstValueFrom(this.api.get<DirectoryUser[]>('/api/directory/users'))
        .then(list => list ?? [])
        .catch(e => { this.dirCache = null; throw e; });
    }
    return this.dirCache;
  }
  /** Account switch: the next open re-reads the directory. */
  resetCache(): void { this.dirCache = null; }

  // ── Sending ──────────────────────────────────────────────────────────

  private body(req: ShareRequest): Record<string, unknown> {
    const b: Record<string, unknown> = { type: req.type };
    const id = wireId(req);
    if (id) b['id'] = id;
    const caption = (req.caption ?? '').trim();
    if (caption) b['caption'] = caption;
    const meta = wireMeta(req);
    if (meta) b['meta'] = meta;
    if (req.mentions?.length) b['mentions'] = req.mentions;
    return b;
  }

  /** Share into an existing conversation. An older server (no /share) still
   *  takes patients + reports through the legacy endpoints. */
  async shareToConversation(conversationId: string, req: ShareRequest): Promise<ShareResult | null> {
    try {
      return await firstValueFrom(this.api.post<ShareResult>(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/share`, this.body(req)));
    } catch (e) {
      if (!endpointMissing(e) || (req.type !== 'patient' && req.type !== 'report')) throw e;
      await this.legacyShare(conversationId, req);
      return null;
    }
  }

  /** Share to people (1:1 each, or one new group with groupName) or a conversation id. */
  async shareTo(to: ShareRecipients, req: ShareRequest): Promise<ShareResult | null> {
    const body = { ...this.body(req) } as Record<string, unknown>;
    if (to.conversationId) body['conversationId'] = to.conversationId;
    if (to.toUserIds?.length) body['toUserIds'] = to.toUserIds;
    if (to.groupName?.trim()) body['groupName'] = to.groupName.trim();
    try {
      return await firstValueFrom(this.api.post<ShareResult>('/api/chat/share', body));
    } catch (e) {
      if (!endpointMissing(e)) throw e;
      // Older server: one direct conversation per person, then the per-conversation share.
      if (to.conversationId) return this.shareToConversation(to.conversationId, req);
      let last: ShareResult | null = null;
      for (const uid of to.toUserIds ?? []) {
        const res = await firstValueFrom(this.api.post<{ conversationId: string }>('/api/chat/conversations/direct', { otherUserId: uid }));
        if (res?.conversationId) last = await this.shareToConversation(res.conversationId, req);
      }
      return last;
    }
  }

  private async legacyShare(conversationId: string, req: ShareRequest): Promise<void> {
    const c = encodeURIComponent(conversationId);
    if (req.type === 'patient') await firstValueFrom(this.api.post(`/api/chat/conversations/${c}/share-patient`, { patientId: req.id }));
    else await firstValueFrom(this.api.post(`/api/chat/conversations/${c}/share-report`, { reportId: req.id }));
    const caption = (req.caption ?? '').trim();
    // The legacy endpoints carry no caption — send it as its own message.
    if (caption) {
      await this.injector.get(ChatService).sendMessage(conversationId, caption);
    }
  }

  /** Forward keeps the card: the server re-checks the FORWARDER may see it. */
  async forwardCard(conversationId: string, m: ChatMessage): Promise<boolean> {
    const card = cardOf(m);
    if (!card) return false;
    await this.shareToConversation(conversationId, { type: card.type, id: card.id, meta: card.meta, caption: cardCaption(m) || null });
    return true;
  }

  // ── Pasted links ─────────────────────────────────────────────────────

  /** A pasted Prefrontal link → the record it names (sender-permission checked
   *  server side), or null when the server can't make a card of it. */
  async cardFromUrl(url: string): Promise<(ShareTarget & { title?: string; subtitle?: string }) | null> {
    try {
      // Desktop (hash-routed) links travel as their in-app path; the server parses both.
      const own = typeof location !== 'undefined' ? location.host : null;
      const path = prefrontalPath(url, own);
      const send = path && /#\//.test(url) ? path : url;
      const r = await firstValueFrom(this.api.post<{ type?: string; id?: string | null; meta?: unknown; allowed?: boolean; title?: string | null; subtitle?: string | null } | null>(
        '/api/chat/cards/from-url', { url: send }));
      // allowed:false (the sender may not see it) → the link stays plain text.
      if (!r || r.allowed === false || !isShareCardType(r.type)) return null;
      const meta = parseCardMeta(r.meta);
      const id = r.id || (r.type === 'insights' ? (meta?.section ?? 'overview') : '');
      if (!id) return null;
      const out: ShareTarget & { title?: string; subtitle?: string } = { type: r.type as ShareCardType, id, meta };
      if (r.title) out.title = r.title;
      if (r.subtitle) out.subtitle = r.subtitle;
      return out;
    } catch {
      // not_a_card (404), a record the sender may not see, an older server:
      // the link simply stays text.
      return null;
    }
  }

  // ── Opening a card (the RECEIVER) ────────────────────────────────────

  async resolveCard(card: ShareTarget): Promise<CardResolve> {
    const qs = new URLSearchParams({ type: card.type });
    const id = wireId(card);
    if (id) qs.set('id', id);
    const meta = metaParam(wireMeta(card));
    if (meta) qs.set('meta', meta);
    try {
      const body = await firstValueFrom(this.api.get<ResolveBody>(`/api/chat/cards/resolve?${qs.toString()}`));
      return readResolve(body);
    } catch (e) {
      if (!endpointMissing(e)) throw e;
      const local: CardRoute | null = localCardRoute(card);
      return local ? { kind: 'fallback', route: local.route, queryParams: local.queryParams } : { kind: 'none' };
    }
  }

  private readonly _opening = signal<string | null>(null);
  /** The card being resolved (its busy state). */
  readonly opening = this._opening.asReadonly();

  /** Tap on a card: resolve → open, or a friendly "no access" / "In Branch X —
   *  switch?" (the existing branch switcher), never a raw 403 / 404. */
  async openCard(card: ShareCard, from?: string | null): Promise<boolean> {
    const key = `${card.type}:${card.id}`;
    if (this._opening()) return false;
    this._opening.set(key);
    try {
      let r: CardResolve;
      try { r = await this.resolveCard(card); }
      catch (e) { this.injector.get(ToastService).error(ApiError.from(e).message); return false; }

      if (r.kind === 'other_branch') {
        const auth = this.injector.get(AuthService);
        const target = r;
        const mine = target.canSwitch ?? (auth.user()?.branches ?? []).some(b => b.id === target.branchId);
        const dialog = this.injector.get(DialogService);
        if (!mine) {
          await dialog.alert({ title: `This is in ${r.branchName}`, message: `You don't work in ${r.branchName}, so you can't open it.${from ? ` Ask ${from} to send what you need.` : ''}`, confirmLabel: 'OK' });
          return false;
        }
        const ok = await dialog.confirm({
          title: `This is in ${r.branchName}`,
          message: `Switch to ${r.branchName} to open it? Your work here stays saved.`,
          confirmLabel: `Switch to ${r.branchName}`, cancelLabel: 'Not now', tone: 'primary',
        });
        if (!ok) return false;
        const switched = await this.injector.get(BranchSwitchService).switchTo(r.branchId);
        if (!switched) { this.injector.get(ToastService).info(`Couldn't switch to ${r.branchName}`); return false; }
        try { r = await this.resolveCard(card); }
        catch (e) { this.injector.get(ToastService).error(ApiError.from(e).message); return false; }
        if (r.kind === 'other_branch') return false;
      }
      if (r.kind === 'none') {
        await this.injector.get(DialogService).alert({
          title: "You can't open this",
          message: `It's outside what your role can see.${from ? ` Ask ${from} if you need the details.` : ''}`,
          confirmLabel: 'OK',
        });
        return false;
      }
      const router = this.injector.get(Router);
      return await router.navigateByUrl(router.createUrlTree([r.route], { queryParams: openParams(card, r.route, r.queryParams) }));
    } finally {
      this._opening.set(null);
    }
  }
}
