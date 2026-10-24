import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { SelectComponent, type PfSelectOption } from '../../primitives/select.component';
import {
  type FamilyChildren, type FamilyNode, type FamilyValue, type OptionFamily,
  asFamilyValue, chooseRoot, itemAt, itemsAt, nodeAtPath, setItemQty, toggleItem,
} from '../../utils/option-family';

/**
 * Result-entry control for a FAMILY parameter (Casts: Absent / Present →
 * cast types, each with its own quantity). The ONE control both result-entry
 * screens use.
 *
 *  - the root answer is a pf-select;
 *  - a chosen answer with a sub-list shows it right below: checkboxes for a
 *    multi list, a pf-select for a single pick;
 *  - each ticked item shows its quantity control (choice → pf-select,
 *    number → numeric field + unit, text → field); deeper levels nest.
 *
 * Every focusable carries `pf-fam__f` (selects: `.pf-fam .pf-dd__trigger`)
 * so a host's Enter-advances walk steps through the family like any other
 * field. Emits the WHOLE new value (or null when cleared) — the host stores
 * it as-is (contract shape, shared/utils/option-family.ts).
 */
@Component({
  selector: 'pf-family-input',
  standalone: true,
  imports: [SelectComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKey($event)' },
  template: `
    <div class="pf-fam" [attr.data-family]="family()?.code ?? familyCode()">
      <pf-select size="sm" class="pf-fam__root" [enterAdvances]="true" [placeholder]="'—'"
                 [disabled]="disabled() || !family()"
                 [options]="rootOptions()" [value]="current()?.v ?? ''"
                 (valueChange)="onRoot($event)"></pf-select>
      @if (!family()) {
        <span class="pf-fam__miss" role="note">{{ missingText() }}</span>
      }
      @if (rootKids(); as kids) {
        <ng-container [ngTemplateOutlet]="level" [ngTemplateOutletContext]="{ $implicit: kids, path: [current()!.v], depth: 1 }"></ng-container>
      }
    </div>

    <ng-template #level let-kids let-path="path" let-depth="depth">
      <div class="pf-fam__level" role="group" [attr.aria-label]="kids.label" [style.--pf-fam-depth]="depth">
        @if (kids.label) { <div class="pf-fam__lvlname">{{ kids.label }}</div> }
        @if (kids.multi) {
          @for (n of kids.nodes; track n.code) {
            @let p = pathOf(path, n.code);
            @let on = isOn(p);
            <div class="pf-fam__item" [class.pf-fam__item--on]="on">
              <label class="pf-fam__check">
                <input type="checkbox" class="pf-fam__cb pf-fam__f" [checked]="on" [disabled]="disabled()"
                       [attr.data-fam-path]="p.join('/')"
                       (change)="onToggle(path, n.code, $any($event.target).checked)" />
                <span class="pf-fam__lbl">{{ n.label }}</span>
              </label>
              @if (on && n.qty) {
                <ng-container [ngTemplateOutlet]="qty" [ngTemplateOutletContext]="{ $implicit: n, path: p }"></ng-container>
              }
            </div>
            @if (on && n.children?.nodes?.length) {
              <ng-container [ngTemplateOutlet]="level" [ngTemplateOutletContext]="{ $implicit: n.children, path: p, depth: depth + 1 }"></ng-container>
            }
          }
        } @else {
          @let picked = pickedIn(path);
          <div class="pf-fam__item pf-fam__item--single">
            <pf-select size="sm" class="pf-fam__one" [enterAdvances]="true" [placeholder]="'—'" [disabled]="disabled()"
                       [options]="nodeOptions(kids)" [value]="picked?.code ?? ''"
                       (valueChange)="onSingle(path, kids, $event)"></pf-select>
            @if (picked?.qty) {
              <ng-container [ngTemplateOutlet]="qty" [ngTemplateOutletContext]="{ $implicit: picked, path: pathOf(path, picked!.code) }"></ng-container>
            }
          </div>
          @if (picked?.children?.nodes?.length) {
            <ng-container [ngTemplateOutlet]="level" [ngTemplateOutletContext]="{ $implicit: picked!.children, path: pathOf(path, picked!.code), depth: depth + 1 }"></ng-container>
          }
        }
      </div>
    </ng-template>

    <ng-template #qty let-n let-path="path">
      @let q = qtyOf(path);
      <span class="pf-fam__qty">
        @switch (n.qty.kind) {
          @case ('choice') {
            <pf-select size="sm" class="pf-fam__qsel" [enterAdvances]="true" [placeholder]="'Amount'" [disabled]="disabled()"
                       [options]="qtyOptions(n)" [value]="q"
                       (valueChange)="onQty(path, $event)"></pf-select>
          }
          @case ('number') {
            <input type="text" inputmode="decimal" class="pf-input pf-input--sm pf-fam__qin pf-fam__f"
                   [attr.aria-label]="n.label + ' amount'" placeholder="0" [disabled]="disabled()"
                   [value]="q" (change)="onQty(path, $any($event.target).value)"
                   (keydown)="onlyNumber($event)" />
          }
          @default {
            <input type="text" class="pf-input pf-input--sm pf-fam__qin pf-fam__qin--text pf-fam__f"
                   [attr.aria-label]="n.label + ' detail'" placeholder="Detail" [disabled]="disabled()"
                   [value]="q" (change)="onQty(path, $any($event.target).value)" />
          }
        }
        @if (n.qty.unit) { <span class="pf-fam__unit">{{ n.qty.unit }}</span> }
      </span>
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .pf-fam { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .pf-fam__miss { font-size: 12px; color: var(--text-tertiary); }
    .pf-fam__level {
      display: flex; flex-direction: column; gap: 4px;
      margin-left: 6px; padding: 4px 0 2px 12px;
      border-left: 2px solid var(--pf-line, rgba(148, 163, 184, .35));
    }
    .pf-fam__lvlname { font-size: 11px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-fam__item { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; min-height: 36px; }
    .pf-fam__item--single > .pf-fam__one { flex: 1 1 160px; min-width: 0; }
    .pf-fam__check { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; flex: 1 1 100%; min-width: 0;
      font-size: 13px; color: var(--text-secondary); min-height: 36px; }
    .pf-fam__item--on .pf-fam__check { color: var(--text-primary); font-weight: 500; }
    .pf-fam__cb { width: 18px; height: 18px; flex: none; margin: 0; accent-color: var(--color-violet-600, #7c3aed); }
    .pf-fam__lbl { overflow-wrap: anywhere; }
    .pf-fam__qty { display: inline-flex; align-items: center; gap: 6px; flex: 0 1 auto; min-width: 0; }
    /* Narrow column (the bench grid): the amount sits on its own line under
       its tick, aligned with the label; wide enough → beside it. */
    .pf-fam__item:not(.pf-fam__item--single) > .pf-fam__qty { margin-left: 26px; }
    @container (min-width: 330px) {
      .pf-fam__check { flex: 0 0 140px; }
      .pf-fam__item:not(.pf-fam__item--single) > .pf-fam__qty { margin-left: 0; }
    }
    .pf-fam__qsel { width: 140px; max-width: 100%; }
    .pf-fam__qin { width: 80px; min-width: 0; }
    .pf-fam__qin--text { width: 160px; }
    .pf-fam__unit { font-size: 12.5px; color: var(--text-tertiary); white-space: nowrap; }
    @media (pointer: coarse) {
      .pf-fam__cb { width: 22px; height: 22px; }
      .pf-fam__item, .pf-fam__check { min-height: 44px; }
    }
    @media (max-width: 640px) {
      .pf-fam__qin { font-size: 16px; }
    }
  `],
})
export class FamilyInputComponent {
  private readonly el = inject(ElementRef<HTMLElement>);
  /** The family definition (null = not loaded / unknown code). */
  readonly family = input<OptionFamily | null>(null);
  /** The parameter's family code (shown when the definition is missing). */
  readonly familyCode = input<string | null>(null);
  /** The stored value (family object; anything else reads as empty). */
  readonly value = input<unknown>(null);
  readonly disabled = input(false);
  /** True while the family list is still loading. */
  readonly loading = input(false);
  readonly valueChange = output<FamilyValue | null>();

  readonly current = computed<FamilyValue | null>(() => asFamilyValue(this.value()));

  readonly rootOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: '—' },
    ...(this.family()?.nodes ?? []).map(n => ({ value: n.code, label: n.label })),
    // A stored answer whose node was removed since: keep it visible.
    ...this.orphanRoot(),
  ]);

  readonly rootKids = computed<FamilyChildren | null>(() => {
    const v = this.current();
    const node = v ? this.family()?.nodes.find(n => n.code === v.v) : null;
    return node?.children?.nodes?.length ? node.children : null;
  });

  missingText(): string {
    if (this.loading()) return 'Loading answers…';
    const code = this.familyCode();
    return code ? `Option family ${code} isn't set up in this lab.` : 'No option family is linked to this value.';
  }

  private orphanRoot(): PfSelectOption<string>[] {
    const v = this.current();
    if (!v?.v || (this.family()?.nodes ?? []).some(n => n.code === v.v)) return [];
    return [{ value: v.v, label: v.label || v.v }];
  }

  pathOf(path: readonly string[], code: string): string[] { return [...path, code]; }

  isOn(path: readonly string[]): boolean { return !!itemAt(this.current(), path); }

  pickedIn(path: readonly string[]): FamilyNode | null {
    const items = itemsAt(this.current(), path);
    if (!items.length) return null;
    const parent = this.nodeAt(path);
    return parent?.children?.nodes.find(n => n.code === items[0].v) ?? null;
  }

  qtyOf(path: readonly string[]): string { return itemAt(this.current(), path)?.qty ?? ''; }

  nodeOptions(kids: FamilyChildren): PfSelectOption<string>[] {
    return [{ value: '', label: '—' }, ...kids.nodes.map(n => ({ value: n.code, label: n.label }))];
  }

  qtyOptions(n: FamilyNode): PfSelectOption<string>[] {
    return [{ value: '', label: '—' }, ...(n.qty?.options ?? []).filter(o => String(o ?? '').trim())
      .map(o => ({ value: o, label: o }))];
  }

  onRoot(code: string) {
    const def = this.family();
    if (!def) return;
    const next = chooseRoot(def, this.current(), String(code ?? ''));
    if (sameValue(next, this.current())) return;
    this.valueChange.emit(next);
  }

  onToggle(parentPath: readonly string[], code: string, on: boolean) {
    const def = this.family(), v = this.current();
    if (!def || !v) return;
    this.valueChange.emit(toggleItem(def, v, parentPath, code, on));
  }

  onSingle(parentPath: readonly string[], kids: FamilyChildren, code: string) {
    const def = this.family(), v = this.current();
    if (!def || !v) return;
    const cur = itemsAt(v, parentPath)[0]?.v ?? '';
    if (cur === code) return;
    let next = cur ? toggleItem(def, v, parentPath, cur, false) : v;
    if (code && kids.nodes.some(n => n.code === code)) next = toggleItem(def, next, parentPath, code, true);
    this.valueChange.emit(next);
  }

  onQty(path: readonly string[], qty: string) {
    const def = this.family(), v = this.current();
    if (!def || !v) return;
    if ((itemAt(v, path)?.qty ?? '') === String(qty ?? '').trim()) return;
    this.valueChange.emit(setItemQty(def, v, path, String(qty ?? '')));
  }

  /** Enter walks INSIDE the family first (root → sub-picks → amounts →
   *  deeper levels), then hands over to the host's next-field handler by
   *  re-sending Enter from the family's last field. Deferred one tick so a
   *  just-committed pick has rendered its sub-list. */
  onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || (e as KeyboardEvent & { pfFam?: boolean }).pfFam) return;
    const from = e.target as HTMLElement | null;
    if (!from) return;
    e.preventDefault();
    e.stopPropagation();
    setTimeout(() => {
      const list = this.focusables();
      const at = list.findIndex(x => x === from || x.contains(from));
      const next = at >= 0 ? list[at + 1] : undefined;
      if (next) {
        next.focus();
        if (next instanceof HTMLInputElement && next.type === 'text') next.select();
        next.scrollIntoView?.({ block: 'nearest' });
        return;
      }
      const last = (at >= 0 ? list[at] : null) ?? from;
      const again = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      (again as KeyboardEvent & { pfFam?: boolean }).pfFam = true;
      last.dispatchEvent(again);
    });
  }

  private focusables(): HTMLElement[] {
    const root = this.el.nativeElement as HTMLElement;
    return Array.from(root.querySelectorAll<HTMLElement>('.pf-fam__f, .pf-dd__trigger'))
      .filter(x => !x.hasAttribute('disabled'));
  }

  /** Numeric quantity: a number or a range ("2-3" / "2–3"), editing keys. */
  onlyNumber(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length > 1) return;
    if (!/[0-9.\-–]/.test(e.key)) e.preventDefault();
  }

  private nodeAt(path: readonly string[]): FamilyNode | null { return nodeAtPath(this.family(), path); }
}

function sameValue(a: FamilyValue | null, b: FamilyValue | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
