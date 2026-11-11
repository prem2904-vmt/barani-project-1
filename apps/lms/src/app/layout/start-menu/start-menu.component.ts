import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
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
} as const;

interface MenuRow { kind: 'home' | 'item'; item?: NavItem; label: string; iconPath: readonly string[]; pinned: boolean; locked: boolean; canUp: boolean; canDown: boolean }
interface MenuSection { key: string; title: string; rows: MenuRow[] }

/**
 * The Start menu: every screen the person may open, with pin / unpin onto the bar, icons-only,
 * "reset to my role's defaults" and (manage_roles) the per-role defaults editor. Opened from the PF
 * logo in both shells. The bar is decided only by nav-pins.ts; this component renders the layout it is
 * given and writes the person's choices through NavPrefsService.
 */
@Component({
  selector: 'pf-start-menu',
  standalone: true,
  imports: [ToggleComponent, SelectComponent],
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
  /** Where the landing link goes (the "Home" row). */
  readonly homeHref = input<string | string[]>('/');
  /** 'bar' = rises above the desktop bar; 'sheet' = full-width phone sheet; 'rail' = beside the iPad rail. */
  readonly placement = input<'bar' | 'sheet' | 'rail'>('bar');
  /** Desktop focuses the search box on open; touch devices must not pop the keyboard. */
  readonly autofocusSearch = input(true);
  /** Phone / iPad: the PF button no longer opens the account menu, so the Start menu offers it. */
  readonly showAccount = input(false);
  readonly closed = output<void>();
  readonly account = output<void>();

  protected readonly icons = SM_ICONS;
  protected readonly query = signal('');
  protected readonly mode = signal<'list' | 'roles'>('list');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly canManageRoles = computed(() => this.auth.hasPermission('manage_roles'));

  constructor() {
    effect(() => {
      if (this.open()) {
        this.prefs.ensureDefaults();
        this.query.set('');
        this.mode.set('list');
        if (this.autofocusSearch()) setTimeout(() => this.searchBox()?.nativeElement.focus(), 0);
      }
    });
  }

  // ── The list ────────────────────────────────────────────────────────────
  protected readonly sections = computed<MenuSection[]>(() => {
    const l = this.layout();
    const q = this.query().trim().toLowerCase();
    const match = (i: NavItem) => !q || i.label.toLowerCase().includes(q);
    const locked = l.lockedIds;
    const pinnedIds = l.pinned.map(p => p.id);
    const row = (i: NavItem, pinned: boolean): MenuRow => {
      const at = pinnedIds.indexOf(i.id);
      return {
        kind: 'item', item: i, label: i.label, iconPath: i.iconPath, pinned, locked: locked.has(i.id),
        canUp: pinned && !locked.has(i.id) && at > 0 && !locked.has(pinnedIds[at - 1]),
        canDown: pinned && !locked.has(i.id) && at >= 0 && at < pinnedIds.length - 1,
      };
    };
    const out: MenuSection[] = [];
    if (!q || 'home'.includes(q)) {
      out.push({ key: 'home', title: '', rows: [{ kind: 'home', label: 'Home', iconPath: SM_ICONS.home, pinned: false, locked: false, canUp: false, canDown: false }] });
    }
    const add = (key: string, title: string, items: NavItem[], pinned: boolean) => {
      const rows = items.filter(match).map(i => row(i, pinned));
      if (rows.length) out.push({ key, title, rows });
    };
    add('pinned', 'Pinned', l.menu.pinned, true);
    add('work', 'Work', l.menu.work, false);
    add('more', 'More', l.menu.more, false);
    add('settings', 'Settings', l.menu.settings, false);
    return out;
  });
  protected readonly flatRows = computed(() => this.sections().flatMap(s => s.rows));
  protected readonly hasResults = computed(() => this.flatRows().length > 0);
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

  protected onSearchKey(ev: KeyboardEvent): void {
    if (ev.key === 'Enter') {
      // The first screen that matches (Home only when it is the only match).
      const first = this.flatRows().find(r => r.kind === 'item') ?? this.flatRows()[0];
      if (first) { ev.preventDefault(); this.openRow(first); }
    }
  }

  // ── Pin / unpin / order (this person, this browser) ─────────────────────
  protected toggle(r: MenuRow): void {
    if (!r.item || r.locked) return;
    const l = this.layout();
    this.prefs.setPinned(togglePinned(l.pinned.map(p => p.id), r.item.id, l.lockedIds));
  }

  protected move(r: MenuRow, dir: -1 | 1): void {
    if (!r.item) return;
    this.prefs.setPinned(movePinned(this.layout().pinned.map(p => p.id), r.item.id, dir));
  }

  protected setIconsOnly(on: boolean): void {
    this.prefs.setIconsOnly(on);
  }

  protected async reset(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: "Reset to your role's defaults?",
      message: 'Your pinned screens go back to what your role starts with. Icons only stays as it is.',
      confirmLabel: 'Reset',
    });
    if (ok) this.prefs.resetPins();
  }

  // ── Keyboard: arrows move between rows, Esc closes, Tab stays inside ────
  @HostListener('document:keydown', ['$event'])
  protected onDocKey(ev: KeyboardEvent): void {
    if (!this.open()) return;
    if (ev.key === 'Escape') { ev.preventDefault(); this.close(); return; }
    const root = this.panel()?.nativeElement;
    if (!root) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-sm-row]'));
      const search = this.searchBox()?.nativeElement;
      const at = rows.indexOf(document.activeElement as HTMLElement);
      if (!rows.length || (at < 0 && document.activeElement !== search)) return;
      ev.preventDefault();
      const next = ev.key === 'ArrowDown' ? (at < 0 ? 0 : Math.min(rows.length - 1, at + 1)) : at <= 0 ? -1 : at - 1;
      if (next < 0) search?.focus(); else rows[next].focus();
    } else if (ev.key === 'Tab') {
      const f = Array.from(root.querySelectorAll<HTMLElement>('input, button, [role="combobox"]'))
        .filter(e => !(e as HTMLButtonElement).disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) { ev.preventDefault(); first.focus(); }
      else if (ev.shiftKey && active === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
    }
  }

  /** Outside click closes; the PF logo (data-start-trigger) toggles it, so it never counts as outside. */
  @HostListener('document:pointerdown', ['$event'])
  protected onDocPointer(ev: Event): void {
    if (!this.open()) return;
    const t = ev.target as HTMLElement | null;
    if (!t) return;
    if (this.host.nativeElement.contains(t) || t.closest?.('[data-start-trigger]') || t.closest?.('.pf-dd__panel')) return;
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
    this.mode.set('list');
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
