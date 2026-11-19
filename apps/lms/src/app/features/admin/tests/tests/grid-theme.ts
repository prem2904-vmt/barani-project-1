import { colorSchemeDark, colorSchemeLight, themeQuartz } from 'ag-grid-community';

/**
 * Test Master's AG Grid themes (grid, option groups, microbiology, the test
 * editor's range grid) — their own module so the side-view panels don't
 * import tests.component (which imports them back: a cycle that left
 * TestsComponent undefined when a spec loaded a panel first).
 *
 * Font: the app's ONE family (Noto Sans) via `inherit` — never Inter.
 */
export const gridThemeLight = themeQuartz.withPart(colorSchemeLight).withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  rowHeight: 44,
  headerHeight: 40,
  borderRadius: 12,
  accentColor: '#7c3aed',
});

/**
 * Dark (owner 2026-11-19): the grid takes the CARD's surface — Quartz's stock dark is a neutral grey (#2a2a2e) that
 * sat on the violet-tinted dark cards like a pasted slab. Rows are transparent (the card shows through), the header
 * is the card + a faint ink tint, hairlines are `--pf-line`, hover / selection are the violet tints; popups (column
 * menus, editors) keep an opaque card surface. Light is unchanged.
 */
export const GRID_DARK_SURFACE = {
  backgroundColor: 'transparent',
  oddRowBackgroundColor: 'transparent',
  foregroundColor: 'var(--text-primary)',
  chromeBackgroundColor: 'var(--pf-card-bg)',
  headerBackgroundColor: 'color-mix(in srgb, var(--text-primary) 4%, transparent)',
  borderColor: 'var(--pf-line)',
  rowHoverColor: 'color-mix(in srgb, #a855f7 8%, transparent)',
  selectedRowBackgroundColor: 'color-mix(in srgb, #a855f7 14%, transparent)',
} as const;

export const gridThemeDark = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  rowHeight: 44,
  headerHeight: 40,
  borderRadius: 12,
  accentColor: '#a855f7',
  ...GRID_DARK_SURFACE,
});
