import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { FamilyInputComponent } from './family-input.component';
import type { FamilyValue, OptionFamily } from '../../utils/option-family';
import { CASTS } from '../../utils/option-family.spec-helpers';

@Component({
  standalone: true,
  imports: [FamilyInputComponent],
  template: `<pf-family-input [family]="fam()" [familyCode]="'FAM-CASTS'" [value]="value()"
                              (valueChange)="onChange($event)"></pf-family-input>`,
})
class HostComponent {
  readonly fam = signal<OptionFamily | null>(CASTS);
  readonly value = signal<unknown>(null);
  readonly emitted: (FamilyValue | null)[] = [];
  onChange(v: FamilyValue | null) { this.emitted.push(v); this.value.set(v); }
}

function mount(value: unknown = null, fam: OptionFamily | null = CASTS) {
  const f = TestBed.createComponent(HostComponent);
  f.componentInstance.value.set(value);
  f.componentInstance.fam.set(fam);
  f.detectChanges();
  return { f, host: f.componentInstance, el: f.nativeElement as HTMLElement };
}
const comp = (el: HTMLElement, fix: ReturnType<typeof mount>['f']) =>
  fix.debugElement.query(d => d.componentInstance instanceof FamilyInputComponent).componentInstance as FamilyInputComponent;

describe('pf-family-input', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HostComponent] }));

  it('shows only the root answer until one with sub-choices is picked', () => {
    const { el } = mount();
    expect(el.querySelectorAll('pf-select').length).toBe(1);
    expect(el.querySelectorAll('input[type=checkbox]').length).toBe(0);
  });

  it('Present → ticking two casts and their amounts emits the contract value', () => {
    const { f, host, el } = mount();
    const c = comp(el, f);
    c.onRoot('PRS');
    f.detectChanges();
    const boxes = el.querySelectorAll<HTMLInputElement>('input.pf-fam__cb');
    expect([...boxes].map(b => b.closest('label')!.textContent!.trim())).toEqual(['Hyaline', 'Granular', 'Waxy', 'Other']);
    boxes[0].click(); f.detectChanges();
    el.querySelectorAll<HTMLInputElement>('input.pf-fam__cb')[1].click(); f.detectChanges();
    // Each ticked item shows its own amount control; Hyaline carries its unit.
    expect(el.querySelectorAll('.pf-fam__qty').length).toBe(2);
    expect(el.querySelector('.pf-fam__unit')!.textContent).toContain('/LPF');
    c.onQty(['PRS', 'HYA'], '2-3');
    f.detectChanges();
    c.onQty(['PRS', 'GRA'], 'Few');
    f.detectChanges();
    expect(host.emitted.at(-1)).toEqual({ family: 'FAM-CASTS', v: 'PRS', label: 'Present', items: [
      { v: 'HYA', label: 'Hyaline', qty: '2-3', unit: '/LPF' },
      { v: 'GRA', label: 'Granular', qty: 'Few' },
    ] });
    // Granular opens its own (single-pick) sub-list, nested one level deeper.
    expect(el.querySelectorAll('.pf-fam__level').length).toBe(2);
  });

  it('a number amount is a numeric field with its unit; text is a plain field', () => {
    const { f, el } = mount({ family: 'FAM-CASTS', v: 'PRS', label: 'Present', items: [
      { v: 'WAX', label: 'Waxy', unit: '/LPF' }, { v: 'OTH', label: 'Other', qty: 'clumps' },
    ] });
    f.detectChanges();
    const ins = el.querySelectorAll<HTMLInputElement>('input.pf-fam__qin');
    expect(ins.length).toBe(2);
    expect(ins[0].getAttribute('inputmode')).toBe('decimal');
    expect(ins[1].value).toBe('clumps');
  });

  it('every inner field is reachable by the host\'s Enter-walk (pf-fam__f / triggers)', () => {
    const { f, el } = mount({ family: 'FAM-CASTS', v: 'PRS', label: 'Present', items: [{ v: 'WAX', label: 'Waxy' }] });
    f.detectChanges();
    expect(el.querySelectorAll('.pf-fam__f').length).toBeGreaterThanOrEqual(5); // 4 boxes + Waxy amount
  });

  it('Absent clears the items; a missing definition says so instead of guessing', () => {
    const { f, host, el } = mount({ family: 'FAM-CASTS', v: 'PRS', label: 'Present', items: [{ v: 'HYA', label: 'Hyaline' }] });
    comp(el, f).onRoot('ABS');
    expect(host.emitted.at(-1)).toEqual({ family: 'FAM-CASTS', v: 'ABS', label: 'Absent' });
    const m = mount(null, null);
    expect(m.el.textContent).toContain('FAM-CASTS');
  });
});
