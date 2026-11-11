import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { MockStudioApi } from '../data/mock-studio-api';
import { StudioApi } from '../data/studio-api';
import { DraftJob, StudioError } from '../data/studio-models';
import { POLL_MS, CortexImportService } from './cortex-import.service';

const png = () => new File(['x'], 'p.png', { type: 'image/png' });
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** A scripted API: the job answers with these in turn. */
class ScriptedApi extends MockStudioApi {
  started: unknown[] = [];
  script: (DraftJob | Error)[] = [];
  polls = 0;
  override async draftFromSheet(input: never): Promise<{ jobId: string }> {
    this.started.push(input);
    return { jobId: 'job-1' };
  }
  override async draftJob(): Promise<DraftJob> {
    this.polls++;
    const next = this.script.shift() ?? { status: 'checking' };
    if (next instanceof Error) throw next;
    return next;
  }
}

describe('Cortex import service', () => {
  let api: ScriptedApi;
  let svc: CortexImportService;
  let nav: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    api = new ScriptedApi();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StudioApi, useValue: api }] });
    nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    svc = TestBed.inject(CortexImportService);
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  const tick = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await flush();
  };

  it('sends the pages, the department and the name, then polls every 2 seconds and ticks the steps', async () => {
    api.script = [{ status: 'reading' }, { status: 'building' }, { status: 'checking' }];
    expect(await svc.start({ files: [png()], departmentKey: 'ent', title: 'ENT sheet' })).toBe(true);
    expect(api.started[0]).toMatchObject({ departmentKey: 'ent', title: 'ENT sheet' });
    expect(svc.viewing()).toBe(true);
    expect(svc.job()).toMatchObject({ jobId: 'job-1', name: 'ENT sheet', status: 'queued' });

    await tick(0);
    expect(svc.job()!.status).toBe('reading');
    expect(api.polls).toBe(1);
    await tick(POLL_MS - 1);
    expect(api.polls).toBe(1);
    await tick(1);
    expect(svc.job()!.status).toBe('building');
    await tick(POLL_MS);
    expect(svc.job()!.status).toBe('checking');
    expect(api.polls).toBe(3);
    expect(svc.running()).toBe(true);
  });

  it('with no name the chip says "your case sheet"', async () => {
    await svc.start({ files: [png()], departmentKey: 'ent' });
    expect(svc.job()!.name).toBe('your case sheet');
  });

  it('done while the progress view is open: goes straight to the editor, and stops polling', async () => {
    api.script = [{ status: 'building' }, { status: 'done', formId: 'f9', checkCount: 3 }];
    await svc.start({ files: [png()], departmentKey: 'ent' });
    await tick(0);
    await tick(POLL_MS);
    expect(nav).toHaveBeenCalledWith(['/admin/ipd/myprefrontal/forms/f9']);
    expect(svc.job()).toBeNull();
    const polls = api.polls;
    await tick(POLL_MS * 3);
    expect(api.polls).toBe(polls);
  });

  it('closed before it finishes: the job keeps going, and when done it waits on the chip (no surprise navigation)', async () => {
    api.script = [{ status: 'reading' }, { status: 'done', formId: 'f9', checkCount: 2 }];
    await svc.start({ files: [png()], departmentKey: 'ent', title: 'Cardiology' });
    await tick(0);
    svc.hide();
    expect(svc.viewing()).toBe(false);
    expect(svc.running()).toBe(true);
    await tick(POLL_MS);
    expect(nav).not.toHaveBeenCalled();
    expect(svc.job()).toMatchObject({ status: 'done', formId: 'f9', checkCount: 2, name: 'Cardiology' });
    await svc.open();
    expect(nav).toHaveBeenCalledWith(['/admin/ipd/myprefrontal/forms/f9']);
    expect(svc.job()).toBeNull();
  });

  it.each([
    ['unreadable', 'Try a clearer photo.'],
    ['patient_data', "This sheet has a patient's details. Upload a blank one."],
    ['model_error', 'went wrong on our side'],
    ['invalid_result', "couldn't turn this sheet into a case sheet"],
    ['timeout', 'took too long'],
    ['bad_reply', 'came back incomplete'],
  ])('a failed job (%s) stops with its message and does not navigate', async (code, words) => {
    api.script = [{ status: 'failed', code, message: 'server words' }];
    await svc.start({ files: [png()], departmentKey: 'ent' });
    await tick(0);
    expect(svc.job()!.status).toBe('failed');
    expect(svc.job()!.failure).toContain(words);
    expect(svc.running()).toBe(false);
    expect(nav).not.toHaveBeenCalled();
    const polls = api.polls;
    await tick(POLL_MS * 2);
    expect(api.polls).toBe(polls);
  });

  it('a job the server no longer knows (404) ends with words', async () => {
    api.script = [new StudioError('not_found', 'gone', 404)];
    await svc.start({ files: [png()], departmentKey: 'ent' });
    await tick(0);
    expect(svc.job()).toMatchObject({ status: 'failed' });
    expect(svc.job()!.failure).toContain('expired');
  });

  it('a few dropped polls are retried; many in a row give up', async () => {
    const off = Object.assign(new Error('offline'), { status: 0 });
    api.script = [off, off, { status: 'reading' }];
    await svc.start({ files: [png()], departmentKey: 'ent' });
    await tick(0);
    await tick(POLL_MS);
    await tick(POLL_MS);
    expect(svc.job()!.status).toBe('reading');
    api.script = Array.from({ length: 6 }, () => off);
    for (let i = 0; i < 6; i++) await tick(POLL_MS);
    expect(svc.job()!.status).toBe('failed');
    expect(svc.job()!.failure).toContain('Lost the connection');
  });

  it.each([
    ['no_files', 400, 'Add at least one page.'],
    ['bad_type', 400, 'JPEG, PNG, WebP or PDF'],
    ['feature_off', 403, "Cortex isn't switched on"],
    ['cortex_unavailable', 424, "Cortex isn't set up yet."],
    ['cap_reached', 429, 'limit for Cortex'],
  ])('a refused start (%s) leaves the form open with its words', async (code, status, words) => {
    api.draftFromSheet = async () => {
      throw new StudioError(code, 'x', status);
    };
    expect(await svc.start({ files: [png()], departmentKey: 'ent' })).toBe(false);
    expect(svc.startError()).toContain(words);
    expect(svc.job()).toBeNull();
    expect(svc.unavailable()).toBe(false);
  });

  it('404 on the start means the server does not offer it: friendly message, and the button goes away', async () => {
    api.draftFromSheet = async () => {
      throw Object.assign(new Error('nf'), { status: 404 });
    };
    expect(await svc.start({ files: [png()], departmentKey: 'ent' })).toBe(false);
    expect(svc.startError()).toContain("isn't available here yet");
    expect(svc.unavailable()).toBe(true);
  });

  it('reading a long sheet in parts: the server\'s progress words are kept between polls', async () => {
    api.script = [
      { status: 'reading', progress: { text: 'Finding the case sheets in this file.', done: 0, total: 0, sheets: 0 } },
      { status: 'reading', progress: { text: 'Found 4 case sheets. Reading part 3 of 9.', done: 2, total: 9, sheets: 4 } },
      { status: 'building' },
    ];
    await svc.start({ files: [png()], departmentKey: 'ent' });
    await tick(0);
    expect(svc.job()!.progress!.text).toContain('Finding');
    await tick(POLL_MS);
    expect(svc.job()!.progress).toEqual({ text: 'Found 4 case sheets. Reading part 3 of 9.', done: 2, total: 9, sheets: 4 });
    await tick(POLL_MS);
    expect(svc.job()!.status).toBe('building');
    expect(svc.job()!.progress!.done).toBe(2);
  });

  const made = (id: string, title: string, warnings: string[] = []) => ({ formId: id, title, departmentKey: 'm', departmentName: 'Medicine', fromPage: 1, toPage: 9, checkCount: 1, warnings });

  it('several case sheets made: no jump to the editor; the list stays, each opens on its own', async () => {
    api.script = [{ status: 'done', formId: 'g', checkCount: 1, drafts: [made('g', 'Gastrointestinal system'), made('c', 'CNS'), made('r', 'Respiratory system'), made('v', 'CVS')] }];
    await svc.start({ files: [png()], departmentKey: 'ent' });
    await tick(0);
    expect(nav).not.toHaveBeenCalled();
    expect(svc.job()).toMatchObject({ status: 'done', formId: 'g' });
    expect(svc.job()!.drafts!.map((d) => d.title)).toEqual(['Gastrointestinal system', 'CNS', 'Respiratory system', 'CVS']);
    expect(svc.viewing()).toBe(true);
    await svc.open('c');
    expect(nav).toHaveBeenCalledWith(['/admin/ipd/myprefrontal/forms/c']);
    expect(svc.job()!.drafts).toHaveLength(4);   // the others can still be opened from the chip
    expect(svc.viewing()).toBe(false);
  });

  it('one case sheet with a warning also waits, so the warning is seen', async () => {
    api.script = [{ status: 'done', formId: 'f1', checkCount: 0, drafts: [made('f1', 'CNS', ['Pages 10–14 could not be read (Cortex took too long on them). Add those questions in Studio.'])] }];
    await svc.start({ files: [png()], departmentKey: 'ent' });
    await tick(0);
    expect(nav).not.toHaveBeenCalled();
    expect(svc.job()!.drafts![0].warnings[0]).toContain('Pages 10–14');
  });

  it('only one job at a time', async () => {
    await svc.start({ files: [png()], departmentKey: 'ent' });
    expect(await svc.start({ files: [png()], departmentKey: 'ent' })).toBe(false);
    expect(api.started).toHaveLength(1);
  });
});
