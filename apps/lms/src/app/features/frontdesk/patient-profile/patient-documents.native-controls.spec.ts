import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { PatientDocumentsComponent } from './patient-documents.component';
import { SelectComponent } from '../../../shared/primitives/select.component';
import { ToastService } from '../../../core/services/toast.service';
import { UploadsService } from '../../../core/services/uploads.service';

/** The "Type" dropdown used a native `<select>` — now `pf-select`. */
describe('Patient documents — document type (no native select)', () => {
  function render() {
    const http = { get: vi.fn(() => of({ data: [] })) };
    TestBed.configureTestingModule({
      imports: [PatientDocumentsComponent],
      providers: [
        { provide: HttpClient, useValue: http },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
        { provide: UploadsService, useValue: {} },
      ],
    });
    const f = TestBed.createComponent(PatientDocumentsComponent);
    f.componentRef.setInput('patientId', 'p1');
    f.detectChanges();
    return { f, c: f.componentInstance as any, el: f.nativeElement as HTMLElement };
  }

  it('renders pf-select for Type, never a native select', () => {
    const { el } = render();
    expect(el.querySelector('pf-select')).not.toBeNull();
    expect(el.querySelector('select')).toBeNull();
  });

  it('picking a type updates docType()', () => {
    const { f, c } = render();
    const select = f.debugElement.query(By.directive(SelectComponent)).componentInstance as SelectComponent<string>;
    select.valueChange.emit('prescription');
    expect(c.docType()).toBe('prescription');
  });
});
