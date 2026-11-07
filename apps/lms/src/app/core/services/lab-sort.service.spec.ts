import { vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LabSortService } from './lab-sort.service';
import { AuthService } from '../auth/auth.service';

describe('LabSortService (OPS-52)', () => {
  const user = signal<{ id: string } | null>({ id: 'u1' });
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* */ }
    user.set({ id: 'u1' });
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { user } }] });
  });

  it('defaults, then remembers per user and per list', () => {
    const s = TestBed.inject(LabSortService);
    expect(s.keyFor('work')).toBe('default');
    s.set('work', 'oldest');
    expect(s.keyFor('work')).toBe('oldest');
    expect(s.keyFor('completed')).toBe('default');
    expect(localStorage.getItem('pf.labSort.u1.work')).toBe('oldest');
    user.set({ id: 'u2' });
    expect(s.keyFor('work')).toBe('default');
    user.set({ id: 'u1' });
    expect(s.keyFor('work')).toBe('oldest');
  });

  it('refuses a key that is not an option for the list', () => {
    const s = TestBed.inject(LabSortService);
    s.set('completed', 'newest');
    expect(s.keyFor('completed')).toBe('default');
  });

  it('survives storage that throws', () => {
    const s = TestBed.inject(LabSortService);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(s.keyFor('intake')).toBe('default');
    s.set('intake', 'patient');
    expect(s.keyFor('intake')).toBe('patient');
    get.mockRestore(); set.mockRestore();
  });
});
