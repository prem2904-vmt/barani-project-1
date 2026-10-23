import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { FamilyTreeEditorComponent } from './family-tree-editor.component';
import type { OptionFamily } from '../../../../shared/utils/option-family';
import { newLineDraft } from './profile-family-lines';

@Component({
  standalone: true,
  imports: [FamilyTreeEditorComponent],
  template: `<pf-family-tree-editor [(family)]="fam"></pf-family-tree-editor>`,
})
class HostComponent { fam: OptionFamily = newLineDraft('Casts'); readonly seen = signal(0); }

describe('pf-family-tree-editor (embedded in a profile family line)', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HostComponent] }));

  it('renders the answers with the Normal switch on the root only, and edits flow back to the host', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const labels = [...el.querySelectorAll<HTMLInputElement>('.pf-of__nlabel')].map(i => i.value);
    expect(labels).toEqual(['Absent', 'Present']);
    expect(el.querySelectorAll('.pf-of__flag[role=switch]').length).toBe(2);
    // Open sub-choices under Present → one new (empty) child, no Normal switch on it.
    const addKids = [...el.querySelectorAll<HTMLButtonElement>('button')].filter(b => b.textContent?.includes('+ Sub-choices'));
    addKids[1].click(); f.detectChanges();
    expect(f.componentInstance.fam.nodes[1].children?.multi).toBe(true);
    const child = el.querySelector('.pf-of__lvl--sub .pf-of__node')!;
    expect(child.querySelector('.pf-of__flag')).toBeNull();
    const input = child.querySelector<HTMLInputElement>('.pf-of__nlabel')!;
    input.value = 'Hyaline'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('blur'));
    f.detectChanges();
    expect(f.componentInstance.fam.nodes[1].children!.nodes[0]).toEqual({ code: 'HYA', label: 'Hyaline' });
  });
});
