import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { AdvancedPatientSearchComponent } from './advanced-patient-search.component';
import { ApiService } from '../../../core/services/api.service';

/**
 * Advanced patient search — LOADING FEEDBACK (ND-PATTERN "Loading
 * feedback"): Search is busy (disabled + aria-busy, dots after 150ms) while
 * the request runs, and the results region draws the table's shape — never
 * a "No patients found" flash before the answer lands.
 */
const HIT = {
  patient: { id: 'p1', displayName: 'Ravi Kumar', mrn: 'AA0001', phone: '9876543210', sex: 'male' },
  lastVisitAt: '2026-09-28T04:00:00Z', branchName: 'Main',
};

function render(search$: Subject<any>) {
  const api = {
    get: vi.fn((url: string) => url.startsWith('/api/patients/advanced-search') ? search$ : of([])),
  };
  TestBed.configureTestingModule({
    imports: [AdvancedPatientSearchComponent],
    providers: [{ provide: ApiService, useValue: api }],
  });
  const f = TestBed.createComponent(AdvancedPatientSearchComponent);
  f.componentRef.setInput('open', true);
  f.detectChanges();
  const c = f.componentInstance as any;
  c.filters.update((x: any) => ({ ...x, name: 'Ravi' }));
  f.detectChanges();
  // The modal portals itself to <body>.
  const root = () => document.querySelector('.pf-aps-root') as HTMLElement;
  const searchBtn = () => root().querySelector('.pf-aps-btn--primary') as HTMLButtonElement;
  return { f, c, api, root, searchBtn };
}

describe('Advanced patient search — loading feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.pf-aps-root').forEach(n => n.remove());
  });

  it('Search: disabled + aria-busy at once, dots only after 150ms, released when the answer lands', () => {
    const search$ = new Subject<any>();
    const { f, searchBtn } = render(search$);
    expect(searchBtn().disabled).toBe(false);
    searchBtn().click();
    f.detectChanges();
    expect(searchBtn().disabled).toBe(true);
    expect(searchBtn().getAttribute('aria-busy')).toBe('true');
    expect(searchBtn().textContent).toContain('Searching');
    expect(searchBtn().querySelector('pf-busy')).toBeNull();
    vi.advanceTimersByTime(200);
    f.detectChanges();
    expect(searchBtn().querySelector('pf-busy')).not.toBeNull();
    search$.next({ items: [HIT], total: 1 }); search$.complete();
    vi.advanceTimersByTime(400);
    f.detectChanges();
    expect(searchBtn().getAttribute('aria-busy')).toBeNull();
    expect(searchBtn().querySelector('pf-busy')).toBeNull();
  });

  it('first search in flight = table skeleton, never "No patients found"', () => {
    const search$ = new Subject<any>();
    const { f, root, searchBtn } = render(search$);
    searchBtn().click();
    f.detectChanges();
    const results = root().querySelector('.pf-aps-results')!;
    expect(results.querySelector('pf-skeleton-table[aria-busy="true"]')).not.toBeNull();
    expect(results.textContent).not.toContain('No patients found');
    search$.next({ items: [HIT], total: 1 }); search$.complete();
    f.detectChanges();
    expect(results.querySelector('pf-skeleton-table')).toBeNull();
    expect(results.textContent).toContain('Ravi Kumar');
  });

  it('an empty answer still ends on the empty state', () => {
    const search$ = new Subject<any>();
    const { f, root, searchBtn } = render(search$);
    searchBtn().click();
    f.detectChanges();
    search$.next({ items: [], total: 0 }); search$.complete();
    f.detectChanges();
    expect(root().querySelector('.pf-aps-results')!.textContent).toContain('No patients found');
  });
});
