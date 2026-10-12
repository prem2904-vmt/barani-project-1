import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import type { ReportTemplate } from '../../../shared/models/report.model';
import type { Department } from '../../../shared/models/tenant.model';
import type { Test } from '../../../shared/models/test.model';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { SkeletonCardComponent } from '../../../shared/primitives/skeleton-kit.component';
import {
  DeptSequence, DeptSequenceMode, ReportSequencing, SequenceMode, SequenceRef,
  orderDepartmentsForEditor, orderItemsForEditor, readReportSequencing, sortItemsByMode, writeReportSequencing,
} from '../../../shared/utils/report-sequencing';
import { SeqItem, buildSequencePreviewTests, departmentItems } from './report-sequencing-preview';

type DeptOrderMode = 'default' | 'custom';
type OverrideMode = 'inherit' | DeptSequenceMode;

/**
 * Report designer → SEQUENCING: the order the report prints in.
 *   1. Department order — as booked (today) or the lab's own order.
 *   2. Inside a department — as booked / test number / alphabetical, lab-wide.
 *   3. One department's own order — incl. a Custom list (a profile is ONE item;
 *      its members keep the profile's own order).
 * Everything lives in the template metadata (`sequencing`, report-sequencing.ts)
 * and saves with the template; the live preview re-renders on every change.
 */
@Component({
  selector: 'pf-report-sequencing-editor',
  standalone: true,
  imports: [DragDropModule, SegmentedComponent, SelectComponent, SkeletonCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-rt-flat pf-seq">
      @if (loading()) {
        <pf-skeleton-card [lines]="8" [boxed]="false" label="Loading departments…"></pf-skeleton-card>
      } @else {
      <!-- 1 · Department order -->
      <div class="pf-rtb">
        <h4 class="pf-rtb-h">Department order</h4>
        <p class="pf-rtb-s">Which department prints first, second and so on. <strong>As booked</strong> is how reports print today: departments appear in the order their tests were booked.</p>
        <pf-segmented [options]="deptModeOptions" [value]="deptMode()" size="sm"
                      (valueChange)="setDeptMode($any($event))"></pf-segmented>
        @if (deptMode() === 'custom') {
          <div class="pf-seq__listhead">
            <span class="pf-seq__hint">Drag, or use the arrows. Alt + ↑ / ↓ moves the focused row. Departments added later print at the end.</span>
            <button type="button" class="pf-btn pf-btn--tertiary pf-seq__reset press" (click)="setDeptMode('default')">Reset to default</button>
          </div>
          <ul class="pf-seq__list" cdkDropList (cdkDropListDropped)="dropDept($event)" aria-label="Department print order" data-list="dept">
            @for (d of deptList(); track d.id; let i = $index; let first = $first; let last = $last) {
              <li class="pf-seq__row" cdkDrag cdkDragLockAxis="y" tabindex="0"
                  [attr.aria-label]="(i + 1) + '. ' + d.name" (keydown)="rowKey($event, 'dept', i)">
                <span class="pf-seq__grip" cdkDragHandle aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>
                </span>
                <span class="pf-seq__pos">{{ i + 1 }}</span>
                <span class="pf-seq__txt">
                  <span class="pf-seq__name">{{ d.name }}</span>
                  @if (d.code) { <span class="pf-seq__meta"><span class="pf-seq__code">{{ d.code }}</span></span> }
                </span>
                <button type="button" class="pf-seq__btn press" [disabled]="first" [attr.aria-label]="'Print ' + d.name + ' earlier'" title="Move up" (click)="moveDept(i, -1)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
                </button>
                <button type="button" class="pf-seq__btn press" [disabled]="last" [attr.aria-label]="'Print ' + d.name + ' later'" title="Move down" (click)="moveDept(i, 1)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <!-- 2 · Inside every department -->
      <div class="pf-rtb">
        <h4 class="pf-rtb-h">Tests inside a department</h4>
        <p class="pf-rtb-s">The order of tests within each department. A profile always prints as one block, with its tests in the profile's own order.</p>
        <pf-segmented [options]="labModeOptions" [value]="labMode()" size="sm"
                      (valueChange)="setLabMode($any($event))"></pf-segmented>
        <p class="pf-seq__explain">{{ modeExplain(labMode()) }}</p>
      </div>

      <!-- 3 · One department's own order -->
      <div class="pf-rtb">
        <h4 class="pf-rtb-h">One department's own order</h4>
        <p class="pf-rtb-s">Give a department a different order — or arrange its tests and profiles by hand.</p>
        @if (deptOptions().length) {
          <div class="pf-seq__deptsel">
            <label class="pf-seq__lbl">Department</label>
            <pf-select [options]="deptOptions()" [value]="focusDeptId()" (valueChange)="focusDeptId.set($any($event))"></pf-select>
          </div>
          <div class="pf-seq__deptsel">
            <label class="pf-seq__lbl">Order inside {{ focusDeptName() }}</label>
            <pf-select [options]="overrideOptions" [value]="focusMode()" (valueChange)="setFocusMode($any($event))"></pf-select>
          </div>
          @if (focusMode() !== 'custom') {
            <p class="pf-seq__explain">{{ focusMode() === 'inherit' ? 'Follows the order chosen above.' : modeExplain($any(focusMode())) }}</p>
          } @else {
            <div class="pf-seq__listhead">
              <span class="pf-seq__hint">{{ focusItems().length }} {{ focusItems().length === 1 ? 'item' : 'items' }} · tests added later print after this list.</span>
              <button type="button" class="pf-btn pf-btn--tertiary pf-seq__reset press" (click)="resetItems()">Reset list</button>
            </div>
            @if (focusItems().length === 0) {
              <p class="pf-seq__empty">No active tests or profiles in this department yet.</p>
            }
            <ul class="pf-seq__list pf-seq__list--items" cdkDropList (cdkDropListDropped)="dropItem($event)" aria-label="Test print order" data-list="item">
              @for (it of focusItems(); track it.id; let i = $index; let first = $first; let last = $last) {
                <li class="pf-seq__row" cdkDrag cdkDragLockAxis="y" tabindex="0"
                    [attr.aria-label]="(i + 1) + '. ' + it.name + (it.isProfile ? ' (profile)' : '')" (keydown)="rowKey($event, 'item', i)">
                  <span class="pf-seq__grip" cdkDragHandle aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>
                  </span>
                  <span class="pf-seq__pos">{{ i + 1 }}</span>
                  <span class="pf-seq__txt">
                    <span class="pf-seq__name">{{ it.name }}</span>
                    <span class="pf-seq__meta">
                      @if (it.isProfile) { <span class="pf-seq__tag">Profile</span> }
                      @if (it.code) { <span class="pf-seq__code">{{ it.code }}</span> }
                    </span>
                  </span>
                  <button type="button" class="pf-seq__btn press" [disabled]="first" [attr.aria-label]="'Print ' + it.name + ' earlier'" title="Move up" (click)="moveItem(i, -1)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
                  </button>
                  <button type="button" class="pf-seq__btn press" [disabled]="last" [attr.aria-label]="'Print ' + it.name + ' later'" title="Move down" (click)="moveItem(i, 1)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                </li>
              }
            </ul>
          }
        } @else {
          <p class="pf-seq__empty">No departments yet.</p>
        }
      </div>
      <span class="pf-seq__sr" role="status" aria-live="polite">{{ announce() }}</span>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pf-rtb { margin: 0; padding: 16px 0; border-top: 1px solid var(--glass-border, rgba(148,163,184,0.14)); }
    .pf-rtb:first-child { border-top: 0; padding-top: 2px; }
    .pf-rtb:last-of-type { padding-bottom: 0; }
    .pf-rtb-h { margin: 0 0 2px; font-size: 13px; font-weight: 600; color: var(--text-primary, #e2e8f0); }
    .pf-rtb-s { margin: 0 0 12px; font-size: 12px; line-height: 1.45; color: var(--text-tertiary, #94a3b8); }
    .pf-rtb-s strong { color: var(--text-secondary); font-weight: 600; }

    .pf-seq__explain { margin: 8px 0 0; font-size: 12px; line-height: 1.45; color: var(--text-tertiary, #94a3b8); }
    .pf-seq__listhead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 12px 0 8px; }
    .pf-seq__hint { flex: 1 1 220px; min-width: 0; font-size: 12px; line-height: 1.4; color: var(--text-tertiary, #94a3b8); }
    .pf-seq__reset { flex-shrink: 0; min-height: 44px; font-size: 12.5px; font-weight: 600; }
    .pf-seq__deptsel { max-width: 360px; margin-bottom: 10px; }
    .pf-seq__empty { margin: 8px 0 0; font-size: 12.5px; color: var(--text-tertiary, #94a3b8); }

    .pf-seq__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-seq__list--items { max-height: 460px; overflow-y: auto; overscroll-behavior: contain; padding-right: 2px; }
    .pf-seq__lbl { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 500; color: var(--text-tertiary, #94a3b8); }
    .pf-seq__txt { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; column-gap: 10px; row-gap: 2px; padding: 6px 0; }
    .pf-seq__meta { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
    @media (max-width: 560px) { .pf-seq__meta { margin-left: 0; } }
    .pf-seq__row { flex-shrink: 0; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 6px 0 10px;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.25)); border-radius: 12px;
      background: var(--glass-bg, rgba(255,255,255,.03)); color: var(--text-primary); outline: none; }
    .pf-seq__row:focus-visible { border-color: var(--input-border-focus, #8b5cf6);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--input-border-focus, #8b5cf6) 22%, transparent); }
    .pf-seq__grip { display: inline-flex; flex-shrink: 0; color: var(--text-tertiary); cursor: grab; touch-action: none; padding: 8px 0; }
    .pf-seq__pos { min-width: 18px; flex-shrink: 0; text-align: right; font-size: 11px; font-weight: 600;
      color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-seq__name { flex: 0 1 auto; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.3; overflow-wrap: break-word; }
    .pf-seq__code { flex-shrink: 0; font-size: 11.5px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-seq__tag { flex-shrink: 0; font-size: 10.5px; font-weight: 600; letter-spacing: .04em; padding: 2px 8px; border-radius: 999px;
      color: var(--text-secondary); background: color-mix(in srgb, #64748b 16%, transparent); }
    .pf-seq__btn { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px;
      border-radius: 10px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .pf-seq__btn:hover:not(:disabled) { color: var(--text-primary); border-color: color-mix(in srgb, #a855f7 50%, transparent); }
    .pf-seq__btn:disabled { opacity: .35; cursor: default; }
    @media (pointer: coarse) { .pf-seq__btn { width: 44px; height: 44px; } }
    .cdk-drag-preview.pf-seq__row { opacity: .92; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
    .pf-seq__list .cdk-drag-placeholder { opacity: .25; }
    .pf-seq__list.cdk-drop-list-dragging .pf-seq__row:not(.cdk-drag-placeholder) { transition: transform 200ms cubic-bezier(0, 0, 0.2, 1); }
    @media (prefers-reduced-motion: reduce) { .pf-seq__list.cdk-drop-list-dragging .pf-seq__row { transition: none; } }
    .pf-seq__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `],
})
export class ReportSequencingEditorComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** The template being edited — sequencing is read from its metadata. */
  readonly template = input.required<ReportTemplate>();
  /** A new metadata string (the parent patches it into the template). */
  readonly metadataChange = output<string>();
  /** A preview order built from the lab's own departments + tests. */
  readonly previewTests = output<Array<Record<string, unknown>>>();

  readonly loading = signal(true);
  private readonly departments = signal<Department[]>([]);
  private readonly tests = signal<Test[]>([]);
  readonly focusDeptId = signal<string>('');
  readonly announce = signal('');

  readonly seq = computed<ReportSequencing>(() => readReportSequencing(this.template()));

  readonly deptModeOptions: SegmentedOption<DeptOrderMode>[] = [
    { value: 'default', label: 'As booked', hint: 'Today: departments print in the order their tests were booked' },
    { value: 'custom', label: 'Custom order', hint: 'Arrange the departments yourself' },
  ];
  readonly labModeOptions: SegmentedOption<SequenceMode>[] = [
    { value: 'ordered', label: 'As booked' },
    { value: 'code', label: 'Test number' },
    { value: 'alpha', label: 'Alphabetical' },
  ];
  readonly overrideOptions: PfSelectOption<OverrideMode>[] = [
    { value: 'inherit', label: 'Same as all departments' },
    { value: 'ordered', label: 'As booked' },
    { value: 'code', label: 'Test number' },
    { value: 'alpha', label: 'Alphabetical' },
    { value: 'custom', label: 'Custom — arrange by hand' },
  ];

  modeExplain(m: SequenceMode): string {
    switch (m) {
      case 'code': return 'By test number (Test Master code) — a profile by its own number.';
      case 'alpha': return 'A to Z by test name — a profile by its profile name.';
      default: return 'The order the tests were booked at the desk — how reports print today.';
    }
  }

  readonly deptMode = computed<DeptOrderMode>(() => this.seq().departments?.length ? 'custom' : 'default');
  readonly deptList = computed(() => orderDepartmentsForEditor(this.departments(), this.seq().departments));
  readonly labMode = computed<SequenceMode>(() => this.seq().mode ?? 'ordered');
  readonly deptOptions = computed<PfSelectOption<string>[]>(() =>
    this.deptList().map(d => ({ value: d.id, label: d.name })));

  private readonly focusDept = computed(() => this.departments().find(d => d.id === this.focusDeptId()) ?? null);
  readonly focusDeptName = computed(() => this.focusDept()?.name ?? 'this department');
  /** The saved config for the department being arranged (by id, then code). */
  private readonly focusCfg = computed<DeptSequence | undefined>(() => {
    const d = this.focusDept();
    const depts = this.seq().depts;
    if (!d || !depts) return undefined;
    return depts[d.id] ?? Object.values(depts).find(x => !!x.code && x.code.toUpperCase() === (d.code ?? '').toUpperCase());
  });
  readonly focusMode = computed<OverrideMode>(() => this.focusCfg()?.mode ?? 'inherit');
  private readonly focusAll = computed<SeqItem[]>(() => {
    const d = this.focusDept();
    return d ? departmentItems(d, this.tests()) : [];
  });
  /** The Custom list: saved order first, items added since after it (in the
   *  lab-wide order). */
  readonly focusItems = computed<SeqItem[]>(() =>
    orderItemsForEditor(sortItemsByMode(this.focusAll(), this.labMode()), this.focusCfg()?.items));

  constructor() {
    // The designer's preview: the lab's own departments/tests in a desk order.
    effect(() => {
      const depts = this.departments(), tests = this.tests(), focus = this.focusDeptId();
      if (!depts.length || !tests.length) return;
      this.previewTests.emit(buildSequencePreviewTests(depts, tests, focus || null));
    });
  }

  ngOnInit() {
    let pending = 2;
    const done = () => { if (--pending === 0) this.loading.set(false); };
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: list => {
        const depts = dedupeByCode((list ?? []).filter(d => d.isActive !== false));
        this.departments.set(depts);
        if (!this.focusDeptId() && depts.length) this.focusDeptId.set(this.deptList()[0]?.id ?? depts[0].id);
        done();
      },
      error: () => { this.toasts.error('Failed to load departments'); done(); },
    });
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: list => { this.tests.set(list ?? []); done(); },
      error: () => { this.toasts.error('Failed to load tests'); done(); },
    });
  }

  // ── Writes (each one patches the template metadata) ──────────────────
  private write(next: ReportSequencing) {
    this.metadataChange.emit(writeReportSequencing(this.template(), next));
  }
  private deptRefs(list: Department[]): SequenceRef[] {
    return list.map(d => ({ id: d.id, code: d.code || null, name: d.name || null }));
  }

  setDeptMode(m: DeptOrderMode) {
    const s = { ...this.seq() };
    if (m === 'default') delete s.departments;
    else s.departments = this.deptRefs(this.deptList());
    this.write(s);
    this.announce.set(m === 'default' ? 'Departments print as booked.' : 'Custom department order.');
  }
  moveDept(i: number, delta: -1 | 1) {
    const list = this.deptList().slice();
    const to = i + delta;
    if (to < 0 || to >= list.length) return;
    moveItemInArray(list, i, to);
    this.write({ ...this.seq(), departments: this.deptRefs(list) });
    this.announce.set(`${list[to].name} moved to position ${to + 1}.`);
    this.refocus('dept', to);
  }
  dropDept(ev: CdkDragDrop<unknown>) {
    if (ev.previousIndex === ev.currentIndex) return;
    const list = this.deptList().slice();
    moveItemInArray(list, ev.previousIndex, ev.currentIndex);
    this.write({ ...this.seq(), departments: this.deptRefs(list) });
  }

  setLabMode(m: SequenceMode) {
    const s = { ...this.seq() };
    if (m === 'ordered') delete s.mode; else s.mode = m;
    this.write(s);
  }

  setFocusMode(m: OverrideMode) {
    const d = this.focusDept();
    if (!d) return;
    const depts = { ...(this.seq().depts ?? {}) };
    // Drop any entry for this department (by id or by its code).
    for (const [k, v] of Object.entries(depts)) {
      if (k === d.id || (!!v.code && v.code.toUpperCase() === (d.code ?? '').toUpperCase())) delete depts[k];
    }
    if (m !== 'inherit') {
      const entry: DeptSequence = { mode: m, code: d.code || null, name: d.name || null };
      if (m === 'custom') entry.items = this.itemRefs(this.focusItems());
      depts[d.id] = entry;
    }
    const s = { ...this.seq() };
    if (Object.keys(depts).length) s.depts = depts; else delete s.depts;
    this.write(s);
  }
  private itemRefs(items: SeqItem[]): SequenceRef[] {
    return items.map(i => ({ id: i.id, code: i.code || null }));
  }
  private writeItems(items: SeqItem[]) {
    const d = this.focusDept();
    if (!d) return;
    const depts = { ...(this.seq().depts ?? {}) };
    depts[d.id] = { mode: 'custom', code: d.code || null, name: d.name || null, items: this.itemRefs(items) };
    this.write({ ...this.seq(), depts });
  }
  moveItem(i: number, delta: -1 | 1) {
    const list = this.focusItems().slice();
    const to = i + delta;
    if (to < 0 || to >= list.length) return;
    moveItemInArray(list, i, to);
    this.writeItems(list);
    this.announce.set(`${list[to].name} moved to position ${to + 1}.`);
    this.refocus('item', to);
  }
  dropItem(ev: CdkDragDrop<unknown>) {
    if (ev.previousIndex === ev.currentIndex) return;
    const list = this.focusItems().slice();
    moveItemInArray(list, ev.previousIndex, ev.currentIndex);
    this.writeItems(list);
  }
  /** The Custom list back to the lab-wide order. */
  resetItems() {
    this.writeItems(sortItemsByMode(this.focusAll(), this.labMode()));
    this.announce.set('List reset.');
  }

  /** Alt + ↑ / ↓ on a focused row moves it (keyboard reordering). */
  rowKey(ev: KeyboardEvent, list: 'dept' | 'item', i: number) {
    if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
    ev.preventDefault();
    const delta = ev.key === 'ArrowUp' ? -1 : 1;
    if (list === 'dept') this.moveDept(i, delta); else this.moveItem(i, delta);
  }
  private refocus(list: 'dept' | 'item', i: number) {
    setTimeout(() => {
      const rows = (this.host.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(`[data-list="${list}"] > .pf-seq__row`);
      rows[i]?.focus();
    });
  }
}

/** Departments can come one per branch (legacy) — one entry per code. */
function dedupeByCode(list: Department[]): Department[] {
  const byKey = new Map<string, Department>();
  for (const d of list) {
    const key = (d.code?.trim() || d.name?.trim() || d.id).toUpperCase();
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, d); continue; }
    if (existing.branchId && !d.branchId) byKey.set(key, d);
  }
  return [...byKey.values()];
}
