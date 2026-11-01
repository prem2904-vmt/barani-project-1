import { signal } from '@angular/core';
import { ReportTemplateComponent } from './report-template.component';
import { readReportStyle } from '../../../shared/utils/report-style';
import { applyChanges, type TidyChange } from '../../../shared/utils/report-tidy';

/**
 * Report designer -> "Tidy up": Apply is ONE editor undo step, Undo restores the template exactly, and nothing is
 * saved by applying. The component's own `patch` / `undo` / `applyTidy` run against real signals (no TestBed).
 */
describe('Report designer - Tidy up apply / undo', () => {
  const proto = ReportTemplateComponent.prototype as any;
  const make = () => {
    const tpl0 = { metadata: '{"keep":1}', abnormalColor: '#d93025', abnormalLowColor: '#b5651d', primaryColor: '#1B3A6B' };
    const toasts: string[] = [];
    let saved = 0;
    const self: any = {
      _tpl: signal(tpl0), past: signal([]), future: signal([]), lastPatch: { at: 0, keys: '' },
      tidyOpen: signal(true), initPatientCols: () => undefined, toasts: { success: (m: string) => toasts.push(m) },
      save: () => { saved++; },
    };
    self.tpl = () => self._tpl();
    self.patch = (p: unknown, o: unknown) => proto.patch.call(self, p, o);
    self.undo = () => proto.undo.call(self);
    return { self, tpl0, toasts, saved: () => saved };
  };
  const change = (_tpl: unknown): TidyChange[] => [
    { id: 'rule:fit', source: 'rule', rule: 'fit', title: 'Turn on text fitting', why: 'w', patches: [{ kind: 'style', path: 'fit.enabled', to: true }] },
    { id: 'rule:flags', source: 'rule', rule: 'flags', title: 'f', why: 'w', patches: [{ kind: 'color', key: 'abnormalColor', to: '#7f1d1d' }] },
    { id: 'cortex:set:style.density', source: 'cortex', rule: 'cortex', title: 'd', why: 'w', patches: [{ kind: 'style', path: 'density', to: 'compact' }] },
  ];

  it('several changes applied together are ONE undo step, and Undo restores the template exactly', () => {
    const m = make();
    const patch = applyChanges(m.self.tpl(), change(m.tpl0), {});
    proto.applyTidy.call(m.self, patch);
    expect(m.self.past().length).toBe(1);
    expect(readReportStyle(m.self.tpl()).fit.enabled).toBe(true);
    expect(readReportStyle(m.self.tpl()).density).toBe('compact');
    expect(m.self.tpl().abnormalColor).toBe('#7f1d1d');
    expect(JSON.parse(m.self.tpl().metadata).keep).toBe(1);
    m.self.undo();
    expect(m.self.tpl()).toEqual(m.tpl0);
    expect(m.self.past().length).toBe(0);
    expect(m.self.future().length).toBe(1);
  });

  it('applying never saves, closes the card, and says how to undo', () => {
    const m = make();
    proto.applyTidy.call(m.self, applyChanges(m.self.tpl(), change(m.tpl0), {}));
    expect(m.saved()).toBe(0);
    expect(m.self.tidyOpen()).toBe(false);
    expect(m.toasts[0]).toMatch(/Undo/);
    expect(m.toasts[0]).not.toMatch(/\bAI\b/);
  });

  it('an empty patch changes nothing and adds no undo step', () => {
    const m = make();
    proto.applyTidy.call(m.self, {});
    expect(m.self.past().length).toBe(0);
    expect(m.self.tpl()).toEqual(m.tpl0);
  });

  it('a tidy right after a typed edit is its own step (never merged)', () => {
    const m = make();
    m.self.patch({ metadata: '{"keep":2}' });
    proto.applyTidy.call(m.self, applyChanges(m.self.tpl(), change(m.tpl0), {}));
    expect(m.self.past().length).toBe(2);
    m.self.undo();
    expect(JSON.parse(m.self.tpl().metadata)).toEqual({ keep: 2 });
  });
});
