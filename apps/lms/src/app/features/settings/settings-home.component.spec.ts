import { TestBed } from '@angular/core/testing';
import { SettingsHomeComponent } from './settings-home.component';
import { configure, flush } from './settings.spec-helpers';

function render(opts: Parameters<typeof configure>[0] = {}) {
  const h = configure(opts);
  const f = TestBed.createComponent(SettingsHomeComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const type = (q: string) => {
    const i = el.querySelector<HTMLInputElement>('pf-hero-band .pf-hb__input')!;
    i.value = q;
    i.dispatchEvent(new Event('input'));
    f.detectChanges();
  };
  const groups = () => Array.from(el.querySelectorAll('section[id^="grp-"]')).map((s) => s.id.slice(4));
  const labels = () => Array.from(el.querySelectorAll('.pf-sr__label')).map((s) => s.textContent!.trim());
  return { h, f, el, type, groups, labels };
}

describe('Settings home (/settings)', () => {
  it('band pill is the search; group chips are jump links, not tabs; no primary CTA', () => {
    const p = render();
    expect(p.el.querySelector('pf-hero-band .pf-hb__input')!.getAttribute('placeholder')).toContain('barcode');
    const chips = p.el.querySelectorAll('.pf-set__chips button');
    expect(chips.length).toBeGreaterThan(3);
    expect(p.el.querySelector('[role="tablist"], [role="tab"]')).toBeNull();
    expect(p.el.querySelectorAll('.nd-btn--primary, .pf-hb-btn--primary').length).toBe(0);
    expect(p.el.querySelector('.pf-band-page > .pf-band-body')).not.toBeNull();
  });

  it('advanced rows sit behind "More options (n)"', () => {
    const p = render();
    expect(p.labels()).not.toContain('Staff sign-in name');
    const more = Array.from(p.el.querySelectorAll<HTMLButtonElement>('#grp-setup .pf-set__more'))[0];
    expect(more.textContent).toMatch(/More options\s*\(\d+\)/);
    more.click();
    p.f.detectChanges();
    expect(p.labels()).toContain('Staff sign-in name');
  });

  it('searching "barcode" lists "How staff find a sample" inline, with its group as a breadcrumb', () => {
    const p = render();
    p.type('barcode');
    expect(p.labels()).toContain('How staff find a sample');
    const row = p.el.querySelector('pf-setting-row[data-setting="col.scanMode"]')!;
    expect(row.querySelector('.pf-sr__crumb')!.textContent!.trim()).toBe('Collection');
    expect(row.querySelector('.nd-seg [role="radio"]')).not.toBeNull();   // the control itself, inline
    p.type('zzqx');
    expect(p.el.querySelector('.pf-set__empty')!.textContent).toContain('zzqx');
  });

  it('permission gating: a lab-settings admin sees lab rows only; empty groups are hidden', async () => {
    const p = render({ perms: ['manage_lab_settings'] });
    await flush(); p.f.detectChanges();
    expect(p.groups()).toContain('lab');
    expect(p.groups()).toContain('collection');
    expect(p.groups()).not.toContain('setup');
    expect(p.groups()).not.toContain('money');
    // People & access only carries this user's own rows (no staff tools).
    expect(p.el.querySelector('#grp-people .pf-set__tool')).toBeNull();
    expect(p.labels()).not.toContain('Lab name');
    expect(p.labels()).toContain('How staff find a sample');
  });

  it('a tenant admin without lab settings sees Lab setup but not the lab rows', () => {
    const p = render({ perms: ['manage_tenant'] });
    expect(p.groups()).toContain('setup');
    expect(p.labels()).toContain('Lab name');
    expect(p.labels()).not.toContain('How staff find a sample');
  });

  it('rows that depend on another row hide until it is on (department pickers)', () => {
    const p = render({ getFor: (u) => (u.includes('branch-lab-config') ? { autoAssignEnabled: false } : null) });
    expect(p.labels()).not.toContain("Who gets each department's tests");
  });

  it('module off → its rows go (Track stock without Inventory)', () => {
    const on = render();
    expect(on.labels()).toContain('Track stock (tubes, kits)');
    TestBed.resetTestingModule();
    const off = render({ modulesOff: ['inventory'] });
    expect(off.labels()).not.toContain('Track stock (tubes, kits)');
  });
});
