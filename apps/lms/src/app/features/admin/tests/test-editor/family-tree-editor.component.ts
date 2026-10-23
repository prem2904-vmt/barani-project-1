import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { SelectComponent, type PfSelectOption } from '../../../../shared/primitives/select.component';
import { FAMILY_MAX_DEPTH, type FamilyNode, type OptionFamily, codeFromLabel } from '../../../../shared/utils/option-family';
import { familyTreeOps, nodesAt, updateNode } from './family-tree';
import { type SubtestChoice, isTypedSubchoice, linkNodeToTest, subtestOptions } from './family-subtest';

/**
 * The family TREE editor, embedded in a profile's family line (owner
 * 2026-10-23: a family lives INSIDE a profile — no separate Families tab).
 * Answers at the root (one is picked; "Normal" marks the expected one), each
 * answer may open sub-choices (many picks or one) and carry an amount: a
 * list, a number or text, with a unit; at most 4 levels.
 * Edits the bound `family` model in place (immutable updates); the host saves.
 *
 * Sub-choices (any level below the root) are REAL tests (owner 2026-10-23):
 * picked from THIS profile's own member tests (`subtests`, revision 2 — no
 * catalogue search). A pick sets the code / name / link and prefills the
 * amount from the test's own answers; the picked member is then entered only
 * through the family. Older typed sub-choices keep working and offer "Link
 * to a test". No free member left → a plain "Add tests to this profile
 * first" note instead of an empty list.
 */
@Component({
  selector: 'pf-family-tree-editor',
  standalone: true,
  imports: [NgTemplateOutlet, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (family(); as d) {
      <div class="pf-of__slabel">Answers — the tech picks one</div>
      <ng-container [ngTemplateOutlet]="level" [ngTemplateOutletContext]="{ $implicit: d.nodes, path: [], depth: 1 }"></ng-container>
    }

    <!-- Editable tree level. path = index path of the parent node. -->
    <ng-template #level let-nodes let-path="path" let-depth="depth">
      <div class="pf-of__lvl" [class.pf-of__lvl--sub]="depth > 1" role="group">
        @for (n of nodes; track $index; let ni = $index; let last = $last) {
          @let np = idxPath(path, ni);
          <div class="pf-of__node" [attr.data-node]="np.join('.')">
            @let pickMode = depth > 1 && (!!n.test || !n.label.trim() || linking() === np.join('.'));
            <div class="pf-of__nrow">
              @if (pickMode && !n.test && subtests().length === 0) {
                <p class="pf-of__note pf-of__note--empty" data-testid="subtest-empty">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                  Add tests to this profile first — a sub-choice is one of the profile's own tests.
                </p>
                @if (linking() === np.join('.')) {
                  <button type="button" class="pf-btn pf-btn--tertiary pf-of__addbtn press" (click)="linking.set(null)">Cancel</button>
                }
              } @else if (pickMode) {
                <pf-select size="sm" class="pf-of__test" [searchable]="true" [options]="optionsFor(path)"
                           [value]="n.test ?? ''" [placeholder]="n.test ? n.label : 'Pick a test from this profile'"
                           [attr.data-subtest]="np.join('.')"
                           (valueChange)="pick(np, $any($event))"></pf-select>
                @if (n.test) { <span class="pf-num pf-of__tcode" [title]="'Test code ' + n.code">{{ n.code }}</span> }
                @if (linking() === np.join('.')) {
                  <button type="button" class="pf-btn pf-btn--tertiary pf-of__addbtn press" (click)="linking.set(null)">Cancel</button>
                }
              } @else {
                <input type="text" class="pf-input pf-input--sm pf-of__nlabel" [value]="n.label" [attr.aria-label]="'Answer ' + (ni + 1)"
                       placeholder="Answer — e.g. Present" (input)="ops.setLabel(np, $any($event.target).value)"
                       (blur)="ensureCode(np)" />
                <span class="pf-num pf-of__ncode" [title]="'Code ' + (n.code || '—')">{{ n.code || '—' }}</span>
                @if (isTyped(n, depth)) {
                  <button type="button" class="pf-btn pf-btn--tertiary pf-of__addbtn pf-of__link press" (click)="linking.set(np.join('.'))">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    Link to a test</button>
                }
              }
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
            @if (n.test && n.testMissing) {
              <p class="pf-of__note pf-of__note--warn" role="status">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                This test is no longer in Test Master. Reports keep “{{ n.label }}” — pick another test or remove this sub-choice.
              </p>
            }
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
          + Add {{ depth === 1 ? 'answer' : 'sub-choice (a test)' }}</button>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .pf-of__slabel { font-size: 12px; font-weight: 500; color: var(--text-secondary); margin: 4px 0 6px; }
    .pf-of__spacer { flex: 1; }
    .pf-of__mini { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-of__code, .pf-of__ncode { font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }
    .pf-of__flag { font-size: 12.5px; }
    .pf-of__lvl { display: flex; flex-direction: column; gap: 8px; }
    .pf-of__lvl--sub { padding-left: 12px; border-left: 2px solid var(--pf-line); margin-left: 4px; }
    .pf-of__node { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--pf-line);
      border-radius: 10px; background: var(--pf-card-bg); }
    .pf-of__nrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
    .pf-of__nlabel { flex: 1 1 160px; min-width: 0; }
    .pf-of__test { flex: 1 1 220px; min-width: 0; }
    .pf-of__tcode { font-size: 12px; color: var(--text-secondary); white-space: nowrap; padding: 2px 8px; border-radius: 999px;
      background: var(--pf-chip-bg); border: 1px solid var(--pf-line); }
    .pf-of__note { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; margin: 0; font-size: 12.5px; line-height: 1.4;
      color: var(--text-secondary); }
    .pf-of__note svg { flex: none; color: var(--text-tertiary); }
    .pf-of__note--empty { flex: 1 1 220px; min-width: 0; }
    .pf-of__note--warn, .pf-of__note--warn svg { color: var(--warning-text); }
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
    @media (max-width: 640px) { .pf-of__node input { font-size: 16px; } }
  `],
})
export class FamilyTreeEditorComponent {
  readonly family = model.required<OptionFamily>();
  readonly maxDepth = FAMILY_MAX_DEPTH;
  readonly ops = familyTreeOps(this.family);

  readonly qtyKinds: PfSelectOption<string>[] = [
    { value: '', label: 'None' },
    { value: 'choice', label: 'From a list' },
    { value: 'number', label: 'A number' },
    { value: 'text', label: 'Text' },
  ];

  /** The tests a sub-choice may be (host-built: this profile's own members,
   *  not family lines, not already in another family of the profile). */
  readonly subtests = input<readonly SubtestChoice[]>([]);
  /** The typed sub-choice being linked to a test (its index path). */
  readonly linking = signal<string | null>(null);

  private readonly byKey = computed(() => new Map(this.subtests().map(c => [c.key.toUpperCase(), c] as const)));
  private readonly baseOptions = computed(() => subtestOptions(this.subtests()));
  /** Picker rows per sub-list (key = parent index path): tests already picked
   *  beside it are shown but can't be picked twice. */
  private readonly optionsByParent = computed(() => {
    const out = new Map<string, ReturnType<typeof subtestOptions>>();
    const d = this.family();
    const choices = this.subtests();
    const walk = (nodes: FamilyNode[], path: number[]) => nodes.forEach((n, i) => {
      if (!n.children) return;
      const p = [...path, i];
      const taken = new Set(n.children.nodes.map(c => c.test ?? '').filter(Boolean));
      out.set(p.join('.'), taken.size ? subtestOptions(choices, taken) : this.baseOptions());
      walk(n.children.nodes, p);
    });
    if (d) walk(d.nodes, []);
    return out;
  });

  optionsFor(parentPath: readonly number[]) { return this.optionsByParent().get(parentPath.join('.')) ?? this.baseOptions(); }
  choiceOf(key: string | null | undefined): SubtestChoice | undefined { return key ? this.byKey().get(key.toUpperCase()) : undefined; }
  isTyped(n: FamilyNode, depth: number): boolean { return isTypedSubchoice(n, depth); }

  /** Link the sub-choice at `path` to the picked test. */
  pick(path: readonly number[], key: string) {
    const choice = this.choiceOf(key);
    const d = this.family();
    if (!choice || !d) return;
    const siblings = nodesAt(d, path.slice(0, -1)) ?? [];
    const codes = siblings.filter((_, i) => i !== path[path.length - 1]).map(s => s.code);
    this.family.set(updateNode(d, path, n => linkNodeToTest(n, choice, codes)));
    this.linking.set(null);
  }

  idxPath(path: readonly number[], i: number): number[] { return [...path, i]; }

  /** A new answer gets a stable code from its label once it has one. */
  ensureCode(path: readonly number[]) { this.ops.ensureCode(path, codeFromLabel); }
}
