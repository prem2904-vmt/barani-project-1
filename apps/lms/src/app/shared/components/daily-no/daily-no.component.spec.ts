import { TestBed } from '@angular/core/testing';
import { DailyNoComponent } from './daily-no.component';
import { labToday } from '../../utils/lab-clock';

function render(inputs: Record<string, unknown>) {
  const f = TestBed.createComponent(DailyNoComponent);
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  f.detectChanges();
  return (f.nativeElement as HTMLElement).querySelector('.pf-dayno') as HTMLElement | null;
}

describe('pf-daily-no', () => {
  it('shows "#12" from an order', () => {
    const chip = render({ of: { dailyNo: 12, dailyNoDay: labToday() } });
    expect(chip?.textContent?.trim()).toBe('#12');
    expect(chip?.getAttribute('title')).toBe("Today's patient number 12");
  });
  it('reads a tube / line that carries its order', () => {
    expect(render({ of: { barcode: '26259', order: { dailyNo: 3, dailyNoDay: labToday() } } })?.textContent?.trim()).toBe('#3');
  });
  it('an older day shows its date', () => {
    expect(render({ no: 3, day: '2020-01-05' })?.textContent?.trim()).toBe('#3 · 5 Jan');
  });
  it('no number → nothing', () => {
    expect(render({ of: { dailyNo: null } })).toBeNull();
  });
});
