import { TestBed } from '@angular/core/testing';
import { JourneyAxisComponent } from './journey-axis.component';
import { JourneyAxisEvent, clampZoom, journeyAxisModel, journeyAxisTicks } from './journey-axis';

const ev = (key: string, type: JourneyAxisEvent['type'] = 'lab', alert = false): JourneyAxisEvent => ({ key, date: key + 'T10:00:00', type, alert });

describe('journeyAxisModel (lifted from pf-patient-timeline, same placement)', () => {
  it('no dates → nothing', () => {
    expect(journeyAxisModel([])).toEqual({ events: [], ticks: [], lanes: 0 });
  });

  it('places dates proportionally with 6% padding, oldest first, whatever the input order', () => {
    const m = journeyAxisModel([ev('2026-10-03'), ev('2026-01-01')]);
    expect(m.events.map(e => e.key)).toEqual(['2026-01-01', '2026-10-03']);
    const [a, b] = m.events;
    expect(a.x).toBeCloseTo(100 * 0.06 / 1.12, 3);
    expect(b.x).toBeCloseTo(100 * 1.06 / 1.12, 3);
    expect(m.lanes).toBe(1);
  });

  it('a single date sits in the middle', () => {
    const m = journeyAxisModel([ev('2026-05-02')]);
    expect(m.events[0].x).toBeCloseTo(50, 3);
  });

  it('dates closer than 8% stack on the next lane; zooming in un-stacks them', () => {
    const list = [ev('2026-01-01'), ev('2026-01-10'), ev('2026-12-31')];
    const m1 = journeyAxisModel(list, 1);
    expect(m1.events.map(e => e.lane)).toEqual([0, 1, 0]);
    expect(m1.lanes).toBe(2);
    const m8 = journeyAxisModel(list, 8);
    expect(m8.events.map(e => e.lane)).toEqual([0, 0, 0]);
  });

  it('the lane is capped by the host', () => {
    const list = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-12-31'].map(d => ev(d));
    const m = journeyAxisModel(list, 1, 2);
    expect(Math.max(...m.events.map(e => e.lane))).toBe(1);
    expect(m.lanes).toBe(2);
  });

  it('ticks: days for a short span, months for a year, years beyond', () => {
    const DAY = 86400000;
    const lo = new Date(2026, 0, 1).getTime();
    const x = (t: number) => t;
    expect(journeyAxisTicks(lo, lo + 20 * DAY, x).length).toBeGreaterThan(5);
    const months = journeyAxisTicks(lo, lo + 300 * DAY, x);
    expect(months.length).toBe(10);
    expect(journeyAxisTicks(lo, lo + 1500 * DAY, x).map(t => t.label)).toEqual(['2026', '2027', '2028', '2029', '2030']);
  });

  it('zoom is clamped to 1…8', () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(12)).toBe(8);
    expect(clampZoom(2.5)).toBe(2.5);
  });
});

describe('<pf-journey-axis>', () => {
  it('renders a pill per date, marks the selected one and the alerts, and emits the key on tap', () => {
    TestBed.configureTestingModule({ imports: [JourneyAxisComponent] });
    const f = TestBed.createComponent(JourneyAxisComponent);
    f.componentRef.setInput('events', [ev('2026-01-14', 'lab', true), { ...ev('2026-08-12', 'opd'), label: '12 Aug' }, ev('2026-10-03', 'today')]);
    f.componentRef.setInput('selectedKey', '2026-08-12');
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    const pills = [...el.querySelectorAll<HTMLButtonElement>('.ja__ev')];
    expect(pills.length).toBe(3);
    expect(pills[1].classList.contains('ja__ev--on')).toBe(true);
    expect(pills[1].textContent).toContain('12 Aug');
    expect(pills[0].querySelector('.ja__alert')).toBeTruthy();
    const got: string[] = [];
    f.componentInstance.select.subscribe(k => got.push(k));
    pills[2].click();
    expect(got).toEqual(['2026-10-03']);
  });
});
