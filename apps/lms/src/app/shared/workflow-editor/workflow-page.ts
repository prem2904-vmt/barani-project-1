import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import type { ProcessWorkflowRecord } from './wf-model';
import { KNOWN_ROLES } from './wf-model';
import { WORKFLOW_BACKEND, WorkflowVersion } from './workflow-backend';
import {
  Lane, RolePerms, SearchHit, WfWarning, WorkflowEditor, areaVisibleTo, computeWarnings, configFromLanes, diffAreas,
  lanesFromConfig, parseConfig, searchHits,
} from './workflow-editor';

/** A thrown API error → plain words (both surfaces' errors carry `message`; never raw HTTP text). */
function errText(e: unknown, fallback = 'That did not work. Try again.'): string {
  const m = (e as { message?: unknown; error?: { message?: unknown } } | null);
  const msg = typeof m?.error?.message === 'string' ? m.error.message : typeof m?.message === 'string' ? m.message : '';
  return msg && !/^Http failure|^\d{3}\b/.test(msg) ? msg : fallback;
}

/**
 * The workflow page's state: which workflow / branch is open, the editor, the selected work area, search, "See it
 * as", warnings, branch differences and History. Provided by each page (LMS Work steps, console Master workflow)
 * next to its WORKFLOW_BACKEND; the band tools and the editor body both read it.
 */
@Injectable()
export class WorkflowPage {
  private readonly backend = inject(WORKFLOW_BACKEND);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);

  readonly editor = new WorkflowEditor(msg => this.toasts.info(msg));

  readonly loading = signal(true);
  readonly workflows = signal<ProcessWorkflowRecord[]>([]);
  readonly branches = signal<{ id: string; name: string }[]>([]);
  readonly roles = signal<string[]>(KNOWN_ROLES);
  readonly perms = signal<RolePerms>(null);
  /** Branch being configured; null = All branches (the tenant-wide default). */
  readonly scope = signal<string | null>(null);
  readonly currentId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly op = signal<'new' | 'duplicate' | 'activate' | null>(null);

  readonly selectedAreaId = signal<string | null>(null);
  readonly q = signal('');
  readonly seeAs = signal('');
  /** The row a warning / search sends the person to (flashed). */
  readonly flashId = signal<string | null>(null);
  readonly warningsOpen = signal(false);
  readonly historyOpen = signal(false);
  readonly history = signal<WorkflowVersion[] | null>(null);
  readonly historyLoading = signal(false);

  // ── Derived ──
  readonly current = computed(() => this.workflows().find(w => w.id === this.currentId()) ?? null);
  readonly isActive = computed(() => !!this.current()?.isActive);
  readonly isSystemDefault = computed(() => !!this.current()?.isSystemDefault);
  readonly scopedWorkflows = computed(() => this.workflows().filter(w => (w.branchId ?? null) === this.scope()));
  readonly dirty = computed(() => this.editor.dirty());
  readonly lanes = computed(() => this.editor.lanes());
  readonly selectedLane = computed<Lane | null>(() => this.lanes().find(l => l.cat.id === this.selectedAreaId()) ?? this.lanes()[0] ?? null);

  branchName(id: string | null): string {
    return id === null ? 'All branches' : (this.branches().find(b => b.id === id)?.name ?? 'Branch');
  }

  /** The live (active) workflow of a scope; a branch without its own runs the default's. */
  private liveOf(branchId: string | null): ProcessWorkflowRecord | null {
    const ws = this.workflows();
    const own = ws.find(w => (w.branchId ?? null) === branchId && w.isActive);
    if (own || branchId === null) return own ?? ws.find(w => (w.branchId ?? null) === null) ?? null;
    return this.liveOf(null);
  }
  readonly liveName = computed(() => this.liveOf(this.scope())?.name ?? '');

  /** The default's lanes (what a branch is compared with). */
  readonly defaultLanes = computed<Lane[]>(() => {
    const d = this.liveOf(null);
    return d ? lanesFromConfig(parseConfig(d.configJson)) : [];
  });
  readonly diff = computed(() => (this.scope() === null ? null : diffAreas(this.defaultLanes(), this.lanes())));
  isChanged(areaId: string): boolean { return !!this.diff()?.changed.has(areaId); }

  /** Changes of a branch's own live workflow against the default (0 = it runs the default). */
  branchChanges(branchId: string): number {
    if (branchId === this.scope()) return this.diff()?.count ?? 0;
    const own = this.workflows().find(w => (w.branchId ?? null) === branchId && w.isActive);
    return own ? diffAreas(this.defaultLanes(), lanesFromConfig(parseConfig(own.configJson))).count : 0;
  }

  /** The band's status line. */
  readonly statusLine = computed(() => {
    const cur = this.current();
    const who = this.scope() === null ? 'everyone' : `everyone in ${this.branchName(this.scope())}`;
    if (!cur) return `New draft for ${this.branchName(this.scope())} · Save makes it the navigation for ${who}`;
    if (cur.isActive) return `${cur.name} is live · Save changes the navigation for ${who} at once`;
    const live = this.liveName();
    return live ? `${cur.name} is not live · ${live} drives the navigation` : `${cur.name} is not live`;
  });

  readonly warnings = computed<WfWarning[]>(() => computeWarnings(this.lanes(), this.roles(), this.perms()));

  readonly hits = computed<SearchHit[]>(() => searchHits(this.q(), this.lanes(), this.editor.unused()));
  readonly searchNote = computed(() => {
    const h = this.hits(); const t = this.q().trim();
    if (!t) return '';
    if (!h.length) return 'No match';
    const where = h[0].areaId ? `in ${h[0].where}` : 'not used yet — in Add action';
    return `${h.length} ${h.length === 1 ? 'match' : 'matches'} — ${where}`;
  });

  /** "See it as": the areas the role sees. */
  visibleFor(lane: Lane): boolean { return !this.seeAs() || areaVisibleTo(lane, this.seeAs(), this.perms()); }
  readonly seeAsCount = computed(() => this.lanes().filter(l => areaVisibleTo(l, this.seeAs(), this.perms())).length);

  constructor() {
    // Search jumps: the first match's area opens and its row lights up.
    effect(() => {
      const first = this.hits()[0];
      untracked(() => {
        if (!first?.areaId) { this.flashId.set(null); return; }
        this.selectedAreaId.set(first.areaId);
        this.flashId.set(first.itemId ?? null);
      });
    });
  }

  // ── Loading ──
  async init(): Promise<void> {
    this.loading.set(true);
    const [, branches, roles, perms] = await Promise.all([
      this.reload(),
      this.backend.branches().catch(() => []),
      this.backend.roles().catch(() => [] as string[]),
      this.backend.rolePermissions().catch(() => null),
    ]);
    this.branches.set(branches ?? []);
    if (roles?.length) this.roles.set(roles);
    this.perms.set(perms ?? null);
  }

  async reload(selectId?: string): Promise<void> {
    try {
      const list = await this.backend.list();
      this.workflows.set(list ?? []);
      const scoped = this.scopedWorkflows();
      const pick = (selectId && scoped.find(w => w.id === selectId)) || scoped.find(w => w.isActive) || scoped[0];
      if (pick) this.loadInto(pick); else this.draftFromDefault();
    } catch (e) {
      this.toasts.error(errText(e, 'Could not load the workflows.'));
    } finally {
      this.loading.set(false);
    }
  }

  private loadInto(rec: ProcessWorkflowRecord): void {
    this.currentId.set(rec.id);
    this.editor.load(parseConfig(rec.configJson), rec.name, true);
    this.keepSelection();
    this.history.set(null);
  }

  /** A scope without its own workflow: a draft cloned from the default (unsaved until Save). */
  private draftFromDefault(): void {
    const base = this.liveOf(null) ?? this.workflows()[0];
    this.currentId.set(null);
    this.editor.load(parseConfig(base?.configJson), `${this.branchName(this.scope())} workflow`, false);
    this.editor.markDraft();
    this.keepSelection();
    this.history.set(null);
  }

  private keepSelection(): void {
    const ids = this.lanes().map(l => l.cat.id);
    if (!ids.includes(this.selectedAreaId() ?? '')) this.selectedAreaId.set(ids[0] ?? null);
  }

  // ── Unsaved changes ──
  /** "Save your changes?" before something replaces what is on screen. true = go ahead. */
  async confirmLeave(): Promise<boolean> {
    if (!this.dirty()) return true;
    const r = await this.dialog.actions({
      title: 'Save your changes?',
      message: `You changed ${this.editor.name().trim() || 'this workflow'} but haven't saved.`,
      cancelLabel: 'Stay',
      actions: [
        { value: 'save', label: 'Save', variant: 'primary' },
        { value: 'leave', label: 'Leave without saving', variant: 'secondary' },
      ],
    });
    if (r.action === 'leave') return true;
    if (r.action === 'save') return this.save();
    return false;
  }

  async setScope(branchId: string | null): Promise<void> {
    if (this.scope() === branchId) return;
    if (!(await this.confirmLeave())) return;
    this.scope.set(branchId);
    const scoped = this.scopedWorkflows();
    const pick = scoped.find(w => w.isActive) ?? scoped[0];
    if (pick) this.loadInto(pick); else this.draftFromDefault();
  }

  async selectWorkflow(id: string): Promise<void> {
    if (id === this.currentId()) return;
    const w = this.workflows().find(x => x.id === id); if (!w) return;
    if (!(await this.confirmLeave())) return;
    this.loadInto(w);
  }

  discard(): void {
    const cur = this.current();
    if (cur) this.loadInto(cur); else this.draftFromDefault();
  }

  // ── Workflow menu ──
  async newWorkflow(): Promise<void> {
    if (!(await this.confirmLeave())) return;
    const base = this.liveOf(null) ?? this.workflows()[0];
    this.op.set('new');
    try {
      const cfg = lanesFromConfig(parseConfig(base?.configJson));
      const w = await this.backend.create('New workflow', configFromLanes(cfg), this.scope());
      await this.reload(w.id);
      this.toasts.success('Workflow created — it is not live until you set it active');
    } catch (e) { this.toasts.error(errText(e)); } finally { this.op.set(null); }
  }

  async duplicate(): Promise<void> {
    const id = this.currentId(); if (!id) return;
    if (!(await this.confirmLeave())) return;
    this.op.set('duplicate');
    try {
      const w = await this.backend.duplicate(id);
      await this.reload(w.id);
      this.toasts.success('Duplicated');
    } catch (e) { this.toasts.error(errText(e)); } finally { this.op.set(null); }
  }

  async activate(): Promise<void> {
    const id = this.currentId(); if (!id || this.isActive()) return;
    if (!(await this.confirmLeave())) return;
    this.op.set('activate');
    try {
      await this.backend.activate(id);
      this.backend.liveChanged?.();
      await this.reload(id);
      this.toasts.success('Workflow is live — the navigation is updated');
    } catch (e) { this.toasts.error(errText(e)); } finally { this.op.set(null); }
  }

  /** Save. Customising OUR standard flow forks the lab's own copy — said before it happens. */
  async save(): Promise<boolean> {
    if (this.saving()) return false;
    const id = this.currentId();
    const cfg = this.editor.config();
    const nm = this.editor.name().trim() || 'Workflow';
    const forking = this.isSystemDefault();
    if (forking) {
      const ok = await this.dialog.confirm({
        title: 'Create your own version of the standard flow?',
        message: `"${nm}" is the standard flow we ship and keep updated. Your changes are saved as a NEW workflow `
          + 'for your lab and it becomes live. The standard flow stays as shipped, so future improvements still reach you.',
        confirmLabel: 'Create my version',
        cancelLabel: 'Cancel',
        tone: 'primary',
      });
      if (!ok) return false;
    }
    this.saving.set(true);
    try {
      const wasLive = this.isActive();
      const w = id ? await this.backend.update(id, nm, cfg, this.scope()) : await this.backend.create(nm, cfg, this.scope());
      if (wasLive || w.isActive) this.backend.liveChanged?.();
      await this.reload(w.id);
      this.toasts.success(forking ? `Created "${w.name}" — the standard flow stays as shipped` : 'Saved');
      return true;
    } catch (e) {
      this.toasts.error(errText(e, 'Could not save. Try again.'));
      return false;
    } finally { this.saving.set(false); }
  }

  // ── History ──
  async openHistory(): Promise<void> {
    this.historyOpen.set(true);
    const id = this.currentId();
    if (!id) { this.history.set([]); return; }
    this.historyLoading.set(true);
    try { this.history.set(await this.backend.history(id)); }
    catch (e) { this.history.set([]); this.toasts.error(errText(e, 'Could not load the history.')); }
    finally { this.historyLoading.set(false); }
  }

  /** Restore = load that version as unsaved changes; Save makes it live (and keeps it as a new version). */
  restore(v: WorkflowVersion): void {
    this.editor.load(parseConfig(v.configJson), v.name || this.editor.name(), false);
    this.keepSelection();
    this.historyOpen.set(false);
    this.toasts.info(`Version ${v.version} is on screen — Save to make it the navigation again`);
  }

  // ── Warnings / jumps ──
  showMe(w: WfWarning): void {
    this.warningsOpen.set(false);
    const area = w.areaId ?? this.selectedLane()?.cat.id ?? null;
    if (area) this.selectedAreaId.set(area);
    this.flash(w.itemId ?? (w.kind === 'role-no-area' ? 'who' : w.areaId ? `area:${w.areaId}` : null));
  }

  flash(id: string | null): void {
    this.flashId.set(null);
    if (!id) return;
    queueMicrotask(() => this.flashId.set(id));
  }
}
