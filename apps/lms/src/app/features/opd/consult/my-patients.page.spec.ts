import {
  doctorFilterOptions,
  doctorsFromRows,
  nextToCall,
  showsDoctorFilter,
  showsDoctorName,
  tabOf,
} from './my-patients.page';
import { ConsultQueueRow } from './consult.api';
import { FRONTDESK_PERMS } from '../../../core/auth/route-access';

/** Task C — the doctor filter on `/opd/consult` for non-doctor / staff-doctor
 *  callers. Pure functions only (no TestBed): the component wiring is a thin
 *  shell around these. */

describe('tabOf / nextToCall (existing — unchanged)', () => {
  it('buckets booked/vitals into waiting', () => {
    expect(tabOf('booked')).toBe('waiting');
    expect(tabOf('vitals')).toBe('waiting');
    expect(tabOf('in_consult')).toBe('in_consult');
    expect(tabOf('completed')).toBe('completed');
    expect(tabOf('cancelled')).toBeNull();
  });
});

function row(over: Partial<ConsultQueueRow> = {}): ConsultQueueRow {
  return {
    visitId: 'v1', patientId: 'p1', patientName: 'Pat', token: 1, tokenLabel: 'A1', status: 'waiting',
    isFollowUp: false, hasVitals: true, allergyCount: 0, doctorUserId: 'd1', doctorName: 'A Doc',
    ...over,
  };
}

describe('showsDoctorFilter', () => {
  it('always shows it for a non-doctor', () => {
    expect(showsDoctorFilter(false, () => false)).toBe(true);
    expect(showsDoctorFilter(false, () => true)).toBe(true);
  });

  it('hides it for a plain doctor (no front-desk/admin permission)', () => {
    expect(showsDoctorFilter(true, () => false)).toBe(false);
  });

  it('shows it for a "staff doctor" (a doctor who also holds a front-desk/admin permission)', () => {
    expect(showsDoctorFilter(true, p => p.includes('create_order'))).toBe(true);
    expect(showsDoctorFilter(true, p => p.includes('manage_tests'))).toBe(true);
  });

  it('checks the UNION of FRONTDESK_PERMS and ADMIN_PERMS', () => {
    const has = (held: string) => (perms: string[]) => perms.includes(held);
    for (const p of FRONTDESK_PERMS) expect(showsDoctorFilter(true, has(p))).toBe(true);
  });
});

describe('showsDoctorName', () => {
  it('shows "Dr X" only for a non-doctor viewing the default (no doctorId) mixed queue', () => {
    expect(showsDoctorName(false, '')).toBe(true);
  });

  it('hides it once a specific doctor is picked, even for a non-doctor', () => {
    expect(showsDoctorName(false, 'd1')).toBe(false);
  });

  it('hides it for a doctor viewing their own (single-doctor) default queue', () => {
    expect(showsDoctorName(true, '')).toBe(false);
  });

  it('hides it for a staff-doctor who picked a specific colleague', () => {
    expect(showsDoctorName(true, 'd2')).toBe(false);
  });
});

describe('doctorFilterOptions', () => {
  it('labels the default option "My queue" for a doctor and "All doctors" for staff', () => {
    const docs = [{ id: 'd1', name: 'Dr One', specializations: [], fee: 0 }];
    expect(doctorFilterOptions(docs, true)[0]).toEqual({ value: '', label: 'My queue' });
    expect(doctorFilterOptions(docs, false)[0]).toEqual({ value: '', label: 'All doctors' });
  });

  it('lists every doctor after the default option, by id/name', () => {
    const docs = [
      { id: 'd1', name: 'Dr One', specializations: [], fee: 0 },
      { id: 'd2', name: 'Dr Two', specializations: [], fee: 0 },
    ];
    const opts = doctorFilterOptions(docs, false);
    expect(opts).toEqual([
      { value: '', label: 'All doctors' },
      { value: 'd1', label: 'Dr One' },
      { value: 'd2', label: 'Dr Two' },
    ]);
  });

  it('is just the default option when there are no doctors', () => {
    expect(doctorFilterOptions([], false)).toEqual([{ value: '', label: 'All doctors' }]);
  });
});

describe('doctorsFromRows (fallback when /api/doctors is not readable)', () => {
  it('derives the distinct doctor list from queue rows', () => {
    const rows = [
      row({ doctorUserId: 'd1', doctorName: 'A Doc' }),
      row({ visitId: 'v2', doctorUserId: 'd2', doctorName: 'B Doc' }),
      row({ visitId: 'v3', doctorUserId: 'd1', doctorName: 'A Doc' }), // duplicate
    ];
    expect(doctorsFromRows(rows)).toEqual([
      { id: 'd1', name: 'A Doc', specializations: [], fee: 0 },
      { id: 'd2', name: 'B Doc', specializations: [], fee: 0 },
    ]);
  });

  it('falls back to the id when doctorName is missing, and skips rows with no doctorUserId', () => {
    const rows = [
      row({ doctorUserId: 'd9', doctorName: null }),
      { ...row(), visitId: 'v4', doctorUserId: '' as unknown as string },
    ];
    expect(doctorsFromRows(rows)).toEqual([{ id: 'd9', name: 'd9', specializations: [], fee: 0 }]);
  });

  it('is empty for an empty row set', () => {
    expect(doctorsFromRows([])).toEqual([]);
  });
});
