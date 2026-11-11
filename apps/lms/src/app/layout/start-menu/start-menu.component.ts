import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ToggleComponent, SelectComponent, PfSelectOption } from '@prefrontal/shared';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { NavItem } from '../nav-items';
import { NavPrefsService } from './nav-prefs.service';
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
  imports: [ToggleComponent, SelectComponent, CdkDropList, CdkDrag],
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
  /** list = tiles + rows; search = the quiet search line replaces the header; edit = Customize; roles = role defaults. */
  protected readonly mode = signal<'list' | 'search' | 'edit' | 'roles'>('list');
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
        this.prefs.ensureDefaults();
        this.query.set('');
        this.mode.set('list');
        this.asking.set(false);
        this.currentUrl.set(((this.router as Partial<Router>).url ?? '').split(/[?#]/)[0]);
        if (this.autofocusSearch()) setTimeout(() => this.focusFirst(), 0);
      }
    });
  }

  private focusFirst(): void {
    this.panel()?.nativeElement.querySelector<HTMLElement>('[data-sm-row]')?.focus();
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
  private toRow(i: NavItem): MenuRow {
    return { kind: 'item', item: i, label: i.label, iconPath: i.iconPath, active: this.isActive(i) };
  }
  /** Home, then the pinned screens in bar order. */
  protected readonly tiles = computed<MenuRow[]>(() => [this.homeRow(), ...this.layout().pinned.map(i => this.toRow(i))]);
  /** Every other screen the person may open (each once). */
  protected readonly others = computed<MenuRow[]>(() => {
    const m = this.layout().menu;
    return [...m.work, ...m.more, ...m.settings].map(i => this.toRow(i));
  });
  /** Search results: one flat list, Home only when asked for. */
  protected readonly results = computed<MenuRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all = [...this.layout().pinned.map(i => this.toRow(i)), ...this.others()];
    const hits = q ? all.filter(r => r.label.toLowerCase().includes(q)) : all;
    return !q || 'home'.includes(q) ? [this.homeRow(), ...hits] : hits;
  });
  /** Pinned screens past the bar's capacity are still pinned, just not visible at this width. */
  protected readonly hiddenPins = computed(() => Math.max(0, this.layout().pinned.length - this.layout().bar.length));

  // ── Opening ─────────────────────────────────────────────────────────────
  protected openRow(r: MenuRow): void {
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

  // ── Search ──────────────────────────────────────────────────────────────
  protected openSearch(initial = ''): void {
    this.query.set(initial);
    this.mode.set('search');
    setTimeout(() => {
      const box = this.searchBox()?.nativeElement;
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }, 0);
  }

  protected closeSearch(): void {
    this.query.set('');
    this.mode.set('list');
    setTimeout(() => this.panel()?.nativeElement.querySelector<HTMLElement>('[data-sm-search-btn]')?.focus(), 0);
  }

  protected onSearchKey(ev: KeyboardEvent): void {
    if (ev.key === 'Enter') {
      // The first screen that matches (Home only when it is the only match).
      const rows = this.results();
      const first = rows.find(r => r.kind === 'item') ?? rows[0];
      if (first) { ev.preventDefault(); this.openRow(first); }
    }
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

  // ── Keyboard: "/" or typing opens search, arrows move, Esc steps back, Tab stays inside ──
  @HostListener('document:keydown', ['$event'])
  protected onDocKey(ev: KeyboardEvent): void {
    if (!this.open() || this.asking()) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (this.mode() === 'search') this.closeSearch();
      else this.close();
      return;
    }
    const root = this.panel()?.nativeElement;
    if (!root) return;
    const active = document.activeElement as HTMLElement | null;
    const inField = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (this.mode() === 'list' && !inField && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.length === 1) {
      if (ev.key === '/') { ev.preventDefault(); this.openSearch(); return; }
      if (ev.key.trim()) { ev.preventDefault(); this.openSearch(ev.key); return; }
    }
    // Keys typed before the search line took focus still land in it.
    if (this.mode() === 'search' && !inField && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.length === 1) {
      ev.preventDefault();
      this.openSearch(this.query() + ev.key);
      return;
    }
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && !ev.altKey) {
      const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-sm-row]'));
      const search = this.searchBox()?.nativeElement;
      const at = rows.indexOf(active as HTMLElement);
      if (!rows.length || (at < 0 && (!search || active !== search))) return;
      ev.preventDefault();
      const next = ev.key === 'ArrowDown' ? (at < 0 ? 0 : Math.min(rows.length - 1, at + 1)) : at <= 0 ? -1 : at - 1;
      if (next < 0) search?.focus(); else rows[next].focus();
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
    if (!this.open() || this.asking()) return;
    const t = ev.target as HTMLElement | null;
    if (!t) return;
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
