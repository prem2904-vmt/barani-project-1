import type { DiagramShape, OpdQType } from './form-schema';

/**
 * "Add a question by typing a sentence" — port of the OPD mockup's parseQ
 * (opd-mockup/index.html, v5). The doctor types the question the way they'd
 * say it; this guesses the answer type, choices, unit, scale and sides:
 *
 *   "Nasal septum: normal, deviated left, deviated right" → Pick one (3 choices)
 *   "Symptoms (tick all): fever, cough"                     → Pick several
 *   "Ear discharge? yes/no"                                  → Yes / No / Not examined
 *   "Hearing loss both ears"                                 → Left & right · Pick one
 *   "Polyp size grade 0-4"                                   → Scale 0–4
 *   "Weight in kg"                                           → Number · kg
 *   "Last menstrual period date"                             → Date
 *   "Nasal endoscopy photos"                                 → Images & video
 *   "Mark the lesion on the body diagram"                    → Body diagram (body)
 *   "Audiometry table"                                       → Table (dB × Hz)
 *   "History of present illness"                             → Longer notes
 *
 * Pure; every guess can be changed in the inspector afterwards.
 */
export interface ParsedQuestion {
  label: string;
  type: OpdQType;
  sides: boolean;
  choices: string[];
  unit: string;
  min: number;
  max: number;
  shape?: DiagramShape;
  rows?: string[];
  cols?: string[];
}

export const AUDIOMETRY = { cols: ['250', '500', '1k', '2k', '4k', '8k'], rows: ['Right', 'Left'] };

const UNITS: Record<string, string> = {
  kg: 'kg', g: 'g', cm: 'cm', mm: 'mm', m: 'm', mmhg: 'mmHg', db: 'dB', day: 'days', days: 'days', week: 'weeks', weeks: 'weeks',
  month: 'months', months: 'months', year: 'years', years: 'years', '%': '%', '°f': '°F', '°c': '°C', bpm: 'bpm', ml: 'ml', l: 'L',
  hz: 'Hz', 'mg/dl': 'mg/dL', min: 'min', mins: 'min', minutes: 'min',
};
const SIDE_RX = /\b(?:both|each|either)\s+(?:ears?|eyes?|nostrils?|sides?|nasal cavities|tonsils?|limbs?|legs?|arms?|knees?|feet|hands?)\b|\bright\s*(?:and|&|\/)\s*left\b|\bleft\s*(?:and|&|\/)\s*right\b|\bbilateral(?:ly)?\b/i;
const MANY_RX = /\s*[([]?\b(?:tick all|all that apply|several|multiple|any of these)\b[)\]]?\s*/i;
const UNIT_RX = /\s*(?:\bin\b|\()\s*(kg|g|cm|mm|m|mmhg|db|days?|weeks?|months?|years?|%|°f|°c|bpm|ml|l|hz|mg\/dl|mins?|minutes)\)?\s*$/i;

const cap = (x: string) => { const t = String(x).trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

/** Examples the builder offers under the add box. */
export const SENTENCE_EXAMPLES = [
  'Nasal septum: normal, deviated left, deviated right',
  'Ear discharge? yes/no',
  'Hearing loss both ears',
  'Polyp size grade 0-4',
  'Weight in kg',
];

export function parseQuestion(raw: string | null | undefined): ParsedQuestion | null {
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  if (s.length < 2) return null;
  const p: ParsedQuestion = { label: s, type: 'short', sides: false, choices: [], unit: '', min: 0, max: 10 };
  let m: RegExpMatchArray | null;

  if (SIDE_RX.test(s)) {
    p.sides = true;
    s = s.replace(SIDE_RX, ' ').replace(/\s+/g, ' ').replace(/\s+([?:,])/g, '$1').trim();
    p.label = s;
  }

  if ((m = s.match(/^([^:]+):\s*(.+)$/)) && /,|\/|\bor\b/i.test(m[2])) {
    const ch = m[2].split(/\s*(?:,|\/|\bor\b)\s*/i).filter(Boolean).map(cap);
    if (ch.length === 2 && /^yes$/i.test(ch[0]) && /^no$/i.test(ch[1])) { p.type = 'yn'; p.label = m[1]; }
    else { p.type = MANY_RX.test(m[1]) ? 'many' : 'one'; p.label = m[1].replace(MANY_RX, ' '); p.choices = ch; }
  } else if (/\byes\s*(?:\/|or)\s*no\b|\by\/n\b/i.test(s) || (/\?$/.test(s) && s.split(' ').length <= 5 && !/^(what|how|why|which|where|when|who)\b/i.test(s))) {
    p.type = 'yn';
    p.label = s.replace(/\s*[-–,]?\s*\(?\byes\s*(?:\/|or)\s*no\b\)?|\s*\(?\by\/n\b\)?/gi, '');
  } else if ((m = s.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/)) && /\b(grade|scale|score|severity|rating)\b/i.test(s)) {
    p.type = 'scale'; p.min = +m[1]; p.max = Math.max(+m[2], +m[1] + 1);
    p.label = s.replace(m[0], '').replace(/\(\s*\)/, '');
  } else if ((m = s.match(UNIT_RX))) {
    p.type = 'num'; p.unit = UNITS[m[1].toLowerCase()] || m[1]; p.label = s.slice(0, m.index);
  } else if (/\b(date|lmp|last menstrual|when did)\b/i.test(s)) p.type = 'date';
  else if (/\b(photos?|images?|videos?|endoscop\w*|pictures?|camera|dermoscop\w*|capture)\b/i.test(s)) p.type = 'media';
  else if (/\b(diagram|mark on|drawing|outline)\b/i.test(s)) {
    p.type = 'diagram';
    p.shape = /nose|nasal/i.test(s) ? 'nose' : /body|skin|lesion/i.test(s) ? 'body' : 'ear';
  } else if (/\b(table|audiometr\w*|audiogram)\b/i.test(s)) {
    p.type = 'table'; p.cols = AUDIOMETRY.cols.slice(); p.rows = AUDIOMETRY.rows.slice(); p.unit = 'dB';
  } else if (/\b(notes|history|describe|details|summary)\b/i.test(s)) p.type = 'long';
  else if (/\b(grade|score|scale)\b/i.test(s)) { p.type = 'scale'; p.max = /grade/i.test(s) ? 4 : 10; }

  if (p.sides && p.type === 'short') {
    if (/hearing/i.test(s)) { p.type = 'one'; p.choices = ['None', 'Mild', 'Moderate', 'Severe', 'Profound']; }
    else if (/vision|acuity/i.test(s)) { p.type = 'one'; p.choices = ['6/6', '6/9', '6/12', '6/18', '6/24', '6/36', '6/60']; }
    else p.type = 'yn';
  }
  if (p.type === 'media' || p.type === 'table') p.sides = false;
  p.label = cap(String(p.label).replace(/\s+/g, ' ').replace(/[\s,:–-]+$/, '').trim() || 'New question');
  return p;
}
