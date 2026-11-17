/**
 * The Lab section's merged settings pages (Settings re-home, 2026-11-17).
 *
 * ONE catalog the pages and the Settings shell share: each routed page lists
 * its categories (the `?tab=` of the page); the shell's left panel renders
 * them while a page is open. Pages never hard-code their own tab list.
 */
export interface LabPageCategory {
  readonly id: string;
  readonly label: string;
}

export interface LabPageDef {
  readonly path: string;
  readonly title: string;
  readonly categories: readonly LabPageCategory[];
}

export const LAB_PAGES = {
  sampleNumbers: {
    path: '/admin/lab/sample-numbers',
    title: 'Sample numbers',
    categories: [
      { id: 'format', label: 'Sample ID format' },
      { id: 'prefixes', label: 'Prefix per lab space' },
      { id: 'structure', label: 'Lab structure' },
      { id: 'barcode', label: 'Barcode type' },
      { id: 'find', label: 'Find a sample' },
    ],
  },
  collection: {
    path: '/admin/lab/collection',
    title: 'Collection and queues',
    categories: [
      { id: 'queue', label: 'Queue focus' },
      { id: 'assign', label: 'Auto-assign technicians and validators' },
      { id: 'noscan', label: 'Claim without scanning' },
    ],
  },
  results: {
    path: '/admin/lab/results',
    title: 'Results and validation',
    categories: [
      { id: 'validation', label: 'Require validation' },
      { id: 'constants', label: 'Calculation constants' },
      { id: 'micro', label: 'Microbiology' },
    ],
  },
  homeCollection: {
    path: '/admin/lab/home-collection',
    title: 'Home collection',
    categories: [
      { id: 'switch', label: 'Home collection on or off' },
      { id: 'agents', label: 'Agents' },
    ],
  },
  frontDesk: {
    path: '/admin/lab/front-desk',
    title: 'Front desk',
    categories: [
      // The appointments screen's own sections (it follows ?tab=mode|slots|priority), then the shared referring list.
      { id: 'mode', label: 'Queue mode' },
      { id: 'slots', label: 'Booking slots' },
      { id: 'priority', label: 'Priority engine' },
      { id: 'referring', label: 'Referring doctors and hospitals' },
    ],
  },
  alerts: {
    path: '/admin/lab/alerts',
    title: 'Lab alerts',
    categories: [{ id: 'alerts', label: 'Alerts' }],
  },
  numbers: {
    path: '/admin/lab/numbers',
    title: 'Numbers on lab screens',
    categories: [{ id: 'numbers', label: 'Number cards' }],
  },
  reportOptions: {
    path: '/admin/lab/report-options',
    title: 'Report options',
    categories: [
      { id: 'notes', label: 'Technician notes on report' },
      { id: 'sending', label: 'Send reports on WhatsApp' },
    ],
  },
} as const satisfies Record<string, LabPageDef>;

export type LabPageKey = keyof typeof LAB_PAGES;

/** First category id of a page, or the id the URL named when it is valid. */
export function resolveLabTab(page: LabPageDef, wanted: string | null | undefined): string {
  const ids = page.categories.map(c => c.id);
  return wanted && ids.includes(wanted) ? wanted : ids[0];
}

/**
 * Where each card of the old "Lab settings" page (`/admin/lab-settings?tab=`)
 * lives now. The frame agent builds the legacy redirects from this so an old
 * link / search hit / bookmark opens the right page and category.
 */
export const LEGACY_LAB_SETTINGS_TARGET: Readonly<Record<string, { path: string; tab: string }>> = {
  collection: { path: LAB_PAGES.sampleNumbers.path, tab: 'find' },
  queues: { path: LAB_PAGES.collection.path, tab: 'queue' },
  rules: { path: LAB_PAGES.results.path, tab: 'validation' },
  report: { path: LAB_PAGES.reportOptions.path, tab: 'notes' },
};

/** Old `?tab=` + card → exact new target (finer than the tab-level map). */
export const LEGACY_LAB_SETTINGS_CARD_TARGET: Readonly<Record<string, { path: string; tab: string }>> = {
  'scan-mode': { path: LAB_PAGES.sampleNumbers.path, tab: 'find' },
  'label-code': { path: LAB_PAGES.sampleNumbers.path, tab: 'barcode' },
  'lab-structure': { path: LAB_PAGES.sampleNumbers.path, tab: 'structure' },
  'sample-ids': { path: LAB_PAGES.sampleNumbers.path, tab: 'format' },
  'queue-focus': { path: LAB_PAGES.collection.path, tab: 'queue' },
  'auto-assign': { path: LAB_PAGES.collection.path, tab: 'assign' },
  'no-scan': { path: LAB_PAGES.collection.path, tab: 'noscan' },
  'require-validation': { path: LAB_PAGES.results.path, tab: 'validation' },
  'calc-constants': { path: LAB_PAGES.results.path, tab: 'constants' },
  'tech-notes': { path: LAB_PAGES.reportOptions.path, tab: 'notes' },
};

/**
 * Where lab spaces (names + codes) and department placement are edited.
 * Owned by the Departments and lab spaces page; ONE constant so a move is a
 * one-line change for every link that points there.
 */
export const LAB_SPACES_PATH = '/admin/lab/departments';
/** The query that opens the Lab spaces tab of that page. */
export const LAB_SPACES_QUERY: Readonly<Record<string, string>> = { tab: 'spaces' };
