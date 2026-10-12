import { colorSchemeDark, colorSchemeLight, themeQuartz } from 'ag-grid-community';

/**
 * AG-Grid skin for an ND card (a grid that IS the card's body, e.g. Expenses'
 * book). Every colour is an pf-kit / app token, so the grid takes the card's
 * own surface in light and dark instead of Quartz's stock grey, and a short
 * list ends on the card rather than on a foreign grey block:
 *  - surface = `--pf-card-bg` (rows, header, empty body);
 *  - hairlines = `--pf-line`, rows only (no column rules, no wrapper border —
 *    the card already draws the frame);
 *  - header = quiet 12px / 500 in `--text-tertiary`;
 *  - hover = a 4% ink wash; selection = the kit's neutral `--pf-in-tint`.
 * Font: the app's ONE family via `inherit`.
 */
export const ND_GRID_PARAMS = {
  fontFamily: 'inherit',
  fontSize: 13,
  rowHeight: 48,
  headerHeight: 40,
  borderRadius: 10,
  wrapperBorderRadius: 0,
  cellHorizontalPadding: 14,
  backgroundColor: 'var(--pf-card-bg)',
  foregroundColor: 'var(--text-primary)',
  oddRowBackgroundColor: 'var(--pf-card-bg)',
  headerBackgroundColor: 'var(--pf-card-bg)',
  headerTextColor: 'var(--text-tertiary)',
  headerFontSize: 12,
  headerFontWeight: 500,
  borderColor: 'var(--pf-line)',
  wrapperBorder: false,
  columnBorder: false,
  headerColumnBorder: false,
  pinnedColumnBorder: false,
  rowBorder: true,
  headerRowBorder: true,
  // No resize rules drawn in the header (still resizable on hover).
  headerColumnResizeHandleColor: 'transparent',
  rowHoverColor: 'color-mix(in srgb, var(--text-primary) 4%, transparent)',
  selectedRowBackgroundColor: 'var(--pf-in-tint)',
} as const;

export const ndGridLight = themeQuartz.withPart(colorSchemeLight).withParams({ ...ND_GRID_PARAMS, accentColor: '#7c3aed' });
export const ndGridDark = themeQuartz.withPart(colorSchemeDark).withParams({ ...ND_GRID_PARAMS, accentColor: '#a855f7' });
