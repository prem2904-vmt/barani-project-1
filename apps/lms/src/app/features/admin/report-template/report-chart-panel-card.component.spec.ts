import { TestBed } from '@angular/core/testing';
import type { ReportTemplate } from '../../../shared/models/report.model';
import { readReportStyle } from '../../../shared/utils/report-style';
import { ReportChartPanelCardComponent } from './report-chart-panel-card.component';

/**
 * Report designer -> Footer -> Charts card, rendered for real. It reads the template and emits a metadata
 * patch (one per click); the editor owns the template and the undo stack.
 */
describe('Charts card', () => {
  const make = (t: Partial<ReportTemplate> = {}) => {
    const fixture = TestBed.createComponent(ReportChartPanelCardComponent);
    let tpl = { metadata: null, ...t } as ReportTemplate;
    const patches: Array<Partial<ReportTemplate>> = [];
    fixture.componentRef.setInput('template', tpl);
    fixture.componentInstance.patch.subscribe(p => { patches.push(p); tpl = { ...tpl, ...p }; fixture.componentRef.setInput('template', tpl); fixture.detectChanges(); });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { el, patches, tpl: () => tpl, text: () => el.textContent!.replace(/\s+/g, ' ') };
  };
  const radio = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('[role=radio]')].find(b => b.textContent!.includes(label))!;
  const sw = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`[role=switch][aria-label="${label}"]`)!;

  it('an untouched template reads as today: pictures, no range bar, and no layout choices offered', () => {
    const m = make();
    expect(radio(m.el, 'Pictures').getAttribute('aria-checked')).toBe('true');
    expect(sw(m.el, 'Range bar').getAttribute('aria-checked')).toBe('false');
    expect(m.el.querySelector('#pf-cpc-layout')).toBeNull();
    expect(m.text()).not.toMatch(/\bAI\b/);
  });

  it('choosing Sharp is ONE patch that stores only what differs, and reveals the layout and the two switches', () => {
    const m = make();
    radio(m.el, 'Sharp').click();
    expect(m.patches).toHaveLength(1);
    expect(JSON.parse(m.patches[0].metadata!).reportStyle).toEqual({ v: 1, charts: { trend: { style: 'vector' } } });
    expect(radio(m.el, 'Two across').getAttribute('aria-checked')).toBe('true');
    radio(m.el, 'Three across').click();
    expect(readReportStyle(m.tpl()).charts.trend).toMatchObject({ style: 'vector', layout: 'grid-3' });
    sw(m.el, 'Normal range band').click();
    sw(m.el, 'Values on the points').click();
    expect(readReportStyle(m.tpl()).charts.trend).toEqual({ style: 'vector', layout: 'grid-3', band: false, values: false });
  });

  it('going back to pictures with the defaults restored stores nothing', () => {
    const m = make();
    radio(m.el, 'Sharp').click();
    radio(m.el, 'Pictures').click();
    expect(m.tpl().metadata).toBe('{}');
  });

  it('the range bar switch is its own patch and is independent of the trend style', () => {
    const m = make();
    sw(m.el, 'Range bar').click();
    expect(JSON.parse(m.patches[0].metadata!).reportStyle).toEqual({ v: 1, charts: { rangeBar: true } });
    expect(sw(m.el, 'Range bar').getAttribute('aria-checked')).toBe('true');
    expect(readReportStyle(m.tpl()).charts.trend.style).toBe('png');
  });

  it('has no emoji and says High and Low are still written out', () => {
    const m = make();
    expect(m.text()).toMatch(/High and Low are still written out/);
    expect(/\p{Extended_Pictographic}/u.test(m.text())).toBe(false);
  });
});
