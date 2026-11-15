import { FilesLogoComponent } from '../../shared/components/files-logo/files-logo.component';
import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ToggleComponent, SelectComponent, PfSelectOption } from '@prefrontal/shared';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { NavItem } from '../nav-items';
import { OverlayBackService } from '../../core/services/overlay-back.service';
import { NavPrefsService } from './nav-prefs.service';
import { FilesAccessService } from '../../features/files/files-access.service';
import { SheetEditorService } from '../../features/neuron/sheet-editor.service';
import { FILES_SEARCH_WORDS } from '../../features/files/files-nav';
import { FILES_NAME, filesAppForKind, filesAppForNavId, isFilesNavId } from '../../features/files/files-registry';
import { OfficeFile, OfficeService } from '../../features/files/office.service';
import { NavLayout, RoleNav, movePinned, normalizeRoleNav, togglePinned } from './nav-pins';

/** Stroked SVG paths (never emoji). */
export const SM_ICONS = {
  search: ['m21 21-4.3-4.3', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
  pin: ['M12 17v5', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z'],
  lock: ['M7 11V7a5 5 0 0 1 10 0v4', 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z'],
  up: ['m18 15-6-6-6 6'],
  down: ['m6 9 6 6 6-6'],
  home: ['m3 11 9-8 9 8', 'M5 10v10h5v-6h4v6h5V10'],
  roles: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  back: ['m15 18-6-6 6-6'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  minus: ['M6 12h12'],
  plus: ['M12 5v14', 'M5 12h14'],
  /** Six dots drawn as round-capped zero-length strokes (stroke icons only). */
  grip: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  chevron: ['m9 18 6-6-6-6'],
} as const;

interface MenuRow { kind: 'home' | 'item'; item?: NavItem; label: string; iconPath: readonly string[]; active: boolean }
interface EditRow { item: NavItem; locked: boolean; canUp: boolean; canDown: boolean }

/**
 * The Start menu ("B · Pinned tiles", owner 2026-11-11). Normal view: who is signed in, the screens on
 * the bar as tiles, every other screen as a plain row; search hides behind a quiet button ("/" or just
 * typing opens it). Customize mode: reorder (drag or Alt+Arrow), take off, add back, icons only, reset,
 * and (manage_roles) the per-role defaults editor. Opened from the PF logo in both shells. The bar is
 * decided only by nav-pins.ts; this component renders the layout it is given and writes the person's
 * choices through NavPrefsService.
 */
@Component({
  selector: 'pf-start-menu',
  standalone: true,
  imports: [ToggleComponent, SelectComponent, CdkDropList, CdkDrag, FilesLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './start-menu.component.html',
  styleUrl: './start-menu.component.scss',
})
export class StartMenuComponent {
  protected readonly prefs = inject(NavPrefsService);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly overlays = inject(OverlayBackService);
  private readonly filesAccess = inject(FilesAccessService);
  private readonly sheets = inject(SheetEditorService);
  private readonly officeSvc = inject(OfficeService);

  /** The layout the shell computed (computeNavLayout). */
  readonly layout = input.required<NavLayout>();
  readonly open = input(false);
  /** Where the landing link goes (the "Home" tile). */
  readonly homeHref = input<string | string[]>('/');
  /** 'bar' = rises above the desktop bar; 'sheet' = full-width phone sheet; 'rail' = beside the iPad rail. */
  readonly placement = input<'bar' | 'sheet' | 'rail'>('bar');
  /** Desktop moves focus into the menu on open; touch devices must not pop the keyboard. */
  readonly autofocusSearch = input(true);
  /** Phone / iPad: the PF button no longer opens the account menu, so the Start menu offers it. */
  readonly showAccount = input(false);
  readonly closed = output<void>();
  readonly account = output<void>();

  protected readonly icons = SM_ICONS;
  protected readonly query = signal('');
  /** list = tiles + rows with the search box docked at the bottom; edit = Customize; roles = role defaults. */
  protected readonly mode = signal<'list' | 'edit' | 'roles'>('list');
  /** The panel stays mounted while it plays its close; `phase` drives the grow / fade classes. */
  protected readonly shown = signal(false);
  protected readonly phase = signal<'pre' | 'in' | 'out'>('pre');
  /** True for the first moments after opening: the list items fade in with a very small stagger. */
  protected readonly intro = signal(false);
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private introTimer: ReturnType<typeof setTimeout> | null = null;
  /** The PF button (or avatar badge) the person pressed last; the panel grows out of it. */
  private lastTrigger: HTMLElement | null = null;
  /** A DialogService confirm is up: the panel steps aside (the dialog host sits below it). */
  protected readonly asking = signal(false);
  private readonly currentUrl = signal('');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly canManageRoles = computed(() => this.auth.hasPermission('manage_roles'));

  // ── Who is signed in ───────────────────────────────────────────────────
  protected readonly userName = computed(() => {
    const u = this.auth.user();
    return (u?.displayName || [u?.firstName, u?.fathersName].filter(Boolean).join(' ') || 'You').trim();
  });
  protected readonly userLine = computed(() => {
    const u = this.auth.user();
    return [u?.tenantName, (u?.roles ?? []).join(', ')].filter(Boolean).join(' · ');
  });
  protected readonly initials = computed(() => {
    const words = this.userName().split(/\s+/).filter(Boolean);
    const s = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2);
    return s.toUpperCase();
  });

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => this.onOpen());
      } else {
        untracked(() => this.onClose());
      }
    });
    // The back gesture / Android back closes the menu before it touches the page.
    effect((onCleanup) => {
      if (!this.open()) return;
      onCleanup(this.overlays.register(() => this.close()));
    });
  }

  private onOpen(): void {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    this.prefs.ensureDefaults();
    this.query.set('');
    this.mode.set('list');
    this.ctx.set(null);
    this.asking.set(false);
    this.currentUrl.set(((this.router as Partial<Router>).url ?? '').split(/[?#]/)[0]);
    this.shown.set(true);
    this.phase.set('pre');
    this.intro.set(true);
    if (this.introTimer) clearTimeout(this.introTimer);
    this.introTimer = setTimeout(() => this.intro.set(false), 600);
    // Next tick the panel exists: aim its origin at the logo, then let it grow.
    setTimeout(() => {
      if (!this.open()) return;
      this.aimOrigin();
      this.phase.set('in');
      if (this.autofocusSearch()) this.focusSearch();
    }, 0);
  }

  private onClose(): void {
    if (!this.shown()) return;
    this.phase.set('out');
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { this.hideTimer = null; this.shown.set(false); }, 130);
  }

  /** transform-origin = the centre of the button that opened it, in the panel's own coordinates. */
  private aimOrigin(): void {
    const el = this.panel()?.nativeElement;
    if (!el) return;
    const trig = this.triggerEl();
    if (!trig) return;
    const prevT = el.style.transition, prevX = el.style.transform;
    el.style.transition = 'none';
    el.style.transform = 'none';
    const p = el.getBoundingClientRect();
    const t = trig.getBoundingClientRect();
    el.style.transition = prevT;
    el.style.transform = prevX;
    if (!p.width || !t.width) return;
    const ox = Math.max(-80, Math.min(p.width + 80, t.left + t.width / 2 - p.left));
    const oy = Math.max(-80, Math.min(p.height + 80, t.top + t.height / 2 - p.top));
    el.style.transformOrigin = `${Math.round(ox)}px ${Math.round(oy)}px`;
    void el.offsetWidth; // commit the 'pre' look before the transition starts
  }

  private triggerEl(): HTMLElement | null {
    const visible = (e: Element | null): e is HTMLElement => !!e && (e as HTMLElement).getBoundingClientRect().width > 0;
    if (this.lastTrigger?.isConnected && visible(this.lastTrigger)) return this.lastTrigger;
    const a = (document.activeElement as HTMLElement | null)?.closest?.('[data-start-trigger]') ?? null;
    if (visible(a)) return a;
    return Array.from(document.querySelectorAll('[data-start-trigger]')).find(visible) ?? null;
  }

  private focusSearch(select = false): void {
    const box = this.searchBox()?.nativeElement;
    if (!box) return;
    box.focus();
    if (select) box.setSelectionRange(box.value.length, box.value.length);
  }

  private isActive(i: NavItem): boolean {
    const url = this.currentUrl();
    if (!url || !i.href) return false;
    const href = i.href.split(/[?#]/)[0];
    return url === href || (!i.exact && href !== '/' && url.startsWith(href + '/'));
  }

  // ── Normal view ────────────────────────────────────────────────────────
  private readonly homeRow = computed<MenuRow>(() => {
    const h = this.homeHref();
    const href = Array.isArray(h) ? h.join('/').replace(/\/+/g, '/') : h;
    return { kind: 'home', label: 'Home', iconPath: SM_ICONS.home, active: !!href && href !== '/' && this.currentUrl() === href };
  });
  private toRow(i: NavItem, plain = false): MenuRow {
    return { kind: 'item', item: i, label: plain ? i.label : (i.menuLabel ?? i.label), iconPath: i.iconPath, active: this.isActive(i) };
  }
  /** Home, then the pinned screens in bar order. */
  protected readonly tiles = computed<MenuRow[]>(() => [this.homeRow(), ...this.layout().pinned.map(i => this.toRow(i, true))]);
  /** Every other screen the person may open (each once). */
  protected readonly others = computed<MenuRow[]>(() => {
    const m = this.layout().menu;
    return [...m.work, ...m.more, ...m.settings].map(i => this.toRow(i));
  });
  protected isPinnedId(id: string): boolean { return this.layout().pinned.some(p => p.id === id); }
  protected isLockedId(id: string): boolean { return this.layout().lockedIds.has(id); }

  // ── Right-click (desktop) / long-press (touch) menu on a Files item: Open, New …, Pin to bar / Unpin from bar ──
  protected readonly ctx = signal<{ item: NavItem; x: number; y: number } | null>(null);
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressClick = false;
  protected readonly ctxActions = computed(() => {
    const c = this.ctx();
    if (!c) return [];
    const app = filesAppForNavId(c.item.id);
    const out: { id: string; label: string; disabled?: boolean; hint?: string }[] = [{ id: 'open', label: app ? `Open ${app.name}` : 'Open All files' }];
    if (app && this.filesAccess.canWrite(app)) out.push({ id: 'new', label: app.kind === 'pdf' || app.kind === 'image' ? app.newLabel : `New ${app.noun}` });
    const pinned = this.isPinnedId(c.item.id);
    const locked = this.isLockedId(c.item.id);
    out.push(pinned ? { id: 'unpin', label: 'Unpin from bar', disabled: locked, hint: locked ? 'Kept by admin' : undefined } : { id: 'pin', label: 'Pin to bar' });
    return out;
  });
  /** The menu sits inside the (transformed) panel, so its coordinates are the panel's own, kept inside it. */
  private ctxAt(item: NavItem, cx: number, cy: number): { item: NavItem; x: number; y: number } {
    const p = this.panel()?.nativeElement.getBoundingClientRect();
    if (!p) return { item, x: cx, y: cy };
    const x = Math.max(8, Math.min(cx - p.left, p.width - 220));
    const y = Math.max(8, Math.min(cy - p.top, p.height - 150));
    return { item, x, y };
  }
  protected openCtx(ev: MouseEvent, item: NavItem): void {
    if (!isFilesNavId(item.id)) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.ctx.set(this.ctxAt(item, ev.clientX, ev.clientY));
    setTimeout(() => this.panel()?.nativeElement.querySelector<HTMLElement>('[data-sm-ctx-item]')?.focus(), 0);
  }
  protected pressStart(ev: PointerEvent, item: NavItem): void {
    if (ev.pointerType === 'mouse' || !isFilesNavId(item.id)) return;
    this.pressEnd();
    const el = ev.currentTarget as HTMLElement | null;
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      this.suppressClick = true;
      const r = el?.getBoundingClientRect();
      this.ctx.set(this.ctxAt(item, r ? r.left + r.width / 2 : ev.clientX, r ? r.bottom : ev.clientY));
      setTimeout(() => { this.suppressClick = false; }, 600);
    }, 480);
  }
  protected pressEnd(): void { if (this.pressTimer) { clearTimeout(this.pressTimer); this.pressTimer = null; } }
  protected runCtx(action: string): void {
    const c = this.ctx();
    this.ctx.set(null);
    if (!c) return;
    const app = filesAppForNavId(c.item.id);
    if (action === 'open') { void this.router.navigateByUrl(c.item.href); this.close(); }
    else if (action === 'new' && app) {
      this.close();
      void this.sheets.open({ app: app.id, source: FILES_NAME });
    } else if (action === 'pin') this.pin(c.item);
    else if (action === 'unpin') this.unpin(c.item);
  }
  /** The menu's own keys: arrows move, Esc closes it (and only it). */
  protected onCtxKey(ev: KeyboardEvent): void {
    const items = Array.from((ev.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-sm-ctx-item]:not([disabled])'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.ctx.set(null); }
  }
  /** Search results: one flat list, Home only when asked for. */
  protected readonly searching = computed(() => { const on = this.query().trim().length > 0; if (on) untracked(() => this.loadFilesOnce()); return on; });
  // ── Files by name: while someone searches, the stored files they may open (the server filters by role) join the results ──
  private readonly officeFiles = signal<OfficeFile[]>([]);
  private filesLoaded = false;
  protected readonly fileRows = computed<{ id: string; name: string; appId: string; route: string }[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (q.length < 2 || !this.filesAccess.available()) return [];
    return this.officeFiles().filter(f => f.name.toLowerCase().includes(q)).slice(0, 8).flatMap(f => {
      const a = filesAppForKind(f.kind);
      return a && this.filesAccess.canRead(a) ? [{ id: f.id, name: f.name, appId: a.id, route: a.route }] : [];
    });
  });
  private loadFilesOnce(): void {
    if (this.filesLoaded || !this.filesAccess.available()) return;
    this.filesLoaded = true;
    void this.officeSvc.list().then(l => this.officeFiles.set(l)).catch(() => { this.filesLoaded = false; });
  }
  protected openFile(f: { id: string; route: string }): void {
    void this.router.navigateByUrl(`/files/${f.route}/${f.id}`);
    this.close();
  }
  protected readonly results = computed<MenuRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all = [...this.layout().pinned.map(i => this.toRow(i)), ...this.others()];
    // A Files item is also found by what it opens ("sheets", "office", "pdf" …), not only by its name.
    const hit = (r: MenuRow) => r.label.toLowerCase().includes(q) || (r.item ? (FILES_SEARCH_WORDS[r.item.id] ?? []).some(w => w.includes(q) || q.includes(w) && q.length >= 3 && w === q) : false);
    const hits = q ? all.filter(hit) : all;
    return !q || 'home'.includes(q) ? [this.homeRow(), ...hits] : hits;
  });
  /** Pinned screens past the bar's capacity are still pinned, just not visible at this width. */
  protected readonly hiddenPins = computed(() => Math.max(0, this.layout().pinned.length - this.layout().bar.length));

  // ── Opening ─────────────────────────────────────────────────────────────
  protected openRow(r: MenuRow): void {
    if (this.suppressClick) return;                      // the long-press that opened the context menu must not also open the screen
    if (r.kind === 'home') {
      const h = this.homeHref();
      void this.router.navigate(Array.isArray(h) ? h : [h]);
    } else if (r.item) {
      void this.router.navigateByUrl(r.item.href);
    }
    this.close();
  }

  protected close(): void {
    this.closed.emit();
  }

  protected openAccount(): void {
    this.account.emit();
  }

  // ── Search (docked at the bottom, always there in the list view) ─────────
  protected clearSearch(): void {
    this.query.set('');
    this.focusSearch();
  }

  protected onSearchKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter' || !this.searching()) return;
    // The first screen that matches (Home only when it is the only match).
    const rows = this.results();
    const first = rows.find(r => r.kind === 'item') ?? rows[0];
    if (first) { ev.preventDefault(); this.openRow(first); }
  }

  // ── Customize (this person, this browser) ───────────────────────────────
  protected startEdit(): void {
    this.query.set('');
    this.mode.set('edit');
    setTimeout(() => this.panel()?.nativeElement.querySelector<HTMLElement>('[data-sm-done]')?.focus(), 0);
  }

  protected doneEdit(): void {
    this.mode.set('list');
    setTimeout(() => this.panel()?.nativeElement.querySelector<HTMLElement>('[data-sm-edit-btn]')?.focus(), 0);
  }

  private pinnedIds(): string[] {
    return this.layout().pinned.map(p => p.id);
  }

  protected readonly editRows = computed<EditRow[]>(() => {
    const l = this.layout();
    const ids = l.pinned.map(p => p.id);
    return l.pinned.map((i, at) => {
      const locked = l.lockedIds.has(i.id);
      return {
        item: i, locked,
        canUp: !locked && at > 0 && !l.lockedIds.has(ids[at - 1]),
        canDown: !locked && at < ids.length - 1,
      };
    });
  });
  /** Screens not on the bar, offered as "+ Label" chips. */
  protected readonly addable = computed<NavItem[]>(() => {
    const m = this.layout().menu;
    return [...m.work, ...m.more, ...m.settings];
  });
  /** Touch lifts after a still hold (moving sooner scrolls the list); mouse lifts at once. */
  protected readonly dragDelay = { touch: 300, mouse: 0 };
  private readonly lockedCount = computed(() => this.editRows().filter(r => r.locked).length);
  /** Nothing moves above the admin's locked screens (they are always first). */
  protected readonly sortPredicate = (index: number): boolean => index >= this.lockedCount();

  protected unpin(i: NavItem): void {
    const l = this.layout();
    if (l.lockedIds.has(i.id)) return;
    this.prefs.setPinned(togglePinned(this.pinnedIds(), i.id, l.lockedIds));
  }

  protected pin(i: NavItem): void {
    const l = this.layout();
    this.prefs.setPinned(togglePinned(this.pinnedIds(), i.id, l.lockedIds));
  }

  protected onDrop(ev: CdkDragDrop<unknown>): void {
    if (ev.previousIndex === ev.currentIndex) return;
    const ids = this.pinnedIds();
    if (this.layout().lockedIds.has(ids[ev.previousIndex])) return;
    moveItemInArray(ids, ev.previousIndex, Math.max(this.lockedCount(), ev.currentIndex));
    this.prefs.setPinned(ids);
  }

  /** Keyboard reorder: Alt+ArrowUp / Alt+ArrowDown on a focused row. */
  protected onEditRowKey(ev: KeyboardEvent, r: EditRow): void {
    if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
    ev.preventDefault();
    ev.stopPropagation();
    const dir = ev.key === 'ArrowUp' ? -1 : 1;
    if ((dir < 0 && !r.canUp) || (dir > 0 && !r.canDown)) return;
    this.prefs.setPinned(movePinned(this.pinnedIds(), r.item.id, dir));
    setTimeout(() => this.panel()?.nativeElement.querySelector<HTMLElement>(`[data-sm-edit="${r.item.id}"]`)?.focus(), 0);
  }

  protected setIconsOnly(on: boolean): void {
    this.prefs.setIconsOnly(on);
  }

  protected async reset(): Promise<void> {
    this.asking.set(true);
    try {
      const ok = await this.dialog.confirm({
        title: "Reset to your role's defaults?",
        message: 'Your pinned screens go back to what your role starts with. Icons only stays as it is.',
        confirmLabel: 'Reset',
      });
      if (ok) this.prefs.resetPins();
    } finally {
      this.asking.set(false);
    }
  }

  // ── Keyboard: typing or "/" goes to the search box, arrows move, Esc clears then closes, Tab stays inside ──
  @HostListener('document:keydown', ['$event'])
  protected onDocKey(ev: KeyboardEvent): void {
    if (!this.open() || this.asking()) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (this.ctx()) { this.ctx.set(null); return; }
      if (this.mode() === 'list' && this.query()) { this.query.set(''); this.focusSearch(); }
      else this.close();
      return;
    }
    const root = this.panel()?.nativeElement;
    if (!root) return;
    const active = document.activeElement as HTMLElement | null;
    const inField = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (this.mode() === 'list' && !inField && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.length === 1) {
      if (ev.key === '/') { ev.preventDefault(); this.focusSearch(true); return; }
      if (ev.key.trim()) { ev.preventDefault(); this.query.set(this.query() + ev.key); this.focusSearch(true); return; }
    }
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && !ev.altKey && this.mode() === 'list') {
      const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-sm-row]'));
      const search = this.searchBox()?.nativeElement;
      const at = rows.indexOf(active as HTMLElement);
      if (!rows.length || (at < 0 && (!search || active !== search))) return;
      ev.preventDefault();
      // The search box sits under the list: Down from the last row (or Up from the first) lands in it.
      if (active === search) { rows[ev.key === 'ArrowDown' ? 0 : rows.length - 1].focus(); return; }
      const next = at + (ev.key === 'ArrowDown' ? 1 : -1);
      if (next < 0 || next >= rows.length) search?.focus(); else rows[next].focus();
    } else if (ev.key === 'Tab') {
      const f = Array.from(root.querySelectorAll<HTMLElement>('input, button, [role="combobox"], [tabindex="0"]'))
        .filter(e => !(e as HTMLButtonElement).disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!root.contains(active)) { ev.preventDefault(); first.focus(); }
      else if (ev.shiftKey && active === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
    }
  }

  /** Outside click closes; the PF logo (data-start-trigger) toggles it, so it never counts as outside. */
  @HostListener('document:pointerdown', ['$event'])
  protected onDocPointer(ev: Event): void {
    const t = ev.target as HTMLElement | null;
    const trig = t?.closest?.('[data-start-trigger]') as HTMLElement | null | undefined;
    if (trig) this.lastTrigger = trig;
    if (!this.open() || this.asking()) return;
    if (!t) return;
    if (this.ctx() && !t.closest?.('[data-sm-ctx]')) this.ctx.set(null);
    if (this.host.nativeElement.contains(t) || t.closest?.('[data-start-trigger]') || t.closest?.('.pf-dd__panel')
      || t.closest?.('.cdk-drag-preview')) return;
    this.close();
  }

  // ── Role defaults editor (manage_roles) ─────────────────────────────────
  protected readonly roleOptions = signal<PfSelectOption<string>[]>([]);
  protected readonly roleName = signal('');
  /** Draft of every role's defaults while the editor is open. */
  protected readonly draft = signal<Record<string, RoleNav>>({});
  protected readonly saving = signal(false);

  protected openRoles(): void {
    this.mode.set('roles');
    this.draft.set(cloneRoles(this.prefs.roleMap() ?? {}));
    this.api.get<{ id: string; name: string }[]>('/api/roles/').subscribe({
      next: list => {
        const names = (list ?? []).map(r => r.name).filter(Boolean);
        this.roleOptions.set(names.map(n => ({ value: n, label: n })));
        if (!this.roleName() && names.length) this.roleName.set(names[0]);
      },
      error: () => this.toast.error('Could not load the roles.'),
    });
  }

  protected backToList(): void {
    this.mode.set('edit');
  }

  /** Candidates for a role: every screen the editor's admin can open (the list the menu shows). */
  protected readonly roleCandidates = computed<NavItem[]>(() => {
    const l = this.layout();
    return [...l.menu.pinned, ...l.menu.work, ...l.menu.more, ...l.menu.settings]
      .filter((i, ix, a) => a.findIndex(x => x.id === i.id) === ix);
  });

  private roleNav(): RoleNav {
    return this.draft()[this.roleName()] ?? { pinned: [], locked: [] };
  }

  /** The editor's rows for the picked role: its pinned screens in order, then the rest. */
  protected readonly roleRows = computed(() => {
    const cur = this.draft()[this.roleName()] ?? { pinned: [], locked: [] };
    const by = new Map(this.roleCandidates().map(i => [i.id, i]));
    const pinned = cur.pinned.filter(id => by.has(id)).map(id => by.get(id)!);
    const rest = this.roleCandidates().filter(i => !cur.pinned.includes(i.id));
    return [...pinned, ...rest].map((i, ix) => {
      const isPinned = cur.pinned.includes(i.id);
      return { item: i, pinned: isPinned, locked: cur.locked.includes(i.id), canUp: isPinned && ix > 0, canDown: isPinned && ix < pinned.length - 1 };
    });
  });

  private setRole(next: RoleNav): void {
    this.draft.update(d => ({ ...d, [this.roleName()]: next }));
  }

  protected rolePin(id: string): void {
    const cur = this.roleNav();
    this.setRole(cur.pinned.includes(id)
      ? { pinned: cur.pinned.filter(p => p !== id), locked: cur.locked.filter(p => p !== id) }
      : { pinned: [...cur.pinned, id], locked: cur.locked });
  }

  protected roleLock(id: string): void {
    const cur = this.roleNav();
    if (cur.locked.includes(id)) this.setRole({ pinned: cur.pinned, locked: cur.locked.filter(p => p !== id) });
    else this.setRole({ pinned: cur.pinned.includes(id) ? cur.pinned : [...cur.pinned, id], locked: [...cur.locked, id] });
  }

  protected roleMove(id: string, dir: -1 | 1): void {
    const cur = this.roleNav();
    this.setRole({ pinned: movePinned(cur.pinned, id, dir), locked: cur.locked });
  }

  protected saveRoles(): void {
    const roles: Record<string, RoleNav> = {};
    for (const [name, nav] of Object.entries(this.draft())) {
      const n = normalizeRoleNav(nav.pinned, nav.locked);
      if (n.pinned.length) roles[name] = n; // a role with nothing pinned simply has no defaults
    }
    this.saving.set(true);
    this.prefs.saveRoleDefaults(roles).subscribe({
      next: () => { this.saving.set(false); this.toast.success('Role defaults saved.'); },
      error: (e: unknown) => {
        this.saving.set(false);
        this.toast.error((e as { message?: string })?.message || 'Could not save the role defaults.');
      },
    });
  }
}

function cloneRoles(m: Record<string, RoleNav>): Record<string, RoleNav> {
  const out: Record<string, RoleNav> = {};
  for (const [k, v] of Object.entries(m)) out[k] = { pinned: [...(v.pinned ?? [])], locked: [...(v.locked ?? [])] };
  return out;
}
