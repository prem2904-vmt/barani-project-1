import { AUDIOMETRY, SENTENCE_EXAMPLES, parseQuestion } from './sentence-parser';
import { typeName } from './form-schema';

/**
 * "Add a question by typing a sentence" — the port of the OPD mockup's
 * parseQ. Each case is how a doctor would type it; the parser guesses the
 * answer type the way the mockup does.
 */
describe('parseQuestion (sentence → question)', () => {
  it('ignores empty / one-letter input', () => {
    expect(parseQuestion('')).toBeNull();
    expect(parseQuestion('  a ')).toBeNull();
    expect(parseQuestion(null)).toBeNull();
  });

  it('"Label: a, b, c" is Pick one with those choices (capitalised)', () => {
    const p = parseQuestion('Nasal septum: normal, deviated left, deviated right')!;
    expect(p.type).toBe('one');
    expect(p.label).toBe('Nasal septum');
    expect(p.choices).toEqual(['Normal', 'Deviated left', 'Deviated right']);
  });

  it('"or" and "/" separate choices too', () => {
    expect(parseQuestion('Cycle: regular or irregular')!.choices).toEqual(['Regular', 'Irregular']);
    expect(parseQuestion('Cough: dry/wet')!.choices).toEqual(['Dry', 'Wet']);
  });

  it('"tick all" makes Pick several', () => {
    const p = parseQuestion('Symptoms (tick all): fever, cough, cold')!;
    expect(p.type).toBe('many');
    expect(p.label).toBe('Symptoms');
    expect(p.choices).toEqual(['Fever', 'Cough', 'Cold']);
  });

  it('yes/no, y/n and short questions are Yes / No / Not examined', () => {
    expect(parseQuestion('Ear discharge? yes/no')).toMatchObject({ type: 'yn', label: 'Ear discharge?' });
    expect(parseQuestion('Smoker y/n')).toMatchObject({ type: 'yn', label: 'Smoker' });
    expect(parseQuestion('Tonsils enlarged?')!.type).toBe('yn');
    expect(parseQuestion('Discharge: yes, no')!.type).toBe('yn');
    // A long / wh- question is not a yes-no.
    expect(parseQuestion('What brings you in today?')!.type).toBe('short');
  });

  it('both ears / right and left / bilateral → left & right; hearing gets a severity list', () => {
    const h = parseQuestion('Hearing loss both ears')!;
    expect(h.sides).toBe(true);
    expect(h.type).toBe('one');
    expect(h.choices).toEqual(['None', 'Mild', 'Moderate', 'Severe', 'Profound']);
    expect(h.label).toBe('Hearing loss');
    expect(parseQuestion('Visual acuity right and left')).toMatchObject({ sides: true, type: 'one' });
    expect(parseQuestion('Knee swelling bilateral')).toMatchObject({ sides: true, type: 'yn' });
    expect(typeName({ ...h })).toBe('Left & right · Pick one · 5 choices');
  });

  it('a range with grade / scale / score is a scale', () => {
    expect(parseQuestion('Polyp size grade 0-4')).toMatchObject({ type: 'scale', min: 0, max: 4, label: 'Polyp size grade' });
    expect(parseQuestion('Pain score 1 to 10')).toMatchObject({ type: 'scale', min: 1, max: 10 });
    expect(parseQuestion('Tonsil grade')).toMatchObject({ type: 'scale', max: 4 });
    expect(parseQuestion('Severity score')).toMatchObject({ type: 'scale', max: 10 });
  });

  it('"in <unit>" / "(unit)" is a number with that unit', () => {
    expect(parseQuestion('Weight in kg')).toMatchObject({ type: 'num', unit: 'kg', label: 'Weight' });
    expect(parseQuestion('Eye pressure (mmHg)')).toMatchObject({ type: 'num', unit: 'mmHg' });
    expect(parseQuestion('Duration in days')).toMatchObject({ type: 'num', unit: 'days' });
  });

  it('dates, media, diagrams, tables and notes', () => {
    expect(parseQuestion('Last menstrual period')!.type).toBe('date');
    expect(parseQuestion('Nasal endoscopy photos')!.type).toBe('media');
    expect(parseQuestion('Dermoscopy images')!.type).toBe('media');
    expect(parseQuestion('Mark the lesion on the body diagram')).toMatchObject({ type: 'diagram', shape: 'body' });
    expect(parseQuestion('Nasal cavity diagram')).toMatchObject({ type: 'diagram', shape: 'nose' });
    expect(parseQuestion('Ear drum diagram')).toMatchObject({ type: 'diagram', shape: 'ear' });
    const t = parseQuestion('Audiometry table')!;
    expect(t).toMatchObject({ type: 'table', unit: 'dB' });
    expect(t.cols).toEqual(AUDIOMETRY.cols);
    expect(parseQuestion('History of present illness')!.type).toBe('long');
  });

  it('images and tables are never left & right', () => {
    expect(parseQuestion('Photos of both eyes')).toMatchObject({ type: 'media', sides: false });
  });

  it('plain words are a short note', () => {
    expect(parseQuestion('chief complaint')).toMatchObject({ type: 'short', label: 'Chief complaint' });
  });

  it('every builder example parses to something other than a plain note', () => {
    for (const e of SENTENCE_EXAMPLES) expect(parseQuestion(e)!.type).not.toBe('short');
  });
});
