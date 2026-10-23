import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ApiError } from '../../../../shared/models/api-response.model';
import { ActivatedRoute, Router } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, RowClickedEvent } from 'ag-grid-community';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { OptionFamilyService } from '../../../../core/services/option-family.service';
import { SelectComponent, type PfSelectOption } from '../../../../shared/primitives/select.component';
import { BusyDirective } from '../../../../shared/directives/busy.directive';
import { SkeletonCardComponent, SkeletonTableComponent } from '../../../../shared/primitives/skeleton-kit.component';
import { gridThemeDark, gridThemeLight } from './grid-theme';
import {
  FAMILY_MAX_DEPTH, type FamilyNode, type FamilyUse, type OptionFamily,
  codeFromLabel, familyCodeFromName, familyErrorText, validateFamily,
} from '../../../../shared/utils/option-family';
import { familyTreeOps, fillCodes } from './option-families-tree';

interface FamGridRow { fam: OptionFamily; name: string; code: string; answers: string; source: string; active: string; }

/**
 * Test Master → FAMILIES: hierarchical answer lists (Casts: Absent /
 * Present → cast types, each with its own amount). Same two-panel language
 * as Option groups: the AG-Grid lists every family once; the side card shows
 * the selected family's tree, or its editor (add / rename / reorder answers,
 * mark the normal root answer, open sub-choices with "many picks", give an
 * answer an amount: a list, a number or text, with a unit; max depth 4).
 * Delete is refused by the server (409) while a test uses the family.
 */
@Component({
  selector: 'pf-option-families-panel',
  standalone: true,
  imports: [AgGridAngular, NgTemplateOutlet, SelectComponent, BusyDirective, SkeletonTableComponent, SkeletonCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-of">
      <div class="pf-of__bar">
        @if (bandQuery() === null) {
          <input type="search" class="pf-input pf-of__search" placeholder="Search families, answers…" aria-label="Search option families"
                 [value]="query()" (input)="query.set($any($event.target).value)" />
        }
        <span class="pf-of__count"><span class="pf-num">{{ rows().length }}</span> famil{{ rows().length === 1 ? 'y' : 'ies' }}</span>
        <span class="pf-of__spacer"></span>
        @if (bandQuery() === null) {
          <button type="button" class="pf-btn press" [class.pf-btn--primary]="!editorOpen()" [class.pf-btn--secondary]="editorOpen()"
                  (click)="startCreate()">+ New family</button>
        }
      </div>

      <div class="pf-of__cols">
        <div class="pf-of__grid">
          @if (listSkeleton()) {
            <pf-skeleton-table class="pf-of__gridskel" [rows]="6" [cols]="5" label="Loading option families…"></pf-skeleton-table>
          }
          <ag-grid-angular style="width: 100%; height: 100%; min-height: 320px;"
            [theme]="gridTheme()" [rowData]="rows()" [columnDefs]="columnDefs" [defaultColDef]="defaultColDef"
            [animateRows]="true" [suppressCellFocus]="true" (rowClicked)="onRowClicked($event)"></ag-grid-angular>
        </div>

        @if (editorOpen()) { <div class="pf-sheet-backdrop" (click)="cancelEdit()" aria-hidden="true"></div> }
        <aside class="pf-card pf-of__side" [class.pf-sheet]="editorOpen()"
               [attr.aria-label]="draft() ? (isNew() ? 'New option family' : 'Edit option family') : 'Option family'">
          <span class="pf-sheet__handle" aria-hidden="true"></span>
          @if (listSkeleton() && !draft()) {
            <pf-skeleton-card [lines]="5" [boxed]="false" label="Loading option family…"></pf-skeleton-card>
          } @else if (draft(); as d) {
            <!-- ── EDITOR ── -->
            <div class="pf-card__head">
              <span class="pf-card__icon"><ng-container [ngTemplateOutlet]="treeIco"></ng-container></span>
              <span class="pf-card__label">{{ isNew() ? 'New family' : 'Edit family' }}</span>
              <span class="pf-card__spacer"></span>
              <button type="button" class="pf-btn pf-btn--tertiary pf-of__hbtn press" (click)="cancelEdit()">Cancel</button>
            </div>
            <div class="pf-card__body pf-of__body">
              <div class="pf-of__meta">
                <label class="pf-of__fld pf-of__fld--grow">
                  <span class="pf-of__slabel">Family name</span>
                  <input type="text" class="pf-input pf-input--sm" [value]="d.name" placeholder="e.g. Casts"
                         (input)="setName($any($event.target).value)" />
                </label>
                <div class="pf-of__fld">
                  <span class="pf-of__slabel">Code</span>
                  <span class="pf-num pf-of__code" [title]="isNew() ? 'Made from the name' : 'Codes never change once saved'">{{ d.code || '—' }}</span>
                </div>
                <button type="button" class="pf-toggle pf-of__flag" role="switch" [attr.aria-checked]="d.active !== false"
                        (click)="ops.setActive(d.active === false)"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>Active</button>
              </div>

              <div class="pf-of__slabel">Answers — the tech picks one</div>
              <ng-container [ngTemplateOutlet]="level" [ngTemplateOutletContext]="{ $implicit: d.nodes, path: [], depth: 1 }"></ng-container>
            </div>
            <div class="pf-of__editact">
              @if (issues().length) {
                <span class="pf-of__warn" role="status">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                  {{ issues()[0].message }}@if (issues().length > 1) { <span class="pf-of__more">(+{{ issues().length - 1 }} more)</span> }
                </span>
              } @else {
                <span class="pf-of__warn">@if (!isNew() && usedCount()) { Updates <span class="pf-num">{{ usedCount() }}</span> test{{ usedCount() === 1 ? '' : 's' }}. Past results keep their wording. }</span>
              }
              @if (!isNew()) {
                <button type="button" class="pf-btn pf-btn--danger pf-of__del press" [disabled]="saving()" (click)="remove(d)">Delete</button>
              }
              <button type="button" class="pf-btn pf-btn--primary press" [disabled]="saving() || issues().length > 0"
                      [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">{{ saving() ? 'Saving…' : (isNew() ? 'Create family' : 'Save family') }}</button>
            </div>
          } @else if (selected(); as f) {
            <!-- ── DETAIL ── -->
            <div class="pf-card__head">
              <span class="pf-card__icon"><ng-container [ngTemplateOutlet]="treeIco"></ng-container></span>
              <span class="pf-card__label pf-of__sname">{{ f.name }}</span>
              <span class="pf-card__spacer"></span>
              <button type="button" class="pf-btn pf-btn--secondary pf-of__hbtn press" (click)="startEdit(f)">Edit family</button>
            </div>
            <div class="pf-card__body pf-of__body">
              <div class="pf-of__detailmeta"><span class="pf-num">{{ f.code }}</span>@if (f.source === 'master') { · Default catalogue } @if (f.active === false) { · <span>Off</span> }</div>
              <ul class="pf-of__tree" role="tree" [attr.aria-label]="f.name">
                <ng-container [ngTemplateOutlet]="view" [ngTemplateOutletContext]="{ $implicit: f.nodes, depth: 1 }"></ng-container>
              </ul>
              <div class="pf-of__slabel">Used by @if (usage() !== null) { (<span class="pf-num">{{ usedCount() }}</span>) }</div>
              @if (usage() === null) { <p class="pf-of__note pf-of__note--inline">Loading tests…</p> }
              @for (u of usage() ?? []; track u.testId + (u.paramName ?? '')) {
                <button type="button" class="pf-row pf-of__test press" (click)="openTest(u.testId)">
                  <span class="pf-num pf-of__tcode">{{ u.testCode || '—' }}</span>
                  <span class="pf-row__name">{{ u.testName }}</span>
                </button>
              } @empty {
                @if (usage() !== null) { <p class="pf-of__note">No test uses this family yet — pick it in a test's Result entry.</p> }
              }
            </div>
          } @else {
            <div class="pf-of__note">Families are answer lists with sub-choices — e.g. Casts: Absent / Present → Hyaline, Granular… each with an amount. Select one, or create a new family.</div>
          }
        </aside>
      </div>
    </div>

    <!-- Read-only tree (detail). -->
    <ng-template #view let-nodes let-depth="depth">
      @for (n of nodes; track n.code) {
        <li class="pf-of__tnode" role="treeitem" [attr.aria-level]="depth">
          <span class="pf-of__tline">
            @if (depth === 1 && n.normal) {
              <svg class="pf-of__ncheck" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-label="Normal"><path d="M20 6 9 17l-5-5"/></svg>
            }
            <span class="pf-of__tlabel">{{ n.label }}</span>
            @if (qtyHint(n); as q) { <span class="pf-of__tqty">{{ q }}</span> }
          </span>
          @if (n.children?.nodes?.length) {
            <div class="pf-of__tkids">{{ n.children.label || 'Sub-choices' }} · {{ n.children.multi ? 'many picks' : 'one pick' }}</div>
            <ul class="pf-of__tree pf-of__tree--sub" role="group">
              <ng-container [ngTemplateOutlet]="view" [ngTemplateOutletContext]="{ $implicit: n.children.nodes, depth: depth + 1 }"></ng-container>
            </ul>
          }
        </li>
      }
    </ng-template>

    <!-- Editable tree level. path = index path of the parent node. -->
    <ng-template #level let-nodes let-path="path" let-depth="depth">
      <div class="pf-of__lvl" [class.pf-of__lvl--sub]="depth > 1" role="group">
        @for (n of nodes; track $index; let ni = $index; let last = $last) {
          @let np = idxPath(path, ni);
          <div class="pf-of__node" [attr.data-node]="np.join('.')">
            <div class="pf-of__nrow">
              <input type="text" class="pf-input pf-input--sm pf-of__nlabel" [value]="n.label" [attr.aria-label]="'Answer ' + (ni + 1)"
                     placeholder="Answer — e.g. Present" (input)="ops.setLabel(np, $any($event.target).value)"
                     (blur)="ensureCode(np)" />
              <span class="pf-num pf-of__ncode" [title]="'Code ' + (n.code || '—')">{{ n.code || '—' }}</span>
              @if (depth === 1) {
                <button type="button" class="pf-toggle pf-of__flag" role="switch" [attr.aria-checked]="n.normal === true"
                        (click)="ops.setNormal(np, n.normal !== true)"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>Normal</button>
              }
              <span class="pf-of__nact">
                <button type="button" class="pf-of__ibtn press" [disabled]="ni === 0" (click)="ops.move(np, -1)" title="Move up" aria-label="Move up"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg></button>
                <button type="button" class="pf-of__ibtn press" [disabled]="last" (click)="ops.move(np, 1)" title="Move down" aria-label="Move down"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
                <button type="button" class="pf-of__ibtn pf-of__ibtn--danger press" (click)="ops.remove(np)" title="Remove answer" aria-label="Remove answer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
              </span>
            </div>
            <div class="pf-of__nrow pf-of__nrow--opts">
              <span class="pf-of__mini">Amount</span>
              <pf-select size="sm" class="pf-of__qkind" [options]="qtyKinds" [value]="n.qty?.kind ?? ''"
                         (valueChange)="ops.setQtyKind(np, $any($event))"></pf-select>
              @if (n.qty?.kind === 'choice') {
                <input type="text" class="pf-input pf-input--sm pf-of__qopts" [value]="(n.qty?.options ?? []).join(', ')"
                       placeholder="Few, Moderate, Many" aria-label="Amount choices, comma separated"
                       (change)="ops.setQtyOptions(np, $any($event.target).value)" />
              }
              @if (n.qty) {
                <input type="text" class="pf-input pf-input--sm pf-of__qunit" [value]="n.qty?.unit ?? ''" placeholder="Unit — /LPF"
                       aria-label="Amount unit" (input)="ops.setQtyUnit(np, $any($event.target).value)" />
              }
              <span class="pf-of__spacer"></span>
              @if (!n.children && depth < maxDepth) {
                <button type="button" class="pf-btn pf-btn--tertiary pf-of__addbtn press" (click)="ops.addChildren(np)">+ Sub-choices</button>
              }
            </div>
            @if (n.children; as k) {
              <div class="pf-of__kids">
                <div class="pf-of__nrow">
                  <input type="text" class="pf-input pf-input--sm pf-of__klabel" [value]="k.label" placeholder="Sub-choice heading — e.g. Cast type"
                         aria-label="Sub-choice heading" (input)="ops.setChildrenLabel(np, $any($event.target).value)" />
                  <button type="button" class="pf-toggle pf-of__flag" role="switch" [attr.aria-checked]="k.multi"
                          (click)="ops.setMulti(np, !k.multi)"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>Many picks</button>
                  <button type="button" class="pf-of__ibtn pf-of__ibtn--danger press" (click)="ops.removeChildren(np)" title="Remove the sub-choices" aria-label="Remove the sub-choices"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                </div>
                <ng-container [ngTemplateOutlet]="level" [ngTemplateOutletContext]="{ $implicit: k.nodes, path: np, depth: depth + 1 }"></ng-container>
              </div>
            }
          </div>
        }
        <button type="button" class="pf-btn pf-btn--tertiary pf-of__addbtn press" (click)="ops.addNode(path)">
          + Add {{ depth === 1 ? 'answer' : 'sub-choice' }}</button>
      </div>
    </ng-template>

    <ng-template #treeIco>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h6v5H4zM14 15h6v5h-6zM14 4h6v5h-6z"/><path d="M7 9v8.5a1.5 1.5 0 0 0 1.5 1.5H14M10 6.5h4"/></svg>
    </ng-template>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
    .pf-of { display: flex; flex-direction: column; gap: 12px; flex: 1 1 auto; min-height: 0; }
    .pf-of__bar { display: flex; align-items: center; gap: 12px; flex: none; }
    .pf-of__spacer { flex: 1; }
    .pf-of__search { flex: 0 1 320px; }
    .pf-of__count { font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .pf-of__note--inline { padding: 8px 0; text-align: left; }
    .pf-of__note { padding: 28px 12px; text-align: center; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-of__cols { flex: 1 1 auto; min-height: 0; display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(420px, 1fr); grid-template-rows: minmax(0, 1fr); gap: 16px; align-items: stretch; }
    .pf-of__grid { position: relative; min-height: 0; border-radius: var(--pf-radius, 12px); overflow: hidden; }
    .pf-of__gridskel { position: absolute; inset: 0; z-index: 2; overflow: hidden; background: var(--pf-card-bg, var(--bg-primary)); border-radius: inherit; }
    .pf-of__side { min-height: 0; max-height: 100%; }
    .pf-of__side:not(.pf-sheet) .pf-sheet__handle { display: none; }
    @media (min-width: 641px) { .pf-of__cols > .pf-sheet-backdrop { display: none; } }
    .pf-of__body { gap: 8px; }
    .pf-of__sname { text-transform: none; letter-spacing: 0; font-size: 14px; color: var(--text-primary); }
    .pf-of__hbtn { height: 36px; min-height: 36px; }
    @media (max-width: 980px) {
      .pf-of__cols { grid-template-columns: 1fr; grid-template-rows: none; }
      .pf-of__grid { height: 45dvh; }
    }
    .pf-of__slabel { font-size: 12px; font-weight: 500; color: var(--text-secondary); margin: 10px 0 2px; }
    .pf-of__mini { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-of__meta { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .pf-of__fld { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-of__fld--grow { flex: 1 1 200px; }
    .pf-of__fld .pf-of__slabel { margin: 0; }
    .pf-of__code, .pf-of__ncode { font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }
    .pf-of__code { min-height: 32px; display: inline-flex; align-items: center; }
    .pf-of__flag { font-size: 12.5px; }

    .pf-of__lvl { display: flex; flex-direction: column; gap: 8px; }
    .pf-of__lvl--sub { padding-left: 12px; border-left: 2px solid var(--pf-line); margin-left: 4px; }
    .pf-of__node { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--pf-line);
      border-radius: 10px; background: var(--pf-card-bg); }
    .pf-of__nrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
    .pf-of__nlabel { flex: 1 1 160px; min-width: 0; }
    .pf-of__nact { display: inline-flex; gap: 2px; margin-left: auto; }
    .pf-of__qkind { width: 130px; }
    .pf-of__qopts { flex: 1 1 160px; min-width: 0; }
    .pf-of__qunit { width: 100px; }
    .pf-of__kids { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }
    .pf-of__klabel { flex: 1 1 160px; min-width: 0; }
    .pf-of__addbtn { align-self: flex-start; height: 34px; min-height: 34px; }
    .pf-of__ibtn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex: none;
      border-radius: 8px; border: 1px solid transparent; cursor: pointer; color: var(--text-tertiary); background: transparent; }
    .pf-of__ibtn:hover:not(:disabled) { color: var(--text-primary); border-color: var(--pf-line); }
    .pf-of__ibtn--danger:hover:not(:disabled) { color: var(--red-text, #b91c1c); }
    .pf-of__ibtn:disabled { opacity: .35; cursor: default; }

    .pf-of__editact { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 14px 14px;
      border-top: 1px solid var(--pf-line); background: var(--pf-card-bg); flex-wrap: wrap; }
    .pf-of__warn { flex: 1 1 200px; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); min-width: 0; }
    .pf-of__more { color: var(--text-tertiary); }

    .pf-of__detailmeta { font-size: 12px; color: var(--text-tertiary); }
    .pf-of__tree { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .pf-of__tree--sub { padding-left: 14px; border-left: 2px solid var(--pf-line); margin: 4px 0 2px 4px; }
    .pf-of__tnode { font-size: 13px; color: var(--text-primary); }
    .pf-of__tline { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 26px; }
    .pf-of__ncheck { color: var(--violet-text, #7c3aed); }
    .pf-of__tqty { font-size: 12px; color: var(--text-tertiary); }
    .pf-of__tkids { font-size: 11px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: var(--text-tertiary); margin-top: 2px; }
    .pf-of__test { width: 100%; cursor: pointer; min-height: 44px; }
    .pf-of__tcode { flex-shrink: 0; font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
    @media (max-width: 640px) { .pf-of__side.pf-sheet { z-index: 80; } .pf-of__node input { font-size: 16px; } }
  `],
})
export class OptionFamiliesPanelComponent implements OnInit {
  private readonly svc = inject(OptionFamilyService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  private readonly theme = inject(ThemeService);
  private readonly dialog = inject(DialogService);

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  /** Host-owned search (Test Master's band pill); null = own search box. */
  readonly bandQuery = input<string | null>(null);
  readonly query = signal('');
  private readonly effectiveQuery = computed(() => this.bandQuery() ?? this.query());
  readonly editingChange = output<boolean>();

  readonly maxDepth = FAMILY_MAX_DEPTH;
  readonly selected = signal<OptionFamily | null>(null);
  /** The family being edited / created (a deep copy). */
  readonly draft = signal<OptionFamily | null>(null);
  readonly isNew = signal(false);
  readonly saving = signal(false);
  readonly editorOpen = computed(() => !!this.draft());
  readonly listSkeleton = computed(() => !this.svc.loaded() && !this.svc.failed());
  readonly issues = computed(() => { const d = this.draft(); return d ? validateFamily(fillCodes(d, codeFromLabel)) : []; });
  /** Tree edits on the draft (pure helpers, tested on their own). */
  readonly ops = familyTreeOps(this.draft);

  readonly qtyKinds: PfSelectOption<string>[] = [
    { value: '', label: 'None' },
    { value: 'choice', label: 'From a list' },
    { value: 'number', label: 'A number' },
    { value: 'text', label: 'Text' },
  ];

  readonly defaultColDef: ColDef = { sortable: true, resizable: true, filter: false, suppressMovable: true };
  readonly columnDefs: ColDef<FamGridRow>[] = [
    { headerName: 'Family', field: 'name', minWidth: 120, flex: 1, cellStyle: { fontWeight: '600' } },
    { headerName: 'Answers', field: 'answers', minWidth: 150, flex: 1.2 },
    { headerName: 'Code', field: 'code', minWidth: 110, flex: 0.9 },
    { headerName: 'Source', field: 'source', minWidth: 90, maxWidth: 110 },
    { headerName: 'Status', field: 'active', minWidth: 76, maxWidth: 86 },
  ];

  readonly rows = computed<FamGridRow[]>(() => {
    const q = this.effectiveQuery().trim().toLowerCase();
    const hit = (nodes: FamilyNode[]): boolean => nodes.some(n => n.label.toLowerCase().includes(q) || hit(n.children?.nodes ?? []));
    return this.svc.families()
      .filter(f => !q || f.name.toLowerCase().includes(q) || f.code.toLowerCase().includes(q) || hit(f.nodes))
      .map(f => ({
        fam: f, name: f.name, code: f.code,
        answers: f.nodes.map(n => n.children?.nodes?.length ? `${n.label} → ${n.children.nodes.length}` : n.label).join(', '),
        source: f.source === 'master' ? 'Default' : 'This lab',
        active: f.active === false ? 'Off' : 'On',
      }));
  });

  constructor() {
    effect(() => this.editingChange.emit(this.editorOpen()));
    // The selected family's "used by" list — one request per selection.
    effect(() => { const code = this.selected()?.code; untracked(() => this.loadUsage(code)); });
    // Keep the selection pointing at the freshest copy after a reload; the
    // first load (or ?fam=<code>) selects one so the card is never empty.
    effect(() => {
      const list = this.svc.families();
      const cur = this.selected();
      if (cur) { this.selected.set(list.find(f => f.code === cur.code) ?? null); return; }
      if (!list.length || this.draft()) return;
      const wanted = this.route.snapshot.queryParamMap.get('fam');
      this.selected.set(list.find(f => f.code === wanted) ?? list[0]);
    });
  }

  ngOnInit() { this.svc.reload().subscribe({ error: () => this.toasts.error('Could not load option families') }); }

  /** Usage of the SELECTED family (one call per selection; null = loading). */
  readonly usage = signal<FamilyUse[] | null>(null);
  private usageFor = '';
  usedCount(): number { return new Set((this.usage() ?? []).map(u => u.testId)).size; }
  private loadUsage(code: string | null | undefined, force = false) {
    if (!code || (code === this.usageFor && !force)) return;
    this.usageFor = code;
    this.usage.set(null);
    this.svc.usage(code).subscribe({
      next: list => { if (this.usageFor === code) this.usage.set(list ?? []); },
      error: () => { if (this.usageFor === code) this.usage.set([]); },
    });
  }

  qtyHint(n: FamilyNode): string {
    const q = n.qty;
    if (!q) return '';
    const unit = q.unit ? ` ${q.unit}` : '';
    if (q.kind === 'choice') return `${(q.options ?? []).join(' / ')}${unit}`;
    if (q.kind === 'number') return `number${unit}`;
    return 'text';
  }

  idxPath(path: readonly number[], i: number): number[] { return [...path, i]; }

  onRowClicked(e: RowClickedEvent<FamGridRow>) {
    if (this.draft()) return;
    const f = e.data?.fam ?? null;
    this.selected.set(this.selected()?.code === f?.code ? null : f);
  }

  startCreate() {
    this.isNew.set(true);
    this.draft.set({ code: '', name: '', active: true, nodes: [
      { code: 'ABS', label: 'Absent', normal: true },
      { code: 'PRS', label: 'Present', normal: false },
    ] });
  }

  startEdit(f: OptionFamily) {
    this.isNew.set(false);
    const { source: _s, updatedAt: _t, ...def } = f;
    void _s; void _t;
    this.draft.set(structuredClone(def));
  }

  cancelEdit() { this.draft.set(null); this.isNew.set(false); }

  setName(name: string) {
    const d = this.draft();
    if (!d) return;
    const code = this.isNew() ? familyCodeFromName(name, this.svc.families().map(f => f.code)) : d.code;
    this.draft.set({ ...d, name, code });
  }

  /** A new answer gets a stable code from its label once it has one. */
  ensureCode(path: readonly number[]) {
    this.ops.ensureCode(path, (label, taken) => codeFromLabel(label, taken));
  }

  save() {
    const raw = this.draft();
    if (!raw || this.issues().length) return;
    const d = fillCodes(raw, codeFromLabel);
    this.saving.set(true);
    const call = this.isNew() ? this.svc.create(d) : this.svc.update(d);
    call.subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success(this.isNew() ? `Family "${d.name}" created` : `Family "${d.name}" saved`);
        this.selected.set({ ...d });
        this.cancelEdit();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.toasts.error(familyErrorText(ApiError.from(err).code) ?? serverMessage(err) ?? 'Could not save the option family');
      },
    });
  }

  async remove(d: OptionFamily) {
    const ok = await this.dialog.confirm({
      title: `Delete “${d.name}”?`,
      message: 'The family is removed from this lab. Tests that use it must be changed first — past results keep their wording.',
      confirmLabel: 'Delete family', cancelLabel: 'Keep it', tone: 'danger',
    });
    if (!ok) return;
    this.saving.set(true);
    this.svc.remove(d.code).subscribe({
      next: () => { this.saving.set(false); this.toasts.success(`Family "${d.name}" deleted`); this.selected.set(null); this.cancelEdit(); },
      error: async (err: unknown) => {
        this.saving.set(false);
        if (isInUse(err)) {
          await this.dialog.alert({ title: 'This family is in use', message: inUseMessage(err, this.usage() ?? []), confirmLabel: 'OK' });
          return;
        }
        this.toasts.error(familyErrorText(ApiError.from(err).code) ?? serverMessage(err) ?? 'Could not delete the option family');
      },
    });
  }

  openTest(testId: string) { this.router.navigate(['/admin/tests', testId, 'edit']); }
}

/** The API's message (ApiService normalises every failure to ApiError). */
function serverMessage(err: unknown): string | null {
  const m = ApiError.from(err).message?.trim();
  return m && m !== 'Request failed' && !m.startsWith('<') ? m : null;
}

/** "Used by: CLP002 Urine Microscopy, … — pick another answer type there
 *  first." Names come from the 409 payload (`data.tests`, mw
 *  CodedConflictException), else the usage already loaded. */
export function inUseMessage(err: unknown, loaded: FamilyUse[]): string {
  const payload = ApiError.from(err).data as { tests?: FamilyUse[] } | undefined;
  const tests = payload?.tests?.length ? payload.tests : loaded;
  const names = [...new Set(tests.map(u => [u.testCode, u.testName].filter(Boolean).join(' ')))].filter(Boolean);
  if (!names.length) return 'It can\u2019t be deleted while a test uses it. Change those tests first.';
  return `Used by: ${names.join(', ')}. Pick another answer type in ${names.length === 1 ? 'that test' : 'those tests'} first, then delete.`;
}

/** DELETE refused because a test still uses the family (HTTP 409, code
 *  `family_in_use` per the contract; the status itself is not exposed by
 *  ApiService, so the code / wording decides). */
export function isInUse(err: unknown): boolean {
  const e = ApiError.from(err);
  const status = (err as { status?: number } | null)?.status;
  return status === 409 || ['family_in_use', 'in_use', 'conflict'].includes(String(e.code ?? '').toLowerCase())
    || /\bin use\b|\bused by\b/i.test(e.message ?? '');
}
