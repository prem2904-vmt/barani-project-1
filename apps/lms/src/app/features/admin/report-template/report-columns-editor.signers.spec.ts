import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { of } from 'rxjs';
import { ReportColumnsEditorComponent } from './report-columns-editor.component';
import { ApiService } from '../../../core/services/api.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * OPS-82: the signatory dropdown lists only people who can sign
 * (GET /api/users/picker?signers=true). A person already saved as a signatory
 * who no longer qualifies stays visible, labelled, so the template never
 * silently loses them.
 */
describe('Report columns editor - signatory picker (OPS-82)', () => {
  const SIGNERS = [{ id: 'u-path', displayName: 'Dr. Meena' }];
  const EVERYONE = [...SIGNERS, { id: 'u-recep', displayName: 'Ravi Reception' }];
  function make() {
    const get = vi.fn((url: string) => of(
      url.includes('signers=true') ? SIGNERS : url.includes('/api/users/picker') ? EVERYONE : []));
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { get } },
        { provide: ReportLayoutService, useValue: { getDeptColumns: vi.fn(async () => ({ departmentId: 'd', columns: [], configured: false })), getDeptSignatories: vi.fn(async () => []) } },
        { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
      ],
    });
    const c = TestBed.createComponent(ReportColumnsEditorComponent).componentInstance as any;
    c.ngOnInit();
    return { c, get };
  }

  it('asks the server for signers only, and offers just them', () => {
    const { c, get } = make();
    expect(get).toHaveBeenCalledWith('/api/users/picker?signers=true');
    expect(c.sigUserOptions().map((o: { value: string }) => o.value)).toEqual(['u-path']);
  });

  it('keeps a saved signatory that no longer qualifies, labelled', () => {
    const { c } = make();
    c.signatories.set([{ _key: 'k', mode: 'user', role: 'tested_by', userId: 'u-recep', designation: '' }]);
    const opts = c.sigUserOptions() as Array<{ value: string; label: string }>;
    expect(opts.map(o => o.value)).toEqual(['u-path', 'u-recep']);
    expect(opts[1].label).toBe('Ravi Reception (can no longer sign)');
  });

  it('a signer who still qualifies is not duplicated', () => {
    const { c } = make();
    c.signatories.set([{ _key: 'k', mode: 'user', role: 'tested_by', userId: 'u-path', designation: '' }]);
    expect(c.sigUserOptions()).toHaveLength(1);
  });
});
