import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgTemplateOutlet } from '@angular/common';
import { SettingGroupComponent } from './setting-row.component';
import { SETTINGS_HOST, SettingsHost, createSettingsHost } from '../../utils/settings-host';

/**
 * Owner 2026-11-21 (Settings › Front desk › Referring doctors): the group's tools (Hospitals | Doctors, Add doctor,
 * Paste from sheet) sat in a whole row under the card head. When the frame shows ONE group alone
 * (`SettingsHost.headGroup`), the group hands its `[group-tools]` to the frame's head; otherwise they stay in its own head.
 */
@Component({
  standalone: true,
  imports: [SettingGroupComponent, NgTemplateOutlet],
  template: `
    <div class="frame-head">@for (a of host.actions(); track $index) { <span class="acts"><ng-container *ngTemplateOutlet="a.tpl"></ng-container></span> }</div>
    @if (shown()) {
      <pf-setting-group label="Referring doctors" id="referring">
        <button group-tools type="button" class="add">Add doctor</button>
        <p class="row">rows</p>
      </pf-setting-group>
    }
  `,
})
class Frame {
  readonly host = inject(SETTINGS_HOST) as SettingsHost;
  readonly shown = signal(true);
}

describe('pf-setting-group — tools in the frame head when shown alone', () => {
  function mount() {
    const host = createSettingsHost();
    TestBed.configureTestingModule({ imports: [Frame], providers: [{ provide: SETTINGS_HOST, useValue: host }] });
    const f = TestBed.createComponent(Frame);
    f.detectChanges();
    return { f, host, el: f.nativeElement as HTMLElement };
  }

  it('keeps its tools in its own head while the frame shows several groups', () => {
    const { el, host } = mount();
    expect(host.actions().length).toBe(0);
    expect(el.querySelector('.pf-sgroup__tools .add')).not.toBeNull();
    expect(el.querySelector('.frame-head .add')).toBeNull();
  });

  it('hands them to the frame head when it is the group shown alone, and takes them back', () => {
    const { el, host, f } = mount();
    host.headGroup!.set('referring');
    f.detectChanges(); f.detectChanges();
    expect(host.actions().map(a => a.group)).toEqual(['referring']);
    expect(el.querySelector('.frame-head .add')?.textContent).toContain('Add doctor');
    expect(el.querySelector('.pf-sgroup__tools')).toBeNull();
    expect(el.querySelectorAll('.add').length).toBe(1);

    host.headGroup!.set('slots');
    f.detectChanges(); f.detectChanges();
    expect(host.actions().length).toBe(0);
    expect(el.querySelector('.pf-sgroup__tools .add')).not.toBeNull();
  });

  it('removes its entry when the group goes away', () => {
    const { host, f } = mount();
    host.headGroup!.set('referring');
    f.detectChanges();
    expect(host.actions().length).toBe(1);
    f.componentInstance.shown.set(false);
    f.detectChanges();
    expect(host.actions().length).toBe(0);
  });
});
