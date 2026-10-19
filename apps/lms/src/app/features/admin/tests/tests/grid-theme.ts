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

export const gridThemeDark = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  rowHeight: 44,
  headerHeight: 40,
  borderRadius: 12,
  accentColor: '#a855f7',
});
