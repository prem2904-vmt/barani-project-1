import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { HomeCollectionAssignComponent } from './home-collection-assign.component';

/** Behaviour kept through the ND rebuild (owner 2026-11-22): same calls, one visit picked at a time, Assign → reload. */
function make(o: { assignFails?: boolean } = {}) {
  let list = [
    { id: 'v1', address: 'Lake View', pincode: '600042', patient: { displayName: 'Sathish' } },
    { id: 'v2', address: null, pincode: null, patient: { displayName: 'Priya' } },
  ];
  const svc = {
    unassignedHomeCollections: vi.fn(() => of(list)),
    listAgents: vi.fn(() => of([
      { id: 'a1', userId: 'u1', isActive: true, user: { displayName: 'Ravi' } },
      { id: 'a2', userId: 'u2', isActive: false, user: { displayName: 'Old' } },
    ])),
    assignAgent: vi.fn((id: string) => {
      if (o.assignFails) return throwError(() => new Error('nope'));
      list = list.filter(v => v.id !== id);
      return of({ id });
    }),
  };
  const toast = { success: vi.fn(), error: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: AppointmentQueueService, useValue: svc },
      { provide: ToastService, useValue: toast },
      { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
    ],
  });
  const c = TestBed.createComponent(HomeCollectionAssignComponent).componentInstance;
  c.ngOnInit();
  return { c, svc, toast };
}

describe('HomeCollectionAssign — ND rebuild keeps the behaviour', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loads the unassigned visits and offers only active agents', () => {
    const { c, svc } = make();
    expect(svc.unassignedHomeCollections).toHaveBeenCalledTimes(1);
    expect(c.items().map(v => v.id)).toEqual(['v1', 'v2']);
    expect(c.options()).toEqual([{ value: 'u1', label: 'Ravi' }]);
    expect(c.countLabel()).toBe('2 visits');
  });

  it('band search narrows the list and the count says "n of m"', () => {
    const { c } = make();
    c.q.set('priya');
    expect(c.visible().map(v => v.id)).toEqual(['v2']);
    expect(c.countLabel()).toBe('1 of 2 visits');
  });

  it('Assign needs a picked visit AND an agent; it PATCHes, toasts, clears the pick and reloads', () => {
    const { c, svc, toast } = make();
    c.select(c.items()[0] as never);
    expect(c.selected()?.id).toBe('v1');
    c.assign(c.selected()!);
    expect(svc.assignAgent).not.toHaveBeenCalled();          // no agent yet
    c.setPick('v1', 'u1');
    c.assign(c.selected()!);
    expect(svc.assignAgent).toHaveBeenCalledWith('v1', 'u1');
    expect(toast.success).toHaveBeenCalledWith('Assigned.');
    expect(svc.unassignedHomeCollections).toHaveBeenCalledTimes(2);
    expect(c.selected()).toBeNull();
    expect(c.items().map(v => v.id)).toEqual(['v2']);
  });

  it('a failed Assign keeps the visit picked and shows the error', () => {
    const { c, toast } = make({ assignFails: true });
    c.select(c.items()[0] as never);
    c.setPick('v1', 'u1');
    c.assign(c.selected()!);
    expect(toast.error).toHaveBeenCalled();
    expect(c.selected()?.id).toBe('v1');
    expect(c.assigningId()).toBeNull();
  });
});
