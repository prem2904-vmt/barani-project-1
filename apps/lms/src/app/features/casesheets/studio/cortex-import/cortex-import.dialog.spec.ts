import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { MockStudioApi } from '../data/mock-studio-api';
import { StudioApi } from '../data/studio-api';
import { CortexImportDialog } from './cortex-import.dialog';
import { CortexImportService } from './cortex-import.service';

const DEPTS = [{ key: 'ent', name: 'ENT', sortOrder: 1 }, { key: 'cardio', name: 'Cardiology', sortOrder: 2 }];
const pic = (name: string, type = 'image/jpeg', size = 1000) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const settle = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
  for (let i = 0; i < 4; i++) {
    f.detectChanges();
    await f.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  f.detectChanges();
};

describe('Cortex import dialog', () => {
  let api: MockStudioApi;

  async function open(depts = DEPTS, perms: string[] = ['casesheet_forms_manage']) {
    TestBed.resetTestingModule();
    api = new MockStudioApi();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StudioApi, useValue: api }, { provide: AuthService, useValue: { hasPermission: (c: string) => perms.includes(c) } }] });
    const f = TestBed.createComponent(CortexImportDialog);
    f.componentRef.setInput('departments', depts);
    await settle(f);
    const dlg = f.componentInstance;
    const el = f.nativeElement as HTMLElement;
    const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s);
    return { f, dlg, el, q, api, svc: TestBed.inject(CortexImportService) };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('asks for a department, an optional name and pages; the picker allows the camera and several files; the privacy note is there', async () => {
    const { q, el } = await open();
    const input = q<HTMLInputElement>('[data-file]')!;
    expect(input.accept).toBe('image/*,application/pdf');
    expect(input.multiple).toBe(true);
    expect(el.textContent).toContain('Department');
    expect(el.textContent).toContain('optional');
    expect(q('[data-privacy]')!.textContent).toContain("Use a blank sheet. Don't upload a sheet filled in for a patient.");
    expect(el.textContent).not.toMatch(/\bAI\b/);
  });

  it('Read the sheet is off until there is a department and a valid page', async () => {
    const { f, dlg, q } = await open();
    const read = () => q<HTMLButtonElement>('[data-act="read"]')!.disabled;
    expect(read()).toBe(true);
    dlg.addFiles([pic('a.jpg')]);
    await settle(f);
    expect(read()).toBe(true); // still no department
    (dlg as unknown as { dept: { set(v: string): void } }).dept.set('ent');
    await settle(f);
    expect(read()).toBe(false);
  });

  it('a single department is picked for you', async () => {
    const { f, dlg, q } = await open([DEPTS[0]]);
    dlg.addFiles([pic('a.jpg')]);
    await settle(f);
    expect(q<HTMLButtonElement>('[data-act="read"]')!.disabled).toBe(false);
  });

  it('a ninth page, over 20 MB, and a wrong type each say so and block sending', async () => {
    const { f, dlg, q } = await open([DEPTS[0]]);
    dlg.addFiles(Array.from({ length: 9 }, (_, i) => pic(`p${i}.jpg`)));
    await settle(f);
    expect(q('[data-problem]')!.textContent).toContain('Use up to 8 pages');
    expect(q<HTMLButtonElement>('[data-act="read"]')!.disabled).toBe(true);
    q<HTMLButtonElement>('[data-page="8"] [data-act="remove"]')!.click();
    await settle(f);
    expect(q('[data-problem]')).toBeNull();
    expect(q<HTMLButtonElement>('[data-act="read"]')!.disabled).toBe(false);

    dlg.addFiles([pic('big.pdf', 'application/pdf', 21 * 1024 * 1024)]);
    await settle(f);
    // 8 pages already: the count problem comes first; remove one and the size shows
    q<HTMLButtonElement>('[data-page="0"] [data-act="remove"]')!.click();
    await settle(f);
    expect(q('[data-problem]')!.textContent).toContain('over 20 MB');

    dlg.addFiles([pic('notes.docx', 'application/msword')]);
    await settle(f);
    expect(q('[data-problem]')!.textContent).toContain('“notes.docx” isn\'t a photo or a PDF');
    expect(f.nativeElement.querySelectorAll('[data-page]').length).toBe(8);
  });

  it('pages can be moved up and down and removed; the count line follows', async () => {
    const { f, dlg, q, el } = await open();
    dlg.addFiles([pic('a.jpg'), pic('b.jpg'), pic('c.jpg')]);
    await settle(f);
    const names = () => [...el.querySelectorAll('[data-page] .ci-page__f')].map((n) => n.textContent!.split(' · ')[0]);
    expect(names()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(q<HTMLButtonElement>('[data-page="0"] [data-act="up"]')!.disabled).toBe(true);
    q<HTMLButtonElement>('[data-page="2"] [data-act="up"]')!.click();
    await settle(f);
    expect(names()).toEqual(['a.jpg', 'c.jpg', 'b.jpg']);
    q<HTMLButtonElement>('[data-page="0"] [data-act="remove"]')!.click();
    await settle(f);
    expect(names()).toEqual(['c.jpg', 'b.jpg']);
    expect(q('[data-count]')!.textContent).toContain('2 of 8 pages');
  });

  it('Read the sheet sends the pages in order and shows the four steps', async () => {
    const { f, dlg, q, el, svc } = await open([DEPTS[0]]);
    const send = vi.spyOn(api, 'draftFromSheet');
    dlg.addFiles([pic('a.jpg'), pic('b.pdf', 'application/pdf')]);
    (dlg as unknown as { name: { set(v: string): void } }).name.set('  ENT sheet ');
    await settle(f);
    q<HTMLButtonElement>('[data-act="read"]')!.click();
    await settle(f);
    await vi.waitFor(() => expect(svc.job()).not.toBeNull());
    await settle(f);
    const arg = send.mock.calls[0][0];
    expect(arg.files.map((x) => x.name)).toEqual(['a.jpg', 'b.pdf']);
    expect(arg).toMatchObject({ departmentKey: 'ent', title: 'ENT sheet' });
    expect([...el.querySelectorAll('[data-steps] .ci-step__t')].map((n) => n.textContent)).toEqual([
      'Reading the pages',
      'Building the questions',
      'Writing what it says',
      'Checking',
    ]);
    svc.dismiss();
  });

  it('a refused start shows its words in the dialog', async () => {
    const { f, dlg, q } = await open([DEPTS[0]]);
    vi.spyOn(api, 'draftFromSheet').mockRejectedValue(Object.assign(new Error('x'), { code: 'cap_reached', status: 429 }));
    dlg.addFiles([pic('a.jpg')]);
    await settle(f);
    q<HTMLButtonElement>('[data-act="read"]')!.click();
    await vi.waitFor(() => expect(q('[data-start-error]')).not.toBeNull());
    expect(q('[data-start-error]')!.textContent).toContain('limit for Cortex');
  });

  it('a refused sheet says so in the heading, not "Cortex is reading your sheet"', async () => {
    const { f, dlg, q, el } = await open([DEPTS[0]]);
    vi.spyOn(api, 'draftJob').mockResolvedValue({ status: 'failed', code: 'patient_data', message: 'x' });
    expect(q('#ci-title')!.textContent).toBe('Start from a paper case sheet');
    dlg.addFiles([pic('a.jpg')]);
    await settle(f);
    q<HTMLButtonElement>('[data-act="read"]')!.click();
    await vi.waitFor(async () => { await settle(f); expect(q('[data-failure]')).not.toBeNull(); }, { timeout: 5000 });
    expect(q('#ci-title')!.textContent).toBe('Cortex could not use this sheet');
    expect(el.textContent).not.toContain('Hold on');
    expect(q('[data-failure]')!.textContent).toContain("patient's details");
  });

  it('closing the progress view hides it; the job keeps running', async () => {
    const { f, dlg, q, svc } = await open([DEPTS[0]]);
    const closed = vi.fn();
    dlg.closed.subscribe(closed);
    dlg.addFiles([pic('a.jpg')]);
    await settle(f);
    q<HTMLButtonElement>('[data-act="read"]')!.click();
    await vi.waitFor(() => expect(svc.viewing()).toBe(true));
    await settle(f);
    expect(q('[data-bg-note]')!.textContent).toContain('You can close this');
    q<HTMLButtonElement>('[data-act="cancel"]')!.click();
    expect(closed).toHaveBeenCalled();
    expect(svc.viewing()).toBe(false);
    expect(svc.running()).toBe(true);
    svc.dismiss();
  });

  describe('no departments yet', () => {
    it('a case sheet builder adds the first department right there, and it is picked for them', async () => {
      const { f, dlg, q, el, api } = await open([]);
      api.depts.splice(0);
      expect(el.textContent).not.toContain('No departments to pick from yet.');
      expect(q('[data-no-depts]')!.textContent).toContain('Add the first department');
      expect(q('[data-act="manage-depts"]')!.getAttribute('href')).toBe('/admin/ipd/departments');
      const added = vi.fn();
      dlg.departmentAdded.subscribe(added);

      const input = q<HTMLInputElement>('[data-dept-name]')!;
      input.value = 'Cardiology';
      input.dispatchEvent(new Event('input'));
      f.detectChanges();
      q<HTMLButtonElement>('[data-act="add-dept"]')!.click();
      await settle(f);

      expect(api.depts.map((d) => d.name)).toEqual(['Cardiology']);
      expect(added).toHaveBeenCalledWith(expect.objectContaining({ key: 'cardiology', name: 'Cardiology' }));
      // the picker now exists with the new department chosen; with a page, Read the sheet can go
      expect(q('[data-dept]')).not.toBeNull();
      expect(q('[data-dept-name]')).toBeNull();
      dlg.addFiles([pic('a.jpg')]);
      await settle(f);
      expect(q<HTMLButtonElement>('[data-act="read"]')!.disabled).toBe(false);
    });

    it('someone without the builder permission is told who to ask, with nothing to add', async () => {
      const { q, el } = await open([], []);
      expect(q('[data-no-depts]')!.textContent).toContain('Ask your case sheet admin to add a department in Settings → IPD.');
      expect(q('[data-dept-name]')).toBeNull();
      expect(q('[data-act="manage-depts"]')).toBeNull();
      expect(el.textContent).not.toMatch(/\bAI\b/);
    });

    it('Read the sheet stays off without a department and says why in one line under the buttons', async () => {
      const { f, dlg, q } = await open([]);
      dlg.addFiles([pic('a.jpg')]);
      await settle(f);
      expect(q<HTMLButtonElement>('[data-act="read"]')!.disabled).toBe(true);
      expect(q('[data-read-hint]')!.textContent).toContain('Add a department first');
    });
  });

  it('with departments but none picked, the hint says to pick one; with a department and no page, to add a page', async () => {
    const { f, dlg, q } = await open();
    expect(q('[data-read-hint]')!.textContent).toContain('Pick a department');
    (dlg as unknown as { dept: { set(v: string): void } }).dept.set('ent');
    await settle(f);
    expect(q('[data-read-hint]')!.textContent).toContain('Add at least one page');
    dlg.addFiles([pic('a.jpg')]);
    await settle(f);
    expect(q('[data-read-hint]')).toBeNull();
  });

  it('a long file name is not cut by script: the whole name is the tooltip and the label may wrap', async () => {
    const { f, dlg, q } = await open([DEPTS[0]]);
    const name = 'IMG_2026-11-11_very_long_case_sheet_scan_page_one_of_two.jpg';
    dlg.addFiles([pic(name)]);
    await settle(f);
    const label = q('[data-page="0"] .ci-page__f')!;
    expect(label.getAttribute('title')).toBe(name);
    expect(label.textContent!.trim()).toBe(name);
  });
});
