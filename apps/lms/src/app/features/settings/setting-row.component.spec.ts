import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SettingRowComponent } from './setting-row.component';
import { SettingsStore } from './settings-store.service';
import { SettingDef } from './settings.model';
import { FakeAdapter, configure, flush } from './settings.spec-helpers';

const sw: SettingDef = {
  id: 't.switch', group: 'lab', label: 'Doctor must check every result', help: 'Even quick tests wait.',
  control: { kind: 'switch' }, scope: 'tenant', permission: ['manage_lab_settings'], adapter: 'tenant', key: 'flag',
};
const seg: SettingDef = {
  id: 't.seg', group: 'lab', label: 'Lab list shows',
  control: { kind: 'segmented', options: [{ value: 'auto', label: 'Auto' }, { value: 'patient', label: 'By patient' }] },
  scope: 'branch', permission: ['manage_lab_settings'], adapter: 'blc', key: 'mode',
};
const txt: SettingDef = {
  id: 't.text', group: 'setup', label: 'Staff sign-in name',
  control: { kind: 'text', sanitize: (v) => v.toLowerCase() }, scope: 'tenant',
  permission: ['manage_tenant'], adapter: 'tenant', key: 'slug',
  confirm: { title: 'Change the sign-in name?' },
};

function render(def: SettingDef, fake: FakeAdapter, opts: Parameters<typeof configure>[0] = {}) {
  const h = configure(opts);
  const store = TestBed.inject(SettingsStore);
  store.register(def.adapter, fake);
  const f = TestBed.createComponent(SettingRowComponent);
  f.componentRef.setInput('def', def);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { h, f, el, store, cmp: f.componentInstance };
}

describe('SettingRowComponent — optimistic autosave', () => {
  afterEach(() => vi.useRealTimers());

  it('a switch flips at once, writes, shows "Saved" and fades after 1.5 s', async () => {
    vi.useFakeTimers();
    const fake = new FakeAdapter({ flag: false });
    const { f, el } = render(sw, fake);
    const btn = el.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(btn.getAttribute('aria-checked')).toBe('false');
    btn.click();
    await flush(); f.detectChanges();
    expect(btn.getAttribute('aria-checked')).toBe('true');          // optimistic
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ key: 'flag', value: true, branchId: null });
    fake.writes[0].resolve();
    await flush(); f.detectChanges();
    expect(el.querySelector('.pf-sr__state')!.textContent).toContain('Saved');
    expect(el.querySelector('.pf-sr__state svg')).not.toBeNull();   // a check, never a glyph
    vi.advanceTimersByTime(1600);
    f.detectChanges();
    expect(el.querySelector('.pf-sr__state')!.textContent!.trim()).toBe('');
    expect(btn.getAttribute('aria-checked')).toBe('true');
  });

  it('on an error the value goes back and ONE red line says why', async () => {
    const fake = new FakeAdapter({ flag: false });
    const { f, el } = render(sw, fake);
    el.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await flush();
    fake.writes[0].reject(new Error('You are not allowed to change this.\nDetails…'));
    await flush(); f.detectChanges();
    expect(el.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    const err = el.querySelector('.pf-sr__err')!;
    expect(err.textContent!.trim()).toBe('You are not allowed to change this.');
    expect(el.querySelector('.pf-sr__state')!.textContent).not.toContain('Saved');
  });

  it('segments: neutral radios, the pick writes that value', async () => {
    const fake = new FakeAdapter({ mode: 'auto' });
    const { f, el } = render(seg, fake);
    const radios = el.querySelectorAll<HTMLButtonElement>('.nd-seg [role="radio"]');
    expect(radios).toHaveLength(2);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    radios[1].click();
    await flush(); f.detectChanges();
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    expect(fake.writes[0].value).toBe('patient');
  });

  it('text saves on blur (not while typing) and asks first when the row says so', async () => {
    const fake = new FakeAdapter({ slug: 'micro' });
    const { h, f, el } = render(txt, fake);
    const input = el.querySelector<HTMLInputElement>('input.nd-input')!;
    input.value = 'MicroWorld';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('microworld');                         // sanitized as typed
    expect(fake.writes).toHaveLength(0);
    input.dispatchEvent(new Event('blur'));
    await flush(); f.detectChanges();
    expect(h.dialog.confirm).toHaveBeenCalledTimes(1);
    expect(fake.writes[0].value).toBe('microworld');
  });

  it('a declined confirm writes nothing', async () => {
    const fake = new FakeAdapter({ slug: 'micro' });
    const { el } = render(txt, fake, { confirm: false });
    const input = el.querySelector<HTMLInputElement>('input.nd-input')!;
    input.value = 'other';
    input.dispatchEvent(new Event('blur'));
    await flush();
    expect(fake.writes).toHaveLength(0);
  });

  it('scope chips say who a value is for', () => {
    const fake = new FakeAdapter({ flag: true, mode: 'auto' });
    expect(render(sw, fake).el.querySelector('.pf-sr__chip')!.textContent!.trim()).toBe('All branches');
    TestBed.resetTestingModule();
    expect(render(seg, fake).el.querySelector('.pf-sr__chip')!.textContent!.trim()).toBe('This branch: Main');
  });
});

describe('Scope chip — branch targeting', () => {
  it('with 2+ branches the chip is a picker; the pick changes the branch the row writes to', async () => {
    const fake = new FakeAdapter({ mode: 'auto' });
    const { f, el, store } = render(seg, fake, {
      branches: [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Anna Nagar' }], activeBranch: 'b1',
    });
    expect(el.querySelector('pf-select.pf-sr__branch')).not.toBeNull();
    expect(store.branchId()).toBe('b1');
    store.setBranch('b2');
    f.detectChanges();
    expect(store.branchName()).toBe('Anna Nagar');
    el.querySelectorAll<HTMLButtonElement>('.nd-seg [role="radio"]')[1].click();
    await flush();
    expect(fake.writes[0].branchId).toBe('b2');
    store.setBranch('zz');                                          // not one of mine → ignored
    expect(store.branchId()).toBe('b2');
    store.setBranch('b1');
    expect(store.branchId()).toBe('b1');
  });
});
