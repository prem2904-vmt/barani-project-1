import { TestBed } from '@angular/core/testing';
import { NdDateTimeComponent } from './nd-datetime.component';

function render(value: string | null = null) {
  TestBed.configureTestingModule({ imports: [NdDateTimeComponent] });
  const f = TestBed.createComponent(NdDateTimeComponent);
  f.componentRef.setInput('value', value);
  f.detectChanges();
  const out: Array<string | null> = [];
  f.componentInstance.valueChange.subscribe(v => out.push(v));
  return { f, out };
}

afterEach(() => TestBed.resetTestingModule());

describe('pf-nd-datetime', () => {
  it('splits an ISO datetime-local string into date + time parts for the two kit inputs', () => {
    const { f } = render('2026-09-26T14:30');
    expect(f.componentInstance.datePart()).toBe('2026-09-26');
    expect(f.componentInstance.timePart()).toBe('14:30');
  });

  it('emits the combined YYYY-MM-DDTHH:mm when the date changes (keeping the current time)', () => {
    const { f, out } = render('2026-09-26T14:30');
    f.componentInstance.onDate('2026-09-27');
    expect(out).toEqual(['2026-09-27T14:30']);
  });

  it('emits the combined string when the time changes (keeping the current date)', () => {
    const { f, out } = render('2026-09-26T14:30');
    f.componentInstance.onTime('09:05');
    expect(out).toEqual(['2026-09-26T09:05']);
  });

  it('a time pick with no date set yet does not emit', () => {
    const { f, out } = render(null);
    f.componentInstance.onTime('09:05');
    expect(out).toEqual([]);
  });

  it('renders both the kit date and kit time inputs', () => {
    TestBed.configureTestingModule({ imports: [NdDateTimeComponent] });
    const f = TestBed.createComponent(NdDateTimeComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('pf-nd-date').length).toBe(1);
    expect(el.querySelectorAll('pf-nd-time').length).toBe(1);
  });
});
