import type { OptionFamily } from './option-family';

/** The contract's Casts family (owner 2026-10-23). */
export const CASTS: OptionFamily = {
  code: 'FAM-CASTS', name: 'Casts', active: true,
  nodes: [
    { code: 'ABS', label: 'Absent', normal: true },
    { code: 'PRS', label: 'Present', normal: false, children: {
      label: 'Cast type', multi: true, nodes: [
        { code: 'HYA', label: 'Hyaline', qty: { kind: 'choice', options: ['0-2', '2-3', '3-5'], unit: '/LPF' } },
        { code: 'GRA', label: 'Granular', qty: { kind: 'choice', options: ['Few', 'Moderate', 'Many'] },
          children: { label: 'Texture', multi: false, nodes: [
            { code: 'FIN', label: 'Fine' }, { code: 'CRS', label: 'Coarse' },
          ] } },
        { code: 'WAX', label: 'Waxy', qty: { kind: 'number', unit: '/LPF' } },
        { code: 'OTH', label: 'Other', qty: { kind: 'text' } },
      ] } },
  ],
};
