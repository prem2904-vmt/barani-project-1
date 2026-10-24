import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Component } from '@angular/core';
import { FamilyTreeEditorComponent } from './family-tree-editor.component';
import { SelectComponent } from '../../../../shared/primitives/select.component';
import type { OptionFamily } from '../../../../shared/utils/option-family';
import { newLineDraft } from './profile-family-lines';
import type { SubtestChoice } from './family-subtest';

const CHOICES: SubtestChoice[] = [
  { key: 'CLP031', id: 'gra', code: 'CLP031', name: 'Granular Casts',
    qty: { kind: 'choice', options: ['None', 'Few', 'Moderate', 'Many'] } },
  { key: 'CLP030', id: 'hya', code: 'CLP030', name: 'Hyaline Casts',
    qty: { kind: 'choice', options: ['None', 'Few', 'Moderate', 'Many'], unit: '/LPF' } },
];

@Component({
  standalone: true,
  imports: [FamilyTreeEditorComponent],
  template: `<pf-family-tree-editor [(family)]="fam" [subtests]="choices"></pf-family-tree-editor>`,
})
class HostComponent {
  fam: OptionFamily = newLineDraft('Casts');
  choices: SubtestChoice[] = CHOICES;
}

const buttons = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].filter(b => b.textContent?.includes(text));

describe('pf-family-tree-editor (embedded in a profile family line)', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HostComponent] }));

  it('renders the answers with the Normal switch on the root only; root answers stay typed', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const labels = [...el.querySelectorAll<HTMLInputElement>('.pf-of__nlabel')].map(i => i.value);
    expect(labels).toEqual(['Absent', 'Present']);
    expect(el.querySelectorAll('.pf-of__flag[role=switch]').length).toBe(2);
    expect(f.debugElement.queryAll(By.directive(SelectComponent)).filter(d => d.nativeElement.classList.contains('pf-of__test')).length).toBe(0);
  });

  it('a new sub-choice is PICKED from the tests (no typing): code, name, link and amount come from the test', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    buttons(el, '+ Sub-choices')[1].click(); f.detectChanges();
    expect(f.componentInstance.fam.nodes[1].children?.multi).toBe(true);
    const child = el.querySelector('.pf-of__lvl--sub .pf-of__node')!;
    expect(child.querySelector('.pf-of__flag')).toBeNull();
    expect(child.querySelector('.pf-of__nlabel')).toBeNull();
    const picker = f.debugElement.query(By.css('.pf-of__lvl--sub pf-select.pf-of__test'));
    const sel = picker.componentInstance as SelectComponent<string>;
    expect(sel.searchable).toBe(true);
    expect(sel.options.map(o => o.label)).toEqual(['Granular Casts', 'Hyaline Casts']);
    expect(sel.options[0].hint).toBe('CLP031');
    sel.valueChange.emit('CLP030'); f.detectChanges();
    expect(f.componentInstance.fam.nodes[1].children!.nodes[0]).toEqual({
      code: 'CLP030', label: 'Hyaline Casts', test: 'CLP030',
      qty: { kind: 'choice', options: ['None', 'Few', 'Moderate', 'Many'], unit: '/LPF' },
    });
    expect(el.querySelector('.pf-of__lvl--sub .pf-of__tcode')?.textContent?.trim()).toBe('CLP030');
    // The amount stays editable (prefilled from the test).
    const opts = el.querySelector<HTMLInputElement>('.pf-of__lvl--sub .pf-of__qopts')!;
    expect(opts.value).toBe('None, Few, Moderate, Many');
    // A second sub-choice can't pick Hyaline again.
    buttons(el, '+ Add sub-choice')[0].click(); f.detectChanges();
    const second = f.debugElement.queryAll(By.css('.pf-of__lvl--sub pf-select.pf-of__test'))[1].componentInstance as SelectComponent<string>;
    expect(second.options.find(o => o.value === 'CLP030')!.disabled).toBe(true);
  });

  it('no free member left → a plain "Add tests to this profile first" note instead of an empty list', () => {
    const f = TestBed.createComponent(HostComponent);
    f.componentInstance.choices = [];
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    buttons(el, '+ Sub-choices')[1].click(); f.detectChanges();
    expect(el.querySelector('[data-testid=subtest-empty]')?.textContent).toContain('Add tests to this profile first');
    expect(f.debugElement.query(By.css('.pf-of__lvl--sub pf-select.pf-of__test'))).toBeNull();
    expect(el.querySelector('[data-testid=subtest-member-note]')).toBeNull();
  });

  it('an older typed sub-choice keeps working and offers "Link to a test"; a gone test is said plainly', () => {
    const f = TestBed.createComponent(HostComponent);
    f.componentInstance.fam = { ...newLineDraft('Casts'), nodes: [
      { code: 'ABS', label: 'Absent', normal: true },
      { code: 'PRS', label: 'Present', children: { label: 'Cast type', multi: true, nodes: [
        { code: 'HYA', label: 'Hyaline', qty: { kind: 'choice', options: ['Few'] } },
        { code: 'WAX', label: 'Waxy', test: 'CLP036', testMissing: true },
      ] } },
    ] };
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.pf-of__note--warn')?.textContent).toContain('no longer in Test Master');
    const typed = el.querySelectorAll('.pf-of__lvl--sub .pf-of__nlabel');
    expect([...typed].map(i => (i as HTMLInputElement).value)).toEqual(['Hyaline']);
    buttons(el, 'Link to a test')[0].click(); f.detectChanges();
    const pickers = f.debugElement.queryAll(By.css('.pf-of__lvl--sub pf-select.pf-of__test'));
    expect(pickers.length).toBe(2);
    (pickers[0].componentInstance as SelectComponent<string>).valueChange.emit('CLP030'); f.detectChanges();
    expect(f.componentInstance.fam.nodes[1].children!.nodes[0]).toEqual({
      code: 'CLP030', label: 'Hyaline Casts', test: 'CLP030',
      qty: { kind: 'choice', options: ['None', 'Few', 'Moderate', 'Many'], unit: '/LPF' },
    });
    expect(el.querySelectorAll('.pf-of__lvl--sub .pf-of__nlabel').length).toBe(0);
  });
});
