import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { addField, addPage, emptyDefinition, setLabel } from '@prefrontal/forms-engine';
import { MockStudioApi } from './mock-studio-api';
import { StudioApi } from './studio-api';
import { PublishRefused } from './studio-models';
import { PREVIEW_RETRY_MS, SAVE_DEBOUNCE_MS, StudioSession } from './studio-session';
import { StudioError } from './studio-models';

function setup() {
  TestBed.resetTestingModule();
  const api = new MockStudioApi();
  TestBed.configureTestingModule({ providers: [StudioSession, { provide: StudioApi, useValue: api }] });
  return { api, session: TestBed.inject(StudioSession) };
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('StudioSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('saves the draft once, 800 ms after the last edit, and keeps an undo trail', async () => {
    const { api, session } = setup();
    const id = api.seed('ENT', addPage(emptyDefinition('ENT'), 'History').def);
    await session.load(id);
    const d0 = session.definition()!;
    session.apply(addField(d0, { pageKey: 'history' }, 'text').def);
    await tick(400);
    session.apply(setLabel(session.definition()!, session.definition()!.pages[0].fields[0].key, 'Notes'));
    expect(session.saveState()).toBe('dirty');
    await tick(SAVE_DEBOUNCE_MS + 10);
    expect(api.calls.filter((c) => c === 'saveDraft')).toHaveLength(1);
    expect(session.saveState()).toBe('saved');
    session.undo();
    expect(session.definition()!.pages[0].fields[0].label).not.toBe('Notes');
  });

  it('redo puts back what undo took; a new edit clears the redo trail', async () => {
    const { api, session } = setup();
    const id = api.seed('ENT', addPage(emptyDefinition('ENT'), 'History').def);
    await session.load(id);
    const d0 = session.definition()!;
    const d1 = addField(d0, { pageKey: 'history' }, 'text').def;
    session.apply(d1);
    expect(session.canRedo()).toBe(false);
    session.undo();
    expect(session.definition()).toBe(d0);
    expect(session.canRedo()).toBe(true);
    session.redo();
    expect(session.definition()).toBe(d1);
    expect(session.canUndo()).toBe(true);
    session.undo();
    session.apply(setLabel(d0, 'history', 'x'));
    expect(session.canRedo()).toBe(false);
  });

  it('a form opened on its live version starts the draft at the first edit (just looking creates nothing)', async () => {
    const { api, session } = setup();
    const id = api.seed('ENT', addPage(emptyDefinition('ENT'), 'History').def, { publish: true });
    await session.load(id);
    expect(session.onLive()).toBe(true);
    await tick(2000);
    expect(api.calls).not.toContain('startDraft');
    session.apply(addPage(session.definition()!, 'Exam').def);
    await tick(SAVE_DEBOUNCE_MS + 10);
    expect(api.calls).toContain('startDraft');
    expect(session.onLive()).toBe(false);
    expect(session.version()?.versionNo).toBe(2);
  });

  it('someone else saved first: nothing is lost, the choice is offered, "use theirs" takes their copy', async () => {
    const { api, session } = setup();
    const id = api.seed('ENT', addPage(emptyDefinition('ENT'), 'History').def);
    await session.load(id);
    api.otherSaves(id, (d) => (d.title = 'Their title'));
    session.apply(addPage(session.definition()!, 'Mine').def);
    await tick(SAVE_DEBOUNCE_MS + 10);
    expect(session.saveState()).toBe('conflict');
    expect(session.conflict()?.savedBy?.name).toBe('Dr Rao');
    expect(session.definition()!.pages.map((p) => p.title)).toContain('Mine'); // still on screen
    await session.resolve('theirs');
    expect(session.definition()!.title).toBe('Their title');
    expect(session.saveState()).toBe('saved');
  });

  it('"keep mine" saves over theirs on purpose', async () => {
    const { api, session } = setup();
    const id = api.seed('ENT', addPage(emptyDefinition('ENT'), 'History').def);
    await session.load(id);
    api.otherSaves(id, (d) => (d.title = 'Their title'));
    session.apply(addPage(session.definition()!, 'Mine').def);
    await tick(SAVE_DEBOUNCE_MS + 10);
    await session.resolve('mine');
    expect(session.saveState()).toBe('saved');
    expect((await api.version(id, api.forms.get(id)!.versions[0].id)).definition!.pages.map((p) => p.title)).toContain('Mine');
  });

  it('publish refused keeps the problems for the list', async () => {
    const { api, session } = setup();
    const d = addField(addPage(emptyDefinition('ENT'), 'History').def, { pageKey: 'history' }, 'choice');
    d.def.pages[0].fields[0].options = [];
    const id = api.seed('ENT', d.def);
    await session.load(id);
    await expect(session.publish()).rejects.toBeInstanceOf(PublishRefused);
    expect(session.problems()[0]).toMatchObject({ fieldKey: d.key, severity: 'error' });
  });

  it('the live narrative follows the latest edit only (300 ms)', async () => {
    const { api, session } = setup();
    const id = api.seed('ENT', addPage(emptyDefinition('ENT'), 'History').def);
    await session.load(id);
    await tick(10);
    const before = api.calls.filter((c) => c === 'livePreview').length;
    session.apply(addField(session.definition()!, { pageKey: 'history' }, 'yesno').def);
    session.apply(addField(session.definition()!, { pageKey: 'history' }, 'text').def);
    await tick(320);
    expect(api.calls.filter((c) => c === 'livePreview').length - before).toBe(1);
    expect(session.preview()?.sections[0].fieldKeys.length).toBeGreaterThan(0);
  });

  it('a throttled preview (429) keeps "Writing…" and asks again, so stale words never stay on screen', async () => {
    const { api, session } = setup();
    const id = api.seed('ENT', addPage(emptyDefinition('ENT'), 'History').def);
    await session.load(id);
    await tick(10);
    const real = api.livePreview.bind(api);
    let refuse = 1;
    api.livePreview = async (d, a) => {
      if (refuse-- > 0) throw new StudioError('too_many_requests', 'Too many requests.', 429);
      return real(d, a);
    };
    session.apply(addField(session.definition()!, { pageKey: 'history' }, 'yesno').def);
    await tick(320);
    expect(session.previewState()).toBe('loading');
    await tick(PREVIEW_RETRY_MS + 20);
    expect(session.previewState()).toBe('idle');
    expect(session.preview()?.sections[0].fieldKeys.length).toBeGreaterThan(0);
  });
});
