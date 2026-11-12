/**
 * FDI two-digit tooth numbering (ISO 3950). Mirror of the server's `Teeth.cs` (shared vectors pin both).
 * First digit = quadrant (1 upper right, 2 upper left, 3 lower left, 4 lower right; 5 to 8 the same for baby teeth), second = the tooth counted
 * from the middle (1 central incisor ... 8 third molar; baby teeth 1 to 5). Surfaces: M mesial, D distal, O occlusal (incisal on front teeth),
 * B buccal (labial on front teeth), L lingual (palatal on upper teeth).
 */
export type Surface = 'M' | 'O' | 'D' | 'B' | 'L';
export const SURFACES: Surface[] = ['M', 'O', 'D', 'B', 'L'];

const ADULT_NAMES = ['central incisor', 'lateral incisor', 'canine', 'first premolar', 'second premolar', 'first molar', 'second molar', 'third molar'];
const BABY_NAMES = ['central incisor', 'lateral incisor', 'canine', 'first molar', 'second molar'];
const QUADRANTS = ['upper right', 'upper left', 'lower left', 'lower right'];

export const isBaby = (code: string): boolean => code.length === 2 && code[0] >= '5' && code[0] <= '8';

export function isValidTooth(code: string | null | undefined): boolean {
  if (!code || code.length !== 2 || !/^\d\d$/.test(code)) return false;
  return code[0] >= '1' && code[0] <= '4' ? code[1] >= '1' && code[1] <= '8' : code[0] >= '5' && code[0] <= '8' && code[1] >= '1' && code[1] <= '5';
}

/** "lower left first molar". */
export function toothName(code: string): string {
  const d = code.charCodeAt(0) - 49; // '1'
  const q = d >= 4 ? code.charCodeAt(0) - 53 : d; // '5'
  const name = (isBaby(code) ? BABY_NAMES : ADULT_NAMES)[Number(code[1]) - 1];
  return (isBaby(code) ? 'baby ' : '') + QUADRANTS[q] + ' ' + name;
}

const front = (code: string): boolean => code[1] <= '3';
const upper = (code: string): boolean => ' 1256'.includes(code[0]);

export function surfaceWord(code: string, s: Surface | string): string {
  switch (s) {
    case 'M':
      return 'mesial';
    case 'D':
      return 'distal';
    case 'O':
      return front(code) ? 'incisal' : 'occlusal';
    case 'B':
      return front(code) ? 'labial' : 'buccal';
    default:
      return upper(code) ? 'palatal' : 'lingual';
  }
}

/** Left to right as the doctor faces the patient. */
export const upperRow = (baby: boolean): string[] =>
  baby ? ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65'] : ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'];
export const lowerRow = (baby: boolean): string[] =>
  baby ? ['85', '84', '83', '82', '81', '71', '72', '73', '74', '75'] : ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'];

export type Dentition = 'adult' | 'child' | 'mixed';

export function allowed(code: string, dentition: Dentition | string): boolean {
  return dentition === 'child' ? isBaby(code) : dentition === 'mixed' ? true : !isBaby(code);
}

export interface ToothMark {
  tooth: string;
  condition: string;
  surfaces?: Surface[];
}

export interface ToothCondition {
  key: string;
  label: string;
  phrase?: string;
  color?: string;
  surfaces?: boolean;
  cross?: boolean;
}

/** One mark per tooth and condition (repeats merge their surfaces), teeth in numeric order, surfaces in dentist order. */
export function mergeMarks(marks: ToothMark[] | null | undefined): Required<ToothMark>[] {
  const out: Required<ToothMark>[] = [];
  for (const m of marks ?? []) {
    if (!m || !isValidTooth(m.tooth) || !m.condition) continue;
    const s = (m.surfaces ?? []).filter((x): x is Surface => SURFACES.includes(x));
    const have = out.find((x) => x.tooth === m.tooth && x.condition === m.condition);
    if (!have) out.push({ tooth: m.tooth, condition: m.condition, surfaces: [...s] });
    else for (const x of s) if (!have.surfaces.includes(x)) have.surfaces.push(x);
  }
  for (const m of out) m.surfaces.sort((a, b) => SURFACES.indexOf(a) - SURFACES.indexOf(b));
  return out.sort((a, b) => Number(a.tooth) - Number(b.tooth));
}

export const DEFAULT_CONDITIONS: ToothCondition[] = [
  { key: 'caries', label: 'Caries', surfaces: true },
  { key: 'filled', label: 'Filled', phrase: 'Filling in {teeth}', surfaces: true },
  { key: 'missing', label: 'Missing', phrase: '{teeth} missing', cross: true },
  { key: 'rootCanal', label: 'Root canal', phrase: 'Root canal treatment in {teeth}' },
  { key: 'crown', label: 'Crown', phrase: 'Crown on {teeth}' },
  { key: 'mobile', label: 'Mobile', phrase: '{teeth} mobile' },
  { key: 'fractured', label: 'Fractured', phrase: '{teeth} fractured' },
  { key: 'impacted', label: 'Impacted', phrase: '{teeth} impacted' },
];
