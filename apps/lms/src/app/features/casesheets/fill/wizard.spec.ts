import { ENT_SAMPLE } from '@prefrontal/forms-engine/testing';
import { FormDefinition } from '@prefrontal/forms-engine';
import { WizardController } from './wizard';

const ids = (w: WizardController) => w.pages().map((p) => p.id);

describe('WizardController (the page wizard)', () => {
  it('starts on the first page, or where the doctor left off', () => {
    const w = new WizardController();
    w.start(ENT_SAMPLE, {});
    expect(w.page()?.id).toBe('patient_info');
    expect(w.isFirst()).toBe(true);
    const again = new WizardController();
    again.start(ENT_SAMPLE, {}, 'timeline');
    expect(again.page()?.id).toBe('timeline');
  });

  it('pages follow the answers; forward / back / goTo; direction for the slide', () => {
    const w = new WizardController();
    w.start(ENT_SAMPLE, { complaints: ['obstruction'] });
    expect(ids(w)).toEqual(['patient_info', 'timeline', 'obstruction_details', 'other_symptoms']);
    expect(w.next()?.title).toBe('Timeline');
    w.forward();
    expect(w.page()?.id).toBe('timeline');
    expect(w.direction()).toBe(1);
    w.goTo('other_symptoms');
    expect(w.isLast()).toBe(true);
    expect(w.forward()).toBe(false);
    w.back();
    expect(w.page()?.id).toBe('obstruction_details');
    expect(w.direction()).toBe(-1);
  });

  it('when the current page disappears (its condition stopped matching) it stays near where it was', () => {
    const w = new WizardController();
    w.start(ENT_SAMPLE, { complaints: ['obstruction'] });
    w.goTo('obstruction_details');
    w.answers.set({ complaints: [] });
    expect(w.page()?.id).toBe('other_symptoms');
  });

  it('auto-advance only when the LAST visible field was answered and the page is complete', () => {
    const def: FormDefinition = {
      pages: [
        {
          key: 'a',
          title: 'A',
          fields: [
            { key: 'x', kind: 'yesno', label: 'X' },
            { key: 'y', kind: 'yesno', label: 'Y' },
          ],
        },
        { key: 'b', title: 'B', fields: [{ key: 'z', kind: 'text', label: 'Z' }] },
      ],
    };
    const w = new WizardController();
    w.start(def, {});
    w.answers.set({ y: 'yes' });
    expect(w.completesPage('y')).toBe(false); // x still empty
    w.answers.set({ x: 'no', y: 'yes' });
    expect(w.completesPage('x')).toBe(false); // not the last field
    expect(w.completesPage('y')).toBe(true);
    w.goTo('b');
    w.answers.set({ x: 'no', y: 'yes', z: 'note' });
    expect(w.completesPage('z')).toBe(false); // last page never advances
  });

  it('progress counts visible fields across pages', () => {
    const w = new WizardController();
    w.start(ENT_SAMPLE, { patientName: 'A', complaints: ['obstruction'] });
    const p = w.progress();
    expect(p.answered).toBe(2);
    expect(p.total).toBeGreaterThan(10);
    expect(w.pageTitle('timeline')).toBe('Timeline');
  });
});
