import { TestBed } from '@angular/core/testing';
import type { ReportTemplate } from '../../../shared/models/report.model';
import { readReportStyle } from '../../../shared/utils/report-style';
import { ReportSignatureCardComponent } from './report-signature-card.component';

/**
 * Report designer -> Footer -> Signatures card: rendered for real. It reads the
 * template, says what the sign-off will take (the same plan the renderer uses),
 * and emits a metadata patch - the editor owns the template and the undo stack.
 */
describe('Signatures card', () => {
  const make = (t: Partial<ReportTemplate> = {}, sample = 2) => {
    const fixture = TestBed.createComponent(ReportSignatureCardComponent);
    let tpl = { metadata: null, ...t } as ReportTemplate;
    const patches: Array<Partial<ReportTemplate>> = [];
    const samples: number[] = [];
    fixture.componentRef.setInput('template', tpl);
    fixture.componentRef.setInput('sample', sample);
    fixture.componentInstance.patch.subscribe(p => { patches.push(p); tpl = { ...tpl, ...p }; fixture.componentRef.setInput('template', tpl); fixture.detectChanges(); });
    fixture.componentInstance.sampleChange.subscribe(n => samples.push(n));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, patches, samples, tpl: () => tpl, text: () => el.textContent!.replace(/\s+/g, ' ') };
  };
  const radio = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('[role=radio]')].find(b => b.textContent!.includes(label))!;

  it('an untouched template reads as today and says what that takes', () => {
    const m = make();
    expect(radio(m.el, 'Each department').getAttribute('aria-checked')).toBe('true');
    expect(radio(m.el, 'Signature image').getAttribute('aria-checked')).toBe('true');
    expect(m.text()).toMatch(/2 signatories · 1 row · \d+ mm · at the end of each department/);
  });

  it('choosing a placement is ONE patch that stores only what differs from today', () => {
    const m = make();
    radio(m.el, 'Once, at the end').click();
    expect(m.patches).toHaveLength(1);
    expect(JSON.parse(m.patches[0].metadata!).reportStyle).toEqual({ v: 1, signatures: { placement: 'end' } });
    expect(m.text()).toMatch(/once, after End of Report/);
    radio(m.el, 'Each department').click();
    expect(m.tpl().metadata).toBe('{}');
  });

  it('the readout follows the choices', () => {
    const m = make();
    radio(m.el, 'Verified line').click();
    expect(m.text()).toMatch(/2 signatories · 2 lines · \d+ mm/);
    radio(m.el, 'Every page').click();
    expect(m.text()).toMatch(/at the foot of every page/);
    expect(m.text()).toMatch(/Takes \d+ mm on every page/);
  });

  it('"Try it with" changes the sample count, not the template', () => {
    const m = make({}, 7);
    expect(m.text()).toMatch(/7 signatories · 2 rows/);
    m.el.querySelector<HTMLButtonElement>('[aria-label="Try with 3 signatories"]')!.click();
    expect(m.samples).toEqual([3]);
    expect(m.patches).toHaveLength(0);
  });

  it('image height only shows while an image prints; the reserve box only on pre-printed paper', () => {
    const m = make();
    expect(m.el.querySelector('input[type=range]')).toBeTruthy();
    expect(m.el.querySelector('input[aria-label^="Reserve"]')).toBeNull();
    radio(m.el, 'Name only').click();
    expect(m.el.querySelector('input[type=range]')).toBeNull();
    expect(make({ letterpadMode: true }).el.querySelector('input[aria-label^="Reserve"]')).toBeTruthy();
  });

  it('a reserve is stored as whole millimetres, an empty box clears it, and names-only is explained', () => {
    const m = make({ letterpadMode: true });
    const box = m.el.querySelector<HTMLInputElement>('input[aria-label^="Reserve"]')!;
    box.value = '40.4'; box.dispatchEvent(new Event('change'));
    expect(readReportStyle(m.tpl()).signatures.reserveMm).toBe(40);
    expect(m.text()).toContain('print without an image');
    const again = m.el.querySelector<HTMLInputElement>('input[aria-label^="Reserve"]')!;
    again.value = ''; again.dispatchEvent(new Event('change'));
    expect(readReportStyle(m.tpl()).signatures.reserveMm).toBeNull();
  });

  it('too small a reserve says so', () => {
    const m = make({ letterpadMode: true }, 7);
    const box = m.el.querySelector<HTMLInputElement>('input[aria-label^="Reserve"]')!;
    box.value = '5'; box.dispatchEvent(new Event('change'));
    expect(m.text()).toContain('need more than the room you reserved');
  });

  it('the wording box falls back to the default when emptied', () => {
    const m = make();
    radio(m.el, 'Verified line').click();
    const input = m.el.querySelector<HTMLInputElement>('input[aria-label="Verified line wording"]')!;
    input.value = 'Verified by {name}'; input.dispatchEvent(new Event('change'));
    expect(readReportStyle(m.tpl()).signatures.verifiedText).toBe('Verified by {name}');
    const again = m.el.querySelector<HTMLInputElement>('input[aria-label="Verified line wording"]')!;
    again.value = '  '; again.dispatchEvent(new Event('change'));
    expect(readReportStyle(m.tpl()).signatures.verifiedText).toBe('Electronically verified by {name} on {datetime}');
  });

  it('plain words only: no jargon, no AI, no emoji', () => {
    const m = make({ letterpadMode: true });
    expect(m.text()).not.toMatch(/\bAI\b|reportStyle|metadata|placement/i);
    expect(m.text()).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
