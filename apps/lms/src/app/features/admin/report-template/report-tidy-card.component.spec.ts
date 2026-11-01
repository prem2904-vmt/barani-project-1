import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AssistantApiService } from '../../../shared/assistant/assistant-api.service';
import { PfSenseService } from '../../../core/services/pf-sense.service';
import type { ReportTemplate } from '../../../shared/models/report.model';
import { silenceJsdomCanvas } from '../../../shared/utils/report-header-legacy.spec-helpers';
import { richInput } from '../../../shared/utils/report-theme.spec-helpers';
import { readReportStyle } from '../../../shared/utils/report-style';
import { ReportTidyCardComponent } from './report-tidy-card.component';

/**
 * Cortex "Tidy up" review card, rendered for real with a stubbed API (no model call, no network):
 * every change is a ticked row with its reason; unticking removes it from what Apply hands back (ONE patch);
 * Cancel hands back nothing; a Cortex failure leaves the plain fixes usable; copy never says "AI".
 */
describe('Tidy up review card', () => {
  silenceJsdomCanvas();

  const OVERLAPPING = { patientColumnsJson: JSON.stringify([['name', 'age', 'sex', 'mrn'], ['specimen', 'refdoctor', 'refhospital'], ['barcode', 'registered']]) };
  const wait = (ms = 80) => new Promise(r => setTimeout(r, ms));

  let tidyCalls: Array<Record<string, unknown>>;
  let answer: () => unknown;

  beforeAll(() => {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL ??= () => 'blob:tidy-spec';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL ??= () => undefined;
  });

  async function make(tplPatch: Partial<ReportTemplate> = OVERLAPPING, cortex = true) {
    tidyCalls = [];
    answer = () => of({ summary: 'Chose the compact style.', changes: [], dropped: 0 });
    TestBed.configureTestingModule({
      providers: [
        { provide: AssistantApiService, useValue: {
          reportTidyProviders: () => of([{ id: 'gemini', label: 'Gemini', available: true }]),
          reportTidy: (b: Record<string, unknown>) => { tidyCalls.push(b); return answer(); },
        } },
        { provide: PfSenseService, useValue: { noteRefusal: () => undefined } },
      ],
    });
    const input = richInput(tplPatch);
    const { template, ...base } = input;
    const fixture = TestBed.createComponent(ReportTidyCardComponent);
    fixture.componentRef.setInput('tpl', template);
    fixture.componentRef.setInput('base', base);
    fixture.componentRef.setInput('withCortex', cortex);
    const applied: Array<Partial<ReportTemplate>> = [];
    let closed = 0;
    fixture.componentInstance.applied.subscribe(p => applied.push(p));
    fixture.componentInstance.close.subscribe(() => closed++);
    fixture.detectChanges();
    await wait(); fixture.detectChanges();
    await wait(); fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture, el, applied, template: template as ReportTemplate, closed: () => closed,
      text: () => el.textContent!.replace(/\s+/g, ' '),
      boxes: () => [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')],
      rows: () => [...el.querySelectorAll('.pf-td__row')].map(r => r.textContent!.replace(/\s+/g, ' ').trim()),
      button: (label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent!.includes(label))!,
    };
  }

  it('lists each change with its reason, all ticked, and never says AI', async () => {
    const m = await make();
    expect(m.boxes().length).toBeGreaterThan(0);
    expect(m.boxes().every(b => b.checked)).toBe(true);
    expect(m.text()).toContain('Turn on text fitting');
    expect(m.text()).toMatch(/print on top of each other/);
    expect(m.text()).toContain('Rule');
    expect(m.text()).toContain('Tidy up with Cortex');
    expect(m.text()).not.toMatch(/\bAI\b/);
    expect(m.el.querySelectorAll('iframe').length).toBe(2);   // Before | After
  });

  it('Apply hands back ONE patch with exactly the ticked changes', async () => {
    const m = await make();
    m.button('Apply').click();
    expect(m.applied).toHaveLength(1);
    expect(readReportStyle({ metadata: m.applied[0].metadata }).fit.enabled).toBe(true);
    expect(m.template.metadata).not.toContain('fit');   // the editor's template is untouched until it applies the patch
  });

  it('unticking a change leaves it out; unticking text fitting also drops what depends on it', async () => {
    const m = await make();
    const fit = m.boxes().find(b => b.getAttribute('aria-label') === 'Turn on text fitting')!;
    const before = m.boxes().length;
    fit.click(); m.fixture.detectChanges();
    expect(fit.checked).toBe(false);
    for (const b of m.boxes()) if (/Widen the name column|three lines/.test(b.getAttribute('aria-label') ?? '')) expect(b.checked).toBe(false);
    m.button('Apply').click();
    const style = m.applied.length ? readReportStyle({ metadata: m.applied[0].metadata ?? null }) : null;
    expect(style?.fit.enabled ?? false).toBe(false);
    expect(m.boxes().length).toBe(before);
  });

  it('with everything unticked there is nothing to apply', async () => {
    const m = await make();
    for (const b of m.boxes()) if (b.checked) { b.click(); m.fixture.detectChanges(); }
    expect(m.button('Apply').disabled).toBe(true);
    m.button('Apply').click();
    expect(m.applied).toEqual([]);
  });

  it('Cancel (and Escape) changes nothing', async () => {
    const m = await make();
    m.button('Cancel').click();
    expect(m.closed()).toBe(1);
    expect(m.applied).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(m.closed()).toBe(2);
    expect(m.applied).toEqual([]);
  });

  it('with Cortex off only the rules run (no call); with it on exactly one call is made, carrying no names or tenant ids', async () => {
    await make(OVERLAPPING, false);
    expect(tidyCalls).toEqual([]);
    TestBed.resetTestingModule();
    const m = await make(OVERLAPPING, true);
    expect(tidyCalls).toHaveLength(1);
    expect(JSON.stringify(tidyCalls[0])).not.toMatch(/Sita|Raman|tenant|user/i);
    expect(m.text()).toContain('Cortex suggests');
  });

  it('a Cortex suggestion is validated here, listed with a Cortex chip, and ticking it adds it to the patch', async () => {
    const m = await makeWithAnswer(() => of({
      summary: 'Page numbers help when a report runs over.',
      changes: [
        { id: 'cortex:set:style.pageNumbers', title: 'Set the page numbering', why: 'Page N of M helps.', patches: [{ path: 'style.pageNumbers', value: 'n-of-m' }] },
        { id: 'cortex:set:style.patient.joiner', title: 'Adjust the patient block', why: 'x', patches: [{ path: 'style.patient.joiner', value: '<b>' }] },
      ],
      dropped: 1,
    }));
    expect(m.text()).toContain('Set the page numbering');
    expect(m.text()).toContain('Page numbers help');
    expect(m.text()).not.toContain('<b>');
    expect(m.text()).toMatch(/2 suggestions were left out/);
    m.button('Apply').click();
    expect(readReportStyle({ metadata: m.applied[0].metadata }).pageNumbers).toBe('n-of-m');
  });

  it('when Cortex fails the plain fixes still work and the reason is in plain words', async () => {
    const m = await makeWithAnswer(() => throwError(() => ({ status: 200, error: { error: 'ai_cap_reached', message: 'x' } })));
    expect(m.text()).toMatch(/limit/i);
    expect(m.boxes().length).toBeGreaterThan(0);
    m.button('Apply').click();
    expect(m.applied).toHaveLength(1);
  });

  it('a layout that is already tidy says so and offers nothing to apply', async () => {
    const m = await make({ patientColumnsJson: JSON.stringify([['name', 'age'], ['orderid']]), metadata: JSON.stringify({ reportStyle: { v: 1, fit: { enabled: true, autoColumns: true } } }) } as Partial<ReportTemplate>, false);
    expect(m.boxes()).toEqual([]);
    expect(m.text()).toContain('already tidy');
    expect(m.button('Apply').disabled).toBe(true);
    m.button('Apply').click();
    expect(m.applied).toEqual([]);
  });

  async function makeWithAnswer(a: () => unknown) {
    const original = answer;
    const m = await (async () => {
      tidyCalls = [];
      TestBed.configureTestingModule({
        providers: [
          { provide: AssistantApiService, useValue: {
            reportTidyProviders: () => of([{ id: 'gemini', label: 'Gemini', available: true }]),
            reportTidy: (b: Record<string, unknown>) => { tidyCalls.push(b); return a(); },
          } },
          { provide: PfSenseService, useValue: { noteRefusal: () => undefined } },
        ],
      });
      const input = richInput(OVERLAPPING);
      const { template, ...base } = input;
      const fixture = TestBed.createComponent(ReportTidyCardComponent);
      fixture.componentRef.setInput('tpl', template);
      fixture.componentRef.setInput('base', base);
      const applied: Array<Partial<ReportTemplate>> = [];
      fixture.componentInstance.applied.subscribe(p => applied.push(p));
      fixture.detectChanges();
      await wait(); fixture.detectChanges();
      await wait(); fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      return {
        el, applied, fixture,
        text: () => el.textContent!.replace(/\s+/g, ' '),
        boxes: () => [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')],
        button: (label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent!.includes(label))!,
      };
    })();
    answer = original;
    return m;
  }
});
