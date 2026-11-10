import { HttpErrorResponse } from '@angular/common/http';
import { mapError, toDiff, toImport, toVersion } from './http-studio-api';
import { DraftConflict, PublishRefused, StudioError } from './studio-models';

describe('HttpStudioApi wire mapping', () => {
  it('409 someone_else_saved → DraftConflict with their copy and name', () => {
    const e = mapError(
      new HttpErrorResponse({
        status: 409,
        error: {
          code: 'someone_else_saved',
          detail: 'Dr Rao saved this form first.',
          current: { id: 'v2', formId: 'f', versionNo: 2, state: 'draft', rowVersion: 7, definition: { pages: [] } },
          savedBy: { id: 'u', name: 'Dr Rao', email: 'rao@x' },
        },
      }),
    );
    expect(e).toBeInstanceOf(DraftConflict);
    expect((e as DraftConflict).current.rowVersion).toBe(7);
    expect((e as DraftConflict).savedBy?.name).toBe('Dr Rao');
    expect((e as DraftConflict).message).toBe('Dr Rao saved this form first.');
  });

  it('422 form_has_errors → PublishRefused with the problems placed per field', () => {
    const e = mapError(
      new HttpErrorResponse({
        status: 422,
        error: {
          code: 'form_has_errors',
          title: 'Fix these before publishing.',
          problems: [{ severity: 'error', path: 'pages[0].fields[0](side).options', pageKey: 'p1', pageTitle: 'Basics', fieldKey: 'side', fieldLabel: 'Side', where: "Field 'Side'", message: 'A choice field needs at least one option.', summary: '…' }],
        },
      }),
    );
    expect(e).toBeInstanceOf(PublishRefused);
    expect((e as PublishRefused).problems[0]).toMatchObject({ fieldKey: 'side', pageKey: 'p1', severity: 'error' });
  });

  it('other problem+json → StudioError in the API’s words; offline passes through', () => {
    const e = mapError(new HttpErrorResponse({ status: 409, error: { code: 'draft_exists', detail: 'This form already has a draft being edited.' } }));
    expect(e).toBeInstanceOf(StudioError);
    expect((e as StudioError).message).toBe('This form already has a draft being edited.');
    const off = new HttpErrorResponse({ status: 0 });
    expect(mapError(off)).toBe(off);
  });

  it('diff, version and import report shapes', () => {
    const d = toDiff({
      from: { id: 'a', versionNo: 1, state: 'published' },
      to: { id: 'b', versionNo: 2, state: 'draft' },
      summary: { headline: '1 field added', total: 1 },
      changes: [{ type: 'field_added', pageTitle: 'History', fieldKey: 'smell', words: "Added field 'Loss of smell'." }],
    });
    expect(d).toMatchObject({ headline: '1 field added', total: 1, to: { versionNo: 2 } });
    expect(d.changes[0]).toMatchObject({ type: 'field_added', fieldKey: 'smell', pageKey: null });
    expect(toVersion({ state: 'weird' }).state).toBe('draft');
    const r = toImport({ saved: false, definition: { pages: [] }, report: { summary: 'Imported', canPublish: false, counts: { pages: 5 }, items: [{ level: 'problem', message: 'x' }] } });
    expect(r.report).toMatchObject({ canPublish: false, counts: { pages: 5, fields: 0 } });
    expect(r.report.items[0].level).toBe('problem');
  });
});
