import { TestBed } from '@angular/core/testing';
import { DialogHostComponent } from './dialog-host.component';
import { DialogService } from '../../../core/services/dialog.service';

/**
 * alert(): a plain notice with nothing to decide — exactly ONE footer
 * button. Review fix: callers used to fake this with
 * `confirm({ confirmLabel: 'OK', cancelLabel: 'OK' })`, which rendered two
 * identical "OK" buttons (order-create's non-manager stock-warning notice).
 */
describe('DialogHost — alert() dialog', () => {
  function render() {
    TestBed.configureTestingModule({ imports: [DialogHostComponent] });
    const f = TestBed.createComponent(DialogHostComponent);
    const dialog = TestBed.inject(DialogService);
    return { f, dialog, el: f.nativeElement as HTMLElement };
  }

  it('renders exactly ONE footer button, never a Cancel beside it', async () => {
    const { f, dialog, el } = render();
    const p = dialog.alert({ title: 'Stock warning', message: 'Short on gloves.', question: 'Ask an inventory manager to approve.' });
    f.detectChanges();

    const buttons = [...el.querySelectorAll<HTMLButtonElement>('footer.pf-dh-actions pf-touch-btn button')];
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('OK');
    expect([...el.querySelectorAll('button')].some(b => b.textContent!.trim() === 'Cancel')).toBe(false);

    buttons[0].click();
    await p; // resolves void — doesn't hang, doesn't throw
  });

  it('a custom confirmLabel still renders as the single button', () => {
    const { f, dialog, el } = render();
    void dialog.alert({ title: 'Heads up', confirmLabel: 'Got it' });
    f.detectChanges();
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('footer.pf-dh-actions pf-touch-btn button')];
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('Got it');
  });

  it('Escape/backdrop dismiss still resolves (no hang) even with no Cancel button', async () => {
    const { f, dialog, el } = render();
    const p = dialog.alert({ title: 'Heads up' });
    f.detectChanges();
    el.querySelector<HTMLElement>('.pf-dh-backdrop')!.click();
    await p;
  });
});
