import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CultureWorkbenchComponent } from './culture-workbench.component';

// Same "prototype.call on a hand-built context" approach as
// culture-workbench.component.spec.ts — the bench needs router/API DI to
// mount, so its methods are exercised directly instead.
const call = <T,>(fn: (...a: any[]) => T, ctx: any, ...args: any[]): T => fn.call(ctx, ...args);
const P = CultureWorkbenchComponent.prototype as any;

/** "Save as template" used `window.prompt` — now `DialogService.prompt`
 *  (themed, async). Behaviour is identical: an empty/cancelled name saves
 *  nothing; a real name posts { scope, name, body }. */
describe('CultureWorkbenchComponent — saveTemplate (DialogService, never window.prompt)', () => {
  function ctx(promptReturn: string | null) {
    return {
      drafts: signal({ gram: 'Gram-positive cocci in clusters' }),
      templateScope: () => 'gram',
      dialog: { prompt: vi.fn(async () => promptReturn) },
      api: { post: vi.fn(() => of({ id: 't1', scope: 'gram', name: promptReturn, body: 'x' })) },
      templates: signal([]),
      toasts: { success: vi.fn(), error: vi.fn() },
    };
  }

  it('asks through DialogService.prompt, never window.prompt', async () => {
    const c = ctx('Clusters template');
    await call(P.saveTemplate, c, 'gram');
    expect(c.dialog.prompt).toHaveBeenCalledWith(expect.objectContaining({ title: 'Save as template' }));
  });

  it('a real name posts the scope/name/body and shows a success toast', async () => {
    const c = ctx('Clusters template');
    await call(P.saveTemplate, c, 'gram');
    expect(c.api.post).toHaveBeenCalledWith('/api/result-templates', {
      scope: 'gram', name: 'Clusters template', body: 'Gram-positive cocci in clusters',
    });
    expect(c.toasts.success).toHaveBeenCalled();
  });

  it('dismissing the dialog (null) saves nothing', async () => {
    const c = ctx(null);
    await call(P.saveTemplate, c, 'gram');
    expect(c.api.post).not.toHaveBeenCalled();
  });

  it('an all-whitespace name is treated the same as cancelled', async () => {
    const c = ctx('   ');
    await call(P.saveTemplate, c, 'gram');
    expect(c.api.post).not.toHaveBeenCalled();
  });
});
