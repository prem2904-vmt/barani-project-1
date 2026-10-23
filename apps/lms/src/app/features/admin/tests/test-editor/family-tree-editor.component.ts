import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { SelectComponent, type PfSelectOption } from '../../../../shared/primitives/select.component';
import { FAMILY_MAX_DEPTH, type OptionFamily, codeFromLabel } from '../../../../shared/utils/option-family';
import { familyTreeOps } from './family-tree';

/**
 * The family TREE editor, embedded in a profile's family line (owner
 * 2026-10-23: a family lives INSIDE a profile — no separate Families tab).
 * Answers at the root (one is picked; "Normal" marks the expected one), each
 * answer may open sub-choices (many picks or one) and carry an amount: a
 * list, a number or text, with a unit; at most 4 levels.
 * Edits the bound `family` model in place (immutable updates); the host saves.
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

  idxPath(path: readonly number[], i: number): number[] { return [...path, i]; }

  /** A new answer gets a stable code from its label once it has one. */
  ensureCode(path: readonly number[]) { this.ops.ensureCode(path, codeFromLabel); }
}
