import { signal } from '@angular/core';
import type { OptionFamily } from '../../../../shared/utils/option-family';
import { codeFromLabel, validateFamily } from '../../../../shared/utils/option-family';
import {
  addChildren, addNode, familyTreeOps, fillCodes, moveNode, nodesAt, parseOptionList, removeNode, setQtyKind, updateNode,
} from './option-families-tree';

const base = (): OptionFamily => ({ code: 'FAM-CASTS', name: 'Casts', active: true, nodes: [
  { code: 'ABS', label: 'Absent', normal: true },
  { code: 'PRS', label: 'Present', normal: false },
] });

describe('Families editor — tree edits', () => {
  it('add / rename / reorder / remove at the root', () => {
    let d = addNode(base(), []);
    d = updateNode(d, [2], n => ({ ...n, label: 'Trace' }));
    d = moveNode(d, [2], -1);
    expect(d.nodes.map(n => n.label)).toEqual(['Absent', 'Trace', 'Present']);
    expect(moveNode(d, [0], -1)).toEqual(d);          // already first
    d = removeNode(d, [1]);
    expect(d.nodes.map(n => n.label)).toEqual(['Absent', 'Present']);
  });

  it('opens sub-choices (many picks by default) and edits inside them', () => {
    const b = base();
    let d = addChildren(b, [1]);
    expect(d.nodes[1].children).toEqual({ label: '', multi: true, nodes: [{ code: '', label: '' }] });
    d = updateNode(d, [1, 0], n => ({ ...n, label: 'Hyaline' }));
    d = addNode(d, [1]);
    d = updateNode(d, [1, 1], n => ({ ...n, label: 'Granular' }));
    expect(nodesAt(d, [1])!.map(n => n.label)).toEqual(['Hyaline', 'Granular']);
    // Untouched branches keep their identity (cheap change detection).
    expect(d.nodes[0]).toBe(b.nodes[0]);
  });

  it('never nests past four levels', () => {
    let d = addChildren(base(), [1]);
    d = addChildren(d, [1, 0]);
    d = addChildren(d, [1, 0, 0]);
    expect(nodesAt(d, [1, 0, 0])).not.toBeNull();
    const before = d;
    d = addChildren(d, [1, 0, 0, 0]);
    expect(d).toBe(before);
  });

  it('amount kinds: list seeds Few/Moderate/Many and keeps the unit; None removes it', () => {
    const n = { code: 'HYA', label: 'Hyaline', qty: { kind: 'number' as const, unit: '/LPF' } };
    expect(setQtyKind(n, 'choice')).toEqual({ code: 'HYA', label: 'Hyaline', qty: { kind: 'choice', options: ['Few', 'Moderate', 'Many'], unit: '/LPF' } });
    expect(setQtyKind(n, 'text')).toEqual({ code: 'HYA', label: 'Hyaline', qty: { kind: 'text', unit: '/LPF' } });
    expect(setQtyKind(n, '')).toEqual({ code: 'HYA', label: 'Hyaline' });
    expect(parseOptionList(' 0–2, 3–5 ,, 6–10\nMany ')).toEqual(['0–2', '3–5', '6–10', 'Many']);
  });

  it('fillCodes gives every labelled code-less node a unique code and never changes existing ones', () => {
    let d = addChildren(base(), [1]);
    d = updateNode(d, [1, 0], n => ({ ...n, label: 'Hyaline' }));
    d = addNode(d, [1]);
    d = updateNode(d, [1, 1], n => ({ ...n, label: 'Hyaline cast' }));
    const filled = fillCodes(d, codeFromLabel);
    expect(filled.nodes.map(n => n.code)).toEqual(['ABS', 'PRS']);
    expect(nodesAt(filled, [1])!.map(n => n.code)).toEqual(['HYA', 'HYA2']);
    expect(validateFamily({ ...filled, nodes: filled.nodes })).toEqual([]);
  });

  it('signal-bound ops edit the draft in place of the template', () => {
    const draft = signal<OptionFamily | null>(base());
    const ops = familyTreeOps(draft);
    ops.addChildren([1]);
    ops.setChildrenLabel([1], 'Cast type');
    ops.setMulti([1], false);
    ops.setLabel([1, 0], 'Waxy');
    ops.ensureCode([1, 0], codeFromLabel);
    ops.setQtyKind([1, 0], 'choice');
    ops.setQtyOptions([1, 0], '0-2, 3-5');
    ops.setQtyUnit([1, 0], '/LPF');
    ops.setNormal([1], true);
    ops.setActive(false);
    expect(draft()).toEqual({ code: 'FAM-CASTS', name: 'Casts', active: false, nodes: [
      { code: 'ABS', label: 'Absent', normal: true },
      { code: 'PRS', label: 'Present', normal: true, children: { label: 'Cast type', multi: false, nodes: [
        { code: 'WAX', label: 'Waxy', qty: { kind: 'choice', options: ['0-2', '3-5'], unit: '/LPF' } },
      ] } },
    ] });
    ops.removeChildren([1]);
    expect(draft()!.nodes[1].children).toBeUndefined();
  });
});

import { isInUse } from './option-families-panel.component';
import { ApiError } from '../../../../shared/models/api-response.model';

describe('Families editor — delete refused while in use (409)', () => {
  it('recognises the in-use refusal however ApiService hands it over', () => {
    expect(isInUse(new ApiError('Used by 2 tests: CLP002, CLP003', 'family_in_use'))).toBe(true);
    expect(isInUse({ status: 409, error: { message: 'x' } })).toBe(true);
    expect(isInUse(new ApiError('This family is in use'))).toBe(true);
    expect(isInUse(new ApiError('Request failed'))).toBe(false);
    expect(isInUse(new ApiError('Not found', 'not_found'))).toBe(false);
  });
});
