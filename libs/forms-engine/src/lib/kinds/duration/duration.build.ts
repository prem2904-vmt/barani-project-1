import { KindBuild, NUMBER_OPS } from '../../build/contract';
import { cfg } from '../../core/types';

/** Studio descriptor for `duration`. */
export const DURATION_BUILD: KindBuild = {
  kind: 'duration',
  name: 'How long',
  hint: 'How long something has lasted (5 days, 5–7 days) or a time of day, picked with chips.',
  icon: 'k-duration',
  group: 'Measure',
  // the API's duration writes the sentence itself: {value} is the number, {unit} the unit ("5 days")
  sentence: (label) => `${label}: {value} {unit}.`,
  sentenceTokens: [
    { text: '{value}', label: 'how many' },
    { text: '{unit}', label: 'days / weeks' },
  ],
  ifNone: null,
  conditionValue: 'number',
  conditionOps: NUMBER_OPS,
  config: [
    {
      name: 'scale',
      label: 'Measured in',
      choices: { calendar: 'Days, weeks, months, years', clock: 'Seconds, minutes, hours', period: 'Time of day' },
    },
    { name: 'mode', label: 'One number or a range', choices: { single: 'One number', range: 'A range (5–7)' } },
    { name: 'display', label: 'Looks like', choices: { box: 'A number box and a unit list', chips: 'Number and unit buttons' } },
    {
      name: 'defaultUnit',
      label: 'Starts on',
      choices: {
        seconds: 'Seconds',
        minutes: 'Minutes',
        hours: 'Hours',
        days: 'Days',
        weeks: 'Weeks',
        months: 'Months',
        years: 'Years',
      },
    },
  ],
  sample: (f) => {
    if (cfg<string>(f, 'scale', 'calendar') === 'period') return 'night';
    const unit = cfg<string>(f, 'defaultUnit', cfg<string>(f, 'scale', 'calendar') === 'clock' ? 'hours' : 'days');
    return cfg<string>(f, 'mode', 'single') === 'range' ? { amount: 5, valueTo: 7, unit } : { amount: 5, unit };
  },
};
