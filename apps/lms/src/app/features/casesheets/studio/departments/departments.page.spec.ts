import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogService } from '../../../../core/services/dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { MockStudioApi } from '../data/mock-studio-api';
import { StudioApi } from '../data/studio-api';
import { DepartmentsPage, STARTER_DEPARTMENTS } from './departments.page';

const settle = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
  for (let i = 0; i < 6; i++) {
    f.detectChanges();
    await f.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  f.detectChanges();
};

describe('Settings > IPD > Departments page', () => {
  const dialog = { confirm: vi.fn(async () => true) };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

  async function open(seed: (api: MockStudioApi) => void = () => undefined) {
    TestBed.resetTestingModule();
    const api = new MockStudioApi();
    seed(api);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: StudioApi, useValue: api }, { provide: DialogService, useValue: dialog }, { provide: ToastService, useValue: toasts }],
    });
    const f = TestBed.createComponent(DepartmentsPage);
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s);
    const names = () => [...el.querySelectorAll('[data-dept] .dd__name')].map((n) => (n.textContent ?? '').trim());
    return { f, el, q, api, names };
  }
  const own = (key: string, name: string, sortOrder: number, isActive = true) => ({ key, name, sortOrder, isActive, own: true });

  beforeEach(() => {
    dialog.confirm.mockReset().mockResolvedValue(true);
    for (const t of Object.values(toasts)) t.mockReset();
  });
  afterEach(() => TestBed.resetTestingModule());

  it('lists masters read-only with a "From Prefrontal" chip, and the lab\'s own with the edit actions', async () => {
    const { el, api } = await open((a) => a.depts.push(own('cardio', 'Cardiology', 3)));
    expect(api.calls).toContain('departments');
    const master = el.querySelector('[data-dept="ent"]')!;
    expect(master.querySelector('[data-tag="master"]')!.textContent).toContain('From Prefrontal');
    expect(master.querySelector('[data-act="rename"], [data-act="remove"], [data-act="up"], pf-toggle')).toBeNull();
    const mine = el.querySelector('[data-dept="cardio"]')!;
    expect(mine.querySelector('[data-act="rename"]')).not.toBeNull();
    expect(mine.querySelector('[data-act="remove"]')).not.toBeNull();
    expect(mine.querySelector('pf-toggle')).not.toBeNull();
    expect(mine.querySelector('[data-tag="master"]')).toBeNull();
  });

  it('asks the server for hidden departments too, and marks them "Hidden from doctors"', async () => {
    const { el } = await open((a) => a.depts.push(own('cardio', 'Cardiology', 3, false)));
    expect(el.querySelector('[data-dept="cardio"] [data-tag="hidden"]')!.textContent).toContain('Hidden from doctors');
  });

  it('Add: the name box adds a department on Enter, then clears and shows it', async () => {
    const { f, el, q, api } = await open();
    const input = q<HTMLInputElement>('[data-dept-name]')!;
    input.value = 'Cardiology';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle(f);
    expect(api.depts.find((d) => d.name === 'Cardiology')).toMatchObject({ own: true, isActive: true });
    expect(el.querySelector('[data-dept="cardiology"]')).not.toBeNull();
    expect(toasts.success).toHaveBeenCalledWith('Added Cardiology');
    expect(q<HTMLInputElement>('[data-dept-name]')!.value).toBe('');
  });

  it('Add: a name that is taken says so in plain words and adds nothing', async () => {
    const { f, q, api } = await open();
    const n = api.depts.length;
    const input = q<HTMLInputElement>('[data-dept-name]')!;
    input.value = 'ent';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    q<HTMLButtonElement>('[data-act="add-dept"]')!.click();
    await settle(f);
    expect(api.depts.length).toBe(n);
    expect(q('[data-dept-error]')!.textContent).toContain('already a department');
  });

  it('empty list: a helpful state, not a dead end', async () => {
    const { q } = await open((a) => a.depts.splice(0));
    expect(q('[data-empty="departments"]')!.textContent).toContain('No departments yet');
    expect(q('[data-act="starter"]')!.textContent).toContain('Add common departments');
    expect(q('[data-dept-name]')).not.toBeNull();
  });

  it('the starter set adds one department each, skipping names already there (any case), with ONE toast', async () => {
    const { f, api } = await open((a) => {
      a.depts.splice(0);
      a.depts.push(own('p', 'paediatrics', 1), { key: 'e', name: 'ENT', sortOrder: 2, isActive: true, own: false });
    });
    await (f.componentInstance as unknown as { addStarter(): Promise<void> }).addStarter();
    await settle(f);
    expect(api.calls.filter((c) => c === 'createDepartment')).toHaveLength(STARTER_DEPARTMENTS.length - 2);
    expect(api.depts.filter((d) => d.name.toLowerCase() === 'ent')).toHaveLength(1);
    expect(api.depts.filter((d) => d.name.toLowerCase() === 'paediatrics')).toHaveLength(1);
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledWith(`Added ${STARTER_DEPARTMENTS.length - 2} departments`);
  });

  it('empty list: the starter button creates all ten', async () => {
    const { f, q, api } = await open((a) => a.depts.splice(0));
    q<HTMLButtonElement>('[data-act="starter"]')!.click();
    await settle(f);
    expect(api.depts.map((d) => d.name)).toEqual([...STARTER_DEPARTMENTS]);
    expect(toasts.success).toHaveBeenCalledWith('Added 10 departments');
  });

  it('rename: click the name, type, Enter saves; Esc cancels', async () => {
    const { f, el, q, api } = await open((a) => a.depts.push(own('cardio', 'Cardiology', 3)));
    const rename = () => el.querySelector<HTMLButtonElement>('[data-dept="cardio"] [data-act="rename"]')!;
    rename().click();
    await settle(f);
    let input = q<HTMLInputElement>('[data-edit]')!;
    input.value = 'Cardiac care';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle(f);
    expect(api.depts.find((d) => d.key === 'cardio')!.name).toBe('Cardiac care');
    expect(q('[data-edit]')).toBeNull();

    rename().click();
    await settle(f);
    input = q<HTMLInputElement>('[data-edit]')!;
    input.value = 'Something else';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle(f);
    expect(api.depts.find((d) => d.key === 'cardio')!.name).toBe('Cardiac care');
    expect(q('[data-edit]')).toBeNull();
  });

  it('reorder: up / down swap the sort order of two of the lab\'s own departments; the ends are disabled', async () => {
    const { f, el, api, names } = await open((a) => a.depts.push(own('a', 'Alpha', 10), own('b', 'Beta', 20)));
    expect(names()).toEqual(['ENT', 'General medicine', 'Alpha', 'Beta']);
    const btn = (key: string, act: string) => el.querySelector<HTMLButtonElement>(`[data-dept="${key}"] [data-act="${act}"]`)!;
    expect(btn('a', 'up').disabled).toBe(true);
    expect(btn('b', 'down').disabled).toBe(true);
    btn('b', 'up').click();
    await settle(f);
    expect(api.depts.find((d) => d.key === 'b')!.sortOrder).toBe(10);
    expect(api.depts.find((d) => d.key === 'a')!.sortOrder).toBe(20);
    expect(names()).toEqual(['ENT', 'General medicine', 'Beta', 'Alpha']);
  });

  it('reorder: two departments with the same sort order still swap', async () => {
    const { f, el, names } = await open((a) => a.depts.push(own('a', 'Alpha', 5), own('b', 'Beta', 5)));
    el.querySelector<HTMLButtonElement>('[data-dept="b"] [data-act="up"]')!.click();
    await settle(f);
    expect(names().slice(2)).toEqual(['Beta', 'Alpha']);
  });

  it('toggle: switching off hides it from doctors; switching back on shows it again', async () => {
    const { f, el, api } = await open((a) => a.depts.push(own('cardio', 'Cardiology', 3)));
    const toggle = () => el.querySelector<HTMLElement>('[data-dept="cardio"] pf-toggle button')!;
    toggle().click();
    await settle(f);
    expect(api.depts.find((d) => d.key === 'cardio')!.isActive).toBe(false);
    expect(el.querySelector('[data-dept="cardio"] [data-tag="hidden"]')).not.toBeNull();
    expect(toasts.success).toHaveBeenLastCalledWith('Cardiology is hidden from doctors');
    toggle().click();
    await settle(f);
    expect(api.depts.find((d) => d.key === 'cardio')!.isActive).toBe(true);
    expect(el.querySelector('[data-dept="cardio"] [data-tag="hidden"]')).toBeNull();
  });

  it('remove: asks first; nothing happens on "Keep it"; a department in use shows the server message and suggests switching it off', async () => {
    const { f, el, api } = await open((a) => {
      a.depts.push(own('cardio', 'Cardiology', 3), own('free', 'Free one', 4));
      a.seed('Cardio sheet', { title: 'Cardio sheet', pages: [] } as never, { departmentKey: 'cardio' });
    });
    const rm = (key: string) => el.querySelector<HTMLButtonElement>(`[data-dept="${key}"] [data-act="remove"]`)!;

    dialog.confirm.mockResolvedValueOnce(false);
    rm('free').click();
    await settle(f);
    expect(api.depts.some((d) => d.key === 'free')).toBe(true);

    rm('cardio').click();
    await settle(f);
    expect(api.depts.some((d) => d.key === 'cardio')).toBe(true);
    expect(toasts.error).toHaveBeenCalledTimes(1);
    const msg = toasts.error.mock.calls[0][0] as string;
    expect(msg).toContain('Forms still use this department. Switch it off instead.');
    expect(msg).toContain('hide Cardiology');

    rm('free').click();
    await settle(f);
    expect(api.depts.some((d) => d.key === 'free')).toBe(false);
    expect(toasts.success).toHaveBeenCalledWith('Removed Free one');
  });

  it('search narrows the list by name', async () => {
    const { f, f: { componentInstance: page }, names } = await open((a) => a.depts.push(own('cardio', 'Cardiology', 3)));
    (page as unknown as { query: { set(v: string): void } }).query.set('cardi');
    await settle(f);
    expect(names()).toEqual(['Cardiology']);
  });

  it('copy: no "AI", no emoji', async () => {
    const { el } = await open();
    expect(el.textContent).not.toMatch(/\bAI\b/);
    expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
