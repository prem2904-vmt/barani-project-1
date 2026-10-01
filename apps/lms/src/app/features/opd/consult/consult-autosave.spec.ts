import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConsultApi, type ConsultDraftPatchResult, type ConsultWorkspace } from './consult.api';
import { OpdConsultWorkspacePage } from './consult-workspace.page';

/**
 * Critic P1-2: the autosave PATCH must never go out twice concurrently
 * under continuous typing, and a stale_draft must never silently discard
 * what the doctor typed.
 */
const WS: ConsultWorkspace = {
  visit: {
    id: 'v1', patientId: 'p1', doctorUserId: 'd1', departmentId: 'dep1', serviceId: 'svc1',
    visitDate: '2026-10-01', token: 3, tokenLabel: 'E3', status: 'in_consult', isFollowUp: false, canEdit: true,
  },
  patient: { id: 'p1', name: 'Kavitha Ramesh' },
  vitals: null, vitalsHistory: [],
  consult: {
    id: 'c1', chiefComplaint: '', diagnoses: [], advice: '', privateNotes: '', privateNotesVisibility: 'doctor',
    privateNotesHidden: false, status: 'draft', updatedAt: '2026-10-01T05:00:00.000Z',
  },
  rx: [], investigations: [], allergies: [], form: null, followUpRule: null, lastVisit: null,
  currentMedicines: [], conditions: [], pastVisits: [], noteVisibilityDefault: 'doctor',
};

function apiMock(over: Partial<Record<keyof ConsultApi, unknown>> = {}) {
  return {
    myQueue: vi.fn(() => of([])),
    workspace: vi.fn(() => of(WS)),
    start: vi.fn(() => of(WS)),
    saveDraft: vi.fn(() => of(WS)),
    patchDraft: vi.fn(() => of({ consultId: 'c1', updatedAt: '2026-10-01T05:00:01.000Z' } satisfies ConsultDraftPatchResult)),
    complete: vi.fn(() => of(WS)),
    allergies: vi.fn(() => of([])),
    diagnoses: vi.fn(() => of([])),
    usual: vi.fn(() => of(null)),
    drugs: vi.fn(() => of([])),
    history: vi.fn(() => of([])),
    labTests: vi.fn(() => of([])),
    labTrends: vi.fn(() => of({ tests: [] })),
    ...over,
  } as unknown as ConsultApi;
}

function render(api: ConsultApi) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [OpdConsultWorkspacePage],
    providers: [
      { provide: ConsultApi, useValue: api },
      { provide: ApiService, useValue: { get: vi.fn(() => of(null)) } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false), prompt: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ displayName: 'Dr. Rao', tenantName: 'Micro World' }) } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ visitId: 'v1' }) } } },
    ],
  });
  const f = TestBed.createComponent(OpdConsultWorkspacePage);
  const c = f.componentInstance;
  // Load the workspace WITHOUT rendering the (heavy) template — ngOnInit
  // does the data load; the concurrency/staleness logic under test lives in
  // plain methods (patch/saveNow) that don't need a rendered DOM.
  c.ngOnInit();
  return { f, c };
}

describe('Autosave concurrency + stale-draft recovery (critic P1-2)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('never sends a second PATCH while one is in flight — continuous typing queues, then drains with the FRESH base', () => {
    const inFlight = new Subject<ConsultDraftPatchResult>();
    const api = apiMock({ patchDraft: vi.fn(() => inFlight.asObservable()) });
    const { c } = render(api);

    c.patch({ advice: 'first edit' });
    c.saveNow();
    expect(api.patchDraft).toHaveBeenCalledTimes(1);
    const firstBase = (api.patchDraft as ReturnType<typeof vi.fn>).mock.calls[0][1].baseUpdatedAt;
    expect(firstBase).toBe('2026-10-01T05:00:00.000Z');

    // The doctor keeps typing while the first PATCH is still in flight — the
    // debounce would fire saveNow() again; simulate that tick directly.
    c.patch({ advice: 'second edit while saving' });
    c.saveNow();
    // Still exactly ONE call — no concurrent PATCH went out.
    expect(api.patchDraft).toHaveBeenCalledTimes(1);

    // The first PATCH resolves.
    inFlight.next({ consultId: 'c1', updatedAt: '2026-10-01T05:00:01.000Z' });
    inFlight.complete();

    // It drains the queued edit automatically, with the FRESH base — never the stale original one.
    expect(api.patchDraft).toHaveBeenCalledTimes(2);
    const secondBase = (api.patchDraft as ReturnType<typeof vi.fn>).mock.calls[1][1].baseUpdatedAt;
    expect(secondBase).toBe('2026-10-01T05:00:01.000Z');
  });

  it('a stale_draft refetches, keeps the still-dirty local edit, and re-PATCHes instead of discarding it', async () => {
    const fresh: ConsultWorkspace = {
      ...WS,
      consult: { ...WS.consult!, advice: 'Someone else’s edit', updatedAt: '2026-10-01T05:00:05.000Z' },
    };
    // Stale ONCE (one real race), then the retry (with the fresh base) succeeds.
    let patchCalls = 0;
    const api = apiMock({
      patchDraft: vi.fn(() => {
        patchCalls++;
        return patchCalls === 1
          ? throwError(() => ({ code: 'stale_draft', message: 'stale' }))
          : of({ consultId: 'c1', updatedAt: '2026-10-01T05:00:06.000Z' } satisfies ConsultDraftPatchResult);
      }),
      workspace: vi.fn().mockReturnValueOnce(of(WS)).mockReturnValue(of(fresh)),
    });
    const { c } = render(api);

    c.patch({ advice: 'my unsaved edit' });
    c.saveNow();
    await Promise.resolve();

    // The doctor's own edit survives — never silently clobbered by the fresh fetch.
    expect((c as unknown as { st: () => { advice: string } }).st().advice).toBe('my unsaved edit');
    // It re-PATCHes with the NEW base once the merge completes.
    expect(api.patchDraft).toHaveBeenCalledTimes(2);
    const retriedBase = (api.patchDraft as ReturnType<typeof vi.fn>).mock.calls[1][1].baseUpdatedAt;
    expect(retriedBase).toBe('2026-10-01T05:00:05.000Z');
  });
});
