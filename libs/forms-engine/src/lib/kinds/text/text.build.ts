import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { cfg } from '../../core/types';

/** Studio descriptor for `text` (plan §4). */
export const TEXT_BUILD: KindBuild = {
  kind: 'text',
  name: 'Text',
  hint: 'Words the doctor types or dictates: a note, an occupation, a phone number.',
  icon: 'text',
  group: 'Ask',
  sentence: (label) => `${label}: {value}.`,
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    { name: 'multiline', label: 'Several lines' },
    { name: 'format', label: 'Kind of text', choices: { plain: 'Words', phone: 'Phone number', email: 'E-mail address' } },
    { name: 'voice', label: 'Microphone for dictation' },
    { name: 'suggestions', label: 'Suggest earlier answers' },
  ],
  sample: (f) => {
    const format = cfg<string>(f, 'format', 'plain');
    if (format === 'phone') return '+91 98765 43210';
    if (format === 'email') return 'patient@example.com';
    return f.placeholder || `${f.label.toLowerCase()} as told`;
  },
};
