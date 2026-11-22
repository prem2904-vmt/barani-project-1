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
  /** Where it applies ("this branch" / "all branches"), said once on its side-card row and card head. */
  readonly scope?: string;
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
      { id: 'format', label: 'Format', scope: 'all branches' },
      { id: 'order', label: 'Order ID', scope: 'all branches' },
      { id: 'prefixes', label: 'Prefixes', scope: 'per branch' },
      { id: 'find', label: 'Finding a sample', scope: 'all branches' },
      { id: 'barcode', label: 'Labels', scope: 'this branch' },
      { id: 'structure', label: 'Structure', scope: 'this branch' },
    ],
  },
  collection: {
    path: '/admin/lab/collection',
    title: 'Collection and queues',
    categories: [
      { id: 'queue', label: 'Queue', scope: 'this branch' },
      { id: 'noscan', label: 'Claiming', scope: 'all branches' },
      { id: 'assign', label: 'Auto-assign', scope: 'this branch' },
    ],
  },
  results: {
    path: '/admin/lab/results',
    title: 'Results and validation',
    categories: [
      { id: 'constants', label: 'Calculations', scope: 'all branches' },
      { id: 'validation', label: 'Validation', scope: 'this branch' },
      { id: 'micro', label: 'Microbiology', scope: 'all branches' },
    ],
  },
  homeCollection: {
    path: '/admin/lab/home-collection',
    title: 'Home collection',
    categories: [
      { id: 'switch', label: 'Home collection', scope: 'this branch' },
      { id: 'agents', label: 'Agents' },
    ],
  },
  frontDesk: {
    path: '/admin/lab/front-desk',
    title: 'Front desk',
    categories: [
      // The appointments screen's own sections (it follows ?tab=mode|slots|priority), then the shared referring list.
      { id: 'mode', label: 'Queue mode', scope: 'this branch' },
      { id: 'slots', label: 'Booking slots', scope: 'this branch' },
      { id: 'priority', label: 'Priority engine', scope: 'this branch' },
      { id: 'referring', label: 'Referring doctors', scope: 'one shared list' },
      // Which columns the Frontdesk WORK grid shows for Lab, in which order (features/admin/fd-grid-columns).
      { id: 'columns', label: 'Work grid columns', scope: 'this branch' },
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
  // Not a page of its own any more (owner 2026-11-17, "all in one"): Sending is
  // a tab of Report design, and the Report notes switch is a row inside its
  // Results table tab (no tab of its own). The old /admin/lab/report-options
  // link redirects there (settings-map `rehome`).
  reportOptions: {
    path: '/admin/reports',
    title: 'Report design',
    categories: [
      { id: 'sending', label: 'Sending' },
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
  report: { path: LAB_PAGES.reportOptions.path, tab: 'table' },
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
  'tech-notes': { path: LAB_PAGES.reportOptions.path, tab: 'table' },
};

/**
 * Where lab spaces (names + codes) and department placement are edited.
 * Owned by the Departments and lab spaces page; ONE constant so a move is a
 * one-line change for every link that points there.
 */
export const LAB_SPACES_PATH = '/admin/lab/departments';
/** The query that opens the Lab spaces tab of that page. */
export const LAB_SPACES_QUERY: Readonly<Record<string, string>> = { tab: 'spaces' };
