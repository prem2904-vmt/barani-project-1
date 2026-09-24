import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { HeroBandComponent } from './hero-band.component';
import { AuthService } from '../../../core/auth/auth.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';

/**
 * pf-hero-band — the ONE band every screen renders. Admin sub-pages
 * ("band pill everywhere") lean on two extensions: a tabs-only pill (no
 * search field, the section switch owns the pill) and a top-left back
 * chevron that replaces the page header's.
 */
@Component({
  standalone: true,
  imports: [HeroBandComponent],
  template: `
    <pf-hero-band [tabsOnly]="tabsOnly()" [back]="back()" [backTo]="backTo()"
                  placeholder="Search things" [value]="q()" (valueChange)="q.set($event)">
      <button band-actions type="button" class="act">Save</button>
      <div band-tools class="tools">tabs</div>
    </pf-hero-band>
  `,
})
class HostComponent {
  tabsOnly = signal(false);
  back = signal(false);
  backTo = signal<string | null>(null);
  q = signal('');
}

function make(showBack = true) {
  const navBack = { showBack: signal(showBack), back: vi.fn(), backTo: vi.fn() };
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [
      { provide: AuthService, useValue: { user: () => ({ tenantName: 'Micro World' }) } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
      { provide: NavBackService, useValue: navBack },
    ],
  });
  const f = TestBed.createComponent(HostComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, el, host: f.componentInstance, navBack };
}

describe('pf-hero-band — admin band pill', () => {
  it('default: the pill has the search field; actions and tools are projected', () => {
    const { el } = make();
    expect(el.querySelector('.pf-hb__input')).not.toBeNull();
    expect(el.querySelector('.pf-hb__actions .act')?.textContent).toBe('Save');
    expect(el.querySelector('.pf-hb__tools .tools')).not.toBeNull();
    expect(el.querySelector('.pf-hb__search--tabs')).toBeNull();
  });

  it('typing in the pill search emits valueChange', () => {
    const { f, el, host } = make();
    const input = el.querySelector<HTMLInputElement>('.pf-hb__input')!;
    input.value = 'cbc';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(host.q()).toBe('cbc');
  });

  it('tabsOnly: no search field, the tools (section tabs) own the pill', () => {
    const { f, el, host } = make();
    host.tabsOnly.set(true);
    f.detectChanges();
    expect(el.querySelector('.pf-hb__input')).toBeNull();
    expect(el.querySelector('.pf-hb__field')).toBeNull();
    expect(el.querySelector('.pf-hb__search--tabs')).not.toBeNull();
    expect(el.querySelector('.pf-hb__tools .tools')).not.toBeNull();
  });

  it('back chevron: hidden by default, shown when asked on a secondary route', () => {
    const { f, el, host } = make();
    expect(el.querySelector('.pf-hb__back')).toBeNull();
    host.back.set(true);
    f.detectChanges();
    expect(el.querySelector('.pf-hb__back')).not.toBeNull();
    expect(el.querySelector('.pf-hb__back svg path')).not.toBeNull();
  });

  it('back chevron never shows on an app root (NavBackService.showBack false)', () => {
    const { f, el, host } = make(false);
    host.back.set(true);
    f.detectChanges();
    expect(el.querySelector('.pf-hb__back')).toBeNull();
  });

  it('back chevron pops history, or goes to backTo when given', () => {
    const { f, el, host, navBack } = make();
    host.back.set(true);
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('.pf-hb__back')!.click();
    expect(navBack.back).toHaveBeenCalledTimes(1);
    host.backTo.set('/lab/settings');
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('.pf-hb__back')!.click();
    expect(navBack.backTo).toHaveBeenCalledWith('/lab/settings');
  });
});
