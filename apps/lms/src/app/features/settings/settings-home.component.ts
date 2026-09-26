import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { canSee } from './settings-access';
import { SETTINGS, SETTINGS_GROUPS, SETTINGS_TOOLS, rowsOfGroup } from './settings-registry';
import { matchTool, searchRows } from './settings-search';
import { SettingsStore } from './settings-store.service';
import { SettingRowComponent } from './setting-row.component';
import { GroupId, SettingDef, SettingsGroup, SettingsTool } from './settings.model';

interface GroupView {
  group: SettingsGroup;
  main: SettingDef[];
  more: SettingDef[];
  tools: SettingsTool[];
}

/**
 * /settings — every setting on ONE page. The band pill IS the search; group
 * chips under it jump to a group (they are not tabs); each group is a plain
 * list of rows with "More options (n)" and its Tools. Rows save as you go.
 */
@Component({
  selector: 'pf-settings-home',
  standalone: true,
  imports: [HeroBandComponent, SettingRowComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-home.component.html',
  styleUrl: './settings-home.component.scss',
})
export class SettingsHomeComponent implements AfterViewInit {
  protected readonly store = inject(SettingsStore);
  private readonly route = inject(ActivatedRoute);

  @ViewChild('list') list?: ElementRef<HTMLElement>;

  readonly q = signal('');
  /** Groups whose "More options" is open. */
  readonly openMore = signal<ReadonlySet<GroupId>>(new Set());

  private readonly allowedRows = computed(() => SETTINGS.filter((d) => this.store.allowed(d)));
  private readonly allowedTools = computed(() => SETTINGS_TOOLS.filter((t) => canSee(t, this.store.access())));

  readonly groups = computed<GroupView[]>(() => {
    const rows = this.allowedRows().filter((d) => this.store.visible(d));
    const tools = this.allowedTools();
    return SETTINGS_GROUPS.map((group) => {
      const g = rowsOfGroup(group.id, rows);
      return {
        group,
        main: g.filter((d) => !d.advanced),
        more: g.filter((d) => d.advanced),
        tools: tools.filter((t) => t.group === group.id),
      };
    }).filter((v) => v.main.length + v.more.length + v.tools.length > 0);   // hide empty groups
  });

  readonly searching = computed(() => this.q().trim().length > 0);
  readonly resultRows = computed(() =>
    searchRows(this.allowedRows().filter((d) => this.store.visible(d)), this.q()));
  readonly resultTools = computed(() => this.allowedTools().filter((t) => matchTool(t, this.q())));
  readonly resultCount = computed(() => this.resultRows().length + this.resultTools().length);

  constructor() {
    // Load every store the visible rows need — again when the branch that
    // "This branch" rows edit changes, or when permissions arrive.
    effect(() => {
      const rows = this.allowedRows();
      this.store.branchId();
      untracked(() => this.store.ensure(rows));
    });
  }

  ngAfterViewInit(): void {
    const g = this.route.snapshot.queryParamMap.get('g') as GroupId | null;
    const frag = this.route.snapshot.fragment;
    if (frag?.startsWith('row-')) {
      const def = SETTINGS.find((d) => 'row-' + d.id === frag);
      if (def?.advanced) this.setMore(def.group, true);
      setTimeout(() => this.scrollTo(frag), 60);
    } else if (g) {
      setTimeout(() => this.jump(g), 60);
    }
  }

  isMoreOpen(g: GroupId): boolean { return this.openMore().has(g); }
  setMore(g: GroupId, open: boolean): void {
    const next = new Set(this.openMore());
    if (open) next.add(g); else next.delete(g);
    this.openMore.set(next);
  }

  /** Group chip: jump to the group (the list scrolls, not the page). */
  jump(g: GroupId): void {
    if (this.searching()) this.q.set('');
    setTimeout(() => this.scrollTo('grp-' + g), 0);
  }

  private scrollTo(id: string): void {
    const el = this.list?.nativeElement.querySelector<HTMLElement>('#' + CSS.escape(id));
    if (!el) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

}
