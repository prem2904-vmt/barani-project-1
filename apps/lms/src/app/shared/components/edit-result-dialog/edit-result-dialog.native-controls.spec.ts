import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { EditResultDialogComponent } from './edit-result-dialog.component';
import { SelectComponent } from '../../primitives/select.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';

/** The per-department "Send to" technician picker used a native `<select>`
 *  — now `pf-select`. */
describe('Edit result dialog — Send to (no native select)', () => {
  const plan = {
    orderId: 'o1', reportReleased: false,
    departments: [{ departmentId: 'd1', departmentName: 'Biochemistry', testCount: 2, editableCount: 2, tests: ['Glucose'] }],
    technicians: [{ id: 't1', name: 'Asha' }, { id: 't2', name: 'Ravi' }],
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function render() {
    TestBed.configureTestingModule({
      imports: [EditResultDialogComponent],
      providers: [
        { provide: ApiService, useValue: { get: vi.fn(() => of(plan)) } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(EditResultDialogComponent);
    f.componentRef.setInput('orderId', 'o1');
    f.detectChanges();
    // The loading skeleton is held >= MIN_LOAD_MS (shared/utils/min-duration)
    // so a fast load never flashes it — clear that hold in the test.
    vi.advanceTimersByTime(700);
    f.detectChanges();
    return { f, c: f.componentInstance as any, el: f.nativeElement as HTMLElement };
  }

  it('renders pf-select for "Send to", never a native select', () => {
    const { el } = render();
    expect(el.querySelector('pf-select')).not.toBeNull();
    expect(el.querySelector('select')).toBeNull();
  });

  it('picking a technician updates the department assignment', () => {
    const { f, c } = render();
    const select = f.debugElement.query(By.directive(SelectComponent)).componentInstance as SelectComponent<string>;
    select.valueChange.emit('t2');
    expect(c.assigneeFor({ departmentId: 'd1' })).toBe('t2');
  });

  it('technicianOptions offers "Unassigned" only when the department has no performer yet', () => {
    const { c } = render();
    const withNone = c.technicianOptions({ departmentId: 'd1', performerId: null } as any, plan.technicians);
    expect(withNone[0]).toEqual({ value: '', label: 'Unassigned — pick a technician' });
    const withOne = c.technicianOptions({ departmentId: 'd1', performerId: 't1' } as any, plan.technicians);
    expect(withOne.some((o: any) => o.value === '')).toBe(false);
  });
});
