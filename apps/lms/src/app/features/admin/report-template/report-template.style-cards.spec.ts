import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReportTemplateComponent } from './report-template.component';
import { ReportStyleCardsComponent } from './report-style-cards.component';
import type { ReportTemplate } from '../../../shared/models/report.model';
import { PALETTES, PALETTE_KEYS, TODAY_COLORS } from '../../../shared/utils/report-palettes';
import { readReportStyle } from '../../../shared/utils/report-style';
import { readReportTheme } from '../../../shared/utils/report-theme';

/**
 * Report designer -> Results table -> Style presets / Colour palette / Print
 * check. The editor's handlers run against a stub (no TestBed): one click is
 * ONE patch (one undo step); the cards component is rendered for real.
 */
describe('Report designer — style presets and palettes (editor handlers)', () => {
  const proto = ReportTemplateComponent.prototype as any;
  const make = (t: Partial<ReportTemplate> = {}, scope = 'default') => {
    let tpl = { metadata: null, ...t } as ReportTemplate;
    const patches: Array<Partial<ReportTemplate>> = [];
    let banner: unknown = null;
    const cols: { v: string[][] | null } = { v: null };
    const self: any = {
      tpl: () => tpl, patientScope: () => scope, patientCols: { set: (v: string[][]) => { cols.v = v; } },
      lastPreset: { set: (v: unknown) => { banner = v; } },
      patch: (p: Partial<ReportTemplate>) => { patches.push(p); tpl = { ...tpl, ...p }; },
    };
    return { self, patches, cols, banner: () => banner, tpl: () => tpl };
  };

  it('a preset is a single patch (one undo step) and remembers it for the banner', () => {
    const m = make();
    proto.applyPreset.call(m.self, 'modern');
    expect(m.patches).toHaveLength(1);
    expect(m.banner()).toBe('modern');
    expect(readReportTheme(m.tpl())).toBe('source-sans');
    expect(readReportStyle(m.tpl()).preset).toBe('modern');
  });

  it('Classic after Modern restores the original template fields', () => {
    const m = make();
    proto.applyPreset.call(m.self, 'modern');
    proto.applyPreset.call(m.self, 'classic');
    expect(m.tpl().metadata).toBe('{}');
    for (const k of PALETTE_KEYS) expect(m.tpl()[k]).toBe(TODAY_COLORS[k]);
  });

  it('an arranged default strip follows the preset; a department strip does not', () => {
    const arranged = JSON.stringify([['name', 'age', 'sex'], ['mrn'], []]);
    const a = make({ patientColumnsJson: arranged }, 'default');
    proto.applyPreset.call(a.self, 'modern');
    expect(a.cols.v).toEqual([['name', 'ageSex'], ['mrn'], []]);
    const d = make({ patientColumnsJson: arranged }, 'dept-1');
    proto.applyPreset.call(d.self, 'modern');
    expect(d.cols.v).toBeNull();
    expect(d.tpl().patientColumnsJson).toBe(arranged);
  });

  it('a palette writes the seven colour columns plus the remembered choice, in one patch', () => {
    const m = make();
    const forest = PALETTES.find(p => p.id === 'forest')!;
    proto.applyPalette.call(m.self, 'forest');
    expect(m.patches).toHaveLength(1);
    for (const k of PALETTE_KEYS) expect(m.tpl()[k]).toBe(forest.colors[k]);
    expect(readReportStyle(m.tpl()).colors.palette).toBe('forest');
    expect(m.banner()).toBeNull();
  });

  it('custom colours are stored as palette "custom"; the print check switch is editor-only metadata', () => {
    const m = make();
    proto.applyPalette.call(m.self, 'plum');
    proto.applyCustomColors.call(m.self, { ...PALETTES[0].colors, accentColor: '#123456' });
    expect(m.tpl().accentColor).toBe('#123456');
    expect(readReportStyle(m.tpl()).colors.palette).toBe('custom');
    proto.setPrintSafe.call(m.self, false);
    expect(readReportStyle(m.tpl()).colors.printSafe).toBe(false);
    proto.setPrintSafe.call(m.self, true);
    expect(JSON.parse(String(m.tpl().metadata)).reportStyle?.colors?.printSafe).toBeUndefined();
  });
});

describe('Report designer — a preset is its own undo step', () => {
  const proto = ReportTemplateComponent.prototype as any;
  it('Classic then Modern within a blink still undo one at a time', () => {
    const self: any = {
      _tpl: signal({ metadata: null } as ReportTemplate), past: signal([] as ReportTemplate[]), future: signal([] as ReportTemplate[]),
      lastPatch: { at: 0, keys: '' }, initPatientCols: () => undefined, patientScope: () => 'default', patientCols: { set: () => undefined }, lastPreset: { set: () => undefined },
    };
    self.tpl = () => self._tpl();
    self.patch = proto.patch;
    self.applyPreset = proto.applyPreset;
    self.undo = proto.undo;
    self.applyPreset('compact');
    self.applyPreset('modern');
    expect(self.past()).toHaveLength(2);
    self.undo();
    expect(readReportStyle(self._tpl()).preset).toBe('compact');
    self.undo();
    expect(self._tpl().metadata).toBeNull();
  });
});

describe('Report designer — style cards (rendered)', () => {
  const mount = (t: Partial<ReportTemplate> = {}, applied: 'modern' | null = null) => {
    const f = TestBed.createComponent(ReportStyleCardsComponent);
    f.componentRef.setInput('tpl', { metadata: null, ...t } as ReportTemplate);
    f.componentRef.setInput('applied', applied);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance };
  };

  it('three presets with a "What this changes" list each; Classic is current on an untouched template', () => {
    const { el } = mount();
    const cards = [...el.querySelectorAll('.pf-sty-card')];
    expect(cards.map(c => c.querySelector('.pf-sty-card__name')!.textContent!.trim())).toEqual(['Classic', 'Modern', 'Compact']);
    for (const c of cards) expect(c.querySelectorAll('li').length).toBeGreaterThanOrEqual(5);
    expect(cards.map(c => c.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(el.textContent).not.toMatch(/\bAI\b/);
  });

  it('clicking a preset / palette emits it; Undo emits undo', () => {
    const { el, c } = mount({}, 'modern');
    const got: unknown[] = [];
    c.preset.subscribe(v => got.push(['preset', v]));
    c.palette.subscribe(v => got.push(['palette', v]));
    c.undo.subscribe(() => got.push(['undo']));
    (el.querySelectorAll('.pf-sty-card')[1] as HTMLElement).click();
    (el.querySelectorAll('.pf-sty-pal')[2] as HTMLElement).click();
    (el.querySelector('.pf-sty-undo') as HTMLElement).click();
    expect(got).toEqual([['preset', 'modern'], ['palette', 'teal'], ['undo']]);
    expect(el.querySelector('.pf-sty-done')!.textContent).toContain('Modern applied');
  });

  it('six palettes, the matching one checked; hand-set colours say so', () => {
    const teal = PALETTES.find(p => p.id === 'teal')!.colors;
    const { el } = mount({ ...teal });
    const pals = [...el.querySelectorAll('.pf-sty-pal')];
    expect(pals).toHaveLength(6);
    expect(pals.map(p => p.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false', 'false', 'false']);
  });

  it('colours that match no palette say they are set by hand', () => {
    expect(mount({}).el.textContent).toContain('set by hand');
  });

  it('the print check lists a failing item with text and icon, and can be switched off', () => {
    const { f, el, c } = mount({ tableHeaderBg: '#eeeeee', tableHeaderText: '#dddddd', flagStyle: 'bold_color' });
    expect(c.allPass()).toBe(false);
    const bad = el.querySelectorAll('.pf-sty-check--bad');
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0].textContent).toContain('Needs attention');
    expect(bad[0].querySelector('svg')).toBeTruthy();
    f.componentRef.setInput('tpl', { metadata: JSON.stringify({ reportStyle: { v: 1, colors: { printSafe: false } } }) } as ReportTemplate);
    f.detectChanges();
    expect(el.querySelector('.pf-sty-checks')).toBeNull();
  });

  it('a custom accent previews the derived colours and "Use these colours" emits them', () => {
    const { f, el, c } = mount({});
    let sent: any = null;
    c.custom.subscribe(v => { sent = v; });
    const input = el.querySelector('#pf-sty-accent') as HTMLInputElement;
    input.value = '#7b2d8e';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    const use = el.querySelector('.pf-sty-use') as HTMLButtonElement;
    expect(use.disabled).toBe(false);
    use.click();
    expect(sent.accentColor).toBe('#7b2d8e');
    expect(Object.keys(sent).sort()).toEqual([...PALETTE_KEYS].sort());
  });
});
