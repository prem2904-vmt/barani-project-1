import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { addField, addPage, emptyDefinition, setLabel } from '@prefrontal/forms-engine';
import { MockStudioApi } from '../data/mock-studio-api';
import { StudioApi } from '../data/studio-api';
import { StudioHistoryPage } from './history.page';

describe('version history', () => {
  it('lists versions and shows what changed in words, grouped by page', async () => {
    TestBed.resetTestingModule();
    const api = new MockStudioApi();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StudioApi, useValue: api }] });
    let def = addPage(emptyDefinition('ENT'), 'History').def;
    const pain = addField(def, { pageKey: 'history' }, 'yesno');
    def = setLabel(pain.def, pain.key, 'Pain');
    const id = api.seed('ENT', def, { publish: true });
    await api.startDraft(id);
    const draft = api.forms.get(id)!.versions[1];
    await api.saveDraft(id, setLabel(addField(def, { pageKey: 'history' }, 'text').def, pain.key, 'Throat pain'), draft.rowVersion);

    const f = TestBed.createComponent(StudioHistoryPage);
    f.componentRef.setInput('id', id);
    f.detectChanges();
    await new Promise((r) => setTimeout(r, 20));
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('.hi-row__t')].map((x) => x.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Version 2 Draft', 'Version 1 Live']);
    expect(el.querySelector('[data-headline]')!.textContent).toMatch(/added/);
    const words = [...el.querySelectorAll('.hi-ch__w')].map((x) => x.textContent);
    expect(words).toContain('Added the question “Text”');
    expect(words).toContain('Renamed “Pain”');
    expect(el.querySelector('.hi-grp__t')!.textContent).toBe('History');
    expect(el.querySelector('.hi-now')!.textContent).toContain('Throat pain');
  });
});
