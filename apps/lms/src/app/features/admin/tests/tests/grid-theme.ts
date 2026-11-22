import { colorSchemeDark, colorSchemeLight, createPart, themeQuartz } from 'ag-grid-community';

/**
 * Test Master's AG Grid themes (grid, option groups, microbiology, the test
 * editor's range grid) — their own module so the side-view panels don't
 * import tests.component (which imports them back: a cycle that left
 * TestsComponent undefined when a spec loaded a panel first).
 *
 * Font: the app's ONE family (Noto Sans) via `inherit` — never Inter.
 */
/**
 * Grid SIZE lives here only (owner 2026-11-19): rows 56px / header 40 on web (fine pointer + hover — the
 * `webPointerSignal` query), 64 / 48 on touch. The numbers are CSS variables set by GRID_TOUCH_PART (shipped with the
 * grid, not in the app's first load), so every grid follows the device — never a per-screen row height. AG-Grid keeps
 * an autoHeight row at least the row height. On touch every control in a cell gets a ≥44×44 hit area (an invisible
 * ::after — the visuals keep their size).
 */
export const GRID_SIZE = {
  rowHeight: 'var(--pf-grid-row-h, 56px)',
  headerHeight: 'var(--pf-grid-head-h, 40px)',
} as const;

const HIT = `:is(button, a[href], [role='switch'], [role='checkbox'], .ag-checkbox-input-wrapper)`;
// AG-Grid nests a part's CSS inside the theme's own selector, so `&` = the grid's themed element.
export const GRID_TOUCH_CSS = `& { --pf-grid-row-h: 56px; --pf-grid-head-h: 40px; }
@media not ((hover: hover) and (pointer: fine)) {
  & { --pf-grid-row-h: 64px; --pf-grid-head-h: 48px; }
  :where(.ag-cell) :where(${HIT}) { position: relative; }
  .ag-cell ${HIT}:not(.pf-ai-glow)::after { content: ''; position: absolute; left: 50%; top: 50%; width: max(100%, 44px); height: max(100%, 44px); transform: translate(-50%, -50%); }
}`;
export const GRID_TOUCH_PART = createPart({ feature: 'pfGridSize', css: GRID_TOUCH_CSS });

export const gridThemeLight = themeQuartz.withPart(colorSchemeLight).withPart(GRID_TOUCH_PART).withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  ...GRID_SIZE,
  borderRadius: 12,
  accentColor: '#7c3aed',
});

/**
 * Dark (owner 2026-11-19): the grid takes the CARD's surface — Quartz's stock dark is a neutral grey (#2a2a2e) that
 * sat on the violet-tinted dark cards like a pasted slab. Every surface is OPAQUE (rows scroll under the header and
 * pinned areas, so nothing may be see-through): rows / pinned rows / popups = `--pf-card-bg` (the card's own solid
 * colour), the header = the card with a faint 4% ink tint mixed in (still solid), hairlines = `--pf-line`, hover /
 * selection = violet tints laid over the row. Light is unchanged.
 */
const DARK_CARD = 'var(--pf-card-bg)';
export const GRID_DARK_SURFACE = {
  backgroundColor: DARK_CARD,
  oddRowBackgroundColor: DARK_CARD,
  wrapperBackgroundColor: DARK_CARD,
  pinnedRowBackgroundColor: DARK_CARD,
  foregroundColor: 'var(--text-primary)',
  chromeBackgroundColor: DARK_CARD,
  headerBackgroundColor: `color-mix(in srgb, var(--text-primary) 4%, ${DARK_CARD})`,
  borderColor: 'var(--pf-line)',
  rowHoverColor: 'color-mix(in srgb, #a855f7 8%, transparent)',
  selectedRowBackgroundColor: 'color-mix(in srgb, #a855f7 14%, transparent)',
} as const;

export const gridThemeDark = themeQuartz.withPart(colorSchemeDark).withPart(GRID_TOUCH_PART).withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  ...GRID_SIZE,
  borderRadius: 12,
  accentColor: '#a855f7',
  ...GRID_DARK_SURFACE,
});
