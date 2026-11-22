import type { GridConfig } from './grid-model';

/** The API's dental-chart example (GridKind.Examples) — the shape every test below writes in. */
export const DENTAL: GridConfig = {
  display: 'table',
  rowHeader: 'Tooth',
  columns: [
    {
      key: 'status',
      label: 'Status',
      type: 'choice',
      options: [
        { key: 'sound', label: 'Sound' },
        { key: 'caries', label: 'Caries' },
        { key: 'filled', label: 'Filled' },
        { key: 'missing', label: 'Missing' },
      ],
    },
    {
      key: 'mobility',
      label: 'Mobility',
      type: 'choice',
      options: [
        { key: 'none', label: 'None' },
        { key: 'g1', label: 'Grade 1' },
        { key: 'g2', label: 'Grade 2' },
      ],
    },
    { key: 'note', label: 'Note', type: 'text' },
  ],
  headerGroups: [{ label: 'Findings', from: 'status', span: 2 }],
  rows: [
    { key: 't18', label: '18' },
    { key: 't17', label: '17' },
    { key: 't16', label: '16' },
  ],
  quickFill: {
    enabled: true,
    presets: [
      { label: 'All sound', value: 'Sound' },
      { label: 'No mobility', value: 'None', scope: 'column' },
    ],
  },
};
