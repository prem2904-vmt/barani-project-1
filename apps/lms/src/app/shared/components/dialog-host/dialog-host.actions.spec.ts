import { TestBed } from '@angular/core/testing';
import { DialogHostComponent } from './dialog-host.component';
import { DialogService } from '../../../core/services/dialog.service';

/** actions(): several explicit buttons + an optional SVG checkbox (no native
 *  confirm/checkbox) — used by the "No label printer" dialog. */
describe('DialogHost — actions() dialog', () => {
  function render() {
    TestBed.configureTestingModule({ imports: [DialogHostComponent] });
    const f = TestBed.createComponent(DialogHostComponent);
    const dialog = TestBed.inject(DialogService);
    return { f, dialog, el: f.nativeElement as HTMLElement };
  }
  const btn = (el: HTMLElement, action: string) =>
    el.querySelector<HTMLButtonElement>(`pf-touch-btn[data-action="${action}"] button`)!;

  it('renders each action + the checkbox, resolves the pressed action with the tick state', async () => {
    const { f, dialog, el } = render();
    const p = dialog.actions({
      title: 'No label printer connected on this device',
      icon: 'printer',
      actions: [{ value: 'system', label: 'Print via system dialog', variant: 'secondary' }, { value: 'setup', label: 'Set up label printer', variant: 'primary' }],
      checkbox: { label: "Don't ask again on this device" },
    });
    f.detectChanges();
    expect(el.querySelector('.pf-dh-title')!.textContent).toContain('No label printer connected on this device');
    expect(btn(el, 'setup').textContent).toContain('Set up label printer');
    expect(btn(el, 'system').textContent).toContain('Print via system dialog');
    const box = el.querySelector<HTMLButtonElement>('.pf-dh-check')!;
    expect(box.getAttribute('role')).toBe('checkbox');
    expect(el.querySelector('input[type="checkbox"]')).toBeNull();
    box.click();
    f.detectChanges();
    expect(box.getAttribute('aria-checked')).toBe('true');
    btn(el, 'system').click();
    expect(await p).toEqual({ action: 'system', checked: true });
  });

  it('Cancel resolves action null', async () => {
    const { f, dialog, el } = render();
    const p = dialog.actions({ title: 'T', actions: [{ value: 'setup', label: 'Set up', variant: 'primary' }] });
    f.detectChanges();
    expect(el.querySelector('.pf-dh-check')).toBeNull();
    const cancel = [...el.querySelectorAll<HTMLButtonElement>('pf-touch-btn button')].find(b => b.textContent!.includes('Cancel'))!;
    cancel.click();
    expect(await p).toEqual({ action: null, checked: false });
  });
});
