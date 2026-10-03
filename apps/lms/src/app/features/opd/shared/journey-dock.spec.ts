import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ConsultApi } from '../consult/consult.api';
import { JourneyDockComponent } from './journey-dock.component';
import {
  JourneyDockService, abnormalDaysOf, dockAfterTyping, dockEvents, dockPinKey, dockSummary, journeyDayKey,
} from './journey-dock.service';

// The test DOM's localStorage can be missing — an in-memory one, per spec run.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(),
});

const HISTORY = [{ visitId: 'v3', visitDate: '2026-08-12' }, { visitId: 'v2', visitDate: '2026-05-02T09:30:00' }];

describe('Journey dock — pure rules', () => {
  it('one date per day: OPD beats lab on the same day, today is "Today", the filter keeps today', () => {
    const ev = dockEvents(HISTORY, ['2026-01-14', '2026-08-12', '2026-09-27'], new Set(['2026-09-27']), '2026-10-03');
    expect(ev.map(e => [e.key, e.type])).toEqual([
      ['2026-01-14', 'lab'], ['2026-05-02', 'opd'], ['2026-08-12', 'opd'], ['2026-09-27', 'lab'], ['2026-10-03', 'today'],
    ]);
    expect(ev.find(e => e.key === '2026-09-27')!.alert).toBe(true);
    expect(ev.find(e => e.type === 'today')!.label).toBe('Today');
    const lab = dockEvents(HISTORY, ['2026-01-14'], new Set(), '2026-10-03', 'lab');
    expect(lab.map(e => e.type)).toEqual(['lab', 'today']);
    const opd = dockEvents(HISTORY, ['2026-01-14'], new Set(), null, 'opd');
    expect(opd.map(e => e.type)).toEqual(['opd', 'opd']);
  });

  it('the collapsed summary counts earlier visits, the last date and flagged days', () => {
    const ev = dockEvents(HISTORY, ['2026-09-27'], new Set(['2026-09-27', '2026-05-02']), '2026-10-03');
    const s = dockSummary(ev);
    expect(s.text).toContain('3 earlier visits · last 27 Sep');
    expect(s.flagged).toBe('2 days with results out of range');
    expect(dockSummary([]).text).toContain('First visit');
  });

  it('pin is per user; an unpinned dock folds away while typing, a pinned one stays', () => {
    expect(dockPinKey('u1')).toBe('pf.opd.dockPin.u1');
    expect(dockPinKey(null)).toBe('pf.opd.dockPin.anon');
    expect(dockAfterTyping({ pinned: false, open: true })).toBe(false);
    expect(dockAfterTyping({ pinned: true, open: true })).toBe(true);
    expect(dockAfterTyping({ pinned: true, open: false })).toBe(false);
  });

  it('day keys and abnormal days', () => {
    expect(journeyDayKey('2026-10-03')).toBe('2026-10-03');
    expect(journeyDayKey(new Date(2026, 9, 3, 10).toISOString())).toBe('2026-10-03');
    const t = { tests: [{ parameters: [{ points: [{ date: '2026-09-27', flag: 'H' }, { date: '2026-01-14', flag: 'N' }] }] }] };
    expect([...abnormalDaysOf(t)]).toEqual(['2026-09-27']);
  });
});

describe('<pf-journey-dock> + JourneyDockService', () => {
  function setup() {
    localStorage.removeItem(dockPinKey('u1'));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [JourneyDockComponent],
      providers: [
        { provide: ConsultApi, useValue: { history: vi.fn(() => of(HISTORY)) } },
        { provide: ApiService, useValue: { get: vi.fn((u: string) => of(u.endsWith('lab-trends') ? { tests: [] } : { history: [{ id: 'o1', createdAt: '2026-09-27T08:10:00' }] })) } },
        { provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } },
      ],
    });
    const svc = TestBed.inject(JourneyDockService);
    svc.open.set(true);
    const f = TestBed.createComponent(JourneyDockComponent);
    return { f, svc };
  }

  it('renders nothing until a patient is shown; then the strip, the axis and Today selected', () => {
    const { f, svc } = setup();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.jd')).toBeNull();
    svc.show({ id: 'p1', name: 'Arjun Mehta' }, '2026-10-03');
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.jd__ttl')!.textContent).toContain('3 earlier visits');
    expect(el.querySelectorAll('.ja__ev').length).toBe(4);
    expect(svc.selectedKey()).toBe('2026-10-03');
  });

  it('collapses to the strip, pins per user, and an unpinned dock folds when the doctor types', () => {
    const { f, svc } = setup();
    svc.show({ id: 'p1', name: 'Arjun Mehta' }, '2026-10-03');
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    (el.querySelector('[data-pin]') as HTMLButtonElement).click();
    expect(svc.pinned()).toBe(false);
    expect(localStorage.getItem(dockPinKey('u1'))).toBe('0');
    svc.noteTyping();
    f.detectChanges();
    expect(svc.open()).toBe(false);
    expect(el.querySelector('.ja__ev')).toBeNull();
    expect(el.querySelector('.jd__bar')).toBeTruthy();
    (el.querySelector('[data-pin]') as HTMLButtonElement).click();
    svc.open.set(true);
    svc.noteTyping();
    expect(svc.open()).toBe(true);
  });

  it('tapping a date selects that visit and filters keep Today', () => {
    const { f, svc } = setup();
    svc.show({ id: 'p1', name: 'Arjun Mehta' }, '2026-10-03');
    f.detectChanges();
    const got: string[] = [];
    f.componentInstance.picked.subscribe(k => got.push(k));
    const pills = [...(f.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.ja__ev')];
    pills[1].click();
    expect(svc.selectedKey()).toBe('2026-08-12');
    expect(got).toEqual(['2026-08-12']);
    svc.filter.set('lab');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelectorAll('.ja__ev').length).toBe(2);
  });
});
