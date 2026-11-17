import type { SegmentedOption } from '../primitives/segmented.component';

/**
 * Settings with several full pages show a small segmented switch in the band
 * (DESIGN-V2 rule 2, like Test Master's view switch). Value = the route.
 */
export const ANALYZER_PAGES: SegmentedOption<string>[] = [
  { value: '/admin/instruments', label: 'Analyzers' },
  { value: '/admin/bridges', label: 'Bridges' },
];
